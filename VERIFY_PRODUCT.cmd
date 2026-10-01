@echo off
cd /d "%~dp0"
call INSTALL_PRODUCT.cmd >nul
if errorlevel 1 exit /b %errorlevel%
set NODE_NO_WARNINGS=1
node tools\verify-product.mjs
