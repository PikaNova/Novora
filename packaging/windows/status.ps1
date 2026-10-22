[CmdletBinding()]
param([int]$Port = 3000)
$service = Get-Service -Name Novora -ErrorAction SilentlyContinue
$db = Get-Service -Name NovoraPostgreSQL -ErrorAction SilentlyContinue
Write-Host ("Novora service: " + ($(if ($service) { $service.Status } else { "Not installed" })))
Write-Host ("PostgreSQL service: " + ($(if ($db) { $db.Status } else { "Not installed" })))
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
  $health | ConvertTo-Json -Depth 5
} catch {
  Write-Warning "健康检查失败：$($_.Exception.Message)"
  exit 1
}
