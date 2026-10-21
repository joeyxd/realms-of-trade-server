"""Build the reference checkpoint of one system from two identical capture runs.

python build_reference_checkpoint.py --spec <systems/*.json> --a <run dir> --b <run dir> --out <checkpoint.json> [--root <repo>]

Run A is the reference (its files are pinned); run B is the repeat. The comparison, the framing and the
burst facts are computed here from the run folders, the spec and the capture reports, never typed in.
The only author-recorded facts are the wall times and notes of PROBE_RUNS below (the capture does not
store them); the outcome, the framing used and the failing step of each probe run are read from its folder.
Output: JSON with indent 2 and sorted keys, UTF-8, LF. check_reference_checkpoint.py re-verifies the hashes.
Standard library and numpy (Pillow through compare_reference_runs.py for the PNG pixels).
"""
import argparse
import hashlib
import json
import os
import re
import sys

import compare_reference_runs as compare
import frame_from_particles as frame

SCHEMA = "st01c-reference-checkpoint/1"
CODE_FILES = (
    "tools/unreal-niagara-probe/capture_reference.py",
    "tools/unreal-niagara-probe/compare_reference_runs.py",
    "tools/unreal-niagara-probe/frame_from_particles.py",
    "tools/unreal-niagara-probe/check_reference_checkpoint.py",
    "tools/unreal-niagara-probe/build_reference_checkpoint.py",
    "tools/unreal-niagara-probe/render_reference_md.py",
)
# Author-recorded: wall time of each Unreal run (seconds) and what the run was for. Outcome, framing
# and failure are read from the run folder; a probe whose report is missing keeps its fallback framing.
PROBE_RUNS = (
    {"name": "basichit-ref-probe01", "wallSeconds": 32.4, "role": "probe",
     "note": "first framing pass with the provisional capture block (imageSteps 2..240, 512 px)",
     "fallbackFraming": {"cameraTarget": [0, 0, 100], "cameraDistance": 500, "orthoWidth": 400},
     "fallbackImageSize": 512, "fallbackImageSteps": [2, 6, 12, 18, 30, 60, 120, 240]},
    {"name": "basichit-ref-probe02", "wallSeconds": 32.1, "role": "probe",
     "note": "imageSteps cut to 2, 6, 12, 18 after the blank frame of probe01; full 241 particle files at the provisional framing"},
    {"name": "basichit-ref-probe03", "wallSeconds": 31.1, "role": "probe",
     "note": "recommended framing applied; particle files equal to probe02"},
    {"name": "basichit-overlap01", "wallSeconds": 32.5, "role": "discarded",
     "note": "meant as reference01; a second Unreal instance started while it ran, so the pair was renamed and repeated"},
    {"name": "basichit-overlap02", "wallSeconds": 29.9, "role": "discarded",
     "note": "meant as reference02; it overlapped basichit-overlap01 and is not used (it also compared equal to it)"},
    {"name": "basichit-reference01", "wallSeconds": 30.9, "role": "superseded",
     "note": "first serial pair at 512 px (about 80 px of effect); superseded by the 1024 px pair"},
    {"name": "basichit-reference02", "wallSeconds": 31.8, "role": "superseded",
     "note": "repeat of basichit-reference01 at 512 px; compared equal to it"},
    {"name": "basichit-blank-attempt01", "wallSeconds": 48.4, "role": "blank-frame-attempt",
     "note": "1024 px with imageSteps 2, 6, 12, 18, 24, 30; first attempt of the name basichit-reference03, renamed after the failure",
     "fallbackFraming": {"cameraTarget": [20, 0, -10], "cameraDistance": 800, "orthoWidth": 850},
     "fallbackImageSize": 1024, "fallbackImageSteps": [2, 6, 12, 18, 24, 30]},
)
FINAL_WALL_SECONDS = {"basichit-reference03": 44.9, "basichit-reference04": 42.9}


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path):
    with open(path, "r", encoding="utf-8") as stream:
        return json.load(stream)


def rel(path, root):
    return os.path.relpath(path, root).replace("\\", "/")


def probe_outcome(run_dir, probe):
    """Outcome, framing used and blank-frame failure of one probe run, read from its folder."""
    row = {"name": probe["name"], "role": probe["role"], "wallSeconds": probe["wallSeconds"], "note": probe["note"]}
    report_path = os.path.join(run_dir, "capture-report.json")
    error_path = os.path.join(run_dir, "capture-error.txt")
    blank = None
    if os.path.isfile(report_path):
        report = load_json(report_path)
        settings = report["settings"]
        row["outcome"] = "complete: %d image frames, %d particle steps" % (
            report["counts"]["image_frames_written"], report["counts"]["particle_steps_written"])
        row["imageSteps"] = settings["image_steps"]
        row["imageSize"] = settings["resolution"][0]
        row["framing"] = {"cameraTarget": settings["target_cm"], "cameraDistance": settings["camera_distance_cm"],
                          "orthoWidth": settings["orthographic_width_cm"]}
    elif os.path.isfile(error_path):
        with open(error_path, "r", encoding="utf-8") as stream:
            lines = [line.strip() for line in stream.read().splitlines() if line.strip()]
        last = lines[-1] if lines else "empty capture-error.txt"
        row["outcome"] = "failed: " + last
        row["framing"] = probe.get("fallbackFraming")
        row["imageSteps"] = probe.get("fallbackImageSteps")
        row["imageSize"] = probe.get("fallbackImageSize")
        found = re.search(r"Blank reference capture at step (\d+) / (\S+)", last)
        if found:
            blank = {"run": probe["name"], "failingStep": int(found.group(1)), "camera": found.group(2),
                     "visiblePixels": None,
                     "visiblePixelsNote": "the gate raises after three attempts and does not report the count",
                     "imageSize": probe.get("fallbackImageSize"),
                     "action": "that step and every later one removed from capture.imageSteps"}
    else:
        row["outcome"] = "run folder missing"
    return row, blank


def alive_at(run, steps):
    """Particles alive per emitter at the given steps, read from particles/step_NNNN.json."""
    rows = {}
    for step in steps:
        data = compare.load_json(os.path.join(run, "particles", "step_%04d.json" % step))
        rows[str(step)] = {emitter["name"]: len(emitter.get("particles", [])) for emitter in data.get("emitters", [])}
    return rows


def visible_extent_px(path, threshold=16):
    """Width and height in pixels of the box holding every pixel whose largest channel exceeds the threshold."""
    from PIL import Image
    import numpy as np
    mask = np.asarray(Image.open(path).convert("RGB")).max(axis=2) > threshold
    rows, cols = np.where(mask.any(axis=1))[0], np.where(mask.any(axis=0))[0]
    if not rows.size:
        return [0, 0]
    return [int(cols[-1] - cols[0] + 1), int(rows[-1] - rows[0] + 1)]


def burst_facts(run):
    """Per emitter: first step with particles, count there, max alive, last step alive, lifetimes, late births."""
    facts, first_seen = {}, {}
    files = sorted(name for name in os.listdir(os.path.join(run, "particles")) if name.startswith("step_"))
    for name in files:
        step = int(name[5:9])
        for emitter in compare.load_json(os.path.join(run, "particles", name)).get("emitters", []):
            row = facts.setdefault(emitter["name"], {
                "firstStep": None, "countAtFirstStep": None, "maxAlive": 0, "lastStepAlive": None,
                "lifetimeMin": None, "lifetimeMax": None, "spriteSizeMin": None, "spriteSizeMax": None,
                "particlesSpawned": 0, "birthSteps": [],
                "birthsAfterStep60": False})
            alive = emitter.get("particles", [])
            if alive and row["firstStep"] is None:
                row["firstStep"], row["countAtFirstStep"] = step, len(alive)
            row["maxAlive"] = max(row["maxAlive"], len(alive))
            if alive:
                row["lastStepAlive"] = step
            born = 0
            for particle in alive:
                key = (emitter["name"], particle["uniqueId"])
                if key not in first_seen:
                    first_seen[key] = step
                    born += 1
                low, high = min(particle["size"]), max(particle["size"])
                row["spriteSizeMin"] = low if row["spriteSizeMin"] is None else min(row["spriteSizeMin"], low)
                row["spriteSizeMax"] = high if row["spriteSizeMax"] is None else max(row["spriteSizeMax"], high)
                life = particle["lifetime"]
                row["lifetimeMin"] = life if row["lifetimeMin"] is None else min(row["lifetimeMin"], life)
                row["lifetimeMax"] = life if row["lifetimeMax"] is None else max(row["lifetimeMax"], life)
            if born:
                row["particlesSpawned"] += born
                row["birthSteps"].append(step)
                if step > 60:
                    row["birthsAfterStep60"] = True
    last_any = max((row["lastStepAlive"] for row in facts.values() if row["lastStepAlive"] is not None), default=None)
    return facts, last_any


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--spec", required=True)
    parser.add_argument("--a", required=True, help="reference run folder")
    parser.add_argument("--b", required=True, help="repeat run folder")
    parser.add_argument("--out", required=True)
    parser.add_argument("--root", help="repository root (default: two levels above this script)")
    args = parser.parse_args(argv)
    root = os.path.abspath(args.root or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    runs_dir = os.path.dirname(os.path.abspath(args.a))
    run_a, run_b = os.path.basename(os.path.abspath(args.a)), os.path.basename(os.path.abspath(args.b))
    spec = load_json(args.spec)
    capture = spec["capture"]
    png, hdr, particles, textures = compare.expected_files(capture)

    report_a, report_b = (load_json(os.path.join(args.a, "capture-report.json")),
                          load_json(os.path.join(args.b, "capture-report.json")))
    if report_a["system_spec"]["sha256"] != sha256_of(args.spec):
        print("ERROR the spec changed after run A was captured", file=sys.stderr)
        return 2

    # Repeat: the same comparison compare_reference_runs.py prints, as numbers.
    particle_same = [name for name in particles if compare.same_bytes(args.a, args.b, name)]
    hdr_same = [name for name in hdr if compare.same_bytes(args.a, args.b, name)]
    png_rows = [{"file": name.split("/", 1)[1], "maxChannelDifference": compare.png_difference(args.a, args.b, name)}
                for name in png]
    texture_same = [name for name in textures if compare.sha256_of(os.path.join(args.a, name)) is not None
                    and compare.sha256_of(os.path.join(args.a, name)) == compare.sha256_of(os.path.join(args.b, name))]
    keys_equal = {key: report_a[key] == report_b[key] for key in ("settings", "seed_configuration", "counts")}
    repeat = {"runB": run_b, "cpuFramesIdentical": len(particle_same), "cpuFramesExpected": len(particles),
              "hdrFilesByteIdentical": len(hdr_same), "hdrFilesExpected": len(hdr),
              "ldrDecodedPixelDifferences": png_rows,
              "texturesEqual": len(texture_same), "texturesExpected": len(textures),
              "reportKeysEqual": keys_equal,
              "pngBinaryHashesMayDiffer": "PNG metadata is not used as pixel equality",
              "result": "equal" if (len(particle_same) == len(particles) and len(hdr_same) == len(hdr)
                                    and all(row["maxChannelDifference"] == 0 for row in png_rows)
                                    and len(texture_same) == len(textures) and all(keys_equal.values())) else "differs"}

    # Framing of the final spec over the reference particles, and the first pass that led to it.
    positions, largest, steps, records = frame.read_particles(args.a)
    framing = frame.derive(capture, positions, largest)
    framing["particleSteps"], framing["particleRecords"] = steps, records
    capture_rows, blank_rows = [], []
    for probe in PROBE_RUNS:
        row, blank = probe_outcome(os.path.join(runs_dir, probe["name"]), probe)
        capture_rows.append(row)
        if blank:
            blank_rows.append(blank)
    first_pass = None
    for probe, row in zip(PROBE_RUNS, capture_rows):
        probe_dir = os.path.join(runs_dir, probe["name"])
        if row["role"] == "probe" and row.get("outcome", "").startswith("complete") and row["framing"] != {
                "cameraTarget": capture["cameraTarget"], "cameraDistance": capture["cameraDistance"],
                "orthoWidth": capture["orthoWidth"]}:
            draft = dict(capture, **row["framing"])
            p_positions, p_largest, _, _ = frame.read_particles(probe_dir)
            first_pass = frame.derive(draft, p_positions, p_largest)
            first_pass["run"] = probe["name"]
            break
    framing["firstPass"] = first_pass
    framing["applied"] = {"cameraTarget": capture["cameraTarget"], "cameraDistance": capture["cameraDistance"],
                          "orthoWidth": capture["orthoWidth"]}
    framing["appliedRule"] = ("recommendation of frame_from_particles.py on firstPass; the width is the larger of "
                              "1.2 x the largest extent and the width that puts every projected corner inside 90%")

    burst, last_any = burst_facts(args.a)
    emitters = report_a["seed_configuration"]["result"]["emitters"]
    run_rows = [{"name": run_a, "role": "final", "wallSeconds": FINAL_WALL_SECONDS.get(run_a),
                 "outcome": "complete", "framing": framing["applied"], "imageSteps": capture["imageSteps"],
                 "imageSize": capture["imageSize"]},
                {"name": run_b, "role": "final", "wallSeconds": FINAL_WALL_SECONDS.get(run_b),
                 "outcome": "complete", "framing": framing["applied"], "imageSteps": capture["imageSteps"],
                 "imageSize": capture["imageSize"]}]
    failing = sorted({row["failingStep"] for row in blank_rows})
    alive_steps = sorted(set(capture["imageSteps"]) | set(failing) | {last_any})

    reference_files = []
    for name in png + hdr + particles + textures + ["capture-report.json"]:
        reference_files.append({"file": name, "sha256": sha256_of(os.path.join(args.a, name))})
    texture_exports = []
    for row in report_a["renderer_textures"]:
        texture_exports.append({key: row[key] for key in ("asset", "file", "width", "height", "srgb",
                                                          "source_copy_package_sha256", "sha256")})

    checkpoint = {
        "schema": SCHEMA,
        "engine": "5.8.0-55116800+++UE5+Release-5.8",
        "system": {"package": spec["systemPackage"], "sourceSystemSha256": spec["sourceSystemSha256"],
                   "spec": {"file": rel(args.spec, root), "sha256": sha256_of(args.spec)}},
        "referenceRun": run_a,
        "captureRuns": run_rows + capture_rows,
        "settings": {key: capture[key] for key in ("dt", "lastStep", "imageSteps", "linearStep", "imageSize", "cameras",
                                                   "cameraTarget", "cameraDistance", "orthoWidth")},
        "seedConfiguration": {"fixtureSeedBase": spec["fixtureSeedBase"],
                              "handles": [{"name": row["name"], "seed": row["fixtureSeed"],
                                           "originalDeterminism": row["originalDeterminism"]} for row in emitters],
                              "scope": report_a["seed_configuration"]["result"]["overrideScope"]},
        "counts": {"steps": report_a["counts"]["simulation_steps"], "images": len(png), "particleSteps": len(particles),
                   "hdr": len(hdr), "textures": len(textures), "referenceFiles": len(reference_files)},
        "repeat": repeat,
        "framing": framing,
        "burst": burst,
        "aliveAtSteps": alive_at(args.a, alive_steps),
        "visibleExtentPx": {name.split("/", 1)[1]: visible_extent_px(os.path.join(args.a, name)) for name in png},
        "cmPerPixel": capture["orthoWidth"] / capture["imageSize"],
        "effectLastStepAlive": last_any,
        "blankFrameAttempts": blank_rows,
        "visiblePixelsGt16": {row["file"]: row["visible_pixels_gt16"] for row in report_a["images"]},
        "referenceFiles": reference_files,
        "textureExports": texture_exports,
        "codeHashes": {path: sha256_of(os.path.join(root, path)) for path in CODE_FILES},
        "scope": "Reference capture of the by-spec tools only; no visual fidelity, native simulation or final framing is claimed.",
    }
    with open(args.out, "w", encoding="utf-8", newline="\n") as stream:
        json.dump(checkpoint, stream, indent=2, sort_keys=True, ensure_ascii=False)
        stream.write("\n")
    print("checkpoint written: %d reference files, repeat %s" % (len(reference_files), repeat["result"]))
    return 0 if repeat["result"] == "equal" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
