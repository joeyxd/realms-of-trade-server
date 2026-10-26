#!/usr/bin/env python3
"""Extract exact cached FObjectThumbnail rows from verified Niagara uassets.

This only reads Unreal source files. It never loads, edits, or executes Unreal
assets. The output is a static editor-thumbnail contact sheet source, not VFX.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, UnidentifiedImageError


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = REPO_ROOT / "docs/research/unreal-assets/niagara-catalog.json"
DEFAULT_SOURCE_ROOT = Path(r"C:\Unreal")
DEFAULT_OUTPUT = REPO_ROOT / "assets/vfx/niagara/thumbnails"
DEFAULT_MANIFEST = REPO_ROOT / "docs/art/niagara-v1/thumbnails.json"
DEFAULT_SCRATCH = REPO_ROOT / ".scratch/st01b-thumbnails"
CLASS_NAME = "NiagaraSystem"
MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_THUMBNAIL_BYTES = 32 * 1024 * 1024
MAX_DIMENSION = 8192
MAX_PIXELS = 16_777_216
IDENTITY_RE = re.compile(r"^niagara-[0-9a-f]{16}$")
ASSET_REGISTRY_METHOD = "UE 5.8 AssetRegistry primary asset class from isolated project Content copy; no system objects loaded"


def fstring_bytes(value: str) -> bytes:
    """Encode UE FString serialization: positive ANSI length or negative UTF-16 length."""
    try:
        encoded = value.encode("ascii") + b"\x00"
        return struct.pack("<i", len(encoded)) + encoded
    except UnicodeEncodeError:
        encoded = value.encode("utf-16-le") + b"\x00\x00"
        code_units = len(encoded) // 2
        return struct.pack("<i", -code_units) + encoded


def find_exact_rows(data: bytes, basename: str) -> list[tuple[int, int]]:
    needle = fstring_bytes(CLASS_NAME) + fstring_bytes(basename)
    matches: list[tuple[int, int]] = []
    cursor = 0
    while True:
        row_offset = data.find(needle, cursor)
        if row_offset < 0:
            return matches
        cursor = row_offset + 1
        offset_pos = row_offset + len(needle)
        if offset_pos + 4 <= len(data):
            file_offset = struct.unpack_from("<i", data, offset_pos)[0]
            matches.append((row_offset, file_offset))


def resolved_source(source: dict, source_root: Path) -> tuple[Path | None, str | None]:
    raw_path = source.get("path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        return None, "source-path-missing"
    try:
        path = Path(raw_path).resolve(strict=True)
        path.relative_to(source_root)
    except FileNotFoundError:
        return None, "source-file-missing"
    except (OSError, ValueError):
        return None, "source-path-outside-root-or-invalid"
    if not path.is_file():
        return None, "source-is-not-file"
    return path, None


def inspect_thumbnail(data: bytes, file_offset: int, row_offset: int) -> tuple[dict | None, str | None]:
    if file_offset < 0 or file_offset >= row_offset:
        return None, "thumbnail-offset-not-before-table-row"
    if file_offset + 12 > row_offset or file_offset + 12 > len(data):
        return None, "thumbnail-header-out-of-bounds"
    width, signed_height, payload_size = struct.unpack_from("<iii", data, file_offset)
    if width == 0 and signed_height == 0 and payload_size == 0:
        return None, "cached-thumbnail-empty"
    height = abs(signed_height)
    if width <= 0 or height <= 0 or width > MAX_DIMENSION or height > MAX_DIMENSION or width * height > MAX_PIXELS:
        return None, "thumbnail-dimensions-out-of-bounds"
    if payload_size <= 0 or payload_size > MAX_THUMBNAIL_BYTES:
        return None, "thumbnail-compressed-size-out-of-bounds"
    payload_start = file_offset + 12
    payload_end = payload_start + payload_size
    if payload_end > len(data) or payload_end > row_offset:
        return None, "thumbnail-payload-crosses-table-row-or-file-end"
    payload = data[payload_start:payload_end]
    is_jpeg = payload.startswith(b"\xff\xd8")
    is_png = payload.startswith(b"\x89PNG\r\n\x1a\n")
    if not (is_jpeg or is_png):
        return None, "thumbnail-payload-not-png-or-jpeg"
    if (signed_height < 0) != is_jpeg:
        return None, "thumbnail-format-sign-does-not-match-header"
    try:
        with Image.open(io.BytesIO(payload)) as image:
            image_format = image.format
            image.verify()
        with Image.open(io.BytesIO(payload)) as image:
            image.load()
            if image.size != (width, height):
                return None, "decoded-image-size-mismatches-header"
            if image_format != ("JPEG" if is_jpeg else "PNG"):
                return None, "decoded-image-format-mismatches-signature"
            rgba = image.convert("RGBA")
            rgba.thumbnail((128, 128), Image.Resampling.LANCZOS)
            result = {
                "payload": payload,
                "rgba": rgba,
                "sourceFormat": image_format.lower(),
                "width": width,
                "height": height,
                "compressedBytes": payload_size,
            }
            return result, None
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        return None, "image-decode-failed"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_record(effect: dict) -> dict | None:
    sources = effect.get("sources")
    if not isinstance(sources, list) or not sources:
        return None
    return sources[0] if isinstance(sources[0], dict) else None


def process_effect(effect: dict, source_root: Path, output_dir: Path) -> dict:
    effect_id = effect.get("id")
    name = effect.get("name") if isinstance(effect.get("name"), str) else ""
    evidence = effect.get("evidence") if isinstance(effect.get("evidence"), dict) else {}
    base = {
        "id": effect_id,
        "name": name,
        "role": "cached-editor-thumbnail",
        "animationClaim": False,
        "description": "Single cached Unreal editor thumbnail; static image, not an animation capture.",
    }
    if not isinstance(effect_id, str) or not IDENTITY_RE.fullmatch(effect_id):
        return {**base, "status": "missing", "reason": "invalid-catalog-identity"}
    if evidence.get("class") != CLASS_NAME or evidence.get("method") != ASSET_REGISTRY_METHOD:
        return {**base, "status": "missing", "reason": "source-not-verified-by-asset-registry"}
    source = source_record(effect)
    if source is None:
        return {**base, "status": "missing", "reason": "source-record-missing"}
    path, path_error = resolved_source(source, source_root)
    if path_error:
        return {**base, "status": "missing", "reason": path_error, "project": source.get("project"), "package": source.get("package")}
    assert path is not None
    try:
        source_size = path.stat().st_size
        if source_size <= 0 or source_size > MAX_SOURCE_BYTES:
            return {**base, "status": "missing", "reason": "source-size-out-of-bounds", "sourceBytes": source_size}
        data = path.read_bytes()
    except OSError:
        return {**base, "status": "missing", "reason": "source-read-failed"}
    actual_hash = sha256_bytes(data)
    expected_hash = source.get("sha256")
    expected_size = source.get("bytes")
    if actual_hash != expected_hash or source_size != expected_size:
        return {**base, "status": "missing", "reason": "source-hash-or-size-mismatch", "sourceSha256": actual_hash, "sourceBytes": source_size}
    package = source.get("package")
    basename = package.rsplit("/", 1)[-1] if isinstance(package, str) else ""
    if not basename or path.stem != basename:
        return {**base, "status": "missing", "reason": "package-basename-mismatch", "project": source.get("project"), "package": package}
    rows = find_exact_rows(data, basename)
    if not rows:
        return {**base, "status": "missing", "reason": "exact-class-and-basename-row-not-found", "sourceSha256": actual_hash, "sourceBytes": source_size, "project": source.get("project"), "package": package}
    valid: list[tuple[int, int, dict]] = []
    invalid_reasons: list[str] = []
    for row_offset, file_offset in rows:
        thumbnail, error = inspect_thumbnail(data, file_offset, row_offset)
        if error:
            invalid_reasons.append(error)
        elif thumbnail is not None:
            valid.append((row_offset, file_offset, thumbnail))
    if len(valid) != 1:
        reason = "ambiguous-exact-thumbnail-rows" if len(valid) > 1 else (invalid_reasons[0] if invalid_reasons else "no-valid-thumbnail-row")
        return {**base, "status": "missing", "reason": reason, "exactRowsFound": len(rows), "validRowsFound": len(valid), "sourceSha256": actual_hash, "sourceBytes": source_size, "project": source.get("project"), "package": package}

    row_offset, file_offset, thumbnail = valid[0]
    output_path = output_dir / f"{effect_id}.webp"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    thumbnail["rgba"].save(output_path, format="WEBP", quality=82, method=6)
    output_bytes = output_path.read_bytes()
    return {
        **base,
        "status": "extracted",
        "project": source.get("project"),
        "package": package,
        "sourceSha256": actual_hash,
        "sourceBytes": source_size,
        "tableRowOffset": row_offset,
        "classStringOffset": row_offset + 4,
        "thumbnailFileOffset": file_offset,
        "thumbnailFormat": thumbnail["sourceFormat"],
        "thumbnailWidth": thumbnail["width"],
        "thumbnailHeight": thumbnail["height"],
        "thumbnailCompressedBytes": thumbnail["compressedBytes"],
        "method": "Exact serialized FString NiagaraSystem + package basename row; bounded FObjectThumbnail header and payload; Pillow decoded dimensions verified.",
        "output": "/" + output_path.relative_to(REPO_ROOT).as_posix(),
        "outputWidth": thumbnail["rgba"].width,
        "outputHeight": thumbnail["rgba"].height,
        "outputBytes": len(output_bytes),
        "outputSha256": sha256_bytes(output_bytes),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--scratch-dir", type=Path, default=DEFAULT_SCRATCH)
    parser.add_argument("--only-id", action="append", default=[], help="Process a limited identity; repeatable for CPU prototypes.")
    return parser.parse_args()


def require_destination_outside_source(destination: Path, source_root: Path, label: str) -> None:
    if destination == source_root or destination.is_relative_to(source_root):
        raise SystemExit(f"{label} must be outside the read-only source root: {destination}")


def main() -> int:
    args = parse_args()
    catalog_path = args.catalog.resolve(strict=True)
    source_root = args.source_root.resolve(strict=True)
    output_dir = args.output_dir.resolve()
    manifest_path = args.manifest.resolve()
    scratch_dir = args.scratch_dir.resolve()
    require_destination_outside_source(output_dir, source_root, "--output-dir")
    require_destination_outside_source(manifest_path, source_root, "--manifest")
    require_destination_outside_source(scratch_dir, source_root, "--scratch-dir")
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    effects = catalog.get("effects") if isinstance(catalog, dict) else None
    if not isinstance(effects, list):
        raise SystemExit("Catalog must contain an effects array")
    if args.only_id:
        selected = set(args.only_id)
        effects = [effect for effect in effects if effect.get("id") in selected]
        missing_ids = selected - {effect.get("id") for effect in effects}
        if missing_ids:
            raise SystemExit(f"IDs not in catalog: {', '.join(sorted(missing_ids))}")

    output_dir.mkdir(parents=True, exist_ok=True)
    scratch_dir.mkdir(parents=True, exist_ok=True)
    entries = [process_effect(effect, source_root, output_dir) for effect in effects]
    extracted = sum(entry["status"] == "extracted" for entry in entries)
    extracted_bytes = sum(entry.get("outputBytes", 0) for entry in entries if entry["status"] == "extracted")
    source_bytes = sum(entry.get("sourceBytes", 0) for entry in entries)
    source_hashes = {entry["sourceSha256"] for entry in entries if entry.get("sourceSha256")}
    manifest = {
        "schema": "marea.niagara-cached-thumbnails",
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "method": "UE cached FObjectThumbnail extraction; no Unreal object loading, renderer, or animation capture.",
        "catalog": catalog_path.relative_to(REPO_ROOT).as_posix() if catalog_path.is_relative_to(REPO_ROOT) else catalog_path.name,
        "counts": {
            "considered": len(entries), "extracted": extracted, "missing": len(entries) - extracted,
            "extractedWebpBytes": extracted_bytes, "sourceBytesVerified": source_bytes,
            "sourceHashesVerified": len(source_hashes), "sourceHashesMissing": len(entries) - len(source_hashes),
        },
        "entries": entries,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    report = {
        "generatedAt": manifest["generatedAt"],
        "catalog": manifest["catalog"],
        "counts": manifest["counts"],
        "missingReasons": {},
    }
    for entry in entries:
        if entry["status"] != "extracted":
            reason = entry.get("reason", "unknown")
            report["missingReasons"][reason] = report["missingReasons"].get(reason, 0) + 1
    (scratch_dir / "run-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, json.JSONDecodeError) as error:
        print(f"extract-niagara-thumbnails: {error}", file=sys.stderr)
        raise SystemExit(2)
