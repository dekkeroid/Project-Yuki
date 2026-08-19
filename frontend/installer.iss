#define MyAppName "Yuki AI"
#define MyAppVersion "0.3.4-beta"
#define MyAppPublisher "void dekkeroid"
#define MyAppURL "https://github.com/dekkeroid/Project-Yuki"
#define MyAppExeName "Yuki AI.exe"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DisableDirPage=no
UsePreviousAppDir=yes
DefaultGroupName={#MyAppName}
LicenseFile=LICENSE
OutputDir=installer-output
OutputBaseFilename=YukiAI-{#MyAppVersion}-Setup
SetupIconFile=icon.ico
Compression=lzma2/ultra64
LZMANumBlockThreads=4
LZMAUseSeparateProcess=yes
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=force
CloseApplicationsFilter=*.exe,*.dll
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Remove stale PyInstaller payload from previous installs so old DLLs/model files
; (e.g. leftover python3xx.dll, outdated NVIDIA libs) cannot linger and break upgrades.
; User data (yuki_files.db, profile.json, tool_runs.jsonl, .env) is intentionally kept.
[InstallDelete]
Type: filesandordirs; Name: "{app}\resources\backend\_internal"
Type: files; Name: "{app}\resources\backend\backend.exe"
Type: files; Name: "{app}\resources\backend\.yuki-ready"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
