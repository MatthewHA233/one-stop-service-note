# 一条龙任务清单 · 实现规格说明书（SPEC）

> **给接手开发的 AI 的说明**
> 本项目已由前一个 AI（Codex）搭出大部分骨架与功能。请**先通读现有代码再动手**。
> 本文件是「需求 + 技术方案」的权威来源:实现以这里描述的**目标态**为准;凡现有代码与本文件需求冲突,以本文件为准并修正代码。
> 标注「✅ 已确认」的是我（另一个 Claude）通过真实读取代码核实过的;标注「⚠️ 待核对」的是需要你打开对应文件确认/补全的。

---

## 0. 产品定位

一个**完全独立于 B 站、数据纯本地**的个人 Chrome 扩展(MV3),用于记录玩家照着 B 站「一条龙 / 全攻略」视频肝游戏的进度。

- 不登录 B 站、不使用 B 站收藏夹、不写入 B 站任何数据。
- 只读取视频的分P列表(经 B 站公开接口),把它当成**任务清单**。
- 组织层级:**游戏 → 账号 → 视频 → 分P**。
- 数据存 `chrome.storage.local`,换设备靠**导出/导入**迁移。

---

## 1. 核心使用场景（用户故事）

1. 在**游戏官网**打开标签页 → 点工具栏插件图标 → 新建游戏,**自动用该网站 favicon 作为游戏 logo**,网站标题预填为游戏名(可改)。
2. 在该游戏下新建一个或多个**账号**(名字自起,如「大号」「小号」「CHanGO」)。不同账号进度互相独立。
3. 打开一个 B 站「一条龙」攻略视频(通常含几十上百个分P)→ 点工具栏插件图标 → 「**添加此页面一条龙视频**」→ 选游戏/账号 → 一键抓取该视频**全部分P**,生成任务清单。
4. 给视频标一个**版本号**(如 `6.0`、`2.4`)。
5. 一边在游戏里肝,一边把每个分P标成 **待办 / 在肝 / 已肝完**,并可给分P写**备注**。
6. 看视频时,扩展记录「当前播放到哪个分P、进度多少」,方便回来时**定位继续**。
7. 换电脑:导出数据 → 新设备导入,完整还原。

---

## 2. 功能需求（逐条 · 目标态）

### 2.1 入口与导航
- **唯一入口 = 工具栏插件图标弹出的 popup**。
- ❌ 不要右下角页面悬浮按钮(早期方案,已废弃)。
- ❌ 不要独立全屏管理页。
- popup 内承载**全部**操作:添加视频、游戏/账号/视频/分P 的浏览与管理、导入导出。

### 2.2 添加视频
- popup 打开时检测**当前活动标签页**;若是 B 站视频页(URL 含 `BV` 号),顶部显示「**添加此页面一条龙视频**」。
- 抓取走 B 站公开接口(见 §4),拿到标题、UP主、封面、**全部分P**(序号/标题/cid/时长)。**不依赖页面 DOM**。
- 添加前可选择目标游戏、账号,并填版本号。
- ❌ 取消「手动输入框添加」和「粘贴链接添加」——只保留「添加当前页面视频」这一种方式。
- 重复添加同一视频(同账号+同BV)= 更新:刷新分P列表,**保留已有分P的状态/备注/版本号**,新增分P默认「待办」。

### 2.3 游戏管理
- 新建游戏:`name` + `logo`。
- **logo 来源**:新建游戏时取**当前标签页的 favicon URL**(`chrome.tabs` 的 `favIconUrl`)。即"在游戏官网新建游戏 → 自动抓该站图标"。
- 游戏名:预填当前标签页标题(去掉常见后缀如 `- 官网`、`| xxx`),**允许用户修改**。
- 支持删除游戏(级联删除其账号与视频),建议二次确认。

### 2.4 账号管理
- 游戏下可建多个账号,名字自定义。
- 账号是**进度归属维度**:同一视频在不同账号下进度独立。
- 支持删除账号(级联删除其视频)。

### 2.5 视频与版本号
- 视频隶属某账号(⚠️ 待核对:现有代码 `findVideoByBvid` 按全局 bvid 查找,需确认视频到底挂在账号下还是全局共享——见 §7)。
- 视频含**版本号**字段(手填文本,如 `6.0`)。
- 可从标题智能推断版本号预填(现有 `inferVersion(title)`),但允许手改。
- 支持从清单中移除视频。

### 2.6 分P任务（核心）
- 每个分P一行,显示 `P{序号} {分P标题}`,可点击跳转到该分P(`https://www.bilibili.com/video/{BV}?p={page}`)。
- 状态三态:`todo` 待办 / `doing` 在肝 / `done` 已肝完。
- 每个分P可写**备注**。
- 视频卡显示进度统计:已肝完 X / 总 N(百分比、进度条)。

### 2.7 播放进度 / 当前定位
- content script(`src/content/progress.js`)在 B 站视频页**每 5 秒**上报当前 `{bvid, page, currentTime, duration}`。
- 用途:在 popup 里高亮"当前正在看的视频/分P",并记录观看进度(看到 currentTime/duration)。
- ⚠️ **当前这条链路是断的**,必须接通,见 §7 待办①。

### 2.8 数据迁移(导入/导出)
- 纯本地,无后端、无云同步。
- 导出:把全部数据下载为一个 JSON 文件(文件名带时间戳)。
- 导入:用一个 JSON 备份**覆盖**当前数据(建议保留按 id 合并的可选模式)。
- ⚠️ **popup 形态限制**:在 popup 里触发系统文件选择框 / `confirm` / `alert`,会导致 **popup 失焦自动关闭**,操作中断。见 §7 待办②,接手方必须处理。

---

## 3. 当前代码现状（✅ 已真实确认部分）

### 3.1 文件树（✅ 已确认,Glob）
```
manifest.json
src/background.js              service worker
src/content/progress.js        注入 B 站视频页,上报播放进度
src/lib/storage.js             数据层(chrome.storage.local)
src/lib/bili.js                BV 解析 + B站 view 接口抓取
src/popup/popup.html           popup 容器
src/popup/popup.js             popup 主逻辑(~757 行)
src/popup/popup.css            popup 样式(~811 行)
icons/icon.svg, icon16/32/48/128.png
```

### 3.2 manifest.json（✅ 已确认）
- MV3。`permissions: ["storage","tabs"]`。
- `host_permissions: ["https://api.bilibili.com/*", "https://www.bilibili.com/video/*"]`。
- `background.service_worker = src/background.js` (`type: module`)。
- `content_scripts`: `src/content/progress.js` 注入 `https://www.bilibili.com/video/*`,`run_at: document_idle`。
- `action.default_popup = src/popup/popup.html`;图标齐全。

### 3.3 src/lib/bili.js（✅ 已确认）
- `parseBvid(input)`:正则提取 `BV...`。
- `fetchVideoInfo(bvid)`:GET `https://api.bilibili.com/x/web-interface/view?bvid=...`,返回 `{ bvid, aid, title, upName, upMid, cover, url, pages:[{page,cid,part,duration}] }`。`json.code !== 0` 抛错。

### 3.4 src/background.js（✅ 已确认,仅 13 行）
- 监听 `chrome.runtime.onMessage`,**只处理** `message.type === 'osn-fetch-video'` → 调 `fetchVideoInfo` → 回 `{ok, info}`。
- 顶部定义了常量 `KEYWORD_HINTS = ['一条龙','攻略','全收集',...]` 但此文件内**未使用**(⚠️ 用途待核对,可能预留给标题识别)。
- ⚠️ **未处理 `osn-progress` 消息**(见 §7 待办①)。

### 3.5 src/content/progress.js（✅ 已确认）
- 每 5 秒(及首帧、`osn-progress-ping` 事件、`beforeunload`)发送消息 `{ type:'osn-progress', url, bvid, page, currentTime, duration }`。
- 5 秒内同一 `bvid::page` 去重(非强制时)。

### 3.6 src/lib/storage.js（✅ 导出清单已确认 via Grep;字段部分 ⚠️ 待核对）
- 存储 key:`osn_state_v1`;形态 `{ games:[], accounts:[], videos:[] }`。
- 写入用 `commit(mutator)` **串行化**(`writeChain`),避免并发覆盖。读用 `readState`+`normalizeState`。
- 导出函数(✅ Grep 确认):
  `getState, STATUSES, addGame, updateGame, deleteGame, addAccount, renameAccount, deleteAccount, findVideo, upsertVideo, setVideoVersion, touchVideo, updateVideoSourceInfo, recordVideoVisit, updatePageWatchProgress, deleteVideo, setPageStatus, setPageNote, exportData, importData`
- `addGame(name, logo='')` → Game `{ id, name, logo, createdAt }`(✅ 确认)。
- `recordVideoVisit(url)` 与 `updatePageWatchProgress({url,bvid,page,currentTime,duration})`:**正是 `progress.js` 上报 payload 的接收处理函数**,但目前没有任何地方调用它们(链路断,见 §7)。

### 3.7 src/popup/popup.js（部分 ✅ 确认,整体 ⚠️ 待核对）
已确认实现的结构(真实读到约前 240 行):
- 顶层 import storage 的 14 个函数 + bili 的 `fetchVideoInfo/parseBvid`。
- `boot()`:`getActiveTab` → `getState` → 恢复 UI 状态(`loadUiState/restoreUiState`)→ `applyCurrentPageContext` → `render` → `extractCurrentVideo`(抓当前页分P)→ `hydrateVisibleUpFaces`(加载 UP 主头像)。
- `render()` 渲染:头部(导出按钮)、toast 提示、当前页提取区(`renderCurrentPage`/`renderExtractPreview`,含游戏/账号下拉 + 版本号输入 + 分P预览 + 创建按钮)、主页(「最近任务」+ 导入 `<input type=file>`)、游戏横栏 `game-rail`、账号横栏 `account-rail`、视频列表 `renderLibrary`、以及 game/account/detail 三种弹窗。
- UI 状态会持久化(`saveUiState`,key `osn_popup_ui_state`)。
- 详情弹窗、分P三态、备注、当前播放定位(`currentPlaying`)等在后半段(⚠️ 接手方逐行核对)。
- ⚠️ 注意:`render()` 用 `innerHTML` 重建,导入用 `<input type="file">`——在 popup 里点它会弹系统文件框导致 popup 关闭(见 §7 待办②)。

---

## 4. 数据模型（目标态）

> key:`osn_state_v1`,形态 `{ games, accounts, videos }`。字段以 `storage.js` 实际实现为准,以下为目标结构,接手方据此对齐。

```
Game    { id, name, logo, createdAt }                         // logo = 游戏官网 favicon URL
Account { id, gameId, name, createdAt }
Video   { id, accountId, bvid, aid, title, version,
          upName, upMid, cover, url,
          pages: Page[],
          addedAt, lastFetchedAt,
          lastVisitedAt?, lastPage?, ... }                    // 访问/播放相关字段，⚠️ 待核对实际命名
Page    { page, cid, part, duration,
          status: 'todo'|'doing'|'done',
          note,
          watchedTime?, watchDuration? }                      // 观看进度，⚠️ 待核对实际命名
```

抓取分P:见 §3.3 `fetchVideoInfo`。

---

## 5. 技术架构与消息流（目标态）

```
[popup.js]  主界面/唯一交互入口
   │  直接 import 调用 storage.js（CRUD/导入导出）
   │  直接 import 调用 bili.js（抓当前页分P）或经 background 转发
   │  chrome.tabs.query 拿当前标签 url/title/favIconUrl
   │
[background.js]  service worker
   │  收 'osn-fetch-video' → fetchVideoInfo → 回 info
   │  ❗应收 'osn-progress' → storage.recordVideoVisit / updatePageWatchProgress（待接通）
   │
[content/progress.js]  注入 B 站视频页
   │  每5秒发 'osn-progress' {bvid,page,currentTime,duration}
   │
[storage.js]  chrome.storage.local（key osn_state_v1，串行写）
[bili.js]     B站 view 接口抓取
```

技术约束:
- MV3,**纯原生 JS,无构建步骤**(直接 `加载已解压的扩展程序`)。
- 扩展页面(popup)/background 有 `host_permissions`,可跨域 fetch B 站接口,不受页面 CORS 限制。
- content script 在 B 站页面内,受页面 CORS 限制,故抓取应交给 background/popup。

---

## 6. 各文件职责（目标态）

| 文件 | 职责 |
|---|---|
| `manifest.json` | MV3 配置:popup 入口、background、content script、权限、图标 |
| `src/popup/popup.{html,js,css}` | 唯一交互界面:添加视频、游戏/账号/视频/分P 管理、导入导出、当前播放定位 |
| `src/background.js` | 代发 B 站抓取(`osn-fetch-video`);**接收并落库播放进度(`osn-progress`)** |
| `src/content/progress.js` | B 站视频页上报当前分P播放进度 |
| `src/lib/storage.js` | `chrome.storage.local` 数据层:CRUD、进度记录、导入导出,串行写 |
| `src/lib/bili.js` | BV 解析、view 接口抓取分P |
| `icons/*` | 扩展与工具栏图标 |

---

## 7. 已知问题与待办（重点 · 接手方必做）

**① 播放进度链路断开(高优先级)**
`content/progress.js` 持续发送 `osn-progress` 消息,但 `background.js` 只处理 `osn-fetch-video`,**没有任何接收方**调用 `storage.recordVideoVisit` / `updatePageWatchProgress`。
→ 在 `background.js` 增加对 `osn-progress` 的监听,调用对应 storage 函数落库;popup 再据此显示「当前播放定位 / 观看进度」。

**② popup 的文件选择 / 原生弹窗会关闭 popup(高优先级)**
popup 失焦即关闭。现有导入用 `<input type="file">`、删除可能用 `confirm`——都会中断操作。
→ 删除/覆盖确认改为**popup 内联确认 UI**(不要 `confirm/alert`);导入改为**粘贴 JSON 文本**或可靠的文件读取方案;导出下载一般可用,需实测。

**③ 视频归属语义需明确(待核对 + 决策)**
`storage.findVideoByBvid` 按**全局 bvid** 查找,但需求是「同一视频在不同账号下进度独立」。
→ 核对 `upsertVideo` 是否按 `accountId+bvid` 唯一;确保不同账号能各自收录同一视频且进度独立。**目标:进度归属到账号。**

**④ favicon 作 logo 的存储方式(待决策)**
当前 logo 存 favicon **URL** 字符串。优点简单;缺点离线/换设备后图标可能失效。
→ MVP 可接受存 URL;若要更稳,后续转 base64(注意跨域 canvas 污染问题)。

**⑤ `KEYWORD_HINTS` 用途**(`background.js` 定义未用)——核对是否该用于「这是不是一条龙视频」的提示/过滤,或删除。

---

## 8. UI / 交互规格（目标态,以现有 popup 实现为基准微调）

- popup 尺寸约 `520×600`(现有 css)。
- 顶部:品牌名 + 当前页提示 + 导出入口。
- 当前页是 B 站视频时:展示提取区(封面、标题、分P数;展开后选游戏/账号、填版本号、创建)。
- 主体「最近任务」:游戏横向标签栏(带 logo)→ 账号横向 chip → 视频列表(封面、标题、版本号 tag、进度)。
- 视频详情弹窗:分P列表(P号+标题、三态切换、备注、跳转链接、观看进度),版本号编辑。
- 新建游戏/账号弹窗。
- 所有删除/覆盖操作用**内联确认**,禁止 `confirm/alert/prompt`(popup 会关)。

---

## 9. 约束与非目标

- **非目标**:B 站登录/收藏夹集成、云端同步、后端服务、多人协作。
- **约束**:纯本地、纯原生 JS 无构建、数据可一键导出迁移、抓取不依赖页面 DOM。
- 语言:界面中文。

---

## 10. 验收清单

- [ ] 在游戏官网新建游戏 → 自动带上该站 favicon 作 logo,名字可改。
- [ ] 在 B 站视频页点插件 → 「添加此页面一条龙视频」→ 选游戏/账号/版本号 → 成功抓取全部分P。
- [ ] 同一视频在不同账号下进度互相独立。
- [ ] 分P 可切 待办/在肝/已肝完,可写备注,视频卡进度统计正确。
- [ ] 看视频时进度被记录,popup 能显示「当前播放定位」。
- [ ] 导出得到 JSON 文件;在另一处导入能完整还原(且不会因 popup 关闭而中断)。
- [ ] 删除游戏/账号/视频有内联确认且级联正确;全程无 `confirm/alert` 导致的 popup 关闭。
- [ ] 扩展可直接「加载已解压」运行,无控制台报错。

---

## 11. 附:游戏官网结构实测（用于"新建游戏自动抓 logo + 名字"）

**实测样本:原神官网**（✅ 用浏览器真实读取 `https://ys.mihoyo.com/`）
- `document.title` = `"原神 - 米哈游游戏库"` → 按分隔符取首段得游戏名 **"原神"**。
- favicon:页面仅一个 `<link rel="shortcut icon" href="https://ys.mihoyo.com/favicon.ico?v=1.0">`。
- **没有** `og:site_name` / `og:title` / `og:image` / `apple-touch-icon` / `application-name`。
- 即:该站只有一个经典小 favicon,**没有高清大 logo 可抓**。

由此确定的"新建游戏"实现算法(接手方按此实现):

**① 游戏名预填**
```js
const guessGameName = title => (title || '').split(/[-|_—–·:：｜]/)[0].trim()
// "原神 - 米哈游游戏库" → "原神"
```
预填到输入框,**必须允许用户修改**(各官网 title 格式不一,不能纯自动)。

**② logo 抓取(按优先级)**
1. `chrome.tabs.query({active:true,currentWindow:true})` → `tab.favIconUrl`(浏览器已解析的图标,最可靠;原神场景即 favicon.ico)。
2. 兜底:页面 `link[rel*="icon" i]` 的 `href`。
3. 再兜底:`new URL('/favicon.ico', location.origin).href`。

**③ 存储与显示**
- 存 favicon **URL 字符串**(如 `https://ys.mihoyo.com/favicon.ico?v=1.0`)。
- 显示用 `<img>` 小圆图标(favicon 16/32px,列表够用);加载失败回退到"游戏名首字"占位(现有 `glogo-ph`)。
- **不要依赖 og:image**(多数游戏官网没有);logo 以小 favicon 为准。

**结论**:`tab.favIconUrl` + `title 首段(可改)` 这套对原神官网完全可行,作为"新建游戏"的默认实现。
```
