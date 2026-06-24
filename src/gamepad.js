// 手柄遥控逻辑（在 background service worker 里运行）。
// 连接 native host（osn-gamepad.exe）→ 收原始按键事件 → 单/双击/长按判定
// → 按映射配置 → 把动作发给 B 站视频页的 content script。
// 映射配置存 chrome.storage.local，popup 设置面板可改（暂用默认值）。

const HOST_NAME = 'com.osn.gamepad'
const CONFIG_KEY = 'osn_gamepad'

export const DEFAULT_CONFIG = {
  enabled: true,
  doubleMs: 250,
  holdMs: 350,
  bindings: [
    { action: 'rewind', label: '后退', button: 'LeftThumb', code: '', trigger: 'click', seconds: 5 },
    { action: 'forward', label: '前进', button: 'LeftThumb', code: '', trigger: 'double', seconds: 5 },
    { action: 'toggle', label: '播放/暂停', button: 'RightThumb', code: '', trigger: 'click' },
  ],
}

let initialized = false
let port = null
let config = DEFAULT_CONFIG
let capturing = false
const keyState = {} // 按 code 记单/双击/长按的时序状态

export async function initGamepad() {
  if (initialized) { connect(); return }
  initialized = true
  config = await loadConfig()
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CONFIG_KEY]) {
      config = { ...DEFAULT_CONFIG, ...(changes[CONFIG_KEY].newValue || {}) }
    }
  })
  connect()
}

async function loadConfig() {
  const r = await chrome.storage.local.get(CONFIG_KEY)
  return { ...DEFAULT_CONFIG, ...(r[CONFIG_KEY] || {}) }
}

function connect() {
  if (port) return
  try {
    port = chrome.runtime.connectNative(HOST_NAME)
  } catch (e) {
    console.warn('[osn-gamepad] connectNative 抛错:', e)
    port = null
    return
  }
  console.log('[osn-gamepad] 已发起连接 native host:', HOST_NAME)
  port.onMessage.addListener(onHostMessage)
  port.onDisconnect.addListener(() => {
    console.warn('[osn-gamepad] native host 断开:', chrome.runtime.lastError && chrome.runtime.lastError.message)
    port = null
    // host 未注册/异常退出时，隔一段时间再试，避免狂连
    setTimeout(connect, 5000)
  })
}

function onHostMessage(msg) {
  if (!msg || msg.type !== 'button') return
  // 捕获模式：把「按下」事件回传 popup 用于绑定，不走映射
  if (capturing && msg.state === 'down') {
    capturing = false
    chrome.runtime.sendMessage(
      { type: 'osn:gamepad-captured', button: msg.button, code: msg.code, gamepad: msg.gamepad },
      () => void chrome.runtime.lastError
    )
    return
  }
  if (!config.enabled) return
  if (msg.state === 'down') onButtonDown(msg.button, msg.code)
  else if (msg.state === 'up') onButtonUp(msg.code)
}

function bindsFor(button, code) {
  return config.bindings.filter(b => (b.code ? b.code === code : b.button === button))
}

function onButtonDown(button, code) {
  const binds = bindsFor(button, code)
  if (!binds.length) return
  const dbl = binds.find(b => b.trigger === 'double')
  const clk = binds.find(b => b.trigger === 'click')
  const hold = binds.find(b => b.trigger === 'hold')
  const st = keyState[code] || (keyState[code] = {})

  if (dbl && st.pending) {
    clearTimeout(st.clickTimer)
    st.pending = false
    fire(dbl)
  } else if (dbl) {
    // 有双击绑定：先挂起，等窗口确认是不是双击
    st.pending = true
    st.clickTimer = setTimeout(() => {
      st.pending = false
      if (clk) fire(clk)
    }, config.doubleMs)
  } else if (clk) {
    // 没有双击绑定：单击即时触发（无延迟）
    fire(clk)
  }
  if (hold) {
    st.holdTimer = setTimeout(() => fire(hold), config.holdMs)
  }
}

function onButtonUp(code) {
  const st = keyState[code]
  if (st && st.holdTimer) {
    clearTimeout(st.holdTimer)
    st.holdTimer = null
  }
}

function fire(binding) {
  const payload = { type: 'osn:gamepad-action', action: binding.action, seconds: binding.seconds || 5 }
  chrome.tabs.query({ url: '*://*.bilibili.com/video/*' }, tabs => {
    void chrome.runtime.lastError
    for (const t of tabs) {
      chrome.tabs.sendMessage(t.id, payload, () => void chrome.runtime.lastError)
    }
  })
}

// 供 background 的消息处理转发（popup → background）
export function handleGamepadCommand(msg) {
  if (msg.type === 'osn:gamepad-capture-start') {
    capturing = true
    setTimeout(() => { capturing = false }, 8000)
    return { ok: true }
  }
  if (msg.type === 'osn:gamepad-capture-stop') {
    capturing = false
    return { ok: true }
  }
  if (msg.type === 'osn:gamepad-status') {
    return { connected: !!port, enabled: config.enabled }
  }
  return null
}
