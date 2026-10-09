"""Create lossless mobile-size PNG derivatives without editing their backgrounds."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = REPO_ROOT / "docs" / "art" / "source" / "character-alpha-v1"
MAX_WIDTH = 512


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


def alpha_summary(image: Image.Image) -> dict[str, int]:
    alpha = image.convert("RGBA").getchannel("A")
    low, high = alpha.getextrema()
    return {
        "min": low,
        "max": high,
        "transparentPixelCount": alpha.histogram()[0],
    }


def validate_alpha_preserved(source: Image.Image, derivative: Image.Image) -> None:
    source_has_alpha = "A" in source.getbands() or "transparency" in source.info
    if not source_has_alpha:
        return

    expected_alpha = source.convert("RGBA").getchannel("A")
    if source.width > MAX_WIDTH:
        expected_height = max(1, round(source.height * MAX_WIDTH / source.width))
        expected_alpha = expected_alpha.resize((MAX_WIDTH, expected_height), Image.Resampling.LANCZOS)
    actual_rgba = derivative.convert("RGBA")
    if "A" not in derivative.getbands() and "transparency" not in derivative.info:
        raise ValueError("derivative lost the source alpha channel")
    if expected_alpha.size != actual_rgba.size or expected_alpha.tobytes() != actual_rgba.getchannel("A").tobytes():
        raise ValueError("derivative alpha pixels differ from the expected lossless downscale")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args()
    source_dir = args.source_dir.resolve()
    if not inside(source_dir, DEFAULT_SOURCE):
        parser.error(f"source directory must be inside {DEFAULT_SOURCE}")
    if not source_dir.is_dir():
        parser.error(f"source directory does not exist: {source_dir}")

    output_dir = (source_dir / "mobile").resolve()
    if not inside(output_dir, DEFAULT_SOURCE) or output_dir == source_dir:
        parser.error("mobile output directory must resolve inside the source directory")
    output_dir.mkdir(parents=True, exist_ok=True)
    receipt: dict[str, Any] = {
        "sourceDirectory": str(source_dir),
        "derivativeDirectory": str(output_dir),
        "maxWidth": MAX_WIDTH,
        "images": [],
    }

    for original in sorted(path for path in source_dir.glob("*.png") if path.is_file()):
        derivative = (output_dir / original.name).resolve()
        if not inside(derivative, source_dir):
            parser.error(f"derivative path escapes source directory: {derivative}")
        with Image.open(original) as opened:
            opened.load()
            original_size = opened.size
            source_alpha = alpha_summary(opened)
            source_has_alpha = "A" in opened.getbands() or "transparency" in opened.info
            if opened.width > MAX_WIDTH:
                target_height = max(1, round(opened.height * MAX_WIDTH / opened.width))
                working = opened.convert("RGBA") if source_has_alpha else opened.copy()
                working = working.resize((MAX_WIDTH, target_height), Image.Resampling.LANCZOS)
            else:
                working = opened.copy()
            expected_alpha_source = opened.copy()
        working.save(derivative, format="PNG", optimize=True)
        with Image.open(derivative) as result:
            result.load()
            derivative_size = result.size
            derivative_alpha = alpha_summary(result)
            validate_alpha_preserved(expected_alpha_source, result)
        receipt["images"].append({
            "file": original.name,
            "original": {
                "sha256": sha256(original),
                "dimensions": {"width": original_size[0], "height": original_size[1]},
                "bytes": original.stat().st_size,
                "alpha": source_alpha,
            },
            "derivative": {
                "sha256": sha256(derivative),
                "dimensions": {"width": derivative_size[0], "height": derivative_size[1]},
                "bytes": derivative.stat().st_size,
                "alpha": derivative_alpha,
                "alphaPreserved": True,
            },
        })

    receipt_path = (output_dir / "derivatives-receipt.json").resolve()
    if not inside(receipt_path, source_dir):
        parser.error("receipt path escapes source directory")
    receipt_path.write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(receipt_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
