[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [string]$DesktopPath
)
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $InstallRoot 'NovoraLauncher.exe'
$icon = Join-Path $InstallRoot 'favicon.ico'
if (-not (Test-Path $launcher)) { throw "找不到 Novora 启动程序：$launcher" }
function New-Shortcut([string]$Path, [string]$Target, [string]$Arguments = '') {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $Target
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $InstallRoot
  $shortcut.IconLocation = $icon
  $shortcut.Description = 'Novora 学校服务端'
  $shortcut.Save()
  [Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) | Out-Null
  [Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
}
if ([string]::IsNullOrWhiteSpace($DesktopPath)) { $DesktopPath = [Environment]::GetFolderPath('Desktop') }
$logDir = Join-Path $env:ProgramData 'Novora\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Start-Transcript -Path (Join-Path $logDir 'shortcuts.log') -Append | Out-Null
$desktop = $DesktopPath
New-Item -ItemType Directory -Force -Path $desktop | Out-Null
$menu = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Novora'
New-Item -ItemType Directory -Force -Path $menu | Out-Null
New-Shortcut (Join-Path $desktop 'Novora.lnk') $launcher
New-Shortcut (Join-Path $menu 'Novora.lnk') $launcher
$trayArgs = '--tray-host'
New-Shortcut (Join-Path $menu 'Novora 托盘.lnk') $launcher $trayArgs
$startup = [Environment]::GetFolderPath('Startup')
New-Shortcut (Join-Path $startup 'Novora 托盘.lnk') $launcher $trayArgs
Write-Host 'Novora 快捷方式已创建。'
Stop-Transcript | Out-Null
