param([switch]$Refresh, [switch]$Resume)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ($Refresh -and $Resume) { throw 'Choose either -Refresh or -Resume, not both.' }
if (-not $env:ROOMGAP_BROWSER_CHANNEL -and -not $env:ROOMGAP_BROWSER_EXECUTABLE) { $env:ROOMGAP_BROWSER_CHANNEL = 'chrome' }
if (-not $env:ROOMGAP_COOKIES_FILE -and (Test-Path -LiteralPath '.roomgap-auth.json')) {
  $env:ROOMGAP_COOKIES_FILE = Join-Path $PSScriptRoot '.roomgap-auth.json'
}
if ($Resume) { $env:ROOMGAP_REFRESH = '0' } else { $env:ROOMGAP_REFRESH = '1' }
node collect-api.mjs
if ($LASTEXITCODE -ne 0) { throw 'Collection incomplete. Saved data is retained; check data/semester/manifest.json before retrying.' }
node build-dataset.mjs
if ($LASTEXITCODE -ne 0) { throw 'Dataset verification or build failed.' }
node verify-dataset.mjs
if ($LASTEXITCODE -ne 0) { throw 'Integrity check failed. Do not publish this dataset.' }
