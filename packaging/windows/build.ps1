[CmdletBinding()]
param(
  [string]$OutputRoot,
  [string]$NodeVersion = "24.18.0",
  [string]$PostgresVersion = "16.10",
  [string]$UpdateTrustFile
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$scriptRoot = Split-Path -Parent $PSCommandPath
$repoRoot = (Resolve-Path (Join-Path $scriptRoot "..\..")).Path
if ([string]::IsNullOrWhiteSpace($OutputRoot)) { $OutputRoot = Join-Path $repoRoot "artifacts\windows" }
$OutputRoot = if ([IO.Path]::IsPathRooted($OutputRoot)) { [IO.Path]::GetFullPath($OutputRoot) } else { [IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputRoot)) }
function Assert-BuildDirectory([string]$Path) {
  $resolved = [IO.Path]::GetFullPath($Path)
  $prefix = $OutputRoot.TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Build directory is outside OutputRoot: $resolved" }
}
$updateTrustText = $null
if ($UpdateTrustFile) {
  $trustSource = (Resolve-Path -LiteralPath $UpdateTrustFile -ErrorAction Stop).Path
  $updateTrustText = [IO.File]::ReadAllText($trustSource)
  $trust = $updateTrustText | ConvertFrom-Json
  if ($trust.repository -ne 'PikaNova/Novora' -or -not $trust.publicKeyPem -or $trust.publicKeyPem -notmatch 'BEGIN PUBLIC KEY') { throw '更新信任配置必须包含 PikaNova/Novora repository 和公钥。' }
  $authorUri = $null
  if (-not $trust.authorBaseUrl -or -not [Uri]::TryCreate([string]$trust.authorBaseUrl, [UriKind]::Absolute, [ref]$authorUri) -or
      $authorUri.Scheme -ne 'https' -or $authorUri.Host -ne 'telemetry.pikachu2026.space' -or $authorUri.Port -ne 443 -or
      $authorUri.AbsolutePath -ne '/' -or $authorUri.UserInfo -or $authorUri.Query -or $authorUri.Fragment) {
    throw '作者端更新地址必须是 https://telemetry.pikachu2026.space/，且不能包含凭据、额外路径、查询参数或片段。'
  }

}
$stage = Join-Path $OutputRoot "stage"
Assert-BuildDirectory $stage
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage, "$stage\runtime", "$stage\server-build", "$stage\config", "$stage\postgres" | Out-Null

# package.json is the only release-version source: it is stamped into the staged scripts and
# passed to Inno Setup, so no installer artifact carries a hand-maintained version.
$releaseVersion = [string]([IO.File]::ReadAllText((Join-Path $repoRoot "package.json")) | ConvertFrom-Json).version
if ($releaseVersion -notmatch '^\d+\.\d+\.\d+$') { throw "package.json version must be major.minor.patch, got: $releaseVersion" }

Push-Location $repoRoot
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
  $env:VITE_SPEED_INSIGHTS = "false"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Web build failed." }
  npm run serve:build
  if ($LASTEXITCODE -ne 0) { throw "Server build failed." }
} finally { Pop-Location }

Copy-Item "$repoRoot\dist" "$stage\dist" -Recurse
Copy-Item "$repoRoot\server-build\*" "$stage\server-build" -Recurse -Force
Copy-Item "$repoRoot\package.json" "$stage\package.json"
Copy-Item "$repoRoot\package-lock.json" "$stage\package-lock.json"
npm ci --omit=dev --prefix $stage
if ($LASTEXITCODE -ne 0) { throw "Publishing Windows payload failed." }

$serviceProject = Join-Path $scriptRoot "Novora.ServiceHost\Novora.ServiceHost.csproj"
dotnet publish $serviceProject -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $stage
if ($LASTEXITCODE -ne 0) { throw "Publishing Windows payload failed." }

$trayProject = Join-Path $scriptRoot "Novora.Tray\Novora.Tray.csproj"
dotnet publish $trayProject -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "$stage\tray"
if ($LASTEXITCODE -ne 0) { throw "Publishing Windows payload failed." }
Copy-Item "$scriptRoot\Assets\favicon.ico" "$stage\tray\favicon.ico" -Force
Copy-Item "$scriptRoot\Assets\favicon.ico" "$stage\favicon.ico" -Force
$launcherProject = Join-Path $scriptRoot "Novora.ControlCenter\Novora.ControlCenter.csproj"
dotnet publish $launcherProject -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -p:IncludeNativeLibrariesForSelfExtract=false -o $stage
if ($LASTEXITCODE -ne 0) { throw "Publishing Windows payload failed." }
$updaterProject = Join-Path $scriptRoot 'Novora.Updater\Novora.Updater.csproj'
dotnet publish $updaterProject -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "$stage\updater"
if ($LASTEXITCODE -ne 0) { throw 'Publishing Windows updater failed.' }
if ($updateTrustText) { [IO.File]::WriteAllText((Join-Path $stage 'updater\trust.json'), $updateTrustText, (New-Object Text.UTF8Encoding($false))) }

New-Item -ItemType Directory -Force -Path "$stage\assets\icons" | Out-Null
Copy-Item "$scriptRoot\Assets\*" "$stage\assets\icons" -Recurse -Force

$nodeZip = Join-Path $OutputRoot "node-v$NodeVersion-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
function Test-ZipArchive([string]$Path) {
  if (-not (Test-Path $Path)) { return $false }
  try {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    $archive.Dispose()
    return $true
  } catch { return $false }
}
if (-not (Test-ZipArchive $nodeZip)) {
  Remove-Item $nodeZip -Force -ErrorAction SilentlyContinue
  Start-BitsTransfer -Source $nodeUrl -Destination $nodeZip
}
$nodeExtract = Join-Path $OutputRoot "node-extract"
Assert-BuildDirectory $nodeExtract
Remove-Item $nodeExtract -Recurse -Force -ErrorAction SilentlyContinue
$null = New-Item -ItemType Directory -Force -Path $nodeExtract
tar.exe -xf $nodeZip -C $nodeExtract
if ($LASTEXITCODE -ne 0) { throw "Failed to extract the Node.js runtime archive." }
Copy-Item (Join-Path $nodeExtract "node-v$NodeVersion-win-x64\node.exe") "$stage\runtime\node.exe"

$postgresZip = Join-Path $OutputRoot "postgresql-$PostgresVersion-1-windows-x64-binaries.zip"
$postgresUrl = "https://get.enterprisedb.com/postgresql/postgresql-$PostgresVersion-1-windows-x64-binaries.zip"
if (-not (Test-ZipArchive $postgresZip)) {
  Remove-Item $postgresZip -Force -ErrorAction SilentlyContinue
  Start-BitsTransfer -Source $postgresUrl -Destination $postgresZip
}
$postgresExtract = Join-Path $OutputRoot "postgres-extract"
Assert-BuildDirectory $postgresExtract
Remove-Item $postgresExtract -Recurse -Force -ErrorAction SilentlyContinue
$null = New-Item -ItemType Directory -Force -Path $postgresExtract
tar.exe -xf $postgresZip -C $postgresExtract
if ($LASTEXITCODE -ne 0) { throw "Failed to extract the PostgreSQL runtime archive." }
$postgresPayload = Get-ChildItem $postgresExtract -Directory | Select-Object -First 1
if (-not $postgresPayload) { throw "PostgreSQL payload is empty after extraction." }
foreach ($runtimeDirectory in @('bin', 'lib', 'share')) {
  $sourceDirectory = Join-Path $postgresPayload.FullName $runtimeDirectory
  if (-not (Test-Path $sourceDirectory)) { throw "PostgreSQL payload is missing $runtimeDirectory." }
  Copy-Item $sourceDirectory -Destination (Join-Path $stage 'postgres') -Recurse -Force
}

$vcRedist = Join-Path $OutputRoot "vc_redist.x64.exe"
if (-not (Test-Path $vcRedist)) {
  Start-BitsTransfer -Source "https://aka.ms/vs/17/release/vc_redist.x64.exe" -Destination $vcRedist
}
Copy-Item $vcRedist $stage

Copy-Item "$scriptRoot\service-operation.ps1", "$scriptRoot\operation-progress.ps1", "$scriptRoot\install-runner.ps1", "$scriptRoot\install.ps1", "$scriptRoot\initialize.ps1", "$scriptRoot\provision-services.ps1", "$scriptRoot\inspect.ps1", "$scriptRoot\shortcuts.ps1", "$scriptRoot\launch-setup.ps1", "$scriptRoot\uninstall.ps1", "$scriptRoot\status.ps1", "$scriptRoot\backup.ps1", "$scriptRoot\validate-backup.ps1", "$scriptRoot\remove-backup.ps1", "$scriptRoot\restore-backup.ps1" $stage

# Stamp the release version into the staged helper. Inno embeds the staged copy of
# operation-progress.ps1 for its pre-install step, so the version must be resolved here
# rather than left as a literal in the scripts.
$versionMarker = "(NovoraProductVersion = ')[^']*(')"
$helperPath = Join-Path $stage "operation-progress.ps1"
$helperText = [IO.File]::ReadAllText($helperPath)
if ([regex]::Matches($helperText, $versionMarker).Count -ne 1) { throw "operation-progress.ps1 must hold exactly one injectable version marker." }
# Keep the BOM: Windows PowerShell 5.1 decodes a BOM-less script with the ANSI code page and
# this helper contains Chinese labels, so dropping it would break parsing of the payload.
[IO.File]::WriteAllText($helperPath, [regex]::Replace($helperText, $versionMarker, ('${1}' + $releaseVersion + '${2}')), (New-Object Text.UTF8Encoding($true)))
if (([IO.File]::ReadAllText($helperPath)) -notmatch [regex]::Escape("`$script:NovoraProductVersion = '$releaseVersion'")) { throw "Failed to stamp the release version into $helperPath." }

Write-Host "Windows payload staged at $stage"
Write-Host "Bundled Node.js $NodeVersion and PostgreSQL $PostgresVersion are included in the payload."

$compiler = Get-Command iscc.exe -ErrorAction SilentlyContinue
if (-not $compiler) {
  $knownCompilerPaths = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
  )
  $compilerPath = $knownCompilerPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($compilerPath) { $compiler = Get-Item $compilerPath }
}
if ($compiler) {
  $compilerCommand = if ($compiler -is [System.IO.FileInfo]) { $compiler.FullName } else { $compiler.Source }
  $installerOutput = Join-Path $OutputRoot "installer"
  New-Item -ItemType Directory -Force -Path $installerOutput | Out-Null
  & $compilerCommand (Join-Path $scriptRoot "Novora.iss") "/DPayloadDir=$stage" "/DInstallerOutputDir=$installerOutput" "/DAppVersion=$releaseVersion"
  if ($LASTEXITCODE -ne 0) { throw "Inno Setup compile failed with exit code $LASTEXITCODE." }
} else {
  Write-Warning "Payload staged; Inno Setup 6 compiler ISCC.exe was not found."
}

