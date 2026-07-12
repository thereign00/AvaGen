@echo off
TITLE AvaGen - Desktop App
echo ====================================================
echo Starting AvaGen Desktop Application...
echo ====================================================
echo.

:: Check if electron is installed in node_modules
if not exist "node_modules\electron" (
    echo [INFO] First-time setup: installing Electron...
    call npm install --save-dev electron
)

echo [INFO] Launching Desktop Window...
call npm run desktop
