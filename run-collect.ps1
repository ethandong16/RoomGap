param([switch]$Refresh)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$bundledPlaywright = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
if (Test-Path -LiteralPath $bundledPlaywright) { $env:ROOMGAP_PLAYWRIGHT_MODULE = $bundledPlaywright }
if ($Refresh) { $env:ROOMGAP_REFRESH = '1' } else { $env:ROOMGAP_REFRESH = '0' }
node collect-api.mjs
if ($LASTEXITCODE -ne 0) { throw 'Collection incomplete. Saved data is retained; check data/semester/manifest.json before retrying.' }
node build-dataset.mjs
if ($LASTEXITCODE -ne 0) { throw 'Dataset verification or build failed.' }
node verify-dataset.mjs
if ($LASTEXITCODE -ne 0) { throw 'Integrity check failed. Do not publish this dataset.' }
