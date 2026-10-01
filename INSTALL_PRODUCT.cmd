@echo off
cd /d "%~dp0"
node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22 || (a===22&&b<16)){console.error('PPL dev.5 product suite requires Node >=22.16'); process.exit(2)}"
if errorlevel 1 exit /b %errorlevel%
call npm ci --offline --ignore-scripts --no-audit --no-fund
if errorlevel 1 exit /b %errorlevel%
echo PPL product dependencies installed. Run VERIFY_PRODUCT.cmd
