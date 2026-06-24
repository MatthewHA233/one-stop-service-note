import { fetchVideoInfo, parseBvid } from './lib/bili.js'
import { recordVideoVisit, updatePageWatchProgress, updateVideoSourceInfo } from './lib/storage.js'
import { initGamepad, handleGamepadCommand } from './gamepad.js'

initGamepad()
chrome.runtime.onStartup.addListener(() => initGamepad())

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url || ''
  if (!url.includes('bilibili.com/video/')) return
  recordVideoVisitAndSourceInfo(url).catch(console.error)
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(data => sendResponse({ ok: true, data }))
    .catch(error => sendResponse({ ok: false, error: error.message || String(error) }))
  return true
})

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') throw new Error('空消息')

  const gp = handleGamepadCommand(msg)
  if (gp !== null) return gp

  if (msg.type === 'osn:video-visit') {
    return recordVideoVisitAndSourceInfo(msg.url || '')
  }

  if (msg.type === 'osn:video-progress') {
    return updatePageWatchProgress(msg)
  }

  throw new Error('未知消息：' + msg.type)
}

async function recordVideoVisitAndSourceInfo(url) {
  const visit = await recordVideoVisit(url)
  if (!visit.matched) return visit

  const bvid = visit.bvid || parseBvid(url)
  if (!bvid) return visit

  try {
    const info = await fetchVideoInfo(bvid)
    const sourceUpdated = await updateVideoSourceInfo(bvid, info)
    return { ...visit, sourceUpdated }
  } catch (error) {
    console.warn('刷新视频元信息失败：', error)
    return { ...visit, sourceUpdated: 0 }
  }
}
