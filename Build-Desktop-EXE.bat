@echo off
TITLE AvaGen - EXE Builder
echo ====================================================
echo Building AvaGen Standalone EXE...
echo ====================================================
echo.

if not exist "node_modules\electron-builder" (
    echo [INFO] Installing electron-builder...
    call npm install --save-dev electron-builder
)

echo [INFO] Building Production App & Windows EXE Installer...
call npm run build:exe

echo.
echo ====================================================
echo BUILD COMPLETE!
echo Check the 'dist-electron' folder for your executable files!
echo ====================================================
pause
