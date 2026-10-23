[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'operation-progress.ps1')
$install = (Resolve-Path -LiteralPath $InstallRoot).Path
$pg = Join-Path $install 'postgres\bin'
$root = Join-Path $env:TEMP ('novora-initialize-check-' + [Guid]::NewGuid().ToString('N'))
$cluster = Join-Path $root 'postgres-data'
$previousPassword = $env:PGPASSWORD
$previousTimeout = $env:PGCONNECT_TIMEOUT
$previousOptions = $env:PGOPTIONS
$script:started = $false
$script:events = New-Object 'Collections.Generic.List[string]'
$native = (Get-Command Invoke-NovoraNative).ScriptBlock
function Assert($condition, $description) { if (-not $condition) { throw $description }; Write-Output "PASS: $description" }
function Assert-NovoraServicePath { param($Name, $Executable, $DataDirectory) }
function Get-Service { param($Name, $ErrorAction) return [pscustomobject]@{Status='Stopped'} }
function Request-NovoraService { param($Name, $Action)
  $script:events.Add("$Name $Action")
  if ($script:failStart) { throw 'fixture SCM startup rejected' }
  if ($Name -eq 'NovoraPostgreSQL' -and -not $script:started) {
    & (Join-Path $pg 'pg_ctl.exe') -D $cluster -l (Join-Path $root 'postgres.log') -w start
    if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL failed to start.' }
    $script:started = $true
  }
}
function Wait-NovoraService { param($Name, $Status, $Stage, $Item, $TimeoutSeconds) $script:events.Add("$Name $Status") }
function Wait-NovoraHealth { param($Port, $TimeoutSeconds)
  $script:events.Add('HTTP health')
  if ($script:failHealth) { throw 'fixture HTTP unhealthy' }
}
function Invoke-NovoraNative { param($FilePath, $Arguments)
  $script:events.Add(($Arguments -join ' '))
  if ($script:failSql -and ($Arguments -join ' ') -match 'current_user') { return @{ExitCode=7; Output="postgres://novora:$password@localhost/novora PASSWORD=$password"} }
  & $native $FilePath $Arguments
}
try {
  New-Item -ItemType Directory -Force -Path (Join-Path $root 'config') | Out-Null
  $password = [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText((Join-Path $root 'config\.db-password'), $password)
  $initialized = & $native (Join-Path $pg 'initdb.exe') @('-D',$cluster,'-U','novora','--pwfile',(Join-Path $root 'config\.db-password'),'--auth=scram-sha-256','--encoding=UTF8','--locale=C')
  Assert ($initialized.ExitCode -eq 0) 'isolated PostgreSQL initialized'
  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
  Add-Content -LiteralPath (Join-Path $cluster 'postgresql.conf') -Value "port=$port`nlisten_addresses='127.0.0.1'"
  $envPath = Join-Path $root 'config\.env'
  $validEnv = "DATABASE_URL=postgres://novora:$password@127.0.0.1:$port/novora"
  [IO.File]::WriteAllText($envPath,$validEnv)
  $env:PGPASSWORD = 'prior-password'; $env:PGCONNECT_TIMEOUT = '17'; $env:PGOPTIONS = '-c application_name=prior'
  Start-NovoraInitializedServices $install $root 3000
  $trace = $script:events -join "`n"
  Assert ($trace.IndexOf('NovoraPostgreSQL start') -lt $trace.IndexOf('SELECT 1') -and $trace.IndexOf('CREATE DATABASE novora') -lt $trace.IndexOf('Novora start') -and $trace.IndexOf('Novora start') -lt $trace.IndexOf('HTTP health')) 'SCM database startup precedes real SQL/database creation, business startup, and HTTP validation'
  Assert ($env:PGPASSWORD -eq 'prior-password' -and $env:PGCONNECT_TIMEOUT -eq '17' -and $env:PGOPTIONS -eq '-c application_name=prior') 'connection environment restored after success'
  $script:events.Clear()
  Start-NovoraInitializedServices $install $root 3000
  Assert (($script:events -join ' ') -notmatch 'CREATE DATABASE') 'repeated initialization does not recreate existing novora database'
  $script:events.Clear(); $script:failSql = $true
  $failure = ''
  try { Start-NovoraInitializedServices $install $root 3000 } catch { $failure = $_.Exception.Message }
  Assert ($failure -and $failure -notmatch [regex]::Escape($password) -and ($script:events -join ' ') -notmatch 'Novora start') 'SQL failure propagates, redacts credentials, and prevents business startup'
  Assert ($env:PGPASSWORD -eq 'prior-password' -and $env:PGCONNECT_TIMEOUT -eq '17' -and $env:PGOPTIONS -eq '-c application_name=prior') 'connection environment restored after SQL failure'
  $script:failSql = $false; $script:failStart = $true; $script:events.Clear()
  $failed = $false
  try { Start-NovoraInitializedServices $install $root 3000 } catch { $failed = $_.Exception.Message -match 'fixture SCM' }
  Assert ($failed -and ($script:events -join ' ') -notmatch 'SELECT 1') 'SCM failure propagates before SQL probe'
  $script:failStart = $false; $script:failHealth = $true
  $failed = $false
  try { Start-NovoraInitializedServices $install $root 3000 } catch { $failed = $_.Exception.Message -match 'fixture HTTP' }
  Assert $failed 'failed HTTP validation cannot report initialization success'
  $script:events.Clear()
  [IO.File]::WriteAllText($envPath,$validEnv.Replace(":$port/", ':5432/'))
  $failed = $false
  try { Start-NovoraInitializedServices $install $root 3000 } catch { $failed = $true }
  Assert ($failed -and $script:events.Count -eq 0) '5432 database rejected before any service operation'
  Write-Output 'INITIALIZE SERVICES SMOKE PASS (real isolated PostgreSQL, mocked SCM/HTTP; no installed service changes)'
} finally {
  if ($script:started) { & (Join-Path $pg 'pg_ctl.exe') -D $cluster -w stop -m fast }
  $env:PGPASSWORD = $previousPassword; $env:PGCONNECT_TIMEOUT = $previousTimeout; $env:PGOPTIONS = $previousOptions
  Write-Output "Retained isolated fixtures: $root"
}
