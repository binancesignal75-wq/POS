# ============================================================
# UNIVERSAL ZIP VERIFICATION
# Checks frontend-build.zip and backend-build.zip (or any zips
# you pass in) for forbidden dev files and required essentials.
# Place in project root or Deployment-zips folder and run:
#   powershell -ExecutionPolicy Bypass -File .\verify_zips.ps1
# Or verify custom zip names:
#   .\verify_zips.ps1 -FrontendZip "frontend.zip" -BackendZip "backend.zip"
# ============================================================
param(
    [string]$FrontendZip = "frontend-build.zip",
    [string]$BackendZip  = "backend-build.zip"
)
Add-Type -AssemblyName System.IO.Compression.FileSystem

$currentPath = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Item -Path ".").FullName }
if ((Test-Path (Join-Path $currentPath "frontend")) -and (Test-Path (Join-Path $currentPath "backend"))) {
    $rootDir = $currentPath
} elseif ((Test-Path (Join-Path (Split-Path $currentPath -Parent) "frontend")) -and (Test-Path (Join-Path (Split-Path $currentPath -Parent) "backend"))) {
    $rootDir = Split-Path $currentPath -Parent
} else {
    $rootDir = $currentPath
}

# Find zip file in rootDir or in Deployment-zips or currentPath
function ResolveZipPath {
    param([string]$name)
    if (Test-Path (Join-Path $rootDir $name)) { return (Join-Path $rootDir $name) }
    if (Test-Path (Join-Path $currentPath $name)) { return (Join-Path $currentPath $name) }
    if (Test-Path (Join-Path (Join-Path $rootDir "Deployment-zips") $name)) { return (Join-Path (Join-Path $rootDir "Deployment-zips") $name) }
    return (Join-Path $rootDir $name)
}

$fZipPath = ResolveZipPath $FrontendZip
$bZipPath = ResolveZipPath $BackendZip

Write-Host "================================================="
Write-Host "1. FRONTEND ZIP VERIFICATION: $FrontendZip"
Write-Host "Path: $fZipPath"
Write-Host "================================================="
if (-not (Test-Path $fZipPath)) {
    Write-Host "ERROR: $fZipPath not found. Run deploy.ps1 first." -ForegroundColor Red
} else {
    $fZip = [System.IO.Compression.ZipFile]::OpenRead($fZipPath)
    $fEntries = $fZip.Entries

    Write-Host "Total Files: $($fEntries.Count)"

    # Forbidden dev files in a compiled production frontend package
    $fBad = $fEntries | Where-Object {
        $_.FullName -match '^node_modules' -or
        $_.FullName -match '^src/' -or
        $_.FullName -match '^package(-lock)?\.json$' -or
        $_.FullName -match 'vite\.config' -or
        $_.FullName -match 'webpack\.config' -or
        $_.FullName -match '^\.git'
    }
    if ($fBad) {
        Write-Host "`nERROR: Forbidden development files found:" -ForegroundColor Red
        $fBad | ForEach-Object { Write-Host " ! $($_.FullName)" }
    } else {
        Write-Host "PASS: Clean production frontend (no src/, node_modules, or dev configs)." -ForegroundColor Green
    }

    # Required essentials (universal)
    $fRequired = @('index.html')
    foreach ($req in $fRequired) {
        $exists = $fEntries | Where-Object { $_.FullName -eq $req }
        if ($exists) { Write-Host " [x] $req" } else { Write-Host " [MISSING] $req" -ForegroundColor Red }
    }
    $fZip.Dispose()
}

Write-Host "`n================================================="
Write-Host "2. BACKEND ZIP VERIFICATION: $BackendZip"
Write-Host "Path: $bZipPath"
Write-Host "================================================="
if (-not (Test-Path $bZipPath)) {
    Write-Host "ERROR: $bZipPath not found. Run deploy.ps1 first." -ForegroundColor Red
} else {
    $bZip = [System.IO.Compression.ZipFile]::OpenRead($bZipPath)
    $bEntries = $bZip.Entries

    Write-Host "Total Files: $($bEntries.Count)"
    Write-Host "`nSample (first 30):"
    $bEntries | Select-Object -First 30 | ForEach-Object { Write-Host " - $($_.FullName)" }

    # Forbidden files
    $bBad = $bEntries | Where-Object {
        $_.FullName -match '^node_modules' -or
        $_.FullName -match '^\.git'
    }
    if ($bBad) {
        Write-Host "`nERROR: Forbidden files found:" -ForegroundColor Red
        $bBad | ForEach-Object { Write-Host " ! $($_.FullName)" }
    } else {
        Write-Host "`nPASS: Clean backend package (no node_modules, no .git)." -ForegroundColor Green
    }

    # Required essentials (universal)
    $exists = $bEntries | Where-Object { $_.FullName -eq 'package.json' }
    if ($exists) { Write-Host " [x] package.json" } else { Write-Host " [MISSING] package.json" -ForegroundColor Red }

    # Entry point - any common pattern accepted
    $entryCandidates = @('server.js', 'app.js', 'index.js', 'main.js', 'src/server.js', 'src/app.js', 'src/index.js')
    $entryFound = $entryCandidates | Where-Object { $name = $_; $bEntries | Where-Object { $_.FullName -eq $name -or $_.FullName -eq $name.Replace('/', '\') } }
    if ($entryFound) {
        Write-Host " [x] Entry point: $($entryFound -join ', ')"
    } else {
        Write-Host " [?] No standard entry point found (server.js/app.js/index.js) - verify manually" -ForegroundColor Yellow
    }
    $bZip.Dispose()
}
