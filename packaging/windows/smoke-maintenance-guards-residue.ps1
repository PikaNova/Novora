#requires -Version 5.1
# Guards backup/restore against half-finished updates and proves uninstall reports deletion failures.
# Everything runs against a temporary fake InstallRoot/DataRoot; Windows services, the firewall,
# the Task Scheduler, process enumeration and external executables are stubbed, so the machine's
# installed Novora instance is never stopped, unregistered or deleted.
[CmdletBinding()]
param(
  [ValidateSet('all', 'guard', 'guard-child', 'residue-worker')][string]$Scenario = 'all',
  [string]$FixtureRoot = '',
  [ValidateSet('backup', 'restore-backup')][string]$Operation = 'backup',
  [ValidateSet('clean', 'locked-data', 'firewall-denied')][string]$FailureMode = 'clean',
  [string]$SummaryFile = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Assert($Condition, $Description) { if (-not $Condition) { throw "FAILED: $Description" }; Write-Output "PASS: $Description" }
function Get-SelfHostExecutable {
  $path = $null
  try { $path = (Microsoft.PowerShell.Management\Get-Process -Id $PID).Path } catch { }
  if (-not $path) { $path = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe' }
  return $path
}
function Invoke-ChildPowerShell {
  param([string]$HostExecutable, [string[]]$Arguments)
  # 子进程的 stderr 在 Stop 下会变成终止错误，这里按文本采集，退出码另行读取。
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $HostExecutable @Arguments 2>&1
    return @{ ExitCode = $LASTEXITCODE; Text = ($output | Out-String) }
  } finally { $ErrorActionPreference = $previous }
}
function New-Fixture([string]$Root) {
  $install = Join-Path $Root 'install'
  $data = Join-Path $Root 'data'
  New-Item -ItemType Directory -Force -Path (Join-Path $install 'postgres\bin'), (Join-Path $install 'updater'), (Join-Path $data 'config'), (Join-Path $data 'backups') | Out-Null
  foreach ($tool in @('pg_dump.exe', 'pg_restore.exe')) { [IO.File]::WriteAllText((Join-Path $install "postgres\bin\$tool"), 'stub-not-executable') }
  [IO.File]::WriteAllText((Join-Path $data 'config\.env'), 'DATABASE_URL=postgresql://novora:not-a-password@127.0.0.1:5433/novora')
  [IO.File]::WriteAllText((Join-Path $data 'config\.db-password'), 'not-a-password-0123456789')
  [IO.File]::WriteAllText((Join-Path $data 'backups\novora-fixture.dump'), 'novora fixture dump')
  return @{ install = $install; data = $data }
}
function Set-UpdatePhase([string]$InstallRoot, [string]$Phase) {
  $path = Join-Path $InstallRoot 'updater\state.json'
  if ([string]::IsNullOrWhiteSpace($Phase)) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
  else { [IO.File]::WriteAllText($path, (@{ phase = $Phase; targetVersion = '2.8.2' } | ConvertTo-Json -Compress)) }
}
function Get-BackupParameters([hashtable]$Fixture) { return @{ InstallRoot = $Fixture.install; DataRoot = $Fixture.data; BackupRoot = (Join-Path $Fixture.data 'backups') } }
function Get-RestoreParameters([hashtable]$Fixture) { return @{ BackupFile = (Join-Path $Fixture.data 'backups\novora-fixture.dump'); InstallRoot = $Fixture.install; DataRoot = $Fixture.data } }
function Get-ScriptFailureText([string]$Name, [hashtable]$Parameters) {
  try { & (Join-Path $PSScriptRoot "$Name.ps1") @Parameters 3>&1 4>&1 5>&1 6>&1 | Out-Null; return $null }
  catch { return $_.Exception.Message }
}
function Get-BackupDumpCount([hashtable]$Fixture) {
  return @(Get-ChildItem -LiteralPath (Join-Path $Fixture.data 'backups') -File -Filter 'novora-*').Count
}

function Invoke-GuardScenario([string]$Root) {
  $fixture = New-Fixture $Root
  $install = $fixture.install

  Set-UpdatePhase $install 'switching'
  foreach ($name in @('backup', 'restore-backup')) {
    $parameters = if ($name -eq 'backup') { Get-BackupParameters $fixture } else { Get-RestoreParameters $fixture }
    $text = Get-ScriptFailureText $name $parameters
    Assert ($text -and $text -like '*软件更新尚未完成*') "$name refuses while a software update is in progress: $text"
  }
  Assert ((Get-BackupDumpCount $fixture) -eq 1) 'refused operations wrote no new dump file'

  $hostExecutable = Get-SelfHostExecutable
  foreach ($name in @('backup', 'restore-backup')) {
    Set-UpdatePhase $install 'migrating'
    $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot "$name.ps1"), '-InstallRoot', $install, '-DataRoot', $fixture.data)
    if ($name -eq 'restore-backup') { $arguments += @('-BackupFile', (Join-Path $fixture.data 'backups\novora-fixture.dump')) }
    $child = Invoke-ChildPowerShell $hostExecutable $arguments
    Assert ($child.ExitCode -ne 0) "$name exits non-zero when the update guard fires (exit code $($child.ExitCode))"
    Assert ($child.Text -like '*软件更新尚未完成*') "$name reports the update guard reason to callers"
  }

  # Lock test: no update state at all, so only the shared maintenance lock can stop these scripts.
  # A mutex is thread-recursive, so the contending run must be a separate process.
  Set-UpdatePhase $install ''
  $held = New-Object Threading.Mutex($false, 'Global\Novora.DatabaseMaintenance')
  $acquired = $false
  try { $acquired = $held.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
  Assert $acquired 'smoke holds the shared database maintenance lock'
  try {
    foreach ($name in @('backup', 'restore-backup')) {
      $child = Invoke-ChildPowerShell $hostExecutable @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, `
        '-Scenario', 'guard-child', '-FixtureRoot', $Root, '-Operation', $name)
      Assert ($child.ExitCode -ne 0) "$name exits non-zero while another maintenance operation holds the lock (exit code $($child.ExitCode))"
      Assert ($child.Text -like '*正在执行*') "$name is refused by the maintenance lock: $((($child.Text -split '\r?\n') | Where-Object { $_ }) -join ' ')"
      Assert ($child.Text -notlike '*尚未完成*') "$name passed the update guard before reaching the lock"
    }
  } finally { if ($acquired) { [void]$held.ReleaseMutex() }; $held.Dispose() }
  Assert ((Get-BackupDumpCount $fixture) -eq 1) 'locked operations wrote no new dump file'
}

function Invoke-ResidueWorker([string]$Root, [string]$Mode) {
  $fixture = New-Fixture (Join-Path $Root 'app')
  $fakeProgramData = Join-Path $Root 'programdata'
  $dataTarget = Join-Path $fakeProgramData 'Novora'
  $fakeStartMenu = Join-Path $fakeProgramData 'Microsoft\Windows\Start Menu\Programs\Novora'
  New-Item -ItemType Directory -Force -Path $fakeProgramData, $dataTarget, $fakeStartMenu | Out-Null
  [IO.File]::WriteAllText((Join-Path $dataTarget 'exam-data.txt'), 'occupied by another process')
  foreach ($shortcut in @('Novora.lnk', 'Novora 托盘.lnk')) { [IO.File]::WriteAllText((Join-Path $fakeStartMenu $shortcut), 'stub shortcut') }
  $touchLog = Join-Path $Root 'touch.log'
  [IO.File]::WriteAllText($touchLog, '')
  # $env:TEMP 可能是 8.3 短名，而 Invoke-NovoraNative 用长名建临时目录，这里统一取真实长路径。
  $scratchRoots = @($Root, (Get-Item -LiteralPath $env:TEMP).FullName)
  # 桩函数会从 uninstall.ps1 的脚本作用域里被调用，因此记账必须放在跨脚本可见的全局状态中。
  $state = $global:NovoraSmokeState = @{ Calls = @(); Intercepted = @(); PretendGone = @(); Handle = $null }
  if ($Mode -eq 'locked-data') { $state.Handle = [IO.File]::Open((Join-Path $dataTarget 'exam-data.txt'), 'Open', 'ReadWrite', 'None') }

  # 任何外部程序都不真的启动：sc.exe、pg_*.exe 一律桩化为退出码 0。
  function Start-Process {
    [CmdletBinding()]
    param($FilePath, $ArgumentList, [switch]$PassThru, $WindowStyle, $RedirectStandardOutput, $RedirectStandardError, $UseShellExecute, [switch]$NoNewWindow)
    $global:NovoraSmokeState.Calls += "native|$FilePath"
    foreach ($stream in @($RedirectStandardOutput, $RedirectStandardError)) { if ($stream) { [IO.File]::WriteAllText($stream, '') } }
    $fake = [pscustomobject]@{ ExitCode = 0; Handle = [IntPtr]::Zero }
    $fake | Add-Member ScriptMethod WaitForExit { param($Milliseconds) return $true }
    $fake | Add-Member ScriptMethod Refresh { }
    $fake | Add-Member ScriptMethod Kill { }
    $fake | Add-Member ScriptMethod Dispose { }
    return $fake
  }
  function Get-Service { param($Name, $ErrorAction) $global:NovoraSmokeState.Calls += "service|$Name"; return $null }
  function Get-CimInstance { param([Parameter(Position = 0)]$ClassName, [Parameter(Position = 1)]$Filter, [Parameter(ValueFromRemainingArguments = $true)]$Rest) $global:NovoraSmokeState.Calls += "cim|$ClassName"; return $null }
  function Get-Process { param([Parameter(ValueFromRemainingArguments = $true)]$Rest) $global:NovoraSmokeState.Calls += 'process'; return @() }
  function Stop-Process { param([Parameter(ValueFromRemainingArguments = $true)]$Rest) $global:NovoraSmokeState.Calls += 'stop-process' }
  function Get-NetFirewallRule { param($DisplayName, $ErrorAction) $global:NovoraSmokeState.Calls += "firewall-get|$DisplayName"; if ($Mode -eq 'firewall-denied') { return [pscustomobject]@{ DisplayName = $DisplayName } }; return $null }
  function Remove-NetFirewallRule {
    param($DisplayName, $ErrorAction)
    $global:NovoraSmokeState.Calls += "firewall-remove|$DisplayName"
    if ($Mode -eq 'firewall-denied') { throw (New-Object UnauthorizedAccessException('模拟：防火墙规则删除被拒绝')) }
  }
  function Get-ScheduledTask { param($TaskName, $ErrorAction) $global:NovoraSmokeState.Calls += "task-get|$TaskName"; if ($Mode -eq 'firewall-denied') { return [pscustomobject]@{ TaskName = $TaskName; State = 'Ready' } }; return $null }
  function Unregister-ScheduledTask { param($TaskName, $Confirm, $ErrorAction) $global:NovoraSmokeState.Calls += "task-remove|$TaskName" }
  # 只真删本次 fixture（和临时命令目录）里的文件；其它路径只记账，绝不碰本机已安装实例。
  function Remove-Item {
    [CmdletBinding()]
    param([string]$LiteralPath, [string]$Path, [switch]$Force, [switch]$Recurse)
    $target = if ($LiteralPath) { $LiteralPath } else { $Path }
    $global:NovoraSmokeState.Calls += "remove|$target"
    $isScratch = $false
    foreach ($base in $scratchRoots) { if ($target -and $target.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { $isScratch = $true } }
    if (-not $isScratch) {
      $global:NovoraSmokeState.Intercepted += @($target)
      $global:NovoraSmokeState.PretendGone += @($target)
      return
    }
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $target -Force:$Force -Recurse:$Recurse -ErrorAction Stop
  }
  function Test-Path {
    [CmdletBinding()]
    param([string]$LiteralPath, [string]$Path, [string]$PathType)
    $target = if ($LiteralPath) { $LiteralPath } else { $Path }
    if ($target -and ($target -in $global:NovoraSmokeState.PretendGone)) { return $false }
    if ($PSBoundParameters.ContainsKey('PathType')) { return Microsoft.PowerShell.Management\Test-Path -LiteralPath $target -PathType $PathType }
    return Microsoft.PowerShell.Management\Test-Path -LiteralPath $target
  }

  $previousProgramData = $env:ProgramData
  $env:ProgramData = $fakeProgramData
  $exitCode = 0
  $failureText = $null
  try {
    & (Join-Path $PSScriptRoot 'uninstall.ps1') -InstallRoot $fixture.install -PurgeData
    if ($null -eq $LASTEXITCODE) { $exitCode = 0 } else { $exitCode = $LASTEXITCODE }
  } catch {
    $failureText = $_.Exception.Message
    $exitCode = 1
  } finally {
    $env:ProgramData = $previousProgramData
    if ($state.Handle) { $state.Handle.Dispose(); $state.Handle = $null }
    [IO.File]::WriteAllLines($touchLog, [string[]]@($state.Calls))
    $summary = [ordered]@{
      exitCode = $exitCode
      mode = $Mode
      scriptFailure = $failureText
      dataTarget = $dataTarget
      dataTargetStillExists = (Microsoft.PowerShell.Management\Test-Path -LiteralPath $dataTarget)
      startMenuStillExists = (Microsoft.PowerShell.Management\Test-Path -LiteralPath $fakeStartMenu)
      nativeCalls = @($state.Calls | Where-Object { $_ -like 'native|*' })
      interceptedRemovals = @($state.Intercepted)
      firewallRemovals = @($state.Calls | Where-Object { $_ -like 'firewall-remove|*' })
      taskRemovals = @($state.Calls | Where-Object { $_ -like 'task-remove|*' })
    }
    if ($SummaryFile) { [IO.File]::WriteAllText($SummaryFile, ($summary | ConvertTo-Json -Compress -Depth 5)) }
    Write-Output ('NOVORA_SMOKE_WORKER ' + ($summary | ConvertTo-Json -Compress -Depth 5))
  }
  exit $exitCode
}

$root = if ($FixtureRoot) { $FixtureRoot } else { Join-Path $env:TEMP ('novora-maintenance-' + [Guid]::NewGuid().ToString('N')) }
if (-not (Microsoft.PowerShell.Management\Test-Path -LiteralPath $root)) { New-Item -ItemType Directory -Force -Path $root | Out-Null }

if ($Scenario -eq 'residue-worker') { Invoke-ResidueWorker $root $FailureMode; return }
if ($Scenario -eq 'guard-child') {
  # Runs one maintenance script against the fixture while the parent smoke holds the lock.
  $fixture = New-Fixture $root
  $parameters = if ($Operation -eq 'backup') { Get-BackupParameters $fixture } else { Get-RestoreParameters $fixture }
  & (Join-Path $PSScriptRoot "$Operation.ps1") @parameters
  exit $LASTEXITCODE
}
if ($Scenario -eq 'guard') { Invoke-GuardScenario $root; Write-Output 'MAINTENANCE GUARD SMOKE PASS'; exit 0 }

$hostExecutable = Get-SelfHostExecutable
$failed = $false
$realProgramDataNovora = Join-Path $env:ProgramData 'Novora'
$realInstallNovora = Join-Path $env:ProgramFiles 'Novora'
$realDesktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Novora.lnk'
$realStartupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Novora 托盘.lnk'
$shortcutStateBefore = @((Microsoft.PowerShell.Management\Test-Path -LiteralPath $realDesktopShortcut), (Microsoft.PowerShell.Management\Test-Path -LiteralPath $realStartupShortcut))
$scratchTemp = (Microsoft.PowerShell.Management\Get-Item -LiteralPath $env:TEMP).FullName
$allIntercepted = @()
try {
  Invoke-GuardScenario $root
  Write-Output 'MAINTENANCE GUARD SMOKE PASS'
  foreach ($mode in @('clean', 'locked-data', 'firewall-denied')) {
    $workerRoot = Join-Path $root ("worker-$mode")
    New-Item -ItemType Directory -Force -Path $workerRoot | Out-Null
    $summaryFile = Join-Path $workerRoot 'summary.json'
    $childArguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, `
      '-Scenario', 'residue-worker', '-FixtureRoot', $workerRoot, '-FailureMode', $mode, '-SummaryFile', $summaryFile)
    $child = Invoke-ChildPowerShell $hostExecutable $childArguments
    $code = $child.ExitCode
    $text = $child.Text
    $summary = $null
    if (Microsoft.PowerShell.Management\Test-Path -LiteralPath $summaryFile) { $summary = [IO.File]::ReadAllText($summaryFile) | ConvertFrom-Json }
    $allIntercepted += @($summary.interceptedRemovals)
    Write-Output ("--- {0}: child exit code {1} ---" -f $mode, $code)
    Write-Output $text
    Assert ($summary) "$mode worker wrote a summary"
    Assert ($summary.exitCode -eq $code) "$mode worker reports the same exit code the child process returned"
    Assert ($null -eq $summary.scriptFailure) "$mode uninstall finished without an unexpected error: $($summary.scriptFailure)"
    Assert (@($summary.nativeCalls | Where-Object { $_ -like '*sc.exe' }).Count -eq 2) "$mode service removal was intercepted before sc.exe ran"
    Assert (@($summary.interceptedRemovals | Where-Object { $_.StartsWith($workerRoot, [StringComparison]::OrdinalIgnoreCase) -or $_.StartsWith($scratchTemp, [StringComparison]::OrdinalIgnoreCase) }).Count -eq 0) "$mode deleted the fixture paths for real instead of faking them"
    Assert (Microsoft.PowerShell.Management\Test-Path -LiteralPath $realProgramDataNovora) "$mode left the real ProgramData Novora directory in place"
    Assert (Microsoft.PowerShell.Management\Test-Path -LiteralPath $realInstallNovora) "$mode left the real install directory in place"
    if ($mode -eq 'clean') {
      Assert ($code -eq 0) 'clean uninstall with -PurgeData still exits zero'
      Assert ($text -like '*默认保留数据*') 'clean uninstall keeps the original success message'
      Assert ($text -notlike '*"status":"failed"*') 'clean uninstall publishes no failure event'
      Assert (-not $summary.dataTargetStillExists) 'clean uninstall deletes the temporary data directory'
      Assert (-not $summary.startMenuStillExists) 'clean uninstall deletes the temporary start menu directory'
      Assert (@($summary.firewallRemovals).Count -eq 0) 'clean uninstall skips the absent firewall rule'
    }
    if ($mode -eq 'locked-data') {
      Assert ($code -ne 0) 'locked data directory makes uninstall exit non-zero'
      Assert ($text -like '*卸载残留*' -and $text -like '*业务数据目录*') 'locked data directory is reported as residue'
      Assert ($text -like '*文件被占用*') 'locked data directory reports the in-use reason'
      Assert ($text -like '*"status":"failed"*') 'locked residue reaches the progress event that the installer runner shows'
      Assert ($summary.dataTargetStillExists) 'locked data directory really remains on disk'
    }
    if ($mode -eq 'firewall-denied') {
      Assert ($code -ne 0) 'refused firewall rule removal makes uninstall exit non-zero'
      Assert ($text -like '*防火墙规则*' -and $text -like '*权限不足*') 'refused firewall rule reports the permission reason'
      Assert ($text -like '*"status":"failed"*') 'refused firewall rule reaches the progress event too'
      Assert (@($summary.firewallRemovals).Count -eq 1) 'the existing firewall rule was handed to Remove-NetFirewallRule'
      Assert (@($summary.taskRemovals).Count -eq 1) 'the existing scheduled task was handed to Unregister-ScheduledTask'
    }
  }
  $shortcutStateAfter = @((Microsoft.PowerShell.Management\Test-Path -LiteralPath $realDesktopShortcut), (Microsoft.PowerShell.Management\Test-Path -LiteralPath $realStartupShortcut))
  Assert (($shortcutStateAfter -join ',') -eq ($shortcutStateBefore -join ',')) 'the real desktop and Startup shortcuts are untouched by the mocked uninstall'
  if ($shortcutStateBefore[0]) {
    Assert (@($allIntercepted | Where-Object { $_ -eq $realDesktopShortcut }).Count -ge 1) 'the real desktop shortcut removal request was intercepted instead of executed'
  }
  Write-Output "UNINSTALL RESIDUE SMOKE PASS (fixtures and touch logs under $root)"
} catch {
  Write-Output ('SMOKE FAILED: ' + $_.Exception.Message)
  Write-Output ($_.InvocationInfo.PositionMessage)
  $failed = $true
}
Write-Output "Retained test fixtures and logs: $root"
if ($failed) { exit 1 }
