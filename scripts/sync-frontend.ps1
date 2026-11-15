# scripts/sync-frontend.ps1
#
# One-way synchronization of the canonical root frontend into the Capacitor
# web build directory (www/).
#
# Design rules (Phase 1):
#   - Copy only; never delete anything inside www/.
#   - Never overwrite a file in www/ that has no counterpart in root.
#   - Only mirror frontend assets: HTML, JS, CSS, images, admin shell.
#   - Never touch backend files, migrations, schema, or .env.
#   - Idempotent: safe to run repeatedly.

$ErrorActionPreference = "Stop"
$script:Synced = 0
$script:Skipped = 0

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$WwwDir = Join-Path $RootDir "www"
$RootAssetsDir = Join-Path $RootDir "assets"
$WwwAssetsDir = Join-Path $WwwDir "assets"

function Log([string]$message) {
  Write-Host "[sync-frontend] $message"
}

function Copy-FileSafe([string]$src, [string]$dst) {
  if (-not (Test-Path -LiteralPath $src -PathType Leaf)) {
    Log "SKIP (missing in root): $src"
    $script:Skipped++
    return
  }

  $dstDir = Split-Path -Parent $dst
  if (-not (Test-Path -LiteralPath $dstDir -PathType Container)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
  }

  Copy-Item -LiteralPath $src -Destination $dst -Force
  Log "COPIED: $src -> $dst"
  $script:Synced++
}

# Top-level HTML files mirrored from root to www/.
$HtmlFiles = @(
  "index.html",
  "women.html",
  "customer-profile.html",
  "admin.html",
  "agb.html",
  "datenschutz.html",
  "impressum.html"
)

# Admin shell files mirrored from root/admin/ to www/admin/.
$AdminFiles = @(
  "admin.html",
  "index.html",
  "admin.css",
  "admin.js"
)

# Individual asset files mirrored from root/assets/ to www/assets/.
$AssetFiles = @(
  "customer-header.css",
  "customer-header.js",
  "customer-hero.css",
  "customer-hero.js",
  "customer-password-reset.js",
  "customer-registration.js",
  "customer-salon-card.css",
  "customer-salon-card.js",
  "loyalty.css",
  "loyalty.js",
  "notifications.css",
  "notifications.js",
  "push.js",
  "salo-brand-lockup.css",
  "salo-official-logo.png",
  "salo-official-logo.webp",
  "salo-salon-placeholder.svg",
  "salon-extras.js",
  "salon-intake-controls.js",
  "smart-core.js"
)

# Asset subdirectories mirrored from root/assets/ to www/assets/.
$AssetSubdirs = @("mens", "womens", "placeholders")

# Sync top-level HTML files.
foreach ($f in $HtmlFiles) {
  Copy-FileSafe (Join-Path $RootDir $f) (Join-Path $WwwDir $f)
}

# Sync admin shell.
$RootAdminDir = Join-Path $RootDir "admin"
$WwwAdminDir = Join-Path $WwwDir "admin"
foreach ($f in $AdminFiles) {
  Copy-FileSafe (Join-Path $RootAdminDir $f) (Join-Path $WwwAdminDir $f)
}

# Sync individual asset files.
foreach ($f in $AssetFiles) {
  Copy-FileSafe (Join-Path $RootAssetsDir $f) (Join-Path $WwwAssetsDir $f)
}

# Sync asset subdirectories (images, placeholders).
$assetsPrefix = $RootAssetsDir + "\"
foreach ($subdir in $AssetSubdirs) {
  $srcSubdir = Join-Path $RootAssetsDir $subdir
  if (-not (Test-Path -LiteralPath $srcSubdir -PathType Container)) {
    Log "SKIP (missing in root): assets/$subdir/"
    $script:Skipped++
    continue
  }
  $files = Get-ChildItem -LiteralPath $srcSubdir -File -Recurse
  foreach ($src in $files) {
    $rel = $src.FullName.Substring($assetsPrefix.Length)
    $dst = Join-Path $WwwAssetsDir $rel
    Copy-FileSafe $src.FullName $dst
  }
}

Log "Sync complete: $($script:Synced) file(s) processed, $($script:Skipped) skipped."
