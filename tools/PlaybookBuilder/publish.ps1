# Builds Playbook Builder + PlayDump and lays out the portable folder release\builder\.
#   powershell -ExecutionPolicy Bypass -File tools\PlaybookBuilder\publish.ps1 [-FontDir <folder with PPFraktionSans-*.ttf>]
# Fonts are copied for local use only (licensed; release\builder\fonts is gitignored). Without them the app uses Segoe UI.
param([string]$FontDir = "P:\Dropbox\Assets\Fonts\Pangram Pangram\Fraktion\sans")
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $root

dotnet build tools\PlayDump -c Release --nologo -v q
if ($LASTEXITCODE -ne 0) { throw "PlayDump build failed" }
dotnet build tools\PlaybookBuilder -c Release --nologo -v q
if ($LASTEXITCODE -ne 0) { throw "Playbook Builder build failed" }

$out = "release\builder"
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item "tools\PlaybookBuilder\bin\Release\Playbook Builder.exe", "tools\PlaybookBuilder\bin\Release\Playbook Builder.exe.config" $out -Force
Copy-Item tools\PlayDump\bin\Release\PlayDump.exe, tools\PlayDump\bin\Release\PlayDump.exe.config $out -Force

if (Test-Path $FontDir) {
    New-Item -ItemType Directory -Force "$out\fonts" | Out-Null
    foreach ($w in "Light", "Regular", "Semibold", "Bold") {
        $f = Join-Path $FontDir "PPFraktionSans-$w.ttf"
        if (Test-Path $f) { Copy-Item $f "$out\fonts" -Force }
    }
}
Write-Host "release\builder ready: $((Get-ChildItem $out -Recurse -File).Count) files"
