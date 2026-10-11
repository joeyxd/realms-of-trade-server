"""Export only Dreamrise SM_Rock geometry from the isolated UE 5.8 S02 stage."""
import json
import os
import struct
import traceback

import unreal


OBJECT_PATH = "/Game/Dreamrise_SMSK/Assets/Meshes/SM_Rock.SM_Rock"
PACKAGE_PATH = "/Game/Dreamrise_SMSK/Assets/Meshes/SM_Rock"
ASSET_NAME = "SM_Rock"
EXPECTED_GAME_PACKAGES = {
    "/Game/Dreamrise_SMSK/Assets/Meshes/SM_Rock",
    "/Game/Dreamrise_SMSK/Assets/Materials/MI_Base_Normal",
    "/Game/Dreamrise_SMSK/Assets/Materials/M_Base",
    "/Game/Dreamrise_SMSK/Assets/Textures/T_ColorPalette",
}


def as_text(value):
    try:
        return str(value)
    except Exception:
        return repr(value)


def vector_xyz(value):
    return {"x": float(value.x), "y": float(value.y), "z": float(value.z)}


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
    graph = {}
    non_game = set()
    while pending:
        package = pending.pop()
        if package in visited:
            continue
        visited.add(package)
        dependencies = sorted(as_text(dep) for dep in registry.get_dependencies(package, options))
        graph[package] = dependencies
        for dependency in dependencies:
            if dependency.startswith("/Game/"):
                if dependency not in visited:
                    pending.append(dependency)
            else:
                non_game.add(dependency)

    game_packages = sorted(package for package in visited if package.startswith("/Game/"))
    game_assets = []
    missing = []
    for package in game_packages:
        object_path = object_path_for_package(package)
        asset = unreal.load_asset(object_path)
        if asset is None:
            missing.append({"package": package, "objectPathTried": object_path})
        else:
            game_assets.append({"package": package, "objectPath": object_path, "class": asset.get_class().get_name()})

    return {
        "rootPackage": as_text(root_package),
        "gamePackageCount": len(game_packages),
        "gamePackages": game_packages,
        "gameAssets": game_assets,
        "dependencyGraph": graph,
        "nonGameDependencies": sorted(non_game),
        "missingGameReferences": missing,
        "expectedGamePackages": sorted(EXPECTED_GAME_PACKAGES),
        "exactExpectedClosure": set(game_packages) == EXPECTED_GAME_PACKAGES,
    }


def read_mesh_report(mesh, asset_data):
    bounds = mesh.get_bounds()
    extent_cm = vector_xyz(bounds.box_extent)
    dimensions_cm = {axis: extent_cm[axis] * 2.0 for axis in ("x", "y", "z")}
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

    lods = []
    try:
        lod_count = int(mesh.get_num_lods())
    except Exception:
        lod_count = 1
    for lod in range(lod_count):
        try:
            triangles = int(mesh.get_num_triangles(lod))
        except Exception:
            triangles = None
        try:
            sections = int(mesh.get_num_sections(lod))
        except Exception:
            sections = None
        lods.append({"lod": lod, "triangleCount": triangles, "sectionCount": sections})

    return {
        "asset": OBJECT_PATH,
        "package": as_text(asset_data.package_name),
        "class": mesh.get_class().get_name(),
        "sourceScale": "Unreal centimeters",
        "bounds": {
            "originCm": vector_xyz(bounds.origin),
            "extentCm": extent_cm,
            "dimensionsCm": dimensions_cm,
            "dimensionsAtExportScaleMeters": {axis: dimensions_cm[axis] * 0.01 for axis in dimensions_cm},
        },
        "lods": lods,
        "materialReferences": materials,
    }


def inspect_glb(path):
    with open(path, "rb") as stream:
        header = stream.read(12)
        if len(header) != 12:
            raise RuntimeError("GLB header is truncated")
        magic, version, total_length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2:
            raise RuntimeError("Exporter output is not a glTF 2.0 binary")
        if total_length != os.path.getsize(path):
            raise RuntimeError("GLB header length does not match file size")
        json_chunk = None
        while stream.tell() < total_length:
            chunk_header = stream.read(8)
            if len(chunk_header) != 8:
                raise RuntimeError("GLB chunk header is truncated")
            chunk_length, chunk_type = struct.unpack("<I4s", chunk_header)
            chunk_data = stream.read(chunk_length)
            if len(chunk_data) != chunk_length:
                raise RuntimeError("GLB chunk payload is truncated")
            if chunk_type == b"JSON":
                json_chunk = json.loads(chunk_data.decode("utf-8").rstrip(" \t\r\n\0"))
        if json_chunk is None:
            raise RuntimeError("GLB has no JSON chunk")

    accessors = json_chunk.get("accessors", [])
    meshes = []
    total_triangles = 0
    total_position_vertices = 0
    vertex_color_sets = []
    primitive_material_refs = []
    materials = json_chunk.get("materials", [])
    for mesh_index, mesh in enumerate(json_chunk.get("meshes", [])):
        for primitive_index, primitive in enumerate(mesh.get("primitives", [])):
            attributes = primitive.get("attributes", {})
            position_accessor = attributes.get("POSITION")
            vertex_count = accessors[position_accessor].get("count") if position_accessor is not None else None
            index_accessor = primitive.get("indices")
            index_count = accessors[index_accessor].get("count") if index_accessor is not None else vertex_count
            triangles = index_count // 3 if isinstance(index_count, int) else None
            if triangles is not None:
                total_triangles += triangles
            if vertex_count is not None:
                total_position_vertices += vertex_count
            color_attributes = sorted(key for key in attributes if key.startswith("COLOR_"))
            vertex_color_sets.append({
                "meshIndex": mesh_index,
                "primitiveIndex": primitive_index,
                "sets": color_attributes,
                "hasVertexColors": bool(color_attributes),
            })
            material_index = primitive.get("material")
            material_name = None
            if isinstance(material_index, int) and material_index < len(materials):
                material_name = materials[material_index].get("name")
            primitive_material_refs.append({
                "meshIndex": mesh_index,
                "primitiveIndex": primitive_index,
                "materialIndex": material_index,
                "materialName": material_name,
            })
            meshes.append({
                "name": mesh.get("name"),
                "primitiveIndex": primitive_index,
                "vertexCount": vertex_count,
                "indexCount": index_count,
                "triangleCount": triangles,
                "vertexColorSets": color_attributes,
            })

    return {
        "version": version,
        "bytes": total_length,
        "sceneCount": len(json_chunk.get("scenes", [])),
        "meshPrimitiveCount": len(meshes),
        "positionVertexCountSummedAcrossPrimitives": total_position_vertices,
        "triangleCountSummedAcrossPrimitives": total_triangles,
        "vertexColors": vertex_color_sets,
        "materials": materials,
        "materialReferences": primitive_material_refs,
        "primitives": meshes,
    }


def set_property(obj, name, value):
    obj.set_editor_property(name, value)


def make_export_options():
    options = unreal.GLTFExportOptions()
    set_property(options, "export_uniform_scale", 0.01)
    set_property(options, "default_level_of_detail", 0)
    set_property(options, "export_source_model", False)
    set_property(options, "export_vertex_colors", True)
    set_property(options, "texture_image_format", unreal.GLTFTextureImageFormat.PNG)
    bake_mode = os.environ.get("S02_BAKE_MODE", "disabled").strip().lower()
    if bake_mode != "disabled":
        raise RuntimeError("S02_BAKE_MODE must be disabled for geometry-only export")
    set_property(options, "bake_material_inputs", unreal.GLTFMaterialBakeMode.DISABLED)
    size_type = getattr(unreal, "GLTFMaterialBakeSize", None)
    bake_size = None
    if size_type is not None:
        bake_size = size_type()
        bake_size.set_editor_property("x", 512)
        bake_size.set_editor_property("y", 512)
        bake_size.set_editor_property("auto_detect", False)
        set_property(options, "default_material_bake_size", bake_size)
    return options


def write_json(path, report):
    with open(path, "w", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, sort_keys=True)
        stream.write("\n")


def main():
    project_dir = os.path.realpath(unreal.Paths.project_dir())
    source_root = os.path.realpath(r"C:\Unreal")
    if is_under(project_dir, source_root):
        raise RuntimeError("Refusing to run from a project under C:\\Unreal: " + project_dir)
    project_file = os.path.join(project_dir, "S02RockExport.uproject")
    if not os.path.isfile(project_file):
        raise RuntimeError("Expected isolated S02 project is missing: " + project_file)

    stage = os.environ.get("S02_STAGE_OUT")
    if not stage:
        raise RuntimeError("S02_STAGE_OUT must point to the staged output directory")
    stage = os.path.realpath(os.path.abspath(stage))
    if not is_under(stage, project_dir) or is_under(stage, source_root):
        raise RuntimeError("S02 output must stay inside the isolated project and outside C:\\Unreal")
    os.makedirs(stage, exist_ok=True)
    glb_path = os.path.join(stage, ASSET_NAME + ".glb")
    report_path = os.path.join(stage, ASSET_NAME + ".report.json")
    if os.path.exists(glb_path) or os.path.exists(report_path):
        raise RuntimeError("Refusing to overwrite an existing S02 export or report")

    report = {
        "status": "failed",
        "case": "S02 beach-rock geometry trial",
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
            "bakeMode": "disabled",
            "renderMode": "NullRHI",
            "shaderCompile": "disabled",
        },
        "errors": [],
    }
    try:
        registry = unreal.AssetRegistryHelpers.get_asset_registry()
        registry.scan_paths_synchronous(["/Game/Dreamrise_SMSK/Assets"], force_rescan=True)
        mesh = unreal.load_asset(OBJECT_PATH)
        if mesh is None or not isinstance(mesh, unreal.StaticMesh):
            raise RuntimeError("Expected StaticMesh is missing: " + OBJECT_PATH)
        asset_data = registry.get_asset_by_object_path(OBJECT_PATH)
        if not asset_data or not asset_data.is_valid():
            raise RuntimeError("Asset Registry could not resolve " + OBJECT_PATH)

        report["mesh"] = read_mesh_report(mesh, asset_data)
        report["dependencies"] = game_dependency_closure(registry, asset_data.package_name)
        if report["dependencies"]["missingGameReferences"]:
            raise RuntimeError("Missing /Game references: " + json.dumps(report["dependencies"]["missingGameReferences"], ensure_ascii=False))
        if not report["dependencies"]["exactExpectedClosure"]:
            raise RuntimeError("Unexpected Game dependency closure: " + json.dumps(report["dependencies"]["gamePackages"], ensure_ascii=False))
        material_paths = {item["material"] for item in report["mesh"]["materialReferences"] if item["material"]}
        if not material_paths or not any(path.startswith("/Game/Dreamrise_SMSK/Assets/Materials/MI_Base_Normal.") for path in material_paths):
            raise RuntimeError("Mesh material references did not resolve to MI_Base_Normal: " + json.dumps(sorted(material_paths), ensure_ascii=False))

        options = make_export_options()
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
        export_errors = [as_text(error) for error in task.get_editor_property("errors")]
        report["errors"].extend(export_errors)
        if not success or not os.path.isfile(glb_path):
            raise RuntimeError("GLB exporter failed; inspect errors and Saved/Logs")

        report["glbInspection"] = inspect_glb(glb_path)
        report["status"] = "exported"
        report["glbBytes"] = os.path.getsize(glb_path)
        write_json(report_path, report)
        unreal.log("S02_REPORT=" + report_path)
        unreal.log("S02_GLB=" + glb_path)
    except Exception as exc:
        report["errors"].append(as_text(exc))
        report["traceback"] = traceback.format_exc()
        write_json(report_path, report)
        unreal.log_error("S02 export failed: " + as_text(exc))
        unreal.log_error("S02_REPORT=" + report_path)
        raise


main()
