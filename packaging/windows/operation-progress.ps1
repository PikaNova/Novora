# Shared by elevated scripts. Progress contains labels only, never command output or credentials.

# build.ps1 replaces the value below with the repository package.json version when it stages
# the payload; an unstamped copy (the repository tree) means "version unknown".
$script:NovoraProductVersion = 'unreleased'

function Get-NovoraProductVersion {
  param([string]$InstallRoot)
  # Mirrors UpdateEngine.ReadActive: an application update switches the active version
  # without touching the root package.json. Returns '' when no source is readable.
  foreach ($name in @('active-version.json', 'package.json')) {
    if (-not $InstallRoot) { break }
    $path = Join-Path $InstallRoot $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    try {
      $payload = [IO.File]::ReadAllText($path) | ConvertFrom-Json
      $version = [string]$payload.version
      if ($version -match '^\d+\.\d+\.\d+$') { return $version }
    } catch { }
  }
  if ($script:NovoraProductVersion -match '^\d+\.\d+\.\d+$') { return $script:NovoraProductVersion }
  return ''
}

function Write-NovoraUtf8File {
  param([Parameter(Mandatory = $true)][string]$Path, [AllowNull()][object]$Content)
  # Windows PowerShell 5.1 writes a BOM for -Encoding UTF8; these files are read by the
  # application, PostgreSQL and the control center, so they must stay plain UTF-8.
  $text = if ($Content -is [array]) { ($Content -join "`r`n") } else { [string]$Content }
  [IO.File]::WriteAllText($Path, $text + "`r`n", (New-Object Text.UTF8Encoding($false)))
}

function Protect-NovoraMessage([string]$Message) {
  $Message = [regex]::Replace($Message, '(?i)postgres(?:ql)?://[^\s]+', '[数据库连接已隐藏]')
  return [regex]::Replace($Message, '(?i)(?:[A-Z_]*PASSWORD)\s*=\s*[^\s]+', '[凭据已隐藏]')
}

function Write-NovoraProgress {
  param([string]$Stage, [string]$Item, [string]$Status = 'running', [int]$Current = 0,
    $Total = $null, [int]$ElapsedSeconds = 0, [int]$TimeoutSeconds = 0, [string]$Message = '')
  $script:NovoraStage = $Stage
  $script:NovoraItem = $Item
  $Message = Protect-NovoraMessage $Message
  $event = [ordered]@{ stage = $Stage; item = $Item; status = $Status; current = $Current; total = $Total;
    elapsedSeconds = $ElapsedSeconds; timeoutSeconds = $TimeoutSeconds; message = $Message }
  $json = $event | ConvertTo-Json -Compress
  Write-Host "NOVORA_PROGRESS:$json"
  if ($env:NOVORA_PROGRESS_FILE) {
    $temporary = "$($env:NOVORA_PROGRESS_FILE).tmp"
    try {
      [IO.File]::WriteAllText($temporary, $json, (New-Object Text.UTF8Encoding($false)))
      Move-Item -LiteralPath $temporary -Destination $env:NOVORA_PROGRESS_FILE -Force
    } catch { Write-Verbose '无法更新进度文件；操作仍会记录最终结果。' }
  }
}

function Assert-NovoraServicePath {
  param([string]$Name, [string]$Executable, [string]$DataDirectory)
  $registration = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction Stop
  if (-not $registration) { return }
  $path = [regex]::Match($registration.PathName, '^\s*(?:"([^"]+)"|(\S+))')
  $registered = if ($path.Groups[1].Success) { $path.Groups[1].Value } else { $path.Groups[2].Value }
  if (-not [IO.Path]::GetFullPath($registered).Equals([IO.Path]::GetFullPath($Executable), [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Name 指向其它安装目录，未修改该服务。"
  }
  if ($DataDirectory) {
    $data = [regex]::Match($registration.PathName, '(?i)(?:^|\s)-D\s+(?:"([^"]+)"|(\S+))')
    $registeredData = if ($data.Groups[1].Success) { $data.Groups[1].Value } else { $data.Groups[2].Value }
    if (-not $data.Success -or -not [IO.Path]::GetFullPath($registeredData).Equals([IO.Path]::GetFullPath($DataDirectory), [StringComparison]::OrdinalIgnoreCase)) {
      throw "$Name 指向其它数据库目录，未修改该服务。"
    }
  }
}

function Assert-NovoraUpdateReady {
  param([string]$InstallRoot)
    $statePath = Join-Path $InstallRoot 'updater\state.json'
    if (Test-Path -LiteralPath $statePath) {
      $state = [IO.File]::ReadAllText($statePath) | ConvertFrom-Json
      if ($state.phase -in @('stopping','migrating','switching','verifying','rolling-back','repair-required')) {
        throw '上次软件更新尚未完成，请先到 Windows 设置中的软件更新区域执行恢复，再重试此操作。'
      }
    }
}

function Assert-NovoraFullInstall {
  param([string]$InstallRoot, [string]$TargetVersion)
  if (-not $TargetVersion) {
    # The installer must compare against its own stamped version, never against the
    # version already on the machine: the pre-copy check is what blocks a downgrade.
    $TargetVersion = Get-NovoraProductVersion
    if (-not $TargetVersion) { throw '此安装包未注入产品版本，无法执行安装版本检查。请使用 build.ps1 生成的完整安装包重试，未覆盖文件。' }
  }
  if (Test-Path -LiteralPath (Join-Path $InstallRoot 'active-version.json')) {
    throw '此安装已有独立活动应用版本，当前完整安装器不支持安全切换到根目录版本。未覆盖文件，请使用应用更新/恢复，或按专门完整升级流程处理。'
  }
  $packagePath = Join-Path $InstallRoot 'package.json'
  if (Test-Path -LiteralPath $packagePath) {
    $package = [IO.File]::ReadAllText($packagePath) | ConvertFrom-Json
    if (-not $package.version -or $package.version -notmatch '^\d+\.\d+\.\d+$') { throw '无法识别已有安装版本，未覆盖文件。' }
    if ([Version]$package.version -gt [Version]$TargetVersion) { throw '现有应用版本高于此完整安装包，禁止降级。未覆盖文件。' }
  }
}

function Enter-NovoraMaintenance {
  param([string]$InstallRoot)
  $mutex = New-Object Threading.Mutex($false, 'Global\Novora.DatabaseMaintenance')
  $locked = $false
  try {
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw '另一个安装、初始化、备份、恢复或更新操作正在执行，请稍后重试。' }
    Assert-NovoraUpdateReady $InstallRoot
    return $mutex
  } catch {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
    throw
  }
}

function ConvertTo-NovoraNativeArgument([string]$Value) {
  # CommandLineToArgvW quoting, including quotes and trailing backslashes.
  return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Start-NovoraShellShortcut([string]$ShortcutPath) {
  # These scripts run elevated, but a long-lived UI must not inherit that token: the desktop
  # shell runs with the interactive user's standard token, so hand the launch over to it.
  $session = (Get-Process -Id $PID).SessionId
  if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $session })) { return $false }
  Start-Process -FilePath "$env:SystemRoot\explorer.exe" -ArgumentList (ConvertTo-NovoraNativeArgument $ShortcutPath) | Out-Null
  return $true
}

function Start-NovoraUserInterface {
  param([Parameter(Mandatory = $true)][string]$Target, [string]$Arguments = '', [Parameter(Mandatory = $true)][string]$WorkingDirectory)
  # explorer resolves a shortcut but ignores arguments appended after the target path, so the
  # handoff carries them in a fixed per-entry-point shortcut under the user's temp directory.
  $tag = ($Arguments -replace '[^A-Za-z0-9._-]', '') -replace '^-+', ''
  if (-not $tag) { $tag = 'launch' }
  $shortcutPath = Join-Path ([IO.Path]::GetTempPath()) ("Novora-$tag.lnk")
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $Target
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Save()
  [Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) | Out-Null
  [Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
  return Start-NovoraShellShortcut $shortcutPath
}

function Invoke-NovoraNative {
  param([string]$FilePath, [string[]]$Arguments, [ValidateRange(1,3600)][int]$TimeoutSeconds = 60)
  $directory = Join-Path ([IO.Path]::GetTempPath()) ('novora-command-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $directory | Out-Null
  $stdout = Join-Path $directory 'stdout.log'
  $stderr = Join-Path $directory 'stderr.log'
  $child = $null
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $parameters = @{ FilePath = $FilePath; PassThru = $true; WindowStyle = 'Hidden'; RedirectStandardOutput = $stdout; RedirectStandardError = $stderr; ErrorAction = 'Stop' }
    if ($Arguments.Count -gt 0) { $parameters.ArgumentList = ($Arguments | ForEach-Object { ConvertTo-NovoraNativeArgument $_ }) -join ' ' }
    # File redirection avoids waiting forever on a pipe inherited by PostgreSQL.
    $child = Start-Process @parameters
    # Retain the process handle before short-lived commands can exit (PS 5.1).
    $processHandle = $child.Handle
    while (-not $child.WaitForExit(500)) {
      if ($watch.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
        # Only terminate this invocation, never unrelated PostgreSQL processes.
        try { $child.Kill() } catch { }
        $child.WaitForExit(5000) | Out-Null
        throw "命令 $([IO.Path]::GetFileName($FilePath)) 超过 $TimeoutSeconds 秒，已停止等待；请查看初始化日志和数据库日志。已有数据已保留。"
      }
      if ($script:NovoraItem) {
        Write-NovoraProgress -Stage $script:NovoraStage -Item $script:NovoraItem -ElapsedSeconds ([int]$watch.Elapsed.TotalSeconds) -TimeoutSeconds $TimeoutSeconds
      }
    }
    $child.Refresh()
    $output = [IO.File]::ReadAllText($stdout)
    $errorOutput = [IO.File]::ReadAllText($stderr)
    return @{ ExitCode = $child.ExitCode; Output = ($output + $errorOutput).TrimEnd() }
  } finally {
    if ($child) { $child.Dispose() }
    foreach ($path in @($stdout, $stderr)) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $directory -ErrorAction SilentlyContinue
  }
}

function Request-NovoraService {
  param([string]$Name, [ValidateSet('start','stop')][string]$Action)
  # sc requests the transition without PowerShell's unbounded pending-state wait.
  $result = Invoke-NovoraNative "$env:SystemRoot\System32\sc.exe" @($Action, $Name)
  $alreadyInState = ($Action -eq 'start' -and $result.ExitCode -eq 1056) -or ($Action -eq 'stop' -and $result.ExitCode -eq 1062)
  if ($result.ExitCode -ne 0 -and -not $alreadyInState) { throw "$Name 无法执行 $Action（Windows 错误 $($result.ExitCode)）。请查看系统服务事件及 Novora 日志。" }
}

function Invoke-NovoraPowerShellScript {
  param([Parameter(Mandatory=$true)][string]$FilePath, [string[]]$ScriptArguments = @(), [ValidateRange(60,7200)][int]$TimeoutSeconds = 1200)
  $commandLine = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $FilePath + '"'
  foreach ($argument in $ScriptArguments) { $commandLine += ' "' + $argument + '"' }
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $start.Arguments = $commandLine
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $child = [Diagnostics.Process]::Start($start)
  if (-not $child) { throw "无法启动脚本：$FilePath" }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    while (-not $child.WaitForExit(1000)) {
      if ($watch.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
        try { $child.Kill() } catch { }
        $child.WaitForExit(5000) | Out-Null
        throw "脚本超过 $TimeoutSeconds 秒仍未完成，已停止等待：$FilePath"
      }
      if ($script:NovoraItem) {
        Write-NovoraProgress -Stage $script:NovoraStage -Item $script:NovoraItem -ElapsedSeconds ([int]$watch.Elapsed.TotalSeconds) -TimeoutSeconds $TimeoutSeconds
      }
    }
    if ($child.ExitCode -ne 0) {
      $detail = ''
      if ($env:NOVORA_PROGRESS_FILE -and (Test-Path -LiteralPath $env:NOVORA_PROGRESS_FILE)) {
        try {
          $snapshotFile = Get-Item -LiteralPath $env:NOVORA_PROGRESS_FILE
          if ($snapshotFile.Length -le 16384) {
            $snapshot = [IO.File]::ReadAllText($snapshotFile.FullName) | ConvertFrom-Json
            if ($snapshot.status -eq 'failed' -and $snapshot.message) { $detail = ': ' + (Protect-NovoraMessage ([string]$snapshot.message)) }
          }
        } catch { }
      }
      throw "脚本执行失败（退出码 $($child.ExitCode)）：$FilePath$detail"
    }
  } finally { $child.Dispose() }
}

function Wait-NovoraService {
  param([string]$Name, [string]$State, [string]$Stage, [string]$Item, [int]$TimeoutSeconds = 45)
  $watch = [Diagnostics.Stopwatch]::StartNew()
  do {
    Write-NovoraProgress -Stage $Stage -Item $Item -ElapsedSeconds ([int]$watch.Elapsed.TotalSeconds) -TimeoutSeconds $TimeoutSeconds
    $service = Get-Service -Name $Name -ErrorAction Stop
    if ($service.Status.ToString() -eq $State) { return }
    Start-Sleep -Milliseconds 500
  } while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds)
  throw "$Name 未能在 $TimeoutSeconds 秒内进入 $State 状态。"
}

function Wait-NovoraHealth {
  param([int]$Port, [int]$TimeoutSeconds = 90)
  $watch = [Diagnostics.Stopwatch]::StartNew()
  do {
    Write-NovoraProgress -Stage 'health' -Item '等待 Novora HTTP 健康检查' -ElapsedSeconds ([int]$watch.Elapsed.TotalSeconds) -TimeoutSeconds $TimeoutSeconds
    try {
      $remaining = [Math]::Max(1, [Math]::Min(3, [Math]::Ceiling($TimeoutSeconds - $watch.Elapsed.TotalSeconds)))
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec $remaining
      if ($health.ok -eq $true) { return }
    } catch { }
    Start-Sleep -Milliseconds 500
  } while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds)
  throw "Novora HTTP 健康检查未能在 $TimeoutSeconds 秒内通过，请查看业务服务日志。"
}


function Get-NovoraDatabaseSettings {
  param([string]$InstallRoot, [string]$DataRoot)
  $envPath = Join-Path $DataRoot 'config\.env'
  $passwordPath = Join-Path $DataRoot 'config\.db-password'
  $psql = Join-Path $InstallRoot 'postgres\bin\psql.exe'
  foreach ($required in @($envPath, $passwordPath, $psql)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "缺少初始化数据库所需文件：$required" }
  }
  $lines = @([IO.File]::ReadAllLines($envPath) | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' })
  if ($lines.Count -ne 1) { throw '数据库连接配置缺失或重复，尚未启动服务。' }
  $value = ($lines[0] -split '=', 2)[1].Trim().Trim('"', "'")
  $uri = $null
  if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref]$uri) -or
      $uri.Scheme -notin @('postgres', 'postgresql') -or
      $uri.Host -notin @('127.0.0.1', 'localhost') -or
      $uri.Port -lt 1 -or $uri.Port -gt 65535 -or $uri.Port -eq 5432 -or
      $uri.AbsolutePath -cne '/novora' -or $uri.Query -or $uri.Fragment) {
    throw '初始化只管理本机 Novora 独立数据库（非 5432）；连接配置不匹配，尚未启动服务。'
  }
  $credentials = $uri.UserInfo -split ':', 2
  $password = [IO.File]::ReadAllText($passwordPath).Trim()
  if ($credentials.Count -ne 2 -or [Uri]::UnescapeDataString($credentials[0]) -cne 'novora' -or
      [string]::IsNullOrWhiteSpace($password) -or [Uri]::UnescapeDataString($credentials[1]) -cne $password) {
    throw '数据库角色或密码文件与连接配置不匹配，尚未启动服务。'
  }
  return @{ Port = $uri.Port; Password = $password; Psql = $psql; DataDirectory = (Join-Path $DataRoot 'postgres-data') }
}

function Start-NovoraInitializedServices {
  param([string]$InstallRoot, [string]$DataRoot, [int]$Port)
  # The caller holds the maintenance lock throughout settings and verification.
  Write-NovoraProgress -Stage database -Item '检查独立数据库连接配置'
  $database = Get-NovoraDatabaseSettings $InstallRoot $DataRoot
  Assert-NovoraServicePath Novora (Join-Path $InstallRoot 'NovoraServiceHost.exe')
  Assert-NovoraServicePath NovoraPostgreSQL (Join-Path $InstallRoot 'postgres\bin\pg_ctl.exe') $database.DataDirectory
  $previousPassword = $env:PGPASSWORD
  $previousTimeout = $env:PGCONNECT_TIMEOUT
  $previousOptions = $env:PGOPTIONS
  try {
    $env:PGPASSWORD = $database.Password
    $env:PGCONNECT_TIMEOUT = '2'
    $env:PGOPTIONS = '-c statement_timeout=30000 -c lock_timeout=10000'
    Write-NovoraProgress -Stage database -Item '通过 Windows 服务账户启动 PostgreSQL'
    $service = Get-Service -Name NovoraPostgreSQL -ErrorAction Stop
    if ($service.Status -eq 'StopPending') { Wait-NovoraService NovoraPostgreSQL Stopped database '等待 PostgreSQL 停止完成' 45; $service = Get-Service -Name NovoraPostgreSQL -ErrorAction Stop }
    if ($service.Status -ne 'Running' -and $service.Status -ne 'StartPending') { Request-NovoraService NovoraPostgreSQL start }
    Wait-NovoraService NovoraPostgreSQL Running database '等待 PostgreSQL 服务启动' 45
    $common = @('-X', '-w', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', "$($database.Port)", '-U', 'novora')
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
      Write-NovoraProgress -Stage database -Item '等待 PostgreSQL 接受实际 SQL 连接' -ElapsedSeconds ([int]$watch.Elapsed.TotalSeconds) -TimeoutSeconds 30
      $probe = Invoke-NovoraNative $database.Psql ($common + @('-d', 'postgres', '-tAc', 'SELECT 1'))
      if ($probe.ExitCode -eq 0 -and $probe.Output.Trim() -eq '1') { break }
      Start-Sleep -Milliseconds 500
    } while ($watch.Elapsed.TotalSeconds -lt 30)
    if ($probe.ExitCode -ne 0 -or $probe.Output.Trim() -ne '1') {
      $detail = Protect-NovoraMessage ($probe.Output.Replace($database.Password, '[凭据已隐藏]'))
      throw "PostgreSQL 在 30 秒内未接受 SQL 连接（退出码 $($probe.ExitCode)）：$detail"
    }
    Write-NovoraProgress -Stage database -Item '校验实际数据库端口、角色和数据目录'
    $identity = Invoke-NovoraNative $database.Psql ($common + @('-d', 'postgres', '-tAc', "SELECT current_user || '|' || inet_server_port() || '|' || current_setting('data_directory')"))
    if ($identity.ExitCode -ne 0) {
      $detail = Protect-NovoraMessage ($identity.Output.Replace($database.Password, '[凭据已隐藏]'))
      throw "数据库身份检查失败（退出码 $($identity.ExitCode)）：$detail"
    }
    $actual = $identity.Output.Trim() -split '\|', 3
    if ($actual.Count -ne 3 -or $actual[0] -cne 'novora' -or $actual[1] -ne "$($database.Port)" -or
        -not [IO.Path]::GetFullPath($actual[2]).TrimEnd('\').Equals([IO.Path]::GetFullPath($database.DataDirectory).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
      throw '实际连接的数据库角色、端口或数据目录与 Novora 注册信息不一致，未创建数据库或启动业务。'
    }
    Write-NovoraProgress -Stage database -Item '检查并准备 Novora 数据库'
    $exists = Invoke-NovoraNative $database.Psql ($common + @('-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname = 'novora'"))
    if ($exists.ExitCode -ne 0) {
      $detail = Protect-NovoraMessage ($exists.Output.Replace($database.Password, '[凭据已隐藏]'))
      throw "数据库检查失败（退出码 $($exists.ExitCode)）：$detail"
    }
    if ($exists.Output.Trim() -ne '1') {
      $created = Invoke-NovoraNative $database.Psql ($common + @('-d', 'postgres', '-c', 'CREATE DATABASE novora'))
      if ($created.ExitCode -ne 0) {
        $detail = Protect-NovoraMessage ($created.Output.Replace($database.Password, '[凭据已隐藏]'))
        throw "创建 Novora 数据库失败（退出码 $($created.ExitCode)）：$detail"
      }
    }
    $verified = Invoke-NovoraNative $database.Psql ($common + @('-d', 'novora', '-tAc', 'SELECT 1'))
    if ($verified.ExitCode -ne 0 -or $verified.Output.Trim() -ne '1') {
      $detail = Protect-NovoraMessage ($verified.Output.Replace($database.Password, '[凭据已隐藏]'))
      throw "Novora 数据库连接验证失败（退出码 $($verified.ExitCode)）：$detail"
    }
  } finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGCONNECT_TIMEOUT = $previousTimeout
    $env:PGOPTIONS = $previousOptions
  }
  Write-NovoraProgress -Stage service -Item '启动 Novora 业务服务'
  $service = Get-Service -Name Novora -ErrorAction Stop
  if ($service.Status -eq 'StopPending') { Wait-NovoraService Novora Stopped service '等待业务服务停止完成' 45; $service = Get-Service -Name Novora -ErrorAction Stop }
  if ($service.Status -ne 'Running' -and $service.Status -ne 'StartPending') { Request-NovoraService Novora start }
  Wait-NovoraService Novora Running service '等待 Novora 业务服务运行' 45
  Wait-NovoraHealth -Port $Port -TimeoutSeconds 90
}
