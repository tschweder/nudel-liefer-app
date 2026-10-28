# Reverse SSH tunnel from this PC to the vServer (NUD-156/NUD-157).
#
# The vServer has 2 GB RAM, so openrouteservice and Photon run on the developer PC and the
# server reaches them through this tunnel as 127.0.0.1:<port> — that is what ORS_BASE_URL /
# PHOTON_URL in /etc/delivery-app.env point at. `GatewayPorts` stays at its default, so the
# forwards listen on the server's loopback only: nothing is exposed to the internet.
#
#   pwsh -File deploy/local-services/tunnel.ps1              # keep the tunnel up (Ctrl+C to stop)
#   pwsh -File deploy/local-services/tunnel.ps1 -Install     # register it as a logon task
#   pwsh -File deploy/local-services/tunnel.ps1 -Status      # is anything forwarded right now?
#
# If this PC sleeps, routing on the server degrades to the local heuristic ("Näherungswerte")
# and geocoding to the Fake — the app keeps working, it just stops being exact.
param(
  [switch]$Install,
  [switch]$Status
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$envFile = Join-Path $repo '.env'
if (-not (Test-Path $envFile)) { throw ".env not found at $envFile (REMOTE_IP / REMOTE_USER)." }

$vars = @{}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim() }
}
$ip = $vars['REMOTE_IP']
$user = $vars['REMOTE_USER']
if (-not $ip -or -not $user) { throw '.env must set REMOTE_IP and REMOTE_USER.' }

$key = Join-Path $HOME '.ssh\id_ed25519'
$target = "$user@$ip"
# 8082 = openrouteservice, 2322 = Photon
$forwards = @('-R', '8082:127.0.0.1:8082', '-R', '2322:127.0.0.1:2322')

if ($Status) {
  ssh -o BatchMode=yes -i $key $target "ss -ltnp | grep -E ':8082|:2322' || echo 'no forward listening'"
  exit $LASTEXITCODE
}

if ($Install) {
  # powershell.exe, not pwsh: Windows PowerShell 5.1 is what this machine has.
  $command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'tunnel.ps1')`""
  # A per-user Run key needs no elevation; the scheduled task does on some machines. Try the task
  # first because it is easier to see, and fall back to the Run key when Windows refuses it.
  schtasks /Create /F /SC ONLOGON /TN 'NudelLieferApp-Tunnel' /TR $command 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Registered logon task 'NudelLieferApp-Tunnel'. Start it now with: schtasks /Run /TN NudelLieferApp-Tunnel"
    exit 0
  }
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  New-Item -Path $runKey -Force | Out-Null
  New-ItemProperty -Path $runKey -Name 'NudelLieferApp-Tunnel' -Value $command -PropertyType String -Force | Out-Null
  Write-Host "Registered the autostart entry 'NudelLieferApp-Tunnel' under $runKey (the scheduled task was refused)."
  Write-Host "It starts at your next logon; start it now with:"
  Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'tunnel.ps1')`""
  exit 0
}

# -N: no shell, only forwards. ExitOnForwardFailure: fail fast when a port is taken on the
# server instead of silently coming up without the forwards. The loop reconnects after a
# network drop or a reboot of either side.
while ($true) {
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] connecting $target ..."
  ssh -N -i $key -o BatchMode=yes -o ExitOnForwardFailure=yes `
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
    @forwards $target
  Write-Warning "[$(Get-Date -Format 'HH:mm:ss')] tunnel ended (exit $LASTEXITCODE), retrying in 10 s"
  Start-Sleep -Seconds 10
}
