[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'operation-progress.ps1')
$pg = Join-Path (Resolve-Path -LiteralPath $InstallRoot).Path 'postgres\bin'
$root = Join-Path $env:TEMP ('novora-install-check-' + [Guid]::NewGuid().ToString('N'))
$cluster = Join-Path $root 'postgres-data'
$started = $false
$previousPassword = $env:PGPASSWORD
$previousProgress = $env:NOVORA_PROGRESS_FILE
function Assert($condition, $description) { if (-not $condition) { throw $description }; Write-Output "PASS: $description" }
# Load only functions from provisioning: never execute its registration entry point.
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'provision-services.ps1'), [ref]$null, [ref]$parseErrors)
if ($parseErrors) { throw $parseErrors[0].Message }
foreach ($name in @('Get-PostgresMemoryProfile','Set-PostgresMemoryProfile','Protect-NovoraCredentialFile','Initialize-BundledPostgres')) {
  $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $false)
  . ([scriptblock]::Create($definition.Extent.Text))
}
try {
  New-Item -ItemType Directory -Force -Path $root, (Join-Path $root 'config') | Out-Null
  # Configuration consumed by Node, PostgreSQL and the control center must be UTF-8 without
  # the BOM that Windows PowerShell 5.1 adds for Set-Content -Encoding UTF8.
  $utf8Path = Join-Path $root 'config\utf8-check.txt'
  Write-NovoraUtf8File -Path $utf8Path -Content @('Novora 初始管理员账号：admin', 'ADMIN_PASSWORD=x')
  $utf8Bytes = [IO.File]::ReadAllBytes($utf8Path)
  $utf8Text = [Text.Encoding]::UTF8.GetString($utf8Bytes)
  Assert ($utf8Bytes[0] -ne 0xEF -and $utf8Text.StartsWith('Novora 初始管理员账号') -and $utf8Text.EndsWith("`r`n")) 'UTF-8 configuration writes have no BOM and keep Chinese text'
  $password = [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText((Join-Path $root 'password'), $password)
  $init = Invoke-NovoraNative (Join-Path $pg 'initdb.exe') @('-D', $cluster, '-U', 'novora', '--pwfile', (Join-Path $root 'password'), '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C')
  Assert ($init.ExitCode -eq 0) 'isolated PostgreSQL initialized'
  # Regression: initdb drops the Administrators group on Windows, so provisioning must
  # not hand it the hardened .db-password. Exercise the production function, not a copy.
  $freshRoot = Join-Path $root 'fresh-provision'
  New-Item -ItemType Directory -Force -Path (Join-Path $freshRoot 'config') | Out-Null
  $freshPassword = Join-Path $freshRoot 'config\.db-password'
  [IO.File]::WriteAllText($freshPassword, $password, [Text.Encoding]::ASCII)
  Protect-NovoraCredentialFile $freshPassword
  function Get-Service { param($Name, $ErrorAction) return $null }
  function New-Service { param($Name, $BinaryPathName, $DisplayName, $Description, $StartupType, $Credential) }
  function Get-CimInstance { param($ClassName, $Filter, $ErrorAction) return $null }
  try {
    $postgresServiceName = 'NovoraPostgreSQL'
    $DatabaseStartupType = 'Manual'
    Initialize-BundledPostgres (Split-Path $pg -Parent) $freshRoot $password $port | Out-Null
  } finally {
    Remove-Item Function:\Get-Service, Function:\New-Service, Function:\Get-CimInstance -ErrorAction SilentlyContinue
  }
  Assert (Test-Path -LiteralPath (Join-Path $freshRoot 'postgres-data\PG_VERSION')) 'production provisioning initializes PostgreSQL from a hardened credential file'
  $version = [IO.File]::ReadAllText((Join-Path $cluster 'PG_VERSION'))
  [IO.File]::WriteAllText((Join-Path $cluster 'preserve.marker'), 'existing-data')
  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
  $config = Join-Path $cluster 'postgresql.conf'
  $text = [IO.File]::ReadAllText($config) + "`r`nport = $port`r`nlisten_addresses = '127.0.0.1'`r`nwork_mem = '7MB'`r`n"
  [IO.File]::WriteAllText($config, $text, (New-Object Text.UTF8Encoding($true)))
  $broken = Invoke-NovoraNative (Join-Path $pg 'postgres.exe') @('-D', $cluster, '-C', 'port')
  Assert ($broken.ExitCode -ne 0) 'UTF8 BOM reproduces PostgreSQL configuration failure'
  Set-PostgresMemoryProfile $config
  $fixed = Invoke-NovoraNative (Join-Path $pg 'postgres.exe') @('-D', $cluster, '-C', 'port')
  Assert ($fixed.ExitCode -eq 0 -and $fixed.Output.Trim() -eq "$port") 'BOM repaired and PostgreSQL parses configuration'
  $first = [IO.File]::ReadAllText($config)
  Set-PostgresMemoryProfile $config
  Assert ([IO.File]::ReadAllText($config) -eq $first -and $first.Contains("work_mem = '7MB'")) 'repeat configuration is idempotent and preserves operator tuning'
  Assert ([IO.File]::ReadAllText((Join-Path $cluster 'PG_VERSION')) -eq $version -and [IO.File]::ReadAllText((Join-Path $cluster 'preserve.marker')) -eq 'existing-data') 'existing data retained'
  $env:PGPASSWORD = $password
  $offline = Invoke-NovoraNative (Join-Path $pg 'psql.exe') @('-w', '-h', '127.0.0.1', '-p', "$port", '-U', 'novora', '-d', 'postgres', '-c', 'select 1')
  Assert ($offline.ExitCode -ne 0) 'native stderr is a failed probe rather than a terminating PowerShell error'
  # Do not capture pg_ctl stdout in a PowerShell native pipeline: the spawned
  # postgres process inherits that pipe and can keep Windows PowerShell waiting.
  & (Join-Path $pg 'pg_ctl.exe') -D $cluster -l (Join-Path $root 'postgres.log') -w start
  Assert ($LASTEXITCODE -eq 0) 'isolated PostgreSQL starts after repair'
  $started = $true
  $online = Invoke-NovoraNative (Join-Path $pg 'psql.exe') @('-w', '-h', '127.0.0.1', '-p', "$port", '-U', 'novora', '-d', 'postgres', '-tAc', 'select 1')
  Assert ($online.ExitCode -eq 0 -and $online.Output.Trim() -eq '1') 'real SQL connection succeeds after earlier failed probe'
  $env:NOVORA_PROGRESS_FILE = Join-Path $root 'progress.json'
  Write-NovoraProgress -Stage database -Item '等待数据库' -ElapsedSeconds 3 -TimeoutSeconds 30 -Message 'postgres://novora:secret@localhost/novora ADMIN_PASSWORD=secret'
  $event = [IO.File]::ReadAllText($env:NOVORA_PROGRESS_FILE) | ConvertFrom-Json
  Assert ($null -eq $event.total -and $event.elapsedSeconds -eq 3 -and $event.timeoutSeconds -eq 30 -and $event.message -notmatch 'secret') 'unknown duration and redacted structured progress'
  New-Item -ItemType Directory -Force -Path (Join-Path $root 'updater') | Out-Null
  [IO.File]::WriteAllText((Join-Path $root 'updater\state.json'), '{"phase":"repair-required"}')
  $blocked = $false
  try { $unexpected = Enter-NovoraMaintenance $root; $unexpected.ReleaseMutex(); $unexpected.Dispose() } catch { $blocked = $true }
  Assert $blocked 'unfinished update blocks installation and initialization'
  [IO.File]::WriteAllText((Join-Path $root 'updater\state.json'), '{"phase":"rolled-back"}')
  $safe = Enter-NovoraMaintenance $root
  $safe.ReleaseMutex(); $safe.Dispose()
  Assert $true 'safe updater terminal state permits maintenance after prior rejection'
  function Get-CimInstance { param($ClassName, $Filter, $ErrorAction) return [pscustomobject]@{ PathName='"C:\Unrelated\pg_ctl.exe" runservice -D "C:\Unrelated\data"' } }
  $pathRejected = $false
  try { Assert-NovoraServicePath NovoraPostgreSQL (Join-Path $root 'postgres\bin\pg_ctl.exe') $cluster } catch { $pathRejected = $true }
  Assert $pathRejected 'same-name service targeting another installation is rejected'
  Remove-Item Function:\Get-CimInstance
  [IO.File]::WriteAllText((Join-Path $root 'active-version.json'), '{"version":"2.8.2","directory":"versions/2.8.2"}')
  $activeRejected = $false
  try { Assert-NovoraFullInstall $root -TargetVersion '2.8.1' } catch { $activeRejected = $true }
  Assert $activeRejected 'full installer refuses an existing active-version before file replacement'
  [IO.File]::Delete((Join-Path $root 'active-version.json'))
  [IO.File]::WriteAllText((Join-Path $root 'package.json'), '{"version":"2.8.2"}')
  $downgradeRejected = $false
  try { Assert-NovoraFullInstall $root -TargetVersion '2.8.1' } catch { $downgradeRejected = $true }
  Assert $downgradeRejected 'full installer refuses downgrade before file replacement'
  $upgradeAllowed = $true
  try { Assert-NovoraFullInstall $root -TargetVersion '2.9.0' } catch { $upgradeAllowed = $false }
  Assert $upgradeAllowed 'full installer accepts a newer installer version over the existing root package'
  # Get-NovoraProductVersion reads the payload package.json, so an omitted target falls back
  # to the installer's own stamped version and never to a hard-coded release.
  Assert ((Get-NovoraProductVersion $root) -eq '2.8.2') 'product version comes from the payload package.json'
  [IO.File]::Delete((Join-Path $root 'package.json'))
  $unstamped = ''
  try { Assert-NovoraFullInstall (Join-Path $root 'missing-install') } catch { $unstamped = $_.Exception.Message }
  Assert ($unstamped -match '产品版本') 'an installer without a stamped product version refuses to guess one'
  Assert (-not (Get-NovoraProductVersion (Join-Path $root 'missing-install'))) 'unknown product version is reported as empty, not as a release'
  # Stop the disposable cluster before initialization provisions its files.
  & (Join-Path $pg 'pg_ctl.exe') -D $cluster -w stop -m fast
  Assert ($LASTEXITCODE -eq 0) 'isolated cluster stopped before initialization provisioning test'
  $started = $false
  # Only the production registration function is loaded; its entry point never runs.
  # Reject every native operation except service registration/configuration.
  $script:registrationCalls = @()
  function Get-Service { param($Name, $ErrorAction) return $null }
  function New-Service { param($Name, $BinaryPathName, $DisplayName, $Description, $StartupType, $Credential)
    if ($Name -ne 'NovoraPostgreSQL' -or $StartupType -ne 'Manual' -or $Credential.UserName -ne 'NT AUTHORITY\NetworkService' -or $BinaryPathName -notmatch 'runservice') { throw 'Unexpected database service registration' }
    $script:registrationCalls += 'SCM New-Service Manual NetworkService'
  }
  function Request-NovoraService { param($Name, $Action) throw "Installer attempted service action: $Action" }
  function Wait-NovoraHealth { throw 'Installer attempted HTTP health check' }
  function Invoke-NovoraNative { param($FilePath, $Arguments)
    $name = [IO.Path]::GetFileName($FilePath)
    $script:registrationCalls += ($name + ' ' + ($Arguments -join ' '))
    if ($name -eq 'sc.exe' -and $Arguments[0] -eq 'config' -and $Arguments -contains 'demand') {
      return @{ExitCode=0; Output=''}
    }
    throw "Installer invoked forbidden native operation: $name $($Arguments -join ' ')"
  }
  $postgresServiceName = 'NovoraPostgreSQL'
  # Initialize-BundledPostgres reads the caller's startup-type variable, which production
  # supplies from provision-services.ps1; the fixture only loads the function body.
  $DatabaseStartupType = 'Manual'
  # A build machine may already run NovoraPostgreSQL for a different data directory. The
  # fixture must not read or compare that registration, so it supplies its own match.
  $fixturePgCtl = Join-Path (Split-Path $pg -Parent) 'bin\pg_ctl.exe'
  function Get-CimInstance { param($ClassName, $Filter, $ErrorAction)
    return [pscustomobject]@{ PathName = ('"{0}" runservice -N "NovoraPostgreSQL" -D "{1}" -w' -f $fixturePgCtl, $cluster); StartName = 'NT AUTHORITY\NetworkService'; StartMode = 'Manual' }
  }
  Initialize-BundledPostgres (Split-Path $pg -Parent) $root $password $port | Out-Null
  $registeredConfig = [IO.File]::ReadAllText($config)
  Initialize-BundledPostgres (Split-Path $pg -Parent) $root $password $port | Out-Null
  Assert ($script:registrationCalls.Count -eq 2) 'initialization provisions manual-start database without postgres -C, SQL, service startup, or HTTP probes'
  Assert ([IO.File]::ReadAllText($config) -eq $registeredConfig -and $registeredConfig.Contains("work_mem = '7MB'") -and [IO.File]::ReadAllText((Join-Path $cluster 'PG_VERSION')) -eq $version -and [IO.File]::ReadAllText((Join-Path $cluster 'preserve.marker')) -eq 'existing-data') 'repeated registration preserves repaired configuration, tuning, and existing database'
  Remove-Item Function:\Get-CimInstance
  # Execute a disposable installer copy, overriding only machine-facing access
  # and the administrator gate. Every forbidden provisioning operation throws.
  $base = Join-Path $root 'base-install'
  New-Item -ItemType Directory -Path $base | Out-Null
  [IO.File]::WriteAllText((Join-Path $base 'NovoraLauncher.exe'), 'never executed')
  $installPath = Join-Path $PSScriptRoot 'install.ps1'
  $installAst = [Management.Automation.Language.Parser]::ParseFile($installPath, [ref]$null, [ref]$null)
  $admin = $installAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-Administrator' }, $false)
  $installText = [IO.File]::ReadAllText($installPath).Replace($admin.Extent.Text, 'function Assert-Administrator {}')
  [IO.File]::WriteAllText((Join-Path $base 'install.ps1'), $installText, (New-Object Text.UTF8Encoding($true)))
  $helper = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'operation-progress.ps1')) + @'

function Get-CimInstance { param($ClassName, $Filter, $ErrorAction) return $null }
function Get-Service { param($Name, $ErrorAction) return $null }
function Get-Process { param($Name, $ErrorAction) return $null }
function Invoke-NovoraNative { throw 'Base installer attempted native database/service operation' }
function Invoke-NovoraPowerShellScript { throw 'Base installer attempted provisioning script' }
function New-Service { throw 'Base installer attempted service registration' }
function Invoke-CimMethod { throw 'Base installer attempted service mutation' }
function Request-NovoraService { throw 'Base installer attempted startup' }
function Wait-NovoraHealth { throw 'Base installer attempted health check' }
'@
  # The fixture stands in for a staged payload, so replay build.ps1 injecting the product
  # version; an unstamped helper would correctly refuse the installer version check.
  $versionMarker = "(NovoraProductVersion = ')[^']*(')"
  if ([regex]::Matches($helper, $versionMarker).Count -ne 1) { throw 'operation-progress.ps1 must hold exactly one injectable version marker.' }
  $helper = [regex]::Replace($helper, $versionMarker, '${1}2.8.1${2}')
  [IO.File]::WriteAllText((Join-Path $base 'operation-progress.ps1'), $helper, (New-Object Text.UTF8Encoding($true)))
  & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $base 'install.ps1') -InstallRoot $base -DataRoot $base -NoTray -NoInitialize -NoShortcuts -Quiet
  Assert ($LASTEXITCODE -eq 0 -and -not (Test-Path (Join-Path $base 'config\.env')) -and -not (Test-Path (Join-Path $base 'postgres-data'))) 'base installer completes without service registration, database creation/configuration, SQL, startup, or health checks'
  function Get-Service { param($Name, $ErrorAction) return [pscustomobject]@{Status='Stopped'} }
  Remove-Item Function:\Wait-NovoraHealth
  . (Join-Path $PSScriptRoot 'operation-progress.ps1')
  $healthFailed = $false
  function Invoke-RestMethod { param($Uri, $TimeoutSec) return @{ok=$false} }
  try { Wait-NovoraHealth -Port $port -TimeoutSeconds 1 } catch { $healthFailed = $true }
  Assert $healthFailed 'failed HTTP health check cannot report initialization success'
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $timeoutFailed = $false
  try { Wait-NovoraService Novora Running service 'fixture pending' 1 } catch { $timeoutFailed = $true }
  Assert ($timeoutFailed -and $watch.Elapsed.TotalSeconds -lt 3) 'SCM wait is bounded and reports timeout'
  Write-Output 'INSTALL PROGRESS SMOKE PASS (real isolated PostgreSQL, mocked SCM; no installed data changes)'
} finally {
  if ($started) { & (Join-Path $pg 'pg_ctl.exe') -D $cluster -w stop -m fast }
  $env:PGPASSWORD = $previousPassword
  $env:NOVORA_PROGRESS_FILE = $previousProgress
  Write-Output "Retained isolated fixtures: $root"
}
