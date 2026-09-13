@echo off
setlocal
cd /d "%~dp0"
set YUKI_NO_AUTO_BACKEND=1

:: Start Backend in Windows Terminal (or fallback to powershell)
where wt >nul 2>nul
if %errorlevel% equ 0 (
    start wt -d "%~dp0backend" powershell -NoExit -Command ".\venv\Scripts\python run.py"
    start wt -d "%~dp0frontend" powershell -NoExit -Command "npm run dev:electron"
) else (
    start "Yuki Backend" /d "%~dp0backend" powershell -NoExit -Command ".\venv\Scripts\python run.py"
    start "Yuki Frontend" /d "%~dp0frontend" powershell -NoExit -Command "npm run dev:electron"
)

exit

