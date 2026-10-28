# Self-hosted ORS and Photon for the vServer (NUD-156, NUD-157)

The app runs on the client's vServer, which has **2 GB RAM** — far too little for
openrouteservice (needs ~4 GB for Austria) or Photon. So both run **on this development PC**
in Docker, and the vServer reaches them through a **reverse SSH tunnel** as
`127.0.0.1:8082` (ORS) and `127.0.0.1:2322` (Photon). Nothing is exposed to the internet:
the forwards listen on the server's loopback only (`GatewayPorts` stays at its default).

```
dev PC                                   vServer (2 GB)
┌───────────────────────┐   ssh -R     ┌──────────────────────────────┐
│ docker: nudel-ors     │◄────────────►│ delivery-app (systemd, 3100) │
│   127.0.0.1:8082      │              │   ORS_BASE_URL=http://127.0.0.1:8082/ors
│ docker: nudel-photon  │              │   PHOTON_URL=http://127.0.0.1:2322
│   127.0.0.1:2322      │              └──────────────────────────────┘
└───────────────────────┘
```

**Degradation is graceful:** if this PC sleeps or the tunnel drops, routing falls back to the
local heuristic (the tour shows "Näherungswerte") and geocoding to the Fake. The app keeps
working — it just stops being exact.

## Data outside the repository

~800 MB OSM extract plus the built graphs. Default location `C:\Users\niko\Desktop\nudel-infra`
(override with the `NUDEL_INFRA_DIR` environment variable):

```
nudel-infra/
├─ osm/austria-latest.osm.pbf    # https://download.geofabrik.de/europe/austria-latest.osm.pbf
├─ ors-graphs/                   # built by ORS on first start (~5 min, do not commit/copy around)
└─ photon-index/                 # built by Photon on first start
```

## Start everything

Windows PowerShell 5.1 blocks unsigned scripts by default (`… is not digitally signed`). Either
run with `-ExecutionPolicy Bypass`, or just copy the commands out of the scripts.

```powershell
# 1. routing (first start builds the Austria car graph: several minutes, ~4 GB RAM)
powershell -ExecutionPolicy Bypass -File deploy\local-services\start-ors.ps1

# 2. geocoding (first start builds the Photon index: several minutes, ~2 GB RAM)
powershell -ExecutionPolicy Bypass -File deploy\local-services\start-photon.ps1

# 3. the tunnel the server uses (keeps itself alive; -Install registers a logon task)
powershell -ExecutionPolicy Bypass -File deploy\local-services\tunnel.ps1
powershell -ExecutionPolicy Bypass -File deploy\local-services\tunnel.ps1 -Status
```

Check from the server:

```bash
curl -s http://127.0.0.1:8082/ors/health            # {"status":"ready", …}
curl -s 'http://127.0.0.1:2322/api?q=Mariahilfer+Straße+1+Wien&limit=1&lang=de'
```

## Server configuration

`/etc/delivery-app.env` on the vServer (survives every `deploy.bat` since 2026-10-28):

```sh
ORS_BASE_URL=http://127.0.0.1:8082/ors
PHOTON_URL=http://127.0.0.1:2322
PHOTON_LANG=de
# ORS_API_KEY stays unset: a key would make the hosted API win over the local instance only
# for geocoding, and there is no hosted routing here any more.
```

Then `systemctl restart delivery-app`. `GET /delivery-app/api/health` reports whether routing
and geocoding use the local instances or a fallback.

## Why not simply ORS on the vServer?

Measured 2026-10-28: the box has 1.8 GB RAM, no JVM, and already runs Postgres, MinIO, the app
and two other apps. The ORS car graph for Austria alone wants ~2 GB heap.
