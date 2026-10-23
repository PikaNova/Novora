param([Parameter(Mandatory = $true)][string]$InstallRoot)
Start-Sleep -Seconds 2
$launcher = Join-Path $InstallRoot 'NovoraLauncher.exe'
if (-not (Test-Path -LiteralPath $launcher)) { exit 0 }

# Inno starts this script with runasoriginaluser, so the control center normally gets the
# interactive user's token. Setup launched from an already elevated process keeps the
# administrator token through that flag, so hand the long-lived wizard to the desktop shell
# instead of starting it as a child of this elevated process.
$identity = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$shell = $null
if ($identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $session = (Get-Process -Id $PID).SessionId
  $shell = Get-Process -Name explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $session } | Select-Object -First 1
}
if ($shell) {
  $shortcutPath = Join-Path ([IO.Path]::GetTempPath()) 'Novora-Windows-Setup.lnk'
  $wshell = New-Object -ComObject WScript.Shell
  $shortcut = $wshell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $launcher
  $shortcut.Arguments = '--windows-setup'
  $shortcut.WorkingDirectory = $InstallRoot
  $shortcut.Save()
  [Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) | Out-Null
  [Runtime.InteropServices.Marshal]::ReleaseComObject($wshell) | Out-Null
  Start-Process -FilePath "$env:SystemRoot\explorer.exe" -ArgumentList ('"' + $shortcutPath + '"')
  exit 0
}
Start-Process -FilePath $launcher -ArgumentList '--windows-setup' -WorkingDirectory $InstallRoot
