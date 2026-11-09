# ============================================================
# BUILD ONLY FRONTEND -> Deployment-zips ONLY
# ============================================================
param([switch]$SkipBuild)
$ErrorActionPreference = "Stop"

$currentPath = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Item -Path ".").FullName }
if ((Test-Path (Join-Path $currentPath "frontend")) -and (Test-Path (Join-Path $currentPath "backend"))) {
    $ROOT = $currentPath
} elseif ((Test-Path (Join-Path (Split-Path $currentPath -Parent) "frontend")) -and (Test-Path (Join-Path (Split-Path $currentPath -Parent) "backend"))) {
    $ROOT = (Split-Path $currentPath -Parent)
} else {
    $ROOT = $currentPath
}

$FRONTEND     = Join-Path $ROOT "frontend"
$DIST         = Join-Path $FRONTEND "dist"
$DEPLOY_DIR   = Join-Path $ROOT "Deployment-zips"
if (-not (Test-Path $DEPLOY_DIR)) { New-Item -ItemType Directory -Path $DEPLOY_DIR -Force | Out-Null }
$FRONTEND_ZIP = Join-Path $DEPLOY_DIR "frontend-build.zip"

# Remove any old zip from root so it only lives in Deployment-zips
$ROOT_ZIP = Join-Path $ROOT "frontend-build.zip"
if (Test-Path $ROOT_ZIP) { Remove-Item $ROOT_ZIP -Force -ErrorAction SilentlyContinue }

function Sep  { Write-Host "============================================================" -ForegroundColor Cyan }
function OK   { param($m) Write-Host "  [OK] $m" -ForegroundColor Green }
function Info { param($m) Write-Host "  [--] $m" -ForegroundColor Yellow }
function FAIL { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red; exit 1 }

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

function New-PortableZip {
    param([string]$SourceDir, [string]$ZipPath)
    $SourceDir = (Resolve-Path $SourceDir).Path.TrimEnd('\')
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem -Path $SourceDir -Recurse -Force | ForEach-Object {
            $rel = $_.FullName.Substring($SourceDir.Length + 1).Replace('\', '/')
            if ($_.PSIsContainer) {
                if (-not (Get-ChildItem -Path $_.FullName -Force | Select-Object -First 1)) {
                    [void]$zip.CreateEntry("$rel/")
                }
            } else {
                [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
            }
        }
    } finally {
        $zip.Dispose()
    }
}

Sep
Write-Host "BUILDING FRONTEND (Output: Deployment-zips ONLY)" -ForegroundColor Green
Sep

if (-not $SkipBuild) {
    Set-Location $FRONTEND
    if (Test-Path $DIST) { Remove-Item -Path $DIST -Recurse -Force }
    Write-Host "  Running npm run build..."
    & cmd /c "npm run build 2>&1"
    if ($LASTEXITCODE -ne 0) { FAIL "Frontend build failed" }
    OK "Frontend build complete"
    Set-Location $ROOT
}

if (-not (Test-Path "$DIST\index.html")) { FAIL "dist/index.html missing" }

$STAGE_FRONTEND = Join-Path $ROOT "temp_stage_frontend"
if (Test-Path $STAGE_FRONTEND) { Remove-Item $STAGE_FRONTEND -Recurse -Force }
New-Item -ItemType Directory -Path $STAGE_FRONTEND | Out-Null

Copy-Item -Path "$DIST\*" -Destination $STAGE_FRONTEND -Recurse -Force
if (Test-Path "$DIST\.htaccess") { Copy-Item -Path "$DIST\.htaccess" -Destination $STAGE_FRONTEND -Force }
if (Test-Path "$FRONTEND\.env.production") {
    Copy-Item -Path "$FRONTEND\.env.production" -Destination "$STAGE_FRONTEND\.env" -Force
} elseif (Test-Path "$FRONTEND\.env") {
    Copy-Item -Path "$FRONTEND\.env" -Destination "$STAGE_FRONTEND\.env" -Force
}

New-PortableZip -SourceDir $STAGE_FRONTEND -ZipPath $FRONTEND_ZIP
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()
Start-Sleep -Milliseconds 500
Remove-Item $STAGE_FRONTEND -Recurse -Force -ErrorAction SilentlyContinue

$fzSize = [math]::Round((Get-Item $FRONTEND_ZIP).Length / 1MB, 2)
Sep
Write-Host "FRONTEND PACKAGE READY: $FRONTEND_ZIP ($fzSize MB)" -ForegroundColor Green
Write-Host "Upload to public_html" -ForegroundColor Yellow
Sep
