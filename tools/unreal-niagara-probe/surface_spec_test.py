"""Check surface_spec.py without Unreal: the strict loader, the pose list and the geometry.

Run: python -B tools/unreal-niagara-probe/surface_spec_test.py   (prints OK, exit 0)
"""
import copy
import json
import math
import os
import struct
import tempfile

import surface_spec as surface

HERE = os.path.dirname(os.path.abspath(__file__))
SYSTEMS = os.path.join(HERE, "systems")


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def close(a, b):
    return all(abs(x - y) < 1e-9 for x, y in zip(a, b)) and len(a) == len(b)


with open(os.path.join(SYSTEMS, "ns-basichit-depth.json"), "r", encoding="utf-8") as stream:
    capture = json.load(stream)["capture"]
path = os.path.join(SYSTEMS, "ns-basichit-depth-surface.json")
spec = surface.load_surface_spec(path, capture)
check(spec["sizeCm"] == 3000 and spec["depthStep"] == 6, "surface spec values")

# Pose list: per camera the control, its walls in offset order, then its floors; 16 poses per image step.
poses = surface.step_poses(spec, capture)
labels = [pose["label"] for pose in poses]
check(labels == ["front", "front_wall-25", "front_wall0", "front_wall50", "front_wall150",
                 "oblique", "oblique_wall-25", "oblique_wall0", "oblique_wall50", "oblique_wall150", "oblique_floor",
                 "side", "side_wall-25", "side_wall0", "side_wall50", "side_wall150"], "pose order: %s" % labels)
check([pose["kind"] for pose in poses].count("control") == 3 and len(surface.surface_poses(spec, capture)) == 13, "counts")

# Geometry: target T = (20, 0, -10), camera at T + 800*u, a wall at T - s*u facing +u.
by_label = {pose["label"]: pose for pose in poses}
check(close(by_label["front_wall0"]["pointCm"], [20, 0, -10]) and close(by_label["front_wall0"]["normal"], [1, 0, 0]), "front wall0")
check(close(by_label["front_wall150"]["pointCm"], [-130, 0, -10]), "front wall150 stands behind the target")
check(close(by_label["front_wall-25"]["pointCm"], [45, 0, -10]), "front wall-25 stands in front of the target")
check(close(by_label["side_wall50"]["pointCm"], [20, -50, -10]) and close(by_label["side_wall50"]["normal"], [0, 1, 0]), "side wall50")
u = (math.cos(math.radians(20)) * math.cos(math.radians(45)), math.cos(math.radians(20)) * math.sin(math.radians(45)),
     math.sin(math.radians(20)))
wall = by_label["oblique_wall150"]
check(close(wall["normal"], u) and close(wall["pointCm"], [20 - 150 * u[0], -150 * u[1], -10 - 150 * u[2]]), "oblique wall150")
check(all(abs(math.sqrt(sum(v * v for v in pose["normal"])) - 1) < 1e-12 for pose in poses if pose["kind"] != "control"), "unit normals")
check(by_label["oblique_floor"]["pointCm"] == [20, 0, -10] and by_label["oblique_floor"]["normal"] == [0, 0, 1], "floor")
check(by_label["oblique_floor"]["zCm"] == -10 and by_label["oblique_wall50"]["offsetCm"] == 50, "offset and height keys")
# The camera-to-plane distance along u is distance + s for every wall.
for pose in poses:
    if pose["kind"] == "wall":
        point, normal = pose["pointCm"], pose["normal"]
        camera = [capture["cameraTarget"][i] + capture["cameraDistance"] * normal[i] for i in range(3)]
        depth = sum((point[i] - camera[i]) * -normal[i] for i in range(3))
        check(abs(depth - (capture["cameraDistance"] + pose["offsetCm"])) < 1e-9, "wall depth " + pose["label"])
record = surface.surface_record(by_label["front_wall50"])
check(sorted(record) == ["kind", "label", "normal", "offsetCm", "pointCm", "sizeCm"], "wall surface record keys")
check(sorted(surface.surface_record(by_label["oblique_floor"])) == ["kind", "label", "normal", "pointCm", "sizeCm", "zCm"], "floor record keys")

# File names: 26 surface PNGs and raw files over the 2 image steps, 13 linear diagnostics, 13 depth files at step 6.
png, raw, hdr, depth = surface.surface_files(spec, capture)
check((len(png), len(raw), len(hdr), len(depth)) == (26, 26, 13, 13), "surface file counts")
check(png[0] == "frames/t0006_front_wall-25.png" and raw[0] == "frames/t0006_front_wall-25_hdr.rgba16f", "first surface files")
check(hdr[0] == "frames/t0012_front_wall-25_linear.hdr" and depth[-1] == "frames/t0006_side_wall150_depth.f32", "linear and depth names")

# Depth readback helpers.
size = 4
values = [float(i) for i in range(size * size)]
check(surface.center_depth(values, size) == (5 + 6 + 9 + 10) / 4.0, "center depth")
with tempfile.TemporaryDirectory() as folder:
    name = os.path.join(folder, "d.f32")
    with open(name, "wb") as stream:
        stream.write(struct.pack("<16f", *values))
    check(list(surface.read_depth(name, size)) == values, "depth file round trip")
    try:
        surface.read_depth(name, 5)
        raise AssertionError("wrong size accepted")
    except ValueError:
        pass


def refused(change, key, label):
    """Apply change to a copy of the spec, load it and require a ValueError that names the key."""
    broken = copy.deepcopy(spec)
    change(broken)
    with tempfile.TemporaryDirectory() as folder:
        broken_path = os.path.join(folder, "surface.json")
        with open(broken_path, "w", encoding="utf-8") as stream:
            json.dump(broken, stream)
        try:
            surface.load_surface_spec(broken_path, capture)
        except ValueError as error:
            check(key in str(error), "%s: message does not name %s: %s" % (label, key, error))
            return
        raise AssertionError("%s: no error raised" % label)


refused(lambda s: s.update(extra=1), "extra", "unknown key")
refused(lambda s: s.pop("floors"), "floors", "missing floors")
refused(lambda s: s.update(schema="st01c-surface-spec/v2"), "schema", "wrong schema")
refused(lambda s: s.update(system=""), "system", "empty system")
refused(lambda s: s.update(sizeCm=float("nan")), "sizeCm", "nan size")
refused(lambda s: s.update(sizeCm=float("inf")), "sizeCm", "infinite size")
refused(lambda s: s.update(sizeCm=True), "sizeCm", "boolean size")
refused(lambda s: s.update(sizeCm=0), "sizeCm", "zero size")
refused(lambda s: s["material"].update(blend="translucent"), "material", "translucent material")
refused(lambda s: s["material"].update(emissive=[0, 0, 1]), "emissive", "colored emissive")
refused(lambda s: s["material"].update(extra=1), "material.extra", "unknown material key")
refused(lambda s: s["walls"].update(cameras=["front", "top"]), "top", "unknown wall camera")
refused(lambda s: s["walls"].update(cameras=[]), "walls.cameras", "no wall cameras")
refused(lambda s: s["walls"].update(offsetsCm=[0, 0]), "walls.offsetsCm", "repeated offset")
refused(lambda s: s["walls"].update(offsetsCm=[0.5]), "walls.offsetsCm", "fractional offset")
refused(lambda s: s["walls"].update(offsetsCm=[]), "walls.offsetsCm", "no offsets")
refused(lambda s: s["walls"].update(extra=1), "walls.extra", "unknown walls key")
refused(lambda s: s["floors"].append({"camera": "oblique", "zCm": 0}), "floors[].camera", "two floors for one camera")
refused(lambda s: s["floors"][0].update(camera="top"), "top", "unknown floor camera")
refused(lambda s: s["floors"][0].update(zCm=float("nan")), "zCm", "nan floor height")
refused(lambda s: s["floors"][0].update(extra=1), "floors[].extra", "unknown floor key")
refused(lambda s: s.update(depthStep=7), "depthStep", "depthStep outside imageSteps")
refused(lambda s: s.update(depthStep=6.0), "depthStep", "float depthStep")

print("OK")
