<#
.SYNOPSIS
  Brings the WhatsApp bridge + public tunnel back online and points Vercel at it.

.DESCRIPTION
  Cloudflare "quick" tunnels have no uptime guarantee: they can be revoked after
  a few hours ("Unauthorized: Tunnel not found"). When that happens the app shows
  "Could not reach the WhatsApp bridge server" and every QR code stops loading.

  This script:
    1. makes sure the Baileys bridge is running on http://localhost:3000
    2. restarts cloudflared and waits for the new https://....trycloudflare.com URL
    3. verifies the new URL answers with the API key
    4. updates WA_BRIDGE_URL (Production + Preview) in Vercel
    5. redeploys production so the new URL takes effect

  Run it from anywhere:
      powershell -ExecutionPolicy Bypass -File .\scripts\bridge-up.ps1

  Options:
      -ApiKey <key>   Bridge API key (defaults to WA_BRIDGE_API_KEY or the bridge default)
      -SkipDeploy     Update Vercel env vars only, do not redeploy
#>
param(
  [string]$ApiKey = $(if ($env:WA_BRIDGE_API_KEY) { $env:WA_BRIDGE_API_KEY } else { "CHANGE_THIS_TO_YOUR_SECRET_KEY_786" }),
  [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$base = Split-Path -Parent $repo
$bridgeDir = Join-Path $base "whatsapp-crm-api\whatsapp-crm-api"
$tunnelDir = Join-Path $base "tunnel"
$cloudflared = Join-Path $tunnelDir "cloudflared.exe"
$vercel = "C:\Users\New Rohaan Computers\.local\nodejs\node_modules\vercel\dist\index.js"

function Wait-Until([scriptblock]$check, [int]$seconds, [int]$intervalMs = 1000) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $check) { return $true }
    Start-Sleep -Milliseconds $intervalMs
  }
  return $false
}

# --- 1. bridge -------------------------------------------------------------
Write-Host "[1/5] Checking the local bridge on :3000 ..." -ForegroundColor Cyan
$bridgeUp = $false
try {
  $probe = Invoke-WebRequest -Uri "http://localhost:3000/sessions/status" -Headers @{ "x-api-key" = $ApiKey } -UseBasicParsing -TimeoutSec 5
  $bridgeUp = $probe.StatusCode -eq 200
} catch { $bridgeUp = $false }

if (-not $bridgeUp) {
  if (-not (Test-Path (Join-Path $bridgeDir "index.js"))) { throw "Bridge not found at $bridgeDir" }
  Write-Host "      starting the bridge ..." -ForegroundColor Yellow
  Start-Process -FilePath "node" -ArgumentList "index.js" -WorkingDirectory $bridgeDir -WindowStyle Minimized
  $ok = Wait-Until {
    try { (Invoke-WebRequest -Uri "http://localhost:3000/sessions/status" -Headers @{ "x-api-key" = $ApiKey } -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200 } catch { $false }
  } 40
  if (-not $ok) { throw "The bridge did not start. Run 'node index.js' in $bridgeDir and check the errors." }
}
Write-Host "      bridge OK" -ForegroundColor Green

# --- 2. tunnel -------------------------------------------------------------
Write-Host "[2/5] Restarting the Cloudflare tunnel ..." -ForegroundColor Cyan
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$log = Join-Path $env:TEMP "wa-tunnel-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
Start-Process -FilePath $cloudflared `
  -ArgumentList "tunnel", "--url", "http://localhost:3000", "--no-autoupdate" `
  -WorkingDirectory $tunnelDir -WindowStyle Hidden `
  -RedirectStandardError $log -RedirectStandardOutput "$log.out"

$url = $null
$found = Wait-Until {
  if (Test-Path $log) {
    $match = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) { $script:url = $match.Matches[0].Value; return $true }
  }
  return $false
} 90 1000

if (-not $found -or -not $url) {
  Write-Host "      no URL yet - last log lines:" -ForegroundColor Red
  if (Test-Path $log) { Get-Content $log -Tail 6 }
  throw "cloudflared did not create a tunnel. Check your internet connection."
}
Write-Host "      tunnel: $url" -ForegroundColor Green

# --- 3. verify -------------------------------------------------------------
Write-Host "[3/5] Verifying the public URL ..." -ForegroundColor Cyan
$reachable = Wait-Until {
  try { (Invoke-WebRequest -Uri "$url/sessions/status" -Headers @{ "x-api-key" = $ApiKey } -UseBasicParsing -TimeoutSec 8).StatusCode -eq 200 } catch { $false }
} 40
if (-not $reachable) { throw "The tunnel URL was created but does not answer yet. Wait a minute and try again." }
Write-Host "      public URL answers OK" -ForegroundColor Green

# --- 4. Vercel env ---------------------------------------------------------
Write-Host "[4/5] Updating WA_BRIDGE_URL on Vercel (production + preview) ..." -ForegroundColor Cyan
if (-not (Test-Path $vercel)) {
  throw "Vercel CLI not found at $vercel. Install it with: npm i -g vercel"
}
Push-Location $repo
try {
  foreach ($target in @("production", "preview")) {
    node $vercel env rm WA_BRIDGE_URL $target -y 2>&1 | Out-Null
    node $vercel env add WA_BRIDGE_URL $target --value "$url" --type config --yes 2>&1 | Out-Null
    node $vercel env rm WA_BRIDGE_API_KEY $target -y 2>&1 | Out-Null
    node $vercel env add WA_BRIDGE_API_KEY $target --value "$ApiKey" --type config --yes 2>&1 | Out-Null
    Write-Host "      $target updated" -ForegroundColor Green
  }

  # --- 5. deploy -----------------------------------------------------------
  if ($SkipDeploy) {
    Write-Host "[5/5] Skipped deploy (-SkipDeploy). Run 'vercel deploy --prod' when ready." -ForegroundColor Yellow
  } else {
    Write-Host "[5/5] Deploying production (about a minute) ..." -ForegroundColor Cyan
    node $vercel deploy --prod --yes 2>&1 | Select-Object -Last 4
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Done. Bridge URL: $url" -ForegroundColor Green
Write-Host "Check https://whatsappmarketingtool-main.vercel.app/api/health - it should show bridge: configured, bridgeReachable: yes" -ForegroundColor Green
