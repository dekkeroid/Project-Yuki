$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$backendDir = 'backend'
$frontendDir = 'frontend'

# --- Locate the installed app dynamically ---
# Priority: running process -> Inno Setup uninstall registry -> default location
function Get-YukiInstallDir {
    $candidates = @()

    $proc = Get-Process | Where-Object { $_.ProcessName -like 'Yuki AI*' } | Select-Object -First 1
    if ($proc -and $proc.Path) {
        $candidates += Split-Path -Parent $proc.Path
    }

    $uninstallRoots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($rootKey in $uninstallRoots) {
        Get-ChildItem $rootKey -ErrorAction SilentlyContinue | ForEach-Object {
            $item = $null
            try { $item = Get-ItemProperty $_.PSPath -ErrorAction Stop } catch { return }
            if (-not $item -or $item.DisplayName -notlike 'Yuki*') { return }
            $loc = $item.InstallLocation
            if (-not $loc) { $loc = $item.'Inno Setup: App Path' }
            if ($loc) { $candidates += $loc.TrimEnd('\') }
        }
    }

    $candidates += Join-Path $env:LOCALAPPDATA 'Programs\Yuki AI'

    foreach ($cand in $candidates) {
        if ($cand -and (Test-Path (Join-Path $cand 'Yuki AI.exe'))) {
            return $cand
        }
    }
    return $null
}

$installDir = Get-YukiInstallDir

Write-Host "============================================"
Write-Host "  Yuki AI - Fast Update (installed app)"
Write-Host "  Rebuilds only what changed, no installer."
Write-Host "============================================"

if (-not $installDir) {
    Write-Host ""
    Write-Host "[ERROR] Could not locate the installed Yuki AI."
    Write-Host "Run the installer once first, or install to the default location."
    exit 1
}
Write-Host ""
Write-Host "Installed at: $installDir"

# --- Close the running app (its exe would lock files during copy) ---
$proc = Get-Process | Where-Object { $_.ProcessName -like 'Yuki AI*' }
if ($proc) {
    Write-Host ""
    Write-Host "[WARN] Yuki AI is currently running."
    $choice = Read-Host "Close it now and continue? [Y/n]"
    if ($choice -notmatch '^n') {
        $proc | Stop-Process -Force -ErrorAction SilentlyContinue
        Write-Host "[OK] Yuki AI closed."
        Start-Sleep -Seconds 2
    }
}

# --- Detect changes (compare timestamps against last build output) ---
Write-Host ""
Write-Host "[Detect] Checking what changed..."

$backendExe = Get-Item "$backendDir\dist\backend\backend.exe" -ErrorAction SilentlyContinue
$backendChanged = $false
if (-not $backendExe) {
    $backendChanged = $true
} else {
    $src = @(Get-ChildItem "$backendDir\app" -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\__pycache__\\' -and $_.Extension -notin '.pyc', '.pyo' })
    $src += @(Get-Item "$backendDir\run.py" -ErrorAction SilentlyContinue)
    $backendChanged = @($src | Where-Object { $_ -and $_.LastWriteTime -gt $backendExe.LastWriteTime }).Count -gt 0
}

$asar = Get-Item "$frontendDir\release\win-unpacked\resources\app.asar" -ErrorAction SilentlyContinue
$electronChanged = $false
if (-not $asar) {
    $electronChanged = $true
} else {
    $mainFiles = @(Get-Item `
        "$frontendDir\main.electron.cjs", `
        "$frontendDir\preload.cjs", `
        "$frontendDir\electron-builder.yml", `
        "$frontendDir\installer.iss", `
        "$frontendDir\icon.ico" -ErrorAction SilentlyContinue)
    $electronChanged = @($mainFiles | Where-Object { $_ -and $_.LastWriteTime -gt $asar.LastWriteTime }).Count -gt 0
}

Write-Host "  backend  : $backendChanged"
Write-Host "  electron : $electronChanged"

# --- Step 1: frontend (always rebuilt, it is fast) ---
Write-Host ""
Write-Host "Step 1/3 - frontend build (npm run build:frontend)"
Push-Location $frontendDir
npm run build:frontend
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host ""; Write-Host "BUILD FAILED."; exit 1 }

# --- Step 2: backend (only when backend sources changed) ---
Write-Host ""
if ($backendChanged) {
    Write-Host "Step 2/3 - backend build (PyInstaller)"
    Push-Location ..\$backendDir
    .\venv\Scripts\pyinstaller.exe yuki-backend.spec --noconfirm
    if ($LASTEXITCODE -ne 0) { Pop-Location; Pop-Location; Write-Host ""; Write-Host "BUILD FAILED."; exit 1 }
    Pop-Location
} else {
    Write-Host "Step 2/3 - backend unchanged, skipping PyInstaller"
}

# --- Step 3: electron packaging (only when electron main OR backend changed) ---
Write-Host ""
$needElectron = $electronChanged -or $backendChanged
if ($needElectron) {
    Write-Host "Step 3/3 - electron packaging (electron-builder --win)"
    npm run build:electron
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host ""; Write-Host "BUILD FAILED."; exit 1 }
} else {
    Write-Host "Step 3/3 - electron unchanged, skipping packaging"
}

# --- Keep win-unpacked's external dist fresh even when packaging was skipped ---
$unpackedDist = 'release\win-unpacked\resources\frontend\dist'
if (Test-Path 'release\win-unpacked') {
    if (-not (Test-Path $unpackedDist)) {
        New-Item -ItemType Directory -Force -Path $unpackedDist | Out-Null
    }
    Copy-Item 'dist\*' $unpackedDist -Recurse -Force
}
Pop-Location

# --- Copy updated app over the install dir (incremental, never deletes user data) ---
Write-Host ""
Write-Host "Copying updated app to $installDir"
robocopy "$root\$frontendDir\release\win-unpacked" $installDir /E /XF ".env" /NFL /NDL /NJH /NJS
$rc = $LASTEXITCODE
if ($rc -ge 8) {
    Write-Host ""
    Write-Host "COPY FAILED (robocopy code $rc). Close Yuki AI and retry."
    exit 1
}

Write-Host ""
Write-Host "============================================"
Write-Host "  Update complete! (robocopy code $rc)"
Write-Host "  Launch Yuki AI from your Start Menu / desktop."
Write-Host "============================================"
exit 0
