"""Inspect alpha bounds and file metadata for the character alpha source set."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = REPO_ROOT / "docs" / "art" / "source" / "character-alpha-v1"


def inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_image(path: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        image.load()
        rgba = image.convert("RGBA")
        alpha = rgba.getchannel("A")
        alpha_min, alpha_max = alpha.getextrema()
        alpha_histogram = alpha.histogram()
        transparent_count = alpha_histogram[0]
        solid_alpha_count = sum(alpha_histogram[241:])
        nonzero_bbox = alpha.getbbox()
        visible_bbox = alpha.point(lambda value: 255 if value > 128 else 0).getbbox()
        width, height = image.size

        def margins(bbox: tuple[int, int, int, int] | None) -> dict[str, int] | None:
            if bbox is None:
                return None
            left, top, right, bottom = bbox
            return {
                "left": left,
                "top": top,
                "right": width - right,
                "bottom": height - bottom,
            }

        expected_opaque = "harbor-background" in path.stem.lower()
        real_transparency = transparent_count > 0 and alpha_min == 0
        opacity_ok = transparent_count == 0 and alpha_min == 255 if expected_opaque else real_transparency
        return {
            "file": path.name,
            "dimensions": {"width": width, "height": height},
            "mode": image.mode,
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
            "alphaMinMax": {"min": alpha_min, "max": alpha_max},
            "transparentPixelCount": transparent_count,
            "whiteVisiblePixelCount": sum(
                1 for red, green, blue, a in rgba.get_flattened_data()
                if a > 0 and red > 240 and green > 240 and blue > 240
            ),
            "solidAlphaAbove240PixelCount": solid_alpha_count,
            "nonzeroAlphaBBox": nonzero_bbox,
            "alphaAbove128BBox": visible_bbox,
            "nonzeroAlphaMarginsPx": margins(nonzero_bbox),
            "alphaAbove128MarginsPx": margins(visible_bbox),
            "hasTransparentMargin": bool(
                nonzero_bbox and any(value > 0 for value in margins(nonzero_bbox).values())
            ),
            "expectedOpaque": expected_opaque,
            "transparencyCheck": "pass" if opacity_ok else "fail",
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--out", type=Path, help="Write JSON to a file inside the source directory")
    args = parser.parse_args()
    source_dir = args.source_dir.resolve()
    if not inside(source_dir, DEFAULT_SOURCE):
        parser.error(f"source directory must be inside {DEFAULT_SOURCE}")
    if not source_dir.is_dir():
        parser.error(f"source directory does not exist: {source_dir}")

    files = sorted(path for path in source_dir.glob("*.png") if path.is_file())
    results = [inspect_image(path) for path in files]
    failed_count = sum(item["transparencyCheck"] != "pass" for item in results)
    source_bytes_total = sum(item["bytes"] for item in results)
    document = {
        "sourceDirectory": str(source_dir),
        "imageCount": len(results),
        "sourceBytesTotal": source_bytes_total,
        "status": "pass" if results and failed_count == 0 else "fail",
        "failedImageCount": failed_count,
        "images": results,
    }
    serialized = json.dumps(document, indent=2, ensure_ascii=False) + "\n"
    if args.out:
        output = args.out.resolve()
        if not inside(output, DEFAULT_SOURCE) or output == source_dir:
            parser.error("output file must resolve inside the source directory")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized, encoding="utf-8")
    else:
        print(serialized, end="")
    return 0 if document["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
