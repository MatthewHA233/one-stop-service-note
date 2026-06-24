// B 站视频信息抓取：按 BV 号调用公开 view 接口，拿到标题/UP主/封面/分P列表。
// 关键：完全不依赖各视频页千变万化的 DOM 结构。

export function parseBvid(input) {
  const m = (input || '').match(/(BV[0-9A-Za-z]+)/)
  return m ? m[1] : null
}

export async function fetchVideoInfo(bvid) {
  const id = parseBvid(bvid)
  if (!id) throw new Error('无效的 BV 号：' + bvid)

  const api = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(id)}`
  let res
  try {
    res = await fetch(api, { credentials: 'omit' })
  } catch (e) {
    throw new Error('网络请求失败，无法访问 B 站接口：' + e.message)
  }
  if (!res.ok) throw new Error(`B 站接口请求失败：HTTP ${res.status}`)

  const json = await res.json()
  if (json.code !== 0) throw new Error(`B 站接口返回错误（${json.code}）：${json.message || '未知错误'}`)

  const d = json.data
  const pages = Array.isArray(d.pages) ? d.pages : []
  return {
    bvid: d.bvid,
    aid: d.aid,
    title: d.title || '(无标题)',
    upName: d.owner?.name || '',
    upMid: d.owner?.mid,
    upFace: d.owner?.face || '',
    cover: d.pic || '',
    url: `https://www.bilibili.com/video/${d.bvid}`,
    pages: pages.map(p => ({
      page: p.page,
      cid: p.cid,
      part: p.part || `P${p.page}`,
      duration: p.duration,
    })),
  }
}
