param([int]$Port = 4173)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
node scripts/build-site.mjs
if ($LASTEXITCODE -ne 0) { throw 'Dataset verification or website build failed.' }
$env:ROOMGAP_PORT = "$Port"
node scripts/serve-site.mjs
