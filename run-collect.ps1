param([switch]$Refresh)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$bundledPlaywright = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
if (Test-Path -LiteralPath $bundledPlaywright) { $env:ROOMGAP_PLAYWRIGHT_MODULE = $bundledPlaywright }
if ($Refresh) { $env:ROOMGAP_REFRESH = '1' } else { $env:ROOMGAP_REFRESH = '0' }
node collect-api.mjs
if ($LASTEXITCODE -ne 0) { throw '采集未完成，已保存的数据保留；查看 data/semester/manifest.json 后重试。' }
node build-dataset.mjs
if ($LASTEXITCODE -ne 0) { throw '数据校验或构建失败。' }
node verify-dataset.mjs
if ($LASTEXITCODE -ne 0) { throw '完整性检查失败，请勿发布本次数据。' }
