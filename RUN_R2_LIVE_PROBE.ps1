$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not $env:PPL_EXECUTION_ENABLED) { $env:PPL_EXECUTION_ENABLED = "1" }
node platform/execution/bin/live-probe.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
