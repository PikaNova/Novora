# Run with Windows PowerShell 5.1. Every payload file and executable is synthetic.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ('novora-runner-check-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$className = 'Prerequisite' + [Guid]::NewGuid().ToString('N')
$source = '[assembly: System.Reflection.AssemblyFileVersion("14.44.35211.0")] public class ' + $className + ' { public static int Main(string[] args) { string root = System.AppDomain.CurrentDomain.BaseDirectory; System.IO.File.WriteAllText(System.IO.Path.Combine(root, "runtime.marker"), "synthetic"); return int.Parse(System.IO.File.ReadAllText(System.IO.Path.Combine(root, "runtime-exit.txt"))); } }'
Add-Type -TypeDefinition $source -OutputType ConsoleApplication -OutputAssembly (Join-Path $root 'vc_redist.x64.exe')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'operation-progress.ps1') -Destination $root
# Replay the build-time stamp: the runner's pre-install guard compares the installation on
# disk against the installer's own product version, which only exists once it is injected.
# The BOM stays because Windows PowerShell 5.1 cannot decode this helper's Chinese labels
# from a BOM-less script.
$helperPath = Join-Path $root 'operation-progress.ps1'
$versionMarker = "(NovoraProductVersion = ')[^']*(')"
$helperText = [IO.File]::ReadAllText($helperPath)
if ([regex]::Matches($helperText, $versionMarker).Count -ne 1) { throw 'operation-progress.ps1 must hold exactly one injectable version marker.' }
[IO.File]::WriteAllText($helperPath, [regex]::Replace($helperText, $versionMarker, '${1}2.8.1${2}'), (New-Object Text.UTF8Encoding($true)))
# Inject registry values only into a disposable copy. Version comparison,
# process execution and worker failure propagation still run production code.
$runner = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'install-runner.ps1'))
$start = $runner.IndexOf('foreach ($view in @([Microsoft.Win32.RegistryView]')
$end = $runner.IndexOf('if ($bundledVersion -and $installedVersion', $start)
if ($start -lt 0 -or $end -lt $start) { throw 'Runtime registry fixture seam does not match production.' }
$mock = '$installedVersion = if (Test-Path (Join-Path (Split-Path $runtime) "installed-version.txt")) { [version]([IO.File]::ReadAllText((Join-Path (Split-Path $runtime) "installed-version.txt"))) } else { $null };' + "`r`n"
$runner = $runner.Substring(0, $start) + $mock + $runner.Substring($end)
[IO.File]::WriteAllText((Join-Path $root 'install-runner.ps1'), $runner, (New-Object Text.UTF8Encoding($true)))
@'
param($InstallRoot, $DesktopPath)
[IO.File]::WriteAllText((Join-Path $InstallRoot 'shortcut.marker'), 'created')
'@ | Set-Content -LiteralPath (Join-Path $root 'shortcuts.ps1') -Encoding UTF8
function Run-Fixture([string]$Ending, [bool]$ShouldSucceed, [string]$InstalledVersion = '', [int]$RuntimeExit = 0) {
  $script = @'
param($InstallRoot, $DataRoot, [switch]$NoTray, [switch]$NoInitialize, [switch]$NoShortcuts, [switch]$Quiet, [switch]$LockAlreadyHeld)
. (Join-Path $PSScriptRoot 'operation-progress.ps1')
[IO.File]::WriteAllText((Join-Path $InstallRoot 'service.marker'), 'entered')
Write-NovoraProgress -Stage database -Item 'fixture database stage'
'@
  ($script + "`r`n" + $Ending) | Set-Content -LiteralPath (Join-Path $root 'install.ps1') -Encoding UTF8
  foreach ($name in @('service.marker','shortcut.marker','runtime.marker','installed-version.txt')) { [IO.File]::Delete((Join-Path $root $name)) }
  if ($InstalledVersion) { [IO.File]::WriteAllText((Join-Path $root 'installed-version.txt'), $InstalledVersion) }
  [IO.File]::WriteAllText((Join-Path $root 'runtime-exit.txt'), "$RuntimeExit")
  & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'install-runner.ps1') -InstallRoot $root -DataRoot $root -Silent
  $code = $LASTEXITCODE
  $runtimeExpected = -not $InstalledVersion -or [version]$InstalledVersion -lt [version]'14.44.35211.0'
  $serviceExpected = -not $runtimeExpected -or $RuntimeExit -in @(0,1638,3010)
  if ((Test-Path -LiteralPath (Join-Path $root 'service.marker')) -ne $serviceExpected) { throw 'Runtime failure did not prevent service setup.' }
  if ((Test-Path -LiteralPath (Join-Path $root 'runtime.marker')) -ne $runtimeExpected) { throw 'Runtime skip/install mismatch.' }
  if (($code -eq 0) -ne $ShouldSucceed -or (Test-Path -LiteralPath (Join-Path $root 'shortcut.marker')) -ne $ShouldSucceed) {
    throw "Runner failure propagation mismatch: ending=$Ending, exit=$code"
  }
  Write-Output "PASS: runner $Ending (exit $code), installed=$InstalledVersion, runtimeExit=$RuntimeExit, runtimeExecuted=$runtimeExpected, subsequent shortcuts=$ShouldSucceed"
}
try {
  Run-Fixture 'exit 7' $false
  Run-Fixture "throw 'fixture denied'" $false
  Run-Fixture 'exit 0' $true '14.51.36247.0'
  Run-Fixture 'exit 0' $true
  Run-Fixture 'exit 0' $false '' 1603
  Run-Fixture 'exit 0' $true '14.40.33810.0' 1638
  Run-Fixture 'exit 0' $true '' 3010
  # The runtime step appended to a real log through Write-RuntimeStatus: Windows PowerShell 5.1
  # would have created it with a BOM via Add-Content -Encoding UTF8.
  $runtimeLog = Join-Path $root 'logs\runtime-check.log'
  $runtimeBytes = [IO.File]::ReadAllBytes($runtimeLog)
  if ($runtimeBytes[0] -eq 0xEF) { throw 'Runtime status log was created with a BOM.' }
  if ((Get-Content -LiteralPath $runtimeLog).Count -lt 1) { throw 'Runtime status log is empty.' }
  Write-Output "PASS: runtime status log is BOM-free UTF-8 ($((Get-Content -LiteralPath $runtimeLog).Count) lines)"
  Write-Output 'INSTALL RUNNER SMOKE PASS (synthetic payload only)'
} finally { Write-Output "Retained fixtures: $root" }
