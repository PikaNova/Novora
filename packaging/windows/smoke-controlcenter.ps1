[CmdletBinding()]
param([string]$Executable = "$PSScriptRoot\Novora.ControlCenter\bin\Release\net8.0-windows\win-x64\NovoraLauncher.exe")
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$Executable = (Resolve-Path -LiteralPath $Executable).Path
$MutexName = 'Local\Novora.ControlCenter.' + [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value

function Find-ControlCenterWindow {
  param([int]$ProcessId)
  $byProcess = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
  [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $byProcess)
}

function Test-PageVisible {
  param($Window, [string]$Name)
  if (-not $Window) { return $false }
  $element = $Window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Name))
  return [bool]($element -and -not $element.Current.IsOffscreen)
}

function Start-MutexHolder {
  # Owns the single-instance lock without ever serving the activation pipe: what a control center
  # that is exiting, or with a dead listener, looks like from the outside.
  param([string]$Name)
  $readyFile = Join-Path ([System.IO.Path]::GetTempPath()) ('novora-mutex-held-' + [Guid]::NewGuid().ToString('N') + '.txt')
  $body = '$m = [System.Threading.Mutex]::new($false, @@NAME@@); try { $owned = $m.WaitOne(5000) } catch [System.Threading.AbandonedMutexException] { $owned = $true }; if (-not $owned) { exit 3 }; Set-Content -LiteralPath @@READY@@ -Value held -NoNewline; Start-Sleep -Seconds 120'
  $body = $body.Replace('@@NAME@@', "'" + $Name + "'").Replace('@@READY@@', "'" + $readyFile + "'")
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($body))
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -PassThru -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Test-Path -LiteralPath $readyFile) { break }
    if ($process.HasExited) { throw "Mutex holder exited ($($process.ExitCode)) before claiming $MutexName; close the running control center first." }
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $readyFile)) { throw "Mutex holder never claimed $MutexName." }
  [pscustomobject]@{ Process = $process; ReadyFile = $readyFile }
}

function Stop-MutexHolder {
  param($Holder)
  if (-not $Holder) { return }
  # Killing the holder abandons the mutex, the same hard exit a control center would leave behind.
  if (-not $Holder.Process.HasExited) { Stop-Process -Id $Holder.Process.Id }
  Remove-Item -LiteralPath $Holder.ReadyFile -ErrorAction SilentlyContinue
}

$holders = @()
$quiet = $null
$takeover = $null
try {
  $holder = Start-MutexHolder $MutexName
  $holders += $holder
  $quiet = Start-Process -FilePath $Executable -ArgumentList '--status-window' -PassThru -WindowStyle Hidden
  $dialog = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $dialog = Find-ControlCenterWindow -ProcessId $quiet.Id
    if ($dialog) { break }
    if ($quiet.HasExited) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($dialog) { throw "Launch opened a window ('$($dialog.Current.Name)') when the lock holder did not answer the pipe; it must leave the running instance alone without an error." }
  if (-not $quiet.WaitForExit(10000)) { throw 'Launch is still running without a window; expected it to finish quietly.' }
  if ($quiet.ExitCode -ne 0) { throw "Launch exited with $($quiet.ExitCode) when the running instance was unreachable; expected a quiet 0." }
  Write-Output 'Unreachable instance PASS: exits quietly, no startup error dialog'
  Stop-MutexHolder $holder
  $holders = @()

  $holder = Start-MutexHolder $MutexName
  $holders += $holder
  $takeover = Start-Process -FilePath $Executable -ArgumentList '--status-window' -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 800
  Stop-MutexHolder $holder
  $holders = @()
  $takeoverWindow = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 250
    if ($takeover.HasExited) { throw "Launch gave up instead of taking over the lock its holder just released (exit $($takeover.ExitCode))." }
    $takeoverWindow = Find-ControlCenterWindow -ProcessId $takeover.Id
    if ($takeoverWindow) { break }
  }
  if (-not $takeoverWindow) { throw 'Launch never opened a window after the lock holder disappeared.' }
  Write-Output 'Released lock PASS: waiting launch takes over and opens the control center'
} finally {
  foreach ($holder in $holders) { Stop-MutexHolder $holder }
  foreach ($candidate in @($quiet, $takeover)) {
    if ($candidate -and -not $candidate.HasExited) {
      $candidate.CloseMainWindow() | Out-Null
      if (-not $candidate.WaitForExit(5000)) { Stop-Process -Id $candidate.Id }
    }
  }
}

$process = Start-Process -FilePath $Executable -ArgumentList '--status-window' -PassThru -WindowStyle Hidden
try {
  $window = $null
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
    $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    if ($window) {
      $ready = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '运行总览'))
      if ($ready) { break }
    }
    if ($process.HasExited) { throw "Control center exited: $($process.ExitCode)" }
  }
  if (-not $window) { throw 'No control center window; run this smoke check in an interactive Windows desktop session.' }
  # Activation checks run before the wizard gate: they only need a live window, and a page handoff
  # must reach the running instance whether or not the machine passed the environment inspection.
  $handoff = @{
    '--logs' = @{ show = '最近服务日志'; hide = '备份操作结果' }
    '--backups' = @{ show = '备份操作结果'; hide = '最近服务日志' }
    '--updates' = @{ show = '检查更新'; hide = '最近服务日志' }
  }
  foreach ($mode in @('--system-settings', '--status-window', '--windows-setup', '--updates', '--tray-menu', '--overview', '--logs', '--backups')) {
    $second = Start-Process -FilePath $Executable -ArgumentList $mode -PassThru -WindowStyle Hidden
    try {
      if (-not $second.WaitForExit(6000)) { throw "Activation timed out: $mode" }
      if ($second.ExitCode -ne 0) { throw "Activation failed: $mode (exit $($second.ExitCode))" }
      if ($handoff.ContainsKey($mode)) {
        Start-Sleep -Milliseconds 500
        $expected = $handoff[$mode]
        if (-not (Test-PageVisible $window $expected.show)) { throw "Activation did not hand the page over to the running window (expected $mode to show $($expected.show))." }
        if (Test-PageVisible $window $expected.hide) { throw "Activation showed $mode without leaving $($expected.hide) behind; the running window did not switch pages." }
        Write-Output "Page handoff PASS: $mode"
      }
    } finally { if (-not $second.HasExited) { Stop-Process -Id $second.Id } }
    Write-Output "Single instance PASS: $mode"
  }
  # One damaged activation must not end activation handling for the lifetime of the process, so the
  # listener has to serve a normal request again after requests it cannot complete.
  $pipeName = 'Novora.ControlCenter.' + [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value + '.' + $process.SessionId
  foreach ($abuse in @('empty', 'oversized', 'stalled')) {
    $client = [System.IO.Pipes.NamedPipeClientStream]::new('.', $pipeName, [System.IO.Pipes.PipeDirection]::Out)
    try {
      $client.Connect(3000)
      if ($abuse -eq 'oversized') {
        $writer = [System.IO.StreamWriter]::new($client)
        $writer.AutoFlush = $true
        $writer.WriteLine('logs-' + ('x' * 64))
      }
      if ($abuse -eq 'stalled') { Start-Sleep -Seconds 3 }
    } finally {
      if ($client) { $client.Dispose() }
    }
    Write-Output "Malformed activation tolerated: $abuse"
  }
  $afterAbuse = Start-Process -FilePath $Executable -ArgumentList '--logs' -PassThru -WindowStyle Hidden
  try {
    if (-not $afterAbuse.WaitForExit(6000)) { throw 'Activation after malformed traffic timed out.' }
    if ($afterAbuse.ExitCode -ne 0) { throw "Activation after malformed traffic failed (exit $($afterAbuse.ExitCode))." }
    Start-Sleep -Milliseconds 500
    if (-not (Test-PageVisible $window $handoff['--logs'].show)) { throw 'The listener stopped serving activations after a malformed request.' }
    Write-Output 'Listener recovery PASS: activation still works after malformed requests'
  } finally { if (-not $afterAbuse.HasExited) { Stop-Process -Id $afterAbuse.Id } }
  foreach ($label in @('运行总览', '服务日志', '数据备份', 'Windows 设置', '软件更新', '初始化')) {
    $button = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $label))
    if (-not $button) { throw "Missing navigation: $label" }
    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 300
    if ($label -eq 'Windows 设置') {
      $buried = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '检查更新'))
      if ($buried -and -not $buried.Current.IsOffscreen) { throw 'Update actions must live on the 软件更新 page, not inside Windows 设置' }
      Write-Output 'Update panel detached from Windows settings PASS'
    }
    if ($label -eq '软件更新') {
      foreach ($name in @('检查更新', '导入本地更新包', '查看更新记录')) {
        $entry = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $name))
        if (-not $entry) { throw "Missing update action: $name" }
        if (-not (Test-Path -LiteralPath (Join-Path (Split-Path $Executable -Parent) 'updater\trust.json')) -and $name -ne '查看更新记录' -and $entry.Current.IsEnabled) { throw "Untrusted update action must be disabled: $name" }
      }
      if (-not (Test-Path -LiteralPath (Join-Path (Split-Path $Executable -Parent) 'updater\trust.json'))) {
        $notice = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name -like '更新通道尚未启用*' } | Select-Object -First 1
        if (-not $notice) { throw 'Missing disabled update channel explanation (use a complete payload with package.json)' }
      }
      Write-Output 'Update actions and missing-trust disabled state PASS'
    }
    if ($label -eq '初始化') {
      $update = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '检查更新'))
      if ($update -and -not $update.Current.IsOffscreen) { throw 'Update panel must not appear inside initialization wizard' }
    }
    Write-Output "Navigation PASS: $label"
  }
  $next = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '下一步'))
  if (-not $next) { throw 'Missing initialization wizard navigation' }
  $checks = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '检查结果摘要'))
  for ($attempt = 0; $attempt -lt 100; $attempt++) {
    if ($next.Current.IsEnabled) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $next.Current.IsEnabled) { throw 'Environment inspection did not permit continuation; use a complete payload and inspect result rows.' }
  $rows = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '逐项检查结果'))
  if (-not $rows) { throw 'Missing structured environment inspection results' }
  Write-Output 'Structured inspection and successful gate PASS'
  $next.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  Start-Sleep -Milliseconds 300
  $port = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '服务端口'))
  if (-not $port -or $port.Current.IsOffscreen) { throw 'Wizard did not advance to settings' }
  Write-Output 'Wizard check → options PASS (no apply)'
  $process.Refresh()
  $cpuStart = $process.TotalProcessorTime
  Start-Sleep -Seconds 10
  $process.Refresh()
  Write-Output "Idle CPU: $([math]::Round(($process.TotalProcessorTime - $cpuStart).TotalMilliseconds)) ms / 10 s; working set: $([math]::Round($process.WorkingSet64 / 1MB, 1)) MB"
  if ($process.HasExited) { throw 'Control center terminated unexpectedly' }
  Write-Output 'CONTROL CENTER SMOKE: PASS (no service or configuration mutations)'
} finally {
  if (-not $process.HasExited) {
    $process.CloseMainWindow() | Out-Null
    if (-not $process.WaitForExit(5000)) { Stop-Process -Id $process.Id }
  }
}
