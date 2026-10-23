#define AppName "Novora School Server"
#ifndef AppVersion
  #error build.ps1 must pass /DAppVersion with the repository package.json version (npm run windows:package)
  #define AppVersion "0.0.0"
#endif
#ifndef PayloadDir
  #define PayloadDir "..\..\artifacts\windows\stage"
#endif
#ifndef InstallerOutputDir
  #define InstallerOutputDir "..\..\artifacts\windows\installer"
#endif

[Setup]
AppId={{4B9F8E0C-7A58-4F2D-BF62-4E9E7F5E8C12}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\Novora
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
OutputDir={#InstallerOutputDir}
OutputBaseFilename=Novora-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
Uninstallable=yes
SetupIconFile=Assets\favicon.ico
UninstallDisplayIcon={app}\favicon.ico

[Files]
; Staged copies, so the runner and its version-stamped helper match the deployed payload.
Source: "{#PayloadDir}\install-runner.ps1"; Flags: dontcopy
Source: "{#PayloadDir}\operation-progress.ps1"; Flags: dontcopy
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Run]
; runasoriginaluser keeps the finish-page wizard off the installer's administrator token.
; Setup started from an already elevated process keeps that token; launch-setup.ps1 detects it.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\launch-setup.ps1"" -InstallRoot ""{app}"""; StatusMsg: "正在启动 Novora 初始化向导..."; Flags: nowait runhidden skipifsilent runasoriginaluser

[Code]
var
  MaintenanceHandle: Integer;

function CreateMutex(lpMutexAttributes: Integer; bInitialOwner: Boolean; lpName: String): Integer;
  external 'CreateMutexW@kernel32.dll stdcall';
function WaitForSingleObject(hHandle: Integer; dwMilliseconds: Integer): Integer;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function ReleaseMutex(hMutex: Integer): Boolean;
  external 'ReleaseMutex@kernel32.dll stdcall';
function CloseHandle(hObject: Integer): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';

procedure ReleaseMaintenance;
begin
  if MaintenanceHandle <> 0 then begin
    ReleaseMutex(MaintenanceHandle);
    CloseHandle(MaintenanceHandle);
    MaintenanceHandle := 0;
  end;
end;

function AcquireMaintenance: Boolean;
var
  WaitCode: Integer;
begin
  Result := True;
  if MaintenanceHandle <> 0 then exit;
  MaintenanceHandle := CreateMutex(0, False, 'Global\Novora.DatabaseMaintenance');
  Result := MaintenanceHandle <> 0;
  if not Result then exit;
  WaitCode := WaitForSingleObject(MaintenanceHandle, 0);
  Result := (WaitCode = 0) or (WaitCode = $80);
  if not Result then begin
    CloseHandle(MaintenanceHandle);
    MaintenanceHandle := 0;
  end;
end;

function RunInstallerStep(const RunnerPath: String; const Extra: String): Boolean;
var
  ResultCode: Integer;
  Parameters: String;
begin
  Parameters := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + RunnerPath + '" -InstallRoot "' + ExpandConstant('{app}') + '" -DesktopPath "' + ExpandConstant('{userdesktop}') + '" ' + Extra + ' -LockAlreadyHeld';
  if WizardSilent then Parameters := Parameters + ' -Silent';
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if Result then Result := ResultCode = 0;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not AcquireMaintenance then begin
    Result := '另一个安装、备份、恢复或更新操作正在执行，请稍后重试。';
    exit;
  end;
  ExtractTemporaryFile('install-runner.ps1');
  ExtractTemporaryFile('operation-progress.ps1');
  if not RunInstallerStep(ExpandConstant('{tmp}\install-runner.ps1'), '-PrepareOnly') then
  begin
    Result := '现有安装未通过升级检查：服务可能未能停止、更新需要恢复、活动应用版本需专门升级，或此安装包版本较旧。尚未覆盖文件，请查看进度窗口提示。';
    ReleaseMaintenance;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    WizardForm.StatusLabel.Caption := '正在安装运行库并完成基础安装；数据库与服务注册将在初始化中执行...';
    if not RunInstallerStep(ExpandConstant('{app}\install-runner.ps1'), '') then
      RaiseException('Novora 基础安装未完成，未启动初始化向导。请查看 ProgramData\Novora\logs 中的日志，修复后重新运行安装程序。现有数据已保留。');
  end;
end;

procedure DeinitializeSetup;
begin
  ReleaseMaintenance;
end;

function InitializeUninstall: Boolean;
begin
  Result := AcquireMaintenance;
  if not Result then begin
    MsgBox('另一个安装、备份、恢复或更新操作正在执行，卸载未开始。', mbError, MB_OK);
    exit;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
  Parameters: String;
  Succeeded: Boolean;
begin
  if CurUninstallStep <> usUninstall then exit;
  Parameters := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\install-runner.ps1') + '" -InstallRoot "' + ExpandConstant('{app}') + '" -UninstallOnly -LockAlreadyHeld';
  if UninstallSilent then Parameters := Parameters + ' -Silent';
  Succeeded := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if Succeeded then Succeeded := ResultCode = 0;
  if not Succeeded then
    RaiseException('服务移除未完成，卸载已停止。请查看日志；上次软件更新需要恢复时先到 Windows 设置处理。');
end;

procedure DeinitializeUninstall;
begin
  ReleaseMaintenance;
end;
