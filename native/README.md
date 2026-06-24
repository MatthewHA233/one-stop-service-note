# native/ · 手柄遥控 native host

一个极小的 Rust exe，用 `gilrs` 读手柄，把**原始按键事件**通过 Chrome Native Messaging 发给扩展。映射、单/双击判定、操作 B 站视频全部在扩展端完成。

## 编译（免装 Visual Studio，用 cargo-xwin）

参考 `D:\my_pro\Tauri_ob\TAURI_BUILD_GUIDE.md`，核心步骤：

```powershell
# 一次性准备（若已装可跳过）
[System.Environment]::SetEnvironmentVariable("RUSTUP_HOME", "D:\dev\.rustup", "User")
[System.Environment]::SetEnvironmentVariable("CARGO_HOME", "D:\dev\.cargo", "User")
# 安装 rustup，默认工具链选 x86_64-pc-windows-msvc
cargo install cargo-xwin
```

编译本程序：

```powershell
cd native
cargo xwin build --release
# 产物：native\target\x86_64-pc-windows-msvc\release\osn-gamepad.exe
```

> 规则（同 Tauri 指南）：
> - 用 `cargo xwin build`，**不要** `cargo build`、**不要** `cargo xwin check`（后者产生数 GB 无用产物）。
> - 我们是纯 bin、无前端/WebView2，所以不需要 npm / tauri build，`cargo xwin build --release` 即可。
> - exe 体积很小（release 已开 `opt-level=z` + lto + strip）。

## 注册 native host

编译出 exe 后：

```powershell
cd native
.\install.ps1
```

脚本会生成 `com.osn.gamepad.json` 并写入注册表
`HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.osn.gamepad`，指向该 exe。

注意：`install.ps1` 里写死了扩展 ID（未打包扩展由加载路径派生、固定）。若你的扩展 ID 不同（见 `chrome://extensions`），改脚本顶部 `$extId` 再重跑。

## 协议

host → 扩展（stdout，每条 = 4 字节小端长度 + JSON）：

```json
{ "type": "ready" }
{ "type": "button", "state": "down|up", "button": "LeftThumb", "code": "<原始码>", "gamepad": "Xbox..." }
{ "type": "connected|disconnected", "gamepad": "..." }
{ "type": "error", "message": "..." }
```

`code` 是平台原始按键码，唯一、且包含扩展手柄/背键——扩展端「捕获绑定」用它，所以任意手柄任意键都能绑。

## 玩游戏时：非 XInput 手柄必须虚拟成 Xbox（重要踩坑）

实测结论：
- **Switch Pro / DualSense** 等在 Windows 是 **DirectInput/HID** 设备。这类输入**前台游戏会独占**——玩游戏时焦点在游戏，本程序（后台）用 gilrs 就读不到了。
- **XInput**（Xbox 手柄那套）不同：**多进程共享、不抢焦点**，游戏在读、本程序后台也能同时读到同一份状态。
- 所以非 XInput 手柄要在游戏里也能遥控，必须先虚拟成 Xbox（XInput）：
  - **BetterJoy / BetterJoyForCemu**（Switch Pro 实测可行，推荐）：把手柄常驻虚拟成 Xbox360。
  - 或 Steam Input 的手柄配置支持。
  - **Xbox 原生手柄**天然走 XInput，无需任何处理。
- exe 同时跑 gilrs（HID）+ XInput 两路、60ms 去重；虚拟成 Xbox 后会以 `"gamepad":"XInput Controller 0"` 上报，后台/游戏前台都能读。
