[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BackupFile, [string]$InstallRoot = "$env:ProgramFiles\Novora", [string]$DataRoot = "$env:ProgramData\Novora")
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot "operation-progress.ps1")
Write-NovoraProgress -Stage validation -Item "检查备份归档结构"
$backupRoot = [IO.Path]::GetFullPath((Join-Path $DataRoot 'backups'))
$target = [IO.Path]::GetFullPath($BackupFile)
if (-not $target.StartsWith($backupRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($target) -notmatch '^novora-[\w-]+\.dump$') { throw '只能校验 Novora 备份目录内的备份文件。' }
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw '备份文件不存在。' }
$pgRestore = Join-Path $InstallRoot 'postgres\bin\pg_restore.exe'
if (-not (Test-Path -LiteralPath $pgRestore)) { throw '找不到内置 pg_restore.exe。' }
& $pgRestore --list $target *> $null
if ($LASTEXITCODE -ne 0) { throw "备份无法读取，pg_restore 退出码 $LASTEXITCODE。" }
Write-Output "备份结构正常：$([IO.Path]::GetFileName($target))"
