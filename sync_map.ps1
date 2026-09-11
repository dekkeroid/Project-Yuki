$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$blendPath = "D:\ProjectsNew\blenderProjects\Yuki3dAssets\cute_cafe_scene_final.blend"
$blenderExe = "D:\Program files\Blender\blender.exe"
if (-not (Test-Path $blenderExe)) {
    $cand = Get-Command blender -ErrorAction SilentlyContinue
    if ($cand) { $blenderExe = $cand.Source }
}

$destPublic = Join-Path $root "frontend\public\3d_assets\date\CuteCafeMap.glb"
$destDist   = Join-Path $root "frontend\dist\3d_assets\date\CuteCafeMap.glb"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\Yuki AI"
$destInstalled = Join-Path $installDir "resources\frontend\dist\3d_assets\date\CuteCafeMap.glb"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Yuki AI - Date Mode Map Auto-Exporter" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Source Scene: $blendPath" -ForegroundColor Gray

if (-not (Test-Path $blendPath)) {
    Write-Host "[ERROR] Blend file not found at $blendPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $blenderExe)) {
    Write-Host "[ERROR] Blender executable not found." -ForegroundColor Red
    exit 1
}

Write-Host "Exporting CuteCafeMap.glb from Blender in background..." -ForegroundColor Yellow
$pyCode = "import bpy; bpy.ops.export_scene.gltf(filepath=r'$destPublic', export_format='GLB', export_lights=True, export_cameras=False, export_apply=True)"

& $blenderExe -b "$blendPath" --python-expr "$pyCode" | Out-Null

if (-not (Test-Path $destPublic)) {
    Write-Host "[ERROR] Export failed. Check blender console." -ForegroundColor Red
    exit 1
}

# Sync to dist
if (Test-Path (Split-Path -Parent $destDist)) {
    Copy-Item $destPublic $destDist -Force
}

# Sync to installed app if present
$syncedToInstalled = $false
if (Test-Path (Split-Path -Parent $destInstalled)) {
    Copy-Item $destPublic $destInstalled -Force
    $syncedToInstalled = $true
}

$fileSize = [math]::Round(((Get-Item $destPublic).Length / 1MB), 2)
Write-Host "[SUCCESS] Exported CuteCafeMap.glb ($fileSize MB)" -ForegroundColor Green
Write-Host "  -> frontend\public\3d_assets\date\CuteCafeMap.glb" -ForegroundColor DarkGray
Write-Host "  -> frontend\dist\3d_assets\date\CuteCafeMap.glb" -ForegroundColor DarkGray

if ($syncedToInstalled) {
    Write-Host "  -> Synced directly to Installed Yuki AI!" -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now open Yuki AI to see your map updates immediately." -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "Run .\update_installed.ps1 if you wish to push to the installed app." -ForegroundColor Cyan
}
Write-Host "============================================" -ForegroundColor Cyan
