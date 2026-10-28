#!/usr/bin/env python3
"""Phase 5 of the parking-spot import: turn the Phase 2 results into a review report.

Reads `.parking-import/manifest.json`, `results/*.json`, the customer snapshot and
`check.json`, then writes:

  .parking-import/REPORT.html    self-contained review report with embedded thumbnails:
                                 one card per pin (search bar, map, parking photo),
                                 the matched customer(s), distance, confidence, evidence,
                                 and separate sections for everything a human must decide
  .parking-import/REPORT.md      the same content as a plain-text summary table
  .parking-import/review.json    the merged, machine-readable decision list (what the
                                 import script will report against in its dry run)

This script decides nothing about the customers — it only merges, orders and displays what
the review agents found, and marks which pins are ready to import. It never writes to the
database, the object storage or `2026-10/`.

The parking photo for a customer is chosen here, deterministically: every photo inside the
evidence window is assigned to exactly one pin (the closest in time), so one photo is never
attached to two different customers. A pin without an assigned photo is imported with its
Parkplatz only and stays flagged "photo missing".

Usage:
    python scripts/parking-import/build-report.py
    python scripts/parking-import/build-report.py --open
"""

from __future__ import annotations

import argparse
import base64
import html
import io
import json
import math
import webbrowser
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
WORK = REPO_ROOT / ".parking-import"

EARTH_RADIUS_M = 6_371_008.8
PLAUSIBLE_RADIUS_M = 400
EXISTING_SPOT_M = 25
#: Below this confidence a match is handed to a human instead of being imported.
MIN_CONFIDENCE = 0.6
#: Two pins this close are the same spot; one customer gets exactly one Parkplatz.
SAME_SPOT_M = 5
EVIDENCE_WINDOW_S = 400

THUMB_EDGES = {"searchbar": 620, "map": 420, "bottom": 360, "photo": 380}
THUMB_QUALITY = 55


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def read_json(path: Path, default: object = None) -> object:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def thumbnail(path: Path, edge: int) -> str | None:
    """A small inline JPEG data URI, so REPORT.html works without the crops folder."""
    if not path.is_file():
        return None
    try:
        with Image.open(path) as image:
            image = image.convert("RGB")
            longest = max(image.size)
            if longest > edge:
                factor = edge / longest
                image = image.resize(
                    (max(1, round(image.width * factor)), max(1, round(image.height * factor))),
                    Image.LANCZOS,
                )
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=THUMB_QUALITY, optimize=True)
        return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    except OSError:
        return None


# ---------------------------------------------------------------------------------------------
# Photo assignment: one photo per pin, at most one pin per photo
# ---------------------------------------------------------------------------------------------


def assign_photos(units: list[dict]) -> dict[str, str]:
    """photo file -> unitId, by globally closest time distance (deterministic, 1:1).

    Called with the units that will actually be imported, so a photo is never reserved by a pin
    that is later dropped as a duplicate.
    """
    candidates: list[tuple[int, str, str]] = []
    for unit in units:
        unit_id = unit["unitId"]
        for meta in unit.get("photoMeta", []):
            delta = int(meta["deltaSeconds"])
            if abs(delta) <= EVIDENCE_WINDOW_S:
                candidates.append((abs(delta), unit_id, meta["file"]))
    candidates.sort()
    taken_units: set[str] = set()
    taken_photos: set[str] = set()
    assignment: dict[str, str] = {}
    for _, unit_id, photo in candidates:
        if unit_id in taken_units or photo in taken_photos:
            continue
        taken_units.add(unit_id)
        taken_photos.add(photo)
        assignment[photo] = unit_id
    return assignment


def apply_photo_assignment(entries: list[dict], units_by_id: dict[str, dict]) -> None:
    """Fill in each entry's photo and its available evidence photos from the manifest.

    Run after `resolve_conflicts`, so the deterministic one-photo-per-pin assignment only
    considers the pins that survive. A pin that lost a collision (marked `droppedFor`) does not
    reserve a photo either, so the photo goes to the pin that is actually imported.
    """
    dropped = {entry["unitId"] for entry in entries if entry.get("droppedFor")}
    photo_to_unit = assign_photos(
        [unit for unit in units_by_id.values() if unit["unitId"] not in dropped]
    )
    for entry in entries:
        unit = units_by_id.get(entry["unitId"])
        if unit is None:
            continue
        entry["photosAvailable"] = [meta["file"] for meta in unit.get("photoMeta", [])]
        entry["photo"] = next(
            (
                meta
                for meta in unit.get("photoMeta", [])
                if photo_to_unit.get(meta["file"]) == entry["unitId"]
            ),
            None,
        )


# ---------------------------------------------------------------------------------------------


def build_entries(
    units: list[dict],
    results: dict[str, dict],
    by_id: dict[str, dict],
    group_members: dict[str, list[str]],
    existing_spots: list[dict],
) -> list[dict]:
    entries: list[dict] = []
    for unit in units:
        unit_id = unit["unitId"]
        data = results.get(unit_id, {})
        spot = data.get("spot") if isinstance(data.get("spot"), dict) else None
        status = data.get("status", "missing")
        customer_ids = list(data.get("customerIds") or [])

        existing = None
        if spot and customer_ids:
            for candidate in existing_spots:
                if candidate["customerId"] not in customer_ids:
                    continue
                distance = haversine_m(spot["lat"], spot["lng"], candidate["lat"], candidate["lng"])
                if distance <= EXISTING_SPOT_M:
                    existing = {**candidate, "distanceM": round(distance, 1)}
                    break

        distances = []
        for customer_id in customer_ids:
            customer = by_id.get(customer_id)
            if not customer:
                continue
            value = None
            if spot and customer["lat"] is not None:
                value = round(
                    haversine_m(spot["lat"], spot["lng"], customer["lat"], customer["lng"]), 1
                )
            distances.append({"customerId": customer_id, "distanceM": value})

        # What the import will do with this pin.
        if status != "matched" or not spot or not customer_ids:
            action = "review"
            reason = {
                "ambiguous": "the review agent found more than one plausible customer",
                "no_match": "no customer was plausible for this pin",
                "missing": "no review result was written for this pin",
            }.get(status, f"status is {status}")
        elif existing:
            action = "exists"
            reason = "a Parkplatz already exists at these coordinates"
        elif any(
            d["distanceM"] is not None and d["distanceM"] > PLAUSIBLE_RADIUS_M for d in distances
        ):
            action = "review"
            reason = f"matched customer is more than {PLAUSIBLE_RADIUS_M} m from the pin"
        elif isinstance(data.get("confidence"), (int, float)) and data["confidence"] < MIN_CONFIDENCE:
            action = "review"
            reason = f"confidence {data['confidence']} is below {MIN_CONFIDENCE}"
        else:
            action = "create"
            reason = ""
        if action == "create" and any(
            (by_id.get(cid) or {}).get("lat") is None for cid in customer_ids
        ):
            reason = (
                "customer has no address point, so the distance cannot be checked - "
                "the match rests on the address text in the screenshot"
            )

        entries.append(
            {
                "unitId": unit_id,
                "screenshot": unit["screenshot"],
                "screenshotTime": unit["screenshotTime"],
                "status": status,
                "action": action,
                "actionReason": reason,
                "spot": spot,
                "customerIds": customer_ids,
                "customers": [
                    {
                        "customerId": cid,
                        "customerNumber": (by_id.get(cid) or {}).get("customerNumber"),
                        "name": (by_id.get(cid) or {}).get("name"),
                        "addressLabel": (by_id.get(cid) or {}).get("addressLabel"),
                        "distanceM": next(
                            (d["distanceM"] for d in distances if d["customerId"] == cid), None
                        ),
                    }
                    for cid in customer_ids
                ],
                "addressGroupKey": data.get("addressGroupKey"),
                "groupMembers": group_members.get(data.get("addressGroupKey") or "", []),
                "distanceM": next(
                    (d["distanceM"] for d in distances if d["distanceM"] is not None), None
                ),
                "confidence": data.get("confidence"),
                "photo": None,
                "photosAvailable": [m["file"] for m in unit.get("photoMeta", [])],
                "mapLabels": data.get("mapLabels") or [],
                "bottomSheetText": data.get("bottomSheetText"),
                "evidence": data.get("evidence") or [],
                "photoNotes": data.get("photoNotes"),
                "candidates": data.get("candidates") or [],
                "warnings": data.get("warnings") or [],
                "existingParkingSpotId": (existing or {}).get("id"),
                "existingParkingSpotAgrees": bool(existing),
                "coordinatesSource": data.get("coordinatesSource"),
            }
        )
    return entries


# ---------------------------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------------------------

CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 20px 80px; font: 15px/1.5 -apple-system, BlinkMacSystemFont,
  "Segoe UI", Roboto, sans-serif; background: #f6f7f9; color: #14181f; }
h1 { font-size: 26px; margin: 0 0 4px; }
h2 { font-size: 20px; margin: 40px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #dfe3e8; }
h3 { font-size: 16px; margin: 0 0 6px; }
a { color: #0b6bcb; }
.sub { color: #5b6472; margin: 0 0 20px; }
.stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0 8px; }
.stat { background: #fff; border: 1px solid #dfe3e8; border-radius: 10px; padding: 10px 16px;
  min-width: 120px; }
.stat b { display: block; font-size: 24px; line-height: 1.1; }
.stat span { color: #5b6472; font-size: 13px; }
.pill { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px;
  font-weight: 600; white-space: nowrap; }
.pill.create { background: #dcf5e2; color: #12622c; }
.pill.exists { background: #e2ecf8; color: #14477e; }
.pill.review { background: #fdeacd; color: #7a4a05; }
.pill.matched { background: #dcf5e2; color: #12622c; }
.pill.duplicate { background: #ece3fa; color: #4c1d95; }
.card.duplicate { border-left: 5px solid #8b5cf6; }
.pill.ambiguous { background: #fdeacd; color: #7a4a05; }
.pill.no_match { background: #f7dcdc; color: #802020; }
.pill.missing { background: #e8e8ea; color: #4a4a4f; }
.card { background: #fff; border: 1px solid #dfe3e8; border-radius: 12px; padding: 14px;
  margin: 0 0 14px; }
.card.review { border-left: 5px solid #e9a23b; }
.card.create { border-left: 5px solid #2e9e52; }
.card.exists { border-left: 5px solid #4a7fc1; }
.head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.uid { font-weight: 700; font-variant-numeric: tabular-nums; }
.muted { color: #5b6472; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
.shots { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0; align-items: flex-start; }
.shots figure { margin: 0; }
.shots img { border-radius: 8px; border: 1px solid #dfe3e8; display: block; max-width: 100%; }
.shots figcaption { font-size: 11px; color: #5b6472; margin-top: 3px; }
.cols { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 16px; }
@media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }
table { border-collapse: collapse; width: 100%; font-size: 14px; background: #fff; }
th, td { text-align: left; padding: 6px 9px; border-bottom: 1px solid #e6e9ee; }
th { background: #f0f2f5; position: sticky; top: 0; }
ul { margin: 6px 0; padding-left: 20px; }
li { margin: 2px 0; }
.warn { background: #fdf6e6; border-left: 4px solid #e9a23b; padding: 8px 10px;
  border-radius: 6px; margin: 8px 0; font-size: 14px; }
.note { background: #eef4fb; border-left: 4px solid #4a7fc1; padding: 8px 10px;
  border-radius: 6px; margin: 8px 0; font-size: 14px; }
.cand { font-size: 14px; }
details { margin-top: 8px; }
summary { cursor: pointer; color: #0b6bcb; font-size: 14px; }
code { background: #eef0f3; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
"""


def esc(value: object) -> str:
    return html.escape("" if value is None else str(value))


def render_shots(entry: dict) -> str:
    shots = []
    for label, key in (("Suchfeld", "searchbar"), ("Karte", "map"), ("Adresskarte", "bottom")):
        source = WORK / "crops" / f"{entry['unitId']}-{key}.png"
        data = thumbnail(source, THUMB_EDGES[key])
        if data:
            shots.append(
                f'<figure><img src="{data}" alt="{esc(label)} {esc(entry["unitId"])}">'
                f"<figcaption>{esc(label)}</figcaption></figure>"
            )
    photo = entry.get("photo")
    if photo:
        index = 1
        for meta in entry["photosAvailable"]:
            if meta == photo["file"]:
                break
            index += 1
        source = WORK / "crops" / f"{entry['unitId']}-photo-{index}.png"
        data = thumbnail(source, THUMB_EDGES["photo"])
        if data:
            shots.append(
                f'<figure><img src="{data}" alt="Parkfoto {esc(entry["unitId"])}">'
                f"<figcaption>Parkfoto · {esc(photo['file'])} "
                f"({esc(photo['deltaSeconds'])} s)</figcaption></figure>"
            )
    else:
        shots.append(
            '<figure><div class="muted" style="padding:36px 10px;border:1px dashed #c9cfd8;'
            'border-radius:8px">kein Parkfoto zugeordnet</div></figure>'
        )
    return f'<div class="shots">{"".join(shots)}</div>'


def resolve_conflicts(entries: list[dict]) -> list[dict]:
    """One customer gets exactly one Parkplatz, however many pins claim him.

    In the dense stretches of the run the same shop was screenshotted twice. Two pins on one
    customer therefore mean either the same spot (the pins are metres apart, so the second is
    harmless) or a decision a human has to make. Either way only one pin per customer may reach
    the import, which is what this fixes up. Returns the list of resolved collisions.
    """
    claims: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        if entry["status"] == "matched" and entry["spot"]:
            for customer_id in entry["customerIds"]:
                claims[customer_id].append(entry)

    resolved: list[dict] = []
    for customer_id, group in sorted(claims.items()):
        actors = [entry for entry in group if entry["action"] == "create"]
        if len(actors) < 2:
            continue
        # Keep the pin the review agent was most sure about; a pin with a parking photo beats one
        # without, and the lower unit id breaks the last tie so the outcome is deterministic.
        actors.sort(key=lambda e: (-(e["confidence"] or 0), e["unitId"]))
        keeper = actors[0]
        for other in actors[1:]:
            same_spot = (
                haversine_m(
                    keeper["spot"]["lat"], keeper["spot"]["lng"], other["spot"]["lat"], other["spot"]["lng"]
                )
                <= SAME_SPOT_M
            )
            other["action"] = "exists" if same_spot else "duplicate"
            other["droppedFor"] = keeper["unitId"]
            other["actionReason"] = (
                f"same spot as {keeper['unitId']} (customer also claimed there): "
                if same_spot
                else f"same customer as {keeper['unitId']}, which is imported instead "
            ) + f"one customer gets one Parkplatz"
            resolved.append(
                {
                    "customerId": customer_id,
                    "customerNumber": (other["customers"][0]["customerNumber"] if other["customers"] else None),
                    "customerName": (other["customers"][0]["name"] if other["customers"] else None),
                    "kept": keeper["unitId"],
                    "dropped": other["unitId"],
                    "sameSpot": same_spot,
                    "distanceM": round(
                        haversine_m(
                            keeper["spot"]["lat"],
                            keeper["spot"]["lng"],
                            other["spot"]["lat"],
                            other["spot"]["lng"],
                        ),
                        1,
                    ),
                }
            )
        keeper["actionReason"] = (
            f"kept over {', '.join(e['unitId'] for e in actors[1:])} for this customer"
        )
    return resolved


def render_customer_table(entry: dict) -> str:
    if not entry["customers"]:
        return '<p class="muted">kein Kunde zugeordnet</p>'
    rows = []
    for customer in entry["customers"]:
        distance = customer["distanceM"]
        rows.append(
            "<tr>"
            f'<td class="mono">{esc(customer["customerNumber"])}</td>'
            f'<td>{esc(customer["name"])}</td>'
            f'<td>{esc(customer["addressLabel"])}</td>'
            f'<td class="mono">{"" if distance is None else f"{distance} m"}</td>'
            "</tr>"
        )
    return (
        "<table><thead><tr><th>Nr.</th><th>Name</th><th>Adresse</th><th>Abstand</th></tr>"
        f"</thead><tbody>{''.join(rows)}</tbody></table>"
    )


def render_card(entry: dict) -> str:
    spot = entry["spot"]
    coordinates = (
        f'{spot["lat"]:.6f}, {spot["lng"]:.6f}' if spot else "nicht lesbar (keine Koordinaten)"
    )
    confidence = entry["confidence"]
    confidence_chip = (
        f'<span class="muted">confidence {esc(confidence)}</span>'
        if confidence is not None
        else ""
    )
    head = (
        f'<div class="head"><span class="uid">{esc(entry["unitId"])}</span>'
        f'<span class="pill {esc(entry["action"])}">{esc(entry["action"])}</span>'
        f'<span class="pill {esc(entry["status"])}">{esc(entry["status"])}</span>'
        f'<span class="mono">{esc(coordinates)}</span>'
        f'<span class="muted">{esc(entry["screenshotTime"].replace("T", " "))} · '
        f'{esc(entry["screenshot"])}</span>'
        f"{confidence_chip}"
        "</div>"
    )
    if entry["actionReason"]:
        head += f'<div class="warn">{esc(entry["actionReason"])}</div>'

    details = []
    if entry["mapLabels"]:
        details.append(f'<p><b>Karte:</b> {esc(", ".join(entry["mapLabels"]))}</p>')
    if entry["bottomSheetText"]:
        details.append(f'<p><b>Adresskarte:</b> {esc(entry["bottomSheetText"])}</p>')
    if entry["photoNotes"]:
        details.append(f'<p><b>Parkfoto:</b> {esc(entry["photoNotes"])}</p>')
    if entry["evidence"]:
        items = "".join(f"<li>{esc(line)}</li>" for line in entry["evidence"])
        details.append(f"<details><summary>Begründung ({len(entry['evidence'])})</summary><ul>{items}</ul></details>")
    if entry["candidates"]:
        rows = "".join(
            "<tr>"
            f'<td class="mono">{esc(c.get("customerNumber"))}</td>'
            f'<td>{esc(c.get("name"))}</td>'
            f'<td>{esc(c.get("addressLabel"))}</td>'
            f'<td class="mono">{esc(c.get("distanceM"))} m</td>'
            f'<td>{esc(c.get("reason"))}</td>'
            "</tr>"
            for c in entry["candidates"]
        )
        details.append(
            "<h3>Kandidaten</h3><table><thead><tr><th>Nr.</th><th>Name</th><th>Adresse</th>"
            f"<th>Abstand</th><th>Grund</th></tr></thead><tbody>{rows}</tbody></table>"
        )
    for warning in entry["warnings"]:
        details.append(f'<div class="warn">{esc(warning)}</div>')
    if entry["existingParkingSpotId"]:
        details.append(
            '<div class="note">Für diesen Kunden ist an diesen Koordinaten bereits ein Parkplatz '
            "gespeichert — der Import überspringt ihn.</div>"
        )
    return (
        f'<div class="card {esc(entry["action"])}">{head}'
        f'<div class="cols"><div>{render_shots(entry)}</div>'
        f'<div>{render_customer_table(entry)}{"".join(details)}</div></div></div>'
    )


def main() -> int:
    global WORK
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--work", type=Path, default=WORK)
    parser.add_argument("--open", action="store_true", help="open REPORT.html in the browser")
    args = parser.parse_args()
    WORK = args.work

    manifest = read_json(WORK / "manifest.json", {}) or {}
    units = manifest.get("units", [])
    customers = (read_json(WORK / "customers.json", {}) or {}).get("customers", [])
    groups = (read_json(WORK / "address-groups.json", {}) or {}).get("groups", [])
    existing_spots = read_json(WORK / "raw" / "parking-spots.json", []) or []
    check = read_json(WORK / "check.json", {}) or {}

    by_id = {c["id"]: c for c in customers}
    group_members = {g["groupKey"]: g["members"] for g in groups}
    results = {
        unit["unitId"]: data
        for unit in units
        if (data := read_json(WORK / "results" / f"{unit['unitId']}.json")) is not None
    }

    entries = build_entries(units, results, by_id, group_members, existing_spots)
    conflicts_resolved = resolve_conflicts(entries)
    # Photos are assigned only now: a pin dropped as a duplicate must not reserve a parking photo
    # that the pin actually being imported could have used.
    apply_photo_assignment(entries, {unit["unitId"]: unit for unit in units})

    buckets: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        buckets[entry["action"]].append(entry)
    create = buckets["create"]
    exists = buckets["exists"]
    review = buckets["review"]
    duplicates = buckets["duplicate"]

    shared_groups = [g for g in groups if len(g["members"]) > 1]
    matched_ids = {cid for e in entries for cid in e["customerIds"]}
    untouched = [c for c in customers if c["id"] not in matched_ids]

    summary = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "counts": {
            "pins": len(entries),
            "create": len(create),
            "exists": len(exists),
            "review": len(review),
            "duplicate": len(duplicates),
            "customersMatched": len(matched_ids),
            "customersTotal": len(customers),
        },
        "conflictsResolved": conflicts_resolved,
        "entries": entries,
    }
    (WORK / "review.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=True), encoding="utf-8"
    )

    # --- REPORT.md ------------------------------------------------------------------------
    lines = [
        "# Parking-Import 2026-10 — Review",
        "",
        f"Stand: {summary['generatedAt']}",
        "",
        f"- Pins (Screenshots): **{len(entries)}**",
        f"- bereit zum Import: **{len(create)}**",
        f"- bereits vorhanden (wird übersprungen): **{len(exists)}**",
        f"- braucht Entscheidung: **{len(review)}**",
        f"- Kunden mit Pin: **{len(matched_ids)}** von {len(customers)} aktiven",
        "",
        "## Bereit zum Import",
        "",
        "| Pin | Koordinaten | Kunde | Nr. | Abstand | conf | Foto |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for entry in create:
        spot = entry["spot"] or {}
        customer = entry["customers"][0] if entry["customers"] else {}
        lines.append(
            f"| {entry['unitId']} | {spot.get('lat')}, {spot.get('lng')} | {customer.get('name')} | "
            f"{customer.get('customerNumber')} | {entry['distanceM']} m | {entry['confidence']} | "
            f"{(entry.get('photo') or {}).get('file', '—')} |"
        )
    lines += ["", "## Bereits vorhanden (Überspringen)", ""]
    for entry in exists:
        customer = entry["customers"][0] if entry["customers"] else {}
        lines.append(f"- {entry['unitId']} → {customer.get('customerNumber')} {customer.get('name')}")
    if duplicates:
        lines += ["", "## Doppelte Pins (derselbe Kunde, nur ein Pin wird importiert)", ""]
        for entry in duplicates:
            lines.append(f"- {entry['unitId']}: {entry['actionReason']}")
    lines += ["", "## Braucht Entscheidung", ""]
    for entry in review:
        spot = entry["spot"] or {}
        lines.append(
            f"- **{entry['unitId']}** ({entry['status']}, {spot.get('lat')}, {spot.get('lng')}): "
            f"{entry['actionReason']}"
        )
        for candidate in entry["candidates"]:
            lines.append(
                f"  - Kandidat {candidate.get('customerNumber')} {candidate.get('name')} "
                f"({candidate.get('distanceM')} m): {candidate.get('reason')}"
            )
    if check.get("conflicts"):
        lines += ["", "## Konflikte (ein Kunde, zwei Pins)", ""]
        for conflict in check["conflicts"]:
            lines.append(
                f"- {conflict['customerNumber']} {conflict['name']}: Pins {', '.join(conflict['units'])}"
            )
    if check.get("duplicatePins"):
        lines += ["", "## Doppelte Pins (gleicher Ort)", ""]
        for duplicate in check["duplicatePins"]:
            lines.append(
                f"- {' + '.join(duplicate['units'])}: {duplicate['distanceM']} m auseinander"
            )
    lines += ["", "## Adressgruppen mit mehreren Kunden (ein Parkplatz für alle)", ""]
    for group in shared_groups:
        numbers = ", ".join(m["customerNumber"] for m in group["members"])
        lines.append(f"- {group['label']}: {numbers}")
    lines += ["", "## Kunden ohne Pin", "", f"{len(untouched)} aktive Kunden."]
    (WORK / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # --- REPORT.html ----------------------------------------------------------------------
    cards_create = "".join(render_card(e) for e in create)
    cards_exists = "".join(render_card(e) for e in exists)
    cards_review = "".join(render_card(e) for e in review)
    cards_duplicate = "".join(render_card(e) for e in duplicates)

    def stat(value: object, label: str) -> str:
        return f'<div class="stat"><b>{esc(value)}</b><span>{esc(label)}</span></div>'

    conflict_html = ""
    if conflicts_resolved:
        rows = "".join(
            "<tr>"
            f'<td class="mono">{esc(c["customerNumber"])}</td><td>{esc(c["customerName"])}</td>'
            f'<td class="mono">{esc(c["kept"])}</td>'
            f'<td class="mono">{esc(c["dropped"])}</td>'
            f'<td class="mono">{esc(c["distanceM"])} m</td>'
            f'<td>{"gleicher Ort" if c["sameSpot"] else "verschiedene Orte"}</td></tr>'
            for c in conflicts_resolved
        )
        conflict_html = (
            "<h2>Derselbe Kunde, mehrere Pins</h2>"
            '<div class="note">Ein Kunde bekommt genau einen Parkplatz. Wo zwei Pins denselben '
            "Kunden beanspruchen, wird nur einer importiert; der andere wird übersprungen. "
            'Zum Umentscheiden die Datei <code>results/&lt;pin&gt;.json</code> bearbeiten.</div>'
            "<table><thead><tr><th>Nr.</th><th>Name</th><th>importiert</th><th>übersprungen</th>"
            f"<th>Abstand</th><th>Lage</th></tr></thead><tbody>{rows}</tbody></table>"
        )
    duplicate_html = ""
    if check.get("duplicatePins"):
        rows = "".join(
            f'<tr><td class="mono">{esc(" + ".join(d["units"]))}</td>'
            f'<td class="mono">{d["lat"]:.6f}, {d["lng"]:.6f}</td>'
            f'<td class="mono">{d["distanceM"]} m</td></tr>'
            for d in check["duplicatePins"]
        )
        duplicate_html = (
            "<h2>Doppelte Pins — derselbe Ort zweimal fotografiert</h2>"
            "<table><thead><tr><th>Pins</th><th>Koordinaten</th><th>Abstand</th></tr></thead>"
            f"<tbody>{rows}</tbody></table>"
        )
    group_html = "".join(
        f'<li>{esc(g["label"])} — {esc(", ".join(m["customerNumber"] for m in g["members"]))}</li>'
        for g in shared_groups
    )
    untouched_html = (
        f'<details><summary>{len(untouched)} aktive Kunden ohne Pin anzeigen</summary><ul>'
        + "".join(
            f'<li class="mono">{esc(c["customerNumber"])}</li>' for c in untouched[:80]
        )
        + ("<li>…</li>" if len(untouched) > 80 else "")
        + "</ul></details>"
    )

    document = f"""<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parking-Import 2026-10 — Review</title>
<style>{CSS}</style>
</head>
<body>
<h1>Parking-Import 2026-10 — Review</h1>
<p class="sub">Zuordnung der {len(entries)} Karten-Pins aus <code>2026-10/</code> zu den Kunden der
Produktionsdatenbank. Erzeugt {esc(summary["generatedAt"])} aus
<code>.parking-import/results/*.json</code>. Diese Seite ist reine Anzeige —
es wurde nichts in Datenbank oder Objektspeicher geschrieben.</p>

<div class="stats">
{stat(len(entries), "Pins")}
{stat(len(create), "bereit zum Import")}
{stat(len(exists), "bereits vorhanden")}
{stat(len(duplicates), "doppelte Pins")}
{stat(len(review), "braucht Entscheidung")}
{stat(len(matched_ids), "Kunden mit Pin")}
{stat(len(untouched), "Kunden ohne Pin")}
</div>

<div class="note"><b>Nächster Schritt:</b> Karte für Karte prüfen. Nur
<code>action = create</code> legt der Import an; <code>exists</code> und <code>duplicate</code>
werden übersprungen. Für Korrekturen die jeweilige Datei
<code>.parking-import/results/&lt;pin&gt;.json</code> bearbeiten und dieses Skript erneut
ausführen.</div>

{conflict_html}
{duplicate_html}

<h2>Bereit zum Import <span class="pill create">{len(create)}</span></h2>
{cards_create or '<p class="muted">nichts</p>'}

<h2>Braucht Entscheidung <span class="pill review">{len(review)}</span></h2>
{cards_review or '<p class="muted">nichts</p>'}

<h2>Bereits vorhanden <span class="pill exists">{len(exists)}</span></h2>
<div class="note">Für diese Kunden liegt an genau diesen Koordinaten schon ein Parkplatz
(teils aus dem Büro, teils weil derselbe Ort zweimal fotografiert wurde). Der Import lässt sie
unangetastet.</div>
{cards_exists or '<p class="muted">nichts</p>'}

<h2>Doppelte Pins — übersprungen <span class="pill duplicate">{len(duplicates)}</span></h2>
<div class="note">Derselbe Kunde wird von einem anderen Pin importiert. Diese Pins werden
übersprungen, damit kein Kunde zwei Parkplätze bekommt.</div>
{cards_duplicate or '<p class="muted">nichts</p>'}

<h2>Adressgruppen mit mehreren Kunden</h2>
<p class="sub">Kunden an derselben normalisierten Adresse teilen sich einen Parkplatz und ein
Parkfoto; ein Pin deckt die ganze Gruppe ab.</p>
<ul>{group_html or "<li>keine</li>"}</ul>

<h2>Kunden ohne Pin</h2>
{untouched_html}

</body>
</html>
"""
    report_path = WORK / "REPORT.html"
    report_path.write_text(document, encoding="utf-8")

    print(
        f"pins={len(entries)} create={len(create)} exists={len(exists)} "
        f"duplicate={len(duplicates)} review={len(review)}"
    )
    print(f"customers matched={len(matched_ids)}/{len(customers)} without pin={len(untouched)}")
    if conflicts_resolved:
        print(f"resolved collisions on {len(conflicts_resolved)} pin(s):")
        for conflict in conflicts_resolved:
            print(
                f"  - {conflict['customerNumber']} {conflict['customerName']}: kept "
                f"{conflict['kept']}, dropped {conflict['dropped']} "
                f"({'same spot' if conflict['sameSpot'] else 'different spots'}, "
                f"{conflict['distanceM']} m apart)"
            )
    print(f"wrote {report_path}")
    print(f"wrote {WORK / 'REPORT.md'}")
    print(f"wrote {WORK / 'review.json'}")
    if args.open:
        webbrowser.open(report_path.as_uri())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
