#!/usr/bin/env python3
"""Build deterministic lossless WebP and lossy KTX2 UASTC derivatives for the ST01c atlases."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import platform
import re
import struct
import subprocess
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
WEBP_VARIANTS = {"full": 256, "half": 128, "quarter": 64}
# GPU-compressed variants keep the full 256 px cell: no downscale, no RDO. Orientation is flipped to a
# lower-left origin because Three uploads compressed textures without flipY.
KTX2_RECIPES = {
    "ktx2-uastc": ("--t2", "--encode", "uastc", "--uastc_quality", "4", "--zcmp", "3", "--genmipmap",
                   "--lower_left_maps_to_s0t0", "--assign_oetf", "srgb", "--assign_primaries", "srgb"),
}
EXPECTED_VARIANTS = {**WEBP_VARIANTS, **{ident: 256 for ident in KTX2_RECIPES}}
# Portable encoder kept outside git; override with --toktx.
DEFAULT_TOKTX = Path("C:/DEV/real of trade/realms-of-trade-server/.scratch/tools/ktx-4.4.2/bin/toktx.exe")
KTX2_MAGIC = b"\xabKTX 20\xbb\r\n\x1a\n"
KHR_DF_MODEL_UASTC, KHR_DF_PRIMARIES_BT709, KHR_DF_TRANSFER_SRGB, KTX2_SUPERCOMPRESSION_ZSTD = 166, 1, 2, 2
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
        raise ValueError("expected the declared atlas variants")
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


def parse_ktx2(data: bytes) -> dict:
    """Read the KTX2 header, level index and basic data format descriptor fields we pin."""
    if len(data) < 80 or data[:12] != KTX2_MAGIC:
        raise ValueError("not a KTX2 file")
    (vk_format, _type_size, width, height, depth, layers, faces, level_count, supercompression,
     dfd_offset, dfd_length, _kvd_offset, _kvd_length) = struct.unpack_from("<13I", data, 12)
    if level_count < 1 or len(data) < 80 + 24 * level_count or dfd_length < 28 or dfd_offset + dfd_length > len(data):
        raise ValueError("truncated KTX2 header")
    levels = []
    for index in range(level_count):
        offset, length, uncompressed = struct.unpack_from("<3Q", data, 80 + 24 * index)
        if offset + length > len(data):
            raise ValueError("KTX2 level outside file")
        levels.append({"byteLength": length, "uncompressedByteLength": uncompressed})
    model, primaries, transfer, flags = struct.unpack_from("<4B", data, dfd_offset + 12)
    return {"vkFormat": vk_format, "width": width, "height": height, "depth": depth, "layers": layers, "faces": faces,
            "supercompression": supercompression, "colorModel": model, "primaries": primaries,
            "transfer": transfer, "dfdFlags": flags, "levels": levels}


def toktx_version(toktx: Path) -> str:
    try:
        result = subprocess.run([str(toktx), "--version"], capture_output=True, text=True)
    except OSError as exc:
        raise RuntimeError(f"toktx unavailable: {exc}") from exc
    version = (result.stdout or result.stderr).strip()
    if result.returncode != 0 or not re.fullmatch(r"toktx v\d+\.\d+\.\d+", version):
        raise RuntimeError(f"toktx unavailable or unexpected version: {version or result.returncode}")
    return version


def encode_ktx2(toktx: Path, ident: str, input_row: dict, input_path: Path, temp_dir: Path) -> tuple[str, bytes, dict, list[str]]:
    """Run toktx once per source atlas (one retry) and validate the container it wrote."""
    name = f"{ident}-{input_row['id']}.ktx2"
    args = [*KTX2_RECIPES[ident], name, str(input_path)]
    for attempt in (1, 2):
        result = subprocess.run([str(toktx), *args], cwd=temp_dir, capture_output=True, text=True)
        if result.returncode == 0 and (temp_dir / name).is_file():
            break
        if attempt == 2:
            raise RuntimeError(f"toktx failed for {name} (exit {result.returncode}): {result.stderr.strip() or result.stdout.strip()}")
    data = (temp_dir / name).read_bytes()
    info = parse_ktx2(data)
    width, height = input_row["dimensions"]
    expected_levels = max(width, height).bit_length()
    if (info["vkFormat"], info["width"], info["height"], info["depth"], info["layers"], info["faces"]) != (0, width, height, 0, 0, 1) \
            or info["supercompression"] != KTX2_SUPERCOMPRESSION_ZSTD or len(info["levels"]) != expected_levels:
        raise RuntimeError(f"unexpected KTX2 container layout: {name}")
    if (info["colorModel"], info["primaries"], info["transfer"]) != (KHR_DF_MODEL_UASTC, KHR_DF_PRIMARIES_BT709, KHR_DF_TRANSFER_SRGB):
        raise RuntimeError(f"KTX2 must declare UASTC, BT.709 primaries and sRGB transfer: {name}")
    block_bytes = sum(((max(1, width >> i) + 3) // 4) * ((max(1, height >> i) + 3) // 4) * 16 for i in range(expected_levels))
    if sum(level["uncompressedByteLength"] for level in info["levels"]) != block_bytes:
        raise RuntimeError(f"KTX2 level sizes do not match 8 bpp UASTC blocks: {name}")
    return name, data, info, ["toktx", *KTX2_RECIPES[ident], name, input_row["file"]]


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


def generate(spec: dict, resolved: list[tuple[dict, Path]], temp_dir: Path, toktx: Path = DEFAULT_TOKTX) -> tuple[dict, dict[str, bytes]]:
    tool_bytes = normalized_utf8(TOOL)
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "sourceSystemSha256": spec["sourceSystemSha256"],
        "sourceSpecSha256": sha(normalized_utf8(SPEC_PATH)),
        "toolSha256": sha(tool_bytes),
        "versions": {"python": platform.python_version(), "pillow": PILLOW_VERSION,
                     "libwebp": features.version("webp"), "toktx": toktx_version(toktx)},
        "recipe": {"resize": "per-cell Lanczos; RGB decoded to linear sRGB then encoded; alpha resized separately",
                   "fullVariant": "exact source RGBA pixels", "encoding": "lossless WebP; method=6; exact=True",
                   "gpuEncoding": "ktx2-uastc: full 256 px cells, lossy UASTC quality 4 via toktx, mipmaps stored in file "
                                  "(toktx default filter), sRGB transfer, Zstandard level 3, no RDO; origin flipped to lower-left",
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
            if ident in KTX2_RECIPES:
                name, encoded, info, command = encode_ktx2(toktx, ident, manifest["inputs"][-1], path, temp_dir)
                outputs[name] = encoded
                manifest["variants"].append({"id": ident, "inputId": row["id"], "file": name, "sha256": sha(encoded),
                    "bytes": len(encoded), "dimensions": list(source.size), "grid": row["grid"], "cellSize": cell_size,
                    "mipRgba8Bytes": mip_rgba8_bytes(*source.size), "container": "ktx2", "codec": "uastc", "lossy": True,
                    "encodedFromRgbaSha256": manifest["inputs"][-1]["decodedRgbaSha256"], "supercompression": "zstd",
                    "levelCount": len(info["levels"]), "gpuBlockBytes": sum(l["uncompressedByteLength"] for l in info["levels"]),
                    "levels": info["levels"], "colorModel": "UASTC", "transfer": "srgb", "primaries": "bt709",
                    "encoder": {"name": "toktx", "version": manifest["versions"]["toktx"], "commandLine": " ".join(command),
                                "workingDirectory": "empty temp folder; input path is workspace-relative"}})
                continue
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


def manifest_extends(old_bytes: bytes, new: dict) -> bool:
    """True when every input and variant row of the previous manifest survives unchanged in the new one."""
    try:
        old = json.loads(old_bytes)
    except json.JSONDecodeError:
        return False
    return (isinstance(old, dict) and old.get("schema") == MANIFEST_SCHEMA and old.get("inputs") == new["inputs"]
            and all(row in new["variants"] for row in old.get("variants", [])))


def run(check: bool, toktx: Path) -> None:
    spec, _spec_bytes, resolved = load_spec()
    OUT_DIR.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="st01c-atlas-") as temp_name:
        temp = Path(temp_name)
        manifest, outputs = generate(spec, resolved, temp, toktx)
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
                # The manifest is an index: it may grow when the previous rows survive byte for byte.
                if name == "manifest.json" and manifest_extends(target.read_bytes(), manifest):
                    continue
                raise RuntimeError(f"refusing to overwrite changed output: {target}")
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        for name, data in expected.items():
            target = OUT_DIR / name
            if not target.exists() or (name == "manifest.json" and target.read_bytes() != data):
                target.write_bytes(data)
        print(f"atlas-build wrote/confirmed {len(outputs)} derivatives under {OUT_DIR.relative_to(ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="regenerate in temp and compare byte-for-byte")
    parser.add_argument("--toktx", type=Path, default=DEFAULT_TOKTX, help="KTX-Software toktx executable (default: portable v4.4.2 install)")
    args = parser.parse_args()
    try:
        run(args.check, args.toktx)
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"atlas-build: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
