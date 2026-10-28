# Starts the local openrouteservice container the vServer routes through (NUD-156).
#
#   pwsh -File deploy/local-services/start-ors.ps1            # start (builds the graph on first run)
#   pwsh -File deploy/local-services/start-ors.ps1 -Rebuild   # drop the graph and rebuild it
#   pwsh -File deploy/local-services/start-ors.ps1 -Logs      # follow the container log
#
# The first start builds the car graph for Austria; that takes several minutes and needs
# ~4 GB of RAM in the Docker VM. The graph is cached in `graphs/`, so later starts are quick.
param(
  [switch]$Rebuild,
  [switch]$Logs
)

$ErrorActionPreference = 'Stop'
$image = 'openrouteservice/openrouteservice:v9.1.1'
$name = 'nudel-ors'
$port = 8082

$infra = if ($env:NUDEL_INFRA_DIR) { $env:NUDEL_INFRA_DIR } else { Join-Path $HOME 'Desktop\nudel-infra' }
$osm = Join-Path $infra 'osm\austria-latest.osm.pbf'
$graphs = Join-Path $infra 'ors-graphs'
$config = Join-Path $PSScriptRoot 'ors-config.yml'

if (-not (Test-Path $osm)) {
  throw "OSM extract missing: $osm`nDownload it from https://download.geofabrik.de/europe/austria-latest.osm.pbf"
}
New-Item -ItemType Directory -Force $graphs | Out-Null

if ($Logs) {
  docker logs -f --tail 50 $name
  exit $LASTEXITCODE
}

$existing = docker ps -a --filter "name=^$name$" --format '{{.Names}}'
if ($existing) {
  docker rm -f $name | Out-Null
}
if ($Rebuild) {
  Get-ChildItem $graphs -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
}

# 127.0.0.1 only: the container must never be reachable from the LAN, the vServer comes in
# through the SSH tunnel. XMX 4g because Austria needs it; the Docker VM has 8 GB.
docker run -d --name $name --restart unless-stopped `
  -p "127.0.0.1:${port}:8082" `
  -e XMS=2g -e XMX=4g `
  -v "${osm}:/home/ors/files/austria-latest.osm.pbf:ro" `
  -v "${config}:/home/ors/config/ors-config.yml:ro" `
  -v "${graphs}:/home/ors/graphs" `
  $image | Out-Null

Write-Host "Started $name. Health: http://127.0.0.1:$port/ors/health"
Write-Host "Following the log until the graph is ready (Ctrl+C to detach)..."
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Seconds 5
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/ors/health" -TimeoutSec 5
    if ($health.status -eq 'ready') {
      Write-Host 'ORS is ready.' -ForegroundColor Green
      exit 0
    }
  } catch {
    # not up yet
  }
}
Write-Warning "ORS did not report 'ready' after 10 minutes. Check: docker logs $name"
exit 1
