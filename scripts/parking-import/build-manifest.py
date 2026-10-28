#!/usr/bin/env python3
"""Phase 0 of the parking-spot import: build a deterministic manifest of `2026-10/`.

Reads the raw capture folder and writes `.parking-import/manifest.json`:

* for every image: sha256, size, mtime, kind (screenshot / photo), the timestamp from
  the file name, and the EXIF timestamp / camera / GPS (if any),
* the byte-identical duplicates (`name.jpg` vs `name(1).jpg`), reduced to one entry each,
* one **unit** per deduplicated screenshot. A screenshot is the dropped map pin and
  therefore the intended stop, so it is the unit of review; the parking photo(s) taken
  around it are attached as evidence (`photos`, possibly empty, sometimes two),
* the files nobody could be paired with, so the screenshot/photo mismatch stays visible.

It also writes the helper crops the review agents read (`--crops`), because the
coordinate text in the 1080x2400 Google Maps search bar is too small otherwise:

    crops/<unitId>-searchbar.png   search bar with the coordinates, 2x upscaled
    crops/<unitId>-bottom.png      bottom sheet / address card
    crops/<unitId>-map.png         full screenshot, downscaled for map context
    crops/<unitId>-photo-N.png     parking photo(s), downscaled

Nothing is written to the input folder; no database and no object storage is touched.

Usage:
    python scripts/parking-import/build-manifest.py
    python scripts/parking-import/build-manifest.py --crops
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from PIL import ExifTags, Image, UnidentifiedImageError

# --------------------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = REPO_ROOT / "2026-10"
DEFAULT_OUT = REPO_ROOT / ".parking-import"

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}

#: A photo is taken shortly after its screenshot; the captures observed 7-90 s.
PAIR_WINDOW_S = 300

#: A photo counts as evidence for a screenshot up to this distance in time.
EVIDENCE_WINDOW_S = 400

#: How many evidence photos a review agent is handed as images (closest first).
MAX_EVIDENCE_PHOTOS = 2

#: Longest edge of the photo previews handed to the review agents.
PHOTO_PREVIEW_EDGE = 1400
SEARCHBAR_SCALE = 2

#: Vertical bands of a 1080x2400 Google Maps screenshot (fractions of its height): the
#: coordinate field, the map around the pin, and the bottom sheet with the address card.
SEARCHBAR_BAND = (0.040, 0.125)
MAP_BAND = (0.100, 0.400)
BOTTOM_BAND = (0.340, 1.000)

FILENAME_RE = re.compile(
    r"^(?P<kind>Screenshot|IMG)_(?P<date>\d{8})_(?P<time>\d{6})"
    r"(?P<suffix>(?:_[A-Za-z]+\d*)*)?"
    r"(?P<dup>\(\d+\))?$"
)

EXIF_DATETIME_ORIGINAL = 36867
EXIF_DATETIME = 306


# --------------------------------------------------------------------------------------
# EXIF
# --------------------------------------------------------------------------------------


def _rational_to_float(value: object) -> float | None:
    try:
        if isinstance(value, tuple):
            return None
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if number == number else None  # NaN check


def read_gps(exif: Image.Exif) -> dict[str, float] | None:
    """Latitude/longitude from the EXIF GPS IFD, or ``None``.

    The phone in this capture set (vivo V40 SE 5G) writes a GPS IFD whose values are all
    zeroed out (location stripped / permission off), so "the IFD exists" is not the same
    as "there is a fix". Missing or zeroed values return ``None``.
    """
    try:
        gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
    except Exception:  # noqa: BLE001 - malformed EXIF must not stop the import
        return None
    if not gps:
        return None

    def to_degrees(values: object) -> float | None:
        if not isinstance(values, tuple) or len(values) != 3:
            return None
        parts = [_rational_to_float(v) for v in values]
        if any(p is None for p in parts):
            return None
        deg, minutes, seconds = (float(p) for p in parts)  # type: ignore[arg-type]
        if deg == 0 and minutes == 0 and seconds == 0:
            return None
        return deg + minutes / 60 + seconds / 3600

    lat = to_degrees(gps.get(2))
    lng = to_degrees(gps.get(4))
    if lat is None or lng is None:
        return None
    if gps.get(1) == "S":
        lat = -lat
    if gps.get(3) == "W":
        lng = -lng
    return {"lat": round(lat, 7), "lng": round(lng, 7)}


def read_exif(path: Path) -> dict[str, object]:
    """EXIF timestamp, camera and GPS of one file; never raises."""
    try:
        with Image.open(path) as img:
            width, height = img.size
            exif = img.getexif()
            taken_raw = exif.get(EXIF_DATETIME_ORIGINAL) or exif.get(EXIF_DATETIME)
            taken: str | None = None
            if isinstance(taken_raw, str):
                try:
                    taken = datetime.strptime(taken_raw.strip(), "%Y:%m:%d %H:%M:%S").isoformat()
                except ValueError:
                    taken = None
            return {
                "width": width,
                "height": height,
                "takenAt": taken,
                "make": exif.get(271),
                "model": exif.get(272),
                "gps": read_gps(exif),
            }
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}


# --------------------------------------------------------------------------------------
# Scanning
# --------------------------------------------------------------------------------------


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_filename(name: str) -> dict[str, object] | None:
    """`Screenshot_20261027_042238(1).jpg` -> kind, time, duplicate and burst markers."""
    match = FILENAME_RE.match(Path(name).stem)
    if not match:
        return None
    stamp = datetime.strptime(f"{match['date']}{match['time']}", "%Y%m%d%H%M%S").replace(
        microsecond=0
    )
    suffix = match["suffix"] or ""
    return {
        "kind": "screenshot" if match["kind"].lower() == "screenshot" else "photo",
        "timestamp": stamp.isoformat(),
        "isDuplicateName": match["dup"] is not None,
        "isBurst": bool(suffix),
    }


def scan(input_dir: Path) -> list[dict[str, object]]:
    files: list[dict[str, object]] = []
    for path in sorted(input_dir.iterdir()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        parsed = parse_filename(path.name)
        if parsed is None:
            print(f"  ! unrecognised file name: {path.name}", file=sys.stderr)
        stat = path.stat()
        files.append(
            {
                "file": path.name,
                "sha256": sha256_of(path),
                "bytes": stat.st_size,
                "mtime": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "kind": parsed["kind"] if parsed else "unknown",
                "timestamp": parsed["timestamp"] if parsed else None,
                "isDuplicateName": parsed["isDuplicateName"] if parsed else False,
                "isBurst": parsed["isBurst"] if parsed else False,
                **read_exif(path),
            }
        )
    return files


def dedupe(
    files: list[dict[str, object]],
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """Collapse byte-identical files, preferring the name without a `(1)` suffix."""
    by_hash: dict[str, list[dict[str, object]]] = {}
    for entry in files:
        by_hash.setdefault(str(entry["sha256"]), []).append(entry)

    unique: list[dict[str, object]] = []
    duplicates: list[dict[str, object]] = []
    for digest, group in by_hash.items():
        group_sorted = sorted(group, key=lambda e: (bool(e["isDuplicateName"]), str(e["file"])))
        keeper, *dropped = group_sorted
        unique.append(keeper)
        if dropped:
            duplicates.append(
                {
                    "sha256": digest,
                    "kept": keeper["file"],
                    "dropped": [e["file"] for e in dropped],
                    "bytes": keeper["bytes"],
                }
            )
    unique.sort(key=lambda e: str(e["timestamp"] or "~"))
    duplicates.sort(key=lambda e: str(e["kept"]))
    return unique, duplicates


# --------------------------------------------------------------------------------------
# Units: one screenshot = one intended stop, with its photo evidence
# --------------------------------------------------------------------------------------


def associate(
    unique: list[dict[str, object]],
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """Build one review unit per screenshot and attach the photos taken around it.

    A screenshot may own no photo (the capture is incomplete) or two (the same spot
    photographed twice); that is recorded instead of being forced into one-to-one pairs.
    """
    screenshots = sorted(
        (e for e in unique if e["kind"] == "screenshot" and e["timestamp"]),
        key=lambda e: str(e["timestamp"]),
    )
    photos = [e for e in unique if e["kind"] == "photo" and e["timestamp"]]
    photos.sort(key=lambda e: str(e["timestamp"]))
    leftovers = [e for e in unique if e["kind"] not in ("screenshot", "photo")]

    units: list[dict[str, object]] = [
        {
            "unitId": f"u{index + 1:02d}",
            "screenshot": entry["file"],
            "screenshotTime": entry["timestamp"],
            "photos": [],
            "photoMeta": [],
        }
        for index, entry in enumerate(screenshots)
    ]

    def seconds(entry: dict[str, object]) -> datetime:
        return datetime.fromisoformat(str(entry["timestamp"]))

    def unit_at(unit: dict[str, object]) -> datetime:
        return datetime.fromisoformat(str(unit["screenshotTime"]))

    # Photos are not claimed one-to-one: in the dense parts of the capture several photos sit
    # between two screenshots, and which one belongs to which pin cannot be decided from the
    # timestamps alone. Every photo inside the evidence window is therefore attached to the
    # unit as evidence (closest first, at most `MAX_EVIDENCE_PHOTOS`) and the review agent
    # decides which of them shows the spot; the coordinates from the search bar stay the
    # ground truth. The full list stays in the manifest as `photoMeta`.
    for unit in units:
        shot_at = unit_at(unit)
        nearby = []
        for photo in photos:
            delta = int((seconds(photo) - shot_at).total_seconds())
            if abs(delta) <= EVIDENCE_WINDOW_S:
                nearby.append(
                    {
                        "file": photo["file"],
                        "timestamp": photo["timestamp"],
                        "deltaSeconds": delta,
                        "isBurst": photo["isBurst"],
                    }
                )
        nearby.sort(key=lambda m: (abs(int(m["deltaSeconds"])), str(m["timestamp"])))
        unit["photoMeta"] = nearby
        unit["photos"] = [str(m["file"]) for m in nearby[:MAX_EVIDENCE_PHOTOS]]

    # Photos that fall outside every evidence window are reported so nothing disappears.
    orphans: list[dict[str, object]] = []
    for photo in photos:
        if any(photo["file"] in unit["photos"] for unit in units):  # type: ignore[operator]
            continue
        if any(
            abs(int(m["deltaSeconds"])) <= EVIDENCE_WINDOW_S
            for unit in units
            for m in unit["photoMeta"]  # type: ignore[union-attr]
        ):
            continue
        photo_at = seconds(photo)
        nearest = min(
            units,
            key=lambda u: abs((photo_at - unit_at(u)).total_seconds()),
            default=None,
        )
        if nearest is None:
            continue
        orphans.append(
            {
                "file": photo["file"],
                "timestamp": photo["timestamp"],
                "nearestUnitId": nearest["unitId"],
                "deltaSeconds": int((photo_at - unit_at(nearest)).total_seconds()),
            }
        )

    for entry in leftovers:
        print(f"  ! unclassified file, not part of any unit: {entry['file']}", file=sys.stderr)

    incomplete = [
        {
            "unitId": unit["unitId"],
            "screenshot": unit["screenshot"],
            "screenshotTime": unit["screenshotTime"],
            "reason": f"no photo within +/-{EVIDENCE_WINDOW_S}s",
        }
        for unit in units
        if not unit["photoMeta"]
    ]
    return units, incomplete + orphans


# --------------------------------------------------------------------------------------
# Helper images for the review agents
# --------------------------------------------------------------------------------------


def scaled(size: tuple[int, int], edge: int) -> tuple[int, int]:
    width, height = size
    longest = max(width, height)
    if longest <= edge:
        return size
    factor = edge / longest
    return max(1, round(width * factor)), max(1, round(height * factor))


def write_crops(units: list[dict[str, object]], input_dir: Path, out_dir: Path) -> int:
    """Search bar (upscaled), map band, bottom sheet and photo previews per unit."""
    crops_dir = out_dir / "crops"
    crops_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    for unit in units:
        unit_id = str(unit["unitId"])
        try:
            with Image.open(input_dir / str(unit["screenshot"])) as shot:
                shot = shot.convert("RGB")
                width, height = shot.size

                def band(fractions: tuple[float, float]) -> Image.Image:
                    return shot.crop(
                        (0, round(height * fractions[0]), width, round(height * fractions[1]))
                    )

                # The coordinate text sits in a rounded white field just below the status
                # bar; upscaling it makes 6 decimals unambiguous for the review agent.
                bar = band(SEARCHBAR_BAND)
                bar = bar.resize(
                    (bar.width * SEARCHBAR_SCALE, bar.height * SEARCHBAR_SCALE), Image.LANCZOS
                )
                bar.save(crops_dir / f"{unit_id}-searchbar.png")
                # Native resolution, so street and POI labels around the pin stay readable.
                band(MAP_BAND).save(crops_dir / f"{unit_id}-map.png")
                band(BOTTOM_BAND).save(crops_dir / f"{unit_id}-bottom.png")
                written += 3
            # A crop for every evidence photo (not just the two closest): the report assigns the
            # parking photo per pin after resolving duplicate pins, so any of them may end up
            # being the one that gets imported. Numbering follows `photoMeta`, which is what the
            # report indexes into.
            for index, meta in enumerate(unit["photoMeta"]):  # type: ignore[union-attr]
                with Image.open(input_dir / str(meta["file"])) as photo:
                    photo = photo.convert("RGB")
                    photo.resize(scaled(photo.size, PHOTO_PREVIEW_EDGE), Image.LANCZOS).save(
                        crops_dir / f"{unit_id}-photo-{index + 1}.png"
                    )
                    written += 1
        except (UnidentifiedImageError, OSError) as exc:
            print(f"  ! crops for {unit_id} failed: {exc}", file=sys.stderr)
    return written


# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="capture folder")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="work directory")
    parser.add_argument(
        "--crops",
        action="store_true",
        help="also write the helper images under <out>/crops (needs pillow)",
    )
    args = parser.parse_args()

    input_dir: Path = args.input
    out_dir: Path = args.out
    if not input_dir.is_dir():
        print(f"input folder not found: {input_dir}", file=sys.stderr)
        return 2
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"scanning {input_dir} ...")
    files = scan(input_dir)
    unique, duplicates = dedupe(files)
    units, unpaired = associate(unique)

    with_gps = [e for e in unique if e.get("gps")]
    manifest = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "input": str(input_dir),
        "pairWindowSeconds": PAIR_WINDOW_S,
        "evidenceWindowSeconds": EVIDENCE_WINDOW_S,
        "counts": {
            "filesTotal": len(files),
            "filesUnique": len(unique),
            "duplicateGroups": len(duplicates),
            "screenshots": sum(1 for e in unique if e["kind"] == "screenshot"),
            "photos": sum(1 for e in unique if e["kind"] == "photo"),
            "unclassified": sum(1 for e in unique if e["kind"] not in ("screenshot", "photo")),
            "units": len(units),
            "unitsWithoutPhoto": sum(1 for u in units if not u["photoMeta"]),  # type: ignore[arg-type]
            "unitsWithMultiplePhotos": sum(
                1 for u in units if len(u["photoMeta"]) > 1  # type: ignore[arg-type]
            ),
            "filesWithExifGps": len(with_gps),
        },
        "duplicates": duplicates,
        "units": units,
        "unpaired": unpaired,
        "files": files,
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    # One small file per unit: a review agent reads only its own entry, not the whole manifest.
    units_dir = out_dir / "units"
    units_dir.mkdir(parents=True, exist_ok=True)
    for unit in units:
        unit_id = str(unit["unitId"])
        payload = {
            **unit,
            "crops": {
                "searchbar": f".parking-import/crops/{unit_id}-searchbar.png",
                "map": f".parking-import/crops/{unit_id}-map.png",
                "bottom": f".parking-import/crops/{unit_id}-bottom.png",
                "photos": [
                    f".parking-import/crops/{unit_id}-photo-{index + 1}.png"
                    for index in range(len(unit["photos"]))  # type: ignore[arg-type]
                ],
            },
            "resultFile": f".parking-import/results/{unit_id}.json",
        }
        (units_dir / f"{unit_id}.json").write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    counts = manifest["counts"]
    print(f"wrote {manifest_path}")
    print(
        "  files={filesTotal} unique={filesUnique} screenshots={screenshots} photos={photos} "
        "unclassified={unclassified}".format(**counts)
    )
    print(
        "  units={units} without photo evidence={unitsWithoutPhoto} "
        "with 2+ evidence photos={unitsWithMultiplePhotos} duplicate groups={duplicateGroups} "
        "exif GPS present={filesWithExifGps}".format(**counts)
    )
    print(f"  incomplete / orphan entries: {len(unpaired)}")
    for entry in unpaired:
        if "screenshot" in entry:
            print(f"    - {entry['unitId']} {entry['screenshot']}: {entry['reason']}")
        else:
            print(
                f"    - orphan photo {entry['file']} -> nearest {entry['nearestUnitId']} "
                f"({entry['deltaSeconds']}s)"
            )

    if args.crops:
        written = write_crops(units, input_dir, out_dir)
        print(f"  wrote {written} helper images to {out_dir / 'crops'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
