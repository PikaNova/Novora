#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'Stop'
$InstallRoot = (Resolve-Path -LiteralPath $InstallRoot).Path
$pg = Join-Path $InstallRoot 'postgres/bin'
$root = Join-Path $env:TEMP ('novora-backups-' + [Guid]::NewGuid().ToString('N'))
$cluster = Join-Path $root 'cluster'
$data = Join-Path $root 'data'
$previousPassword = $env:PGPASSWORD
$started = $false
$serviceCalls = @{stops=0; starts=0}
function Assert($condition, $description) { if (-not $condition) { throw $description }; Write-Output "PASS: $description" }
function Sql($query) {
  $answer = & "$pg/psql.exe" -X -h 127.0.0.1 -p $port -U novora -d novora -v ON_ERROR_STOP=1 -t -A -c $query
  if ($LASTEXITCODE -ne 0) { throw 'Test SQL failed' }; return $answer
}
# SCM is mocked; PostgreSQL tools and transactions run against a new isolated cluster.
function Get-Service {
  param($Name, $ErrorAction)
  $service = [pscustomobject]@{Status='Running'}
  $service | Add-Member ScriptMethod WaitForStatus { param($status, $timeout) }
  return $service
}
function Stop-Service { param($Name, [switch]$Force); $serviceCalls.stops++ }
function Start-Service { param($Name, $ErrorAction); $serviceCalls.starts++ }
try {
  New-Item -ItemType Directory -Force -Path "$data/config", "$data/backups" | Out-Null
  $password = [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText("$root/password", $password)
  & "$pg/initdb.exe" -D $cluster -U novora --pwfile "$root/password" --auth=scram-sha-256 --encoding=UTF8 --locale=C *> "$root/init.log"
  Assert ($LASTEXITCODE -eq 0) 'isolated initdb'
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
  & "$pg/pg_ctl.exe" -D $cluster -o "-p $port -h 127.0.0.1" -l "$root/postgres.log" -w start
  Assert ($LASTEXITCODE -eq 0) 'isolated PostgreSQL started'
  $started = $true; $env:PGPASSWORD = $password
  & "$pg/createdb.exe" -h 127.0.0.1 -p $port -U novora novora
  Assert ($LASTEXITCODE -eq 0) 'isolated database created'
  Set-Content "$data/config/.env" "DATABASE_URL=postgresql://novora:unused@127.0.0.1:$port/novora"
  Set-Content "$data/config/.db-password" $password
  Sql "create table backup_probe(value text); insert into backup_probe select md5(i::text) from generate_series(1,10000) i;" | Out-Null
  & "$PSScriptRoot/backup.ps1" -InstallRoot $InstallRoot -DataRoot $data -Keep 2 | Out-Null
  $backup = Get-ChildItem "$data/backups/novora-*.dump" | Select-Object -First 1
  Assert ($backup.Length -gt 10000) 'real backup contains test data'
  & "$PSScriptRoot/validate-backup.ps1" -BackupFile $backup.FullName -InstallRoot $InstallRoot -DataRoot $data | Out-Null
  Sql 'truncate backup_probe' | Out-Null
  & "$PSScriptRoot/restore-backup.ps1" -BackupFile $backup.FullName -InstallRoot $InstallRoot -DataRoot $data | Out-Null
  Assert ((Sql 'select count(*) from backup_probe') -eq '10000') 'real restore recovers rows'
  Assert ($serviceCalls.stops -eq 1 -and $serviceCalls.starts -eq 1) 'service lifecycle on success'
  $bad = "$data/backups/novora-corrupt.dump"
  $bytes = [IO.File]::ReadAllBytes($backup.FullName)
  [IO.File]::WriteAllBytes($bad, $bytes[0..($bytes.Length - 1000)])
  & "$pg/pg_restore.exe" --list $bad *> "$root/toc.log"
  Assert ($LASTEXITCODE -eq 0) 'corrupt fixture retains readable TOC'
  Sql 'truncate backup_probe' | Out-Null
  $failed = $false
  try { & "$PSScriptRoot/restore-backup.ps1" -BackupFile $bad -InstallRoot $InstallRoot -DataRoot $data *> "$root/restore-failure.log" } catch { $failed = $true }
  Assert $failed 'corrupt data rejected by restore'
  Assert ((Sql 'select count(*) from backup_probe') -eq '0') 'failed restore rolls back database'
  Assert ($serviceCalls.stops -eq 2 -and $serviceCalls.starts -eq 2) 'service restarted after failure'
  & "$PSScriptRoot/remove-backup.ps1" -BackupFile $bad -InstallRoot $InstallRoot -DataRoot $data | Out-Null
  Assert (-not (Test-Path -LiteralPath $bad)) 'selected backup deletion'
  foreach ($name in 'validate-backup','remove-backup','restore-backup') {
    $rejected = $false
    try { & "$PSScriptRoot/$name.ps1" -BackupFile "$root/novora-outside.dump" -InstallRoot $InstallRoot -DataRoot $data | Out-Null } catch { $rejected = $true }
    Assert $rejected "$name rejects external paths"
  }
  Copy-Item -LiteralPath $backup.FullName -Destination (Join-Path $data 'backups/novora-before-update-fixture.dump')
  1..3 | ForEach-Object { & "$PSScriptRoot/backup.ps1" -InstallRoot $InstallRoot -DataRoot $data -Keep 2 | Out-Null }
  Assert (@(Get-ChildItem "$data/backups/novora-*.dump" | Where-Object { $_.Name -notlike 'novora-before-restore-*' -and $_.Name -notlike 'novora-before-update-*' }).Count -eq 2) 'normal backup retention'
  Assert (@(Get-ChildItem "$data/backups/novora-before-restore-*.dump").Count -eq 2) 'protection backups retained'
  Assert (Test-Path -LiteralPath (Join-Path $data 'backups/novora-before-update-fixture.dump')) 'update protection backup retained'
  & "$pg/pg_ctl.exe" -D $cluster -w stop -m fast
  Assert ($LASTEXITCODE -eq 0) 'isolated PostgreSQL stopped'; $started = $false
  $failed = $false
  try { & "$PSScriptRoot/backup.ps1" -InstallRoot $InstallRoot -DataRoot $data *> "$root/backup-failure.log" } catch { $failed = $true }
  Assert $failed 'offline database backup reports failure'
  Assert (@(Get-ChildItem "$data/backups/*.partial").Count -eq 0) 'partial backup cleaned after failure'
  Write-Output 'BACKUP SMOKE PASS (SCM mocked; real isolated PostgreSQL)'
} finally {
  $env:PGPASSWORD = $previousPassword
  if ($started) { & "$pg/pg_ctl.exe" -D $cluster -w stop -m fast }
  Write-Output "Retained test fixtures and logs: $root"
}
