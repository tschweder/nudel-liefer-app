# Driver offline copy (NUD-081)

What is stored on the driver's phone, where, for whom and for how long.

| Data | Where | Key | Written by | Removed |
|---|---|---|---|---|
| Today's tour JSON (stops, items, texts in all locales, notes, signed photo URLs, revision / change markers) | IndexedDB `nudel-driver-offline` / `tours` | user id (one record) | page (`syncDriverTour`) after `GET /api/driver/tour/today` | next sync of another user; any record of another day; when nothing is released; logout / login page |
| Photos of that tour | Cache Storage `nudel-driver-photos-v1` | `/api/driver/photo-cache/<photoId>` | page (downloads the signed URL with CORS `GET`) | photos no longer in the tour; logout / login page |
| App shell, offline shell pages `/<locale>/driver/offline-shell` | service worker precache | build revision | service worker install | next worker version |

- The service worker never stores authenticated HTML, RSC payloads or API answers. It only (a) serves the public, personal-data-free shell page when a load of `/<locale>/driver` or `/<locale>/driver/stops/<id>` fails, and (b) answers `/api/driver/photo-cache/<id>` from the photo cache.
- The shell page reads IndexedDB and renders the same components as the server pages from the same model (`src/lib/driver-tour-model.ts`).
- Requirements: the R2 bucket's CORS rule must allow `GET` from the app origin (docs/env.md), otherwise photos are not cached and the app shows "offline partly ready" instead of "ready offline".
- Offline, status buttons are disabled (queue: NUD-082).
