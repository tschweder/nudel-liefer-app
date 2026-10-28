#!/usr/bin/env python3
"""Nearest customers to a coordinate, for the per-pin review agents.

Reads the Phase 1 snapshot (`.parking-import/customers.json`) and prints the customers
closest to a point, with haversine distances and their address group, so a review agent
never has to do the distance arithmetic itself.

    python scripts/parking-import/nearest-customers.py --lat 48.271953 --lng 16.446999
    python scripts/parking-import/nearest-customers.py --lat 48.25 --lng 16.44 --top 8 --radius 800

Output is JSON on stdout: `{"ok": true, "candidates": [...]}`. Rows are sorted by distance and
carry `streetOnMap: null` — the caller fills that in from the screenshot. With `--radius` only
customers inside that radius are returned.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CUSTOMERS = REPO_ROOT / ".parking-import" / "customers.json"
DEFAULT_GROUPS = REPO_ROOT / ".parking-import" / "address-groups.json"

EARTH_RADIUS_M = 6_371_008.8


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def load(path: Path) -> dict:
    if not path.is_file():
        print(
            f"missing {path} - run `pnpm parking:export-customers` first",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lng", type=float, required=True)
    parser.add_argument("--top", type=int, default=5, help="how many candidates to print")
    parser.add_argument(
        "--radius", type=float, default=None, help="only customers within this many metres"
    )
    parser.add_argument("--customers", type=Path, default=DEFAULT_CUSTOMERS)
    parser.add_argument("--groups", type=Path, default=DEFAULT_GROUPS)
    args = parser.parse_args()

    if not (-90 <= args.lat <= 90 and -180 <= args.lng <= 180):
        print(json.dumps({"ok": False, "error": "coordinates out of range"}))
        return 1

    customers = load(args.customers)["customers"]
    groups = {g["groupKey"]: g for g in load(args.groups)["groups"]}

    rows = []
    for customer in customers:
        if customer["lat"] is None or customer["lng"] is None:
            continue
        distance = haversine_m(args.lat, args.lng, customer["lat"], customer["lng"])
        if args.radius is not None and distance > args.radius:
            continue
        group = groups.get(customer["addressGroupKey"])
        rows.append(
            {
                "customerId": customer["id"],
                "customerNumber": customer["customerNumber"],
                "name": customer["name"],
                "companyName": customer["companyName"],
                "street": customer["street"],
                "postalCode": customer["postalCode"],
                "city": customer["city"],
                "addressLabel": customer["addressLabel"],
                "distanceM": round(distance, 1),
                "addressGroupKey": customer["addressGroupKey"],
                "addressGroupSize": len(group["members"]) if group else 1,
                "addressGroupMembers": (
                    [
                        {"customerId": m["id"], "customerNumber": m["customerNumber"], "name": m["name"]}
                        for m in group["members"]
                    ]
                    if group
                    else []
                ),
                "hasParkingSpot": len(customer["parkingSpots"]) > 0,
                "hasParkingPhoto": customer["photos"]["PARKING"] is not None,
                "existingParkingSpots": customer["parkingSpots"],
            }
        )

    rows.sort(key=lambda r: r["distanceM"])
    print(
        json.dumps(
            {
                "ok": True,
                "point": {"lat": args.lat, "lng": args.lng},
                "customersWithCoordinates": len(customers),
                "candidates": rows[: args.top],
            },
            # ASCII-escaped on purpose: a Windows console in a non-UTF-8 code page would
            # otherwise print "Praterstra�e" and make street names unreadable.
            ensure_ascii=True,
            indent=1,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
