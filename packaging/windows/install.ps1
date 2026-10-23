[CmdletBinding()]
param(
  [string]$InstallRoot = "$env:ProgramFiles\Novora",
  [string]$DataRoot = "$env:ProgramData\Novora",
  [int]$Port = 3000,
  [string]$DatabasePort = "55432",
  [string]$AdminPassword,
  [switch]$NoTray,
  [switch]$NoInitialize,
  [switch]$NoShortcuts,
  [switch]$Quiet,
  [switch]$LockAlreadyHeld
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "operation-progress.ps1")
$maintenance = $null
$logDirectory = Join-Path $DataRoot "logs"
trap {
  $message = Protect-NovoraMessage $_.Exception.Message
  Write-NovoraProgress -Stage $script:NovoraStage -Item $script:NovoraItem -Status failed -Message $message
  Write-Host "安装失败：$message" -ForegroundColor Red
  try {
    if (-not $Quiet) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("Novora 安装失败：$message`n`n详细日志：$logDirectory\installer.log", "Novora 安装", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    }
  } catch { }
  try { Stop-Transcript | Out-Null } catch { }
  if ($maintenance) { $maintenance.ReleaseMutex(); $maintenance.Dispose(); $maintenance = $null }
  exit 1
}
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
Start-Transcript -Path (Join-Path $logDirectory "installer.log") -Append | Out-Null
$serviceName = "Novora"
$postgresServiceName = "NovoraPostgreSQL"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Assert-Administrator {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "请以管理员身份运行安装程序。"
  }
}

function New-Shortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$WorkingDirectory, [string]$IconLocation) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $Target
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.IconLocation = $IconLocation
  $shortcut.Description = 'Novora 学校服务端'
  $shortcut.Save()
  [Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) | Out-Null
  [Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
}

Write-NovoraProgress -Stage preflight -Item '检查管理员权限与安装目录'
Assert-Administrator
if (-not $LockAlreadyHeld) { $maintenance = Enter-NovoraMaintenance $InstallRoot }
Assert-NovoraUpdateReady $InstallRoot
Assert-NovoraFullInstall $InstallRoot
Assert-NovoraServicePath Novora (Join-Path $InstallRoot 'NovoraServiceHost.exe')
Assert-NovoraServicePath NovoraPostgreSQL (Join-Path $InstallRoot 'postgres\bin\pg_ctl.exe') (Join-Path $DataRoot 'postgres-data')
if ($Port -lt 1 -or $Port -gt 65535 -or $DatabasePort -notmatch '^\d+$' -or [int]$DatabasePort -lt 1 -or [int]$DatabasePort -gt 65535 -or [int]$DatabasePort -eq 5432) { throw '服务或独立数据库端口无效。' }
New-Item -ItemType Directory -Force -Path $InstallRoot, "$DataRoot\config", "$DataRoot\logs", "$DataRoot\backups" | Out-Null

# Stop owned services before replacing application files; initialization owns provisioning.
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
  Write-NovoraProgress -Stage service -Item '停止原有 Novora 服务'
  if ((Get-Service -Name $serviceName -ErrorAction Stop).Status -ne 'Stopped') { Request-NovoraService $serviceName stop }
  Wait-NovoraService $serviceName 'Stopped' 'service' '等待原有 Novora 服务停止' 30
}

# 托盘是单实例进程：升级时若不先结束旧托盘，新装好的托盘会因为占用锁而直接退出，
# 用户看到的仍是旧版本的菜单。
$installPrefix = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\') + '\'
Get-Process -Name NovoraTray, NovoraLauncher -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -and $_.Path.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)
} | Stop-Process -Force -ErrorAction Stop

$launcherExe = Join-Path $InstallRoot "NovoraLauncher.exe"
$iconFile = Join-Path $InstallRoot "favicon.ico"
if (-not (Test-Path -LiteralPath $launcherExe)) { throw "缺少 Windows 启动器：$launcherExe" }
foreach ($name in @($postgresServiceName)) {
  $existing = Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($existing -and $existing.Status -ne 'Stopped') {
    Write-NovoraProgress -Stage service -Item ("停止原有 " + $name)
    Request-NovoraService $name stop
    Wait-NovoraService $name 'Stopped' 'service' ("等待 " + $name + " 停止") 30
  }
}
Write-NovoraProgress -Stage shortcuts -Item '配置快捷方式与启动入口'

if (-not $NoShortcuts) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $startMenu = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Novora'
  $startup = [Environment]::GetFolderPath('Startup')
  New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
  New-Shortcut (Join-Path $desktop 'Novora.lnk') $launcherExe '' $InstallRoot $iconFile
  New-Shortcut (Join-Path $startMenu 'Novora.lnk') $launcherExe '' $InstallRoot $iconFile
  New-Shortcut (Join-Path $startMenu 'Novora 托盘.lnk') $launcherExe '--tray-host' $InstallRoot $iconFile
  if (-not $NoTray) { New-Shortcut (Join-Path $startup 'Novora 托盘.lnk') $launcherExe '--tray-host' $InstallRoot $iconFile }
}

if (-not $NoTray -and (Test-Path $launcherExe)) {
  # install.ps1 asserts administrator, so a direct child would keep the elevated token.
  if (-not (Start-NovoraUserInterface -Target $launcherExe -Arguments '--tray-host' -WorkingDirectory $InstallRoot)) {
    Write-Warning '未能交给 Windows 资源管理器启动托盘，本次已按当前权限直接启动；重新登录后会按登录启动托盘。'
    Start-Process -FilePath $launcherExe -ArgumentList '--tray-host' -WorkingDirectory $InstallRoot
  }
}
if (-not $NoInitialize -and (Test-Path $launcherExe)) {
  if (-not (Start-NovoraUserInterface -Target $launcherExe -Arguments '--windows-setup' -WorkingDirectory $InstallRoot)) {
    Write-Warning '未能交给 Windows 资源管理器启动初始化向导，本次已按当前权限直接启动。'
    Start-Process -FilePath $launcherExe -ArgumentList '--windows-setup' -WorkingDirectory $InstallRoot
  }
}
Write-NovoraProgress -Stage complete -Item '基础安装完成，等待初始化配置与注册服务' -Status succeeded -Current 1 -Total 1
Write-Host "Novora 基础文件已安装。请运行初始化以准备数据库、注册并验证服务。"
try { Stop-Transcript | Out-Null } catch { }
if ($maintenance) { $maintenance.ReleaseMutex(); $maintenance.Dispose(); $maintenance = $null }
