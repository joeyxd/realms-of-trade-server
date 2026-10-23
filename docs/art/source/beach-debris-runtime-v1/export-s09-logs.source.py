"""Inspect and geometry-export only Dreamrise SM_Logs from the isolated UE 5.8 S09 stage."""
import json
import os
import struct
import traceback

import unreal

OBJECT_PATH = "/Game/Dreamrise_SMSK/Assets/Meshes/SM_Logs.SM_Logs"
PACKAGE_PATH = "/Game/Dreamrise_SMSK/Assets/Meshes/SM_Logs"
ASSET_NAME = "SM_Logs"


def text(value):
    try:
        return str(value)
    except Exception:
        return repr(value)


def xyz(value):
    return {axis: float(getattr(value, axis)) for axis in ("x", "y", "z")}


def under(path, root):
    path = os.path.normcase(os.path.realpath(path))
    root = os.path.normcase(os.path.realpath(root))
    try:
        return os.path.commonpath((path, root)) == root
    except ValueError:
        return False


def object_for_package(package):
    leaf = package.rstrip("/").rsplit("/", 1)[-1]
    return package + "." + leaf


def dependencies(registry, root):
    options = unreal.AssetRegistryDependencyOptions()
    for name in ("include_hard_package_references", "include_soft_package_references", "include_game_package_references", "include_editor_only_package_references"):
        try:
            options.set_editor_property(name, True)
        except Exception:
            pass
    pending, visited, graph, external = [text(root)], set(), {}, set()
    while pending:
        package = pending.pop()
        if package in visited:
            continue
        visited.add(package)
        deps = sorted(text(dep) for dep in registry.get_dependencies(package, options))
        graph[package] = deps
        for dep in deps:
            if dep.startswith("/Game/"):
                if dep not in visited:
                    pending.append(dep)
            else:
                external.add(dep)
    game_packages = sorted(path for path in visited if path.startswith("/Game/"))
    assets, missing = [], []
    for package in game_packages:
        object_path = object_for_package(package)
        asset = unreal.load_asset(object_path)
        if asset is None:
            missing.append({"package": package, "objectPathTried": object_path})
        else:
            assets.append({"package": package, "objectPath": object_path, "class": asset.get_class().get_name()})
    return {"rootPackage": text(root), "gamePackageCount": len(game_packages), "gamePackages": game_packages,
            "gameAssets": assets, "dependencyGraph": graph, "nonGameDependencies": sorted(external),
            "missingGameReferences": missing, "allGameReferencesResolvableInStage": not missing}


def mesh_report(mesh, asset_data):
    bounds = mesh.get_bounds()
    extent = xyz(bounds.box_extent)
    materials = []
    for index, slot in enumerate(mesh.get_editor_property("static_materials")):
        try:
            material = slot.get_editor_property("material_interface")
        except Exception:
            material = None
        try:
            slot_name = text(slot.get_editor_property("material_slot_name"))
        except Exception:
            slot_name = ""
        materials.append({"index": index, "slot": slot_name, "material": material.get_path_name() if material else None})
    try:
        count = int(mesh.get_num_lods())
    except Exception:
        count = 1
    lods = []
    for lod in range(count):
        try:
            tris = int(mesh.get_num_triangles(lod))
        except Exception:
            tris = None
        try:
            sections = int(mesh.get_num_sections(lod))
        except Exception:
            sections = None
        lods.append({"lod": lod, "triangleCount": tris, "sectionCount": sections})
    return {"asset": OBJECT_PATH, "package": text(asset_data.package_name), "class": mesh.get_class().get_name(),
            "sourceScale": "Unreal centimeters", "bounds": {"originCm": xyz(bounds.origin), "extentCm": extent,
            "dimensionsCm": {axis: extent[axis] * 2.0 for axis in extent},
            "dimensionsAtExportScaleMeters": {axis: extent[axis] * 0.02 for axis in extent}},
            "lods": lods, "materialReferences": materials}


def inspect_glb(path):
    with open(path, "rb") as stream:
        header = stream.read(12)
        if len(header) != 12:
            raise RuntimeError("Truncated GLB header")
        magic, version, length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2 or length != os.path.getsize(path):
            raise RuntimeError("Invalid GLB 2.0 header or length")
        document = None
        while stream.tell() < length:
            chunk_length, kind = struct.unpack("<I4s", stream.read(8))
            chunk = stream.read(chunk_length)
            if len(chunk) != chunk_length:
                raise RuntimeError("Truncated GLB chunk")
            if kind == b"JSON":
                document = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
    if document is None:
        raise RuntimeError("GLB has no JSON chunk")
    accessors, materials = document.get("accessors", []), document.get("materials", [])
    primitives, triangles = [], 0
    for mi, mesh in enumerate(document.get("meshes", [])):
        for pi, primitive in enumerate(mesh.get("primitives", [])):
            attributes = primitive.get("attributes", {})
            pos = attributes.get("POSITION")
            indices = primitive.get("indices")
            index_count = accessors[indices].get("count") if indices is not None else (accessors[pos].get("count") if pos is not None else 0)
            tri_count = index_count // 3
            triangles += tri_count
            material_index = primitive.get("material")
            primitives.append({"meshIndex": mi, "primitiveIndex": pi,
                               "positionCount": accessors[pos].get("count") if pos is not None else None,
                               "indexCount": index_count, "triangleCount": tri_count,
                               "materialName": materials[material_index].get("name") if isinstance(material_index, int) and material_index < len(materials) else None})
    return {"bytes": length, "version": version, "meshPrimitiveCount": len(primitives),
            "triangleCountSummedAcrossPrimitives": triangles, "materials": materials,
            "embeddedImages": len(document.get("images", [])), "primitives": primitives}


def main():
    project = os.path.realpath(unreal.Paths.project_dir())
    source_root = os.path.realpath(r"C:\Unreal")
    if under(project, source_root):
        raise RuntimeError("Refusing to run inside C:\\Unreal")
    if not os.path.isfile(os.path.join(project, "S09LogsExport.uproject")):
        raise RuntimeError("Expected isolated S09 project is missing")
    out = os.environ.get("S09_STAGE_OUT")
    if not out:
        raise RuntimeError("S09_STAGE_OUT is required")
    out = os.path.realpath(os.path.abspath(out))
    if not under(out, project) or under(out, source_root):
        raise RuntimeError("S09 output must stay inside isolated stage and outside C:\\Unreal")
    os.makedirs(out, exist_ok=True)
    glb_path, report_path = os.path.join(out, ASSET_NAME + ".glb"), os.path.join(out, ASSET_NAME + ".report.json")
    if os.path.exists(glb_path) or os.path.exists(report_path):
        raise RuntimeError("Refusing to overwrite existing S09 output")
    report = {"status": "failed", "case": "S09 beach-driftwood portability trial",
              "engine": "UE 5.8 isolated project commandlet", "project": project, "objectPath": OBJECT_PATH,
              "packagePath": PACKAGE_PATH, "outputGlb": glb_path,
              "exportOptions": {"uniformScale": 0.01, "defaultLod": 0, "sourceModel": False,
                                "vertexColors": True, "bakeMode": "disabled", "renderMode": "NullRHI", "shaderCompile": "disabled"},
              "errors": []}
    try:
        registry = unreal.AssetRegistryHelpers.get_asset_registry()
        registry.scan_paths_synchronous(["/Game/Dreamrise_SMSK/Assets"], force_rescan=True)
        mesh = unreal.load_asset(OBJECT_PATH)
        if mesh is None or not isinstance(mesh, unreal.StaticMesh):
            raise RuntimeError("SM_Logs is missing or not a StaticMesh in the isolated stage")
        asset_data = registry.get_asset_by_object_path(OBJECT_PATH)
        if not asset_data or not asset_data.is_valid():
            raise RuntimeError("Asset Registry did not resolve SM_Logs")
        report["mesh"] = mesh_report(mesh, asset_data)
        report["dependencies"] = dependencies(registry, asset_data.package_name)
        if report["dependencies"]["missingGameReferences"]:
            raise RuntimeError("Dependency closure is incomplete in isolated stage: " + json.dumps(report["dependencies"]["missingGameReferences"], ensure_ascii=False))
        expected_packages = {
            PACKAGE_PATH,
            "/Game/Dreamrise_SMSK/Assets/Materials/MI_Base_Normal",
            "/Game/Dreamrise_SMSK/Assets/Materials/M_Base",
            "/Game/Dreamrise_SMSK/Assets/Textures/T_ColorPalette",
        }
        actual_packages = set(report["dependencies"]["gamePackages"])
        if actual_packages != expected_packages:
            raise RuntimeError("Unexpected /Game dependency closure: " + json.dumps(report["dependencies"]["gamePackages"], ensure_ascii=False))
        options = unreal.GLTFExportOptions()
        options.set_editor_property("export_uniform_scale", 0.01)
        options.set_editor_property("default_level_of_detail", 0)
        options.set_editor_property("export_source_model", False)
        options.set_editor_property("export_vertex_colors", True)
        options.set_editor_property("bake_material_inputs", unreal.GLTFMaterialBakeMode.DISABLED)
        task = unreal.AssetExportTask()
        task.set_editor_property("object", mesh)
        task.set_editor_property("filename", glb_path)
        task.set_editor_property("exporter", None)
        task.set_editor_property("options", options)
        task.set_editor_property("selected", False)
        task.set_editor_property("replace_identical", False)
        task.set_editor_property("prompt", False)
        task.set_editor_property("automated", True)
        task.set_editor_property("use_file_archive", False)
        task.set_editor_property("write_empty_files", False)
        success = unreal.Exporter.run_asset_export_task(task)
        report["errors"].extend(text(error) for error in task.get_editor_property("errors"))
        if not success or not os.path.isfile(glb_path):
            raise RuntimeError("Geometry-only GLB export failed")
        report["glbInspection"] = inspect_glb(glb_path)
        report["status"] = "exported"
        report["glbBytes"] = os.path.getsize(glb_path)
        with open(report_path, "w", encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
        unreal.log("S09_REPORT=" + report_path)
        unreal.log("S09_GLB=" + glb_path)
    except Exception as exc:
        report["errors"].append(text(exc))
        report["traceback"] = traceback.format_exc()
        with open(report_path, "w", encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
        unreal.log_error("S09 export failed: " + text(exc))
        unreal.log_error("S09_REPORT=" + report_path)
        raise


main()
