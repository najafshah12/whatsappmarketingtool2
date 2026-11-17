<#
.SYNOPSIS
  One-click starter for the whole WhatsApp CRM stack.

.DESCRIPTION
  Makes sure everything the app needs is running on this PC:
    1. the Baileys bridge                 (http://localhost:3000)
    2. the public Cloudflare tunnel       (the URL Vercel talks to)
    3. the campaign worker                (keeps campaigns sending)

  Safe to run any time: every step is a health check first, so a healthy stack is
  left untouched. If the tunnel URL changed, it updates Vercel and redeploys.

  Run it manually:   powershell -ExecutionPolicy Bypass -File .\scripts\start-all.ps1
  Double-click:      "Start WhatsApp CRM.bat" in the project root
  Automatic:         the scheduled task "WhatsAppCRM-Stack" runs it at logon and
                     every 10 minutes (see scripts\install-autostart.ps1)
#>
param(
  [switch]$Quiet,
  [switch]$Open
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$base = Split-Path -Parent $root
$bridgeDir = Join-Path $base "whatsapp-crm-api\whatsapp-crm-api"
$tunnelDir = Join-Path $base "tunnel"
$cloudflared = Join-Path $tunnelDir "cloudflared.exe"
$vercel = "C:\Users\New Rohaan Computers\.local\nodejs\node_modules\vercel\dist\index.js"
$logDir = Join-Path $root "logs"
$cacheFile = Join-Path $logDir "tunnel-url.txt"
$appUrl = "https://whatsappmarketingtool-main.vercel.app"
$apiKey = if ($env:WA_BRIDGE_API_KEY) { $env:WA_BRIDGE_API_KEY } else { "CHANGE_THIS_TO_YOUR_SECRET_KEY_786" }

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Say($message) { if (-not $Quiet) { Write-Host $message } }
function Write-Log($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  try { Add-Content -Path (Join-Path $logDir "stack.log") -Value $line } catch { }
}

# Only one run at a time (the scheduled task and a manual click can overlap).
$lockPath = Join-Path $logDir "start-all.lock"
$lock = $null
try {
  $lock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
} catch {
  Say "Another start-all run is already in progress."
  exit 0
}

try {
  # ---------------------------------------------------------------- 1. bridge
  $bridgeOk = $false
  try {
    $bridgeOk = (Invoke-WebRequest -Uri "http://localhost:3000/sessions/status" -Headers @{ "x-api-key" = $apiKey } -UseBasicParsing -TimeoutSec 6).StatusCode -eq 200
  } catch { $bridgeOk = $false }

  if ($bridgeOk) {
    Say "bridge   : running"
  } else {
    Say "bridge   : starting ..."
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
      $_.CommandLine -match 'whatsapp-crm-api' -and $_.CommandLine -match 'index\.js'
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    if (-not (Test-Path (Join-Path $bridgeDir "index.js"))) { throw "Bridge not found at $bridgeDir" }
    Start-Process -FilePath "node" -ArgumentList "index.js" -WorkingDirectory $bridgeDir -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logDir "bridge.log") `
      -RedirectStandardError (Join-Path $logDir "bridge.err.log")

    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Seconds 1
      try {
        if ((Invoke-WebRequest -Uri "http://localhost:3000/sessions/status" -Headers @{ "x-api-key" = $apiKey } -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200) { $bridgeOk = $true; break }
      } catch { }
    }
    if (-not $bridgeOk) { throw "The bridge did not start. See logs\bridge.err.log" }
    Say "bridge   : started"
    Write-Log "bridge started"
  }

  # ---------------------------------------------------------------- 2. tunnel
  function Test-Tunnel([string]$url) {
    if (-not $url) { return $false }
    try {
      return (Invoke-WebRequest -Uri "$url/sessions/status" -Headers @{ "x-api-key" = $apiKey } -UseBasicParsing -TimeoutSec 12).StatusCode -eq 200
    } catch { return $false }
  }

  $cachedUrl = if (Test-Path $cacheFile) { (Get-Content $cacheFile -Raw).Trim() } else { "" }
  $tunnelOk = Test-Tunnel $cachedUrl
  if (-not $tunnelOk -and $cachedUrl) {
    # Quick tunnels can stutter for a few seconds; confirm before replacing one.
    Start-Sleep -Seconds 5
    $tunnelOk = Test-Tunnel $cachedUrl
  }

  if ($tunnelOk) {
    Say "tunnel   : running ($cachedUrl)"
  } else {
    Say "tunnel   : (re)starting ..."
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    $tunnelLog = Join-Path $logDir "tunnel.log"
    Remove-Item $tunnelLog -Force -ErrorAction SilentlyContinue
    Start-Process -FilePath $cloudflared `
      -ArgumentList "tunnel", "--url", "http://localhost:3000", "--no-autoupdate" `
      -WorkingDirectory $tunnelDir -WindowStyle Hidden `
      -RedirectStandardError $tunnelLog -RedirectStandardOutput "$tunnelLog.out"

    $newUrl = $null
    for ($i = 0; $i -lt 90; $i++) {
      Start-Sleep -Seconds 1
      if (Test-Path $tunnelLog) {
        $match = Select-String -Path $tunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($match) { $newUrl = $match.Matches[0].Value; break }
      }
    }
    if (-not $newUrl) { throw "cloudflared did not produce a URL. See logs\tunnel.log" }

    $ready = $false
    for ($i = 0; $i -lt 45; $i++) {
      Start-Sleep -Seconds 3
      if (Test-Tunnel $newUrl) { $ready = $true; break }
    }
    if (-not $ready) {
      # DNS for a fresh quick tunnel can take a moment; do not throw the URL away.
      Write-Log "new tunnel URL not answering yet: $newUrl"
      Say "tunnel   : $newUrl (still warming up, keeping it)"
    }

    Say "tunnel   : new URL $newUrl"
    Write-Log "tunnel restarted: $newUrl"
    [System.IO.File]::WriteAllText($cacheFile, $newUrl)

    # Point Vercel at the new URL, then redeploy so the running build sees it.
    if (Test-Path $vercel) {
      Say "vercel   : updating WA_BRIDGE_URL ..."
      Push-Location $root
      try {
        foreach ($target in @("production", "preview")) {
          node $vercel env rm WA_BRIDGE_URL $target -y 2>&1 | Out-Null
          node $vercel env add WA_BRIDGE_URL $target --value "$newUrl" --type config --yes 2>&1 | Out-Null
        }
        Say "vercel   : deploying (about a minute) ..."
        node $vercel deploy --prod --yes 2>&1 | Out-Null
        Write-Log "vercel env + deploy updated for $newUrl"
        Say "vercel   : deploy ready"
      } catch {
        Write-Log "vercel update failed: $($_.Exception.Message)"
        Say "vercel   : update failed - run scripts\bridge-up.ps1 manually"
      } finally { Pop-Location }
    } else {
      Say "vercel   : CLI not found, update WA_BRIDGE_URL manually: $newUrl"
    }
  }

  # ---------------------------------------------------------------- 3. worker
  $workerRunning = [bool](Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'campaign-worker' })
  if ($workerRunning) {
    Say "worker   : running"
  } else {
    Say "worker   : starting ..."
    Start-Process -FilePath "node" -ArgumentList "scripts\campaign-worker.mjs" -WorkingDirectory $root -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logDir "worker.log") `
      -RedirectStandardError (Join-Path $logDir "worker.err.log")
    Write-Log "worker started"
    Say "worker   : started"
  }

  Say ""
  Say "App      : $appUrl"
  if (-not $Quiet) {
    Say "Everything is up. Open WhatsApp Accounts -> Scan with QR to link a number."
  }

  if ($Open) { Start-Process $appUrl }
} catch {
  Write-Log "start-all failed: $($_.Exception.Message)"
  if (-not $Quiet) { Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red }
  exit 1
} finally {
  if ($lock) { $lock.Dispose() }
  Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
}
