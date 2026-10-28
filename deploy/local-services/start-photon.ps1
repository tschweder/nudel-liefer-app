# Starts the local Photon geocoder the vServer asks through the tunnel (NUD-157).
#
# Photon is a Komoot project and needs a JVM (Java 21) and an Austria index; this machine has
# neither natively, so it runs in the official JRE image with the jar and the index mounted
# from `C:\ors-local` (the location a previous run of this setup created).
#
#   powershell -ExecutionPolicy Bypass -File deploy\local-services\start-photon.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\local-services\start-photon.ps1 -Logs
#
# The index (`photon-db-austria-1.0.tar.bz2`) comes from https://r2.koalasec.org/public/ and is
# unpacked once into `photon\photon_data`; unpacking takes a few minutes.
param(
  [switch]$Logs
)

$ErrorActionPreference = 'Stop'
$name = 'photon-austria'
$port = 2322
$data = 'C:\ors-local'
$jar = Join-Path $data 'photon-1.3.0.jar'

if ($Logs) {
  docker logs -f --tail 50 $name
  exit $LASTEXITCODE
}

if (-not (Test-Path $jar)) {
  throw "Photon jar missing: $jar`nDownload photon-1.3.0.jar from https://github.com/komoot/photon/releases and the Austria index from https://r2.koalasec.org/public/ into $data."
}
if (-not (Test-Path (Join-Path $data 'photon\photon_data'))) {
  throw "Photon index missing: unpack photon-db-austria-1.0.tar.bz2 into $data\photon first (tar -xjf)."
}

docker rm -f $name 2>$null | Out-Null
docker run -d --name $name --restart unless-stopped `
  -p "127.0.0.1:${port}:2322" `
  -v "${data}:/data" `
  eclipse-temurin:21-jre `
  java -jar /data/photon-1.3.0.jar serve -data-dir /data/photon -listen-ip 0.0.0.0 -listen-port 2322 -default-language de | Out-Null

for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 3
  try {
    $hit = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api?q=Wien&limit=1" -TimeoutSec 30
    if ($hit.features.Count -gt 0) {
      Write-Host 'Photon is ready.' -ForegroundColor Green
      exit 0
    }
  } catch {
    # still starting
  }
}
Write-Warning "Photon did not answer after 3 minutes. Check: docker logs $name"
exit 1
