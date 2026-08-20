$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$backendDir = 'backend'
$frontendDir = 'frontend'
$extraPackages = @('youtube_transcript_api')

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

function Confirm-Yes {
    param([string]$Message, [bool]$Default)
    $prompt = if ($Default) { '[Y/n]' } else { '[y/N]' }
    $answer = Read-Host -Prompt "$Message $prompt"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return ($answer -match '^(y|yes)$')
}

function Get-NewerFiles {
    param([string]$ReferencePath, [object[]]$Sources)
    $ref = Get-Item $ReferencePath -ErrorAction SilentlyContinue
    if (-not $ref) { return $Sources }
    return @($Sources | Where-Object { $_ -and $_.LastWriteTime -gt $ref.LastWriteTime })
}

function Is-AnyNewer {
    param([string]$ReferencePath, [object[]]$Sources)
    return (Get-NewerFiles $ReferencePath $Sources).Count -gt 0
}

$installDir = Get-YukiInstallDir

Write-Host "============================================"
Write-Host "  Yuki AI - Fast Update (installed app)"
Write-Host "============================================"

if (-not $installDir) {
    Write-Host ""
    Write-Host "[ERROR] Could not locate the installed Yuki AI."
    Write-Host "Run the installer once first, or install to the default location."
    exit 1
}
Write-Host ""
Write-Host "Installed at: $installDir"

# ---------- Detect changes (source vs installed app) ----------
Write-Host ""
Write-Host "Checking for changes..."

$backendSources = @(Get-ChildItem "$backendDir\app" -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\__pycache__\\' -and $_.Extension -notin '.pyc', '.pyo' })
$backendSources += @(Get-Item "$backendDir\run.py", "$backendDir\requirements.txt", "$backendDir\yuki-backend.spec" -ErrorAction SilentlyContinue)
$backendChanged = Is-AnyNewer (Join-Path $installDir 'resources\backend\backend.exe') $backendSources

$frontendSources = @(Get-ChildItem "$frontendDir\src" -Recurse -File -ErrorAction SilentlyContinue)
$frontendSources += @(Get-Item "$frontendDir\index.html", "$frontendDir\vite.config.js" -ErrorAction SilentlyContinue)
$frontendChanged = Is-AnyNewer (Join-Path $installDir 'resources\frontend\dist\index.html') $frontendSources

$electronSources = @(Get-Item `
    "$frontendDir\main.electron.cjs", `
    "$frontendDir\preload.cjs", `
    "$frontendDir\electron-builder.yml", `
    "$frontendDir\installer.iss", `
    "$frontendDir\icon.ico" -ErrorAction SilentlyContinue)
$electronChanged = Is-AnyNewer (Join-Path $installDir 'resources\app.asar') $electronSources

# ---------- Preview ----------
$rows = @(
    [pscustomobject]@{ Name = 'Backend engine'; Changed = $backendChanged;  Detail = 'Python backend (backend.exe + bundled files)' }
    [pscustomobject]@{ Name = 'Frontend UI';    Changed = $frontendChanged; Detail = 'React UI (resources\frontend\dist)' }
    [pscustomobject]@{ Name = 'Electron shell'; Changed = $electronChanged; Detail = 'Electron app + asar + binaries' }
)

Write-Host ""
Write-Host "Detected changes:"
foreach ($r in $rows) {
    $mark = if ($r.Changed) { 'x' } else { ' ' }
    $status = if ($r.Changed) { 'CHANGED' } else { 'up to date' }
    Write-Host ("  [{0}] {1,-16} {2,-12} - {3}" -f $mark, $r.Name, $status, $r.Detail)
}

$anyChanged = @($rows | Where-Object { $_.Changed }).Count -gt 0
if (-not $anyChanged) {
    Write-Host ""
    Write-Host "Nothing to update - your installed Yuki AI is up to date."
    exit 0
}

# ---------- Opt-out selection ----------
Write-Host ""
Write-Host "Choose which parts to include in THIS update:"
foreach ($r in $rows) {
    $isSelected = Confirm-Yes "Include $($r.Name)?" $r.Changed
    $r | Add-Member -NotePropertyName Selected -NotePropertyValue $isSelected
    
    if ($r.Name -eq 'Backend engine' -and $isSelected) {
        $installedExe = Join-Path $installDir 'resources\backend\backend.exe'
        if (Test-Path $installedExe) {
            $changedBackendFiles = Get-NewerFiles $installedExe $backendSources
            if ($changedBackendFiles.Count -gt 0) {
                Write-Host ""
                Write-Host "  Modified backend files ($($changedBackendFiles.Count)):" -ForegroundColor Cyan
                $maxToShow = 25
                $toShow = $changedBackendFiles | Select-Object -First $maxToShow
                foreach ($f in $toShow) {
                    $relPath = $f.FullName
                    if ($relPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
                        $relPath = $relPath.Substring($root.Length).TrimStart('\', '/')
                    }
                    Write-Host "    - $relPath" -ForegroundColor DarkCyan
                }
                if ($changedBackendFiles.Count -gt $maxToShow) {
                    Write-Host "    ... and $($changedBackendFiles.Count - $maxToShow) more file(s)" -ForegroundColor DarkGray
                }
                Write-Host ""
            }
            $needsFullRebuild = $false
            if ($changedBackendFiles) {
                $criticalFiles = @('run.py', 'requirements.txt', 'yuki-backend.spec')
                $changedCritical = @($changedBackendFiles | Where-Object { 
                    $fileName = Split-Path $_.FullName -Leaf
                    $criticalFiles -contains $fileName
                })
                if ($changedCritical.Count -gt 0) {
                    $needsFullRebuild = $true
                    Write-Host "  [WARNING] The following critical build files have changed:" -ForegroundColor Red
                    foreach ($c in $changedCritical) {
                        Write-Host "    - $(Split-Path $c.FullName -Leaf)" -ForegroundColor Red
                    }
                    Write-Host "  Fast Sync CANNOT apply changes to these files (requires a Full Rebuild)." -ForegroundColor Red
                    Write-Host ""
                }
            }
            Write-Host "  Note: Fast Sync copies raw .py files instantly except run.py. If your changes aren't showing up or the app is failing, choose 'No' below for a Full Rebuild." -ForegroundColor Yellow
            $defaultFastSync = if ($needsFullRebuild) { $false } else { $true }
            $fastSync = Confirm-Yes "  Use Fast Sync for Backend? (Choose 'No' for a Full Rebuild)" $defaultFastSync
            if ($fastSync) {
                $env:YUKI_FULL_REBUILD = ''
            } else {
                $env:YUKI_FULL_REBUILD = '1'
            }
        }
    }
}

$selected = @($rows | Where-Object { $_.Selected })
if ($selected.Count -eq 0) {
    Write-Host ""
    Write-Host "Nothing selected - aborting, no changes made."
    exit 0
}

# ---------- Final confirmation ----------
Write-Host ""
Write-Host "Will run:"
foreach ($r in $selected) {
    $step = switch ($r.Name) {
        'Frontend UI'    { "npm run build:frontend, then copy dist" }
        'Backend engine' { 
            $installedExe = Join-Path $installDir 'resources\backend\backend.exe'
            if ((Test-Path $installedExe) -and (-not $env:YUKI_FULL_REBUILD)) {
                "Fast sync app source files (sub-second)"
            } else {
                "pyinstaller yuki-backend.spec, then copy backend (full rebuild)"
            }
        }
        'Electron shell' { "npm run build:electron, then copy shell + asar" }
    }
    Write-Host ("  - {0}: {1}" -f $r.Name, $step)
}
Write-Host "  - Target: $installDir"
Write-Host ""
if (-not (Confirm-Yes "Proceed?" $true)) {
    Write-Host "Aborted - no changes made."
    exit 0
}

# ---------- Close running app (exe locks files during copy) ----------
$proc = Get-Process | Where-Object { $_.ProcessName -like 'Yuki AI*' }
if ($proc) {
    Write-Host ""
    Write-Host "[WARN] Yuki AI is currently running."
    if (Confirm-Yes "Close it now and continue?" $true) {
        $proc | Stop-Process -Force -ErrorAction SilentlyContinue
        Write-Host "[OK] Yuki AI closed."
        Start-Sleep -Seconds 2
    } else {
        Write-Host "[WARN] Proceeding without closing - copy may fail on locked files."
    }
}

$selFrontend = @($selected | Where-Object { $_.Name -eq 'Frontend UI' }).Count -gt 0
$selBackend  = @($selected | Where-Object { $_.Name -eq 'Backend engine' }).Count -gt 0
$selElectron = @($selected | Where-Object { $_.Name -eq 'Electron shell' }).Count -gt 0

# ---------- Execute selected components ----------

if ($selFrontend) {
    Write-Host ""
    Write-Host "--- Frontend UI: rebuilding ---"
    Push-Location "$root\$frontendDir"
    npm run build:frontend
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host ""; Write-Host "BUILD FAILED."; exit 1 }
    Pop-Location

    Write-Host "--- Frontend UI: copying dist ---"
    $rc = robocopy "$root\$frontendDir\dist" (Join-Path $installDir 'resources\frontend\dist') /E /NFL /NDL /NJH /NJS
    if ($rc -ge 8) { Write-Host ""; Write-Host "COPY FAILED (robocopy code $rc)."; exit 1 }
}

if ($selBackend) {
    Write-Host ""
    $installedExe = Join-Path $installDir 'resources\backend\backend.exe'
    $localDistExe = "$root\$backendDir\dist\backend\backend.exe"
    
    if ((Test-Path $installedExe) -and (Test-Path $localDistExe) -and (-not $env:YUKI_FULL_REBUILD)) {
        Write-Host "--- Backend engine: Fast Syncing app source files & pip packages ---"
        $destInternalApp = Join-Path $installDir 'resources\backend\_internal\app'
        $destRootApp     = Join-Path $installDir 'resources\backend\app'
        $localDistApp    = "$root\$backendDir\dist\backend\_internal\app"
        
        $rc1 = robocopy "$root\$backendDir\app" $destInternalApp /E /NFL /NDL /NJH /NJS /XF *.pyc *.pyo /XD __pycache__
        $rc2 = robocopy "$root\$backendDir\app" $destRootApp /E /NFL /NDL /NJH /NJS /XF *.pyc *.pyo /XD __pycache__
        if (Test-Path "$root\$backendDir\dist\backend\_internal") {
            $rc3 = robocopy "$root\$backendDir\app" $localDistApp /E /NFL /NDL /NJH /NJS /XF *.pyc *.pyo /XD __pycache__
        }

        # Sync extra packages from local venv to installed app
        foreach ($pkg in $extraPackages) {
            $srcPkg = "$root\$backendDir\venv\Lib\site-packages\$pkg"
            if (Test-Path $srcPkg) {
                Write-Host "  Syncing extra package: $pkg"
                $destPkgInternal = Join-Path $installDir "resources\backend\_internal\$pkg"
                $rc_pkg1 = robocopy $srcPkg $destPkgInternal /E /NFL /NDL /NJH /NJS /XF *.pyc *.pyo /XD __pycache__
                
                if (Test-Path "$root\$backendDir\dist\backend\_internal") {
                    $localDistPkg = "$root\$backendDir\dist\backend\_internal\$pkg"
                    $rc_pkg2 = robocopy $srcPkg $localDistPkg /E /NFL /NDL /NJH /NJS /XF *.pyc *.pyo /XD __pycache__
                }
            } else {
                Write-Host "  [WARN] Extra package $pkg not found in venv site-packages." -ForegroundColor Yellow
            }
        }

        if ($rc1 -ge 8) { Write-Host ""; Write-Host "FAST COPY FAILED (robocopy code $rc1)."; exit 1 }
        Write-Host "[OK] Backend app source files updated in ~0.5s!"

        # Touch backend.exe LastWriteTime to avoid subsequent false-positive CHANGED status
        if (Test-Path $installedExe) {
            (Get-Item $installedExe).LastWriteTime = Get-Date
        }
    } else {
        Write-Host "--- Backend engine: full rebuild (PyInstaller) ---"
        Push-Location "$root\$backendDir"
        .\venv\Scripts\pyinstaller.exe yuki-backend.spec --noconfirm
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host ""; Write-Host "BUILD FAILED."; exit 1 }
        Pop-Location

        Write-Host "--- Backend engine: copying (preserving your .env / data) ---"
        # Clean loose app Python folders so the new PyInstaller build is 100% fresh (preserves .env, db, profile, etc.)
        Remove-Item (Join-Path $installDir 'resources\backend\_internal\app') -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $installDir 'resources\backend\app') -Recurse -Force -ErrorAction SilentlyContinue

        $rc = robocopy "$root\$backendDir\dist\backend" (Join-Path $installDir 'resources\backend') /E /XF .env /NFL /NDL /NJH /NJS
        if ($rc -ge 8) { Write-Host ""; Write-Host "COPY FAILED (robocopy code $rc)."; exit 1 }
    }
}

if ($selElectron) {
    Write-Host ""
    Write-Host "--- Electron shell: repacking ---"
    Push-Location "$root\$frontendDir"
    npm run build:electron
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host ""; Write-Host "BUILD FAILED."; exit 1 }
    Pop-Location

    Write-Host "--- Electron shell: copying (shell + asar, excluding backend/frontend) ---"
    $src = "$root\$frontendDir\release\win-unpacked"
    $copyArgs = @('/E', '/NFL', '/NDL', '/NJH', '/NJS', '/XF', '.env')
    foreach ($d in @("$src\resources\backend", "$src\resources\frontend\dist")) {
        $copyArgs += @('/XD', $d)
    }
    $rc = robocopy $src $installDir @copyArgs
    if ($rc -ge 8) { Write-Host ""; Write-Host "COPY FAILED (robocopy code $rc)."; exit 1 }
}

Write-Host ""
Write-Host "============================================"
Write-Host "  Update complete!"
Write-Host "  Launching Yuki AI in a new window..."
Write-Host "============================================"

$installedAppExe = Join-Path $installDir 'Yuki AI.exe'
if (Test-Path $installedAppExe) {
    Start-Process powershell -WorkingDirectory $installDir -ArgumentList @('-NoExit', '-Command', "& '.\Yuki AI.exe'")
}

exit 0
