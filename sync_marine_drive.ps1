$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$syncMapScript = Join-Path $root "sync_map.ps1"

& $syncMapScript -Map marine
