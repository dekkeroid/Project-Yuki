param(
    [ValidateSet('cafe', 'cute_cafe', 'marine', 'marine_drive', 'all')]
    [string]$Map = 'cafe'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$blenderExe = "D:\Program files\Blender\blender.exe"
if (-not (Test-Path $blenderExe)) {
    $cand = Get-Command blender -ErrorAction SilentlyContinue
    if ($cand) { $blenderExe = $cand.Source }
}

if (-not (Test-Path $blenderExe)) {
    Write-Host "[ERROR] Blender executable not found at '$blenderExe'." -ForegroundColor Red
    exit 1
}

$blenderAssetDir = "D:\ProjectsNew\blenderProjects\Yuki3dAssets"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\Yuki AI"

$mapRegistry = @{
    'cafe' = @{
        Title = 'Cute Cafe'
        Blend = 'cute_cafe_scene_final.blend'
        Glb   = 'CuteCafeMap.glb'
    }
    'cute_cafe' = @{
        Title = 'Cute Cafe'
        Blend = 'cute_cafe_scene_final.blend'
        Glb   = 'CuteCafeMap.glb'
    }
    'marine' = @{
        Title = 'Marine Drive Night'
        Blend = 'marine_drive_night.blend'
        Glb   = 'MarineDriveNightMap.glb'
    }
    'marine_drive' = @{
        Title = 'Marine Drive Night'
        Blend = 'marine_drive_night.blend'
        Glb   = 'MarineDriveNightMap.glb'
    }
}

$targets = @()
if ($Map -eq 'all') {
    $targets = @($mapRegistry['cafe'], $mapRegistry['marine'])
} else {
    $targets = @($mapRegistry[$Map])
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Yuki AI - Date Mode Map Auto-Exporter" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Mode: $Map ($($targets.Count) map(s) to export)" -ForegroundColor Gray
Write-Host ""

foreach ($target in $targets) {
    $blendPath = Join-Path $blenderAssetDir $target.Blend
    $destPublic = Join-Path $root "frontend\public\3d_assets\date\$($target.Glb)"
    $destDist   = Join-Path $root "frontend\dist\3d_assets\date\$($target.Glb)"
    $destInstalled = Join-Path $installDir "resources\frontend\dist\3d_assets\date\$($target.Glb)"

    Write-Host "--------------------------------------------" -ForegroundColor DarkCyan
    Write-Host "Map: $($target.Title)" -ForegroundColor White
    Write-Host "Source: $blendPath" -ForegroundColor Gray
    Write-Host "Target: $($target.Glb)" -ForegroundColor Gray

    if (-not (Test-Path $blendPath)) {
        Write-Host "[ERROR] Source blend file not found: $blendPath" -ForegroundColor Red
        continue
    }

    # Ensure parent directory in public exists
    $publicDir = Split-Path -Parent $destPublic
    if (-not (Test-Path $publicDir)) {
        New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
    }

    Write-Host "Exporting from Blender in background..." -ForegroundColor Yellow
    $pyCode = "import bpy; bpy.ops.export_scene.gltf(filepath=r'$destPublic', export_format='GLB', export_lights=True, export_cameras=False, export_apply=True)"

    & $blenderExe -b "$blendPath" --python-expr "$pyCode" | Out-Null

    if (-not (Test-Path $destPublic)) {
        Write-Host "[ERROR] Export failed for $($target.Title). Check Blender console." -ForegroundColor Red
        continue
    }

    $fileSize = [math]::Round(((Get-Item $destPublic).Length / 1MB), 2)
    Write-Host "[OK] Exported $($target.Glb) ($fileSize MB) to frontend\public" -ForegroundColor Green

    # 1. Sync to project dist (if dist exists)
    if (Test-Path (Split-Path -Parent $destDist)) {
        Copy-Item $destPublic $destDist -Force
        Write-Host "[OK] Synced to frontend\dist\3d_assets\date\$($target.Glb)" -ForegroundColor DarkGreen
    }

    # 2. Sync to installed production app (if installed app exists)
    if (Test-Path (Split-Path -Parent $destInstalled)) {
        Copy-Item $destPublic $destInstalled -Force
        Write-Host "[OK] Synced directly to Installed Yuki AI ($($target.Glb))" -ForegroundColor Cyan
    } else {
        Write-Host "[INFO] Installed Yuki AI not detected; skipped prod copy." -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "[SUCCESS] Map export and sync complete!" -ForegroundColor Green
Write-Host "You can now open or refresh Yuki AI to see your map updates." -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
