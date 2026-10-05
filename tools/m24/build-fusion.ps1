# Builds the Madden 27 port of the FUSION playbook (Madden 24 mod) as its own mod + custom playbook save.
#   ../MAMA9 (M24 mod: mama9.DB, customplaybooks.DB, release/PBOOKOFF-FUSION) -> playbooks/fusion/*.json (convert)
#   playbooks/fusion/sets.json  -> mods/fusion.fbproject + mods/fusion.fbmod
#   playbooks/fusion/FUSION.json -> build/fusion/PBOOKOFF-FUSION
# -Install copies the save into Documents\Madden NFL 27\saves and the mod + save + readme into ..\FUSION Madden 27 (next to this repo).
# FUSION's mod edits GlobalPlaySheet like mods/pbstudio.fbmod does, so enable only one of the two in MMC Mod Manager.
param(
    [switch]$Install,
    [switch]$SkipConvert,
    [switch]$SkipPlays,
    [string]$Template = "$PSScriptRoot\..\..\playbooks\templates\PBOOKOFF-TEMPLATE"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $root
$out = "build\fusion"
New-Item -ItemType Directory -Force $out, backups | Out-Null

if (-not $SkipConvert) {
    node tools\m24\fusion-analyze.mjs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "fusion-analyze failed" }
    node tools\m24\convert-fusion.mjs
    if ($LASTEXITCODE -ne 0) { throw "convert-fusion failed" }
}

$book = "playbooks\fusion\FUSION.json"
$save = "$out\PBOOKOFF-FUSION"
Remove-Item "$out\pull-plays.json" -ErrorAction SilentlyContinue
node tools\pbook-build.mjs --collect --index $out $book $Template $save
if ($LASTEXITCODE -ne 0) { throw "pbook-build (collect) failed" }

if (-not $SkipPlays) {
    & .\tools\PlayDump\bin\Release\PlayDump.exe buildplays mods\fusion.fbproject mods\fusion.fbmod playbooks\fusion\mod.json playbooks\fusion\sets.json --out-index $out
    if ($LASTEXITCODE -ne 0) { throw "buildplays failed" }
}

node tools\pbook-build.mjs --index $out $book $Template $save
if ($LASTEXITCODE -ne 0) { throw "pbook-build failed" }
node tools\m24\preview-fusion.mjs

if ($Install) {
    $docs = [Environment]::GetFolderPath("MyDocuments")
    $saves = Join-Path $docs "Madden NFL 27\saves"
    $dest = Join-Path $saves "PBOOKOFF-FUSION"
    if (Test-Path $dest) { Copy-Item $dest "backups\PBOOKOFF-FUSION.$(Get-Date -Format yyyyMMdd-HHmmss)" -Force }
    Copy-Item $save $dest -Force
    Write-Host "installed $dest"

    $kit = Join-Path $root "..\FUSION Madden 27"   # P:\Dropbox\Projects\Madden Modding\FUSION Madden 27
    New-Item -ItemType Directory -Force $kit | Out-Null
    Copy-Item mods\fusion.fbmod, mods\fusion.fbproject, $save -Destination $kit -Force
    Copy-Item playbooks\fusion\README.txt (Join-Path $kit "README.txt") -Force
    Copy-Item build\m24\fusion-report.md (Join-Path $kit "port-report.md") -Force
    Copy-Item "$out\preview.html" (Join-Path $kit "preview.html") -Force
    Write-Host "copied mod, project, save and readme to $kit"
}
Write-Host "Done. In MMC Mod Manager: add mods\fusion.fbmod (disable pbstudio.fbmod), Apply, Launch; pick FUSION as your custom offense."
