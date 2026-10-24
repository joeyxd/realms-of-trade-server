"""Build the checkpoint of the depth reference pair: NS_BasicHit with opaque black planes under the controlled color profile.

python build_depth_checkpoint.py --spec <systems/ns-basichit-depth.json> --surface <systems/ns-basichit-depth-surface.json>
       --a <run dir> --b <run dir> --base <run dir> --controls <run dir> --out <checkpoint.json> [--root <repo>]

Run A is the reference and B the repeat, both written by capture_depth_profiled.py; --base is the earlier reference of the
same system (basichit-reference03, pinned by reference-checkpoint.json) whose particle states must not change, and --controls
the profiled run of the same cameras and steps (basichit-reference05, pinned by reference-profiled-checkpoint.json) whose
LDR and raw HDR frames the controls of this run (no plane in the scene) must reproduce. Everything is computed here from the
run folders, their capture reports and the two specs; the only author-recorded facts are the wall times and the attempt
notes below (the capture does not store them). build_profiled_checkpoint.py is used as a library, unchanged; the surface
sections below are recomputed by check_depth_checkpoint.py with the same functions.
Output: JSON with indent 2 and sorted keys, UTF-8, LF. Standard library, numpy and Pillow (as compare_reference_runs.py).
"""
import argparse
import json
import os
import sys

import build_profiled_checkpoint as profiled
import build_reference_checkpoint as base_builder
import compare_reference_runs as compare
import surface_spec as surfaces

SCHEMA = "st01c-depth-reference-checkpoint/1"
CONTROLS_CHECKPOINT = "docs/delivery/st01c/basichit/reference-profiled-checkpoint.json"
CODE_FILES = profiled.CODE_FILES + (
    "tools/unreal-niagara-probe/capture_depth_profiled.py",
    "tools/unreal-niagara-probe/surface_spec.py",
    ".scratch/unreal/Content/Python/test_st01c_depth_profiled.py",
    "tools/unreal-niagara-probe/build_depth_checkpoint.py",
    "tools/unreal-niagara-probe/check_depth_checkpoint.py",
)
CODE_ROLES = 5  # capture_code rows of a run: driver, surface, profile, library, wrapper
DEPTH_TOLERANCE_CM = 1.0
GEOMETRY_TOLERANCE = 1e-9  # the report geometry was computed by the editor's Python, the expectation by this one
COMMAND = profiled.COMMAND.replace("test_st01c_reference_profiled", "test_st01c_depth_profiled").replace(
    "/systems/ns-basichit.json'", "/systems/ns-basichit-depth.json' '-SurfaceSpec=C:/DEV/real of trade/st01c-native/"
    "tools/unreal-niagara-probe/systems/ns-basichit-depth-surface.json'")
assert COMMAND.endswith("ns-basichit-depth-surface.json'") and "test_st01c_depth_profiled" in COMMAND
# Author-recorded: Stopwatch wall time around the PowerShell command (seconds), and every attempt that did not become a
# final run. basichit-reference14 ran first, as a trial with the same code, and is the repeat; the name
# basichit-reference13 was never created (the next launch found another session's headless Chrome running).
FINAL_WALL_SECONDS = {"basichit-reference12": 127.5, "basichit-reference14": 226.8}
ATTEMPTS = ()


def expected_files(capture, surface):
    """Relative names a complete run holds: the profiled set of the controls plus the surface poses and the depth files."""
    png, raw, hdr, particles, textures = profiled.expected_files(capture)
    s_png, s_raw, s_hdr, s_depth = surfaces.surface_files(surface, capture)
    return png + s_png, raw + s_raw, hdr + s_hdr, s_depth, particles, textures


def run_names(capture, surface):
    png, raw, hdr, depth, particles, textures = expected_files(capture, surface)
    return sorted(png + raw + hdr + depth + particles + textures + ["capture-report.json"])


def _geometry_equal(a, b):
    if isinstance(a, dict):
        return isinstance(b, dict) and sorted(a) == sorted(b) and all(_geometry_equal(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(_geometry_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) <= GEOMETRY_TOLERANCE
    return a == b


def surface_section(run, report, capture, surface):
    """The surface poses of a run, recomputed from its capture report and depth files. Returns (problem or None, section).
    Checked: one row per pose and image step in capture order with the geometry of surface_spec.py, a depth file on every
    row of depthStep (and on no other), and for every wall the depth at the image center within DEPTH_TOLERANCE_CM of
    cameraDistance + offset."""
    poses = surfaces.surface_poses(surface, capture)
    expected = [(step, pose) for step in capture["imageSteps"] for pose in poses]
    rows = report.get("surface_images", [])
    size = capture["imageSize"]
    problem = None if len(rows) == len(expected) else "%d surface rows, expected %d" % (len(rows), len(expected))
    section_rows, centers, depth_files = [], {}, 0
    pairs = list(zip(rows, expected)) if problem is None else []
    for row, (step, pose) in pairs:
        label = "t%04d %s" % (step, pose["label"])
        depth = row.get("depth")
        if (row.get("step"), row.get("camera"), row.get("view")) != (step, pose["label"], pose["camera"]):
            problem = problem or "%s: row is step %s camera %s view %s" % (label, row.get("step"), row.get("camera"), row.get("view"))
        elif not _geometry_equal(row.get("surface"), surfaces.surface_record(pose)):
            problem = problem or "%s: geometry differs from surface_spec.py: %s" % (label, json.dumps(row.get("surface")))
        entry = {"step": step, "label": pose["label"], "view": pose["camera"], "surface": row.get("surface"),
                 "visiblePixelsGt16": row.get("visible_pixels_gt16"), "depth": None}
        if step == surface["depthStep"]:
            name = "frames/t%04d_%s_depth.%s" % (step, pose["label"], surfaces.DEPTH_EXTENSION)
            path = os.path.join(run, name)
            if not depth or depth.get("file") != name or not os.path.isfile(path):
                problem = problem or "%s: no depth file %s" % (label, name)
            else:
                center = surfaces.center_depth(surfaces.read_depth(path, size), size)
                expect = capture["cameraDistance"] + pose["offsetCm"] if pose["kind"] == "wall" else None
                entry["depth"] = {"file": name, "sha256": base_builder.sha256_of(path), "encoding": depth.get("encoding"),
                                  "width": depth.get("width"), "height": depth.get("height"), "centerDepthCm": center,
                                  "expectedCm": expect}
                depth_files += 1
                if pose["kind"] == "wall":
                    centers.setdefault(pose["camera"], []).append({"label": pose["label"], "centerDepthCm": center,
                                                                    "expectedCm": expect})
                    if abs(center - expect) > DEPTH_TOLERANCE_CM:
                        problem = problem or "%s: center depth %.4f cm, expected %.1f" % (label, center, expect)
                if (depth.get("encoding"), depth.get("width"), depth.get("height")) != (surfaces.DEPTH_ENCODING, size, size):
                    problem = problem or "%s: depth encoding %s %sx%s" % (label, depth.get("encoding"), depth.get("width"), depth.get("height"))
        elif depth is not None:
            problem = problem or "%s: depth recorded outside depthStep" % label
        section_rows.append(entry)
    return problem, {"rows": len(rows), "depthFiles": depth_files, "toleranceCm": DEPTH_TOLERANCE_CM,
                     "depthEncoding": surfaces.DEPTH_ENCODING, "wallCenterDepths": centers, "poses": section_rows}


def controls_identity(run, controls, capture):
    """The control frames of run (no plane in the scene) against the same step and camera of the controls run: decoded LDR
    pixels, raw HDR bytes and the Radiance diagnostics of the linear step."""
    names = [camera["name"] for camera in capture["cameras"]]
    rows = []
    for step in capture["imageSteps"]:
        for name in names:
            png = "frames/t%04d_%s.png" % (step, name)
            rows.append({"file": png, "byteIdentical": compare.same_bytes(run, controls, png),
                         "differingPixels": profiled.png_pixels_differing(run, controls, png),
                         "maxChannelDifference": compare.png_difference(run, controls, png),
                         "rawHdrIdentical": compare.same_bytes(run, controls, png[:-len(".png")] + "_hdr.rgba16f"),
                         "linearHdrIdentical": compare.same_bytes(run, controls, "frames/t%04d_%s_linear.hdr" % (step, name))
                         if step == capture["linearStep"] else None})
    equal = all(row["differingPixels"] == 0 and row["maxChannelDifference"] == 0 and row["rawHdrIdentical"]
                and row["linearHdrIdentical"] in (None, True) for row in rows)
    return {"run": os.path.basename(os.path.normpath(controls)), "checkpoint": CONTROLS_CHECKPOINT, "rows": rows,
            "total": len(rows), "pngWithZeroDifferingPixels": sum(1 for row in rows if row["differingPixels"] == 0),
            "pngByteIdentical": sum(1 for row in rows if row["byteIdentical"]),
            "rawHdrIdentical": sum(1 for row in rows if row["rawHdrIdentical"]),
            "maxChannelDifference": max((row["maxChannelDifference"] or 0) for row in rows),
            "result": "equal" if equal else "differs"}


def pair_identity(run_a, run_b, capture, surface):
    """The two runs compared section by section, as numbers (recomputed by the checker)."""
    png, raw, hdr, depth, particles, textures = expected_files(capture, surface)
    same = lambda names: [name for name in names if compare.same_bytes(run_a, run_b, name)]
    png_rows = [{"file": name, "differingPixels": profiled.png_pixels_differing(run_a, run_b, name),
                 "maxChannelDifference": compare.png_difference(run_a, run_b, name)} for name in png]
    reports = [compare.load_json(os.path.join(run, "capture-report.json")) for run in (run_a, run_b)]
    keys = {key: key in reports[0] and reports[0][key] == reports[1].get(key)
            for key in ("settings", "seed_configuration", "counts", "capture_profile", "surface_spec")}
    # Surface rows: geometry, visible pixels and the hashes of the raw HDR and depth files (the PNG encoder may differ).
    summary = lambda report: [(row["step"], row["camera"], row["surface"], row["visible_pixels_gt16"], row["hdr_raw"]["sha256"],
                               (row["depth"] or {}).get("sha256")) for row in report.get("surface_images", [])]
    keys["surfaceRows"] = bool(summary(reports[0])) and summary(reports[0]) == summary(reports[1])
    sections = {"particles": (same(particles), particles), "rgba16f": (same(raw), raw), "rgbe": (same(hdr), hdr),
                "depth": (same(depth), depth), "textures": (same(textures), textures)}
    result = {name: {"identical": len(hit), "total": len(names), "differing": [n for n in names if n not in hit]}
              for name, (hit, names) in sections.items()}
    result["png"] = {"rows": png_rows, "total": len(png_rows),
                     "withZeroDifferingPixels": sum(1 for row in png_rows if row["differingPixels"] == 0),
                     "differingPixels": sum(row["differingPixels"] or 0 for row in png_rows)
                     if all(row["differingPixels"] is not None for row in png_rows) else None,
                     "byteIdentical": len(same(png)),
                     "note": "PNG encoder streams may differ; equality is on decoded RGBA pixels"}
    result["reportKeysEqual"] = keys
    equal = (all(section["identical"] == section["total"] for name, section in result.items() if name in sections)
             and result["png"]["withZeroDifferingPixels"] == len(png_rows) and all(keys.values()))
    result["result"] = "equal" if equal else "differs"
    return result


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--spec", required=True)
    parser.add_argument("--surface", required=True)
    parser.add_argument("--a", required=True, help="reference run folder")
    parser.add_argument("--b", required=True, help="repeat run folder")
    parser.add_argument("--base", required=True, help="earlier reference run of the same system (particle states)")
    parser.add_argument("--controls", required=True, help="profiled run whose frames the controls must reproduce")
    parser.add_argument("--out", required=True)
    parser.add_argument("--root", help="repository root (default: two levels above this script)")
    args = parser.parse_args(argv)
    root = os.path.abspath(args.root or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    spec = compare.load_json(args.spec)
    capture = spec["capture"]
    surface = surfaces.load_surface_spec(args.surface, capture)
    run_a, run_b, base = (os.path.basename(os.path.abspath(p)) for p in (args.a, args.b, args.base))
    reports = {name: compare.load_json(os.path.join(folder, "capture-report.json")) for name, folder in ((run_a, args.a), (run_b, args.b))}
    spec_sha, surface_sha = base_builder.sha256_of(args.spec), base_builder.sha256_of(args.surface)
    for name, report in reports.items():
        if report.get("status") != "complete" or report["system_spec"]["sha256"] != spec_sha:
            print("ERROR %s is not complete or was captured with another spec" % name, file=sys.stderr)
            return 2
        if report.get("capture_profile", {}).get("id") != profiled.PROFILE_ID:
            print("ERROR %s was not captured under %s" % (name, profiled.PROFILE_ID), file=sys.stderr)
            return 2
        if report.get("surface_spec", {}).get("sha256") != surface_sha:
            print("ERROR %s was captured with another surface spec" % name, file=sys.stderr)
            return 2
    png, raw, hdr, depth, particles, textures = expected_files(capture, surface)
    expected = run_names(capture, surface)
    runs = []
    for name, folder in ((run_a, args.a), (run_b, args.b)):
        listing = profiled.run_listing(folder)
        if listing != expected:
            print("ERROR %s does not hold exactly the expected files: missing %s extra %s" % (
                name, sorted(set(expected) - set(listing))[:3], sorted(set(listing) - set(expected))[:3]), file=sys.stderr)
            return 2
        runs.append({"name": name, "role": "final", "wallSeconds": FINAL_WALL_SECONDS.get(name), "outcome": "complete",
                     "files": [{"file": rel, "sha256": base_builder.sha256_of(os.path.join(folder, rel))} for rel in expected]})
    report_a = reports[run_a]
    problem, surface_rows = surface_section(args.a, report_a, capture, surface)
    problem_b, surface_rows_b = surface_section(args.b, reports[run_b], capture, surface)
    if problem or problem_b:
        print("ERROR surface section: %s" % (problem or problem_b), file=sys.stderr)
        return 2
    pair = pair_identity(args.a, args.b, capture, surface)
    controls = controls_identity(args.a, args.controls, capture)
    checkpoint = {
        "schema": SCHEMA,
        "engine": profiled.engine_version(),
        "system": {"package": spec["systemPackage"], "sourceSystemSha256": spec["sourceSystemSha256"],
                   "spec": {"file": base_builder.rel(args.spec, root), "sha256": spec_sha,
                            "sha256Lf": profiled.text_sha256(args.spec)}},
        "surfaceSpec": {"file": base_builder.rel(args.surface, root), "sha256": surface_sha,
                        "sha256Lf": profiled.text_sha256(args.surface), "content": surface},
        "referenceRun": run_a,
        "repeatRun": run_b,
        "runs": runs,
        "attempts": list(ATTEMPTS),
        "command": COMMAND,
        "profile": report_a["capture_profile"],
        "settings": {key: capture[key] for key in ("dt", "lastStep", "imageSteps", "linearStep", "imageSize", "cameras",
                                                   "cameraTarget", "cameraDistance", "orthoWidth")},
        "seedConfiguration": {"fixtureSeedBase": spec["fixtureSeedBase"],
                              "handles": [{"name": row["name"], "seed": row["fixtureSeed"]}
                                          for row in report_a["seed_configuration"]["result"]["emitters"]]},
        "counts": {"steps": report_a["counts"]["simulation_steps"], "png": len(png), "rgba16f": len(raw), "rgbe": len(hdr),
                   "depth": len(depth), "particleSteps": len(particles), "textures": len(textures), "runFiles": len(expected),
                   "controlPoses": len(controls["rows"]), "surfacePoses": surface_rows["rows"]},
        "pair": pair,
        "base": dict(profiled.base_particles(args.a, args.base, capture), run=base, checkpoint=profiled.BASE_CHECKPOINT),
        "controls": controls,
        "surfaces": surface_rows,
        "visiblePixelsGt16": {row["file"]: row["visible_pixels_gt16"] for row in
                              [report_a["empty_baseline"]] + report_a["images"] + report_a["surface_images"]},
        "codeHashes": {path: profiled.text_sha256(os.path.join(root, path)) for path in CODE_FILES},
        "binaryHashes": {path: base_builder.sha256_of(os.path.join(root, path)) for path in profiled.BINARY_FILES},
        "hashing": ("runs[].files, binaryHashes, system.spec.sha256 and surfaceSpec.sha256 (the hashes the capture recorded): raw "
                    "bytes; codeHashes and the sha256Lf fields: text with CRLF turned into LF"),
        "scope": ("Depth reference of NS_BasicHit: the controlled-sdr/v1 pair of profiled.scope with 13 opaque black plane poses "
                  "per image step (walls facing each camera at four offsets, one floor) and the scene depth of each pose at "
                  "depthStep; no visual fidelity, native render or DepthFade measurement is claimed."),
    }
    missing = [path for path, digest in checkpoint["codeHashes"].items() if digest is None]
    missing += [path for path, digest in checkpoint["binaryHashes"].items() if digest is None]
    if missing:
        print("ERROR missing code files: " + ", ".join(missing), file=sys.stderr)
        return 2
    with open(args.out, "w", encoding="utf-8", newline="\n") as stream:
        json.dump(checkpoint, stream, indent=2, sort_keys=True, ensure_ascii=False)
        stream.write("\n")
    base_row = checkpoint["base"]
    print("checkpoint written: %d files per run, pair %s, particles vs %s %d/%d, controls vs %s %s, %d surface rows, %d depth files" % (
        len(expected), pair["result"], base, base_row["identical"], base_row["total"], controls["run"], controls["result"],
        surface_rows["rows"], surface_rows["depthFiles"]))
    ok = (pair["result"] == "equal" and base_row["identical"] == base_row["total"]
          and base_row["texturesIdentical"] == base_row["texturesTotal"] and controls["result"] == "equal")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
