# Per-pin review task — parking-spot import, Phase 2

You are given **one** unit: one Google-Maps screenshot from a capture run in which the client walked
or drove to ~49 shops and, for each, dropped a pin and photographed where a delivery driver should
park. Your job is to decide which Nudel customer that pin belongs to.

The orchestrator passes you a `unitId`. Read `.parking-import/units/<unitId>.json` first — it lists
the screenshot, the evidence photos with their time offsets, and the crop files to read.

## The files

Read them with the image reader, in this order:

| File                                                         | What it is                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `.parking-import/crops/<unitId>-searchbar.png`               | the Google Maps search field, 2× upscaled — holds the coordinates        |
| `.parking-import/crops/<unitId>-map.png`                     | the map band around the pin at native resolution — street and POI labels |
| `.parking-import/crops/<unitId>-bottom.png`                  | the bottom sheet — address card, "In der Nähe von …", district           |
| `.parking-import/crops/<unitId>-photo-1.png`, `-photo-2.png` | the parking photo(s), when the unit has any                              |

`.parking-import/customers.json` (198 active production customers with coordinates, address groups,
existing Parkplätze and current photos) and `.parking-import/address-groups.json` are there to be
read if you need more than the helper prints.

## Step 1 — the coordinates

Transcribe the coordinate pair exactly as printed in the search field, latitude first:
`48.271953,16.446999` → `lat 48.271953`, `lng 16.446999`. Six decimals. Spaces after the comma are
fine. Do **not** round, do not invent or "repair" digits — a wrong digit here puts a driver in the
wrong street. Make sure the result is plausible for Austria: `lat` 46.3–49.1, `lng` 9.5–17.2.

If the field does not contain a coordinate pair (a name, an address, an empty box), set `spot` to
`null`, `coordinatesSource` to `"unreadable"` and explain in `warnings`. Do not fall back to the map
or the bottom sheet for coordinates.

## Step 2 — the context

- `map.png`: list **every** readable street name, shop/POI name and district label ("1210 Wien",
  "Floridsdorf"). These are matching evidence; transcribe them, do not summarise.
- `bottom.png`: transcribe the address / "In der Nähe von …" block / district exactly. Sometimes it
  gives a full street address with a house number (the strongest evidence there is), sometimes only
  a district.

## Step 3 — the parking photo(s)

Describe what they show: shop signage and names, house numbers, street plates, and the parking
situation itself (garage entrance, backyard, loading zone, courtyard). House numbers and shop names
are gold — they confirm an address directly.

The run is dense in places: a photo may be the neighbouring pin's. If a photo clearly shows a
different address than the pin, say so in `photoNotes` and lower the confidence — never force it.
Every photo is evidence, none is authoritative.

## Step 4 — match

Run and read:

```
python scripts/parking-import/nearest-customers.py --lat <lat> --lng <lng> --top 6 --radius 800
```

It prints the nearest customers with haversine distances, their address group and their existing
Parkplätze. Then decide:

- **Distance**: a candidate must be within roughly **400 m** of the pin to be plausible. Beyond that,
  only a match on the street address in the bottom sheet justifies listing it.
- **Address text** from the bottom sheet beats distance when it names a street.
- **Map labels** break ties between two close candidates (the customer's street or shop name
  appearing on the map).
- **The photo** confirms the shop (signage, house number).
- Customer names in this database encode the shop and the district ("063 King Asp", "121 King21",
  "099 wok", "071 King Kagran"). Use them as a hint only, never as proof.
- If the winning customer's `addressGroupSize` is greater than 1, put **every** customer of that
  address group into `customerIds` — one address means one parking spot and one photo.
- A customer that already has an `existingParkingSpot` very close to the pin is a strong signal that
  somebody has already recorded this exact pin.

## Step 5 — the status

| Status      | When                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matched`   | exactly one customer / address group clearly fits. `confidence` 0.85–1.0 when the coordinates decide it and the address text agrees; 0.5–0.85 when it rests on proximity plus labels. |
| `ambiguous` | two or more plausible candidates, or the coordinates could not be read. List them in `candidates` with a reason each. This is a normal, expected answer.                              |
| `no_match`  | nothing plausible within ~400 m, or no candidate fits the evidence (`candidates` may still list the nearest few with the reason they were rejected).                                  |

**Never guess.** A wrong assignment silently sends a driver to the wrong place; an `ambiguous` answer
costs a human two minutes.

## Output — exactly one file

Write `.parking-import/results/<unitId>.json`, UTF-8, valid JSON, no comments:

```json
{
  "unitId": "u01",
  "screenshot": "Screenshot_20261027_041156.jpg",
  "photos": [],
  "spot": { "lat": 48.271953, "lng": 16.446999 },
  "coordinatesSource": "searchbar",
  "mapLabels": ["Else-Feldmann-Promenade", "Nefis Kebab Großfeldsiedlung", "Floridsdorf"],
  "bottomSheetText": "Floridsdorf · 1210 Wien · 1 min",
  "customerIds": ["cmvph28dz0035o6jxlau7c682"],
  "addressGroupKey": "kurschnergasse|9|1210",
  "distanceM": 320.9,
  "confidence": 0.9,
  "evidence": ["short sentence per observation that drove the decision"],
  "photoNotes": "what the parking photo shows, or null",
  "status": "matched",
  "candidates": [],
  "warnings": []
}
```

- `spot` is `null` **only** when `coordinatesSource` is `"unreadable"`.
- `customerIds` is empty unless `status` is `matched`.
- `candidates` entries look like
  `{"customerId": "…", "customerNumber": "1119", "name": "121 King21", "addressLabel": "Kürschnergasse 9, 1210 Wien", "distanceM": 320.9, "reason": "…"}`
  and are required for `ambiguous`.
- `evidence` holds plain observations ("bottom sheet names Kürschnergasse", "photo shows house
  number 9 on a blue plate"), one per string. No chain-of-thought, no prose blocks.

## Hard rules

- **Never** modify anything under `2026-10/`.
- Write **only** your own `.parking-import/results/<unitId>.json`.
- Do **not** touch the database, the object storage, `customers.json`, or any other file.
- Do not run the import script or any command that writes to the database.

## What you return

Exactly **one line**, nothing else:

```
u07: matched 1119 "121 King21" 321 m (conf 0.9)
u12: ambiguous 2 candidates (1006 "099 wok" 88 m, 1165 "Rush Hour" 210 m)
u31: no_match (nearest 780 m)
```
