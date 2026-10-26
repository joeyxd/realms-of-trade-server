"""Verify AW01 catalog bindings, exported file hashes, GLB embedding, and source immutability."""
import hashlib
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "assets" / "workshop" / "prepared.json"
CATALOG = ROOT / "assets" / "workshop" / "catalog.json"
RECEIPT = ROOT / "docs" / "delivery" / "asset-workshop" / "preparation-receipt.json"

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def glb(path):
    data = path.read_bytes()
    assert data[:4] == b"glTF" and struct.unpack_from("<I", data, 4)[0] == 2, f"bad GLB header: {path}"
    length = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + length])
    assert len(data) == struct.unpack_from("<I", data, 8)[0], f"GLB length mismatch: {path}"
    assert not doc.get("buffers") or all(b.get("uri") is None for b in doc["buffers"]), f"external buffer URI: {path}"
    assert all(i.get("uri") is None for i in doc.get("images", [])), f"external image URI: {path}"
    dims = []
    for image in doc.get("images", []):
        assert image.get("bufferView") is not None, f"image not embedded: {path}"
        view = doc["bufferViews"][image["bufferView"]]
        start = 20 + length + 8 + view.get("byteOffset", 0)
        blob = data[start:start + view["byteLength"]]
        if blob.startswith(b"\x89PNG\r\n\x1a\n"):
            dims.append(struct.unpack_from(">II", blob, 16))
    return doc, dims

def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    receipt = json.loads(RECEIPT.read_text(encoding="utf-8"))
    assert manifest["schema"] == "marea.asset-prepared.v1"
    assert set(manifest) == {"schema", "revision", "engine", "entries"}, "publishable manifest contains private receipt fields"
    catalog_by_id = {x["id"]: x for x in catalog["entries"]}
    ids = set()
    outputs = 0
    for entry in manifest["entries"]:
        assert entry["id"] not in ids, f"duplicate id: {entry['id']}"
        ids.add(entry["id"])
        source = catalog_by_id[entry["id"]]
        assert entry["catalogSourceRevision"] == source["sourceRevision"]
        assert entry["sourcePaths"] == source["source"]["paths"]
        revision = "\n".join(f"{x['package']}:{x['sha256']}" for x in sorted(entry["sources"], key=lambda x:x["package"]))
        assert hashlib.sha256(revision.encode()).hexdigest() == entry["sourceRevision"], f"source revision mismatch: {entry['id']}"
        variants = entry.get("variants", [])
        previews = ([entry["preview"]] if entry.get("preview") else []) + [x["preview"] for x in variants if x.get("preview")]
        for preview in previews:
            for density in ("desktop", "mobile"):
                ref = preview[density]
                path = ROOT / pathlib.Path(*ref["url"].split("/"))
                assert path.is_file() and path.stat().st_size == ref["bytes"] and sha(path) == ref["sha256"], f"output hash mismatch: {path}"
                outputs += 1
                if path.suffix == ".glb":
                    _, dims = glb(path)
                    max_dim = 512 if density == "mobile" else 1024
                    assert all(w <= max_dim and h <= max_dim for w, h in dims), f"{density} texture exceeds {max_dim}px: {path} {dims}"
                elif path.suffix == ".png":
                    data = path.read_bytes()
                    assert data.startswith(b"\x89PNG\r\n\x1a\n"), f"invalid PNG: {path}"
                    w, h = struct.unpack_from(">II", data, 16)
                    assert max(w,h) <= (512 if density == "mobile" else 1024), f"PNG dimensions exceed {density} target: {path}"
    for record in receipt["sources"]:
        source_path, staged_path = pathlib.Path(record["source"]), pathlib.Path(record["staged"])
        assert source_path.is_file() and staged_path.is_file(), f"source/staging record missing: {record['package']}"
        assert sha(source_path) == record["sha256"] == record["sourceHashAfter"] == sha(staged_path), f"source changed or staged copy mismatch: {record['package']}"
    assert ids == set(catalog_by_id[x]["id"] for x in ids)
    print(f"AW01 verified: {len(ids)} rows, {outputs} desktop/mobile files, {len(receipt['sources'])} immutable source/staging records.")

if __name__ == "__main__":
    main()
