[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OptionsFile,
  [string]$InstallRoot = "$env:ProgramFiles\Novora",
  [string]$DataRoot = "$env:ProgramData\Novora",
  [string]$ResultFile,
  [string]$Version
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "operation-progress.ps1")
$serviceName = "Novora"
$postgresServiceName = "NovoraPostgreSQL"
$firewallRuleName = "Novora LAN Server"
# Non-fatal items the operator should see; only a thrown error below is a failed run.
$warnings = @()
$applied = @()
if (-not $Version) { $Version = Get-NovoraProductVersion $InstallRoot }
$logDirectory = Join-Path $DataRoot "logs"
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$transcriptPath = Join-Path $logDirectory "initialize.log"
try { Start-Transcript -Path $transcriptPath -Append | Out-Null } catch { }

trap {
  $errorText = Protect-NovoraMessage $_.Exception.Message
  Write-Host (Protect-NovoraMessage $_.ScriptStackTrace)
  Write-NovoraProgress -Stage $script:NovoraStage -Item $script:NovoraItem -Status failed -Message $errorText
  try {
    if ($ResultFile) {
      $failure = [ordered]@{ ok = $false; error = $errorText; applied = $applied; warnings = $warnings; completedAt = (Get-Date).ToString("o") } | ConvertTo-Json -Depth 4
      Write-NovoraUtf8File -Path $ResultFile -Content $failure
    }
  } catch { }
  try { Stop-Transcript | Out-Null } catch { }
  Write-Error $errorText -ErrorAction Continue
  if ($maintenance) { $maintenance.ReleaseMutex(); $maintenance.Dispose(); $maintenance = $null }
  exit 1
}

function Assert-Administrator {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "应用 Windows 设置需要管理员权限。"
  }
}

function Get-ServiceState([string]$Name) {
  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $service) { return "NotInstalled" }
  return $service.Status.ToString()
}

function Get-AdminCredentialState([string]$PostgresRoot, [string]$DataRoot) {
  $psql = Join-Path $PostgresRoot "bin\psql.exe"
  $databasePasswordPath = Join-Path $DataRoot "config\.db-password"
  $envPath = Join-Path $DataRoot "config\.env"
  if (-not (Test-Path -LiteralPath $psql) -or -not (Test-Path -LiteralPath $databasePasswordPath)) { return "unknown" }
  $databasePort = 55432
  try {
    $databaseUrl = Get-Content -LiteralPath $envPath -ErrorAction Stop | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
    if ($databaseUrl) {
      $uri = [Uri](($databaseUrl -split '=', 2)[1].Trim())
      if ($uri.Port -gt 0) { $databasePort = $uri.Port }
    }
  } catch { return "unknown" }

  $previousPassword = $env:PGPASSWORD
  $previousConnectTimeout = $env:PGCONNECT_TIMEOUT
  $previousPreference = $ErrorActionPreference
  try {
    $env:PGCONNECT_TIMEOUT = '3'
    $ErrorActionPreference = 'Continue'
    $env:PGPASSWORD = (Get-Content -LiteralPath $databasePasswordPath -Raw -ErrorAction Stop).Trim()
    if ([string]::IsNullOrWhiteSpace($env:PGPASSWORD)) { return "unknown" }
    $common = @('-X', '-w', '-qAt', '-h', '127.0.0.1', '-p', "$databasePort", '-U', 'novora', '-d', 'novora')
    $tableState = Invoke-NovoraNative -FilePath $psql -Arguments ($common + @('-F', '|', '-c', "SELECT (to_regclass('public.app_auth') IS NOT NULL)::int, (to_regclass('public.app_users') IS NOT NULL)::int")) -TimeoutSeconds 10
    if ($tableState.ExitCode -ne 0) { return "unknown" }
    $flags = ($tableState.Output.Trim() -split '\|')
    if ($flags.Count -lt 2) { return "unknown" }
    $initialized = $false
    if ($flags[0] -eq '1') {
      $authState = Invoke-NovoraNative -FilePath $psql -Arguments ($common + @('-c', 'SELECT EXISTS(SELECT 1 FROM app_auth WHERE id=1 AND initialized_at IS NOT NULL)')) -TimeoutSeconds 10
      if ($authState.ExitCode -ne 0) { return "unknown" }
      $initialized = ($authState.Output.Trim() -eq 't')
    }
    if (-not $initialized -and $flags[1] -eq '1') {
      $userState = Invoke-NovoraNative -FilePath $psql -Arguments ($common + @('-c', 'SELECT EXISTS(SELECT 1 FROM app_users)')) -TimeoutSeconds 10
      if ($userState.ExitCode -ne 0) { return "unknown" }
      $initialized = ($userState.Output.Trim() -eq 't')
    }
    return $(if ($initialized) { "initialized" } else { "uninitialized" })
  } catch {
    return "unknown"
  } finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGCONNECT_TIMEOUT = $previousConnectTimeout
    $ErrorActionPreference = $previousPreference
  }
}

function Set-ServiceStartMode([string]$Name, [string]$Mode, [string]$Label) {
  $service = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
  if (-not $service) {
    throw "未找到 $Label（$Name），请重试初始化，仍失败时检查初始化日志。"
  }
  # Provision registers the service in the requested mode, so the common case needs
  # no write at all. delayed-auto always re-applies: CIM cannot report the delay flag.
  $alreadySet = ($Mode -eq 'demand' -and $service.StartMode -eq 'Manual') -or ($Mode -eq 'auto' -and $service.StartMode -eq 'Auto')
  if ($alreadySet) { $script:applied += "$Label 启动方式：$Mode"; return }
  $result = Invoke-NovoraNative "$env:SystemRoot\System32\sc.exe" @('config', $Name, 'start=', $Mode)
  if ($result.ExitCode -ne 0) {
    # A refused start-mode write must not abort initialization: the service is
    # already registered and still has to be started and health-checked below.
    $hint = if ($result.ExitCode -eq 5) { '管理员操作被 Windows 拒绝。请检查系统事件 7006 和安全软件的服务/注册表防护记录，确认是否阻止修改该服务的启动类型。' } else { '请查看系统服务事件。' }
    $script:warnings += "$Label 启动方式未能改为 $Mode（Windows 错误 $($result.ExitCode)），当前保持 $($service.StartMode)。$hint"
    return
  }
  $script:applied += "$Label 启动方式：$Mode"
}

function New-NovoraShortcut([string]$Path, [string]$Target, [string]$WorkingDirectory, [string]$IconLocation, [string]$Arguments = '') {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $Target
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $WorkingDirectory
  if (Test-Path $IconLocation) { $shortcut.IconLocation = $IconLocation }
  $shortcut.Description = "Novora 学校服务端"
  $shortcut.Save()
  [Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) | Out-Null
  [Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
}

function Get-LanAddresses {
  return @(Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
    ForEach-Object { $_.IPv4Address } |
    Where-Object { $_.IPAddress -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object { $_.IPAddress } |
    Sort-Object -Unique)
}

Write-NovoraProgress -Stage preflight -Item '检查服务、参数与权限'
Assert-Administrator
$maintenance = Enter-NovoraMaintenance $InstallRoot
Assert-NovoraServicePath Novora (Join-Path $InstallRoot 'NovoraServiceHost.exe')
Assert-NovoraServicePath NovoraPostgreSQL (Join-Path $InstallRoot 'postgres\bin\pg_ctl.exe') (Join-Path $DataRoot 'postgres-data')
if (-not (Test-Path -LiteralPath $OptionsFile)) { throw "缺少设置参数文件：$OptionsFile" }
$options = Get-Content -LiteralPath $OptionsFile -Raw | ConvertFrom-Json
$port = if ($null -ne $options.port) { [int]$options.port } else { 3000 }
if ($port -lt 1 -or $port -gt 65535) { throw '端口必须为 1–65535。' }
$backupKeep = if ($null -ne $options.backupKeep) { [int]$options.backupKeep } else { 14 }
if ($backupKeep -lt 1 -or $backupKeep -gt 365) { throw '备份保留份数必须为 1–365。' }
$provisionScript = Join-Path $PSScriptRoot 'provision-services.ps1'
if (-not (Test-Path -LiteralPath $provisionScript -PathType Leaf)) { throw '缺少初始化服务组件，请使用完整安装目录。' }
$envPath = Join-Path $DataRoot 'config\.env'
# Existing configuration must pass ownership checks before provisioning changes.
if (Test-Path -LiteralPath $envPath -PathType Leaf) { Get-NovoraDatabaseSettings $InstallRoot $DataRoot | Out-Null }
$previousServiceRunning = (Get-Service -Name $serviceName -ErrorAction SilentlyContinue).Status -eq 'Running'
$oldEnvText = if (Test-Path -LiteralPath $envPath) { [IO.File]::ReadAllText($envPath) } else { '' }
$portMatch = [regex]::Match($oldEnvText, '(?m)^\s*PORT\s*=\s*["'']?(\d+)')
$oldPort = if ($portMatch.Success) { [int]$portMatch.Groups[1].Value } else { 3000 }
if (($port -ne $oldPort -or -not $previousServiceRunning) -and [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains $port) {
  throw "端口 $port 已被占用，请选择其它端口。尚未应用设置。"
}
function Write-EnvAtomic([string]$Text) {
  $temporary = "$envPath.$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    [IO.File]::WriteAllText($temporary, $Text, (New-Object Text.UTF8Encoding($false)))
    [IO.File]::Replace($temporary, $envPath, [NullString]::Value)
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

# Only invalidate a previous completion after ownership/configuration checks and
# while holding maintenance. A failed reinitialization must not retain success.
$initializedPath = Join-Path $DataRoot 'config\windows-initialized.json'
if (Test-Path -LiteralPath $initializedPath) {
  $previousInitialization = [IO.File]::ReadAllText($initializedPath) | ConvertFrom-Json
  $previousInitialization | Add-Member -NotePropertyName completed -NotePropertyValue $false -Force
  $temporary = "$initializedPath.$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    [IO.File]::WriteAllText($temporary, ($previousInitialization | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
    [IO.File]::Replace($temporary, $initializedPath, [NullString]::Value)
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

Write-NovoraProgress -Stage provisioning -Item '准备数据库配置并注册 Windows 服务'
# Register services directly in the requested start mode: a later sc config was
# refused on this machine (error 5) and aborted initialization before verification.
Invoke-NovoraPowerShellScript -FilePath $provisionScript -ScriptArguments @('-InstallRoot', $InstallRoot, '-DataRoot', $DataRoot, '-Port', "$port", '-ServiceStartupType', $(if ($options.serviceAutoStart) { 'Automatic' } else { 'Manual' }), '-DatabaseStartupType', $(if ($options.databaseAutoStart) { 'Automatic' } else { 'Manual' }), '-LockAlreadyHeld')
$applied += '独立数据库配置与 Windows 服务注册：已完成'
$envText = [IO.File]::ReadAllText($envPath)
Get-NovoraDatabaseSettings $InstallRoot $DataRoot | Out-Null

Write-NovoraProgress -Stage configuration -Item '应用服务端口'
if ($port -ne $oldPort) {
  $running = $previousServiceRunning
  $updated = if ([regex]::IsMatch($envText, '(?m)^\s*PORT=')) { [regex]::Replace($envText, '(?m)^\s*PORT=.*$', "PORT=$port") } else { $envText + "`r`nPORT=$port`r`n" }
  try {
    Write-EnvAtomic $updated
    # Service startup is deferred until database identity and SQL are verified.
    $applied += "服务端口：$oldPort → $port"
  } catch {
    Write-EnvAtomic $envText
    if ($running) { try { Start-NovoraInitializedServices -InstallRoot $InstallRoot -DataRoot $DataRoot -Port $oldPort } catch { $warnings += '恢复原端口后服务重启失败，请手动检查。' } }
    throw "端口修改失败，已恢复原配置：$($_.Exception.Message)"
  }
}
Write-NovoraUtf8File -Path (Join-Path $DataRoot 'config\runtime.json') -Content ([ordered]@{ port = $port; version = $Version } | ConvertTo-Json)

Write-NovoraProgress -Stage services -Item '设置服务启动与故障恢复策略'
if ($options.serviceAutoStart) {
  Set-ServiceStartMode $serviceName "delayed-auto" "Novora 服务"
} else {
  Set-ServiceStartMode $serviceName "demand" "Novora 服务"
}

if ($options.databaseAutoStart) {
  Set-ServiceStartMode $postgresServiceName "auto" "PostgreSQL 数据库"
} else {
  Set-ServiceStartMode $postgresServiceName "demand" "PostgreSQL 数据库"
}

if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
  if ($options.serviceAutoRestart) {
    sc.exe failure $serviceName reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Null
  } else {
    # 'none' reliably sets an SC_ACTION_NONE entry in both Windows PowerShell and pwsh.
    sc.exe failure $serviceName reset= 0 actions= none/0 | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw '服务异常重启策略设置失败。' }
  else { $applied += "服务异常自动重启：$([bool]$options.serviceAutoRestart)" }
}

Write-NovoraProgress -Stage firewall -Item '配置局域网防火墙'
if ($options.lanAccess) {
  Get-NetFirewallRule -DisplayName $firewallRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $firewallRuleName -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Any -RemoteAddress LocalSubnet -ErrorAction Stop | Out-Null
  $applied += "局域网访问：已允许 TCP $port（所有网络配置，来源限制为本地子网）"
} else {
  Get-NetFirewallRule -DisplayName $firewallRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  $applied += "局域网访问：已关闭"
}

Write-NovoraProgress -Stage shortcuts -Item '配置快捷方式与登录托盘'
$launcherExe = Join-Path $InstallRoot "NovoraLauncher.exe"
$iconFile = Join-Path $InstallRoot "favicon.ico"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Novora.lnk"
$startMenuFolder = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Novora"
$startMenuShortcut = Join-Path $startMenuFolder "Novora.lnk"
$startupShortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "Novora 托盘.lnk"

if ($options.desktopShortcut) {
  New-NovoraShortcut $desktopShortcut $launcherExe $InstallRoot $iconFile
  $applied += "桌面快捷方式：已创建"
} elseif (Test-Path $desktopShortcut) {
  Remove-Item -LiteralPath $desktopShortcut -Force
  $applied += "桌面快捷方式：已移除"
}

if ($options.startMenuShortcut) {
  New-Item -ItemType Directory -Force -Path $startMenuFolder | Out-Null
  New-NovoraShortcut $startMenuShortcut $launcherExe $InstallRoot $iconFile
  $applied += "开始菜单快捷方式：已创建"
} elseif (Test-Path $startMenuShortcut) {
  Remove-Item -LiteralPath $startMenuShortcut -Force
  $applied += "开始菜单快捷方式：已移除"
}

if ($options.trayStartup -and (Test-Path $launcherExe)) {
  New-NovoraShortcut $startupShortcut $launcherExe $InstallRoot $iconFile '--tray-host'
  $applied += "托盘登录启动：已启用"
  if (-not (Get-Process -Name NovoraTray -ErrorAction SilentlyContinue)) {
    if (-not (Start-NovoraShellShortcut $startupShortcut)) {
      $warnings += '未能交给 Windows 资源管理器启动托盘，本次已按当前权限直接启动；重新登录后会按登录启动托盘。'
      Start-Process -FilePath $launcherExe -ArgumentList '--tray-host' -WorkingDirectory $InstallRoot -WindowStyle Hidden
    }
  }
} elseif (Test-Path $startupShortcut) {
  Remove-Item -LiteralPath $startupShortcut -Force
  $applied += "托盘登录启动：已关闭"
}

Write-NovoraProgress -Stage backup -Item '配置自动备份计划'
if ($null -ne $options.backupDaily) {
  if ($options.backupDaily) {
    $backupScript = Join-Path $InstallRoot 'backup.ps1'
    if (-not (Test-Path -LiteralPath $backupScript)) { throw '缺少备份脚本，无法创建自动备份计划。' }
    $backupRoot = Join-Path $DataRoot 'backups'
    $backupCommand = "& '$($backupScript.Replace("'", "''"))' -InstallRoot '$($InstallRoot.Replace("'", "''"))' -DataRoot '$($DataRoot.Replace("'", "''"))' -BackupRoot '$($backupRoot.Replace("'", "''"))' -Keep $backupKeep"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("`$ErrorActionPreference='Stop'; try { $backupCommand; exit 0 } catch { exit 1 }"))
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand $encoded"
    $trigger = New-ScheduledTaskTrigger -Daily -At '02:00'
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName 'Novora Daily Backup' -Action $action -Trigger $trigger -Principal $principal -Settings $taskSettings -Force | Out-Null
    $applied += "每日备份：02:00，保留最近 $backupKeep 份普通备份"
  } else {
    if (Get-ScheduledTask -TaskName 'Novora Daily Backup' -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName 'Novora Daily Backup' -Confirm:$false }
    $applied += '每日备份：已关闭'
  }
}

Write-NovoraProgress -Stage verification -Item '检查数据库与业务服务状态'
try {
  Start-NovoraInitializedServices -InstallRoot $InstallRoot -DataRoot $DataRoot -Port $port
} catch {
  $verificationFailure = $_.Exception.Message
  if ($port -ne $oldPort -and $oldEnvText) {
    Write-EnvAtomic $oldEnvText
    Write-NovoraUtf8File -Path (Join-Path $DataRoot 'config\runtime.json') -Content ([ordered]@{ port = $oldPort; version = $Version } | ConvertTo-Json)
    if ($previousServiceRunning) {
      try {
        Request-NovoraService $serviceName stop
        Wait-NovoraService $serviceName Stopped service '等待恢复原端口前停止业务服务' 45
        Start-NovoraInitializedServices -InstallRoot $InstallRoot -DataRoot $DataRoot -Port $oldPort
      } catch { $warnings += '恢复原端口后服务重启失败，请手动检查。' }
    }
    throw "服务验证失败，已恢复原端口配置：$verificationFailure"
  }
  throw
}
$applied += '独立数据库连接、Novora 数据库与业务健康检查：已通过'
$configDirectory = Join-Path $DataRoot "config"
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
$completedAt = (Get-Date).ToString("o")
$state = [ordered]@{
  # Reaching this point means every fatal check passed: both services running, the database
  # usable, required files present and the port/configuration valid. Warnings are items the
  # operator still needs to review, and must not invalidate a completed initialization.
  completed  = $true
  completedAt = $completedAt
  version    = $Version
  installRoot = $InstallRoot
  dataRoot   = $DataRoot
  port       = $port
  settings   = $options
}
$localUrl = "http://127.0.0.1:$port"
$lanUrls = @(Get-LanAddresses | ForEach-Object { "http://${_}:$port" })
$result = [ordered]@{
  ok              = $true
  completedAt     = $completedAt
  version         = $Version
  port            = $port
  localUrl        = $localUrl
  lanUrls         = $lanUrls
  serviceState    = (Get-ServiceState $serviceName)
  databaseState   = (Get-ServiceState $postgresServiceName)
  lanAccess       = [bool]$options.lanAccess
  trayStartup     = [bool]$options.trayStartup
  desktopShortcut = [bool]$options.desktopShortcut
  startMenuShortcut = [bool]$options.startMenuShortcut
  applied         = $applied
  warnings        = $warnings
}
# Never show a stored bootstrap password as if it were newly generated. Once the
# application database has an initialized admin, that password may be stale and
# Windows reinitialization does not reset the Novora account.
Write-NovoraProgress -Stage account -Item '检查管理员账户初始化状态'
$credentialState = Get-AdminCredentialState (Join-Path $InstallRoot "postgres") $DataRoot
$result.adminCredentialState = $credentialState
$credentialsPath = Join-Path $DataRoot "config\initial-credentials.txt"
if ($credentialState -eq "uninitialized" -and (Test-Path -LiteralPath $credentialsPath)) {
  try {
    $passwordLine = Get-Content -LiteralPath $credentialsPath -ErrorAction Stop |
      Where-Object { $_ -match '^ADMIN_PASSWORD=' } | Select-Object -First 1
    if ($passwordLine) { $result.adminPassword = ($passwordLine -split '=', 2)[1].Trim() }
  } catch { $warnings += "无法读取初始化凭据：$($_.Exception.Message)" }
}
$result.warnings = $warnings
Write-NovoraUtf8File -Path (Join-Path $configDirectory 'windows-initialized.json') -Content ($state | ConvertTo-Json -Depth 6)
if ($ResultFile) { Write-NovoraUtf8File -Path $ResultFile -Content ($result | ConvertTo-Json -Depth 6) }
if ($warnings.Count -gt 0) {
  Write-NovoraProgress -Stage complete -Item "Windows 设置已应用，$($warnings.Count) 项需要留意" -Status succeeded -Current 1 -Total 1
  Write-Warning '服务与数据库已通过验证；下列项目需要检查，可在修复后重新运行初始化。'
} else {
  Write-NovoraProgress -Stage complete -Item 'Windows 设置与服务健康检查完成' -Status succeeded -Current 1 -Total 1
}
Write-Host 'Novora Windows 设置已应用。'
$applied | ForEach-Object { Write-Host " - $_" }
$warnings | ForEach-Object { Write-Warning $_ }
try { Stop-Transcript | Out-Null } catch { }

if ($maintenance) { $maintenance.ReleaseMutex(); $maintenance.Dispose(); $maintenance = $null }
