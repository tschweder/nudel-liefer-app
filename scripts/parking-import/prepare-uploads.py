#!/usr/bin/env python3
"""Phase 4a: prepare the parking photos the import will upload.

For every pin that has a chosen parking photo (see `build-report.py`), this resizes the
original capture to the app's storage convention — longest edge 1600 px, JPEG quality 0.80,
EXIF removed (see `src/lib/uploads.ts`) — and writes it to

    .parking-import/upload/<unitId>.jpg

together with `.parking-import/uploads.json`, which records the prepared file, its pixel size,
its byte size and its sha256. Resizing happens here rather than in the TypeScript import so
the upload itself stays dependency-free and the bytes are reviewable before anything is sent.

EXIF is deliberately dropped: it is customer data (capture time, device) that the app never
reads, and `docs/privacy.md` keeps the stored photos to what the driver needs.

Read-only with respect to `2026-10/`, the database and the object storage.

Usage:
    python scripts/parking-import/prepare-uploads.py
    python scripts/parking-import/prepare-uploads.py --force
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageOps

REPO_ROOT = Path(__file__).resolve().parents[2]
WORK = REPO_ROOT / ".parking-import"
INPUT_DIR = REPO_ROOT / "2026-10"

#: Must stay in sync with `MAX_LONG_EDGE` / `JPEG_QUALITY` in src/lib/uploads.ts.
MAX_LONG_EDGE = 1600
JPEG_QUALITY = 80


def read_json(path: Path, default: object = None) -> object:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--work", type=Path, default=WORK)
    parser.add_argument("--input", type=Path, default=INPUT_DIR)
    parser.add_argument("--force", action="store_true", help="re-encode files that already exist")
    args = parser.parse_args()
    work: Path = args.work

    review = read_json(work / "review.json", {}) or {}
    entries = review.get("entries", [])
    if not entries:
        print("review.json is missing or empty - run build-report.py first", flush=True)
        return 2

    out_dir = work / "upload"
    out_dir.mkdir(parents=True, exist_ok=True)
    previous = (read_json(work / "uploads.json", {}) or {}).get("uploads", {})

    prepared: dict[str, dict] = {}
    skipped_no_photo: list[str] = []
    failed: list[dict] = []
    for entry in entries:
        unit_id = entry["unitId"]
        photo = entry.get("photo")
        if not photo:
            skipped_no_photo.append(unit_id)
            continue
        source = args.input / photo["file"]
        target = out_dir / f"{unit_id}.jpg"
        # Re-use an already prepared file unless the caller asked for a re-encode.
        if not args.force and target.is_file() and unit_id in previous:
            prepared[unit_id] = previous[unit_id]
            continue
        if not source.is_file():
            failed.append({"unitId": unit_id, "error": f"missing source {source}"})
            continue
        try:
            with Image.open(source) as image:
                image = ImageOps.exif_transpose(image).convert("RGB")
                longest = max(image.size)
                if longest > MAX_LONG_EDGE:
                    factor = MAX_LONG_EDGE / longest
                    image = image.resize(
                        (
                            max(1, round(image.width * factor)),
                            max(1, round(image.height * factor)),
                        ),
                        Image.LANCZOS,
                    )
                # No `exif=` argument: the metadata (capture time, device) is dropped.
                image.save(target, format="JPEG", quality=JPEG_QUALITY, optimize=True)
                width, height = image.size
            payload = target.read_bytes()
            prepared[unit_id] = {
                "unitId": unit_id,
                "file": str(target.relative_to(REPO_ROOT)).replace("\\", "/"),
                "sourcePhoto": photo["file"],
                "photoDeltaSeconds": photo["deltaSeconds"],
                "width": width,
                "height": height,
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
        except OSError as exc:
            failed.append({"unitId": unit_id, "error": f"{type(exc).__name__}: {exc}"})

    (work / "uploads.json").write_text(
        json.dumps(
            {"maxLongEdge": MAX_LONG_EDGE, "jpegQuality": JPEG_QUALITY, "uploads": prepared},
            indent=2,
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )

    total_bytes = sum(int(u["bytes"]) for u in prepared.values())
    print(f"prepared {len(prepared)} photos in {out_dir}")
    print(f"  total {total_bytes / 1_000_000:.1f} MB (originals would be far larger)")
    if skipped_no_photo:
        print(f"  pins without a photo ({len(skipped_no_photo)}): {' '.join(skipped_no_photo)}")
    for failure in failed:
        print(f"  FAILED {failure['unitId']}: {failure['error']}")
    print(f"wrote {work / 'uploads.json'}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
