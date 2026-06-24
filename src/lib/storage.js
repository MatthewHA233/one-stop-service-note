// 数据层：基于 chrome.storage.local 的不可变 CRUD。
// 存储形态：{ games: Game[], accounts: Account[], videos: Video[] }
//   Game    { id, name, logo, createdAt, updatedAt }              logo = 游戏官网 favicon 的 URL
//   Account { id, gameId, name, createdAt, updatedAt }
//   Video   { id, accountId, bvid, aid, title, version, upName, upMid, upFace, cover, url,
//             pages: [{ page, cid, part, duration, status, note, maxProgress, progressDuration, lastWatchedAt }],
//             addedAt, lastFetchedAt, lastAccessedAt }             version = 手填/自动提取版本号，如 "6.0"
//   分P 状态 status: 'todo' | 'doing' | 'done'  // 待办 / 在肝 / 已肝完

const KEY = 'osn_state'
const EMPTY = { games: [], accounts: [], videos: [] }
export const STATUSES = ['todo', 'doing', 'done']

function parseBvid(input) {
  const m = (input || '').match(/(BV[0-9A-Za-z]+)/)
  return m ? m[1] : null
}

function parsePage(input) {
  try {
    const url = new URL(input || '')
    return Number(url.searchParams.get('p') || '1') || 1
  } catch {
    return 1
  }
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export async function getState() {
  const r = await chrome.storage.local.get(KEY)
  const s = r[KEY]
  if (!s) return { ...EMPTY }
  return { games: s.games || [], accounts: s.accounts || [], videos: s.videos || [] }
}

async function setState(state) {
  await chrome.storage.local.set({ [KEY]: state })
  return state
}

// —————————————————————— 游戏 ——————————————————————
export async function addGame(name, logo = '') {
  const n = (name || '').trim()
  if (!n) throw new Error('游戏名称不能为空')
  const state = await getState()
  const now = Date.now()
  const game = { id: uid('g'), name: n, logo: logo || '', createdAt: now, updatedAt: now }
  await setState({ ...state, games: [...state.games, game] })
  return game
}

export async function updateGame(id, fields) {
  const state = await getState()
  const games = state.games.map(g => (g.id === id ? { ...g, ...fields, updatedAt: Date.now() } : g))
  await setState({ ...state, games })
}

export async function deleteGame(id) {
  const state = await getState()
  const accIds = new Set(state.accounts.filter(a => a.gameId === id).map(a => a.id))
  await setState({
    games: state.games.filter(g => g.id !== id),
    accounts: state.accounts.filter(a => a.gameId !== id),
    videos: state.videos.filter(v => !accIds.has(v.accountId)),
  })
}

// —————————————————————— 账号 ——————————————————————
export async function addAccount(gameId, name) {
  const n = (name || '').trim()
  if (!n) throw new Error('账号名称不能为空')
  const state = await getState()
  if (!state.games.some(g => g.id === gameId)) throw new Error('所属游戏不存在')
  const now = Date.now()
  const account = { id: uid('a'), gameId, name: n, createdAt: now, updatedAt: now }
  await setState({ ...state, accounts: [...state.accounts, account] })
  return account
}

export async function renameAccount(id, name) {
  const n = (name || '').trim()
  if (!n) throw new Error('账号名称不能为空')
  const state = await getState()
  const accounts = state.accounts.map(a => (a.id === id ? { ...a, name: n, updatedAt: Date.now() } : a))
  await setState({ ...state, accounts })
}

export async function deleteAccount(id) {
  const state = await getState()
  await setState({
    ...state,
    accounts: state.accounts.filter(a => a.id !== id),
    videos: state.videos.filter(v => v.accountId !== id),
  })
}

// —————————————————————— 视频 ——————————————————————
export async function findVideo(accountId, bvid) {
  const state = await getState()
  return state.videos.find(v => v.accountId === accountId && v.bvid === bvid) || null
}

// 新增或更新视频：若已存在（同账号 + 同 BV），合并分P并保留旧的状态/备注/版本号，新增分P默认待办。
export async function upsertVideo(accountId, info) {
  const state = await getState()
  if (!state.accounts.some(a => a.id === accountId)) throw new Error('目标账号不存在')
  const now = Date.now()
  const existing = state.videos.find(v => v.accountId === accountId && v.bvid === info.bvid)

  if (existing) {
    const oldByPage = new Map(existing.pages.map(p => [p.page, p]))
    const pages = info.pages.map(np => {
      const old = oldByPage.get(np.page)
      return {
        page: np.page,
        cid: np.cid,
        part: np.part,
        duration: np.duration,
        status: old?.status || 'todo',
        note: old?.note || '',
        maxProgress: old?.maxProgress || 0,
        progressDuration: old?.progressDuration || np.duration || 0,
        lastWatchedAt: old?.lastWatchedAt || 0,
      }
    })
    const updated = {
      ...existing,
      version: existing.version || '',
      aid: info.aid, title: info.title, upName: info.upName || existing.upName || '', upMid: info.upMid || existing.upMid,
      upFace: info.upFace || existing.upFace || '',
      cover: info.cover, url: info.url, pages, lastFetchedAt: now, lastAccessedAt: now,
    }
    await setState({ ...state, videos: state.videos.map(v => (v.id === existing.id ? updated : v)) })
    return { video: updated, created: false }
  }

  const video = {
    id: uid('v'), accountId,
    bvid: info.bvid, aid: info.aid, title: info.title, version: '',
    upName: info.upName, upMid: info.upMid, upFace: info.upFace || '', cover: info.cover, url: info.url,
    pages: info.pages.map(p => ({
      page: p.page,
      cid: p.cid,
      part: p.part,
      duration: p.duration,
      status: 'todo',
      note: '',
      maxProgress: 0,
      progressDuration: p.duration || 0,
      lastWatchedAt: 0,
    })),
    addedAt: now, lastFetchedAt: now, lastAccessedAt: now,
  }
  await setState({ ...state, videos: [...state.videos, video] })
  return { video, created: true }
}

export async function setVideoVersion(videoId, version) {
  const state = await getState()
  const videos = state.videos.map(v => (v.id === videoId ? { ...v, version: version || '' } : v))
  await setState({ ...state, videos })
}

export async function touchVideo(videoId) {
  const state = await getState()
  const videos = state.videos.map(v => (v.id === videoId ? { ...v, lastAccessedAt: Date.now() } : v))
  await setState({ ...state, videos })
}

export async function updateVideoSourceInfo(bvid, info) {
  const id = parseBvid(bvid || info?.bvid)
  if (!id || !info) return 0
  const state = await getState()
  let changed = 0
  const videos = state.videos.map(v => {
    if (v.bvid !== id) return v
    const oldPages = v.pages || []
    const oldByPage = new Map(oldPages.map(p => [p.page, p]))
    const pages = Array.isArray(info.pages) && info.pages.length
      ? info.pages.map(np => {
        const old = oldByPage.get(np.page)
        return {
          page: np.page,
          cid: np.cid,
          part: np.part,
          duration: np.duration,
          status: old?.status || 'todo',
          note: old?.note || '',
          maxProgress: old?.maxProgress || 0,
          progressDuration: old?.progressDuration || np.duration || 0,
          lastWatchedAt: old?.lastWatchedAt || 0,
        }
      })
      : v.pages
    const next = {
      ...v,
      aid: info.aid ?? v.aid,
      title: info.title || v.title,
      upName: info.upName || v.upName || '',
      upMid: info.upMid ?? v.upMid,
      upFace: info.upFace || v.upFace || '',
      cover: info.cover || v.cover || '',
      url: info.url || v.url,
      pages,
    }
    const sourceChanged = ['aid', 'title', 'upName', 'upMid', 'upFace', 'cover', 'url'].some(key => next[key] !== v[key])
    const pagesChanged = pages !== oldPages && pages.some((page, index) => {
      const old = oldPages[index]
      return !old || page.page !== old.page || page.cid !== old.cid || page.part !== old.part || page.duration !== old.duration
    })
    const hasChanged = sourceChanged || pages.length !== oldPages.length || pagesChanged
    if (!hasChanged) return v
    changed += 1
    return next
  })
  if (changed) await setState({ ...state, videos })
  return changed
}

export async function recordVideoVisit(url) {
  const bvid = parseBvid(url)
  if (!bvid) return { matched: 0 }
  const page = parsePage(url)
  const now = Date.now()
  const state = await getState()
  let matched = 0
  const videos = state.videos.map(v => {
    if (v.bvid !== bvid) return v
    matched += 1
    return {
      ...v,
      lastAccessedAt: now,
      lastVisitedUrl: url,
      lastVisitedPage: page,
    }
  })
  if (matched) await setState({ ...state, videos })
  return { matched, bvid, page }
}

export async function updatePageWatchProgress({ url, bvid, page, currentTime, duration }) {
  const id = bvid || parseBvid(url)
  const pageNum = Number(page || parsePage(url))
  const current = Math.max(0, Number(currentTime) || 0)
  const total = Math.max(0, Number(duration) || 0)
  if (!id || !pageNum || current <= 0) return { matched: 0 }

  const now = Date.now()
  const state = await getState()
  let matched = 0
  const videos = state.videos.map(v => {
    if (v.bvid !== id) return v
    let touched = false
    const pages = v.pages.map(p => {
      if (Number(p.page) !== pageNum) return p
      matched += 1
      touched = true
      const maxProgress = Math.max(Number(p.maxProgress) || 0, current)
      return {
        ...p,
        maxProgress,
        progressDuration: total || p.progressDuration || p.duration || 0,
        lastWatchedAt: now,
      }
    })
    return touched ? { ...v, pages, lastAccessedAt: now, lastVisitedUrl: url || v.url, lastVisitedPage: pageNum } : v
  })
  if (matched) await setState({ ...state, videos })
  return { matched, bvid: id, page: pageNum }
}

export async function deleteVideo(id) {
  const state = await getState()
  await setState({ ...state, videos: state.videos.filter(v => v.id !== id) })
}

// —————————————————————— 分P 状态 / 备注 ——————————————————————
export async function setPageStatus(videoId, page, status) {
  if (!STATUSES.includes(status)) throw new Error('无效状态：' + status)
  const state = await getState()
  const videos = state.videos.map(v =>
    v.id === videoId ? { ...v, pages: v.pages.map(p => (p.page === page ? { ...p, status } : p)) } : v
  )
  await setState({ ...state, videos })
}

export async function setPageNote(videoId, page, note) {
  const state = await getState()
  const videos = state.videos.map(v =>
    v.id === videoId ? { ...v, pages: v.pages.map(p => (p.page === page ? { ...p, note: note || '' } : p)) } : v
  )
  await setState({ ...state, videos })
}

// —————————————————————— 导出 / 导入 ——————————————————————
export async function exportData() {
  const state = await getState()
  return { app: 'one-stop-service-note', schema: 1, exportedAt: Date.now(), data: state }
}

function mergeById(a, b) {
  const map = new Map(a.map(x => [x.id, x]))
  for (const x of b) map.set(x.id, x)
  return [...map.values()]
}

export async function importData(payload, mode = 'replace') {
  const data = payload?.data
  if (!data || !Array.isArray(data.games) || !Array.isArray(data.accounts) || !Array.isArray(data.videos)) {
    throw new Error('数据格式不正确：缺少 games / accounts / videos')
  }
  if (mode === 'replace') {
    await setState({ games: data.games, accounts: data.accounts, videos: data.videos })
    return
  }
  const state = await getState()
  await setState({
    games: mergeById(state.games, data.games),
    accounts: mergeById(state.accounts, data.accounts),
    videos: mergeById(state.videos, data.videos),
  })
}
