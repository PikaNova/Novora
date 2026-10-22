[CmdletBinding()]
param(
  [string]$InstallRoot = "$env:ProgramFiles\Novora",
  [string]$DataRoot = "$env:ProgramData\Novora",
  [int]$Port = 3000,
  [string]$DatabasePort = "55432",
  [string]$AdminPassword,
  [ValidateSet('Automatic','Manual')][string]$ServiceStartupType = 'Manual',
  [ValidateSet('Automatic','Manual')][string]$DatabaseStartupType = 'Manual',
  [switch]$LockAlreadyHeld
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "operation-progress.ps1")
$maintenance = $null
$logDirectory = Join-Path $DataRoot "logs"
trap {
  $message = Protect-NovoraMessage $_.Exception.Message
  Write-NovoraProgress -Stage $script:NovoraStage -Item $script:NovoraItem -Status failed -Message $message
  Write-Host "服务准备失败：$message" -ForegroundColor Red
  try { Stop-Transcript | Out-Null } catch { }
  if ($maintenance) { $maintenance.ReleaseMutex(); $maintenance.Dispose(); $maintenance = $null }
  exit 1
}
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
Start-Transcript -Path (Join-Path $logDirectory "provision-services.log") -Append | Out-Null
$serviceName = "Novora"
$postgresServiceName = "NovoraPostgreSQL"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Assert-Administrator {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "请以管理员身份运行安装程序。"
  }
}

function New-RandomSecret([int]$Length = 32) {
  $bytes = New-Object byte[] $Length
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').TrimEnd('=')
}

function Protect-NovoraCredentialFile([string]$Path, [switch]$AllowLocalServiceRead) {
  # Must run immediately after the file is written: initialization can fail later
  # (e.g. PostgreSQL setup), and until then the secret inherits the config
  # directory's world-readable ACL.
  $fileAcl = Get-Acl -LiteralPath $Path
  $fileAcl.SetAccessRuleProtection($true, $false)
  $fileAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM", "FullControl", "Allow")))
  $fileAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("Administrators", "FullControl", "Allow")))
  if ($AllowLocalServiceRead) {
    $fileAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("NT AUTHORITY\LOCAL SERVICE", "Read", "Allow")))
  }
  Set-Acl -LiteralPath $Path -AclObject $fileAcl
}

function Get-PostgresMemoryProfile {
  $memoryBytes = 4GB
  try {
    $reported = [double](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory
    if ($reported -gt 0) { $memoryBytes = $reported }
  } catch { }
  $memoryGb = $memoryBytes / 1GB
  if ($memoryGb -le 6) {
    return [ordered]@{ shared_buffers = '128MB'; effective_cache_size = '1GB'; work_mem = '4MB'; maintenance_work_mem = '64MB'; max_connections = '30' }
  }
  if ($memoryGb -le 12) {
    return [ordered]@{ shared_buffers = '256MB'; effective_cache_size = '3GB'; work_mem = '8MB'; maintenance_work_mem = '128MB'; max_connections = '50' }
  }
  $cacheGb = [math]::Max(4, [math]::Floor($memoryGb * 0.6))
  return [ordered]@{ shared_buffers = '512MB'; effective_cache_size = "${cacheGb}GB"; work_mem = '8MB'; maintenance_work_mem = '128MB'; max_connections = '64' }
}

function Set-PostgresMemoryProfile([string]$ConfigPath) {
  $raw = [IO.File]::ReadAllText($ConfigPath)
  $raw = [regex]::Replace($raw, '(?ms)^\s*# BEGIN NOVORA MEMORY PROFILE\s*$.*?^\s*# END NOVORA MEMORY PROFILE\s*(?:\r?\n)?', '')
  $profile = Get-PostgresMemoryProfile
  $managed = @('# BEGIN NOVORA MEMORY PROFILE', '# Managed defaults derived from physical RAM; uncommented settings outside this block remain user-owned.')
  foreach ($entry in $profile.GetEnumerator()) {
    if ($raw -match "(?m)^\s*$([regex]::Escape($entry.Key))\s*=") { continue }
    $managed += "$($entry.Key) = $($entry.Value)"
  }
  if ($managed.Count -gt 2) {
    $managed += '# END NOVORA MEMORY PROFILE'
    $raw = $raw.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + ($managed -join [Environment]::NewLine) + [Environment]::NewLine
  }
  [IO.File]::WriteAllText($ConfigPath, $raw, (New-Object Text.UTF8Encoding($false)))
}

function Initialize-BundledPostgres([string]$PostgresRoot, [string]$DataRoot, [string]$Password, [int]$Port) {
  $bin = Join-Path $PostgresRoot "bin"
  $initdb = Join-Path $bin "initdb.exe"
  $pgCtl = Join-Path $bin "pg_ctl.exe"
  $psql = Join-Path $bin "psql.exe"
  if (-not (Test-Path $initdb) -or -not (Test-Path $pgCtl) -or -not (Test-Path $psql)) { throw "内置 PostgreSQL 文件不完整，请重新运行完整安装包。" }
  $pgData = Join-Path $DataRoot "postgres-data"
  Assert-NovoraServicePath $postgresServiceName $pgCtl $pgData
  New-Item -ItemType Directory -Force -Path $pgData | Out-Null
  $existingPostgresService = Get-Service -Name $postgresServiceName -ErrorAction SilentlyContinue
  if ($existingPostgresService -and $existingPostgresService.Status -ne 'Stopped') {
    Write-NovoraProgress -Stage database -Item '停止 Novora 独立数据库'
    Request-NovoraService $postgresServiceName stop
    Wait-NovoraService $postgresServiceName 'Stopped' 'database' '等待数据库停止' 30
  }
  $dataAcl = Get-Acl $pgData
  $dataAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("NT AUTHORITY\NETWORK SERVICE", "Modify", "ContainerInherit,ObjectInherit", "None", "Allow")))
  Set-Acl -Path $pgData -AclObject $dataAcl
  $dbPasswordPath = Join-Path $DataRoot "config\.db-password"
  if (-not (Test-Path $dbPasswordPath)) {
    Set-Content -Path $dbPasswordPath -Value $Password -Encoding ASCII
    Protect-NovoraCredentialFile $dbPasswordPath
  }
  if (-not (Test-Path (Join-Path $pgData "PG_VERSION"))) {
    if (@(Get-ChildItem -LiteralPath $pgData -Force).Count -gt 0) {
      throw "数据库目录非空但缺少 PG_VERSION，可能存在未完成的初始化。已保留目录，请检查后重试：$pgData"
    }
    Write-NovoraProgress -Stage database -Item '首次初始化 PostgreSQL 数据目录'
    $initialized = Invoke-NovoraNative $initdb @("-D", $pgData, "-U", "novora", "--pwfile", $dbPasswordPath, "--encoding=UTF8", "--locale=C") -TimeoutSeconds 120
    if ($initialized.ExitCode -ne 0) { throw "PostgreSQL initdb 失败（退出码 $($initialized.ExitCode)）：$($initialized.Output)" }
    Add-Content -Path (Join-Path $pgData "postgresql.conf") -Value "port = $Port`nlisten_addresses = '127.0.0.1'"
    Set-Content -Path (Join-Path $pgData "pg_hba.conf") -Value @(
      "local all all scram-sha-256"
      "host all all 127.0.0.1/32 scram-sha-256"
      "host all all ::1/128 scram-sha-256"
    )
  }
  $postgresConfigPath = Join-Path $pgData "postgresql.conf"
  if ((Get-Content -LiteralPath $postgresConfigPath -Raw) -notmatch '(?m)^\s*logging_collector\s*=') {
    Add-Content -Path $postgresConfigPath -Value "logging_collector = on`nlog_directory = 'log'`nlog_filename = 'postgresql-%Y-%m-%d.log'`nlog_rotation_age = 1d`nlog_rotation_size = 20MB"
  }
  Write-NovoraProgress -Stage database -Item '准备数据库配置（保留已有数据，检查交由初始化）'
  Set-PostgresMemoryProfile $postgresConfigPath
  $postgresBinPath = '"{0}" runservice -N "{1}" -D "{2}" -w' -f $pgCtl, $postgresServiceName, $pgData
  if (-not (Get-Service -Name $postgresServiceName -ErrorAction SilentlyContinue)) {
    Write-NovoraProgress -Stage database -Item '使用 Windows 服务管理器注册 PostgreSQL'
    $credential = New-Object Management.Automation.PSCredential('NT AUTHORITY\NetworkService', (New-Object Security.SecureString))
    New-Service -Name $postgresServiceName -BinaryPathName $postgresBinPath -DisplayName 'Novora PostgreSQL' -Description 'Novora private PostgreSQL database' -StartupType $DatabaseStartupType -Credential $credential | Out-Null
  } else {
    $registration = Get-CimInstance Win32_Service -Filter "Name='NovoraPostgreSQL'" -ErrorAction Stop
    if ($registration.StartName -notin @('NT AUTHORITY\NetworkService', 'NT AUTHORITY\NETWORK SERVICE')) {
      throw '已有 PostgreSQL 服务账号不匹配，未更改服务权限或账号，请先检查该服务。'
    }
    # Only the launch command is repaired here; the start mode belongs to
    # initialization, which applies the user's policy and tolerates a refusal.
    if ($registration.PathName -ne $postgresBinPath) {
      $changed = Invoke-CimMethod -InputObject $registration -MethodName Change -Arguments @{ PathName = $postgresBinPath }
      if ($changed.ReturnValue -ne 0) { throw "无法配置已有 PostgreSQL 服务（代码 $($changed.ReturnValue)）。已保留数据与服务权限，请检查该服务管理权限。" }
    }
  }
  Write-NovoraProgress -Stage database -Item '注册 PostgreSQL 服务（等待初始化）'
  return $true
}

Write-NovoraProgress -Stage preflight -Item '检查管理员权限与安装目录'
Assert-Administrator
if (-not $LockAlreadyHeld) { $maintenance = Enter-NovoraMaintenance $InstallRoot }
Assert-NovoraUpdateReady $InstallRoot
Assert-NovoraServicePath Novora (Join-Path $InstallRoot 'NovoraServiceHost.exe')
Assert-NovoraServicePath NovoraPostgreSQL (Join-Path $InstallRoot 'postgres\bin\pg_ctl.exe') (Join-Path $DataRoot 'postgres-data')
if ($Port -lt 1 -or $Port -gt 65535 -or $DatabasePort -notmatch '^\d+$' -or [int]$DatabasePort -lt 1 -or [int]$DatabasePort -gt 65535 -or [int]$DatabasePort -eq 5432) { throw '服务或独立数据库端口无效。' }
New-Item -ItemType Directory -Force -Path $InstallRoot, "$DataRoot\config", "$DataRoot\logs", "$DataRoot\backups" | Out-Null

# Stop the application before preparing PostgreSQL files; initialization owns startup and verification.
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
  Write-NovoraProgress -Stage service -Item '停止原有 Novora 服务'
  if ((Get-Service -Name $serviceName -ErrorAction Stop).Status -ne 'Stopped') { Request-NovoraService $serviceName stop }
  Wait-NovoraService $serviceName 'Stopped' 'service' '等待原有 Novora 服务停止' 30
}

$envPath = Join-Path $DataRoot "config\.env"
$databasePassword = $null
$adminPasswordWasGenerated = $false
if (-not (Test-Path $envPath)) {
  if (Test-Path -LiteralPath (Join-Path $DataRoot 'postgres-data\PG_VERSION')) {
    throw '已有数据库集群但缺少连接配置，未生成新凭据或更改数据库。请恢复原 config 配置后重试初始化。'
  }
  if ([string]::IsNullOrWhiteSpace($AdminPassword)) { $AdminPassword = New-RandomSecret 10; $adminPasswordWasGenerated = $true }
  $databasePassword = New-RandomSecret 24
  Write-NovoraUtf8File -Path $envPath -Content @(
    "NODE_ENV=production"
    "HOST=0.0.0.0"
    "PORT=$Port"
    "DATABASE_URL=postgres://novora:$databasePassword@127.0.0.1:$DatabasePort/novora"
    "ADMIN_PASSWORD=$AdminPassword"
    "NOVORA_PG_POOL_MAX=4"
    "VITE_SPEED_INSIGHTS=false"
    "TELEMETRY_BASE_URL="
    "NOVORA_LOG_DIR=$DataRoot\logs"
  )
  Protect-NovoraCredentialFile $envPath -AllowLocalServiceRead
  Set-Content -Path "$DataRoot\config\.db-password" -Value $databasePassword -Encoding ASCII
  Protect-NovoraCredentialFile "$DataRoot\config\.db-password"
  if ($adminPasswordWasGenerated) {
    # Contains Chinese labels: must stay UTF-8, and without a BOM.
    Write-NovoraUtf8File -Path "$DataRoot\config\initial-credentials.txt" -Content @(
      "Novora 初始管理员账号：admin"
      "ADMIN_PASSWORD=$AdminPassword"
      "首次登录后请立即修改密码并妥善保存恢复密钥。"
    )
    Protect-NovoraCredentialFile "$DataRoot\config\initial-credentials.txt"
  }
}

Write-NovoraProgress -Stage configuration -Item '读取并保留已有配置'
$postgresRoot = Join-Path $InstallRoot "postgres"
# Expose only connection metadata to the unelevated control center and tray.
$configuredPort = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^PORT=' } | Select-Object -First 1
if ($configuredPort -and ($configuredPort -split '=', 2)[1].Trim().Trim('"', "'") -match '^\d+$') { $Port = [int](($configuredPort -split '=', 2)[1].Trim().Trim('"', "'")) }
if ($Port -lt 1 -or $Port -gt 65535) { throw '服务端口配置无效。' }
Write-NovoraUtf8File -Path (Join-Path $DataRoot 'config\runtime.json') -Content ([ordered]@{ port = $Port; version = (Get-NovoraProductVersion $InstallRoot) } | ConvertTo-Json)
$databaseSettings = Get-NovoraDatabaseSettings $InstallRoot $DataRoot
$DatabasePort = "$($databaseSettings.Port)"
$databasePassword = $databaseSettings.Password
if (Test-Path (Join-Path $postgresRoot "bin\initdb.exe")) {
  if (-not $databasePassword) { throw "缺少数据库密码配置。" }
  Initialize-BundledPostgres $postgresRoot $DataRoot $databasePassword ([int]$DatabasePort) | Out-Null
 } else {
  throw '缺少内置 PostgreSQL 文件，请使用完整安装包。'
}

$acl = Get-Acl $envPath
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM", "FullControl", "Allow")))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("Administrators", "FullControl", "Allow")))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("NT AUTHORITY\LOCAL SERVICE", "Read", "Allow")))
Set-Acl -Path $envPath -AclObject $acl
if (Test-Path "$DataRoot\config\.db-password") { Set-Acl -Path "$DataRoot\config\.db-password" -AclObject $acl }
if (Test-Path "$DataRoot\config\initial-credentials.txt") {
  $credentialsAcl = Get-Acl "$DataRoot\config\initial-credentials.txt"
  $credentialsAcl.SetAccessRuleProtection($true, $false)
  $credentialsAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM", "FullControl", "Allow")))
  $credentialsAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("Administrators", "FullControl", "Allow")))
  Set-Acl -Path "$DataRoot\config\initial-credentials.txt" -AclObject $credentialsAcl
}

$logAcl = Get-Acl "$DataRoot\logs"
$logAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("NT AUTHORITY\LOCAL SERVICE", "Modify", "ContainerInherit,ObjectInherit", "None", "Allow")))
Set-Acl -Path "$DataRoot\logs" -AclObject $logAcl

Write-NovoraProgress -Stage service -Item '检查并注册 Novora 服务'
$hostExe = Join-Path $InstallRoot "NovoraServiceHost.exe"
$nodeExe = Join-Path $InstallRoot "runtime\node.exe"
$entrypoint = Join-Path $InstallRoot "server-build\server\serve.js"
if (-not (Test-Path $hostExe)) { throw "缺少服务宿主：$hostExe" }
if (-not (Test-Path $nodeExe)) { throw "缺少 Node.js 运行时：$nodeExe" }
if (-not (Test-Path $entrypoint)) { throw "缺少 Novora 服务入口：$entrypoint" }

$binPath = '"{0}" --app-root "{1}" --node-path "{2}" --env-file "{3}" --entrypoint "{4}"' -f $hostExe, $InstallRoot, $nodeExe, $envPath, $entrypoint
# The start mode is set here so initialization never needs a second sc config pass;
# that pass was what failed with Windows error 5 and aborted the whole initialization.
$desiredNodeStartMode = if ($ServiceStartupType -eq 'Automatic') { 'Auto' } else { 'Manual' }
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
  # Update in place: deleting/recreating races open SCM handles during upgrades.
  $registration = Get-CimInstance Win32_Service -Filter "Name='Novora'" -ErrorAction Stop
  $changeArguments = @{ PathName = $binPath }
  if ($registration.StartMode -ne 'Disabled' -and $registration.StartMode -ne $desiredNodeStartMode) { $changeArguments.StartMode = $desiredNodeStartMode }
  $changed = Invoke-CimMethod -InputObject $registration -MethodName Change -Arguments $changeArguments
  if ($changed.ReturnValue -ne 0 -and $changeArguments.ContainsKey('StartMode')) {
    # A refused start-mode write must not block the launch-path repair; initialization
    # re-applies the mode afterwards and tolerates the same refusal as a warning.
    Write-NovoraProgress -Stage provision -Item "启动方式未能更新（代码 $($changed.ReturnValue)），仅更新服务启动命令"
    $changed = Invoke-CimMethod -InputObject $registration -MethodName Change -Arguments @{ PathName = $binPath }
  }
  if ($changed.ReturnValue -ne 0) { throw "无法更新 Novora 服务路径（代码 $($changed.ReturnValue)）。" }
} else {
  New-Service -Name $serviceName -BinaryPathName $binPath -DisplayName "Novora School Server" -Description "Novora school LAN server" -StartupType $ServiceStartupType | Out-Null
}
$recovery = Invoke-NovoraNative "$env:SystemRoot\System32\sc.exe" @('failure', $serviceName, 'reset=', '86400', 'actions=', 'restart/10000/restart/30000/restart/60000')
if ($recovery.ExitCode -ne 0) { throw "无法设置 Novora 故障恢复策略（退出码 $($recovery.ExitCode)）：$($recovery.Output)" }
$account = Invoke-NovoraNative "$env:SystemRoot\System32\sc.exe" @('config', $serviceName, 'obj=', 'NT AUTHORITY\LocalService')
if ($account.ExitCode -ne 0) { throw "无法设置 Novora 服务账号（退出码 $($account.ExitCode)）：$($account.Output)" }
$dependency = Invoke-NovoraNative "$env:SystemRoot\System32\sc.exe" @('config', $serviceName, 'depend=', $postgresServiceName)
if ($dependency.ExitCode -ne 0) { throw "无法设置 Novora 数据库服务依赖（退出码 $($dependency.ExitCode)）：$($dependency.Output)" }
Write-NovoraProgress -Stage provision -Item '配置与服务注册完成，继续初始化验证' -Status succeeded -Current 1 -Total 1
try { Stop-Transcript | Out-Null } catch { }
if ($maintenance) { $maintenance.ReleaseMutex(); $maintenance.Dispose(); $maintenance = $null }
