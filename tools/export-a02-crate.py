"""Export the isolated Dreamrise storage mesh to a staged GLB and report its source metadata.

Run only inside the prepared disposable UE 5.8 project, with A02_STAGE_OUT set to an
output directory inside that project and outside C:\\Unreal. This script never saves or modifies Unreal assets.
"""
import json
import os
import traceback

import unreal


OBJECT_PATH = "/Game/Dreamrise_SMSK/Assets/Meshes/SM_StoragePart_03.SM_StoragePart_03"
PACKAGE_PATH = "/Game/Dreamrise_SMSK/Assets/Meshes/SM_StoragePart_03"
ASSET_NAME = "SM_StoragePart_03"


def as_text(value):
    try:
        return str(value)
    except Exception:
        return repr(value)


def vector_xyz(value):
    return {
        "x": float(value.x),
        "y": float(value.y),
        "z": float(value.z),
    }


def read_mesh_report(mesh, asset_data):
    bounds = mesh.get_bounds()
    extent_cm = vector_xyz(bounds.box_extent)
    dimensions_cm = {axis: extent_cm[axis] * 2.0 for axis in ("x", "y", "z")}
    dimensions_m = {axis: dimensions_cm[axis] * 0.01 for axis in ("x", "y", "z")}

    materials = []
    for index, slot in enumerate(mesh.get_editor_property("static_materials")):
        try:
            material = slot.get_editor_property("material_interface")
        except Exception:
            material = None
        try:
            slot_name = as_text(slot.get_editor_property("material_slot_name"))
        except Exception:
            slot_name = ""
        materials.append({
            "index": index,
            "slot": slot_name,
            "material": material.get_path_name() if material else None,
        })

    try:
        sections_lod0 = int(mesh.get_num_sections(0))
    except Exception:
        sections_lod0 = None

    return {
        "asset": OBJECT_PATH,
        "package": as_text(asset_data.package_name),
        "class": mesh.get_class().get_name(),
        "sourceScale": "Unreal centimeters",
        "bounds": {
            "originCm": vector_xyz(bounds.origin),
            "extentCm": extent_cm,
            "dimensionsCm": dimensions_cm,
            "dimensionsAtExportScaleMeters": dimensions_m,
        },
        "lod0": {"sectionCount": sections_lod0},
        "materials": materials,
    }


def is_under(path, root):
    path = os.path.normcase(os.path.realpath(path))
    root = os.path.normcase(os.path.realpath(root))
    try:
        return os.path.commonpath((path, root)) == root
    except ValueError:
        return False


def object_path_for_package(package_path):
    leaf = package_path.rstrip("/").rsplit("/", 1)[-1]
    return package_path + "." + leaf


def game_dependency_closure(registry, root_package):
    options = unreal.AssetRegistryDependencyOptions()
    for name in (
        "include_hard_package_references",
        "include_soft_package_references",
        "include_game_package_references",
        "include_editor_only_package_references",
    ):
        try:
            options.set_editor_property(name, True)
        except Exception:
            pass

    pending = [as_text(root_package)]
    visited = set()
    game_assets = []
    other_dependencies = set()
    missing_game_refs = []
    graph = {}
    while pending:
        package = pending.pop()
        if package in visited:
            continue
        visited.add(package)
        dependencies = sorted(as_text(dep) for dep in registry.get_dependencies(package, options))
        graph[package] = dependencies
        for dependency in dependencies:
            if not dependency.startswith("/Game/"):
                other_dependencies.add(dependency)
                continue
            if dependency not in visited:
                pending.append(dependency)

    for package in sorted(visited):
        if not package.startswith("/Game/"):
            continue
        object_path = object_path_for_package(package)
        asset = unreal.load_asset(object_path)
        if asset is None:
            missing_game_refs.append({"package": package, "objectPathTried": object_path})
            continue
        game_assets.append({
            "package": package,
            "objectPath": object_path,
            "class": asset.get_class().get_name(),
        })

    return {
        "rootPackage": as_text(root_package),
        "gameAssetCount": len(game_assets),
        "gameAssets": game_assets,
        "dependencyGraph": graph,
        "nonGameDependencies": sorted(other_dependencies),
        "missingGameReferences": missing_game_refs,
    }


def set_property(obj, name, value):
    """Use Unreal's Python property spelling (which omits C++ bool `b` prefixes)."""
    obj.set_editor_property(name, value)


def make_export_options():
    options = unreal.GLTFExportOptions()
    # GLTFExportOptions.h documents the default 0.01 conversion from Unreal cm to glTF m.
    options.set_editor_property("export_uniform_scale", 0.01)
    options.set_editor_property("default_level_of_detail", 0)
    set_property(options, "export_source_model", False)
    # Preserve the vertex-color channel if this mesh carries one.
    set_property(options, "export_vertex_colors", True)
    set_property(options, "texture_image_format", unreal.GLTFTextureImageFormat.PNG)
    bake_mode = os.environ.get("A02_BAKE_MODE", "simple").strip().lower()
    bake_modes = {
        "disabled": unreal.GLTFMaterialBakeMode.DISABLED,
        "simple": unreal.GLTFMaterialBakeMode.SIMPLE,
    }
    if bake_mode not in bake_modes:
        raise RuntimeError("A02_BAKE_MODE must be disabled or simple, got: " + bake_mode)
    set_property(options, "bake_material_inputs", bake_modes[bake_mode])

    # This is the installer's only bake-size control. A fixed 512px edge avoids auto-detecting
    # larger source maps; it does not cap textures exported directly from source materials.
    bake_size_type = getattr(unreal, "GLTFMaterialBakeSize", None)
    if bake_size_type is None:
        raise RuntimeError("GLTFMaterialBakeSize Python type is unavailable")
    bake_size = bake_size_type()
    bake_size.set_editor_property("x", 512)
    bake_size.set_editor_property("y", 512)
    bake_size.set_editor_property("auto_detect", False)
    set_property(options, "default_material_bake_size", bake_size)
    return options, bake_mode, {"x": 512, "y": 512, "autoDetect": False}


def write_json(path, report):
    with open(path, "w", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, sort_keys=True)
        stream.write("\n")


def main():
    project_dir = os.path.realpath(unreal.Paths.project_dir())
    source_root = os.path.realpath(r"C:\Unreal")
    if is_under(project_dir, source_root):
        raise RuntimeError("Refusing to run from a project under C:\\Unreal: " + project_dir)
    project_file = os.path.join(project_dir, "A02Export.uproject")
    if not os.path.isfile(project_file):
        raise RuntimeError("Expected project file is missing: " + project_file)

    stage = os.environ.get("A02_STAGE_OUT")
    if not stage:
        raise RuntimeError("A02_STAGE_OUT must point to the approved staging directory")
    stage = os.path.realpath(os.path.abspath(stage))
    if not is_under(stage, project_dir):
        raise RuntimeError("A02_STAGE_OUT must be inside the isolated A02Export project: " + stage)
    os.makedirs(stage, exist_ok=True)
    glb_path = os.path.join(stage, ASSET_NAME + ".glb")
    report_path = os.path.join(stage, ASSET_NAME + ".report.json")
    if os.path.exists(glb_path):
        raise RuntimeError("Refusing to overwrite staged output: " + glb_path)

    report = {
        "status": "failed",
        "engine": "UE 5.8 project commandlet",
        "projectFile": project_file,
        "objectPath": OBJECT_PATH,
        "packagePath": PACKAGE_PATH,
        "outputGlb": glb_path,
        "exportOptions": {
            "uniformScale": 0.01,
            "defaultLod": 0,
            "sourceModel": False,
            "vertexColors": True,
            "bakeMode": None,
            "bakeSize": None,
            "globalMaximumTextureDimension": "unsupported by installed GLTFExportOptions API",
            "textureImageFormat": "PNG",
            "bakeMaterialInputs": None,
        },
    }
    try:
        registry = unreal.AssetRegistryHelpers.get_asset_registry()
        registry.scan_paths_synchronous(["/Game/Dreamrise_SMSK"], force_rescan=True)
        mesh = unreal.load_asset(OBJECT_PATH)
        if mesh is None or not isinstance(mesh, unreal.StaticMesh):
            raise RuntimeError("Expected a loaded StaticMesh at " + OBJECT_PATH)

        asset_data = registry.get_asset_by_object_path(OBJECT_PATH)
        if not asset_data or not asset_data.is_valid():
            raise RuntimeError("Asset Registry could not resolve " + OBJECT_PATH)
        report["mesh"] = read_mesh_report(mesh, asset_data)
        report["dependencies"] = game_dependency_closure(registry, asset_data.package_name)
        if report["dependencies"]["missingGameReferences"]:
            raise RuntimeError("Missing /Game dependency assets: " + json.dumps(report["dependencies"]["missingGameReferences"], ensure_ascii=False))

        options, bake_mode, bake_size = make_export_options()
        report["exportOptions"]["bakeMode"] = bake_mode
        report["exportOptions"]["bakeSize"] = bake_size
        report["exportOptions"]["bakeMaterialInputs"] = bake_mode

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
        report["exportErrors"] = [as_text(error) for error in task.get_editor_property("errors")]
        if not success or not os.path.isfile(glb_path):
            raise RuntimeError("GLB exporter failed; inspect exportErrors and the commandlet log")

        report["status"] = "exported"
        report["glbBytes"] = os.path.getsize(glb_path)
        write_json(report_path, report)
        unreal.log("A02_REPORT=" + report_path)
        unreal.log("A02_GLB=" + glb_path)
    except Exception as exc:
        report["error"] = as_text(exc)
        report["traceback"] = traceback.format_exc()
        write_json(report_path, report)
        unreal.log_error("A02 export failed: " + as_text(exc))
        unreal.log_error("A02_REPORT=" + report_path)
        raise


main()
