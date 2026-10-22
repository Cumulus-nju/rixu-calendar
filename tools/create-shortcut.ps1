$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $project 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $project 'assets\icon.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop '日序.lnk'

if (-not (Test-Path $electron)) {
  throw "找不到 Electron 运行时：$electron`n请先在项目目录执行 npm install --include=dev"
}

$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($lnkPath)
$shortcut.TargetPath = $electron
$shortcut.Arguments = '"' + $project + '"'
$shortcut.WorkingDirectory = $project
if (Test-Path $icon) { $shortcut.IconLocation = "$icon,0" }
$shortcut.Description = '日序 — 把聊天里的约定，收进日程'
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Output "已创建：$lnkPath"
Write-Output "目标：$electron"
Write-Output "应用目录：$project"
