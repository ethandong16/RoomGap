param([int]$Port = 4173)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
node scripts/build-site.mjs
if ($LASTEXITCODE -ne 0) { throw '数据校验或网站构建失败。' }
$env:ROOMGAP_PORT = "$Port"
node scripts/serve-site.mjs
