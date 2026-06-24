// 手柄/键盘遥控逻辑（在 background service worker 里运行）。
// 连 native host（osn-gamepad.exe）→ 收手柄/键盘原始事件 → 单/双击/长按判定
// → 按映射配置 → 把动作发给 B 站视频页的 content script。
// 配置存 chrome.storage.local（key osn_gamepad），popup 设置面板可改。

const HOST_NAME = 'com.osn.gamepad'
const CONFIG_KEY = 'osn_gamepad'

export const DEFAULT_CONFIG = {
  enabled: true,
  sources: { gamepad: true, keyboard: false }, // 输入源开关
  doubleMs: 250,
  holdMs: 350,
  bindings: [
    { action: 'rewind', label: '后退', device: 'gamepad', button: 'LeftThumb', code: '', trigger: 'click', seconds: 5 },
    { action: 'forward', label: '前进', device: 'gamepad', button: 'LeftThumb', code: '', trigger: 'double', seconds: 5 },
    { action: 'toggle', label: '播放/暂停', device: 'gamepad', button: 'RightThumb', code: '', trigger: 'click' },
    // 键盘默认绑 F9/F10/F11（sources.keyboard 默认关，开了才生效）
    { action: 'rewind', label: '后退', device: 'keyboard', button: 'Key:120', code: '', trigger: 'click', seconds: 5 },
    { action: 'forward', label: '前进', device: 'keyboard', button: 'Key:121', code: '', trigger: 'click', seconds: 5 },
    { action: 'toggle', label: '播放/暂停', device: 'keyboard', button: 'Key:122', code: '', trigger: 'click' },
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
      sendKbConfig()
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
  port.onMessage.addListener(onHostMessage)
  port.onDisconnect.addListener(() => {
    console.warn('[osn-gamepad] native host 断开:', chrome.runtime.lastError && chrome.runtime.lastError.message)
    port = null
    setTimeout(connect, 5000)
  })
}

// 从键盘绑定里提取虚拟键码（button 形如 "Key:120"）下发给 exe；键盘源关时下发空。
function keyboardVks() {
  return config.bindings
    .filter(b => b.device === 'keyboard')
    .map(b => parseInt(String(b.button || '').replace('Key:', ''), 10))
    .filter(Number.isInteger)
}

function sendKbConfig() {
  if (!port) return
  const keys = config.sources && config.sources.keyboard ? [...new Set(keyboardVks())] : []
  try { port.postMessage({ type: 'kb-config', keys }) } catch (_) {}
}

function setCapture(on) {
  if (port) { try { port.postMessage({ type: 'capture', on }) } catch (_) {} }
}

const isKeyboardEvent = msg => msg.gamepad === 'Keyboard' || String(msg.button || '').startsWith('Key:')

function onHostMessage(msg) {
  if (!msg) return
  if (msg.type === 'ready') { sendKbConfig(); return }
  if (msg.type !== 'button') return

  // 捕获模式：把「按下」回传 popup 用于绑定，不走映射
  if (capturing && msg.state === 'down') {
    capturing = false
    setCapture(false)
    sendKbConfig()
    chrome.runtime.sendMessage(
      { type: 'osn:gamepad-captured', device: isKeyboardEvent(msg) ? 'keyboard' : 'gamepad', button: msg.button, code: msg.code, gamepad: msg.gamepad },
      () => void chrome.runtime.lastError
    )
    return
  }

  if (!config.enabled) return
  const kb = isKeyboardEvent(msg)
  if (kb && !(config.sources && config.sources.keyboard)) return
  if (!kb && !(config.sources && config.sources.gamepad)) return

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
    st.pending = true
    st.clickTimer = setTimeout(() => {
      st.pending = false
      if (clk) fire(clk)
    }, config.doubleMs)
  } else if (clk) {
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
    setCapture(true) // 让 exe 临时扫全部键，便于绑定任意手柄键/键盘键
    setTimeout(() => {
      if (capturing) {
        capturing = false
        setCapture(false)
        sendKbConfig()
      }
    }, 8000)
    return { ok: true }
  }
  if (msg.type === 'osn:gamepad-capture-stop') {
    capturing = false
    setCapture(false)
    sendKbConfig()
    return { ok: true }
  }
  if (msg.type === 'osn:gamepad-status') {
    return { connected: !!port, enabled: config.enabled, sources: config.sources }
  }
  return null
}
