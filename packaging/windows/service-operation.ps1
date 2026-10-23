[CmdletBinding()]
param([Parameter(Mandatory = $true)][ValidateSet('start','restart','stop')][string]$Action,
  [string]$InstallRoot = "$env:ProgramFiles\Novora", [int]$Port = 3000,
  [string]$DataRoot = "$env:ProgramData\Novora")
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'operation-progress.ps1')
$maintenance = Enter-NovoraMaintenance $InstallRoot
try {
Write-NovoraProgress -Stage preflight -Item '检查 Novora 服务注册状态'
$service = Get-Service -Name Novora -ErrorAction Stop
Assert-NovoraServicePath Novora (Join-Path $InstallRoot 'NovoraServiceHost.exe')
Assert-NovoraServicePath NovoraPostgreSQL (Join-Path $InstallRoot 'postgres\bin\pg_ctl.exe') (Join-Path $DataRoot 'postgres-data')
if ($Action -in @('start','restart')) {
  $database = Get-Service -Name NovoraPostgreSQL -ErrorAction Stop
  if ($database.Status -ne 'Running') {
    Write-NovoraProgress -Stage database -Item '启动 Novora 独立数据库'
    Request-NovoraService NovoraPostgreSQL start
    Wait-NovoraService NovoraPostgreSQL Running database '等待 PostgreSQL 服务启动' 45
  }
  if ($Action -eq 'restart') {
    Write-NovoraProgress -Stage service -Item '重启 Novora 服务'
    Request-NovoraService Novora stop
    Wait-NovoraService Novora Stopped service '等待 Novora 服务停止' 45
    Request-NovoraService Novora start
  } else {
    Write-NovoraProgress -Stage service -Item '启动 Novora 服务'
    if ($service.Status -ne 'Running') { Request-NovoraService Novora start }
  }
  Wait-NovoraService Novora Running service '等待 Novora 服务运行' 45
  Wait-NovoraHealth -Port $Port -TimeoutSeconds 90
} else {
  Write-NovoraProgress -Stage service -Item '停止 Novora 服务'
  Request-NovoraService Novora stop
  Wait-NovoraService Novora Stopped service '等待 Novora 服务停止' 45
}
Write-NovoraProgress -Stage complete -Item '服务操作完成' -Status succeeded -Current 1 -Total 1

} finally { $maintenance.ReleaseMutex(); $maintenance.Dispose() }
