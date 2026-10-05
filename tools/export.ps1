# Game-side export: turns the repo's JSON (written by the web editor or by hand) into things Madden 27 loads.
#   playbooks/*.json (custom playbook specs)      -> build/PBOOKOFF-<NAME> (copied into the saves folder with -Install)
#   playbooks/mod.json + playbooks/plays/*.json -> mods/pbstudio.fbmod (+ .fbproject to inspect in MMC Editor)
#     the mod also pulls in library plays the playbooks use that aren't in the game's global play sheet
# Run on the machine with Madden 27 + MMC Editor. Close the game first when using -Install.
param(
    [switch]$Install,
    [string]$Bundle,   # zip downloaded from Playbook Studio (playbooks/**, app-data/**): unpacked into the repo first
    [switch]$SkipPlays,
    [string]$Template = "$PSScriptRoot\..\playbooks\templates\PBOOKOFF-TEMPLATE"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$saves = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Madden NFL 27\saves"
Set-Location $root

New-Item -ItemType Directory -Force build, backups | Out-Null

# 0. Optional: import an export bundle from the web app (current playbooks/ and app-data/ are backed up first).
if ($Bundle) {
    $stamp = Get-Date -Format yyyyMMdd-HHmmss
    $tmp = Join-Path $env:TEMP "pbstudio-bundle-$stamp"
    Expand-Archive -LiteralPath $Bundle -DestinationPath $tmp -Force
    $src = Get-ChildItem $tmp -Directory -Recurse -Filter playbooks | Select-Object -First 1
    if (-not $src) { throw "bundle has no playbooks/ folder" }
    foreach ($dir in "playbooks", "app-data") {
        $from = Join-Path $src.Parent.FullName $dir
        if (-not (Test-Path $from)) { continue }
        if (Test-Path $dir) { robocopy $dir (Join-Path "backups" "$dir-$stamp") /E /NFL /NDL /NJH /NJS /NP | Out-Null }
        # robocopy merges into the existing folder (Copy-Item -Recurse would nest it); exit codes < 8 are success.
        robocopy $from $dir /E /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "copying $dir from bundle failed ($LASTEXITCODE)" }
        Write-Host "imported $dir from bundle (previous copy in backups\$dir-$stamp)"
    }
    Remove-Item $tmp -Recurse -Force
}
Remove-Item build\pull-plays.json -ErrorAction SilentlyContinue

$bookFiles = @(Get-ChildItem playbooks\*.json | Where-Object Name -ne "mod.json")
function OutName($book) {
    $spec = Get-Content $book.FullName -Raw | ConvertFrom-Json
    $prefix = if ($spec.side -eq "defense") { "PBOOKDEF" } else { "PBOOKOFF" }
    "build\$prefix-$($spec.name.ToUpper())"
}

# 1. Collect pass: which library plays do the playbooks use that the game's global play sheet lacks?
foreach ($book in $bookFiles) {
    node tools\pbook-build.mjs --collect $book.FullName $Template (OutName $book)
    if ($LASTEXITCODE -ne 0) { throw "pbook-build (collect) failed for $($book.Name)" }
}

# 2. One combined mod: custom plays + pulled library plays. Writes research/index/custom-plays.tsv (custom play ids).
if (-not $SkipPlays) {
    $specs = @(Get-ChildItem playbooks\sets\*.json, playbooks\plays\*.json -ErrorAction SilentlyContinue | ForEach-Object FullName)
    & .\tools\PlayDump\bin\Release\PlayDump.exe buildplays mods\pbstudio.fbproject mods\pbstudio.fbmod playbooks\mod.json $specs
    if ($LASTEXITCODE -ne 0) { throw "buildplays failed" }
}

# 3. Playbook saves.
$books = @()
foreach ($book in $bookFiles) {
    $out = OutName $book
    node tools\pbook-build.mjs $book.FullName $Template $out
    if ($LASTEXITCODE -ne 0) { throw "pbook-build failed for $($book.Name)" }
    $books += $out
}

if ($Install) {
    foreach ($out in $books) {
        $dest = Join-Path $saves (Split-Path $out -Leaf)
        if (Test-Path $dest) { Copy-Item $dest "backups\$(Split-Path $out -Leaf).$(Get-Date -Format yyyyMMdd-HHmmss)" -Force }
        Copy-Item $out $dest -Force
        Write-Host "installed $dest"
    }
}
Write-Host "Done. Add/refresh mods\pbstudio.fbmod in MMC Mod Manager, Apply, then Launch."
