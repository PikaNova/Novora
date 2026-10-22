# Windows PowerShell 5.1; all executables are disposable synthetic fixtures.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'operation-progress.ps1')
$root = Join-Path $env:TEMP ('novora-native-check-' + [Guid]::NewGuid().ToString('N') + " space's")
New-Item -ItemType Directory -Path $root | Out-Null
$exe = Join-Path $root 'native fixture.exe'
$name = 'NativeFixture' + [Guid]::NewGuid().ToString('N')
$source = @'
using System;
using System.Text;
using System.Threading;
public class CLASSNAME {
  public static int Main(string[] args) {
    if (args.Length > 0 && args[0] == "wait") { Thread.Sleep(10000); return 0; }
    if (args.Length > 0 && args[0] == "flood") {
      string line = new string('x', 1024);
      for (int i=0; i<128; i++) { Console.Out.WriteLine(line); Console.Error.WriteLine(line); }
      Console.Out.WriteLine("stdout-complete"); Console.Error.WriteLine("stderr-complete"); return 0;
    }
    if (args.Length > 0 && args[0] == "utf8") {
      byte[] bytes = Encoding.UTF8.GetBytes("中文输出");
      using (var output = Console.OpenStandardOutput()) output.Write(bytes, 0, bytes.Length);
      return 0;
    }
    if (args.Length > 0 && args[0] == "oem") {
      byte[] bytes = new byte[] { 0xB1, 0xED, 0xCA, 0xD4 };
      using (var output = Console.OpenStandardOutput()) output.Write(bytes, 0, bytes.Length);
      return 0;
    }
    foreach (string arg in args) Console.Out.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(arg)));
    Console.Error.WriteLine("fixture-stderr"); return 7;
  }
}
'@
Add-Type -TypeDefinition $source.Replace('CLASSNAME', $name) -OutputType ConsoleApplication -OutputAssembly $exe
function Assert($condition, $description) { if (-not $condition) { throw $description }; Write-Output "PASS: $description" }
try {
  $arguments = @('', 'one two', "single'quote", 'double"quote', 'C:\space path\', 'embedded\"quote', '中文参数', '$literal; & no shell')
  $result = Invoke-NovoraNative $exe $arguments
  Assert ($result.ExitCode -eq 7 -and $result.Output.Contains('fixture-stderr')) 'nonzero exit and stderr remain inspectable under ErrorActionPreference Stop'
  $actual = @($result.Output -split '\r?\n' | Where-Object { $_ -ne 'fixture-stderr' })
  $expected = @($arguments | ForEach-Object { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_)) })
  Assert (($actual -join '|') -eq ($expected -join '|')) 'empty, whitespace, apostrophe, quote, trailing slash, Unicode and shell-looking arguments round-trip exactly'
  $flood = Invoke-NovoraNative $exe @('flood')
  Assert ($flood.ExitCode -eq 0 -and $flood.Output.Contains('stdout-complete') -and $flood.Output.Contains('stderr-complete')) 'simultaneous stdout and stderr above pipe capacity drain without deadlock'
  $utf8 = Invoke-NovoraNative $exe @('utf8')
  Assert ($utf8.ExitCode -eq 0 -and $utf8.Output -eq '中文输出') 'UTF-8 native output decodes unchanged'
  $oemBytes = [byte[]](0xB1, 0xED, 0xCA, 0xD4)
  $oemExpected = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage).GetString($oemBytes)
  $oem = Invoke-NovoraNative $exe @('oem')
  Assert ($oem.ExitCode -eq 0 -and $oem.Output -eq $oemExpected) 'OEM-encoded native output decodes with the active console code page'
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $timedOut = $false
  try { Invoke-NovoraNative $exe @('wait') -TimeoutSeconds 1 | Out-Null } catch { $timedOut = $true }
  Assert ($timedOut -and $watch.Elapsed.TotalSeconds -lt 5) 'native timeout throws within bound rather than blocking initialization'
  $owned = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
  Assert ($owned.Count -eq 0) 'timeout terminates only the owned synthetic child'
  $after = Invoke-NovoraNative $exe @('after-timeout')
  Assert ($after.ExitCode -eq 7 -and $after.Output.Contains('fixture-stderr')) 'native runner remains usable after timeout'
  Write-Output 'NATIVE PROCESS SMOKE PASS (synthetic executable only)'
} finally { Write-Output "Retained isolated fixtures: $root" }
