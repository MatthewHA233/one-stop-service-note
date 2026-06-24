# 注册 / 更新 一条龙清单 手柄遥控 native messaging host
# 用法：在 native\ 目录下，先 `cargo xwin build --release`，再运行本脚本。
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe  = Join-Path $here "target\x86_64-pc-windows-msvc\release\osn-gamepad.exe"

if (-not (Test-Path $exe)) {
  Write-Error "未找到 exe，请先在 native\ 下运行：cargo xwin build --release`n期望路径：$exe"
  exit 1
}

$hostName = "com.osn.gamepad"
# 未打包扩展(load unpacked)的 ID 由加载路径派生、固定不变。
# 若你的扩展 ID 不是这个(chrome://extensions 可看)，改这里再重跑。
$extId = "bcappjpagbbakpbkpbdpibgjgnjikjea"

$manifest = [ordered]@{
  name            = $hostName
  description     = "One-Stop Service Note gamepad remote native host"
  path            = $exe
  type            = "stdio"
  allowed_origins = @("chrome-extension://$extId/")
} | ConvertTo-Json -Depth 5

$manifestPath = Join-Path $here "$hostName.json"
# Chrome 要求 UTF-8 无 BOM
[System.IO.File]::WriteAllText($manifestPath, $manifest, (New-Object System.Text.UTF8Encoding $false))

$regKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
New-Item -Path $regKey -Force | Out-Null
Set-ItemProperty -Path $regKey -Name "(Default)" -Value $manifestPath

Write-Host "已注册 native host：" -ForegroundColor Green
Write-Host "  manifest : $manifestPath"
Write-Host "  exe      : $exe"
Write-Host "  扩展 ID  : $extId"
Write-Host ""
Write-Host "如果扩展重新加载后 ID 变了，改本脚本顶部的 `$extId 再重跑本脚本。"
