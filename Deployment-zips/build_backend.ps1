# ============================================================
# BUILD ONLY BACKEND -> Deployment-zips ONLY
# ============================================================
$ErrorActionPreference = "Stop"

$currentPath = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Item -Path ".").FullName }
if ((Test-Path (Join-Path $currentPath "frontend")) -and (Test-Path (Join-Path $currentPath "backend"))) {
    $ROOT = $currentPath
} elseif ((Test-Path (Join-Path (Split-Path $currentPath -Parent) "frontend")) -and (Test-Path (Join-Path (Split-Path $currentPath -Parent) "backend"))) {
    $ROOT = (Split-Path $currentPath -Parent)
} else {
    $ROOT = $currentPath
}

$BACKEND     = Join-Path $ROOT "backend"
$DEPLOY_DIR  = Join-Path $ROOT "Deployment-zips"
if (-not (Test-Path $DEPLOY_DIR)) { New-Item -ItemType Directory -Path $DEPLOY_DIR -Force | Out-Null }
$BACKEND_ZIP = Join-Path $DEPLOY_DIR "backend-build.zip"

# Remove any old zip from root so it only lives in Deployment-zips
$ROOT_ZIP = Join-Path $ROOT "backend-build.zip"
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
Write-Host "PACKAGING BACKEND (Output: Deployment-zips ONLY)" -ForegroundColor Green
Sep

$STAGE_BACKEND = Join-Path $ROOT "temp_stage_backend"
if (Test-Path $STAGE_BACKEND) { Remove-Item $STAGE_BACKEND -Recurse -Force }
New-Item -ItemType Directory -Path $STAGE_BACKEND | Out-Null

$excludeFromBackend = @("node_modules", ".git", ".gitignore", ".DS_Store", "dist", "temp_match.json", "audit_duplicates.js", ".env.production", ".env.example")

Get-ChildItem -Path $BACKEND -Force | ForEach-Object {
    if ($excludeFromBackend -notcontains $_.Name) {
        Copy-Item -Path $_.FullName -Destination (Join-Path $STAGE_BACKEND $_.Name) -Recurse -Force
    }
}

if (Test-Path "$BACKEND\.env.production") {
    Copy-Item -Path "$BACKEND\.env.production" -Destination "$STAGE_BACKEND\.env" -Force
} elseif (Test-Path "$BACKEND\.env") {
    Copy-Item -Path "$BACKEND\.env" -Destination "$STAGE_BACKEND\.env" -Force
}

foreach ($cleanDir in @("logs", "src\logs", "uploads", "public\uploads")) {
    $cPath = Join-Path $STAGE_BACKEND $cleanDir
    if (Test-Path $cPath) {
        Remove-Item -Path "$cPath\*" -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        New-Item -ItemType Directory -Path $cPath -Force | Out-Null
    }
}

New-PortableZip -SourceDir $STAGE_BACKEND -ZipPath $BACKEND_ZIP
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()
Start-Sleep -Milliseconds 500
Remove-Item $STAGE_BACKEND -Recurse -Force -ErrorAction SilentlyContinue

$bzSize = [math]::Round((Get-Item $BACKEND_ZIP).Length / 1MB, 2)
Sep
Write-Host "BACKEND PACKAGE READY: $BACKEND_ZIP ($bzSize MB)" -ForegroundColor Green
Write-Host "Upload to Hostinger Node.js app & Restart" -ForegroundColor Yellow
Sep
