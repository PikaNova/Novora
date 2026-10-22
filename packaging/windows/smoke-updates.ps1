#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'Stop'
$InstallRoot = (Resolve-Path -LiteralPath $InstallRoot).Path
$pg = Join-Path $InstallRoot 'postgres/bin'
$root = Join-Path $env:TEMP ('novora-update-db-' + [Guid]::NewGuid().ToString('N'))
$cluster = Join-Path $root 'cluster'
$data = Join-Path $root 'data'
$oldPassword = $env:PGPASSWORD
$started = $false
function Assert($condition, $message) { if (-not $condition) { throw $message }; Write-Output "PASS: $message" }
function Sql($query) {
  $answer = & "$pg/psql.exe" -X -w -h 127.0.0.1 -p $port -U novora -d novora -v ON_ERROR_STOP=1 -t -A -c $query
  if ($LASTEXITCODE -ne 0) { throw 'Isolated test SQL failed' }; return $answer
}
try {
  New-Item -ItemType Directory -Force -Path "$data/config", "$data/backups" | Out-Null
  $password = [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText("$root/password", $password)
  & "$pg/initdb.exe" -D $cluster -U novora --pwfile "$root/password" --auth=scram-sha-256 --encoding=UTF8 --locale=C *> "$root/init.log"
  Assert ($LASTEXITCODE -eq 0) 'isolated update initdb'
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
  & "$pg/pg_ctl.exe" -D $cluster -o "-p $port -h 127.0.0.1" -l "$root/postgres.log" -w start
  Assert ($LASTEXITCODE -eq 0) 'isolated update PostgreSQL started'
  $started = $true; $env:PGPASSWORD = $password
  & "$pg/createdb.exe" -h 127.0.0.1 -p $port -U novora novora
  Assert ($LASTEXITCODE -eq 0) 'isolated update database created'
  [IO.File]::WriteAllText("$data/config/.env", "DATABASE_URL=postgresql://novora:unused@127.0.0.1:$port/novora")
  [IO.File]::WriteAllText("$data/config/.db-password", $password)
  dotnet run --project "$PSScriptRoot/Novora.Update.Tests" -c Release -- --database $InstallRoot $data
  Assert ($LASTEXITCODE -eq 0) 'updater native PostgreSQL operations'
  Assert ((Sql 'select count(*) from update_probe') -eq '1') 'failed migration rolls back all inserted rows'
  Assert ((Sql 'select count(*) from novora_windows_updates') -eq '1') 'failed migration never records completion'
  Assert ((Sql 'select value from update_probe') -eq 'kept') 'successful migration data preserved'
} finally {
  if ($started) { & "$pg/pg_ctl.exe" -D $cluster -m immediate -w stop | Out-Null }
  $env:PGPASSWORD = $oldPassword
  Write-Output "Update database fixtures retained at $root"
}
