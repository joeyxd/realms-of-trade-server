"""Prepare AW01 samples using only the isolated Unreal project copy."""
import hashlib
import json
import os
import struct
import traceback

import unreal


def text(value):
    try:
        return str(value)
    except Exception:
        return repr(value)


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inspect_glb(path):
    with open(path, "rb") as stream:
        header = stream.read(12)
        if len(header) != 12:
            raise RuntimeError("Truncated GLB header")
        magic, version, total = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2 or total != os.path.getsize(path):
            raise RuntimeError("Invalid GLB 2.0 container")
        document = None
        while stream.tell() < total:
            size, kind = struct.unpack("<I4s", stream.read(8))
            chunk = stream.read(size)
            if len(chunk) != size:
                raise RuntimeError("Truncated GLB chunk")
            if kind == b"JSON":
                document = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
    if document is None:
        raise RuntimeError("GLB has no JSON document")
    accessors = document.get("accessors", [])
    triangles = 0
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            index = primitive.get("indices")
            count = accessors[index].get("count", 0) if index is not None else 0
            triangles += count // 3
    textures = []
    for texture in document.get("textures", []):
        textures.append(texture)
    return {"triangles": triangles, "materials": len(document.get("materials", [])), "textures": len(textures)}


def package_object(package):
    if package.lower().endswith(".uasset"):
        package = package[:-7]
    path = "/Game/" + package.replace("\\", "/")
    return path + "." + path.rsplit("/", 1)[-1]


def export_glb(mesh, destination, size):
    options = unreal.GLTFExportOptions()
    options.set_editor_property("export_uniform_scale", 0.01)
    options.set_editor_property("default_level_of_detail", 0)
    options.set_editor_property("export_vertex_colors", True)
    options.set_editor_property("texture_image_format", unreal.GLTFTextureImageFormat.PNG)
    bake_type = getattr(unreal, "GLTFMaterialBakeMode", None)
    available = [name for name in dir(bake_type) if name.isupper()] if bake_type else []
    bake_choice = next((name for name in ("USE_MESH_DATA", "USEMESHDATA", "SIMPLE") if name in available), None)
    if bake_choice:
        options.set_editor_property("bake_material_inputs", getattr(bake_type, bake_choice))
        bake_size_type = getattr(unreal, "GLTFMaterialBakeSize", None)
        if bake_size_type:
            bake_size = bake_size_type()
            bake_size.set_editor_property("x", size)
            bake_size.set_editor_property("y", size)
            bake_size.set_editor_property("auto_detect", False)
            options.set_editor_property("default_material_bake_size", bake_size)
    task = unreal.AssetExportTask()
    task.set_editor_property("object", mesh)
    task.set_editor_property("filename", destination)
    task.set_editor_property("options", options)
    task.set_editor_property("prompt", False)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_identical", True)
    if not unreal.Exporter.run_asset_export_task(task) or not os.path.isfile(destination):
        raise RuntimeError("glTF export failed: " + "; ".join(text(x) for x in task.get_editor_property("errors")))
    inspected = inspect_glb(destination)
    inspected["bakeMode"] = bake_choice or "disabled"
    return inspected


def import_fbx(source, destination_path):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", source)
    task.set_editor_property("destination_path", destination_path)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    options = unreal.FbxImportUI()
    options.set_editor_property("import_mesh", True)
    options.set_editor_property("import_as_skeletal", False)
    options.set_editor_property("import_materials", True)
    options.set_editor_property("import_textures", True)
    task.set_editor_property("options", options)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    paths = task.get_editor_property("imported_object_paths")
    for object_path in paths:
        candidate = unreal.load_asset(text(object_path))
        if isinstance(candidate, unreal.StaticMesh):
            return candidate
    raise RuntimeError("FBX import produced no StaticMesh: " + source)


def copy_image(source, destination, max_edge=None):
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    if max_edge is None:
        import shutil
        shutil.copyfile(source, destination)
    else:
        from PIL import Image
        with Image.open(source) as image:
            image = image.convert("RGBA")
            image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            image.save(destination, format="WEBP", quality=88, method=6)
    return {
        "url": os.path.relpath(destination, os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))).replace(os.sep, "/"),
        "bytes": os.path.getsize(destination), "sha256": sha256(destination),
    }


def file_preview(path):
    return {"bytes": os.path.getsize(path), "sha256": sha256(path)}


def main():
    stage = os.path.realpath(os.environ["AW01_STAGE"])
    output = os.path.realpath(os.environ["AW01_OUT"])
    if os.path.commonpath((stage, output)).lower() == stage.lower():
        raise RuntimeError("Public output directory must remain outside the isolated project")
    if os.path.realpath(unreal.Paths.project_dir()).startswith(os.path.realpath(r"C:\Unreal").lower()):
        raise RuntimeError("Refusing to run within the original Unreal source tree")
    with open(os.path.join(stage, "aw01-input.json"), "r", encoding="utf-8") as stream:
        source = json.load(stream)
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    if os.environ.get("AW01_PHASE", "export") == "discover":
        options = unreal.AssetRegistryDependencyOptions()
        for prop in ("include_hard_package_references", "include_soft_package_references", "include_game_package_references", "include_editor_only_package_references"):
            try:
                options.set_editor_property(prop, True)
            except Exception:
                pass
        roots = set()
        for candidate in source["candidates"]:
            if candidate["kind"] in ("static-mesh", "material") and candidate["package"].lower().endswith(".uasset"):
                roots.add("/Game/" + candidate["package"][:-7].replace("\\", "/"))
            for variant in candidate.get("variants", []):
                if variant.get("package", "").lower().endswith(".uasset"):
                    roots.add("/Game/" + variant["package"][:-7].replace("\\", "/"))
        pending = list(sorted(roots))
        visited = set()
        graph = {}
        while pending:
            package = pending.pop()
            if package in visited:
                continue
            visited.add(package)
            dependencies = sorted(text(x) for x in registry.get_dependencies(package, options))
            graph[package] = dependencies
            pending.extend(x for x in dependencies if x.startswith("/Game/") and x not in visited)
        packages = sorted(x for x in visited if x.startswith("/Game/"))
        report = {"roots": sorted(roots), "gamePackages": packages, "dependencyGraph": graph}
        path = os.path.join(stage, "aw01-dependencies.json")
        with open(path, "w", encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        unreal.log("AW01_DEPENDENCIES=" + path + " packages=" + str(len(packages)))
        return
    entries = {}
    for candidate in source["candidates"]:
        entries.setdefault(candidate["id"], {
            "id": candidate["id"], "technicalType": "static-mesh" if candidate["kind"] == "static-mesh" else candidate["kind"],
            "preview": None, "metrics": {}, "limitations": [], "sources": [],
        })

    import_candidate = next((x for x in source["candidates"] if x["id"] == "aw-pilot-12"), None)
    if import_candidate:
        fbx_files = [x for x in os.listdir(os.path.join(stage, "Content", "AW01Imports")) if x.lower().endswith(".fbx")]
        if fbx_files:
            try:
                mesh = import_fbx(os.path.join(stage, "Content", "AW01Imports", fbx_files[0]), "/Game/AW01Imports")
                entries["aw-pilot-12"]["_mesh"] = mesh
            except Exception as error:
                entries["aw-pilot-12"]["status"] = "pending"
                entries["aw-pilot-12"]["reason"] = "Source FBX import failed in isolated staging: " + text(error)

    for candidate in source["candidates"]:
        identifier = candidate["id"]
        entry = entries[identifier]
        if candidate["kind"] == "static-mesh":
            if identifier == "aw-pilot-03" and not candidate.get("variants"):
                continue
            if identifier == "aw-pilot-12":
                mesh = entry.pop("_mesh", None)
                label = "default"
            else:
                mesh = unreal.load_asset(package_object(candidate["package"]))
                label = (candidate.get("variants") or [{"id": "default"}])[0]["id"]
            if not isinstance(mesh, unreal.StaticMesh):
                entry["status"] = "pending"
                entry["reason"] = "UE staging could not resolve the original StaticMesh and its dependencies."
                entry["limitations"].append("No substitute geometry was created.")
                continue
            for variant in (candidate.get("variants") or [{"id": label, "label": label}]):
                if candidate["id"] == "aw-pilot-03" and variant["id"] == "harvested":
                    mesh = unreal.load_asset(package_object(variant["package"]))
                    if not isinstance(mesh, unreal.StaticMesh):
                        continue
                variant_id = variant["id"]
                base = os.path.join(output, identifier, variant_id) if identifier == "aw-pilot-03" else os.path.join(output, identifier)
                os.makedirs(base, exist_ok=True)
                previews = {}
                desktop_metrics = None
                export_error = None
                for size in (1024, 512):
                    directory = "desktop" if size == 1024 else "mobile"
                    target = os.path.join(base, directory + ".glb")
                    try:
                        metrics = export_glb(mesh, target, size)
                    except Exception as error:
                        export_error = error
                        break
                    preview = {"url": os.path.relpath(target, os.path.dirname(os.path.dirname(os.path.dirname(output)))).replace(os.sep, "/"), "bytes": os.path.getsize(target), "sha256": sha256(target)}
                    previews[directory] = preview
                    if size == 1024:
                        desktop_metrics = metrics
                if export_error:
                    entry["status"] = "pending"
                    entry["reason"] = "UE glTF export failed for source mesh: " + text(export_error)
                    entry["limitations"].append("No substitute geometry was created; other AW01 candidates continue independently.")
                    continue
                if identifier == "aw-pilot-03":
                    entry.setdefault("variants", []).append({"id": variant_id, "label": variant.get("label", variant_id), "preview": {"kind": "model", "desktop": previews["desktop"], "mobile": previews["mobile"]}, "metrics": desktop_metrics})
                else:
                    entry["preview"] = {"kind": "model", "desktop": previews["desktop"], "mobile": previews["mobile"]}
                    entry["metrics"].update(desktop_metrics or {})
            entry["status"] = "prepared" if entry.get("preview") or entry.get("variants") else "pending"
            entry["sources"].append({"package": candidate["package"]})
        elif candidate["kind"] in ("texture", "icon"):
            rel = candidate["package"].split("/")[-1]
            source_path = os.path.join(stage, "Content", "AW01Imports", rel)
            if not os.path.isfile(source_path):
                source_path = os.path.join(stage, "Content", *candidate["package"].split("/"))
            if not os.path.isfile(source_path):
                entry["status"] = "pending"
                entry["reason"] = "Imported image source was not staged."
                continue
            base = os.path.join(output, identifier)
            desktop = os.path.join(base, "desktop.png")
            mobile = os.path.join(base, "mobile.png")
            os.makedirs(base, exist_ok=True)
            with open(source_path, "rb") as image_stream:
                header = image_stream.read(24)
            if header[:8] != b"\x89PNG\r\n\x1a\n":
                raise RuntimeError("Only PNG input is supported for the AW01 source image: " + source_path)
            dims = list(struct.unpack(">II", header[16:24]))
            mobile_source = os.path.join(output, identifier, "mobile.png")
            if not os.path.isfile(mobile_source):
                raise RuntimeError("The 512px mobile PNG was not created by the host preparation wrapper: " + mobile_source)
            import shutil
            shutil.copyfile(source_path, desktop)
            if os.path.normcase(os.path.realpath(mobile_source)) != os.path.normcase(os.path.realpath(mobile)):
                shutil.copyfile(mobile_source, mobile)
            entry["technicalType"] = "texture" if candidate["kind"] == "texture" else "icon"
            entry["preview"] = {"kind": "texture", "desktop": {"url": os.path.relpath(desktop, os.path.dirname(os.path.dirname(os.path.dirname(output)))).replace(os.sep, "/"), **file_preview(desktop)}, "mobile": {"url": os.path.relpath(mobile, os.path.dirname(os.path.dirname(os.path.dirname(output)))).replace(os.sep, "/"), **file_preview(mobile)}}
            entry["metrics"]["textureDimensions"] = dims
            entry["status"] = "prepared"
            entry["sources"].append({"package": candidate["package"]})
        elif candidate["kind"] == "material":
            entry["status"] = "pending"
            entry["reason"] = "Source material and dependency closure are not yet confirmed in the isolated stage; no swatch was synthesized."
            entry["limitations"].append("Material preview requires a successful UE material bake using the resolved original graph.")
            entry["sources"].append({"package": candidate["package"]})

    report = {"schema": "marea.asset-prepared.v1", "entries": list(entries.values())}
    path = os.path.join(stage, "aw01-output.json")
    with open(path, "w", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    unreal.log("AW01_OUTPUT=" + path)


try:
    main()
except Exception as error:
    unreal.log_error("AW01_FAIL=" + text(error))
    unreal.log_error(traceback.format_exc())
    raise
