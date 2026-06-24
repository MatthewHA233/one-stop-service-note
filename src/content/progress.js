;(() => {
  if (window.__osnProgressTracker) return
  window.__osnProgressTracker = true

  let lastUrl = ''
  let lastSentAt = 0
  let lastSentSecond = -1

  notifyVisit()
  setInterval(tick, 3000)
  chrome.runtime.onMessage.addListener(handleGamepadAction)

  // 手柄遥控：后退 / 前进 / 播放暂停，直接操作本页 video（B站在后台也生效）
  function handleGamepadAction(msg) {
    if (!msg || msg.type !== 'osn:gamepad-action') return
    const video = document.querySelector('video')
    if (!video) return
    const sec = Number(msg.seconds) || 5
    if (msg.action === 'rewind') {
      video.currentTime = Math.max(0, video.currentTime - sec)
    } else if (msg.action === 'forward') {
      const dur = Number.isFinite(video.duration) ? video.duration : video.currentTime + sec
      video.currentTime = Math.min(dur, video.currentTime + sec)
    } else if (msg.action === 'toggle') {
      if (video.paused) video.play()
      else video.pause()
    }
  }

  function tick() {
    if (location.href !== lastUrl) notifyVisit()

    const video = document.querySelector('video')
    if (!video || !Number.isFinite(video.currentTime) || video.currentTime <= 0) return
    if (!Number.isFinite(video.duration) || video.duration <= 0) return

    const currentSecond = Math.floor(video.currentTime)
    const now = Date.now()
    if (currentSecond === lastSentSecond || now - lastSentAt < 5000) return

    lastSentSecond = currentSecond
    lastSentAt = now
    send({
      type: 'osn:video-progress',
      url: location.href,
      bvid: parseBvid(location.href),
      page: parsePage(location.href),
      currentTime: video.currentTime,
      duration: video.duration,
    })
  }

  function notifyVisit() {
    lastUrl = location.href
    lastSentSecond = -1
    send({ type: 'osn:video-visit', url: location.href })
  }

  function send(payload) {
    try {
      chrome.runtime.sendMessage(payload, () => {
        void chrome.runtime.lastError
      })
    } catch {
      // The extension context can be invalidated during reloads.
    }
  }

  function parseBvid(input) {
    const m = (input || '').match(/(BV[0-9A-Za-z]+)/)
    return m ? m[1] : ''
  }

  function parsePage(input) {
    try {
      const url = new URL(input)
      return Number(url.searchParams.get('p') || '1') || 1
    } catch {
      return 1
    }
  }
})()
