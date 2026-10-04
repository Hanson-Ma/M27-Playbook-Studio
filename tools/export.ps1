# Game-side export: turns the repo's JSON (written by the web editor or by hand) into things Madden 27 loads.
#   playbooks/mod.json + playbooks/plays/*.json -> mods/pbstudio.fbmod (+ .fbproject to inspect in MMC Editor)
#   playbooks/*.json (custom playbook specs)      -> build/PBOOKOFF-<NAME> (copied into the saves folder with -Install)
# Run on the machine with Madden 27 + MMC Editor. Close the game first when using -Install.
param(
    [switch]$Install,
    [switch]$SkipPlays,
    [string]$Template = "$PSScriptRoot\..\playbooks\templates\PBOOKOFF-TEMPLATE"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$saves = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Madden NFL 27\saves"
Set-Location $root

if (-not $SkipPlays) {
    $specs = @(Get-ChildItem playbooks\plays\*.json | ForEach-Object FullName)
    if ($specs) {
        & .\tools\PlayDump\bin\Release\PlayDump.exe buildplays mods\pbstudio.fbproject mods\pbstudio.fbmod playbooks\mod.json $specs
        if ($LASTEXITCODE -ne 0) { throw "buildplays failed" }
    }
}

New-Item -ItemType Directory -Force build | Out-Null
foreach ($book in Get-ChildItem playbooks\*.json | Where-Object Name -ne "mod.json") {
    $spec = Get-Content $book.FullName -Raw | ConvertFrom-Json
    $prefix = if ($spec.side -eq "defense") { "PBOOKDEF" } else { "PBOOKOFF" }
    $out = "build\$prefix-$($spec.name.ToUpper())"
    node tools\pbook-build.mjs $book.FullName $Template $out
    if ($LASTEXITCODE -ne 0) { throw "pbook-build failed for $($book.Name)" }
    if ($Install) {
        $dest = Join-Path $saves (Split-Path $out -Leaf)
        if (Test-Path $dest) { Copy-Item $dest "backups\$(Split-Path $out -Leaf).$(Get-Date -Format yyyyMMdd-HHmmss)" -Force }
        Copy-Item $out $dest -Force
        Write-Host "installed $dest"
    }
}
Write-Host "Done. Add/refresh mods\pbstudio.fbmod in MMC Mod Manager, Apply, then Launch."
