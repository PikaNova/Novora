[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Stage,
  [Parameter(Mandatory=$true)][string]$Output,
  [Parameter(Mandatory=$true)][string]$Repository,
  [Parameter(Mandatory=$true)][string]$MinimumVersion,
  [Parameter(Mandatory=$true)][string]$NotesFile,
  [Parameter(Mandatory=$true)][string]$SigningKeyFile,
  [string]$SetupFile,
  [string]$SetupUrl
)
$ErrorActionPreference = 'Stop'
if ([bool]$SetupFile -ne [bool]$SetupUrl) { throw 'SetupFile 和 SetupUrl 必须同时提供。' }
$packageArguments = @($Stage, $Output, $Repository, $MinimumVersion, $NotesFile, $SigningKeyFile)
if ($SetupFile) { $packageArguments += @($SetupFile, $SetupUrl) }
dotnet run --project (Join-Path $PSScriptRoot 'Novora.Update.Packager\Novora.Update.Packager.csproj') -c Release -- @packageArguments
if ($LASTEXITCODE -ne 0) { throw '应用更新包构建失败，未发布任何文件。' }
