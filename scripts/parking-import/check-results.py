#!/usr/bin/env python3
"""Orchestrator cross-check of the Phase 2 review results.

The per-pin agents each judge one screenshot in isolation. This script looks at all of them
together and at the customer master data, and reports what a human has to decide:

* **coverage**      units without a result, results without a unit, unreadable coordinates
* **conflicts**     one customer claimed by two different pins (a customer has one parking spot)
* **distance**      recomputed pin -> customer distance, flagged when beyond the plausibility radius
* **groups**        a matched unit that did not include every customer of its address group
* **duplicate pins**two pins within a few metres of each other (the same spot screenshotted twice)
* **already there** pins that coincide with a Parkplatz that already exists in production
* **missing**       active customers that no pin was matched to

Writes `.parking-import/check.json` and prints a readable summary. Read-only.

Usage:
    python scripts/parking-import/check-results.py
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
WORK = REPO_ROOT / ".parking-import"

EARTH_RADIUS_M = 6_371_008.8
#: Distance beyond which a pin -> customer match needs a human look (unless a Parkplatz for that
#: customer already exists at the pin, which is somebody's earlier decision).
PLAUSIBLE_RADIUS_M = 400
#: Two pins closer than this are most likely the same spot captured twice.
SAME_PIN_M = 25
#: A pin this close to an existing Parkplatz means the spot is already recorded.
EXISTING_SPOT_M = 25


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--work", type=Path, default=WORK)
    args = parser.parse_args()
    work: Path = args.work

    manifest = read_json(work / "manifest.json", {}) or {}
    units = manifest.get("units", [])
    customers = (read_json(work / "customers.json", {}) or {}).get("customers", [])
    groups = (read_json(work / "address-groups.json", {}) or {}).get("groups", [])
    existing_spots = read_json(work / "raw" / "parking-spots.json", []) or []

    by_id = {c["id"]: c for c in customers}
    group_of = {c["id"]: c["addressGroupKey"] for c in customers}
    members_of = {g["groupKey"]: [m["id"] for m in g["members"]] for g in groups}

    results: dict[str, dict] = {}
    missing_results: list[str] = []
    for unit in units:
        unit_id = unit["unitId"]
        data = read_json(work / "results" / f"{unit_id}.json")
        if data is None:
            missing_results.append(unit_id)
            continue
        results[unit_id] = data
    unknown_results = sorted(
        p.stem
        for p in (work / "results").glob("*.json")
        if p.stem not in {u["unitId"] for u in units}
    )

    def unit_spot(data: dict) -> tuple[float, float] | None:
        spot = data.get("spot")
        if not isinstance(spot, dict):
            return None
        lat, lng = spot.get("lat"), spot.get("lng")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            return None
        return float(lat), float(lng)

    # --- distance audit ------------------------------------------------------------------
    distance_issues: list[dict] = []
    group_issues: list[dict] = []
    for unit_id, data in sorted(results.items()):
        if data.get("status") != "matched":
            continue
        spot = unit_spot(data)
        if spot is None:
            continue
        for customer_id in data.get("customerIds", []):
            customer = by_id.get(customer_id)
            if customer is None:
                distance_issues.append(
                    {"unitId": unit_id, "customerId": customer_id, "issue": "unknown_customer"}
                )
                continue
            if customer["lat"] is None or customer["lng"] is None:
                distance_issues.append(
                    {
                        "unitId": unit_id,
                        "customerId": customer_id,
                        "customerNumber": customer["customerNumber"],
                        "issue": "customer_has_no_coordinates",
                    }
                )
                continue
            distance = haversine_m(spot[0], spot[1], customer["lat"], customer["lng"])
            ahead = any(
                haversine_m(spot[0], spot[1], s["lat"], s["lng"]) <= EXISTING_SPOT_M
                for s in existing_spots
                if s["customerId"] == customer_id
            )
            if distance > PLAUSIBLE_RADIUS_M and not ahead:
                distance_issues.append(
                    {
                        "unitId": unit_id,
                        "customerId": customer_id,
                        "customerNumber": customer["customerNumber"],
                        "name": customer["name"],
                        "distanceM": round(distance, 1),
                        "issue": "beyond_plausible_radius",
                    }
                )
        # Every customer of the winning address group must be included.
        primary = (data.get("customerIds") or [None])[0]
        if primary and primary in group_of:
            expected = set(members_of.get(group_of[primary], [primary]))
            got = set(data.get("customerIds", []))
            if expected != got:
                group_issues.append(
                    {
                        "unitId": unit_id,
                        "addressGroupKey": group_of[primary],
                        "expected": sorted(expected),
                        "got": sorted(got),
                        "issue": "group_incomplete_or_oversized",
                    }
                )

    # --- conflicts: one customer claimed by two pins -------------------------------------
    claimed: dict[str, list[str]] = defaultdict(list)
    for unit_id, data in sorted(results.items()):
        if data.get("status") == "matched":
            for customer_id in data.get("customerIds", []):
                claimed[customer_id].append(unit_id)
    conflicts = [
        {
            "customerId": customer_id,
            "customerNumber": by_id.get(customer_id, {}).get("customerNumber"),
            "name": by_id.get(customer_id, {}).get("name"),
            "units": units_list,
        }
        for customer_id, units_list in sorted(claimed.items())
        if len(units_list) > 1
    ]

    # --- duplicate pins -------------------------------------------------------------------
    placed = [(uid, unit_spot(d)) for uid, d in results.items() if unit_spot(d) is not None]
    duplicate_pins: list[dict] = []
    for i, (uid_a, spot_a) in enumerate(placed):
        for uid_b, spot_b in placed[i + 1 :]:
            distance = haversine_m(spot_a[0], spot_a[1], spot_b[0], spot_b[1])
            if distance <= SAME_PIN_M:
                duplicate_pins.append(
                    {
                        "units": [uid_a, uid_b],
                        "distanceM": round(distance, 1),
                        "lat": spot_a[0],
                        "lng": spot_a[1],
                    }
                )
    duplicate_pins.sort(key=lambda d: d["distanceM"])

    # --- pins that already exist as a Parkplatz -------------------------------------------
    already = []
    for unit_id, data in sorted(results.items()):
        spot = unit_spot(data)
        if spot is None:
            continue
        for existing in existing_spots:
            distance = haversine_m(spot[0], spot[1], existing["lat"], existing["lng"])
            if distance <= EXISTING_SPOT_M:
                customer = by_id.get(existing["customerId"], {})
                already.append(
                    {
                        "unitId": unit_id,
                        "parkingSpotId": existing["id"],
                        "customerId": existing["customerId"],
                        "customerNumber": customer.get("customerNumber"),
                        "name": customer.get("name"),
                        "distanceM": round(distance, 1),
                        "agrees": existing["customerId"] in (data.get("customerIds") or []),
                    }
                )

    # --- customers nobody photographed ----------------------------------------------------
    # `claimed` maps customerId -> [unitId, ...], so its keys are the matched customers.
    matched_ids = set(claimed.keys())
    untouched = [c for c in customers if c["id"] not in matched_ids]
    untouched_with_spot = [
        {"customerNumber": c["customerNumber"], "name": c["name"], "street": c["street"]}
        for c in untouched
        if c["parkingSpots"]
    ]

    status_counts: dict[str, int] = defaultdict(int)
    for data in results.values():
        status_counts[str(data.get("status", "?"))] += 1
    unreadable = [uid for uid, d in results.items() if unit_spot(d) is None]

    report = {
        "units": len(units),
        "results": len(results),
        "missingResults": missing_results,
        "unknownResults": unknown_results,
        "statusCounts": dict(sorted(status_counts.items())),
        "unreadableCoordinates": sorted(unreadable),
        "distanceIssues": distance_issues,
        "groupIssues": group_issues,
        "conflicts": conflicts,
        "duplicatePins": duplicate_pins,
        "alreadyExistingSpots": already,
        "customersTotal": len(customers),
        "customersMatched": len(matched_ids),
        "customersUntouched": [c["customerNumber"] for c in untouched],
        "customersUntouchedCount": len(untouched),
        "customersUntouchedWithSpot": untouched_with_spot,
    }
    (work / "check.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=True), encoding="utf-8"
    )

    # --- readable summary -----------------------------------------------------------------
    print(f"units={len(units)} results={len(results)} status={report['statusCounts']}")
    if missing_results:
        print(f"  MISSING RESULTS ({len(missing_results)}): {' '.join(missing_results)}")
    if unknown_results:
        print(f"  results with no unit: {unknown_results}")
    if unreadable:
        print(f"  unreadable coordinates ({len(unreadable)}): {' '.join(sorted(unreadable))}")
    print(f"customers matched: {len(matched_ids)}/{len(customers)}")
    for label, items in (
        ("CONFLICTS (one customer, two pins)", conflicts),
        ("DISTANCE beyond 400 m", distance_issues),
        ("ADDRESS GROUP incomplete", group_issues),
        ("DUPLICATE PINS", duplicate_pins),
    ):
        if items:
            print(f"  {label} ({len(items)}):")
            for item in items:
                print(f"    - {json.dumps(item, ensure_ascii=True)}")
    if already:
        print(f"  pins matching an existing Parkplatz ({len(already)}):")
        for item in already:
            flag = "agrees" if item["agrees"] else "DISAGREES"
            print(
                f"    - {item['unitId']}: {item['customerNumber']} {item['name']} "
                f"({item['distanceM']} m) [{flag}]"
            )
    if untouched_with_spot:
        print(f"  customers with an existing Parkplatz that no pin matched: {untouched_with_spot}")
    print(f"wrote {work / 'check.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
