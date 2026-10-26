"""Derive the capture framing of a system from the particles of one reference run.

python frame_from_particles.py --spec <systems/*.json> --run <run dir> [--json <out>]

Over all particles/step_*.json of the run, take the axis-aligned box of the particle positions
expanded by half of the largest sprite size (max over both size components of every particle)
on every axis. The box fits when, for every camera of the spec capture block, each of its eight
corners projects inside 90% of the half orthographic width on both image axes. The projection
uses the same look-at as capture_reference.py (camera at cameraTarget + cameraDistance * the
direction of yaw/pitch, looking at cameraTarget, roll 0, Unreal axes: X forward, Y right, Z up).

When the box does not fit, the recommendation is printed: cameraTarget = box center rounded to
10 cm, orthoWidth = the smallest multiple of 50 cm >= 1.2 x the largest box extent (raised further
when the projected corners of an oblique camera still fall outside the 90% limit), cameraDistance
unchanged unless it is below 1.5 x the largest extent (then the smallest multiple of 100 that is).
Exit 0 when the box fits, 1 when it does not, 2 on a usage or input error. Standard library and
numpy only.
"""
import argparse
import glob
import json
import math
import os
import sys

import numpy as np

MARGIN = 0.9


def load_json(path):
    with open(path, "r", encoding="utf-8") as stream:
        return json.load(stream)


def read_particles(run):
    """Return (positions Nx3, largest size component, step count, particle count) of a run."""
    files = sorted(glob.glob(os.path.join(run, "particles", "step_*.json")))
    if not files:
        raise ValueError("no particles/step_*.json in " + run)
    rows, largest, total = [], 0.0, 0
    for path in files:
        for emitter in load_json(path).get("emitters", []):
            for particle in emitter.get("particles", []):
                rows.append(particle["position"])
                largest = max(largest, max(particle["size"]))
                total += 1
    if not rows:
        raise ValueError("the run holds no particle at any step")
    return np.array(rows, dtype=np.float64), largest, len(files), total


def camera_basis(yaw, pitch, distance):
    """Unit forward/right/up of the capture camera, as capture_reference.py places it."""
    yaw_r, pitch_r = math.radians(yaw), math.radians(pitch)
    offset = np.array([math.cos(pitch_r) * math.cos(yaw_r), math.cos(pitch_r) * math.sin(yaw_r), math.sin(pitch_r)])
    forward = -offset
    right = np.cross([0.0, 0.0, 1.0], forward)
    length = np.linalg.norm(right)
    right = right / length if length > 1e-9 else np.array([0.0, 1.0, 0.0])
    up = np.cross(forward, right)
    return forward, right, up


def corners_of(low, high):
    return np.array([[x, y, z] for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])])


def projected_limits(box_low, box_high, capture):
    """Per camera: the largest |image coordinate| of the box corners on both axes, in cm."""
    target = np.array(capture["cameraTarget"], dtype=np.float64)
    rows = {}
    for camera in capture["cameras"]:
        forward, right, up = camera_basis(camera["yaw"], camera["pitch"], capture["cameraDistance"])
        relative = corners_of(box_low, box_high) - target
        rows[camera["name"]] = {
            "maxAbsRight": float(np.abs(relative @ right).max()),
            "maxAbsUp": float(np.abs(relative @ up).max()),
        }
    return rows


def round_up_to(value, step):
    return step * math.ceil(round(value / step, 9))


def derive(capture, positions, largest):
    half = largest / 2.0
    low, high = positions.min(axis=0) - half, positions.max(axis=0) + half
    center, extent = (low + high) / 2.0, high - low
    limit = MARGIN * capture["orthoWidth"] / 2.0
    cameras = projected_limits(low, high, capture)
    for row in cameras.values():
        row["fits"] = bool(row["maxAbsRight"] <= limit and row["maxAbsUp"] <= limit)
    fits = all(row["fits"] for row in cameras.values())
    largest_extent = float(extent.max())
    result = {
        "box": {"min": low.tolist(), "max": high.tolist(), "center": center.tolist(), "extent": extent.tolist()},
        "largestSpriteSize": largest,
        "specFraming": {"cameraTarget": capture["cameraTarget"], "cameraDistance": capture["cameraDistance"],
                        "orthoWidth": capture["orthoWidth"], "limitCm": limit},
        "cameras": cameras,
        "fits": fits,
    }
    if not fits:
        distance = capture["cameraDistance"]
        if distance < 1.5 * largest_extent:
            distance = round_up_to(1.5 * largest_extent, 100)
        target = [round(float(v) / 10.0) * 10 for v in center]
        # 1.2 x the largest extent is the base rule; an oblique camera projects the box corners wider
        # than that, so the width is also raised until every corner lies inside the 90% limit.
        moved = dict(capture, cameraTarget=target)
        reach = max(max(row["maxAbsRight"], row["maxAbsUp"]) for row in projected_limits(low, high, moved).values())
        base_width = round_up_to(1.2 * largest_extent, 50)
        ortho = max(base_width, round_up_to(2.0 * reach / MARGIN, 50))
        result["recommendation"] = {
            "cameraTarget": target,
            "orthoWidth": ortho,
            "orthoWidthFromExtent": base_width,
            "cameraDistance": distance,
        }
    return result


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--spec", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--json")
    args = parser.parse_args(argv)
    try:
        capture = load_json(args.spec)["capture"]
        positions, largest, steps, total = read_particles(args.run)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print("ERROR %s" % error, file=sys.stderr)
        return 2
    result = derive(capture, positions, largest)
    result["particleSteps"], result["particleRecords"] = steps, total
    box = result["box"]
    print("run %s: %d particle files, %d particle records" % (args.run, steps, total))
    for index, axis in enumerate("xyz"):
        print("box %s: min %.3f max %.3f center %.3f extent %.3f" % (
            axis, box["min"][index], box["max"][index], box["center"][index], box["extent"][index]))
    print("largest sprite size: %.3f" % largest)
    frame = result["specFraming"]
    print("spec framing: cameraTarget %s cameraDistance %s orthoWidth %s (90%% half-width %.1f cm)" % (
        frame["cameraTarget"], frame["cameraDistance"], frame["orthoWidth"], frame["limitCm"]))
    for name, row in result["cameras"].items():
        print("camera %s: max |right| %.1f max |up| %.1f -> %s" % (
            name, row["maxAbsRight"], row["maxAbsUp"], "fits" if row["fits"] else "outside"))
    print("fits: " + ("true" if result["fits"] else "false"))
    if "recommendation" in result:
        rec = result["recommendation"]
        print("recommendation: cameraTarget %s orthoWidth %s cameraDistance %s" % (
            rec["cameraTarget"], rec["orthoWidth"], rec["cameraDistance"]))
    if args.json:
        with open(args.json, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(result, stream, indent=2, sort_keys=True)
            stream.write("\n")
    return 0 if result["fits"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
