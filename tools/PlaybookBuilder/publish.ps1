# Builds Playbook Builder + PlayDump and lays out the portable folder release\builder\.
#   powershell -ExecutionPolicy Bypass -File tools\PlaybookBuilder\publish.ps1
# The window's font (Public Sans, OFL) is embedded in the exe from tools\PlaybookBuilder\fonts, so nothing else ships.
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

Write-Host "release\builder ready: $((Get-ChildItem $out -Recurse -File).Count) files"
