#!/usr/bin/env python3
"""Package the Buccaneer v1 source assets into deterministic runtime derivatives."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import sys
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, __version__ as PILLOW_VERSION


REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = REPO_ROOT / "docs" / "art" / "source" / "buccaneer-v1"
EVIDENCE_PATH = REPO_ROOT / "docs" / "art" / "buccaneer-v1" / "asset-evidence.json"
SOURCE_GLB = "male anime+character+3d+model.glb"
SOURCE_PORTRAIT = "pirate_avatar_alpha.png"
EXPECTED_TRIANGLES = 9164
EXPECTED_SKIN_JOINTS = 65
GLB_MAGIC = b"glTF"
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as tmp:
            tmp.write(data)
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp_name = tmp.name
        os.replace(tmp_name, path)
    finally:
        if tmp_name and os.path.exists(tmp_name):
            os.unlink(tmp_name)


def preserve_original(src: Path, dst: Path) -> bytes:
    data = src.read_bytes()
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        existing = dst.read_bytes()
        if existing != data:
            raise ValueError(f"refusing to replace a different preserved original: {dst}")
    else:
        atomic_write(dst, data)
    if dst.read_bytes() != data:
        raise ValueError(f"original copy is not byte-identical: {dst}")
    return data


def parse_glb(data: bytes) -> tuple[dict[str, Any], bytes]:
    if len(data) < 20 or data[:4] != GLB_MAGIC:
        raise ValueError("input is not a GLB 2.0 file")
    version, declared_length = struct.unpack_from("<II", data, 4)
    if version != 2 or declared_length != len(data):
        raise ValueError("invalid GLB version or declared length")
    offset = 12
    doc: dict[str, Any] | None = None
    binary: bytes | None = None
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("truncated GLB chunk header")
        length, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset : offset + length]
        if len(chunk) != length:
            raise ValueError("truncated GLB chunk")
        offset += length
        if kind == JSON_CHUNK:
            if doc is not None:
                raise ValueError("GLB has multiple JSON chunks")
            doc = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
        elif kind == BIN_CHUNK:
            if binary is not None:
                raise ValueError("GLB has multiple BIN chunks")
            binary = chunk
    if doc is None or binary is None:
        raise ValueError("GLB must contain JSON and BIN chunks")
    buffers = doc.get("buffers", [])
    if len(buffers) != 1 or buffers[0].get("uri") is not None:
        raise ValueError("expected one self-contained GLB buffer")
    if buffers[0].get("byteLength", 0) > len(binary):
        raise ValueError("GLB buffer length exceeds its BIN chunk")
    return doc, binary


def view_bytes(doc: dict[str, Any], binary: bytes, view_index: int) -> bytes:
    view = doc["bufferViews"][view_index]
    if view.get("buffer", 0) != 0:
        raise ValueError("only the self-contained buffer is supported")
    start = view.get("byteOffset", 0)
    end = start + view["byteLength"]
    if start < 0 or end > len(binary):
        raise ValueError("bufferView points outside the BIN chunk")
    return binary[start:end]


def count_triangles(doc: dict[str, Any]) -> int:
    total = 0
    accessors = doc.get("accessors", [])
    for mesh in doc.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            if primitive.get("mode", 4) != 4:
                raise ValueError("all character primitives must use TRIANGLES mode")
            if "indices" in primitive:
                count = accessors[primitive["indices"]]["count"]
            else:
                count = accessors[primitive["attributes"]["POSITION"]]["count"]
            if count % 3:
                raise ValueError("triangle index count is not divisible by three")
            total += count // 3
    return total


def basecolor_image_index(doc: dict[str, Any]) -> int:
    materials = doc.get("materials", [])
    if not materials:
        raise ValueError("GLB has no material/base-color texture")
    pbr = materials[0].get("pbrMetallicRoughness", {})
    texture_index = pbr.get("baseColorTexture", {}).get("index")
    textures = doc.get("textures", [])
    if texture_index is None or texture_index >= len(textures):
        raise ValueError("first material has no valid base-color texture")
    image_index = textures[texture_index].get("source")
    images = doc.get("images", [])
    if image_index is None or image_index >= len(images):
        raise ValueError("base-color texture has no core glTF image source")
    image = images[image_index]
    if "bufferView" not in image or image.get("mimeType") != "image/jpeg":
        raise ValueError("expected an embedded JPEG base-color image")
    return image_index


def image_payload(doc: dict[str, Any], binary: bytes, image_index: int) -> bytes:
    return view_bytes(doc, binary, doc["images"][image_index]["bufferView"])


def compact_glb(
    source_doc: dict[str, Any], source_binary: bytes, basecolor_jpeg: bytes, basecolor_name: str
) -> bytes:
    doc = json.loads(json.dumps(source_doc))
    retained_names = ("idle", "swim", "hit_to_body_01")
    source_animations = doc.get("animations", [])
    retained_clips = []
    for name in retained_names:
        matches = [animation for animation in source_animations if animation.get("name") == name]
        if len(matches) != 1:
            raise ValueError(f"expected exactly one source {name} clip, found {len(matches)}")
        retained_clips.append(matches[0])
    doc["animations"] = retained_clips
    image_index = basecolor_image_index(doc)

    # Preserve mesh, skin, inverse-bind, and the retained idle/swim/hit animation accessors.
    needed_accessors: set[int] = set()
    for mesh in doc.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            needed_accessors.update(primitive.get("attributes", {}).values())
            if "indices" in primitive:
                needed_accessors.add(primitive["indices"])
    for skin in doc.get("skins", []):
        if "inverseBindMatrices" in skin:
            needed_accessors.add(skin["inverseBindMatrices"])
    for animation in doc["animations"]:
        for sampler in animation.get("samplers", []):
            needed_accessors.add(sampler["input"])
            needed_accessors.add(sampler["output"])
    if not needed_accessors:
        raise ValueError("no mesh/skin accessors found")

    accessors = doc.get("accessors", [])
    old_to_new_accessor = {old: new for new, old in enumerate(sorted(needed_accessors))}
    kept_accessors = [accessors[old] for old in sorted(needed_accessors)]

    # The source albedo view is replaced below, so only views backing retained accessors survive.
    needed_views: set[int] = set()
    for accessor in kept_accessors:
        if "bufferView" in accessor:
            needed_views.add(accessor["bufferView"])
        sparse = accessor.get("sparse", {})
        if sparse:
            needed_views.add(sparse["indices"]["bufferView"])
            needed_views.add(sparse["values"]["bufferView"])
    views = doc.get("bufferViews", [])
    old_to_new_view = {old: new for new, old in enumerate(sorted(needed_views))}
    output_binary = bytearray()
    kept_views: list[dict[str, Any]] = []
    for old in sorted(needed_views):
        while len(output_binary) % 4:
            output_binary.append(0)
        raw = view_bytes(doc, source_binary, old)
        view = dict(views[old])
        view.pop("buffer", None)
        view["buffer"] = 0
        view["byteOffset"] = len(output_binary)
        view["byteLength"] = len(raw)
        output_binary.extend(raw)
        kept_views.append(view)
    while len(output_binary) % 4:
        output_binary.append(0)
    basecolor_view_index = len(kept_views)
    kept_views.append({"buffer": 0, "byteOffset": len(output_binary), "byteLength": len(basecolor_jpeg)})
    output_binary.extend(basecolor_jpeg)

    for accessor in kept_accessors:
        if "bufferView" in accessor:
            accessor["bufferView"] = old_to_new_view[accessor["bufferView"]]
        sparse = accessor.get("sparse", {})
        if sparse:
            sparse["indices"]["bufferView"] = old_to_new_view[sparse["indices"]["bufferView"]]
            sparse["values"]["bufferView"] = old_to_new_view[sparse["values"]["bufferView"]]
    doc["accessors"] = kept_accessors
    doc["bufferViews"] = kept_views
    doc["buffers"] = [{"byteLength": len(output_binary)}]

    for mesh in doc.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            primitive["attributes"] = {
                name: old_to_new_accessor[index]
                for name, index in primitive.get("attributes", {}).items()
            }
            if "indices" in primitive:
                primitive["indices"] = old_to_new_accessor[primitive["indices"]]
    for skin in doc.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = old_to_new_accessor[skin["inverseBindMatrices"]]
    for animation in doc.get("animations", []):
        for sampler in animation.get("samplers", []):
            sampler["input"] = old_to_new_accessor[sampler["input"]]
            sampler["output"] = old_to_new_accessor[sampler["output"]]

    pbr = doc["materials"][0].setdefault("pbrMetallicRoughness", {})
    pbr["baseColorTexture"] = {"index": 0}
    pbr.pop("metallicRoughnessTexture", None)
    pbr["metallicFactor"] = 0
    pbr["roughnessFactor"] = 1
    material = doc["materials"][0]
    material.pop("normalTexture", None)
    material.pop("occlusionTexture", None)
    material.pop("emissiveTexture", None)
    material.pop("emissiveFactor", None)
    sampler_index = doc.get("textures", [])[source_doc["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"]].get("sampler")
    texture = {"source": 0}
    if sampler_index is not None:
        texture["sampler"] = sampler_index
    doc["textures"] = [texture]
    doc["images"] = [{"name": basecolor_name, "mimeType": "image/jpeg", "bufferView": basecolor_view_index}]

    # Drop extensions that only described removed animation or PBR texture bindings.
    for key in ("extensionsUsed", "extensionsRequired"):
        if key in doc and not doc[key]:
            doc.pop(key)

    json_bytes = json.dumps(doc, ensure_ascii=False, separators=(",", ":"), sort_keys=False).encode("utf-8")
    json_bytes += b" " * (-len(json_bytes) % 4)
    bin_bytes = bytes(output_binary) + b"\0" * (-len(output_binary) % 4)
    total_length = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    return (
        GLB_MAGIC
        + struct.pack("<II", 2, total_length)
        + struct.pack("<II", len(json_bytes), JSON_CHUNK)
        + json_bytes
        + struct.pack("<II", len(bin_bytes), BIN_CHUNK)
        + bin_bytes
    )


def image_dimensions(data: bytes) -> tuple[int, int]:
    with Image.open(__import__("io").BytesIO(data)) as image:
        return image.size


def jpeg_derivative(basecolor: bytes, size: int) -> bytes:
    from io import BytesIO

    with Image.open(BytesIO(basecolor)) as image:
        image = image.convert("RGB")
        if image.size != (size, size):
            image = image.resize((size, size), Image.Resampling.LANCZOS)
        out = BytesIO()
        image.save(
            out,
            format="JPEG",
            quality=94,
            subsampling=0,
            optimize=False,
            progressive=False,
        )
        return out.getvalue()


def webp_derivative(portrait: bytes, size: int) -> bytes:
    from io import BytesIO

    with Image.open(BytesIO(portrait)) as image:
        image = image.convert("RGBA")
        if image.size != (size, size):
            image = image.resize((size, size), Image.Resampling.LANCZOS)
        out = BytesIO()
        image.save(out, format="WEBP", lossless=True, quality=100, method=6, exact=True)
        return out.getvalue()


def glb_summary(data: bytes) -> dict[str, Any]:
    doc, binary = parse_glb(data)
    image_index = basecolor_image_index(doc)
    texture_bytes = image_payload(doc, binary, image_index)
    dimensions = image_dimensions(texture_bytes)
    animation_accessors: set[int] = set()
    animation_views: set[int] = set()
    for animation in doc.get("animations", []):
        for sampler in animation.get("samplers", []):
            for key in ("input", "output"):
                accessor_index = sampler[key]
                animation_accessors.add(accessor_index)
                accessor = doc["accessors"][accessor_index]
                if "bufferView" in accessor:
                    animation_views.add(accessor["bufferView"])
                sparse = accessor.get("sparse", {})
                if sparse:
                    animation_views.add(sparse["indices"]["bufferView"])
                    animation_views.add(sparse["values"]["bufferView"])
    return {
        "bytes": len(data),
        "sha256": sha256(data),
        "triangles": count_triangles(doc),
        "skins": len(doc.get("skins", [])),
        "skin_joints": [len(skin.get("joints", [])) for skin in doc.get("skins", [])],
        "animations": [animation.get("name", "") for animation in doc.get("animations", [])],
        "animation_channels": sum(len(animation.get("channels", [])) for animation in doc.get("animations", [])),
        "animation_samplers": sum(len(animation.get("samplers", [])) for animation in doc.get("animations", [])),
        "animation_accessors": len(animation_accessors),
        "animation_buffer_bytes": sum(doc["bufferViews"][index]["byteLength"] for index in animation_views),
        "meshes": len(doc.get("meshes", [])),
        "materials": len(doc.get("materials", [])),
        "images": len(doc.get("images", [])),
        "textures": len(doc.get("textures", [])),
        "basecolor_dimensions": list(dimensions),
        "has_normal_map": any("normalTexture" in material for material in doc.get("materials", [])),
        "has_metallic_roughness_map": any(
            "metallicRoughnessTexture" in material.get("pbrMetallicRoughness", {})
            for material in doc.get("materials", [])
        ),
    }


def assert_geometry_skin_preserved(
    source_doc: dict[str, Any],
    source_binary: bytes,
    derived_doc: dict[str, Any],
    derived_binary: bytes,
) -> None:
    if source_doc.get("nodes") != derived_doc.get("nodes"):
        raise ValueError("derived GLB changed node hierarchy/transforms")
    if source_doc.get("skins") is None or derived_doc.get("skins") is None:
        raise ValueError("derived GLB lost the source skin")
    if len(source_doc["skins"]) != len(derived_doc["skins"]):
        raise ValueError("derived GLB changed skin count")
    source_accessors = source_doc.get("accessors", [])
    derived_accessors = derived_doc.get("accessors", [])
    source_views = source_doc.get("bufferViews", [])
    derived_views = derived_doc.get("bufferViews", [])
    for old_skin, new_skin in zip(source_doc["skins"], derived_doc["skins"]):
        for key in ("name", "joints", "skeleton"):
            if old_skin.get(key) != new_skin.get(key):
                raise ValueError(f"derived GLB changed skin {key}")
        if "inverseBindMatrices" in old_skin:
            old_ibm = source_accessors[old_skin["inverseBindMatrices"]]
            new_ibm = derived_accessors[new_skin["inverseBindMatrices"]]
            for key in ("count", "type", "componentType", "min", "max", "byteOffset"):
                if old_ibm.get(key) != new_ibm.get(key):
                    raise ValueError(f"derived GLB changed inverse bind accessor {key}")
            if view_bytes(source_doc, source_binary, old_ibm["bufferView"]) != view_bytes(
                derived_doc, derived_binary, new_ibm["bufferView"]
            ):
                raise ValueError("derived GLB changed inverse bind matrix bytes")
    if len(source_doc.get("meshes", [])) != len(derived_doc.get("meshes", [])):
        raise ValueError("derived GLB changed mesh count")
    for old_mesh, new_mesh in zip(source_doc.get("meshes", []), derived_doc.get("meshes", [])):
        if len(old_mesh.get("primitives", [])) != len(new_mesh.get("primitives", [])):
            raise ValueError("derived GLB changed primitive count")
        for old_prim, new_prim in zip(old_mesh["primitives"], new_mesh["primitives"]):
            if old_prim.get("attributes", {}).keys() != new_prim.get("attributes", {}).keys():
                raise ValueError("derived GLB changed mesh attributes")
            old_indices = dict(old_prim.get("attributes", {}))
            new_indices = dict(new_prim.get("attributes", {}))
            if "indices" in old_prim:
                old_indices["__indices__"] = old_prim["indices"]
                new_indices["__indices__"] = new_prim["indices"]
            for semantic, old_index in old_indices.items():
                if semantic not in new_indices:
                    raise ValueError(f"derived GLB lost accessor {semantic}")
                old_accessor = source_accessors[old_index]
                new_accessor = derived_accessors[new_indices[semantic]]
                for key in ("count", "type", "componentType", "min", "max", "normalized", "byteOffset"):
                    if old_accessor.get(key) != new_accessor.get(key):
                        raise ValueError(f"derived GLB changed {semantic} accessor {key}")
                for old_view_key, new_view_key in (("bufferView", "bufferView"),):
                    if (old_view_key in old_accessor) != (new_view_key in new_accessor):
                        raise ValueError(f"derived GLB changed {semantic} accessor view")
                    if old_view_key in old_accessor:
                        a = source_views[old_accessor[old_view_key]]
                        b = derived_views[new_accessor[new_view_key]]
                        if view_bytes(source_doc, source_binary, old_accessor[old_view_key]) != view_bytes(derived_doc, derived_binary, new_accessor[new_view_key]):
                            raise ValueError(f"derived GLB changed geometry/skin bytes for {semantic}")
                        if a.get("byteStride") != b.get("byteStride") or a.get("target") != b.get("target"):
                            raise ValueError(f"derived GLB changed buffer layout for {semantic}")
    if count_triangles(source_doc) != count_triangles(derived_doc):
        raise ValueError("derived GLB changed triangle count")


def assert_animation_preserved(
    source_doc: dict[str, Any],
    source_binary: bytes,
    derived_doc: dict[str, Any],
    derived_binary: bytes,
    animation_name: str,
) -> None:
    source_clips = [clip for clip in source_doc.get("animations", []) if clip.get("name") == animation_name]
    derived_clips = [clip for clip in derived_doc.get("animations", []) if clip.get("name") == animation_name]
    if len(source_clips) != 1 or len(derived_clips) != 1:
        raise ValueError(f"runtime GLB must retain exactly the source {animation_name} clip")
    before, after = source_clips[0], derived_clips[0]
    if before.get("channels") != after.get("channels"):
        raise ValueError(f"derived {animation_name} clip changed channels or joint targets")
    if len(before.get("samplers", [])) != len(after.get("samplers", [])):
        raise ValueError(f"derived {animation_name} clip changed sampler count")

    source_accessors = source_doc.get("accessors", [])
    derived_accessors = derived_doc.get("accessors", [])
    for index, (old_sampler, new_sampler) in enumerate(zip(before["samplers"], after["samplers"])):
        old_settings = {key: value for key, value in old_sampler.items() if key not in ("input", "output")}
        new_settings = {key: value for key, value in new_sampler.items() if key not in ("input", "output")}
        if old_settings != new_settings:
            raise ValueError(f"derived {animation_name} sampler {index} changed interpolation/settings")
        for key in ("input", "output"):
            old_index, new_index = old_sampler[key], new_sampler[key]
            old_accessor = source_accessors[old_index]
            new_accessor = derived_accessors[new_index]
            for field in ("count", "type", "componentType", "normalized", "byteOffset", "min", "max", "sparse"):
                if old_accessor.get(field) != new_accessor.get(field):
                    raise ValueError(f"derived {animation_name} sampler {index} {key} accessor changed {field}")
            if ("bufferView" in old_accessor) != ("bufferView" in new_accessor):
                raise ValueError(f"derived {animation_name} sampler {index} {key} accessor lost its bufferView")
            if "bufferView" in old_accessor:
                old_view_index, new_view_index = old_accessor["bufferView"], new_accessor["bufferView"]
                if view_bytes(source_doc, source_binary, old_view_index) != view_bytes(derived_doc, derived_binary, new_view_index):
                    raise ValueError(f"derived {animation_name} sampler {index} {key} bytes differ from source")
                old_view = source_doc["bufferViews"][old_view_index]
                new_view = derived_doc["bufferViews"][new_view_index]
                if old_view.get("byteStride") != new_view.get("byteStride") or old_view.get("target") != new_view.get("target"):
                    raise ValueError(f"derived {animation_name} sampler {index} {key} buffer layout changed")


def run(source_dir: Path) -> dict[str, Any]:
    source_dir = source_dir.resolve()
    glb_src = source_dir / SOURCE_GLB
    portrait_src = source_dir / SOURCE_PORTRAIT
    for path in (glb_src, portrait_src):
        if not path.is_file():
            raise FileNotFoundError(f"missing required source file: {path}")

    glb_original = preserve_original(glb_src, SOURCE_ROOT / SOURCE_GLB)
    portrait_original = preserve_original(portrait_src, SOURCE_ROOT / SOURCE_PORTRAIT)
    source_doc, source_binary = parse_glb(glb_original)
    source_triangles = count_triangles(source_doc)
    skin_joint_counts = [len(skin.get("joints", [])) for skin in source_doc.get("skins", [])]
    if source_triangles != EXPECTED_TRIANGLES:
        raise ValueError(f"source triangle invariant failed: expected {EXPECTED_TRIANGLES}, got {source_triangles}")
    if skin_joint_counts != [EXPECTED_SKIN_JOINTS]:
        raise ValueError(f"source skin invariant failed: expected one {EXPECTED_SKIN_JOINTS}-joint skin, got {skin_joint_counts}")
    source_clip_names = [clip.get("name") for clip in source_doc.get("animations", [])]
    for animation_name in ("idle", "swim", "hit_to_body_01"):
        if source_clip_names.count(animation_name) != 1:
            raise ValueError(f"expected exactly one source {animation_name} clip")

    source_basecolor_index = basecolor_image_index(source_doc)
    basecolor = image_payload(source_doc, source_binary, source_basecolor_index)
    source_basecolor_dimensions = list(image_dimensions(basecolor))
    if source_basecolor_dimensions != [2048, 2048]:
        raise ValueError(f"expected 2048x2048 basecolor, got {source_basecolor_dimensions}")
    portrait_dimensions = list(image_dimensions(portrait_original))
    if portrait_dimensions != [1600, 1600]:
        raise ValueError(f"expected 1600x1600 portrait, got {portrait_dimensions}")

    outputs: dict[str, bytes] = {}
    for tier, size in (("desktop", 1024), ("mobile", 512)):
        jpeg = jpeg_derivative(basecolor, size)
        name = f"buccaneer-v1-basecolor-{tier}"
        outputs[f"assets/models/buccaneer-v1-{tier}.glb"] = compact_glb(source_doc, source_binary, jpeg, name)
    for tier, size in (("desktop", 512), ("mobile", 256)):
        outputs[f"assets/ui/portraits/buccaneer-v1-{tier}.webp"] = webp_derivative(portrait_original, size)

    output_records: dict[str, Any] = {}
    for relative, data in sorted(outputs.items()):
        destination = REPO_ROOT / relative
        if not destination.is_file() or destination.read_bytes() != data:
            atomic_write(destination, data)
        if destination.read_bytes() != data:
            raise ValueError(f"output read-back mismatch: {relative}")
        if relative.endswith(".glb"):
            summary = glb_summary(data)
            derived_doc, derived_binary = parse_glb(data)
            assert_geometry_skin_preserved(source_doc, source_binary, derived_doc, derived_binary)
            for animation_name in ("idle", "swim", "hit_to_body_01"):
                assert_animation_preserved(source_doc, source_binary, derived_doc, derived_binary, animation_name)
            if summary["triangles"] != EXPECTED_TRIANGLES or summary["skin_joints"] != [EXPECTED_SKIN_JOINTS]:
                raise ValueError(f"derived geometry/skin invariant failed: {relative}")
            if summary["animations"] != ["idle", "swim", "hit_to_body_01"] or summary["has_normal_map"] or summary["has_metallic_roughness_map"]:
                raise ValueError(f"runtime GLB is missing idle/swim/hit or retained unused PBR bindings: {relative}")
        else:
            from io import BytesIO

            with Image.open(destination) as image:
                expected = (512, 512) if "desktop" in relative else (256, 256)
                if image.size != expected or image.mode != "RGBA":
                    raise ValueError(f"portrait dimensions/mode invariant failed: {relative}")
                actual_pixels = image.tobytes()
            with Image.open(BytesIO(portrait_original)) as source_image:
                expected_image = source_image.convert("RGBA").resize(expected, Image.Resampling.LANCZOS)
                if actual_pixels != expected_image.tobytes():
                    raise ValueError(f"portrait WebP changed pixels beyond the documented resize: {relative}")
                summary = {
                    "bytes": len(data),
                    "sha256": sha256(data),
                    "dimensions": list(image.size),
                    "mode": image.mode,
                    "format": image.format,
                    "lossless": True,
                }
        output_records[relative.replace("\\", "/")] = summary

    originals = {
        f"docs/art/source/buccaneer-v1/{SOURCE_GLB}": {
            "bytes": len(glb_original),
            "sha256": sha256(glb_original),
            "source_filename": SOURCE_GLB,
            "triangles": source_triangles,
            "skins": len(source_doc.get("skins", [])),
            "skin_joints": skin_joint_counts,
            "animation_names": [a.get("name", "") for a in source_doc.get("animations", [])],
            "basecolor_dimensions": source_basecolor_dimensions,
        },
        f"docs/art/source/buccaneer-v1/{SOURCE_PORTRAIT}": {
            "bytes": len(portrait_original),
            "sha256": sha256(portrait_original),
            "source_filename": SOURCE_PORTRAIT,
            "dimensions": portrait_dimensions,
            "mode": "RGBA",
        },
    }
    evidence = {
        "schema_version": 1,
        "asset_id": "buccaneer-v1",
        "tool": {
            "path": "tools/buccaneer-character/prepare.py",
            "version": 1,
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "pillow": PILLOW_VERSION,
            "jpeg_codec": getattr(Image.core, "jpeglib_version", "unknown"),
        },
        "transformations": {
            "glb": "preserve nodes, mesh, positions, indices, normals, UVs, skin weights, joints and inverse bind matrices; retain source idle, swim and hit_to_body_01 animations with original accessors and key bytes; remove run, normal map and metallic-roughness map; embed resized basecolor only",
            "basecolor": {"desktop_px": 1024, "mobile_px": 512, "format": "JPEG", "quality": 94, "subsampling": 0, "resize": "Pillow LANCZOS"},
            "portrait": {"desktop_px": 512, "mobile_px": 256, "format": "WebP", "lossless": True, "mode": "RGBA", "resize": "Pillow LANCZOS", "crop": False, "magenta_removed": False},
        },
        "invariants": {
            "triangles": EXPECTED_TRIANGLES,
            "skins": 1,
            "skin_joints": EXPECTED_SKIN_JOINTS,
            "source_animations_preserved_in_original": True,
            "runtime_animations": 3,
            "runtime_animation_names": ["idle", "swim", "hit_to_body_01"],
            "runtime_normal_map": False,
            "runtime_metallic_roughness_map": False,
        },
        "originals": originals,
        "derived": output_records,
    }
    evidence_bytes = (json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    atomic_write(EVIDENCE_PATH, evidence_bytes)
    if EVIDENCE_PATH.read_bytes() != evidence_bytes:
        raise ValueError("evidence read-back mismatch")
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=SOURCE_ROOT,
        help=f"directory containing {SOURCE_GLB} and {SOURCE_PORTRAIT} (default: preserved originals)",
    )
    args = parser.parse_args()
    try:
        evidence = run(args.source_dir)
    except Exception as exc:  # Keep a useful CLI error without a traceback for expected packaging failures.
        print(f"prepare.py: error: {exc}", file=sys.stderr)
        return 1
    print(f"Prepared {len(evidence['derived'])} derivatives; source triangles={EXPECTED_TRIANGLES}, skin joints={EXPECTED_SKIN_JOINTS}.")
    for path, info in evidence["derived"].items():
        print(f"{path}: {info['bytes']} bytes sha256={info['sha256']}")
    print(f"docs/art/buccaneer-v1/asset-evidence.json: {EVIDENCE_PATH.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
