# ============================================================
# UNIVERSAL DEPLOY SCRIPT -> OUTPUTS ONLY TO Deployment-zips/
# ============================================================
param(
    [string]$FrontendDirName = "frontend",
    [string]$BackendDirName  = "backend",
    [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"

# Auto-detect project root whether run from root or Deployment-zips subfolder
$currentPath = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Item -Path ".").FullName }
if ((Test-Path (Join-Path $currentPath $FrontendDirName)) -and (Test-Path (Join-Path $currentPath $BackendDirName))) {
    $ROOT = $currentPath
} elseif ((Test-Path (Join-Path (Split-Path $currentPath -Parent) $FrontendDirName)) -and (Test-Path (Join-Path (Split-Path $currentPath -Parent) $BackendDirName))) {
    $ROOT = (Split-Path $currentPath -Parent)
} else {
    $ROOT = $currentPath
}

$FRONTEND     = Join-Path $ROOT $FrontendDirName
$BACKEND      = Join-Path $ROOT $BackendDirName
$DIST         = Join-Path $FRONTEND "dist"
$DEPLOY_DIR   = Join-Path $ROOT "Deployment-zips"
if (-not (Test-Path $DEPLOY_DIR)) { New-Item -ItemType Directory -Path $DEPLOY_DIR -Force | Out-Null }
$FRONTEND_ZIP = Join-Path $DEPLOY_DIR "frontend-build.zip"
$BACKEND_ZIP  = Join-Path $DEPLOY_DIR "backend-build.zip"

function Sep  { Write-Host "============================================================" -ForegroundColor Cyan }
function OK   { param($m) Write-Host "  [OK] $m" -ForegroundColor Green }
function Info { param($m) Write-Host "  [--] $m" -ForegroundColor Yellow }
function FAIL { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red; exit 1 }

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

# Creates a zip whose entry names always use forward slashes (/), so it extracts correctly
# on Linux hosting (Hostinger etc.). Includes hidden files and empty folders.
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

if (-not (Test-Path $FRONTEND)) { FAIL "Frontend folder not found: $FRONTEND" }
if (-not (Test-Path $BACKEND))  { FAIL "Backend folder not found: $BACKEND" }

# ----------------------------------------------------------
# STEP 1: Clean and Build Frontend Production Bundle
# ----------------------------------------------------------
Sep
Write-Host "STEP 1: Building Fresh Frontend Production Bundle"
Sep

if ($SkipBuild) {
    Info "SkipBuild flag set - using existing dist/ folder"
    if (-not (Test-Path $DIST)) { FAIL "dist/ not found and -SkipBuild was used. Run without -SkipBuild first." }
} else {
    Set-Location $FRONTEND

    if (Test-Path $DIST) {
        Write-Host "  Cleaning old dist directory..."
        Remove-Item -Path $DIST -Recurse -Force
    }

    Write-Host "  Running: npm run build ..."
    & cmd /c "npm run build 2>&1"

    if ($LASTEXITCODE -ne 0) {
        FAIL "Frontend build FAILED (exit code $LASTEXITCODE)"
    }
    OK "Frontend build completed successfully"

    Set-Location $ROOT
}

# ----------------------------------------------------------
# STEP 2: Verify Build Output and Assets
# ----------------------------------------------------------
Sep
Write-Host "STEP 2: Verifying Build Output and Asset Hashes"
Sep

if (-not (Test-Path $DIST)) { FAIL "dist/ directory not found!" }

$distFiles = Get-ChildItem -Path $DIST -Recurse -Force -File
Write-Host "  Found $($distFiles.Count) total files in dist/ (including hidden files)"

if (-not (Test-Path "$DIST\index.html")) { FAIL "index.html is MISSING from dist/" }
OK "index.html present"

if (Test-Path "$DIST\.htaccess") {
    OK ".htaccess present"
    Copy-Item -Path "$DIST\.htaccess" -Destination "$DIST\htaccess.txt" -Force
    OK "htaccess.txt backup copy created"
} else {
    if (Test-Path "$ROOT\.htaccess") {
        Copy-Item -Path "$ROOT\.htaccess" -Destination "$DIST\.htaccess" -Force
        Copy-Item -Path "$ROOT\.htaccess" -Destination "$DIST\htaccess.txt" -Force
        OK ".htaccess copied from project root into dist/ and htaccess.txt backup created"
    } else {
        Info ".htaccess not found (skip - not every project uses it)"
    }
}

# Parse index.html and verify all referenced assets exist
$indexHtml = Get-Content "$DIST\index.html" -Raw
$assetMatches = [regex]::Matches($indexHtml, '(?:src|href)="(/assets/[^"]+)"')
$assetRefs = $assetMatches | ForEach-Object { $_.Groups[1].Value }
$missing = 0
foreach ($ref in $assetRefs) {
    $cleanRef = $ref.TrimStart('/').Replace('/', '\')
    $assetPath = "$DIST\$cleanRef"
    if (-not (Test-Path $assetPath)) {
        Write-Host "  [MISSING] $ref" -ForegroundColor Red
        $missing++
    }
}
if ($missing -gt 0) { FAIL "$missing asset(s) missing from build!" }
OK "All $($assetRefs.Count) referenced assets verified in dist/"

$jsCount  = ($distFiles | Where-Object { $_.Extension -eq ".js"  }).Count
$cssCount = ($distFiles | Where-Object { $_.Extension -eq ".css" }).Count
OK "JS chunk files: $jsCount"
OK "CSS files: $cssCount"

# ----------------------------------------------------------
# STEP 3: Create frontend-build.zip (Including .env)
# ----------------------------------------------------------
Sep
Write-Host "STEP 3: Creating frontend-build.zip"
Sep

if (Test-Path $FRONTEND_ZIP) { Remove-Item $FRONTEND_ZIP -Force }

$STAGE_FRONTEND = Join-Path $ROOT "temp_stage_frontend"
if (Test-Path $STAGE_FRONTEND) { Remove-Item $STAGE_FRONTEND -Recurse -Force }
New-Item -ItemType Directory -Path $STAGE_FRONTEND | Out-Null

# Copy dist contents into staging root
Get-ChildItem -Path $DIST -Force | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination (Join-Path $STAGE_FRONTEND $_.Name) -Recurse -Force
}

# Exclude heavy installer exe from web frontend zip so upload is lightning-fast (~1.5MB instead of 80MB)
$stageDownloads = Join-Path $STAGE_FRONTEND "downloads"
if (Test-Path $stageDownloads) {
    Remove-Item -Path "$stageDownloads\*" -Recurse -Force -ErrorAction SilentlyContinue
    Info "Emptied heavy files from: downloads in frontend package (web bundle stays lightweight)"
}

# Explicitly copy .env to frontend-build.zip
if (Test-Path "$FRONTEND\.env.production") {
    Copy-Item -Path "$FRONTEND\.env.production" -Destination "$STAGE_FRONTEND\.env" -Force
    Copy-Item -Path "$FRONTEND\.env.production" -Destination "$STAGE_FRONTEND\.env.production" -Force
    OK "Copied production .env into frontend-build.zip"
} elseif (Test-Path "$FRONTEND\.env") {
    Copy-Item -Path "$FRONTEND\.env" -Destination "$STAGE_FRONTEND\.env" -Force
    OK "Copied .env into frontend-build.zip"
}

New-PortableZip -SourceDir $STAGE_FRONTEND -ZipPath $FRONTEND_ZIP
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()
Start-Sleep -Milliseconds 500
Remove-Item $STAGE_FRONTEND -Recurse -Force -ErrorAction SilentlyContinue

$fzSize = [math]::Round((Get-Item $FRONTEND_ZIP).Length / 1MB, 2)
OK "frontend-build.zip created ($fzSize MB)"

# ----------------------------------------------------------
# STEP 4: Create backend-build.zip (Including .env)
# ----------------------------------------------------------
Sep
Write-Host "STEP 4: Creating backend-build.zip"
Sep

if (Test-Path $BACKEND_ZIP) { Remove-Item $BACKEND_ZIP -Force }

$STAGE_BACKEND = Join-Path $ROOT "temp_stage_backend"
if (Test-Path $STAGE_BACKEND) { Remove-Item $STAGE_BACKEND -Recurse -Force }
New-Item -ItemType Directory -Path $STAGE_BACKEND | Out-Null

$excludeFromBackend = @(
    "node_modules",
    ".git",
    ".gitignore",
    ".DS_Store",
    "dist",
    "temp_match.json",
    "audit_duplicates.js",
    ".env.production",
    ".env.example"
)

# Copy backend items
Get-ChildItem -Path $BACKEND -Force | ForEach-Object {
    if ($excludeFromBackend -notcontains $_.Name) {
        Copy-Item -Path $_.FullName -Destination (Join-Path $STAGE_BACKEND $_.Name) -Recurse -Force
    } else {
        Info "Excluded: $($_.Name)"
    }
}

# Explicitly copy .env to backend staging root (production file preferred)
if (Test-Path "$BACKEND\.env.production") {
    Copy-Item -Path "$BACKEND\.env.production" -Destination "$STAGE_BACKEND\.env" -Force
    OK "Backend .env.production included in package as .env"
} elseif (Test-Path "$BACKEND\.env") {
    Copy-Item -Path "$BACKEND\.env" -Destination "$STAGE_BACKEND\.env" -Force
    OK "Backend .env explicitly included in package"
} else {
    Info "No backend .env found"
}

# Empty out logs, user-uploaded content, and heavy installers but keep the folders
foreach ($cleanDir in @("logs", "src\logs", "uploads", "public\uploads", "downloads")) {
    $cPath = Join-Path $STAGE_BACKEND $cleanDir
    if (Test-Path $cPath) {
        Remove-Item -Path "$cPath\*" -Recurse -Force -ErrorAction SilentlyContinue
        Info "Emptied: $cleanDir (folder kept)"
    } else {
        New-Item -ItemType Directory -Path $cPath -Force | Out-Null
        Info "Created empty placeholder folder: $cleanDir"
    }
}

New-PortableZip -SourceDir $STAGE_BACKEND -ZipPath $BACKEND_ZIP
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()
Start-Sleep -Milliseconds 500
Remove-Item $STAGE_BACKEND -Recurse -Force -ErrorAction SilentlyContinue

$bzSize = [math]::Round((Get-Item $BACKEND_ZIP).Length / 1MB, 2)
OK "backend-build.zip created ($bzSize MB)"

# ----------------------------------------------------------
# STEP 5: Mandatory ZIP Extraction Verification
# ----------------------------------------------------------
Sep
Write-Host "STEP 5: ZIP Extraction Verification in Clean Folders"
Sep

$TEST_FRONTEND_EXTRACT = Join-Path $ROOT "temp_test_frontend_extract"
$TEST_BACKEND_EXTRACT  = Join-Path $ROOT "temp_test_backend_extract"

if (Test-Path $TEST_FRONTEND_EXTRACT) { Remove-Item $TEST_FRONTEND_EXTRACT -Recurse -Force }
if (Test-Path $TEST_BACKEND_EXTRACT)  { Remove-Item $TEST_BACKEND_EXTRACT -Recurse -Force }

New-Item -ItemType Directory -Path $TEST_FRONTEND_EXTRACT | Out-Null
New-Item -ItemType Directory -Path $TEST_BACKEND_EXTRACT  | Out-Null

Expand-Archive -Path $FRONTEND_ZIP -DestinationPath $TEST_FRONTEND_EXTRACT -Force
Expand-Archive -Path $BACKEND_ZIP  -DestinationPath $TEST_BACKEND_EXTRACT  -Force

# --- Portable paths check (Linux hosting needs / not \ inside zips) ---
foreach ($zp in @($FRONTEND_ZIP, $BACKEND_ZIP)) {
    $za = [System.IO.Compression.ZipFile]::OpenRead($zp)
    $bad = @($za.Entries | Where-Object { $_.FullName -match '\\' }).Count
    $za.Dispose()
    if ($bad -gt 0) { FAIL "$(Split-Path $zp -Leaf) has $bad entries with backslashes (would break on Linux)" }
}
OK "Both zips use forward-slash paths (safe for Linux hosting)"

# --- Frontend checks ---
if (-not (Test-Path "$TEST_FRONTEND_EXTRACT\index.html")) { FAIL "Extracted frontend missing index.html!" }
OK "Frontend: index.html at ZIP root"

if (-not (Test-Path "$TEST_FRONTEND_EXTRACT\.env")) { FAIL "Extracted frontend missing .env!" }
OK "Frontend: .env present at root"

if (Test-Path "$TEST_FRONTEND_EXTRACT\assets") {
    OK "Frontend: assets/ folder present"
}

if (Test-Path "$TEST_FRONTEND_EXTRACT\.htaccess") {
    OK "Frontend: .htaccess present at root"
}

$feLeaks = Get-ChildItem -Path $TEST_FRONTEND_EXTRACT -Recurse -Force |
    Where-Object { $_.Name -eq "node_modules" -or $_.Name -eq "vite.config.js" -or $_.Name -eq "vite.config.ts" -or $_.Name -eq "package.json" }
if ($feLeaks) { FAIL "Dev files leaked into frontend-build.zip: $($feLeaks.Name -join ', ')" }
OK "Frontend: no dev leaks (node_modules/package.json/vite.config)"

# --- Backend checks ---
if (-not (Test-Path "$TEST_BACKEND_EXTRACT\package.json")) { FAIL "Extracted backend missing package.json!" }
OK "Backend: package.json present"

if (-not (Test-Path "$TEST_BACKEND_EXTRACT\.env")) { FAIL "Extracted backend missing .env!" }
OK "Backend: .env present at root"

$entryCandidates = @("server.js", "app.js", "index.js", "main.js", "src\server.js", "src\app.js", "src\index.js")
$entryFound = $entryCandidates | Where-Object { Test-Path (Join-Path $TEST_BACKEND_EXTRACT $_) }
if ($entryFound) {
    OK "Backend: entry point found ($($entryFound -join ', '))"
}

if (Test-Path "$TEST_BACKEND_EXTRACT\node_modules") { FAIL "node_modules leaked into backend-build.zip!" }
OK "Backend: no node_modules in package"

Remove-Item $TEST_FRONTEND_EXTRACT -Recurse -Force
Remove-Item $TEST_BACKEND_EXTRACT  -Recurse -Force

# Database import file for phpMyAdmin (if the project has one) -> Deployment-zips ONLY
$HOSTING_SQL = Join-Path $ROOT "database\schema.sql"
$DB_OUT      = Join-Path $DEPLOY_DIR "database-import.sql"
if (Test-Path $HOSTING_SQL) {
    Copy-Item -Path $HOSTING_SQL -Destination $DB_OUT -Force
    OK "database-import.sql created in Deployment-zips"
}

# Clean up any old files from project root so files ONLY exist in Deployment-zips
foreach ($old in @("frontend-build.zip", "backend-build.zip", "database-import.sql")) {
    $rootOld = Join-Path $ROOT $old
    if (Test-Path $rootOld) { Remove-Item $rootOld -Force -ErrorAction SilentlyContinue }
}

# ----------------------------------------------------------
# SUMMARY
# ----------------------------------------------------------
Sep
Write-Host "DEPLOYMENT PACKAGES READY (SAVED IN Deployment-zips ONLY)" -ForegroundColor Green
Sep
Write-Host "  1. FRONTEND: $FRONTEND_ZIP ($fzSize MB)  -> upload to public_html"
Write-Host "  2. BACKEND:  $BACKEND_ZIP ($bzSize MB)  -> upload to the Node.js app"
if (Test-Path $DB_OUT) { Write-Host "  3. DATABASE: $DB_OUT  -> phpMyAdmin Import (first time only)" }
Sep
