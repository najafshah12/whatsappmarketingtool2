# ---------------------------------------------------------------
# Point the dashboard at the always-on bridge (VM / cloud host)
# and stop the PC watchdog from fighting over the tunnel URL.
#
#   powershell -ExecutionPolicy Bypass -File scripts\switch-bridge-to-vm.ps1 `
#     -Url https://140-238-12-34.sslip.io
#
# What it does:
#   1. checks the new bridge answers /health
#   2. stores the URL + API key in the app database (takes effect immediately)
#   3. disables the "WhatsAppCRM-Stack" scheduled task (local tunnel watchdog),
#      so it can never overwrite the VM URL with a dead quick tunnel
# ---------------------------------------------------------------
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [string]$ApiKey = "CHANGE_THIS_TO_YOUR_SECRET_KEY_786",
  [switch]$KeepLocalWatchdog
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.worker"

if (-not (Test-Path $envFile)) { throw ".env.worker not found (needs WORKER_SECRET)." }
$secret = ((Get-Content $envFile | Where-Object { $_ -match '^WORKER_SECRET=' }) -split '=', 2)[1].Trim('"').Trim()
$appUrl = ((Get-Content $envFile | Where-Object { $_ -match '^APP_URL=' }) -split '=', 2)[1].Trim('"').Trim()
if (-not $appUrl) { $appUrl = "https://whatsappmarketingtool-main.vercel.app" }

$Url = $Url.TrimEnd("/")
if ($Url -notmatch '^https://') { throw "Use the full https:// URL of the hosted bridge." }

Write-Host "1/3  Checking $Url/health ..." -ForegroundColor Cyan
try {
  $health = Invoke-RestMethod -Uri "$Url/health" -TimeoutSec 30
  if (-not $health.status) { throw "Bridge answered without status=true." }
  Write-Host "     bridge OK - sessions: $($health.sessions.Count)" -ForegroundColor Green
} catch {
  throw "The hosted bridge is not answering at $Url. Check: docker logs wa-bridge, and that port 443 is open."
}

Write-Host "2/3  Publishing the URL to the dashboard ..." -ForegroundColor Cyan
$body = @{ url = $Url; key = $ApiKey } | ConvertTo-Json -Compress
$result = Invoke-RestMethod -Method Post -Uri "$appUrl/api/bridge/url" `
  -Headers @{ Authorization = "Bearer $secret" } -Body $body -ContentType "application/json" -TimeoutSec 60
Write-Host "     app reachable: $($result.reachable)" -ForegroundColor Green
if ($result.reachable -ne "yes") { Write-Host "     warning: the app could not reach it yet (DNS/cert still warming up)." -ForegroundColor Yellow }

if (-not $KeepLocalWatchdog) {
  Write-Host "3/3  Disabling the local tunnel watchdog (WhatsAppCRM-Stack) ..." -ForegroundColor Cyan
  $task = Get-ScheduledTask -TaskName "WhatsAppCRM-Stack" -ErrorAction SilentlyContinue
  if ($task) {
    Disable-ScheduledTask -TaskName "WhatsAppCRM-Stack" | Out-Null
    Write-Host "     disabled - the PC tunnel will no longer overwrite the VM URL" -ForegroundColor Green
  } else {
    Write-Host "     no scheduled task found (nothing to disable)" -ForegroundColor Yellow
  }
} else {
  Write-Host "3/3  Keeping the local watchdog (as requested)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Live bridge URL check:" -ForegroundColor Cyan
$diag = Invoke-RestMethod -Uri "$appUrl/api/bridge/url" -TimeoutSec 40
$diag | ConvertTo-Json -Depth 4
Write-Host ""
Write-Host "Ab dashboard khol kar Accounts -> Add account se numbers dobara scan karein." -ForegroundColor Green
