# Manual test report – owner walk-through

**Date:** 2026-10-26 · **Tester:** owner (manual, admin + driver view, desktop app window) · **Recorded by:** Claude
**Result:** 25 findings → tickets **NUD-137…153** (backlog §8, block "M2.6"), plus updates to NUD-124, NUD-125, NUD-126, NUD-135 and the superseded M3 sketches NUD-100…103. New binding decisions **D21–D30** (backlog §2).

Severity: **A** = blocks real use / wrong data · **B** = important change of behaviour or scope · **C** = polish / wording.

## Summary by area

| # | Area | Finding | Sev. | Ticket |
|---|---|---|---|---|
| F1 | Drivers | Working days/hours per driver + utilization (actual vs. planned, tour time vs. contract hours incl. loading time) + shift-end warning | B | NUD-152 |
| F2 | Planning | Fleet: vehicles with kg capacity, 2 drivers at the same time, vehicle assigned per day; split across vehicles first, then reload trips | B | NUD-146, NUD-147 |
| F3 | Driver | Optional departure checklist (Karton / Beutel / × counts + keys), records loading start | B | NUD-151 |
| F4 | Customers | Optional key + key number; driver can fill in **and correct**, with history | B | NUD-142 |
| F5 | Products | Only 3 products: Nudeln Beutel 3 kg, Nudeln Karton 10 kg, Wantan-Teig 5 kg ("3 ×"); weight per unit editable; label **Karton**, never "Kiste" | A | NUD-138 (supersedes NUD-124) |
| F6 | Wording | "Pin" vs. "Kartenpunkt" inconsistent → term removed; Parkplatz / Lieferadresse | C | NUD-139 |
| F7 | Dashboard | To-do "195 Kunden mit unbestätigtem Pin" doesn't explain consequence → "N Kunden ohne Parkplatz – Lieferung zur Adresse" + Parkplatz queue | B | NUD-141 |
| F8 | Routing | Parkplatz is the routing/navigation point; no Parkplatz → Lieferadresse; no confirmation step; nobody excluded | A | NUD-141 |
| F9 | Orders | "Positionen" → "Produkte" | C | NUD-139 |
| F10 | Orders | AI (OpenRouter) turns pasted customer text / screenshot into a draft; admin confirms. No bots | B | NUD-150 (supersedes NUD-100) |
| F11 | Orders | Requested delivery window (hours–days) instead of a date; earliest day with capacity | B | NUD-148 |
| F12 | Orders | Recurring orders (weekdays, every N weeks, seasons); confirmed once → auto-confirmed orders; inactive customer cancels future orders | B | NUD-149 (supersedes NUD-101) |
| F13 | Orders | Whole numbers only – no decimals, no half Beutel/Karton | A | NUD-137 |
| F14 | Tours | Bearbeiten: driver, vehicle, stop order, move stops between tours of the day; not the date | B | NUD-135 (unblocked) |
| F15 | Tours | Tour tabs always visible + "+ Tour" | C | NUD-135 |
| F16 | Tours | "Näherungswerte" → ORS key probably missing on server; ⚠-only badge; redundant "4 Stopps" | A | NUD-145 |
| F17 | i18n | Admin: only Deutsch + 中文 (Simplified), no Traditional | B | NUD-140 |
| F18 | i18n | Add English (admin + driver), Srpski (Latin) and Čeština (driver); Traditional Chinese removed everywhere | B | NUD-140 |
| F19 | UI | Day/night toggle shows moon + "Tagmodus" – contradictory | C | NUD-139 |
| F20 | Driver | Whole next-stop card opens details; "Details" becomes an icon | C | NUD-143 |
| F21 | Driver | One "Navigation starten": Parkplatz as waypoint, address as destination | B | NUD-126 (amended) |
| F22 | Driver | Key number visible on card, list and stop detail | B | NUD-142 |
| F23 | Driver | Photo from gallery besides camera | C | NUD-143 |
| F24 | Driver | Driver sets Parkplatz: current location + map confirm, or Breite/Länge | B | NUD-144 |
| F25 | QA | Tablet audit (portrait + landscape) of every page | C | NUD-153 |

## Details and owner decisions

### Admin – planning and fleet
- **F1** Utilization counts loading and checking time (checklist open → last stop + drive back). If the checklist is skipped, a default loading time from Settings is used. Measured from app events, not GPS (D19 stays).
- **F2** Capacity is **kg** (volume of Beutel and Karton is similar). Driver ↔ vehicle is assigned **per day**. If the load doesn't fit: use all vehicles first, reload trips only if still needed.
- **F14/F15** NUD-135 was blocked on "what may be edited?" – answered: driver, vehicle, stop order, moving stops between the day's tours; date not editable. Released tours: change goes through the "tour was updated" path; completed stops are locked.
- **F16** The tour for 27.10. showed "Näherungswerte" on duration and distance → heuristic fallback, real optimisation is not running (client priority #3).

### Admin – customers, products, orders
- **F4** Drivers know more than the system: driver input is saved directly with attribution and history.
- **F5** Conflicts with NUD-124 (6 products) → NUD-124 superseded. Chinese label for Karton: 纸箱.
- **F6–F8** "Pin" was renamed in the owner's head to "Parkplatz". That is a model change, not a rename: the Parkplatz becomes the routing point. The risk (geocoded address up to 50–200 m off, no confirmation) was accepted because the parking photo identifies the spot.
- **F10** Bots for WhatsApp/WeChat were considered and dropped (WeChat has no official bot API for personal accounts; owner prefers a text field).
- **F11** Planned day = earliest day in the window with capacity; office can move it.
- **F12** Lead time defaulted to 14 days (configurable) – owner gave no number.
- **F13** Applies to all products (no kg product remains).

### Driver app
- **F18** Driver languages: Deutsch · English · Srpski · Čeština · 中文 (current drivers asked for English, Serbian, Czech). Login switcher becomes DE · EN · SR · CS · 中文.
- **F21** Combined route uses one travel mode (driving) – the last bit Parkplatz → restaurant is routed by car. Apple Maps links support one destination only (goes to the Parkplatz). Accepted: "keep it simple".
- Also seen: unit label "Kiste" on driver screens (→ F5), demo products (Penne, Lasagneplatten, "Nude kiste") still active (→ F5).

### Not a bug
- Stop detail without name/address in the screenshot – owner had scrolled down.

## Suggested order
NUD-137 → 138 → 139 → 140 → 125 → 141 → 142 → 143 → 126 → 144 → 135 → 146 → 147 → 148 → 149 → 151 → 152, then the tickets with human steps: 145 (ORS key) → 150 (OpenRouter key) → 153 (tablet audit, depends on all).
(NUD-124 is superseded; NUD-125/126/135 are older open tickets that this block depends on.)

## Human steps (👤)
- Put the ORS API key on the vServer (NUD-145).
- Create an OpenRouter account + key, choose a model (NUD-150).
- Native-speaker review of `en`, `sr-Latn`, `cs`, `zh-Hans` strings (NUD-073).
