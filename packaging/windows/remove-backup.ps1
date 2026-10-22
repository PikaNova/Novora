[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BackupFile, [string]$InstallRoot = "$env:ProgramFiles\Novora", [string]$DataRoot = "$env:ProgramData\Novora")
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot "operation-progress.ps1")
Write-NovoraProgress -Stage delete -Item "删除所选备份"
$backupRoot = [IO.Path]::GetFullPath((Join-Path $DataRoot 'backups'))
$target = [IO.Path]::GetFullPath($BackupFile)
if (-not $target.StartsWith($backupRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($target) -notmatch '^novora-[\w-]+\.dump$') { throw '只能删除 Novora 备份目录内的备份文件。' }
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw '备份文件不存在。' }
Remove-Item -LiteralPath $target -Force
Write-Output "已删除备份：$([IO.Path]::GetFileName($target))"
