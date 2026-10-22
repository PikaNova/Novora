[CmdletBinding()]
param(
  [string]$BackupRoot,
  [string]$InstallRoot = "$env:ProgramFiles\Novora",
  [string]$DataRoot = "$env:ProgramData\Novora",
  [ValidateRange(1,365)][int]$Keep = 14
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot "operation-progress.ps1")
# Half-finished updates leave a migrated-but-not-switched database; refuse before touching it.
Assert-NovoraUpdateReady $InstallRoot
Write-NovoraProgress -Stage preflight -Item "检查备份文件、配置与权限"
if ([string]::IsNullOrWhiteSpace($BackupRoot)) { $BackupRoot = Join-Path $DataRoot 'backups' }
if (-not $PSBoundParameters.ContainsKey('Keep')) {
  $policyPath = Join-Path $DataRoot 'config\windows-initialized.json'
  if (Test-Path -LiteralPath $policyPath) {
    $policy = Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json
    if ($null -ne $policy.settings.backupKeep) {
      $Keep = [int]$policy.settings.backupKeep
      if ($Keep -lt 1 -or $Keep -gt 365) { throw '备份保留策略无效。' }
    }
  }
}
$pgDump = Join-Path $InstallRoot 'postgres\bin\pg_dump.exe'
if (-not (Test-Path -LiteralPath $pgDump)) { throw '找不到内置 pg_dump.exe。' }
$line = Get-Content -LiteralPath (Join-Path $DataRoot 'config\.env') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $line) { throw '找不到数据库配置。' }
$uri = [Uri](($line -split '=', 2)[1].Trim())
if ($uri.Host -notin @('127.0.0.1', 'localhost') -or $uri.AbsolutePath -ne '/novora' -or [Uri]::UnescapeDataString($uri.UserInfo.Split(':')[0]) -ne 'novora' -or $uri.Port -le 0) { throw '备份仅适用于安装器创建的本机 novora 数据库。' }
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$target = Join-Path $BackupRoot ("novora-{0:yyyyMMdd-HHmmss}-{1}.dump" -f (Get-Date), ([Guid]::NewGuid().ToString('N').Substring(0,6)))
$partial = "$target.partial"
$previousPassword = $env:PGPASSWORD
$mutex = New-Object Threading.Mutex($false, 'Global\Novora.DatabaseMaintenance')
$locked = $false
try {
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw '另一个备份或恢复操作正在执行，请稍后重试。' }
  $env:PGPASSWORD = (Get-Content -LiteralPath (Join-Path $DataRoot 'config\.db-password') -Raw).Trim()
  if ([string]::IsNullOrWhiteSpace($env:PGPASSWORD)) { throw '数据库凭据为空。' }
  Write-NovoraProgress -Stage backup -Item '导出数据库备份（数据越多，耗时越长）'
  $dump = Invoke-NovoraNative $pgDump @('--host', '127.0.0.1', '--port', "$($uri.Port)", '--username', 'novora', '--dbname', 'novora', '--format', 'custom', '--no-owner', '--no-privileges', '--file', $partial) -TimeoutSeconds 1800
  if ($dump.ExitCode -ne 0) { throw "pg_dump 失败，退出码 $($dump.ExitCode)：$($dump.Output)" }
  Write-NovoraProgress -Stage backup -Item '保存备份并应用保留策略'
  Move-Item -LiteralPath $partial -Destination $target
  # Protection backups are never removed by automatic retention.
  $resolvedBackupRoot = [IO.Path]::GetFullPath($BackupRoot).TrimEnd('\')
  Get-ChildItem -LiteralPath $BackupRoot -Filter 'novora-*.dump' -File | Where-Object { $_.Name -notlike 'novora-before-restore-*' -and $_.Name -notlike 'novora-before-update-*' } | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | ForEach-Object {
    if ([IO.Path]::GetDirectoryName($_.FullName) -ne $resolvedBackupRoot) { throw '自动清理路径超出备份目录。' }
    Remove-Item -LiteralPath $_.FullName -Force
  }
  Write-NovoraProgress -Stage complete -Item '备份已保存' -Status succeeded -Current 1 -Total 1
  Write-Output "备份完成：$target"
} finally {
  $env:PGPASSWORD = $previousPassword
  if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
