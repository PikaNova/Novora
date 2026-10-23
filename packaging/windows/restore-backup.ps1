[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BackupFile, [string]$InstallRoot = "$env:ProgramFiles\Novora", [string]$DataRoot = "$env:ProgramData\Novora")
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot "operation-progress.ps1")
Write-NovoraProgress -Stage preflight -Item "检查备份文件、配置与权限"
$backupRoot = [IO.Path]::GetFullPath((Join-Path $DataRoot 'backups'))
$target = [IO.Path]::GetFullPath($BackupFile)
if (-not $target.StartsWith($backupRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($target) -notmatch '^novora-[\w-]+\.dump$') { throw '只能恢复 Novora 备份目录内的备份文件。' }
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw '备份文件不存在。' }
$pgRestore = Join-Path $InstallRoot 'postgres\bin\pg_restore.exe'
$pgDump = Join-Path $InstallRoot 'postgres\bin\pg_dump.exe'
if (-not (Test-Path -LiteralPath $pgRestore) -or -not (Test-Path -LiteralPath $pgDump)) { throw '找不到内置 PostgreSQL 备份工具。' }
$configPath = Join-Path $DataRoot 'config\.env'
$databaseUrl = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $databaseUrl) { throw '找不到数据库连接配置。' }
$uri = [Uri](($databaseUrl -split '=', 2)[1].Trim())
$databasePort = $uri.Port
$databaseName = $uri.AbsolutePath.TrimStart('/')
$databaseUser = [Uri]::UnescapeDataString($uri.UserInfo.Split(':')[0])
$passwordPath = Join-Path $DataRoot 'config\.db-password'
if (-not (Test-Path -LiteralPath $passwordPath)) { throw '找不到数据库凭据。' }
if ($uri.Host -notin @('127.0.0.1', 'localhost') -or $databaseName -ne 'novora' -or $databaseUser -ne 'novora' -or $databasePort -le 0) { throw '恢复仅适用于安装器创建的本机 novora 数据库。' }
$wasRunning = $false
$stoppedByUs = $false
$previousPassword = $env:PGPASSWORD
# Restore rewrites the database, so hold the shared maintenance lock and pass the update gate before it.
$maintenance = Enter-NovoraMaintenance $InstallRoot
try {
  $env:PGPASSWORD = (Get-Content -LiteralPath $passwordPath -Raw).Trim()
  if ([string]::IsNullOrWhiteSpace($env:PGPASSWORD)) { throw '数据库凭据为空。' }
  Write-NovoraProgress -Stage validation -Item '检查归档结构'
  $list = Invoke-NovoraNative $pgRestore @('--list', $target) -TimeoutSeconds 300
  if ($list.ExitCode -ne 0) { throw '备份文件结构无效。' }
  $service = Get-Service -Name Novora -ErrorAction Stop
  if ($service.Status -notin @('Running', 'Stopped')) { throw '服务正在切换状态，请稍后重试恢复。' }
  $wasRunning = $service.Status -eq 'Running'
  Write-NovoraProgress -Stage service -Item '暂停业务服务'
  # sc stop only requests the transition; the bounded poll below replaces Stop-Service's unbounded pending-state wait.
  if ($wasRunning) { $stoppedByUs = $true; Request-NovoraService Novora stop; Wait-NovoraService Novora Stopped service '等待业务服务停止' 45 }
  $safetyBackup = Join-Path $backupRoot ("novora-before-restore-{0:yyyyMMdd-HHmmss}-{1}.dump" -f (Get-Date), ([Guid]::NewGuid().ToString('N').Substring(0,6)))
  New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
  Write-NovoraProgress -Stage protection -Item '创建恢复前保护备份'
  $safety = Invoke-NovoraNative $pgDump @('--host', '127.0.0.1', '--port', "$databasePort", '--username', $databaseUser, '--dbname', $databaseName, '--format', 'custom', '--no-owner', '--no-privileges', '--file', $safetyBackup) -TimeoutSeconds 1800
  if ($safety.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $safetyBackup)) { throw "恢复前保护备份创建失败，未修改数据库：$($safety.Output)" }
  # PostgreSQL restores all changes in one transaction; an error rolls back the database.
  Write-NovoraProgress -Stage restore -Item '在单个事务中恢复数据库'
  $restore = Invoke-NovoraNative $pgRestore @('--host', '127.0.0.1', '--port', "$databasePort", '--username', $databaseUser, '--dbname', $databaseName, '--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', $target) -TimeoutSeconds 1800
  if ($restore.ExitCode -ne 0) { throw "恢复失败（退出码 $($restore.ExitCode)），事务已回滚。保护备份保留在 $safetyBackup。$($restore.Output)" }
  Write-Output "数据已恢复。恢复前的保护备份保留在：$safetyBackup"
} finally {
  $env:PGPASSWORD = $previousPassword
  try {
    Write-NovoraProgress -Stage service -Item '恢复原有服务运行状态'
    if ($stoppedByUs -and $wasRunning) { Request-NovoraService Novora start; Wait-NovoraService Novora Running service '等待业务服务恢复运行' 45 }
  } finally { if ($maintenance) { $maintenance.ReleaseMutex(); $maintenance.Dispose() } }
}

