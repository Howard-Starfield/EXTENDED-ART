#define MyAppName "ExtendedArt"
#define MyAppVersion "1.8.0"
#define MyAppPublisher "Howard Starfield"
#define MyAppURL "https://github.com/Howard-Starfield/EXTENDED-ART"
#define MyAppExeName "ExtendedArtOffline.exe"

[Setup]
AppId={{D932B6C1-904E-42DD-8A97-C07B4A9E08B2}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\Programs\ExtendedArt
DefaultGroupName=ExtendedArt
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
OutputDir=..\release
OutputBaseFilename=ExtendedArt-Setup-v{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\assets\branding\extendedart.ico
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "..\dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\THIRD_PARTY_NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\ExtendedArt"; Filename: "{app}\{#MyAppExeName}"; Parameters: "web"; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{autoprograms}\Uninstall ExtendedArt"; Filename: "{uninstallexe}"
Name: "{autodesktop}\ExtendedArt"; Filename: "{app}\{#MyAppExeName}"; Parameters: "web"; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "web"; Description: "Launch ExtendedArt"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "shutdown"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "StopExtendedArt"
