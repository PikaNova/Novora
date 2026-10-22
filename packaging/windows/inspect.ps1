[CmdletBinding()]
param([string]$InstallRoot = "$env:ProgramFiles\Novora", [string]$DataRoot = "$env:ProgramData\Novora")
$ErrorActionPreference = 'Stop'
$warnings = @()
function Read-ServiceConfig([string]$Name) {
  try {
    $item = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction Stop
    if (-not $item) { return @{ state = '未安装'; startMode = 'Unknown'; pid = 0; recovery = '未知' } }
    $recovery = '未知'
    try {
      $key = Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\$Name" -ErrorAction Stop
      if ($key.FailureActions) {
        $bytes = [byte[]]$key.FailureActions
        if ($bytes.Length -ge 20) {
          $count = [BitConverter]::ToUInt32($bytes, 12)
          $offset = [BitConverter]::ToUInt32($bytes, 16)
          $enabled = $false
          for ($index = 0; $index -lt $count -and ($offset + $index * 8 + 8) -le $bytes.Length; $index++) {
            if ([BitConverter]::ToUInt32($bytes, ($offset + $index * 8)) -eq 1) { $enabled = $true }
          }
          $recovery = if ($enabled) { '已启用' } else { '未启用' }
        }
      } else { $recovery = '未启用' }
    } catch { }
    return @{ state = $item.State; startMode = $item.StartMode; pid = $item.ProcessId; recovery = $recovery }
  } catch { return @{ state = '无法读取'; startMode = 'Unknown'; pid = 0; recovery = '未知' } }
}
$firewall = '未知'
$lanAccess = $null
$rules = $null
try {
  $rules = @(Get-NetFirewallRule -DisplayName 'Novora LAN Server' -ErrorAction Stop)
} catch {
  # 定向查询在规则不存在时抛 NotFound，这属于“未配置”；只有真正读不到才记为警告。
  if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { $rules = @() } else { $warnings += '无法读取防火墙，请以管理员身份检查。' }
}
if ($null -ne $rules) {
  if (-not $rules.Count) { $firewall = '未配置'; $lanAccess = $false }
  else {
    $lanAccess = [bool]($rules | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' -and $_.Direction -eq 'Inbound' })
    $firewall = ($rules | ForEach-Object {
      $ports = $_ | Get-NetFirewallPortFilter
      $addresses = $_ | Get-NetFirewallAddressFilter
      "启用=$($_.Enabled); 操作=$($_.Action); 配置=$($_.Profile); 端口=$($ports.LocalPort -join ','); 来源=$($addresses.RemoteAddress -join ',')"
    }) -join [Environment]::NewLine
  }
}
$state = $null
try { $state = Get-Content -LiteralPath (Join-Path $DataRoot 'config\windows-initialized.json') -Raw | ConvertFrom-Json } catch { }
$backupSchedule = '未知'
$backupDaily = $null
$task = $null
try {
  $task = @(Get-ScheduledTask -TaskName 'Novora Daily Backup' -ErrorAction Stop)
} catch {
  if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { $task = @() } else { $warnings += '无法读取自动备份计划。' }
}
if ($null -ne $task) {
  $backupDaily = [bool]($task -and $task.State -ne 'Disabled')
  $backupSchedule = if ($task) { "$($task.State) · $($task.Triggers.StartBoundary -join ', ')" } else { '未配置' }
}
$files = @('NovoraServiceHost.exe', 'runtime\node.exe', 'postgres\bin\initdb.exe', 'postgres\bin\pg_ctl.exe', 'postgres\bin\psql.exe', 'postgres\bin\pg_dump.exe', 'postgres\bin\pg_restore.exe', 'server-build\server\serve.js', 'dist\index.html', 'initialize.ps1', 'operation-progress.ps1', 'provision-services.ps1', 'backup.ps1', 'tray\NovoraTray.exe')
[ordered]@{
  service = (Read-ServiceConfig 'Novora')
  database = (Read-ServiceConfig 'NovoraPostgreSQL')
  firewall = $firewall
  lanAccess = $lanAccess
  backupDaily = $backupDaily
  backupSchedule = $backupSchedule
  trayStartup = (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Startup')) 'Novora 托盘.lnk'))
  desktopShortcut = (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Novora.lnk'))
  startMenuShortcut = (Test-Path -LiteralPath (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Novora\Novora.lnk'))
  initialized = [bool]($state -and $state.completed)
  files = @($files | ForEach-Object { @{ name = $_; exists = (Test-Path -LiteralPath (Join-Path $InstallRoot $_) -PathType Leaf); required = ($_ -ne 'tray\NovoraTray.exe') } })
  warnings = $warnings
} | ConvertTo-Json -Depth 6 -Compress
