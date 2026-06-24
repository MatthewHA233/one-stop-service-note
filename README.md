# 一条龙任务清单（One-Stop Service Note）

一个 Chrome 扩展（Manifest V3），用来记录你照着 B 站「一条龙 / 全攻略」视频肝游戏的进度。按 **游戏 → 账号 → 视频 → 分P** 四级组织，数据全部保存在本地 `chrome.storage.local`，完全独立于 B 站（不登录、不使用 B 站收藏夹）。

## 功能

- **工具栏弹窗为唯一入口**：点扩展图标即可管理一切。
- **一键收录当前视频**：在 B 站视频页打开弹窗，自动抓取该视频的**全部分P**（经 `api.bilibili.com` 公开接口，不依赖页面 DOM）。
- **四级结构**：游戏（带 logo）/ 账号（如 大号、小号）/ 视频（带版本号）/ 分P。
- **分P 进度**：每个分P可标记 待办 / 在肝 / 已肝完，并写备注。
- **版本号**：给视频标记版本（如 `2.6`、`1.1~1.3`），可从标题自动推断。
- **当前播放定位**：在 B 站看视频时记录正在看的分P与播放进度，打开详情自动定位。
- **游戏 logo / UP 头像**：新建游戏时自动取当前网站 favicon；列表显示 UP 主头像。
- **导入 / 导出**：JSON 备份，跨设备迁移。

## 安装（开发模式）

1. 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择本项目根目录
4. 固定扩展图标，点击即可使用

## 使用流程

1. 在游戏官网打开扩展 → 新建游戏（自动抓 logo）
2. 新建账号（如 大号 / 小号）
3. 在 B 站「一条龙」视频页打开扩展 →「添加本页面分P」→ 选游戏 / 账号 → 创建
4. 边肝边把分P标记为 待办 / 在肝 / 已肝完，写备注
5. 通过导出备份迁移到其他设备

## 目录结构

```
manifest.json
src/
  background.js        Service Worker：抓取 B 站接口、记录访问/进度
  content/
    progress.js        B 站视频页：上报当前分P播放进度
  lib/
    bili.js            B 站接口封装（按 BV 号取分P）
    storage.js         本地存储数据层
  popup/
    popup.html / popup.js / popup.css   主界面
icons/
docs/
  IMPLEMENTATION_SPEC.md   需求 / 技术方案
```

## 技术

- Chrome Manifest V3，纯原生 JavaScript（ES Module），**无构建步骤**。
- 数据层 `chrome.storage.local`，所有写操作经 `src/lib/storage.js`。

## 许可

[MIT](LICENSE)
