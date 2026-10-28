# Demo guide (5 minutes)

A walk through the M1 MVP for the client: the office takes an order, plans and releases the tour, the
driver delivers on a phone, the office watches. All demo businesses are invented; the street
addresses are real public addresses in Vienna.

## 0. Prepare (once, 5 minutes before the demo)

1. Start Postgres and an S3-compatible store: `docker compose up -d` (Postgres + MinIO). Copy
   `.env.example` to `.env` and set `SEED_ADMIN_PASSWORD`, `AUTH_SECRET` and the `S3_*` variables for MinIO
   (`S3_ENDPOINT=http://localhost:9123`, `S3_BUCKET=nudel-photos`, the MinIO keys, bucket created).
2. `pnpm db:migrate && pnpm db:seed --demo --today` (orders for today, so the driver sees the tour right away; without `--today` the orders are for the next delivery day). The demo seed needs the S3 store: the generated photos
   ("EINGANG" blue, "PARKEN" green, with the customer number) are real image files in the bucket, and
   the seed stops with a clear message when no S3 store is configured (the in-memory Fake store would
   lose them). `--no-photos` seeds everything except the photos (used by CI).
3. `pnpm dev` (or `pnpm build && pnpm start`) and open <http://localhost:3000/de>.

What the demo seed creates (safe to run again, nothing is duplicated):

| What      | Details                                                                                                                                                                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Depot     | "Nudelfabrik Wien (Demo)", Absberggasse 27, 1100 Wien, pin already confirmed. A depot an admin already confirmed is never overwritten.                                                                                                                                     |
| Customers | `D-001` .. `D-020`, 20 restaurants, real Vienna addresses, geocoded address points, each with an entrance and a parking photo; some have delivery hours and a note (German + Chinese).                                                                                     |
| Products  | The 3 catalog products (Nudeln Sackerl, Nudeln Kiste, Wantan-Teig) with names in all four languages.                                                                                                                                                                       |
| Orders    | One confirmed order per customer (1 to 3 lines) for the **next delivery day** (`--today`: for today); the seed prints the date. Running it again adds nothing while those orders are still in the future; on a later day, after that date has passed, it adds a fresh set. |
| Logins    | Admin `admin@example.com` / `SEED_ADMIN_PASSWORD`. Drivers (PIN `123456`, or `SEED_DRIVER_PIN`): `fahrer-de` (German), `driver-hans` (简体), `driver-en` (English), `driver-sr` (Srpski), `driver-cs` (Čeština).                                                           |

Tip: open two browser windows side by side: the admin on a desktop-size window, the driver in a
phone-size window (browser dev tools, e.g. 390 x 844), logged in as `driver-hans`.

## 1. Script

**Minute 0 - 1: the office view.** Log in as admin at `/de/login`. On "Übersicht" point out the
"Heute" card (no tour yet). Open "Kunden": 20 customers, search for `Rosa`, open one: address, address
point on the map, the two photos (entrance, parking), delivery hours and the note.

**Minute 1 - 2: take an order.** "Bestellungen" -> "Neue Bestellung". Pick a customer by typing (the date is preselected, set it to today), add two products by keyboard (Enter adds the next line), e.g. quantity
`2,5`. Save. In the order list the new order shows next to the 20 demo orders. Mention: orders of
the same customer and day are merged into one stop.

**Minute 2 - 3: plan the tour.** "Touren", choose the delivery date (the seed output names it).
"Tour erstellen": 21 stops on a map in an optimized order with arrival times (without an ORS key the
order comes from the local fallback and is marked "approximate"). Drag one stop to another place and show
that the numbers and times follow. Pick the driver "司机 简体" and press "Tour freigeben"; the dialog
summarises stops, driving time and driver. Confirm.

**Minute 3 - 4: the driver's phone.** Phone window, log in as `driver-hans` (PIN `123456`). Today's tour
in Simplified Chinese: next stop on top, remaining time, list of stops. Open the first stop: the
products with big quantities, the entrance photo, the parking photo, the customer note, the
"Navigation starten" button (opens Google Maps with the customer's Parkplatz, or the address when there is none). Mark "Geliefert": the next stop
opens by itself. Show a problem once: tap the problem button, pick a reason ("Kein Parkplatz"), type a
short text. Switch the language with the language button (English, Srpski, Čeština, 中文, Deutsch): the same data in every
variant, customer names and addresses stay untouched.

> The driver sees only the tour of **today**: that is why the demo seed is run with `--today`. Without it, generate the tour for the next delivery day and present the driver part on that day.

**Minute 4 - 5: the office sees progress.** Back in the admin window: "Übersicht" shows "x von 21
Stopps erledigt", the next open stop and the problem with its reason; the tour page shows a status per
stop with the completion time and the original text of the driver. Both screens refresh by
themselves (every 30 seconds). Finish with "photos missing" on a newly created customer
("Kunden" -> "Neuer Kunde": the address point is looked up by itself, the Parkplatz and photos can follow).

## 2. Reset

To start over, drop and recreate the database (`pnpm db:migrate && pnpm db:seed --demo`), or just
create a new set of demo orders by running `pnpm db:seed --demo` after the old delivery date has passed.

The demo seed is idempotent and safe to re-run at any time: an existing demo photo is left alone, and a
photo slot whose demo photo only survives as history (a driver replaced it and that new photo was removed
again, e.g. by a cleaned-up test or a restored database) is repaired under a new storage key instead of
failing with `key_in_use` (NUD-160).

## 3. End-to-end check

`tests/e2e/mvp-happy-path.spec.ts` automates the core of this script (admin creates a customer and an
order for today, generates and releases the tour, a driver in `zh-Hans`, `en`, `sr-Latn`, `cs` and
`de` delivers, the admin sees it). It needs the demo seed (confirmed depot) and a database without a
tour for today: `pnpm db:seed --demo --no-photos && pnpm exec playwright test mvp-happy-path`.
