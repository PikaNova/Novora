[CmdletBinding()]
param(
  [string]$InstallRoot = "$env:ProgramFiles\Novora",
  [switch]$PurgeData,
  [switch]$LockAlreadyHeld
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'operation-progress.ps1')
$UninstallResidue = @()
function Get-NovoraRemovalReason {
  param($Failure)
  # Win32 codes survive locale differences: 5 = access denied, 32/33 = file or region locked.
  for ($exception = $Failure.Exception; $null -ne $exception; $exception = $exception.InnerException) {
    switch ($exception.HResult -band 0xFFFF) {
      5 { return '权限不足' }
      32 { return '文件被占用' }
      33 { return '文件被占用' }
    }
  }
  return ($Failure.Exception.Message -split '\r?\n' | Select-Object -First 1)
}
function Remove-NovoraUninstallPath {
  param([string]$Description, [string]$LiteralPath, [switch]$Recurse)
  if (-not (Test-Path -LiteralPath $LiteralPath)) { return }
  $failure = $null
  try { Remove-Item -LiteralPath $LiteralPath -Force -Recurse:$Recurse -ErrorAction Stop } catch { $failure = $_ }
  if (-not (Test-Path -LiteralPath $LiteralPath)) { return }
  $reason = if ($failure) { Get-NovoraRemovalReason $failure } else { '删除后路径仍存在，可能有进程持有句柄' }
  $script:UninstallResidue += "$Description（$LiteralPath）未能删除：$reason"
}
$maintenance = $null
if (-not $LockAlreadyHeld) { $maintenance = Enter-NovoraMaintenance $InstallRoot }
Assert-NovoraUpdateReady $InstallRoot
try {
Assert-NovoraServicePath Novora (Join-Path $InstallRoot 'NovoraServiceHost.exe')
Assert-NovoraServicePath NovoraPostgreSQL (Join-Path $InstallRoot 'postgres\bin\pg_ctl.exe') (Join-Path $env:ProgramData 'Novora\postgres-data')
Write-NovoraProgress -Stage uninstall -Item '停止 Novora 服务与独立数据库'
$serviceName = "Novora"
$postgresServiceName = "NovoraPostgreSQL"
$logDirectory = Join-Path $env:ProgramData 'Novora\logs'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
try { Start-Transcript -Path (Join-Path $logDirectory 'uninstall.log') -Append | Out-Null } catch { }
$installPrefix = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\') + '\'
Get-Process -Name NovoraTray, NovoraLauncher -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction Stop
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')
$startMenu = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Novora'
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
  Request-NovoraService $serviceName stop
}
if (Get-Service -Name $postgresServiceName -ErrorAction SilentlyContinue) {
  Request-NovoraService $postgresServiceName stop
}
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  $novoraState = (Get-Service -Name $serviceName -ErrorAction SilentlyContinue).Status
  $postgresState = (Get-Service -Name $postgresServiceName -ErrorAction SilentlyContinue).Status
  if (($null -eq $novoraState -or $novoraState -eq 'Stopped') -and ($null -eq $postgresState -or $postgresState -eq 'Stopped')) { break }
  Write-NovoraProgress -Stage uninstall -Item "等待服务停止" -TimeoutSeconds 30
  Start-Sleep -Milliseconds 500
}

if (($novoraState -and $novoraState -ne 'Stopped') -or ($postgresState -and $postgresState -ne 'Stopped')) { throw '服务停止超时，未移除服务或数据库文件。' }
Write-NovoraProgress -Stage uninstall -Item '移除服务注册与系统入口'
foreach ($name in @($serviceName, $postgresServiceName)) {
  $deleted = Invoke-NovoraNative "$env:SystemRoot\System32\sc.exe" @('delete', $name)
  if ($deleted.ExitCode -notin @(0,1060)) { throw "服务 $name 移除失败（代码 $($deleted.ExitCode)）。" }
}

# 清理可能脱离 Windows 服务树运行的内嵌 Node.js/PostgreSQL 进程。
# 只匹配安装目录下的可执行文件或命令行，避免影响机器上的其它开发环境。
$installPrefix = ([IO.Path]::GetFullPath($InstallRoot)).TrimEnd('\') + '\'
Get-CimInstance Win32_Process -Filter "Name = 'NovoraServiceHost.exe' OR Name = 'node.exe' OR Name = 'postgres.exe' OR Name = 'pg_ctl.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    ($_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath)).StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)) -or
    ($_.CommandLine -and $_.CommandLine.IndexOf($InstallRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0)
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$processDeadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $processDeadline) {
  $remaining = @(Get-CimInstance Win32_Process -Filter "Name = 'NovoraServiceHost.exe' OR Name = 'node.exe' OR Name = 'postgres.exe' OR Name = 'pg_ctl.exe' OR Name = 'NovoraLauncher.exe' OR Name = 'NovoraTray.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath)).StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)) -or
      ($_.CommandLine -and $_.CommandLine.IndexOf($InstallRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
  if ($remaining.Count -eq 0) { break }
  $remaining | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
}
# 先释放自身日志句柄，否则 -PurgeData 一定删不掉 ProgramData\Novora\logs\uninstall.log。
try { Stop-Transcript | Out-Null } catch { }
if (Get-NetFirewallRule -DisplayName "Novora LAN Server" -ErrorAction SilentlyContinue) {
  try { Remove-NetFirewallRule -DisplayName "Novora LAN Server" -ErrorAction Stop }
  catch { $script:UninstallResidue += "防火墙规则 Novora LAN Server 未能删除：$(Get-NovoraRemovalReason $_)" }
}
if (Get-ScheduledTask -TaskName 'Novora Daily Backup' -ErrorAction SilentlyContinue) {
  try { Unregister-ScheduledTask -TaskName 'Novora Daily Backup' -Confirm:$false -ErrorAction Stop }
  catch { $script:UninstallResidue += "计划任务 Novora Daily Backup 未能删除：$(Get-NovoraRemovalReason $_)" }
}
foreach ($shortcut in @((Join-Path $desktop 'Novora.lnk'), (Join-Path $startup 'Novora 托盘.lnk'), (Join-Path $startMenu 'Novora.lnk'), (Join-Path $startMenu 'Novora 托盘.lnk'))) {
  Remove-NovoraUninstallPath '快捷方式' $shortcut
}
Remove-NovoraUninstallPath '开始菜单目录' $startMenu -Recurse
if ($PurgeData) { Remove-NovoraUninstallPath '业务数据目录' "$env:ProgramData\Novora" -Recurse }
if ($UninstallResidue.Count) {
  foreach ($entry in $UninstallResidue) { Write-Warning "卸载残留：$entry" }
  $detail = "Novora 服务与系统入口已移除，但有 $($UninstallResidue.Count) 项残留（文件被占用或权限不足）：$($UninstallResidue -join '；')。请关闭占用程序或以管理员身份重试后手动清理。"
  Write-Warning $detail
  # 升级流程只把进度快照里的失败原因显示给操作员，退出码本身没有细节。
  Write-NovoraProgress -Stage uninstall -Item '移除服务注册与系统入口' -Status failed -Message $detail
  exit 1
}
Write-Host "Novora 服务、内嵌 Node.js/PostgreSQL 和托盘已停止并移除。默认保留数据；使用 -PurgeData 才会删除业务数据。"

} finally { if ($maintenance) { $maintenance.ReleaseMutex(); $maintenance.Dispose() } }
