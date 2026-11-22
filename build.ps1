# Builds Pulse and installs it to %LOCALAPPDATA%\Programs\Pulse (no admin, no SDK needed:
# uses the C# compiler that ships with Windows / .NET Framework 4.8).
#
#   .\build.ps1                 build + install + Desktop/Start-menu shortcuts
#   .\build.ps1 -Out <folder>   build into another folder, no shortcuts (used for tests)
param(
    [string]$Out = (Join-Path $env:LOCALAPPDATA 'Programs\Pulse'),
    [switch]$NoShortcuts
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }

$custom = $PSBoundParameters.ContainsKey('Out')
New-Item -ItemType Directory -Force $Out | Out-Null

$running = Get-Process Pulse -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -ieq (Join-Path $Out 'Pulse.exe')) }
# Pulse can stay open during an update: Windows lets a running exe be renamed, so the old one is moved
# aside and the new build is used from the next start. Leftovers from an earlier update are removed first.
Get-ChildItem $Out -Filter '*.old' -File -ErrorAction SilentlyContinue | ForEach-Object { try { Remove-Item $_.FullName -Force -Confirm:$false -ErrorAction Stop } catch { } }
if ($running) {
    $old = Join-Path $Out 'Pulse.exe.old'
    if (Test-Path $old) { throw "Pulse was already updated while open - close Pulse, then build again." }
    Rename-Item (Join-Path $Out 'Pulse.exe') 'Pulse.exe.old'
}

$lib = Join-Path $root 'lib'
$refs = @(
    'System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll',
    (Join-Path $lib 'Microsoft.Web.WebView2.Core.dll'),
    (Join-Path $lib 'Microsoft.Web.WebView2.WinForms.dll'),
    (Join-Path $lib 'TagLibSharp.dll')
) | ForEach-Object { "/r:$_" }

$exe = Join-Path $Out 'Pulse.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ /warn:3 /utf8output `
    "/win32icon:$(Join-Path $root 'src\pulse.ico')" "/win32manifest:$(Join-Path $root 'src\app.manifest')" `
    "/out:$exe" @refs (Join-Path $root 'src\Program.cs')
if ($LASTEXITCODE -ne 0) { throw "compile failed ($LASTEXITCODE)" }

foreach ($dll in Get-ChildItem $lib -Filter '*.dll') {
    $dst = Join-Path $Out $dll.Name
    # a DLL that did not change is left alone (it is locked while Pulse runs)
    if ((Test-Path $dst) -and ((Get-FileHash $dst).Hash -eq (Get-FileHash $dll.FullName).Hash)) { continue }
    if ($running -and (Test-Path $dst)) { Rename-Item $dst ($dll.Name + '.old') }
    Copy-Item $dll.FullName $dst -Force
}
$ui = Join-Path $Out 'ui'
if ((Test-Path $ui) -and -not $running) { Remove-Item $ui -Recurse -Force -Confirm:$false }
if ($running) { Copy-Item (Join-Path $root 'ui\*') $ui -Recurse -Force }
else { Copy-Item (Join-Path $root 'ui') $ui -Recurse -Force }

if (-not $custom -and -not $NoShortcuts) {
    $sh = New-Object -ComObject WScript.Shell
    $targets = @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pulse.lnk'),
        (Join-Path ([Environment]::GetFolderPath('Programs')) 'Pulse.lnk')
    )
    foreach ($t in $targets) {
        $l = $sh.CreateShortcut($t)
        $l.TargetPath = $exe
        $l.WorkingDirectory = $Out
        $l.IconLocation = "$exe,0"
        $l.Description = 'Pulse - lightweight music player'
        $l.Save()
    }
}
$size = [math]::Round(((Get-ChildItem $Out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
"Built $exe  ($size MB installed)"
if ($running) { "Pulse is open: it keeps running the old version until it is closed and started again." }
