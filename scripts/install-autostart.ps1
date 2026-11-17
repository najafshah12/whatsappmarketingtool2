<#
.SYNOPSIS
  Installs (or removes) the auto-start watchdog for the WhatsApp CRM stack.

.DESCRIPTION
  Registers a scheduled task that runs scripts\start-all.ps1 at logon and every
  10 minutes. The script is idempotent: healthy services are left alone, and a
  dead bridge / tunnel / worker is restarted automatically.

  Install:  powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
  Remove:   powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1 -Remove
#>
param([switch]$Remove)

$taskName = "WhatsAppCRM-Stack"
$script = Join-Path $PSScriptRoot "start-all.ps1"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task '$taskName'."
  exit 0
}

if (-not (Test-Path $script)) { throw "start-all.ps1 not found next to this script." }

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Quiet"

$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 10))
)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings `
  -Principal $principal -Force `
  -Description "Keeps the WhatsApp CRM bridge, Cloudflare tunnel and campaign worker running." | Out-Null

Write-Host "Installed scheduled task '$taskName'."
Write-Host "  - runs at logon"
Write-Host "  - re-checks every 10 minutes"
Write-Host "  - log: logs\stack.log"
