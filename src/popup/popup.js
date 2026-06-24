import {
  addAccount,
  addGame,
  deleteAccount,
  deleteGame,
  deleteVideo,
  exportData,
  getState,
  importData,
  renameAccount,
  setPageNote,
  setPageStatus,
  setVideoVersion,
  touchVideo,
  updateGame,
  updateVideoSourceInfo,
  upsertVideo,
} from '../lib/storage.js'
import { fetchVideoInfo, parseBvid } from '../lib/bili.js'
import { DEFAULT_CONFIG as DEFAULT_GP } from '../gamepad.js'

const app = document.getElementById('app')
const STATUS_LABELS = { todo: '待办', doing: '在肝', done: '已肝完' }
const UI_STATE_KEY = 'osn_popup_ui_state'

let state = { games: [], accounts: [], videos: [] }
let tab = null
let selectedGameId = ''
let selectedAccountId = ''
let detailVideoId = ''
let detailScrollTop = 0
let message = ''
let modal = ''
let renameTarget = null
let pendingConfirm = null
let extracted = { bvid: '', info: null, loading: false, error: '', expanded: false }
let gp = DEFAULT_GP // 手柄/键盘遥控配置
let gpCapture = null // 正在捕获重绑:{ action, device }
let currentPlaying = { bvid: '', page: 1, videoId: '' }
let hydratingUpFaces = false
const hydratedBvids = new Set()

boot().catch(showFatal)

async function boot() {
  tab = await getActiveTab()
  state = await getState()
  gp = await loadGamepadConfig()
  restoreUiState(await loadUiState())
  applyCurrentPageContext()
  normalizeSelection()
  render()
  await extractCurrentVideo()
  void hydrateVisibleUpFaces()
}

async function refresh(keepMessage = true) {
  const oldDetailScrollTop = currentDetailScrollTop()
  state = await getState()
  if (!state.games.some(g => g.id === selectedGameId)) selectedGameId = sortedGames()[0]?.id || ''
  if (!accountsForGame(selectedGameId).some(a => a.id === selectedAccountId)) {
    selectedAccountId = firstAccountId(selectedGameId)
  }
  if (!state.videos.some(v => v.id === detailVideoId)) detailVideoId = ''
  if (!keepMessage) message = ''
  render()
  restoreDetailScroll(oldDetailScrollTop)
  void hydrateVisibleUpFaces()
}

function render() {
  const bvid = parseBvid(tab?.url || '')
  const selectedGame = state.games.find(g => g.id === selectedGameId)
  const selectedAccount = state.accounts.find(a => a.id === selectedAccountId)
  const videos = sortedVideos(state.videos.filter(v => v.accountId === selectedAccountId))
  const detailVideo = state.videos.find(v => v.id === detailVideoId)

  app.className = ''
  app.innerHTML = `
    <header class="app-head">
      <div class="brand">
        <strong>一条龙</strong>
        <span>${escapeHtml(pageHint())}</span>
      </div>
      <div class="head-actions">
        <button class="iconish" data-action="open-gamepad" title="手柄 / 键盘遥控设置">🎮</button>
        <button class="iconish" data-action="export">导出</button>
      </div>
    </header>

    ${message ? `<div class="toast">${escapeHtml(message)}</div>` : ''}
    ${bvid ? renderCurrentPage(bvid, selectedGame, selectedAccount) : ''}

    <main class="home">
      <section class="library-head">
        <div>
          <h1>最近任务</h1>
          <p>${summaryText()}</p>
        </div>
        <label class="import-link">
          导入
          <input type="file" accept="application/json,.json" data-action="import" />
        </label>
      </section>

      ${renderLibrary(videos)}
    </main>

    ${modal === 'game' ? renderGameModal() : ''}
    ${modal === 'account' ? renderAccountModal() : ''}
    ${modal === 'gamepad' ? renderGamepadModal() : ''}
    ${renameTarget ? renderRenameModal() : ''}
    ${detailVideo ? renderDetailModal(detailVideo) : ''}
    ${pendingConfirm ? renderConfirmDialog() : ''}
  `

  bindEvents()
  settleDetailScroll()
  void saveUiState()
}

function renderCurrentPage(bvid, _selectedGame, selectedAccount) {
  if (!state.games.length) {
    return `
      <section class="context compact">
        <div>
          <b>当前是 B 站视频</b>
          <span>先建一个游戏，再收录这条视频。</span>
        </div>
        <button class="pill-action" data-action="open-game-modal">新建游戏</button>
      </section>
    `
  }

  if (!accountsForGame(selectedGameId).length) {
    return `
      <section class="context compact">
        <div>
          <b>当前是 B 站视频</b>
          <span>当前游戏还没有账号。</span>
        </div>
        <button class="pill-action" data-action="open-account-modal">新建账号</button>
      </section>
    `
  }

  if (extracted.loading) {
    return `
      <section class="context compact">
        <div>
          <b>正在提取分P</b>
          <span>识别到 ${escapeHtml(bvid)}</span>
        </div>
        <span class="loading-bar"></span>
      </section>
    `
  }

  if (extracted.error) {
    return `
      <section class="context compact danger-line">
        <div>
          <b>提取失败</b>
          <span>${escapeHtml(extracted.error)}</span>
        </div>
        <button class="pill-action" data-action="retry-extract">重试</button>
      </section>
    `
  }

  if (!extracted.info || extracted.bvid !== bvid) {
    return `
      <section class="context compact">
        <div>
          <b>当前是 B 站视频</b>
          <span>识别到 ${escapeHtml(bvid)}</span>
        </div>
        <button class="pill-action" data-action="retry-extract">提取</button>
      </section>
    `
  }

  const info = extracted.info
  return `
    <section class="context ${extracted.expanded ? 'expanded' : 'compact'}">
      <button class="extract-row" data-action="toggle-extract-preview">
        ${info.cover ? `<img src="${escapeAttr(info.cover)}" alt="">` : '<span class="cover-fallback">BV</span>'}
        <span>
          <b>已提取本页面分P</b>
          <em>${escapeHtml(info.title)}</em>
        </span>
        <small>${info.pages.length} P</small>
      </button>
      ${extracted.expanded ? renderExtractPreview(selectedAccount) : ''}
    </section>
  `
}

function renderGameRail() {
  return `
    <nav class="game-rail">
      ${sortedGames().map(g => `
        <div class="game-tab ${g.id === selectedGameId ? 'active' : ''}">
          <button class="game-tab-main" data-action="select-game" data-id="${g.id}">
            ${g.logo ? `<img src="${escapeAttr(g.logo)}" alt="">` : '<span>游</span>'}
            <b>${escapeHtml(g.name)}</b>
          </button>
          <button class="chip-edit" data-action="rename-game" data-id="${g.id}" title="改名" aria-label="改名">${editIcon()}</button>
          <button class="chip-del" data-action="delete-game" data-id="${g.id}" title="删除" aria-label="删除">${trashIcon()}</button>
        </div>
      `).join('')}
      <button class="game-add" data-action="open-game-modal" title="新建游戏" aria-label="新建游戏">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </nav>
  `
}

function renderAccountRail() {
  return `
    <section class="account-rail">
      ${sortedAccountsForGame(selectedGameId).map(a => `
        <div class="account-chip ${a.id === selectedAccountId ? 'active' : ''}">
          <button class="account-chip-main" data-action="select-account" data-id="${a.id}">
            ${escapeHtml(a.name)}
          </button>
          <button class="chip-edit" data-action="rename-account" data-id="${a.id}" title="改名" aria-label="改名">${editIcon()}</button>
          <button class="chip-del" data-action="delete-account" data-id="${a.id}" title="删除" aria-label="删除">${trashIcon()}</button>
        </div>
      `).join('')}
      <button class="account-add" data-action="open-account-modal" title="新建账号" aria-label="新建账号">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </section>
  `
}

function renderExtractPreview(selectedAccount) {
  const info = extracted.info
  const version = inferVersion(info.title)
  return `
    <div class="extract-preview">
      <div class="field-block">
        <span class="field-name">游戏</span>
        ${renderGameRail()}
      </div>
      <div class="field-block">
        <span class="field-name">账号</span>
        ${renderAccountRail()}
      </div>
      <label>版本号
        <input id="videoVersion" value="${escapeAttr(version)}" placeholder="例如 2.4" />
      </label>
      <div class="mini-pages">
        ${info.pages.slice(0, 5).map(p => `<span>P${p.page} ${escapeHtml(p.part)}</span>`).join('')}
        ${info.pages.length > 5 ? `<span>还有 ${info.pages.length - 5} 个分P</span>` : ''}
      </div>
      <div class="split-actions">
        <button class="ghost-btn" data-action="toggle-extract-preview">取消</button>
        <button class="primary-btn" data-action="add-current-video" ${selectedAccount ? '' : 'disabled'}>创建</button>
      </div>
    </div>
  `
}

function renderLibrary(videos) {
  if (!state.games.length) {
    return `
      <section class="empty-home">
        <b>还没有游戏</b>
        <span>先新建游戏，再把 B 站分P视频收进对应账号。</span>
        <button class="primary-btn" data-action="open-game-modal">新建游戏</button>
      </section>
    `
  }

  const accounts = sortedAccountsForGame(selectedGameId)
  return `
    ${renderGameRail()}
    ${renderAccountRail()}

    ${accounts.length ? renderVideos(videos) : `
      <section class="empty-home small-empty">
        <b>这个游戏还没有账号</b>
        <button class="primary-btn" data-action="open-account-modal">新建账号</button>
      </section>
    `}
  `
}

function renderVideos(videos) {
  if (!videos.length) {
    return `<section class="empty-list">这个账号还没有视频。打开 B 站视频页后从顶部创建。</section>`
  }

  return `
    <section class="video-list">
      ${videos.map(video => renderVideoRow(video)).join('')}
    </section>
  `
}

function renderVideoRow(video) {
  const total = video.pages.length
  const done = video.pages.filter(p => p.status === 'done').length
  const doing = video.pages.filter(p => p.status === 'doing').length
  const watched = video.pages.filter(p => Number(p.maxProgress) > 0).length
  const version = (video.version || '').trim()
  const meta = [
    `<span class="up-chip">${upAvatarHtml(video)}<strong>${escapeHtml(video.upName || '未知 UP')}</strong></span>`,
    version ? `<span>${escapeHtml(version)}版本</span>` : '',
    `<span>${done}/${total} 完成</span>`,
    doing ? `<span>${doing} 在肝</span>` : '',
    watched ? `<span>${watched} 看过</span>` : '',
  ].filter(Boolean).join('')
  return `
    <button class="video-row" data-action="open-detail" data-id="${video.id}">
      ${video.cover ? `<img src="${escapeAttr(video.cover)}" alt="">` : '<span class="cover-fallback">BV</span>'}
      <span class="video-copy">
        <b>${escapeHtml(video.title)}</b>
        <small class="video-meta">${meta}</small>
      </span>
      <span class="row-progress">${total ? Math.round(done / total * 100) : 0}%</span>
    </button>
  `
}

function renderDetailModal(video) {
  const done = video.pages.filter(p => p.status === 'done').length
  const doing = video.pages.filter(p => p.status === 'doing').length
  const pct = video.pages.length ? Math.round(done / video.pages.length * 100) : 0
  return `
    <div class="detail-shell">
      <header class="detail-headbar">
        <button class="back-btn" data-action="close-detail">返回</button>
        <strong>${done}/${video.pages.length} 完成</strong>
        <button class="text-danger" data-action="delete-video" data-id="${video.id}">删视频</button>
      </header>
      <section class="detail-summary">
        ${video.cover ? `<img src="${escapeAttr(video.cover)}" alt="">` : '<span class="cover-fallback large">BV</span>'}
        <div>
          <h2>${escapeHtml(video.title)}</h2>
          <div class="detail-meta">
            <span class="up-chip detail-up">${upAvatarHtml(video)}<strong>${escapeHtml(video.upName || '未知 UP')}</strong></span>
            <span>${video.pages.length} 个分P</span>
            <span>${doing} 在肝</span>
            <label class="version-inline">
              <span>版本</span>
              <input value="${escapeAttr(video.version || '')}" data-action="set-version" data-video-id="${video.id}" placeholder="2.4" />
            </label>
          </div>
        </div>
        <button class="open-page-btn summary-open" data-action="open-video-page" data-id="${video.id}" title="打开视频页" aria-label="打开视频页">
          ${openPageIcon()}
        </button>
      </section>
      <div class="total-progress"><span style="width:${pct}%"></span></div>
      <section class="page-list">
        ${video.pages.map(p => renderPageRow(video.id, p)).join('')}
      </section>
    </div>
  `
}

function renderPageRow(videoId, page) {
  const progressText = formatProgress(page)
  const playing = isCurrentPlayingPage(videoId, page.page)
  const note = (page.note || '').trim()
  return `
    <article class="task-row status-${page.status} ${playing ? 'is-playing' : ''}" data-page-row="${page.page}">
      <div class="task-top">
        ${playing ? `
          <button class="open-page-btn row-open playing-open" disabled title="正在播放" aria-label="正在播放">
            ${playingIcon()}
          </button>
        ` : `
          <button class="open-page-btn row-open" data-action="open-video-page" data-id="${videoId}" data-page="${page.page}" title="打开 P${page.page}" aria-label="打开 P${page.page}">
            ${openPageIcon()}
          </button>
        `}
        <div class="task-title">
          <b>P${page.page}</b>
          <span>${escapeHtml(page.part)}</span>
          ${playing ? '<em>正在播放</em>' : ''}
        </div>
        <div class="status-buttons" role="group" aria-label="分P状态">
          ${Object.entries(STATUS_LABELS).map(([value, label]) => `
            <button class="${page.status === value ? 'active' : ''}" data-action="set-status-button" data-video-id="${videoId}" data-page="${page.page}" data-status="${value}">
              ${label}
            </button>
          `).join('')}
        </div>
      </div>
      <div class="task-bottom">
        <div class="page-progress">
          <span style="width:${progressPercent(page)}%"></span>
        </div>
        <small>${escapeHtml(progressText || '未播放')}</small>
        ${note ? '' : renderNoteEditor(videoId, page)}
      </div>
      ${note ? `
        <div class="note-line">
          <p>${escapeHtml(note)}</p>
          ${renderNoteEditor(videoId, page, '编辑')}
        </div>
      ` : ''}
    </article>
  `
}

function renderNoteEditor(videoId, page, label = '备注') {
  return `
    <details class="note-box">
      <summary>${label}</summary>
      <textarea data-action="set-note" data-video-id="${videoId}" data-page="${page.page}" placeholder="记录材料、卡点、后续处理">${escapeHtml(page.note || '')}</textarea>
    </details>
  `
}

function upAvatarHtml(video) {
  if (video?.upFace) {
    return `<img class="up-avatar" src="${escapeAttr(video.upFace)}" alt="" aria-hidden="true">`
  }
  const name = (video?.upName || 'UP').trim()
  const initial = Array.from(name)[0] || 'UP'
  return `<span class="up-avatar up-avatar-fallback" aria-hidden="true">${escapeHtml(initial)}</span>`
}

function renderGameModal() {
  const name = defaultGameName()
  const logo = pageLogo()
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="新建游戏" data-stop>
        <div class="modal-head">
          <h2>新建游戏</h2>
          <button class="icon-btn" data-action="close-modal" title="关闭">×</button>
        </div>
        <div class="site-row">
          <div class="logo">${logo ? `<img src="${escapeAttr(logo)}" alt="">` : '游'}</div>
          <div>
            <p class="site-title">${escapeHtml(domainName())}</p>
            <p class="muted">可保存当前标签页 logo。</p>
          </div>
        </div>
        <label>游戏名
          <input id="newGameName" value="${escapeAttr(name)}" placeholder="游戏名" />
        </label>
        <button class="primary-btn" data-action="add-game-from-site">用当前网站创建</button>
        <div class="inline-form">
          <input id="manualGameName" placeholder="不使用当前网站，手动输入游戏名" />
          <button class="soft-btn" data-action="add-manual-game">新建</button>
        </div>
      </div>
    </div>
  `
}

function renderAccountModal() {
  const selectedGame = state.games.find(g => g.id === selectedGameId)
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="新建账号" data-stop>
        <div class="modal-head">
          <h2>新建账号</h2>
          <button class="icon-btn" data-action="close-modal" title="关闭">×</button>
        </div>
        <p class="muted">所属游戏：${escapeHtml(selectedGame?.name || '未选择')}</p>
        <label>账号名
          <input id="newAccountName" placeholder="比如 大号 / 小号" />
        </label>
        <button class="primary-btn" data-action="add-account">创建账号</button>
      </div>
    </div>
  `
}

function renderRenameModal() {
  const label = renameTarget.type === 'game' ? '游戏' : '账号'
  return `
    <div class="modal-backdrop" data-action="close-rename">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${label}改名" data-stop>
        <div class="modal-head">
          <h2>${label}改名</h2>
          <button class="icon-btn" data-action="close-rename" title="关闭">×</button>
        </div>
        <label>新名称
          <input id="renameInput" value="${escapeAttr(renameTarget.name)}" placeholder="${label}名" />
        </label>
        <button class="primary-btn" data-action="submit-rename">保存</button>
      </div>
    </div>
  `
}

function renderConfirmDialog() {
  return `
    <div class="modal-backdrop" data-action="confirm-cancel">
      <div class="modal-card confirm-card" role="alertdialog" aria-modal="true" data-stop>
        <p class="confirm-message">${escapeHtml(pendingConfirm.message)}</p>
        <div class="confirm-actions">
          <button class="soft-btn" data-action="confirm-cancel">取消</button>
          <button class="danger-btn" data-action="confirm-ok">删除</button>
        </div>
      </div>
    </div>
  `
}

function askConfirm(message, runFn) {
  pendingConfirm = { message, run: runFn }
  render()
}

// ——— 手柄 / 键盘遥控设置 ———
const GP_ACTIONS = [
  { key: 'rewind', label: '后退' },
  { key: 'forward', label: '前进' },
  { key: 'toggle', label: '播放/暂停' },
]
const GP_TRIGGER = { click: '单击', double: '双击', hold: '长按' }
const VK_NAMES = {
  112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 118: 'F7', 119: 'F8',
  120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12',
  33: 'PgUp', 34: 'PgDn', 35: 'End', 36: 'Home', 45: 'Insert', 46: 'Delete', 19: 'Pause',
}
const BTN_NAMES = {
  LeftThumb: 'L3', RightThumb: 'R3', LeftTrigger: 'LB', RightTrigger: 'RB',
  South: 'A', East: 'B', West: 'X', North: 'Y', Start: 'Start', Select: 'Back',
  DPadUp: '↑', DPadDown: '↓', DPadLeft: '←', DPadRight: '→',
}

async function loadGamepadConfig() {
  const r = await chrome.storage.local.get('osn_gamepad')
  return { ...DEFAULT_GP, ...(r.osn_gamepad || {}) }
}

async function saveGp() {
  await chrome.storage.local.set({ osn_gamepad: gp })
  render()
}

function sendBg(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, resp => { void chrome.runtime.lastError; resolve(resp) })
  })
}

function gpBindLabel(b) {
  if (!b || !b.button) return '未绑定'
  if (b.device === 'keyboard') {
    const vk = parseInt(String(b.button).replace('Key:', ''), 10)
    return VK_NAMES[vk] || `键${vk}`
  }
  return BTN_NAMES[b.button] || b.button
}

function gpSeconds() {
  const b = gp.bindings.find(x => x.action === 'rewind')
  return b && b.seconds ? b.seconds : 5
}

function renderGamepadModal() {
  const src = gp.sources || { gamepad: true, keyboard: false }
  const rowFor = act => {
    const padB = gp.bindings.find(b => b.action === act.key && b.device === 'gamepad')
    const kbB = gp.bindings.find(b => b.action === act.key && b.device === 'keyboard')
    const cap = d => (gpCapture && gpCapture.action === act.key && gpCapture.device === d ? ' capturing' : '')
    return `
      <div class="gp-row">
        <span class="gp-act">${act.label}</span>
        <button class="gp-bind${cap('gamepad')}" data-action="gp-rebind" data-act="${act.key}" data-device="gamepad">
          🎮 ${escapeHtml(gpBindLabel(padB))}${padB ? ` · ${GP_TRIGGER[padB.trigger] || ''}` : ''}
        </button>
        <button class="gp-bind${cap('keyboard')}" data-action="gp-rebind" data-act="${act.key}" data-device="keyboard">
          ⌨ ${escapeHtml(gpBindLabel(kbB))}${kbB ? ` · ${GP_TRIGGER[kbB.trigger] || ''}` : ''}
        </button>
      </div>
    `
  }
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal-card gp-card" role="dialog" aria-modal="true" data-stop>
        <div class="modal-head">
          <h2>🎮 手柄 / 键盘遥控</h2>
          <button class="icon-btn" data-action="close-modal" title="关闭">×</button>
        </div>
        <label class="gp-toggle"><input type="checkbox" data-action="gp-enabled" ${gp.enabled ? 'checked' : ''} /> 启用遥控</label>
        <div class="gp-sources">
          <span>输入源</span>
          <label><input type="checkbox" data-action="gp-source" data-device="gamepad" ${src.gamepad ? 'checked' : ''} /> 手柄</label>
          <label><input type="checkbox" data-action="gp-source" data-device="keyboard" ${src.keyboard ? 'checked' : ''} /> 键盘</label>
        </div>
        <p class="gp-hint">${gpCapture ? `请按一下${gpCapture.device === 'keyboard' ? '键盘' : '手柄'}上要绑定的键…` : '点按钮可重绑。非 Xbox 手柄需 BetterJoy 虚拟成 Xbox，游戏里才读得到。'}</p>
        <div class="gp-rows">${GP_ACTIONS.map(rowFor).join('')}</div>
        <label class="gp-seconds">前进 / 后退秒数 <input type="number" min="1" max="120" value="${gpSeconds()}" data-action="gp-seconds" /></label>
      </div>
    </div>
  `
}

async function onGamepadCaptured(msg) {
  if (!gpCapture) return
  const target = gpCapture
  gpCapture = null
  if (msg.device !== target.device) {
    message = `按到的是${msg.device === 'keyboard' ? '键盘' : '手柄'}键，请重新点「绑定」再按${target.device === 'keyboard' ? '键盘' : '手柄'}的键`
    render()
    return
  }
  const ref = gp.bindings.find(b => b.action === target.action) || {}
  let found = false
  const bindings = gp.bindings.map(b => {
    if (b.action === target.action && b.device === target.device) {
      found = true
      return { ...b, button: msg.button, code: msg.code || '' }
    }
    return b
  })
  if (!found) {
    bindings.push({ action: target.action, label: ref.label || target.action, device: target.device, button: msg.button, code: msg.code || '', trigger: 'click', seconds: ref.seconds })
  }
  gp = { ...gp, bindings }
  message = '已绑定'
  await saveGp()
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg && msg.type === 'osn:gamepad-captured') onGamepadCaptured(msg)
})

function bindEvents() {
  app.querySelectorAll('[data-action]').forEach(el => {
    const action = el.dataset.action
    if (action === 'set-version') {
      el.addEventListener('change', () => run(async () => {
        await setVideoVersion(el.dataset.videoId, el.value.trim())
        message = '版本号已保存'
        await refresh()
      }))
      return
    }
    if (action === 'set-note') {
      el.addEventListener('change', () => run(async () => {
        await setPageNote(el.dataset.videoId, Number(el.dataset.page), el.value)
        message = '备注已保存'
        await refresh()
      }))
      return
    }
    if (action === 'import') {
      el.addEventListener('change', () => run(() => importFile(el.files?.[0])))
      return
    }
    if (action === 'gp-enabled' || action === 'gp-source' || action === 'gp-seconds') {
      el.addEventListener('change', () => handleAction(el))
      return
    }
    el.addEventListener('click', () => handleAction(el))
  })

  app.querySelectorAll('[data-stop]').forEach(el => {
    el.addEventListener('click', event => event.stopPropagation())
  })

  const pageList = app.querySelector('.page-list')
  if (pageList) {
    pageList.addEventListener('scroll', () => {
      detailScrollTop = pageList.scrollTop
      void saveUiState()
    })
  }
}

async function handleAction(el) {
  await run(async () => {
    const action = el.dataset.action
    if (action === 'open-gamepad') { modal = 'gamepad'; message = ''; render(); return }
    if (action === 'gp-enabled') { gp = { ...gp, enabled: el.checked }; await saveGp(); return }
    if (action === 'gp-source') { gp = { ...gp, sources: { ...gp.sources, [el.dataset.device]: el.checked } }; await saveGp(); return }
    if (action === 'gp-seconds') {
      const s = Math.max(1, Math.min(120, Number(el.value) || 5))
      gp = { ...gp, bindings: gp.bindings.map(b => (b.action === 'rewind' || b.action === 'forward') ? { ...b, seconds: s } : b) }
      await saveGp(); return
    }
    if (action === 'gp-rebind') {
      gpCapture = { action: el.dataset.act, device: el.dataset.device }
      message = ''
      await sendBg({ type: 'osn:gamepad-capture-start' })
      render(); return
    }
    if (action === 'confirm-ok') {
      const job = pendingConfirm
      pendingConfirm = null
      render()
      if (job) await job.run()
      return
    }
    if (action === 'confirm-cancel') {
      pendingConfirm = null
      render()
      return
    }
    if (action === 'rename-game') {
      const g = state.games.find(x => x.id === el.dataset.id)
      renameTarget = { type: 'game', id: el.dataset.id, name: g?.name || '' }
      message = ''
      render()
      return
    }
    if (action === 'rename-account') {
      const a = state.accounts.find(x => x.id === el.dataset.id)
      renameTarget = { type: 'account', id: el.dataset.id, name: a?.name || '' }
      message = ''
      render()
      return
    }
    if (action === 'close-rename') {
      renameTarget = null
      render()
      return
    }
    if (action === 'submit-rename') {
      const newName = valueOf('renameInput')
      if (!newName) return
      if (renameTarget.type === 'game') await updateGame(renameTarget.id, { name: newName })
      else await renameAccount(renameTarget.id, newName)
      renameTarget = null
      message = '已改名'
      await refresh()
      return
    }
    if (action === 'open-game-modal') {
      modal = 'game'
      message = ''
      render()
      return
    }
    if (action === 'open-account-modal') {
      modal = 'account'
      message = ''
      render()
      return
    }
    if (action === 'retry-extract') {
      await extractCurrentVideo(true)
      return
    }
    if (action === 'toggle-extract-preview') {
      extracted.expanded = !extracted.expanded
      render()
      return
    }
    if (action === 'close-modal') {
      modal = ''
      render()
      return
    }
    if (action === 'close-detail') {
      detailVideoId = ''
      detailScrollTop = 0
      void saveUiState()
      render()
      return
    }
    if (action === 'add-game-from-site') {
      const game = await addGame(valueOf('newGameName'), pageLogo())
      selectedGameId = game.id
      selectedAccountId = ''
      modal = ''
      message = `已新建游戏：${game.name}`
    } else if (action === 'add-manual-game') {
      const game = await addGame(valueNear(el) || valueOf('manualGameName'), '')
      selectedGameId = game.id
      selectedAccountId = ''
      modal = ''
      message = `已新建游戏：${game.name}`
    } else if (action === 'add-account') {
      const account = await addAccount(selectedGameId, valueOf('newAccountName'))
      selectedAccountId = account.id
      modal = ''
      message = `已新建账号：${account.name}`
    } else if (action === 'add-current-video') {
      const info = extracted.info || await fetchVideoInfo(parseBvid(tab?.url || ''))
      const result = await upsertVideo(selectedAccountId, info)
      const version = valueOf('videoVersion')
      if (version) await setVideoVersion(result.video.id, version)
      detailVideoId = result.video.id
      detailScrollTop = 0
      currentPlaying = { bvid: info.bvid, page: parsePage(tab?.url || ''), videoId: result.video.id }
      extracted.expanded = false
      message = result.created ? `已添加 ${info.pages.length} 个分P` : `已更新 ${info.pages.length} 个分P`
    } else if (action === 'select-game') {
      selectedGameId = el.dataset.id
      selectedAccountId = firstAccountId(selectedGameId)
      message = ''
    } else if (action === 'select-account') {
      selectedAccountId = el.dataset.id
      message = ''
    } else if (action === 'open-detail') {
      detailVideoId = el.dataset.id
      detailScrollTop = 0
      message = ''
    } else if (action === 'set-status-button') {
      await setPageStatus(el.dataset.videoId, Number(el.dataset.page), el.dataset.status)
      await refresh(false)
      return
    } else if (action === 'open-video-page') {
      const video = state.videos.find(v => v.id === el.dataset.id)
      if (video?.url) {
        await touchVideo(video.id)
        await chrome.tabs.update({ url: videoPageUrl(video, Number(el.dataset.page || 0)) })
        window.close()
        return
      }
    } else if (action === 'delete-game') {
      const id = el.dataset.id
      askConfirm('删除这个游戏会同时删除账号、视频和分P记录，确定吗？', async () => {
        await deleteGame(id)
        message = '游戏已删除'
        await refresh()
      })
      return
    } else if (action === 'delete-account') {
      const id = el.dataset.id
      askConfirm('删除这个账号会同时删除它下面的视频记录，确定吗？', async () => {
        await deleteAccount(id)
        message = '账号已删除'
        await refresh()
      })
      return
    } else if (action === 'delete-video') {
      const id = el.dataset.id
      askConfirm('删除这个视频和它的分P记录，确定吗？', async () => {
        await deleteVideo(id)
        detailVideoId = ''
        detailScrollTop = 0
        message = '视频已删除'
        await refresh()
      })
      return
    } else if (action === 'export') {
      await exportFile()
      return
    }
    await refresh()
  })
}

async function extractCurrentVideo(force = false) {
  const bvid = parseBvid(tab?.url || '')
  if (!bvid) return
  if (!force && extracted.bvid === bvid && (extracted.info || extracted.loading)) return

  extracted = { bvid, info: null, loading: true, error: '', expanded: false }
  render()

  try {
    const info = await fetchVideoInfo(bvid)
    const changed = await updateVideoSourceInfo(bvid, info)
    if (changed) state = await getState()
    extracted = { bvid, info, loading: false, error: '', expanded: false }
  } catch (e) {
    extracted = { bvid, info: null, loading: false, error: e.message || String(e), expanded: false }
  }
  render()
}

async function hydrateVisibleUpFaces() {
  if (hydratingUpFaces || !selectedAccountId) return
  const targets = sortedVideos(state.videos.filter(v =>
    v.accountId === selectedAccountId && v.bvid && !v.upFace && !hydratedBvids.has(v.bvid)
  )).slice(0, 8)
  if (!targets.length) return

  hydratingUpFaces = true
  try {
    let changed = 0
    for (const bvid of [...new Set(targets.map(v => v.bvid))]) {
      hydratedBvids.add(bvid)
      try {
        const info = await fetchVideoInfo(bvid)
        changed += await updateVideoSourceInfo(bvid, info)
      } catch {
        // 头像是增强信息，失败时保持旧卡片可用。
      }
    }
    if (changed) await refresh()
  } finally {
    hydratingUpFaces = false
  }
}

async function run(fn) {
  try {
    setBusy(true)
    await fn()
  } catch (e) {
    message = e.message || String(e)
    render()
  } finally {
    setBusy(false)
  }
}

function setBusy(busy) {
  app.querySelectorAll('button, input, select, textarea').forEach(el => { el.disabled = busy })
}

function currentDetailScrollTop() {
  const list = app.querySelector('.page-list')
  if (list) detailScrollTop = list.scrollTop
  return detailScrollTop
}

function restoreDetailScroll(scrollTop = detailScrollTop) {
  if (!detailVideoId) return
  detailScrollTop = scrollTop
  const list = app.querySelector('.page-list')
  if (list) list.scrollTop = scrollTop
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0] || null
}

async function loadUiState() {
  const result = await chrome.storage.local.get(UI_STATE_KEY)
  return result[UI_STATE_KEY] || null
}

async function saveUiState() {
  if (!tab) return
  await chrome.storage.local.set({
    [UI_STATE_KEY]: {
      siteKey: currentSiteKey(),
      selectedGameId,
      selectedAccountId,
      detailVideoId,
      detailScrollTop,
      extractedExpanded: extracted.expanded,
      savedAt: Date.now(),
    },
  })
}

function restoreUiState(saved) {
  if (saved?.siteKey !== currentSiteKey()) {
    selectedGameId = sortedGames()[0]?.id || ''
    selectedAccountId = firstAccountId(selectedGameId)
    detailVideoId = ''
    detailScrollTop = 0
    return
  }

  selectedGameId = saved.selectedGameId || sortedGames()[0]?.id || ''
  selectedAccountId = saved.selectedAccountId || firstAccountId(selectedGameId)
  detailVideoId = saved.detailVideoId || ''
  detailScrollTop = Number(saved.detailScrollTop) || 0
  extracted.expanded = Boolean(saved.extractedExpanded)
}

function currentSiteKey() {
  try {
    return new URL(tab?.url || '').hostname
  } catch {
    return ''
  }
}

function applyCurrentPageContext() {
  const bvid = parseBvid(tab?.url || '')
  const page = parsePage(tab?.url || '')
  currentPlaying = { bvid: bvid || '', page, videoId: '' }
  if (!bvid) return

  const video = sortedVideos(state.videos.filter(v => v.bvid === bvid))[0]
  if (!video) return

  const account = state.accounts.find(a => a.id === video.accountId)
  if (account) {
    selectedGameId = account.gameId
    selectedAccountId = account.id
  }

  detailVideoId = video.id
  detailScrollTop = 0
  currentPlaying.videoId = video.id
}

function normalizeSelection() {
  if (!state.games.some(g => g.id === selectedGameId)) selectedGameId = sortedGames()[0]?.id || ''
  if (!accountsForGame(selectedGameId).some(a => a.id === selectedAccountId)) {
    selectedAccountId = firstAccountId(selectedGameId)
  }
  if (!state.videos.some(v => v.id === detailVideoId)) detailVideoId = ''
}

function summaryText() {
  const totalVideos = state.videos.length
  const totalPages = state.videos.reduce((n, v) => n + v.pages.length, 0)
  return `${totalVideos} 个视频 · ${totalPages} 个分P`
}

function accountsForGame(gameId) {
  return state.accounts.filter(a => a.gameId === gameId)
}

function firstAccountId(gameId) {
  return sortedAccountsForGame(gameId)[0]?.id || ''
}

function sortedGames() {
  return [...state.games].sort((a, b) => gameTime(b.id) - gameTime(a.id))
}

function sortedAccountsForGame(gameId) {
  return accountsForGame(gameId).sort((a, b) => accountTime(b.id) - accountTime(a.id))
}

function gameTime(gameId) {
  const accountIds = new Set(state.accounts.filter(a => a.gameId === gameId).map(a => a.id))
  return Math.max(0, ...state.videos.filter(v => accountIds.has(v.accountId)).map(videoTime))
}

function accountTime(accountId) {
  return Math.max(0, ...state.videos.filter(v => v.accountId === accountId).map(videoTime))
}

function sortedVideos(videos) {
  return [...videos].sort((a, b) => videoTime(b) - videoTime(a))
}

function videoTime(video) {
  return video.lastAccessedAt || video.lastFetchedAt || video.addedAt || 0
}

function valueOf(id) {
  return document.getElementById(id)?.value.trim() || ''
}

function valueNear(el) {
  return el.closest('.inline-form')?.querySelector('input')?.value.trim() || ''
}

function defaultGameName() {
  const title = tab?.title || domainName() || '新游戏'
  return title.replace(/\s*[-_｜|].*$/, '').trim() || domainName() || '新游戏'
}

function domainName() {
  try {
    return new URL(tab?.url || '').hostname.replace(/^www\./, '')
  } catch {
    return '当前页面'
  }
}

function pageLogo() {
  if (tab?.favIconUrl) return tab.favIconUrl
  try {
    const u = new URL(tab?.url || '')
    return `${u.origin}/favicon.ico`
  } catch {
    return ''
  }
}

function pageHint() {
  if (parseBvid(tab?.url || '')) return '当前视频页'
  return domainName()
}

function parsePage(input) {
  try {
    const url = new URL(input || '')
    return Number(url.searchParams.get('p') || '1') || 1
  } catch {
    return 1
  }
}

function isCurrentPlayingPage(videoId, page) {
  return currentPlaying.videoId === videoId && Number(currentPlaying.page) === Number(page)
}

function inferVersion(title) {
  const text = title || ''
  const patterns = [
    /(?:^|[^\d])(\d+(?:\.\d+){1,2})(?=\s*版本|版|[^.\d]|$)/,
    /(?:v|V|版本)\s*(\d+(?:\.\d+){1,2})/,
    /(\d+(?:\.\d+){1,2})\s*(?:版本|版)/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[1]
  }
  return ''
}

function progressPercent(page) {
  const current = Number(page.maxProgress) || 0
  const total = Number(page.progressDuration || page.duration) || 0
  if (!current || !total) return 0
  return Math.min(100, Math.round((current / total) * 100))
}

function formatProgress(page) {
  const current = Number(page.maxProgress) || 0
  if (!current) return ''
  const total = Number(page.progressDuration || page.duration) || 0
  const pct = progressPercent(page)
  return total ? `${formatTime(current)} / ${formatTime(total)} (${pct}%)` : formatTime(current)
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

function videoPageUrl(video, page) {
  if (!page) return video.url
  try {
    const url = new URL(video.url)
    url.searchParams.set('p', String(page))
    return url.toString()
  } catch {
    const joiner = video.url.includes('?') ? '&' : '?'
    return `${video.url}${joiner}p=${page}`
  }
}

function settleDetailScroll() {
  if (!detailVideoId) return
  if (currentPlaying.videoId === detailVideoId && currentPlaying.page) {
    scrollToPageRow(currentPlaying.page)
    return
  }
  restoreDetailScroll()
}

function scrollToPageRow(page) {
  const list = app.querySelector('.page-list')
  const row = app.querySelector(`[data-page-row="${page}"]`)
  if (!list || !row) return
  list.scrollTop = Math.max(0, row.offsetTop - list.offsetTop - 8)
  detailScrollTop = list.scrollTop
}

function editIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20.5h4L18.5 10a2.1 2.1 0 0 0-3-3L5 17.5z" /><path d="M13.5 7l3 3" /></svg>`
}

function trashIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5h9.4L17.5 7M10 10.5v5.5M14 10.5v5.5" /></svg>`
}

function openPageIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path class="screen" d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 17 17H7a2.5 2.5 0 0 1-2.5-2.5z" />
      <path class="stand" d="M9 20h6M12 17v3" />
      <path class="play" d="m10 8.5 5 2.5-5 2.5z" />
    </svg>
  `
}

function playingIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path class="screen" d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 17 17H7a2.5 2.5 0 0 1-2.5-2.5z" />
      <path class="pause" d="M9.5 8.5v5M14.5 8.5v5" />
    </svg>
  `
}

async function exportFile() {
  const payload = await exportData()
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `one-stop-service-note-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  message = '已导出 JSON 备份'
  render()
}

async function importFile(file) {
  if (!file) return
  const text = await file.text()
  await importData(JSON.parse(text), 'merge')
  message = '导入完成，已合并'
  await refresh()
}

function showFatal(e) {
  app.className = ''
  app.innerHTML = `<p class="err">加载失败：${escapeHtml(e.message || String(e))}</p>`
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]))
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}
