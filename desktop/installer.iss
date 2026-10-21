; 小柯機器人動態圖形和視覺特效工具 — Windows 安裝程式（Inno Setup 6）
#ifndef AppVer
  #define AppVer "1.0.0"
#endif
#define AppName "小柯機器人動態圖形和視覺特效工具"
#define AppExe "XiaokeEffects.exe"

[Setup]
AppId={{AF84F588-6380-4E86-82FF-2BD25D53EBE2}
AppName={#AppName}
AppVersion={#AppVer}
AppVerName={#AppName} {#AppVer}
AppPublisher=吳玉柱 (achir1015@gmail.com)
AppPublisherURL=https://github.com/achir1015/xiaoke-effects
AppSupportURL=https://github.com/achir1015/xiaoke-effects/issues
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; 不需要系統管理員權限；安裝時可自選資料夾（例如 E:\動態圖形和視覺特效 EffectCraft）
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline dialog
OutputDir=..\dist-installer
OutputBaseFilename=XiaokeEffects-Setup-{#AppVer}
SetupIconFile=app.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
; App 內「立即更新」時舊版可能還沒完全關閉：自動關掉再覆蓋
CloseApplications=force
RestartApplications=no

[Languages]
#ifexist "ChineseTraditional.isl"
Name: "cht"; MessagesFile: "ChineseTraditional.isl"
#endif
Name: "en"; MessagesFile: "compiler:Default.isl"

[LangOptions]
DialogFontName=Microsoft JhengHei UI
DialogFontSize=12
WelcomeFontName=Microsoft JhengHei UI
WelcomeFontSize=16

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\XiaokeEffects\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autoprograms}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
Root: HKA; Subkey: "Software\Classes\.xke"; ValueType: string; ValueName: ""; ValueData: "XiaokeEffects.Project"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\XiaokeEffects.Project"; ValueType: string; ValueName: ""; ValueData: "小柯特效專案"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\XiaokeEffects.Project\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\XiaokeEffects.Project\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
; App 內更新時以 /relaunch=1 執行，裝好後自動重新開啟
Filename: "{app}\{#AppExe}"; Flags: nowait; Check: ShouldRelaunch

[Code]
function ShouldRelaunch(): Boolean;
begin
  Result := ExpandConstant('{param:relaunch|0}') = '1';
end;

function WebView2Installed(): Boolean;
var v: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) or
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v);
  if Result then Result := (v <> '') and (v <> '0.0.0.0');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and (not WizardSilent) and (not WebView2Installed()) then
    MsgBox('這台電腦沒有偵測到 Microsoft Edge WebView2 執行階段。Windows 11 通常已內建；若程式打不開，請到 https://go.microsoft.com/fwlink/p/?LinkId=2124703 安裝。', mbInformation, MB_OK);
end;
