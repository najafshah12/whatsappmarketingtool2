param(
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "start"
)

# Native tools such as psql write probe failures to stderr, which must not
# abort the script before it gets a chance to start the cluster.
$ErrorActionPreference = "Continue"
$pgBin = "C:\Program Files\PostgreSQL\16\bin"
$dataDir = Join-Path $env:LOCALAPPDATA "reachpulse-pg\data"
$logFile = Join-Path $env:LOCALAPPDATA "reachpulse-pg\postgres.log"
$port = 5433

if (-not (Test-Path (Join-Path $dataDir "PG_VERSION"))) {
  throw "Local ReachPulse database cluster was not found at $dataDir. Run initdb first (see README)."
}

function Test-Database {
  $env:PGPASSWORD = ""
  & (Join-Path $pgBin "psql.exe") -w -U postgres -h 127.0.0.1 -p $port -d wa_studio -tAc "select 1" 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}

switch ($Action) {
  "start" {
    if (Test-Database) {
      Write-Host "ReachPulse database is already running on 127.0.0.1:$port."
      exit 0
    }
    Start-Process -FilePath (Join-Path $pgBin "pg_ctl.exe") `
      -ArgumentList @("-D", "`"$dataDir`"", "-l", "`"$logFile`"", "-o", "`"-p $port -c listen_addresses=127.0.0.1`"", "start") `
      -WindowStyle Hidden
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-Database) {
        Write-Host "ReachPulse database started on 127.0.0.1:$port (database: wa_studio)."
        exit 0
      }
    }
    throw "The database did not start within 15 seconds. Check $logFile."
  }
  "stop" {
    & (Join-Path $pgBin "pg_ctl.exe") -D $dataDir stop -m fast
    Write-Host "ReachPulse database stopped."
  }
  "status" {
    if (Test-Database) { Write-Host "Running on 127.0.0.1:$port." }
    else { Write-Host "Not running." }
  }
}
