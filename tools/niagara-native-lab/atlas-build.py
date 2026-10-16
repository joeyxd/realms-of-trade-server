#!/usr/bin/env python3
"""Build deterministic, per-frame lossless WebP derivatives for the ST01c atlases."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import platform
import re
import sys
import tempfile

from PIL import Image, features, __version__ as PILLOW_VERSION

ROOT = Path(__file__).resolve().parents[2]
TOOL = Path(__file__).resolve()
SPEC_PATH = ROOT / "tools" / "niagara-native-lab" / "atlas-source.json"
OUT_DIR = ROOT / ".scratch" / "atlas-build" / "v1"
SCHEMA = "st01c-atlas-source/v1"
MANIFEST_SCHEMA = "st01c-atlas-build/v1"
EXPECTED_INPUTS = {
    "flame": ("T_FlameUV_2.png", (2048, 1024), (8, 4)),
    "smoke": ("T_Smoke_1.png", (2560, 1536), (10, 6)),
}
EXPECTED_VARIANTS = {"full": 256, "half": 128, "quarter": 64}
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalized_utf8(path: Path) -> bytes:
    """Hash source/spec text independently of checkout CRLF conversion."""
    return path.read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8")


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def resolve_workspace_file(relative: object) -> Path:
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("input file must be a workspace-relative POSIX path")
    candidate = (ROOT / relative).resolve(strict=True)
    if not candidate.is_relative_to(ROOT) or not candidate.is_file():
        raise ValueError("input file escapes workspace or is not a file")
    return candidate


def load_spec(path: Path = SPEC_PATH) -> tuple[dict, bytes, list[tuple[dict, Path]]]:
    raw = path.read_bytes()
    spec = json.loads(raw)
    if not isinstance(spec, dict) or spec.get("schema") != SCHEMA:
        raise ValueError("unsupported atlas source schema")
    if set(spec) != {"schema", "sourceSystemSha256", "inputs", "variants"}:
        raise ValueError("unexpected atlas source spec fields")
    if not isinstance(spec["sourceSystemSha256"], str) or not SHA_RE.fullmatch(spec["sourceSystemSha256"]):
        raise ValueError("invalid source system SHA256")
    inputs = spec["inputs"]
    if not isinstance(inputs, list) or len(inputs) != len(EXPECTED_INPUTS):
        raise ValueError("expected exactly the flame and smoke input atlases")
    resolved: list[tuple[dict, Path]] = []
    seen: set[str] = set()
    for row in inputs:
        if not isinstance(row, dict) or set(row) != {"id", "file", "sha256", "dimensions", "grid", "srgb"}:
            raise ValueError("malformed atlas input row")
        ident = row["id"]
        if not isinstance(ident, str) or ident not in EXPECTED_INPUTS or ident in seen:
            raise ValueError("unexpected or duplicate atlas id")
        seen.add(ident)
        filename, dimensions, grid = EXPECTED_INPUTS[ident]
        if not isinstance(row["file"], str) or Path(row["file"]).name != filename or not row["file"].startswith(".scratch/unreal/"):
            raise ValueError("atlas path is outside the captured source location")
        if row["dimensions"] != list(dimensions) or row["grid"] != list(grid) or row["srgb"] is not True:
            raise ValueError("atlas dimensions, grid, or sRGB setting do not match the pilot")
        if not isinstance(row["sha256"], str) or not SHA_RE.fullmatch(row["sha256"]):
            raise ValueError("invalid input SHA256")
        file_path = resolve_workspace_file(row["file"])
        if sha(file_path.read_bytes()) != row["sha256"]:
            raise ValueError(f"source hash mismatch: {row['id']}")
        with Image.open(file_path) as source:
            if source.format != "PNG" or source.mode != "RGBA" or source.size != dimensions:
                raise ValueError(f"source must be RGBA PNG at expected dimensions: {row['id']}")
            if dimensions[0] % grid[0] or dimensions[1] % grid[1]:
                raise ValueError(f"non-integral atlas cell size: {row['id']}")
            if dimensions[0] // grid[0] != dimensions[1] // grid[1]:
                raise ValueError(f"atlas cells must be square: {row['id']}")
        resolved.append((row, file_path))
    if seen != set(EXPECTED_INPUTS):
        raise ValueError("missing pilot atlas")
    variants = spec["variants"]
    if not isinstance(variants, list) or len(variants) != len(EXPECTED_VARIANTS):
        raise ValueError("expected full, half, and quarter variants")
    variant_ids: set[str] = set()
    for row in variants:
        if not isinstance(row, dict) or set(row) != {"id", "cellSize"}:
            raise ValueError("malformed atlas variant row")
        ident = row["id"]
        if not isinstance(ident, str) or ident not in EXPECTED_VARIANTS or ident in variant_ids or type(row["cellSize"]) is not int:
            raise ValueError("unexpected or duplicate atlas variant")
        if row["cellSize"] != EXPECTED_VARIANTS[ident]:
            raise ValueError("unsupported atlas cell size")
        variant_ids.add(ident)
    if variant_ids != set(EXPECTED_VARIANTS):
        raise ValueError("missing atlas variant")
    return spec, raw, resolved


def mip_rgba8_bytes(width: int, height: int) -> int:
    if type(width) is not int or type(height) is not int or width < 1 or height < 1:
        raise ValueError("mip dimensions must be positive integers")
    total = 0
    while True:
        total += max(1, width) * max(1, height) * 4
        if width == 1 and height == 1:
            return total
        width, height = max(1, width >> 1), max(1, height >> 1)


def _srgb_to_linear(channel: Image.Image) -> Image.Image:
    values = channel.tobytes()
    # Pillow F images store float32 samples. Build directly to avoid an 8-bit
    # quantization before filtering.
    import array
    floats = array.array("f", (v / 255.0 / 12.92 if v <= 10 else ((v / 255.0 + 0.055) / 1.055) ** 2.4 for v in values))
    image = Image.frombytes("F", channel.size, floats.tobytes())
    return image


def _linear_to_srgb(channel: Image.Image) -> Image.Image:
    import array
    values = channel.tobytes()
    floats = array.array("f")
    floats.frombytes(values)
    encoded = bytearray(len(floats))
    for index, value in enumerate(floats):
        value = min(1.0, max(0.0, value))
        srgb = 12.92 * value if value <= 0.0031308 else 1.055 * (value ** (1.0 / 2.4)) - 0.055
        encoded[index] = min(255, max(0, int(math.floor(srgb * 255.0 + 0.5))))
    return Image.frombytes("L", channel.size, bytes(encoded))


def resize_frame_linear(frame: Image.Image, size: int) -> Image.Image:
    """Resize one RGBA frame with RGB filtered in linear sRGB and alpha separately."""
    if frame.mode != "RGBA" or type(size) is not int or size < 1:
        raise ValueError("expected an RGBA frame and positive integer target size")
    if frame.size == (size, size):
        return frame.copy()
    channels = frame.split()
    rgb = []
    for channel in channels[:3]:
        linear = _srgb_to_linear(channel)
        resized = linear.resize((size, size), Image.Resampling.LANCZOS)
        rgb.append(_linear_to_srgb(resized))
    alpha = channels[3].resize((size, size), Image.Resampling.LANCZOS)
    return Image.merge("RGBA", (*rgb, alpha))


def build_atlas(source: Image.Image, grid: tuple[int, int], cell_size: int) -> Image.Image:
    if source.mode != "RGBA" or len(grid) != 2 or type(cell_size) is not int or cell_size < 1:
        raise ValueError("invalid atlas image, grid, or cell size")
    columns, rows = grid
    if type(columns) is not int or type(rows) is not int or columns < 1 or rows < 1:
        raise ValueError("grid values must be positive integers")
    if source.width % columns or source.height % rows:
        raise ValueError("atlas grid must divide source dimensions")
    source_cell_w, source_cell_h = source.width // columns, source.height // rows
    if source_cell_w != source_cell_h:
        raise ValueError("atlas source cells must be square")
    if cell_size == source_cell_w:
        return source.copy()
    atlas = Image.new("RGBA", (columns * cell_size, rows * cell_size))
    for row in range(rows):
        for col in range(columns):
            frame = source.crop((col * source_cell_w, row * source_cell_h,
                                 (col + 1) * source_cell_w, (row + 1) * source_cell_h))
            atlas.paste(resize_frame_linear(frame, cell_size), (col * cell_size, row * cell_size))
    return atlas


def _decoded_rgba(image: Image.Image) -> bytes:
    return image.convert("RGBA").tobytes()


def generate(spec: dict, resolved: list[tuple[dict, Path]], temp_dir: Path) -> tuple[dict, dict[str, bytes]]:
    tool_bytes = normalized_utf8(TOOL)
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "sourceSystemSha256": spec["sourceSystemSha256"],
        "sourceSpecSha256": sha(normalized_utf8(SPEC_PATH)),
        "toolSha256": sha(tool_bytes),
        "versions": {"python": platform.python_version(), "pillow": PILLOW_VERSION,
                     "libwebp": features.version("webp")},
        "recipe": {"resize": "per-cell Lanczos; RGB decoded to linear sRGB then encoded; alpha resized separately",
                   "fullVariant": "exact source RGBA pixels", "encoding": "lossless WebP; method=6; exact=True",
                   "gutters": "none; preserve source cell UV boundaries",
                   "textHashNormalization": "UTF-8 text with CRLF normalized to LF"},
        "inputs": [], "variants": [],
    }
    outputs: dict[str, bytes] = {}
    for row, path in resolved:
        source_data = path.read_bytes()
        if sha(source_data) != row["sha256"]:
            raise ValueError(f"source hash changed after validation: {row['id']}")
        with Image.open(path) as opened:
            source = opened.copy()
        manifest["inputs"].append({"id": row["id"], "file": row["file"], "sha256": sha(source_data), "bytes": len(source_data),
                                   "dimensions": list(source.size), "grid": row["grid"], "srgb": row["srgb"],
                                   "decodedRgbaSha256": sha(_decoded_rgba(source))})
        for variant in sorted(spec["variants"], key=lambda v: v["cellSize"], reverse=True):
            ident, cell_size = variant["id"], variant["cellSize"]
            image = build_atlas(source, tuple(row["grid"]), cell_size)
            target = temp_dir / f"{ident}-{row['id']}.webp"
            image.save(target, format="WEBP", lossless=True, method=6, exact=True)
            encoded = target.read_bytes()
            with Image.open(target) as decoded:
                decoded.load()
                if decoded.size != image.size or _decoded_rgba(decoded) != _decoded_rgba(image):
                    raise RuntimeError(f"WebP decoded pixels differ: {ident}-{row['id']}")
            outputs[target.name] = encoded
            manifest["variants"].append({"id": ident, "inputId": row["id"], "file": target.name,
                "sha256": sha(encoded), "decodedRgbaSha256": sha(_decoded_rgba(image)), "bytes": len(encoded),
                "dimensions": list(image.size), "grid": row["grid"], "cellSize": cell_size,
                "mipRgba8Bytes": mip_rgba8_bytes(*image.size)})
    manifest["variants"].sort(key=lambda row: (row["id"], row["inputId"]))
    return manifest, outputs


def run(check: bool) -> None:
    spec, _spec_bytes, resolved = load_spec()
    OUT_DIR.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="st01c-atlas-") as temp_name:
        temp = Path(temp_name)
        manifest, outputs = generate(spec, resolved, temp)
        manifest_bytes = canonical_json(manifest)
        expected = {**outputs, "manifest.json": manifest_bytes}
        existing = {name: (OUT_DIR / name).exists() for name in expected}
        if check:
            if not all(existing.values()):
                raise RuntimeError("--check requires every versioned derivative and manifest to exist")
            for name, data in expected.items():
                if (OUT_DIR / name).read_bytes() != data:
                    raise RuntimeError(f"--check mismatch; refusing changed output: {name}")
            print(f"atlas-build check OK: {len(outputs)} derivatives; manifest matches")
            return
        for name, data in expected.items():
            target = OUT_DIR / name
            if target.exists() and target.read_bytes() != data:
                raise RuntimeError(f"refusing to overwrite changed output: {target}")
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        for name, data in expected.items():
            target = OUT_DIR / name
            if not target.exists():
                target.write_bytes(data)
        print(f"atlas-build wrote/confirmed {len(outputs)} derivatives under {OUT_DIR.relative_to(ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="regenerate in temp and compare byte-for-byte")
    args = parser.parse_args()
    try:
        run(args.check)
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"atlas-build: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
