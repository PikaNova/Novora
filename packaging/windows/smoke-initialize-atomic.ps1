# Run in Windows PowerShell 5.1; never executes the real initialization entry point.
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('novora-atomic-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$path = Join-Path $PSScriptRoot 'initialize.ps1'
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errors)
if ($errors) { throw $errors[0].Message }
$replacements = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Member.Extent.Text -eq 'Replace' -and $node.Expression.Extent.Text -eq '[IO.File]' }, $true))
if ($replacements.Count -ne 2) { throw 'Expected both production atomic replacements.' }
# Execute the actual production calls against disposable files, including the
# existing initialization-state branch missed by the earlier service smoke.
foreach ($call in $replacements) {
  $temporary = Join-Path $root 'new.tmp'
  $envPath = Join-Path $root 'config.env'
  $initializedPath = Join-Path $root 'windows-initialized.json'
  [IO.File]::WriteAllText($temporary, 'new')
  [IO.File]::WriteAllText($envPath, 'old')
  [IO.File]::WriteAllText($initializedPath, 'old')
  . ([scriptblock]::Create($call.Extent.Text))
  $destination = if ($call.Extent.Text.Contains('$envPath')) { $envPath } else { $initializedPath }
  if ([IO.File]::ReadAllText($destination) -ne 'new' -or (Test-Path -LiteralPath $temporary)) { throw 'Atomic replacement failed.' }
  Write-Output "PASS: production atomic replacement line $($call.Extent.StartLineNumber)"
}
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Set-ServiceStartMode' }, $true)
. ([scriptblock]::Create($definition.Extent.Text))
function Get-CimInstance { param($ClassName, $Filter, $ErrorAction) return [pscustomobject]@{ StartMode = 'Manual' } }
function Get-Service { param($Name, $ErrorAction) return [pscustomobject]@{ Status = 'Stopped' } }
function Invoke-NovoraNative { param($FilePath, $Arguments) return @{ ExitCode = 5; Output = 'access denied' } }
$applied = @()
$warnings = @()
# A refused start-mode write keeps the registered service running, so initialization
# records it as a warning and continues instead of failing the whole run.
Set-ServiceStartMode 'NovoraPostgreSQL' 'auto' 'PostgreSQL'
if ($applied.Count -ne 0) { throw 'A denied startup mode must never be reported as applied.' }
if ($warnings.Count -ne 1 -or $warnings[0] -notmatch '5' -or $warnings[0] -notmatch '7006') { throw 'Denied startup configuration must stay one warning carrying the Windows code and event hint.' }
Write-Output 'PASS: denied startup configuration is one non-fatal warning with Windows code and event hint'

# Completion, and therefore the exit code, must depend on fatal checks only: services,
# database, required files and port/configuration. Warnings stay advisory but visible.
$source = [IO.File]::ReadAllText($path)
if ($source -match '(completed|ok)\s*=\s*\(\s*\$warnings') { throw 'Completion must not be derived from the warning list.' }
if ($source -notmatch 'completed\s*=\s*\$true') { throw 'Initialization must record completion once every fatal check passed.' }
if ($source -notmatch 'ok\s*=\s*\$true') { throw 'The result file must report success once every fatal check passed.' }
if ($source -match 'if\s*\(\s*-not\s+\$result\.ok\s*\)[\s\S]{0,160}exit\s+1') { throw 'A run with warnings only must not exit nonzero.' }
if ($source -notmatch '\$result\.warnings\s*=\s*\$warnings') { throw 'Warnings must stay in the result.' }
if ($source -notmatch 'Write-Warning\s+\$_') { throw 'Warnings must stay visible to the operator.' }
Write-Output 'PASS: completion, result and exit code follow fatal checks; warnings stay advisory and visible'
Write-Output "ATOMIC INITIALIZATION SMOKE PASS; fixture: $root"
