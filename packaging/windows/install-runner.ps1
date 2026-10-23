[CmdletBinding()]
param([string]$InstallRoot = "$env:ProgramFiles\Novora", [string]$DataRoot = "$env:ProgramData\Novora", [string]$DesktopPath, [switch]$Silent, [switch]$PrepareOnly, [switch]$LockAlreadyHeld, [switch]$UninstallOnly)
$ErrorActionPreference = 'Stop'
$directory = Join-Path ([IO.Path]::GetTempPath()) ("novora-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$progressPath = Join-Path $directory 'progress.json'
$script:worker = $null
$script:step = 0
$script:exitCode = 1
$script:failed = $false
$script:watch = [Diagnostics.Stopwatch]::StartNew()
function Quote([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
$runtimeCommand = @'
$runtime = __RUNTIME_PATH__
$logDirectory = __LOG_PATH__
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$checkLog = Join-Path $logDirectory 'runtime-check.log'
function Write-RuntimeStatus([string]$Message) {
  # AppendAllText never emits a BOM; Add-Content -Encoding UTF8 creates one on PowerShell 5.1.
  [IO.File]::AppendAllText($checkLog, (("{0:o} {1}" -f [DateTime]::Now, $Message) + "`r`n"), (New-Object Text.UTF8Encoding($false)))
  Write-NovoraProgress -Stage runtime -Item $Message
}
if (-not (Test-Path -LiteralPath $runtime)) { throw "缺少 Windows x64 运行库安装文件：$runtime" }
$bundledText = [Diagnostics.FileVersionInfo]::GetVersionInfo($runtime).FileVersion
$bundledVersion = $null
if ($bundledText -match '(\d+\.\d+\.\d+(?:\.\d+)?)') { $bundledVersion = [version]($Matches[1] + $(if ($Matches[1].Split('.').Count -eq 3) { '.0' } else { '' })) }
$installedVersion = $null
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
  $registry = $null; $key = $null
  try {
    $registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $view)
    $key = $registry.OpenSubKey('SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64')
    if ($key -and [int]$key.GetValue('Installed', 0) -eq 1) {
      $text = [string]$key.GetValue('Version', '')
      if ($text -match '(\d+\.\d+\.\d+(?:\.\d+)?)') {
        $candidate = [version]($Matches[1] + $(if ($Matches[1].Split('.').Count -eq 3) { '.0' } else { '' }))
        if (-not $installedVersion -or $candidate -gt $installedVersion) { $installedVersion = $candidate }
      }
    }
  } catch { Write-RuntimeStatus ("无法读取 x64 运行库版本，将交由安装程序判断：" + $_.Exception.Message) }
  finally { if ($key) { $key.Dispose() }; if ($registry) { $registry.Dispose() } }
}
if ($bundledVersion -and $installedVersion -and $installedVersion -ge $bundledVersion) {
  Write-RuntimeStatus "已安装兼容 x64 运行库 $installedVersion（随包 $bundledVersion），跳过安装"
} else {
  Write-RuntimeStatus "安装 Windows x64 运行库（已安装：$installedVersion；随包：$bundledVersion）"
  $runtimeLog = Join-Path $logDirectory 'vc-runtime-install.log'
  $arguments = '/install /quiet /norestart /log "' + $runtimeLog + '"'
  $p = Start-Process -FilePath $runtime -ArgumentList $arguments -WindowStyle Hidden -PassThru
  $runtimeWatch = [Diagnostics.Stopwatch]::StartNew()
  while (-not $p.WaitForExit(1000)) {
    Write-NovoraProgress -Stage runtime -Item '等待 Windows x64 运行库安装' -ElapsedSeconds ([int]$runtimeWatch.Elapsed.TotalSeconds) -TimeoutSeconds 300
    if ($runtimeWatch.Elapsed.TotalSeconds -ge 300) {
      $p.Dispose()
      throw "运行库安装超过 300 秒。Windows Installer 可能仍在运行，请先检查 $runtimeLog，确认其结束后再重试。"
    }
  }
  $p.Refresh()
  Write-RuntimeStatus "Windows x64 运行库安装结束，退出码 $($p.ExitCode)；详细日志：$runtimeLog"
  if ($p.ExitCode -notin @(0,1638,3010)) { throw "Windows x64 运行库安装失败（退出码 $($p.ExitCode)）。详细日志：$runtimeLog" }
}
'@
$runtimeCommand = $runtimeCommand.Replace('__RUNTIME_PATH__', (Quote (Join-Path $InstallRoot 'vc_redist.x64.exe'))).Replace('__LOG_PATH__', (Quote (Join-Path $DataRoot 'logs')))
$steps = @(
  @{ Label = '检查并安装 Windows 运行库'; Command = $runtimeCommand },
  @{ Label = '完成基础安装（数据库与服务交由初始化）'; Command = 'Invoke-NovoraPowerShellScript -FilePath ' + (Quote (Join-Path $InstallRoot 'install.ps1')) + ' -ScriptArguments @(' + (Quote '-InstallRoot') + ',' + (Quote $InstallRoot) + ',' + (Quote '-DataRoot') + ',' + (Quote $DataRoot) + ',' + (Quote '-NoTray') + ',' + (Quote '-NoInitialize') + ',' + (Quote '-NoShortcuts') + ',' + (Quote '-Quiet') + ',' + (Quote '-LockAlreadyHeld') + ')' },
  @{ Label = '创建桌面和开始菜单快捷方式'; Command = 'Invoke-NovoraPowerShellScript -FilePath ' + (Quote (Join-Path $InstallRoot 'shortcuts.ps1')) + ' -ScriptArguments @(' + (Quote '-InstallRoot') + ',' + (Quote $InstallRoot) + ',' + (Quote '-DesktopPath') + ',' + (Quote $DesktopPath) + ')' }
)
if ($PrepareOnly) {
  $steps = @(@{ Label = '安全停止原有 Novora 服务'; Command = '$root = ' + (Quote $InstallRoot) + '; $data = ' + (Quote $DataRoot) + '; $maintenance = Enter-NovoraMaintenance $root; try { Assert-NovoraServicePath Novora (Join-Path $root "NovoraServiceHost.exe"); Assert-NovoraServicePath NovoraPostgreSQL (Join-Path $root "postgres\bin\pg_ctl.exe") (Join-Path $data "postgres-data"); foreach ($name in @("Novora", "NovoraPostgreSQL")) { $service = Get-Service -Name $name -ErrorAction SilentlyContinue; if (-not $service) { continue }; Write-NovoraProgress -Stage upgrade -Item ("停止 " + $name); Request-NovoraService $name stop; Wait-NovoraService $name Stopped upgrade ("等待 " + $name + " 停止") 45 }; $prefix = [IO.Path]::GetFullPath($root).TrimEnd([char]92) + [char]92; Get-Process -Name NovoraLauncher,NovoraTray -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction Stop } finally { $maintenance.ReleaseMutex(); $maintenance.Dispose() }' })
}
if ($UninstallOnly) {
  $steps = @(@{ Label = '停止并移除 Novora 服务（保留数据）'; Command = 'Invoke-NovoraPowerShellScript -FilePath ' + (Quote (Join-Path $InstallRoot 'uninstall.ps1')) + ' -ScriptArguments @(' + (Quote '-InstallRoot') + ',' + (Quote $InstallRoot) + ',' + (Quote '-LockAlreadyHeld') + ')' })
}
# Inno owns the same OS mutex across file deployment. Direct runner invocation
# instead acquires it below and keeps ownership on this UI thread.
. (Join-Path $PSScriptRoot 'operation-progress.ps1')
$runnerMaintenance = $null
function Start-Step {
  $script:failed = $false
  Remove-Item -LiteralPath $progressPath -Force -ErrorAction SilentlyContinue
  $script:watch.Restart()
  $guard = 'Assert-NovoraUpdateReady ' + (Quote $InstallRoot) + '; '
  if (-not $UninstallOnly) { $guard += 'Assert-NovoraFullInstall ' + (Quote $InstallRoot) + '; ' }
  $command = '$ErrorActionPreference="Stop"; $env:NOVORA_PROGRESS_FILE=' + (Quote $progressPath) + '; . ' + (Quote (Join-Path $PSScriptRoot 'operation-progress.ps1')) + '; try { ' + $guard + $steps[$script:step].Command + '; exit 0 } catch { Write-NovoraProgress -Stage install -Item ' + (Quote $steps[$script:step].Label) + ' -Status failed -Message $_.Exception.Message; exit 1 }'
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $start.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded"
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $script:worker = [Diagnostics.Process]::Start($start)
}
function Read-Progress {
  if (Test-Path -LiteralPath $progressPath) {
    try { return ([IO.File]::ReadAllText($progressPath) | ConvertFrom-Json) } catch { }
  }
  return $null
}
try {
  if (-not $LockAlreadyHeld) { $runnerMaintenance = Enter-NovoraMaintenance $InstallRoot }
  foreach ($entry in $steps) {
    if ($entry.Command.Contains('Enter-NovoraMaintenance $root')) {
      $entry.Command = $entry.Command.Replace('$maintenance = Enter-NovoraMaintenance $root', '$maintenance = $null; Assert-NovoraUpdateReady $root').Replace('$maintenance.ReleaseMutex(); $maintenance.Dispose()', 'if ($maintenance) { $maintenance.ReleaseMutex(); $maintenance.Dispose() }')
    }
  }
  # Each step runs a child PowerShell whose own script waits are bounded at 1200 s;
  # this outer bound catches a child that ignores them and never returns.
  $script:stepTimeoutSeconds = 1500
  if ($Silent) {
    while ($script:step -lt $steps.Count) {
      Start-Step
      while (-not $script:worker.WaitForExit(1000)) {
        if ($script:watch.Elapsed.TotalSeconds -ge $script:stepTimeoutSeconds) {
          Write-NovoraProgress -Stage install -Item $steps[$script:step].Label -Status failed -Message "此步骤超过 $script:stepTimeoutSeconds 秒未完成，已停止等待并结束该步骤进程。"
          try { $script:worker.Kill() } catch { }
          $script:worker.WaitForExit(5000) | Out-Null
          exit 1
        }
      }
      if ($script:worker.ExitCode -ne 0) { exit $script:worker.ExitCode }
      $script:worker.Dispose()
      $script:step++
    }
    exit 0
  }
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [Windows.Forms.Application]::EnableVisualStyles()
  $form = New-Object Windows.Forms.Form
  $form.Text = 'Novora · 服务安装'
  $form.ClientSize = New-Object Drawing.Size(600, 295)
  $form.AutoScaleMode = 'Dpi'
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $heading = New-Object Windows.Forms.Label
  $heading.SetBounds(24, 22, 552, 30)
  $heading.Font = New-Object Drawing.Font('Microsoft YaHei UI', 13)
  $item = New-Object Windows.Forms.Label
  $item.SetBounds(24, 64, 552, 42)
  $bar = New-Object Windows.Forms.ProgressBar
  $bar.SetBounds(24, 114, 552, 12)
  $bar.Style = 'Marquee'
  $detail = New-Object Windows.Forms.Label
  $detail.SetBounds(24, 140, 552, 75)
  $logs = New-Object Windows.Forms.Button
  $logs.Text = '查看日志'
  $logs.SetBounds(24, 237, 110, 34)
  $logs.Add_Click({ Start-Process explorer.exe -ArgumentList ('"' + (Join-Path $DataRoot 'logs') + '"') })
  $retry = New-Object Windows.Forms.Button
  $retry.Text = '重试当前步骤'
  $retry.SetBounds(314, 237, 130, 34)
  $retry.Enabled = $false
  $retry.Add_Click({ $retry.Enabled = $false; $close.Enabled = $false; $bar.Style = 'Marquee'; Start-Step })
  $close = New-Object Windows.Forms.Button
  $close.Text = '退出此步骤'
  $close.SetBounds(458, 237, 118, 34)
  $close.Enabled = $false
  $close.Add_Click({ $form.Close() })
  $form.Controls.AddRange(@($heading, $item, $bar, $detail, $logs, $retry, $close))
  $form.Add_FormClosing({ param($sender, $event) if ($script:worker -and -not $script:worker.HasExited) { $event.Cancel = $true; $detail.Text = '正在配置服务，请等待此步骤完成后退出。' } })
  $timer = New-Object Windows.Forms.Timer
  $timer.Interval = 350
  $timer.Add_Tick({
    try {
      if ($script:failed) { return }
      $heading.Text = "步骤 $($script:step + 1) / $($steps.Count) · $($steps[$script:step].Label)"
      $event = Read-Progress
      $item.Text = if ($event) { $event.item } else { $steps[$script:step].Label }
      $detail.Text = "已等待 $([int]$script:watch.Elapsed.TotalSeconds) 秒" + $(if ($event.timeoutSeconds -gt 0) { " · 当前检查上限 $($event.timeoutSeconds) 秒" } else { ' · 请保持此窗口打开' })
      # Bound the UI path too: without this the window stays uncloseable forever
      # because FormClosing refuses while the worker lives.
      if ($script:worker -and -not $script:worker.HasExited -and $script:watch.Elapsed.TotalSeconds -ge $script:stepTimeoutSeconds) {
        try { $script:worker.Kill() } catch { }
        $script:worker.WaitForExit(5000) | Out-Null
      }
      if (-not $script:worker.HasExited) { return }
      $code = $script:worker.ExitCode
      $script:worker.Dispose()
      $script:worker = $null
      if ($code -ne 0) {
        $script:failed = $true
        $bar.Style = 'Continuous'; $bar.Value = 0
        $detail.Text = "此步骤未完成（退出码 $code）。" + $(if ($event.message) { "`r`n$($event.message)" } else { "`r`n请查看日志，处理后重试。" })
        $retry.Enabled = $true; $close.Enabled = $true
        return
      }
      $script:step++
      if ($script:step -eq $steps.Count) { $script:exitCode = 0; $timer.Stop(); $form.Close(); return }
      Start-Step
    } catch {
      $script:failed = $true
      $detail.Text = '进度显示失败：' + $_.Exception.Message
      $close.Enabled = $true
    }
  })
  $form.Add_Shown({ Start-Step; $timer.Start() })
  $form.ShowDialog() | Out-Null
  $timer.Dispose(); $form.Dispose()
} finally {
  if ($runnerMaintenance) { $runnerMaintenance.ReleaseMutex(); $runnerMaintenance.Dispose() }
  if ($script:worker) { $script:worker.Dispose() }
  foreach ($path in @($progressPath, "$progressPath.tmp")) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -ErrorAction SilentlyContinue }
}
exit $script:exitCode
