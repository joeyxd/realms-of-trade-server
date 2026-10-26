"""Surface planes of the depth reference: the strict loader of a surface spec and the pose list with its geometry.

A surface spec (schema st01c-surface-spec/v1, systems/ns-basichit-depth-surface.json) sits beside the system spec of the
capture and says where opaque black planes stand under the effect: walls that face a camera at an offset behind (or in
front of) the camera target, and floors at a height. Everything here is pure Python with no `import unreal`:
capture_depth_profiled.py captures the poses this module lists, build_depth_checkpoint.py and check_depth_checkpoint.py
recompute the same geometry from it, and surface_spec_test.py checks it.

Geometry (the camera placement of capture_reference_profiled.py _profiled_pose, unchanged): the camera of yaw y and pitch p
looks at the target T from T + distance*u with u = (cos p cos y, cos p sin y, sin p). A wall of offset s is the plane
through T - s*u with normal +u (it faces the camera; s > 0 is farther from the camera than T, so the orthographic scene
depth at the image center is distance + s). A floor of height z is the plane through (T.x, T.y, z) with normal (0, 0, 1).
Both are sizeCm squares centered on that point. The system capture block is the raw JSON object (capture.cameras are
{name, yaw, pitch} objects), so no Unreal module is needed to read it.
"""
import json
import math
import struct

SCHEMA = "st01c-surface-spec/v1"
KEYS = ("schema", "system", "sizeCm", "material", "walls", "floors", "depthStep")
MATERIAL_KEYS = ("blend", "shading", "twoSided", "emissive")
WALL_KEYS = ("cameras", "offsetsCm")
FLOOR_KEYS = ("camera", "zCm")
# The scene depth readback file: float32 from an RGBA32F target (KismetRenderingLibrary.cpp ReadRenderTargetHelper reads
# PF_FloatRGBA and PF_A32B32G32R32F only), the R channel, top row first.
DEPTH_ENCODING = "little-endian float32, SceneDepth R in cm; top row first"
DEPTH_EXTENSION = "f32"


def _number(value, key):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("surface spec %s must be a finite number" % key)
    return value


def _exact_keys(block, keys, key):
    if not isinstance(block, dict):
        raise ValueError("surface spec %s must be an object with the keys: %s" % (key, ", ".join(keys)))
    for name in block:
        if name not in keys:
            raise ValueError("surface spec %s.%s is not a key" % (key, name))
    for name in keys:
        if name not in block:
            raise ValueError("surface spec %s.%s is required" % (key, name))


def load_surface_spec(path, capture):
    """Read and validate a surface spec against the capture block of its system spec. Every problem raises ValueError
    naming the key; unknown keys are refused. Returns the validated spec (same keys as the file)."""
    with open(path, "r", encoding="utf-8") as stream:
        spec = json.load(stream)
    _exact_keys(spec, KEYS, "")
    if spec["schema"] != SCHEMA:
        raise ValueError("surface spec schema must be " + SCHEMA)
    if not isinstance(spec["system"], str) or not spec["system"]:
        raise ValueError("surface spec system must be a non-empty string")
    if _number(spec["sizeCm"], "sizeCm") <= 0:
        raise ValueError("surface spec sizeCm must be positive")
    material = spec["material"]
    _exact_keys(material, MATERIAL_KEYS, "material")
    if material["blend"] != "opaque" or material["shading"] != "unlit" or material["twoSided"] is not True:
        raise ValueError("surface spec material must be opaque, unlit and twoSided true")
    emissive = material["emissive"]
    if not isinstance(emissive, list) or len(emissive) != 3 or [_number(v, "material.emissive") for v in emissive] != [0, 0, 0]:
        raise ValueError("surface spec material.emissive must be [0, 0, 0]")
    names = [camera["name"] for camera in capture["cameras"]]
    walls = spec["walls"]
    _exact_keys(walls, WALL_KEYS, "walls")
    if not isinstance(walls["cameras"], list) or not walls["cameras"] or len(set(walls["cameras"])) != len(walls["cameras"]):
        raise ValueError("surface spec walls.cameras must be a non-empty list of unique camera names")
    for name in walls["cameras"]:
        if name not in names:
            raise ValueError("surface spec walls.cameras names %r, not a camera of the system spec" % (name,))
    offsets = walls["offsetsCm"]
    if not isinstance(offsets, list) or not offsets or len(set(offsets)) != len(offsets):
        raise ValueError("surface spec walls.offsetsCm must be a non-empty list of unique integers")
    for offset in offsets:
        if isinstance(offset, bool) or not isinstance(offset, int):
            raise ValueError("surface spec walls.offsetsCm must be a non-empty list of unique integers")
    floors = spec["floors"]
    if not isinstance(floors, list):
        raise ValueError("surface spec floors must be a list of {camera, zCm}")
    for floor in floors:
        _exact_keys(floor, FLOOR_KEYS, "floors[]")
        if floor["camera"] not in names:
            raise ValueError("surface spec floors[].camera names %r, not a camera of the system spec" % (floor["camera"],))
        _number(floor["zCm"], "floors[].zCm")
    if len(set(floor["camera"] for floor in floors)) != len(floors):
        raise ValueError("surface spec floors[].camera must be unique (one floor per camera)")
    depth_step = spec["depthStep"]
    if isinstance(depth_step, bool) or not isinstance(depth_step, int) or depth_step not in capture["imageSteps"]:
        raise ValueError("surface spec depthStep must be one of the system spec capture.imageSteps")
    return spec


def camera_axis(yaw, pitch):
    """Unit vector u from the target to the camera (the offset of _profiled_pose divided by the distance)."""
    yaw_r, pitch_r = math.radians(yaw), math.radians(pitch)
    return (math.cos(pitch_r) * math.cos(yaw_r), math.cos(pitch_r) * math.sin(yaw_r), math.sin(pitch_r))


def step_poses(surface, capture):
    """The poses of one image step, in capture order: per camera of the system spec the control (no plane), then its
    walls in offsetsCm order, then its floors. Each pose is a dict with kind (control, wall or floor), camera and label;
    walls and floors add pointCm, normal, sizeCm and offsetCm or zCm."""
    target = capture["cameraTarget"]
    poses = []
    for camera in capture["cameras"]:
        name = camera["name"]
        poses.append({"kind": "control", "camera": name, "label": name})
        axis = camera_axis(camera["yaw"], camera["pitch"])
        if name in surface["walls"]["cameras"]:
            for offset in surface["walls"]["offsetsCm"]:
                poses.append({"kind": "wall", "camera": name, "label": "%s_wall%d" % (name, offset), "offsetCm": offset,
                              "pointCm": [target[i] - offset * axis[i] for i in range(3)], "normal": list(axis),
                              "sizeCm": surface["sizeCm"]})
        for floor in surface["floors"]:
            if floor["camera"] == name:
                poses.append({"kind": "floor", "camera": name, "label": name + "_floor", "zCm": floor["zCm"],
                              "pointCm": [target[0], target[1], floor["zCm"]], "normal": [0, 0, 1],
                              "sizeCm": surface["sizeCm"]})
    return poses


def surface_poses(surface, capture):
    """step_poses without the controls."""
    return [pose for pose in step_poses(surface, capture) if pose["kind"] != "control"]


def surface_record(pose):
    """The "surface" object a capture-report row carries for a wall or a floor."""
    keys = ("kind", "label", "offsetCm", "zCm", "pointCm", "normal", "sizeCm")
    return {key: pose[key] for key in keys if key in pose}


def surface_files(surface, capture):
    """Relative names the surface poses add to a run: LDR PNGs and raw HDR files at every image step, the Radiance
    diagnostics at the linear step, and the depth files at depthStep."""
    poses = surface_poses(surface, capture)
    png = ["frames/t%04d_%s.png" % (step, pose["label"]) for step in capture["imageSteps"] for pose in poses]
    raw = [name[:-len(".png")] + "_hdr.rgba16f" for name in png]
    hdr = ["frames/t%04d_%s_linear.hdr" % (capture["linearStep"], pose["label"]) for pose in poses]
    depth = ["frames/t%04d_%s_depth.%s" % (surface["depthStep"], pose["label"], DEPTH_EXTENSION) for pose in poses]
    return png, raw, hdr, depth


def read_depth(path, size):
    """The size*size float32 values of a depth file, row-major, top row first."""
    with open(path, "rb") as stream:
        data = stream.read()
    if len(data) != 4 * size * size:
        raise ValueError("%s: %d bytes, expected %d" % (path, len(data), 4 * size * size))
    return struct.unpack("<%df" % (size * size), data)


def center_depth(values, size):
    """Depth at the projection of the camera target: the mean of the four pixels around the image center."""
    half = size // 2
    return sum(values[row * size + column] for row in (half - 1, half) for column in (half - 1, half)) / 4.0
