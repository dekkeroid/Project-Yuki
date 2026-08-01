@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Yuki AI - Full Build Pipeline
echo ============================================

set "STEP=1/4 - frontend build (npm run build:frontend)"
echo.
echo ============================================
echo   [%STEP%]
echo ============================================
pushd frontend
call npm run build:frontend
if errorlevel 1 goto :fail
popd

set "STEP=2/4 - backend build (PyInstaller)"
echo.
echo ============================================
echo   [%STEP%]
echo ============================================
pushd backend
call venv\Scripts\pyinstaller.exe yuki-backend.spec --noconfirm
if errorlevel 1 goto :fail
popd

set "STEP=3/4 - electron build (npm run build:electron)"
echo.
echo ============================================
echo   [%STEP%]
echo ============================================
pushd frontend
call npm run build:electron
if errorlevel 1 goto :fail
popd

set "STEP=4/4 - installer build (Inno Setup)"
echo.
echo ============================================
echo   [%STEP%]
echo ============================================
pushd frontend
"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" installer.iss
if errorlevel 1 goto :fail
popd

echo.
echo ============================================
echo   Build complete!
echo   Installer: frontend\installer-output\
echo ============================================
exit /b 0

:fail
echo.
echo ============================================
echo   BUILD FAILED at step %STEP%
echo ============================================
exit /b 1
