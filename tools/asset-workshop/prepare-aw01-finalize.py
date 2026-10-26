"""Build the publishable AW01 manifest and private delivery receipt from UE output."""
import hashlib
import json
import pathlib
import struct
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
STAGE = pathlib.Path(r"C:\DEV\real of trade\asset-workshop-preparation")
GAME = pathlib.Path(r"C:\Unreal\survival project\SimpleMultiplayerSurvival\Content")
OUT = REPO / "assets" / "workshop"
DOCS = REPO / "docs" / "delivery" / "asset-workshop"

def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def glb_info(path):
    b = path.read_bytes()
    if b[:4] != b"glTF":
        raise ValueError(f"invalid GLB header: {path}")
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl])
    image_dims = []
    for image in g.get("images", []):
        dims = None
        if image.get("bufferView") is not None:
            bv = g["bufferViews"][image["bufferView"]]
            start = 20 + jl + 8 + bv.get("byteOffset", 0)
            blob = b[start:start + bv["byteLength"]]
            if blob.startswith(b"\x89PNG\r\n\x1a\n") and len(blob) >= 24:
                dims = list(struct.unpack_from(">II", blob, 16))
            elif blob.startswith(b"\xff\xd8"):
                i = 2
                while i + 9 < len(blob):
                    if blob[i] != 0xff:
                        i += 1
                        continue
                    marker = blob[i + 1]
                    length = int.from_bytes(blob[i + 2:i + 4], "big")
                    if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        dims = [int.from_bytes(blob[i + 7:i + 9], "big"), int.from_bytes(blob[i + 5:i + 7], "big")]
                        break
                    i += 2 + max(length, 2)
        image_dims.append(dims)
    triangles = 0
    for mesh in g.get("meshes", []):
        for prim in mesh.get("primitives", []):
            accessor = g["accessors"][prim["indices"]] if "indices" in prim else g["accessors"][prim["attributes"]["POSITION"]]
            count = accessor["count"]
            triangles += count // 3 if prim.get("mode", 4) == 4 else 0
    return g, {"triangles": triangles, "materials": len(g.get("materials", [])), "textures": len(g.get("textures", [])), "imageDimensions": image_dims}

def file_ref(rel):
    path = REPO / pathlib.Path(*rel.split("/"))
    if not path.is_file():
        raise FileNotFoundError(path)
    return {"url": rel, "bytes": path.stat().st_size, "sha256": sha(path)}, path

def add_preview(entry, preview):
    if not preview:
        return
    for density in ("desktop", "mobile"):
        item = preview.get(density)
        if item:
            if item["url"].startswith("asset-workshop/"):
                item["url"] = item["url"][len("asset-workshop/"):]
            ref, _ = file_ref(item["url"])
            item.update(ref)

def main():
    old = json.loads((STAGE / "aw01-output.json").read_text(encoding="utf-8"))
    catalog = json.loads((OUT / "catalog.json").read_text(encoding="utf-8"))
    catalog_by_id = {x["id"]: x for x in catalog["entries"]}
    dependency_report = json.loads((STAGE / "aw01-dependencies.json").read_text(encoding="utf-8"))
    graph = dependency_report["dependencyGraph"]
    staged_receipt = []
    package_records = {}
    for package in dependency_report["gamePackages"]:
        rel = package.removeprefix("/Game/").replace("/", "\\") + ".uasset"
        source, staged = GAME / rel, STAGE / "Content" / rel
        if not source.is_file() or not staged.is_file():
            raise FileNotFoundError(f"dependency missing source/staged: {package}")
        before, after = sha(source), sha(staged)
        if before != after:
            raise ValueError(f"source/staging hash mismatch: {package}")
        record = {"package": package, "source": str(source), "staged": str(staged), "bytes": source.stat().st_size, "sha256": before, "sourceHashAfter": sha(source)}
        staged_receipt.append(record)
        package_records[package] = record
        for suffix in (".uexp", ".ubulk"):
            src_side = source.with_suffix(suffix)
            stage_side = staged.with_suffix(suffix)
            if src_side.is_file():
                if not stage_side.is_file() or sha(src_side) != sha(stage_side):
                    raise ValueError(f"dependency sidecar copy mismatch: {package}{suffix}")
                staged_receipt.append({"package": package + suffix, "source": str(src_side), "staged": str(stage_side), "bytes": src_side.stat().st_size, "sha256": sha(src_side), "sourceHashAfter": sha(src_side)})
    registry_ref = pathlib.Path(r"C:\Unreal\survival project\SimpleMultiplayerSurvival\Intermediate\CachedAssetRegistry\CachedAssetRegistry_0.ref")
    registry_name = registry_ref.read_text(encoding="utf-8").strip()
    registry_pairs = [(registry_ref, STAGE / "Intermediate" / "CachedAssetRegistry" / registry_ref.name), (registry_ref.parent / registry_name, STAGE / "Intermediate" / "CachedAssetRegistry" / registry_name), (registry_ref.parent.parent / "CachedAssetRegistryDiscovery.bin", STAGE / "Intermediate" / "CachedAssetRegistryDiscovery.bin")]
    for source, staged in registry_pairs:
        if not source.is_file() or not staged.is_file() or sha(source) != sha(staged):
            raise ValueError(f"Asset Registry cache copy mismatch: {source}")
        staged_receipt.append({"package": "asset-registry-cache", "source": str(source), "staged": str(staged), "bytes": source.stat().st_size, "sha256": sha(source), "sourceHashAfter": sha(source)})

    roots = {
        "aw-pilot-01": ["/Game/AdvancedVillagePack/Meshes/SM_Cauldron"],
        "aw-pilot-02": ["/Game/RPGEnvironmentVFX/Essentials/Mesh/Mesh/SM_DemoCauldron"],
        "aw-pilot-03": ["/Game/UltimateFarming/Meshes/SM_Cotton_A", "/Game/UltimateFarming/Meshes/SM_Cotton_A_Harvested"],
        "aw-pilot-04": ["/Game/PN_Banana/Meshes/plants/banana_01_01"],
        "aw-pilot-05": ["/Game/Kobo_Nature/Meshes/SM-Palm/SM-Palm-01"],
        "aw-pilot-06": ["/Game/Greek_island/Assets/Houses/SM_door_01"],
        "aw-pilot-07": ["/Game/Greek_island/Assets/Boat/SM_Boat_01"],
        "aw-pilot-08": ["/Game/Bazaar_Meshingun/Environment/Assets/Material/Tileable/MI_Trimsheet_Wood_01a"],
        "aw-pilot-09": ["/Game/Bazaar_Meshingun/Environment/Assets/Material/Prop/MI_Metalware_01a"],
        "aw-pilot-10": ["/Game/UltimateFarming/Materials/MasterMaterials/M_Glass"],
    }
    entries = []
    # Root package refs for external Fab files and directly copied non-UE image/icon sources.
    external = {
        "aw-pilot-11": ("FANTASTIC_-_Village_Pack-52529a12/fbx/fbx_and_textures_fantast_extracted/2d/textures/T_leather.png", pathlib.Path(r"C:\ProgramData\Epic\EpicGamesLauncher\VaultCache\FabLibrary\FANTASTIC_-_Village_Pack-52529a12\fbx\fbx_and_textures_fantast_extracted\2d\textures\T_leather.png")),
        "aw-pilot-12": ("FANTASTIC_-_Village_Pack-52529a12/fbx/fbx_and_textures_fantast_extracted/3d/buildings/SM_BLD_balcony_v01_01.fbx", pathlib.Path(r"C:\ProgramData\Epic\EpicGamesLauncher\VaultCache\FabLibrary\FANTASTIC_-_Village_Pack-52529a12\fbx\fbx_and_textures_fantast_extracted\3d\buildings\SM_BLD_balcony_v01_01.fbx")),
        "aw-pilot-19": ("CraftResourcesIcons/Textures/Tex_leather_01.png", GAME / r"CraftResourcesIcons\Textures\Tex_leather_01.png"),
    }
    for e in old["entries"]:
        catalog_entry = catalog_by_id[e["id"]]
        out = {"id": e["id"], "technicalType": e["technicalType"], "preview": e.get("preview"), "metrics": dict(e.get("metrics") or {}), "limitations": list(e.get("limitations") or []), "catalogSourceRevision": catalog_entry["sourceRevision"], "sourcePaths": catalog_entry["source"]["paths"]}
        if e.get("variants"):
            out["variants"] = [{"id": v["id"], "label": v.get("label", v["id"]), "preview": v.get("preview"), "metrics": dict(v.get("metrics") or {})} for v in e["variants"]]
        package_set = set()
        for root in roots.get(e["id"], []):
            pending, seen = [root], set()
            while pending:
                node = pending.pop()
                if node in seen: continue
                seen.add(node); package_set.add(node)
                pending.extend(x for x in graph.get(node, []) if x.startswith("/Game/"))
        srcs = [{"package": p.removeprefix("/Game/") + ".uasset", "sha256": package_records[p]["sha256"]} for p in sorted(package_set) if p in package_records]
        if e["id"] in external:
            pkg, src = external[e["id"]]
            src_hash = sha(src)
            staged = STAGE / "Content" / "AW01Imports" / src.name
            if not staged.is_file() or src_hash != sha(staged):
                raise ValueError(f"external candidate copy mismatch: {src}")
            srcs.append({"package": pkg, "sha256": src_hash})
            staged_receipt.append({"package": pkg, "source": str(src), "staged": str(staged), "bytes": src.stat().st_size, "sha256": src_hash, "sourceHashAfter": sha(src)})
        out["sources"] = srcs
        rev = "\n".join(f"{s['package']}:{s['sha256']}" for s in sorted(srcs, key=lambda x:x["package"]))
        out["sourceRevision"] = hashlib.sha256(rev.encode()).hexdigest()
        if out["preview"]:
            add_preview(out, out["preview"])
            # Determine whether a model has usable embedded images; a 1x1 baked image signals unresolved source textures.
            target_preview = out["preview"]
            if target_preview["kind"] == "model":
                model_path = REPO / pathlib.Path(*target_preview["desktop"]["url"].split("/"))
                gltf, actual = glb_info(model_path)
                out["metrics"].update({k:v for k,v in actual.items() if k != "imageDimensions"})
                dims = [x for x in actual["imageDimensions"] if x]
                out["metrics"]["textureDimensions"] = dims
                bad = any(w <= 1 or h <= 1 for w,h in dims)
                if bad:
                    out["status"] = "prepared"
                    out["limitations"].append("La geometría proviene de la fuente y el GLB es autónomo, pero el horneado de materiales de UE solo contiene imágenes de marcador de 1×1; úsalo únicamente para revisar geometría o retexturizar, no para aprobar su apariencia.")
                elif not dims and out["technicalType"] == "static-mesh":
                    out["status"] = "prepared"
                    out["limitations"].append("El GLB de geometría derivada de la fuente no incluye imágenes de textura; no se validaron por separado las constantes ni la apariencia del material. Úsalo únicamente para revisar geometría.")
                else:
                    out["status"] = "prepared"
                    if out["id"] == "aw-pilot-12":
                        out["limitations"].append("El FBX de Fab importa seis ranuras de material, pero ninguna imagen de textura; solo se representa la apariencia de las ranuras importadas.")
            else:
                out["status"] = "prepared"
        if out.get("variants"):
            out["limitations"].append("La ficha agrupa las variantes de algodón intacto y cosechado; revisa la limitación de material indicada en cada variante.")
            variant_ready = True
            for variant in out["variants"]:
                vpreview = variant.get("preview")
                if not vpreview:
                    variant_ready = False
                    continue
                add_preview(out, vpreview)
                model_path = REPO / pathlib.Path(*vpreview["desktop"]["url"].split("/"))
                _, actual = glb_info(model_path)
                variant["metrics"].update({k:v for k,v in actual.items() if k != "imageDimensions"})
                variant["metrics"]["textureDimensions"] = [x for x in actual["imageDimensions"] if x]
                dims = variant["metrics"]["textureDimensions"]
                if any(w <= 1 or h <= 1 for w,h in dims) or not dims:
                    variant["status"] = "prepared"
                    variant["limitations"] = ["La geometría proviene de la fuente y el GLB es autónomo; la apariencia del material de origen está incompleta porque UE exportó imágenes de marcador de 1×1. Úsalo únicamente para revisar geometría o retexturizar."]
                else:
                    variant["status"] = "prepared"
            out["status"] = "prepared"
        elif not out.get("preview") and not out.get("variants"):
            out["status"] = "pending"
            out["reason"] = "La gráfica de material de origen no produjo una muestra verificable en el exportador UE aislado; no se creó un material sustituto."
            if out["technicalType"] == "material":
                out["limitations"] = ["La muestra visual del material sigue pendiente; esta ficha conserva los paquetes fuente y sus hashes de dependencias."]
        entries.append(out)

    # Record candidate hashes again after all reads, including root package and sidecars.
    for rec in staged_receipt:
        rec["sourceHashAfter"] = sha(pathlib.Path(rec["source"]))
        if rec["sourceHashAfter"] != rec["sha256"]:
            raise ValueError(f"source changed during preparation: {rec['source']}")
    recipe_inputs = [pathlib.Path(__file__).with_name(x) for x in ("prepare-aw01.ps1", "ue-aw01.py", "prepare-aw01-finalize.py", "prepare-aw01-verify.py")]
    recipe_material = "\n".join(sha(x) for x in recipe_inputs)
    recipe_sha = hashlib.sha256(recipe_material.encode()).hexdigest()
    receipt = {"schema": "marea.asset-preparation-receipt.v1", "stage": str(STAGE), "engine": "UE 5.8", "generatedAtUtc": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(), "dependencyPackages": len(dependency_report["gamePackages"]), "sources": staged_receipt, "commandlet": {"exitCode": 0, "phases": ["discover", "export"], "renderer": "D3D12 hardware; -AllowCommandletRendering"}, "recipeSha256": recipe_sha}
    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / "preparation-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    publishable = {"schema": "marea.asset-prepared.v1", "revision": "aw01-preparation-v1", "engine": "UE 5.8", "entries": entries}
    (OUT / "prepared.json").write_text(json.dumps(publishable, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(entries)} entries; {sum(x['status']=='prepared' for x in entries)} ready, {sum(x['status']=='pending' for x in entries)} pending; {len(staged_receipt)} source/dependency receipts.")

if __name__ == "__main__":
    main()
