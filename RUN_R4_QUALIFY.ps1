$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
& node --env-file-if-exists=.env tools/r4-qualify-execution.mjs @args
exit $LASTEXITCODE
