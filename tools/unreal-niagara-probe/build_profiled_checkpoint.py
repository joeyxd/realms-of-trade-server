"""Build the checkpoint of a reference pair captured under the controlled SDR color profile.

python build_profiled_checkpoint.py --spec <systems/*.json> --a <run dir> --b <run dir> --base <run dir> --out <checkpoint.json> [--root <repo>]

Run A is the reference and B the repeat, both written by capture_reference_profiled.py; --base is the earlier
reference of the same spec (basichit-reference03, pinned by docs/delivery/st01c/basichit/reference-checkpoint.json)
whose particle states the profile must not change. Everything is computed here from the run folders, their capture
reports and the spec; the only author-recorded facts are the wall times and the attempt notes below (the capture does
not store them). The comparison helpers of compare_reference_runs.py and the hashing of build_reference_checkpoint.py
are used as libraries; check_profiled_checkpoint.py imports this module and recomputes everything it pins.
Hashing: run files, textures, the plugin binary and the spec (as captured) by raw bytes; code files by their text with
CRLF turned into LF (what git stores for them), so a line-ending conversion of a checkout does not break the pin.
Output: JSON with indent 2 and sorted keys, UTF-8, LF. Standard library, numpy and Pillow (as compare_reference_runs.py).
"""
import argparse
import hashlib
import json
import os
import sys

import build_reference_checkpoint as base_builder
import compare_reference_runs as compare

SCHEMA = "st01c-reference-profiled-checkpoint/1"
PROFILE_ID = "controlled-sdr/v1"
BASE_CHECKPOINT = "docs/delivery/st01c/basichit/reference-checkpoint.json"
ENGINE_VERSION_FILE = "C:/Program Files/Epic Games/UE_5.8/Engine/Build/Build.version"
CODE_FILES = (
    "tools/unreal-niagara-probe/capture_reference_profiled.py",
    "tools/unreal-niagara-probe/capture_profile.py",
    "tools/unreal-niagara-probe/capture_reference.py",
    "tools/unreal-niagara-probe/ST01cProbe/Source/ST01cProbe/Private/ST01cRuntimeProbe.cpp",
    "tools/unreal-niagara-probe/ST01cProbe/Source/ST01cProbe/Public/ST01cRuntimeProbe.h",
    "tools/unreal-niagara-probe/ST01cProbe/Source/ST01cProbe/Private/ST01cSpec.h",
    ".scratch/unreal/Content/Python/test_st01c_reference_profiled.py",
    "tools/unreal-niagara-probe/build_profiled_checkpoint.py",
    "tools/unreal-niagara-probe/check_profiled_checkpoint.py",
    "tools/unreal-niagara-probe/compare_reference_runs.py",
    "tools/unreal-niagara-probe/build_reference_checkpoint.py",
    "tools/unreal-niagara-probe/frame_from_particles.py",
    "tools/unreal-niagara-probe/check_reference_checkpoint.py",
)
# The plugin the scratch project loads (built 2026-10-20 from the pinned source; no rebuild in this ticket).
BINARY_FILES = (".scratch/unreal/Plugins/ST01cProbe/Binaries/Win64/UnrealEditor-ST01cProbe.dll",)
COMMAND = ("& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' "
           "'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -d3d11 -RenderOffscreen -unattended "
           "-nop4 -nosplash -nosound '-ExecCmds=Automation RunTests Editor.Python.ST01c_Pilot.test_st01c_reference_profiled' "
           "'-TestExit=Automation Test Queue Empty' -CaptureRun=<name> "
           "'-SystemSpec=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-basichit.json'")
# Author-recorded: Stopwatch wall time around the PowerShell command (seconds), and every attempt that did not
# become a final run (none so far: both names completed on their first launch).
FINAL_WALL_SECONDS = {"basichit-reference05": 100.9, "basichit-reference06": 102.7}
ATTEMPTS = ()


def text_sha256(path):
    """sha256 of a text file with CRLF turned into LF; None when the file is missing."""
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as stream:
        return hashlib.sha256(stream.read().replace(b"\r\n", b"\n")).hexdigest()


def engine_version():
    try:
        with open(ENGINE_VERSION_FILE, "r", encoding="utf-8") as stream:
            data = json.load(stream)
        return "%d.%d.%d-%d+%s" % (data["MajorVersion"], data["MinorVersion"], data["PatchVersion"], data["Changelist"],
                                   data["BranchName"])
    except (OSError, ValueError, KeyError):
        return None


def expected_files(capture):
    """Relative names a complete profiled run holds: the capture_reference.py set plus one raw HDR per PNG."""
    png, hdr, particles, textures = compare.expected_files(capture)
    raw = [name[:-len(".png")] + "_hdr.rgba16f" for name in png]
    return png, raw, hdr, particles, textures


def run_listing(run):
    rows = []
    for folder, _, names in os.walk(run):
        for name in names:
            rows.append(os.path.relpath(os.path.join(folder, name), run).replace("\\", "/"))
    return sorted(rows)


def png_pixels_differing(run_a, run_b, rel):
    """Decoded RGBA pixels that differ in any channel (Pillow, as compare_reference_runs.py decodes), or None."""
    from PIL import Image
    import numpy as np
    path_a, path_b = os.path.join(run_a, rel), os.path.join(run_b, rel)
    if not (os.path.isfile(path_a) and os.path.isfile(path_b)):
        return None
    a, b = Image.open(path_a).convert("RGBA"), Image.open(path_b).convert("RGBA")
    if a.size != b.size:
        return None
    return int((np.asarray(a) != np.asarray(b)).any(axis=2).sum())


def pair_identity(run_a, run_b, capture):
    """The two runs compared section by section, as numbers (recomputed by the checker)."""
    png, raw, hdr, particles, textures = expected_files(capture)
    same = lambda names: [name for name in names if compare.same_bytes(run_a, run_b, name)]
    png_rows = [{"file": name, "differingPixels": png_pixels_differing(run_a, run_b, name),
                 "maxChannelDifference": compare.png_difference(run_a, run_b, name)} for name in png]
    reports = [compare.load_json(os.path.join(run, "capture-report.json")) for run in (run_a, run_b)]
    keys = {key: key in reports[0] and reports[0][key] == reports[1].get(key)
            for key in ("settings", "seed_configuration", "counts", "capture_profile")}
    sections = {"particles": (same(particles), particles), "rgba16f": (same(raw), raw), "rgbe": (same(hdr), hdr),
                "textures": (same(textures), textures)}
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


def base_particles(run, base, capture):
    """Particle states of run against the base run, byte for byte, with the first differing step; the exported
    textures too (same assets, so the same bytes)."""
    _, _, _, particles, textures = expected_files(capture)
    differing = [name for name in particles if not compare.same_bytes(run, base, name)]
    return {"identical": len(particles) - len(differing), "total": len(particles),
            "firstDifference": differing[0] if differing else None,
            "texturesIdentical": sum(1 for name in textures if compare.same_bytes(run, base, name)),
            "texturesTotal": len(textures)}


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--spec", required=True)
    parser.add_argument("--a", required=True, help="reference run folder")
    parser.add_argument("--b", required=True, help="repeat run folder")
    parser.add_argument("--base", required=True, help="earlier reference run of the same spec (particle states)")
    parser.add_argument("--out", required=True)
    parser.add_argument("--root", help="repository root (default: two levels above this script)")
    args = parser.parse_args(argv)
    root = os.path.abspath(args.root or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    spec = compare.load_json(args.spec)
    capture = spec["capture"]
    run_a, run_b, base = (os.path.basename(os.path.abspath(p)) for p in (args.a, args.b, args.base))
    report_a = compare.load_json(os.path.join(args.a, "capture-report.json"))
    report_b = compare.load_json(os.path.join(args.b, "capture-report.json"))
    spec_sha = base_builder.sha256_of(args.spec)
    for name, report in ((run_a, report_a), (run_b, report_b)):
        if report.get("status") != "complete" or report["system_spec"]["sha256"] != spec_sha:
            print("ERROR %s is not complete or was captured with another spec" % name, file=sys.stderr)
            return 2
        if report.get("capture_profile", {}).get("id") != PROFILE_ID:
            print("ERROR %s was not captured under %s" % (name, PROFILE_ID), file=sys.stderr)
            return 2
    png, raw, hdr, particles, textures = expected_files(capture)
    expected = sorted(png + raw + hdr + particles + textures + ["capture-report.json"])
    runs = []
    for name, folder in ((run_a, args.a), (run_b, args.b)):
        listing = run_listing(folder)
        if listing != expected:
            print("ERROR %s does not hold exactly the expected files: missing %s extra %s" % (
                name, sorted(set(expected) - set(listing))[:3], sorted(set(listing) - set(expected))[:3]), file=sys.stderr)
            return 2
        runs.append({"name": name, "role": "final", "wallSeconds": FINAL_WALL_SECONDS.get(name), "outcome": "complete",
                     "files": [{"file": rel, "sha256": base_builder.sha256_of(os.path.join(folder, rel))} for rel in expected]})
    pair = pair_identity(args.a, args.b, capture)
    checkpoint = {
        "schema": SCHEMA,
        "engine": engine_version(),
        "system": {"package": spec["systemPackage"], "sourceSystemSha256": spec["sourceSystemSha256"],
                   "spec": {"file": base_builder.rel(args.spec, root), "sha256": spec_sha,
                            "sha256Lf": text_sha256(args.spec)}},
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
                   "particleSteps": len(particles), "textures": len(textures), "runFiles": len(expected)},
        "pair": pair,
        "base": dict(base_particles(args.a, args.base, capture), run=base, checkpoint=BASE_CHECKPOINT),
        "visiblePixelsGt16": {row["file"]: row["visible_pixels_gt16"] for row in [report_a["empty_baseline"]] + report_a["images"]},
        "codeHashes": {path: text_sha256(os.path.join(root, path)) for path in CODE_FILES},
        "binaryHashes": {path: base_builder.sha256_of(os.path.join(root, path)) for path in BINARY_FILES},
        "hashing": ("runs[].files, binaryHashes and system.spec.sha256 (the hash the capture recorded): raw bytes; "
                    "codeHashes and system.spec.sha256Lf: text with CRLF turned into LF"),
        "scope": ("Reference pair of NS_BasicHit under controlled-sdr/v1 with raw RGBA16F HDR at every image step; "
                  "no visual fidelity, native render or final framing is claimed."),
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
    print("checkpoint written: %d files per run, pair %s, particles vs %s %d/%d" % (
        len(expected), pair["result"], base, base_row["identical"], base_row["total"]))
    return 0 if (pair["result"] == "equal" and base_row["identical"] == base_row["total"]
                 and base_row["texturesIdentical"] == base_row["texturesTotal"]) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
