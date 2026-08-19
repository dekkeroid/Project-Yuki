@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Yuki AI - Full Build Pipeline
echo ============================================

set "SHUTDOWN_AFTER=N"
set /p "USER_SHUTDOWN=Shutdown PC after build completes? [y/N]: "
if /i "%USER_SHUTDOWN%"=="y" set "SHUTDOWN_AFTER=Y"
if /i "%USER_SHUTDOWN%"=="yes" set "SHUTDOWN_AFTER=Y"

set "LAUNCH_SETUP=Y"
if "%SHUTDOWN_AFTER%"=="N" (
    set /p "USER_LAUNCH=Launch the newly built setup after build completes? [Y/n]: "
    if /i "%USER_LAUNCH%"=="n" set "LAUNCH_SETUP=N"
    if /i "%USER_LAUNCH%"=="no" set "LAUNCH_SETUP=N"
) else (
    set "LAUNCH_SETUP=N"
)

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

if "%SHUTDOWN_AFTER%"=="Y" (
    echo.
    echo ============================================
    echo   Shutting down PC in 30 seconds...
    echo   Run 'shutdown /a' in cmd to cancel.
    echo ============================================
    shutdown /s /t 30 /c "Yuki AI build finished successfully."
    exit /b 0
)

if "%LAUNCH_SETUP%"=="Y" (
    set "SETUP_EXE="
    for /f "delims=" %%I in ('dir /b /a-d /o-d "frontend\installer-output\*.exe" 2^>nul') do (
        if not defined SETUP_EXE set "SETUP_EXE=%~dp0frontend\installer-output\%%I"
    )
    if defined SETUP_EXE (
        echo.
        echo Launching setup: %SETUP_EXE%
        start "" "%SETUP_EXE%"
    ) else (
        echo.
        echo [WARN] No installer found in frontend\installer-output\
    )
)

exit /b 0

:fail
echo.
echo ============================================
echo   BUILD FAILED at step %STEP%
echo ============================================
exit /b 1
