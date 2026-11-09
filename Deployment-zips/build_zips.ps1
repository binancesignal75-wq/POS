# ============================================================
# UNIVERSAL SOURCE ZIP BUILDER
# Creates clean SOURCE-CODE zips with .env files included.
# Place in project root or Deployment-zips folder and run:
#   powershell -ExecutionPolicy Bypass -File .\build_zips.ps1
#
# Output:  frontend.zip  (source + .env, no node_modules/dist)
#          backend.zip   (source + .env, no node_modules)
# ============================================================
param(
    [string]$FrontendDirName = "frontend",
    [string]$BackendDirName  = "backend"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$currentPath = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Item -Path ".").FullName }
if ((Test-Path (Join-Path $currentPath $FrontendDirName)) -and (Test-Path (Join-Path $currentPath $BackendDirName))) {
    $rootDir = $currentPath
} elseif ((Test-Path (Join-Path (Split-Path $currentPath -Parent) $FrontendDirName)) -and (Test-Path (Join-Path (Split-Path $currentPath -Parent) $BackendDirName))) {
    $rootDir = Split-Path $currentPath -Parent
} else {
    $rootDir = $currentPath
}

$DEPLOY_DIR = Join-Path $rootDir "Deployment-zips"
$tempDir = Join-Path $env:TEMP ('pkg_' + (Get-Random))
New-Item -ItemType Directory -Path $tempDir | Out-Null
$stageFront = Join-Path $tempDir 'frontend'
$stageBack  = Join-Path $tempDir 'backend'
New-Item -ItemType Directory -Path $stageFront | Out-Null
New-Item -ItemType Directory -Path $stageBack | Out-Null

$frontendPath = Join-Path $rootDir $FrontendDirName
$backendPath  = Join-Path $rootDir $BackendDirName

$excludeFront = @('node_modules', 'dist', '.git')
$excludeBack  = @('node_modules', '.git', '.DS_Store', 'temp_match.json')

Write-Host "Staging Frontend (including .env) at $stageFront..."
Get-ChildItem -Path $frontendPath -Force | ForEach-Object {
    if ($excludeFront -notcontains $_.Name) {
        Copy-Item -Path $_.FullName -Destination (Join-Path $stageFront $_.Name) -Recurse -Force
    }
}

# Ensure .env is explicitly copied
if (Test-Path (Join-Path $frontendPath '.env')) {
    Copy-Item -Path (Join-Path $frontendPath '.env') -Destination (Join-Path $stageFront '.env') -Force
}
if (Test-Path (Join-Path $frontendPath '.env.production')) {
    Copy-Item -Path (Join-Path $frontendPath '.env.production') -Destination (Join-Path $stageFront '.env.production') -Force
}

Write-Host "Staging Backend (including .env) at $stageBack..."
Get-ChildItem -Path $backendPath -Force | ForEach-Object {
    if ($excludeBack -notcontains $_.Name) {
        Copy-Item -Path $_.FullName -Destination (Join-Path $stageBack $_.Name) -Recurse -Force
    }
}

# Ensure .env is explicitly copied
if (Test-Path (Join-Path $backendPath '.env')) {
    Copy-Item -Path (Join-Path $backendPath '.env') -Destination (Join-Path $stageBack '.env') -Force
}

# Empty user-content folders but keep them
foreach ($cleanDir in @('logs', 'src\logs', 'uploads', 'public\uploads')) {
    $cPath = Join-Path $stageBack $cleanDir
    if (Test-Path $cPath) {
        Remove-Item -Path "$cPath\*" -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        New-Item -ItemType Directory -Path $cPath -Force | Out-Null
    }
}

$frontendZip = Join-Path $DEPLOY_DIR 'frontend.zip'
if (Test-Path $frontendZip) { Remove-Item $frontendZip -Force }
Write-Host "Compressing frontend.zip to Deployment-zips..."
[System.IO.Compression.ZipFile]::CreateFromDirectory($stageFront, $frontendZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$backendZip = Join-Path $DEPLOY_DIR 'backend.zip'
if (Test-Path $backendZip) { Remove-Item $backendZip -Force }
Write-Host "Compressing backend.zip to Deployment-zips..."
[System.IO.Compression.ZipFile]::CreateFromDirectory($stageBack, $backendZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

# Clean any root zip so files ONLY live in Deployment-zips
Remove-Item (Join-Path $rootDir 'frontend.zip') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $rootDir 'backend.zip') -Force -ErrorAction SilentlyContinue

$fSize = (Get-Item $frontendZip).Length / 1MB
$bSize = (Get-Item $backendZip).Length / 1KB
Write-Host ("Frontend source ZIP created (with .env): " + [math]::Round($fSize, 2) + " MB")
Write-Host ("Backend source ZIP created (with .env): " + [math]::Round($bSize, 2) + " KB")
