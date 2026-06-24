# 一条龙任务清单 · 项目说明（供 Claude Code / AI）

Chrome MV3 扩展 + Rust native host。扩展管理「一条龙」攻略视频的肝进度;native host 读手柄/键盘,通过 Native Messaging 让扩展遥控 B 站视频(后退/前进/暂停),玩游戏时后台也能控制。

## 构建 native host(Rust exe,免装 Visual Studio,用 cargo-xwin)

```powershell
cd native
cargo xwin build --release
# 产物: native\target\x86_64-pc-windows-msvc\release\osn-gamepad.exe
```

## 注册 native host(生成 manifest + 写注册表)

```powershell
cd native
.\install.ps1
# 注册后到 chrome://extensions 刷新扩展,service worker 会自动连 host
```

## 规则(重要)

- **Rust 编译只用 `cargo xwin build`**,不要 `cargo build`、**绝不** `cargo xwin check`(后者产生数 GB 无用产物)。产物在 `target/x86_64-pc-windows-msvc/`。
- 改了 native 代码 → 重新 `cargo xwin build --release` → 关掉旧 exe(或重载扩展让端口重连) → 重载扩展。
- 不要自动运行 `npm run dev` / 开发服务器(用户手动)。
- 扩展是**纯原生 JavaScript(ES Module)、无分号、2 空格、无构建步骤**。
- 扩展 ID(未打包,由路径派生): `bcappjpagbbakpbkpbdpibgjgnjikjea`;若变了要同步改 `native/install.ps1` 的 `$extId`。

## 关键文件

- `src/gamepad.js` — 手柄/键盘遥控逻辑(连 native、单/双击判定、按映射发动作)
- `src/background.js` — service worker,接入 gamepad + B站访问/进度记录
- `src/content/progress.js` — B站视频页:上报播放进度 + 收遥控动作操作 video
- `src/lib/storage.js` — 数据层(chrome.storage.local)
- `src/popup/` — 主界面
- `native/` — Rust native host(见 native/README.md)
- `docs/IMPLEMENTATION_SPEC.md` — 需求/技术方案
