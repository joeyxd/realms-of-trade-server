"""Re-verify the checkpoint of the depth reference pair (NS_BasicHit with opaque black planes, controlled-sdr/v1).

python check_depth_checkpoint.py [<checkpoint.json>] [--root <repo>]
(default checkpoint: docs/delivery/st01c/basichit/depth-reference-checkpoint.json)

Driven by the checkpoint (schema st01c-depth-reference-checkpoint/1); nothing it states is trusted without a recomputation:
- spec: the system spec and surface spec text hashes, and each run holding exactly the files the two specs imply (control
  and surface PNG frames, one raw RGBA16F per PNG, the linear-step Radiance files, the depth files, the particle states, the
  textures, capture-report.json);
- runs: every file of both runs re-hashed, and no other file in the run folders;
- profile: as check_profiled_checkpoint.py (profile id, cvar read-back, LDR gamma 2.2, AntiAliasing off, persistent view
  state), the 5 code files each run recorded equal to the pinned ones;
- pair: recomputed from the files (decoded PNG pixels, raw HDR, Radiance and depth bytes, particle states, textures, report
  keys and surface rows) and printed;
- base: the particle states of the reference run equal to the base run, which still matches its own checkpoint pins;
- controls: the control LDR PNGs (decoded pixels) and raw HDR files of the reference run equal to the same step and camera of
  the controls run, which still matches its own checkpoint pins;
- surfaces: one row per pose and image step with the geometry of surface_spec.py, the depth files, and for every wall the
  depth at the image center within 1 cm of cameraDistance + offset (the four values per camera are printed);
- code and binary hashes.
One line per section, then RESULT OK or mismatch. Exit 0 only when every section matches, 1 on a mismatch, 2 on a usage or
input error. Uses build_depth_checkpoint.py, build_profiled_checkpoint.py, compare_reference_runs.py and
check_reference_checkpoint.py as libraries.
"""
import argparse
import json
import os
import sys

import build_depth_checkpoint as builder
import build_profiled_checkpoint as profiled
import check_reference_checkpoint as base_checker
import compare_reference_runs as compare
import surface_spec as surfaces

DEFAULT = os.path.join("docs", "delivery", "st01c", "basichit", "depth-reference-checkpoint.json")


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("checkpoint", nargs="?")
    parser.add_argument("--root", help="repository root (default: two levels above this script)")
    args = parser.parse_args(argv)
    root = os.path.abspath(args.root or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    path = args.checkpoint or os.path.join(root, DEFAULT)
    try:
        with open(path, "r", encoding="utf-8") as stream:
            data = json.load(stream)
        if data.get("schema") != builder.SCHEMA:
            raise ValueError("schema is not " + builder.SCHEMA)
        runs_dir = os.path.join(root, ".scratch", "unreal")
        run_a, run_b = data["referenceRun"], data["repeatRun"]
        folders = {row["name"]: os.path.join(runs_dir, row["name"]) for row in data["runs"]}
        spec_entry, surface_entry, base, controls = data["system"]["spec"], data["surfaceSpec"], data["base"], data["controls"]
        if sorted(folders) != sorted([run_a, run_b]):
            raise ValueError("runs must be exactly the reference and the repeat run")
    except (OSError, ValueError, KeyError, TypeError) as error:
        print("ERROR cannot read the checkpoint: %s" % error, file=sys.stderr)
        return 2

    sections = []
    spec_path, surface_path = os.path.join(root, spec_entry["file"]), os.path.join(root, surface_entry["file"])
    problem, capture, surface = None, None, None
    if profiled.text_sha256(spec_path) != spec_entry["sha256Lf"]:
        problem = "spec %s text sha256 %s, checkpoint %s" % (spec_entry["file"], profiled.text_sha256(spec_path), spec_entry["sha256Lf"])
    elif profiled.text_sha256(surface_path) != surface_entry["sha256Lf"]:
        problem = "surface spec %s text sha256 %s, checkpoint %s" % (
            surface_entry["file"], profiled.text_sha256(surface_path), surface_entry["sha256Lf"])
    else:
        try:
            capture = compare.load_json(spec_path)["capture"]
            surface = surfaces.load_surface_spec(surface_path, capture)
        except (OSError, ValueError, KeyError) as error:
            problem = "cannot load the specs: %s" % error
        if problem is None and surface != surface_entry["content"]:
            problem = "surface spec content differs from the checkpoint"
        if problem is None:
            expected = builder.run_names(capture, surface)
            for row in data["runs"]:
                if sorted(f["file"] for f in row["files"]) != expected:
                    problem = "%s: pinned files differ from the specs" % row["name"]
    sections.append(("spec", "%s and %s, %d files per run" % (spec_entry["file"], surface_entry["file"], len(data["runs"][0]["files"])), problem))
    if problem is not None:
        capture = None

    problem = None
    for row in data["runs"]:
        folder = folders[row["name"]]
        count, problem = base_checker.check_rows([(row["name"] + "/" + f["file"], os.path.join(folder, f["file"]), f["sha256"])
                                                  for f in row["files"]])
        if problem is None and os.path.isdir(folder) and profiled.run_listing(folder) != sorted(f["file"] for f in row["files"]):
            extra = sorted(set(profiled.run_listing(folder)) - set(f["file"] for f in row["files"]))
            problem = "%s holds files the checkpoint does not pin: %s" % (row["name"], extra[:3])
        if problem:
            break
    sections.append(("runs", "%s and %s, %d files each" % (run_a, run_b, len(data["runs"][0]["files"])), problem))
    runs_ok = sections[1][2] is None and capture is not None

    problem, detail = "not checked (spec or runs mismatch)", "not read"
    reports = {}
    if runs_ok:
        reports = {name: compare.load_json(os.path.join(folders[name], "capture-report.json")) for name in (run_a, run_b)}
        profile = data["profile"]
        readback = profile.get("readback", {})
        flags = {row["name"]: row["enabled"] for row in readback.get("show_flag_settings", [])}
        checks = [
            (reports[run_a].get("capture_profile") == profile, "%s capture_profile differs from the checkpoint" % run_a),
            (reports[run_b].get("capture_profile") == profile, "%s capture_profile differs from %s" % (run_b, run_a)),
            (profile.get("id") == profiled.PROFILE_ID, "profile id is not " + profiled.PROFILE_ID),
            (profile.get("cvars_readback") == profile.get("cvars_requested"), "cvar read-back differs from the request"),
            (abs(readback.get("ldr_target", {}).get("target_gamma", 0) - 2.2) < 1e-6, "LDR target gamma is not 2.2"),
            (flags.get("AntiAliasing") is False, "AntiAliasing is not off"),
            (readback.get("always_persist_rendering_state") is True, "persistent view state is off"),
            (reports[run_a]["system_spec"]["sha256"] == spec_entry["sha256"], "the capture recorded another spec hash"),
            (reports[run_a].get("surface_spec", {}).get("sha256") == surface_entry["sha256"], "the capture recorded another surface spec hash"),
        ]
        for name in (run_a, run_b):
            for row in reports[name].get("capture_code", []):
                checks.append((data["codeHashes"].get(row["file"]) == row["sha256"],
                               "%s ran %s with sha256 %s, the checkpoint pins %s" % (
                                   name, row["file"], row["sha256"], data["codeHashes"].get(row["file"]))))
            checks.append((len(reports[name].get("capture_code", [])) == builder.CODE_ROLES,
                           "%s does not record its %d code files" % (name, builder.CODE_ROLES)))
        failed = [text for ok, text in checks if not ok]
        problem = failed[0] if failed else None
        detail = "%s; cvars %s; LDR %s gamma %s, HDR %s; AntiAliasing off; persistent view state" % (
            profile.get("id"), ", ".join("%s %g" % (k, v) for k, v in (profile.get("cvars_readback") or {}).items()),
            readback.get("ldr_target", {}).get("render_target_format"), readback.get("ldr_target", {}).get("target_gamma"),
            readback.get("hdr_target", {}).get("render_target_format"))
    sections.append(("profile", detail, problem))

    problem, detail = "not checked (spec or runs mismatch)", "not computed"
    if runs_ok:
        problem = None
        pair = builder.pair_identity(folders[run_a], folders[run_b], capture, surface)
        png_rows = pair["png"]
        detail = ("%s vs %s: png %d/%d with 0 differing pixels (%s differing pixels in total, %d byte-identical files); "
                  "rgba16f %d/%d byte-identical; rgbe %d/%d byte-identical; depth %d/%d byte-identical; particles %d/%d "
                  "identical; textures %d/%d; report keys %s" % (
                      run_a, run_b, png_rows["withZeroDifferingPixels"], png_rows["total"], png_rows["differingPixels"],
                      png_rows["byteIdentical"], pair["rgba16f"]["identical"], pair["rgba16f"]["total"], pair["rgbe"]["identical"],
                      pair["rgbe"]["total"], pair["depth"]["identical"], pair["depth"]["total"], pair["particles"]["identical"],
                      pair["particles"]["total"], pair["textures"]["identical"], pair["textures"]["total"],
                      ", ".join("%s %s" % (k, "equal" if v else "differs") for k, v in pair["reportKeysEqual"].items())))
        if pair["result"] != "equal":
            problem = "the two runs differ: " + json.dumps({k: v.get("differing") for k, v in pair.items() if isinstance(v, dict) and v.get("differing")})[:300]
        elif pair != data["pair"]:
            problem = "recomputed pair section differs from the checkpoint"
    sections.append(("pair", detail, problem))

    problem, detail = "not checked (spec or runs mismatch)", "not computed"
    if runs_ok:
        problem = None
        base_dir = os.path.join(runs_dir, base["run"])
        base_data = compare.load_json(os.path.join(root, base["checkpoint"]))
        pins = {row["file"]: row["sha256"] for row in base_data["referenceFiles"]}
        _, _, _, particles, textures = profiled.expected_files(capture)
        if base_data["referenceRun"] != base["run"]:
            problem = "%s does not pin %s" % (base["checkpoint"], base["run"])
        else:
            count, problem = base_checker.check_rows([(base["run"] + "/" + name, os.path.join(base_dir, name), pins.get(name))
                                                      for name in particles + textures])
        if problem is None:
            row = profiled.base_particles(folders[run_a], base_dir, capture)
            detail = "particle states of %s vs %s: %d/%d identical, textures %d/%d (base pinned by %s)" % (
                run_a, base["run"], row["identical"], row["total"], row["texturesIdentical"], row["texturesTotal"],
                base["checkpoint"])
            if row["identical"] != row["total"]:
                problem = "particle states differ from %s, first %s" % (base["run"], row["firstDifference"])
            elif row["texturesIdentical"] != row["texturesTotal"]:
                problem = "exported textures differ from %s" % base["run"]
            elif any(row[k] != base.get(k) for k in row):
                problem = "recomputed base section differs from the checkpoint"
    sections.append(("base", detail, problem))

    problem, detail = "not checked (spec or runs mismatch)", "not computed"
    if runs_ok:
        problem = None
        controls_dir = os.path.join(runs_dir, controls["run"])
        controls_data = compare.load_json(os.path.join(root, controls["checkpoint"]))
        pinned = {f["file"]: f["sha256"] for r in controls_data["runs"] if r["name"] == controls["run"] for f in r["files"]}
        names = []
        for row in controls["rows"]:
            names += [row["file"], row["file"][:-len(".png")] + "_hdr.rgba16f"]
            if row["linearHdrIdentical"] is not None:
                names.append("frames/" + os.path.basename(row["file"])[:-len(".png")] + "_linear.hdr")
        if controls_data["referenceRun"] != controls["run"] or not pinned:
            problem = "%s does not pin %s" % (controls["checkpoint"], controls["run"])
        else:
            count, problem = base_checker.check_rows([(controls["run"] + "/" + name, os.path.join(controls_dir, name), pinned.get(name))
                                                      for name in names])
        if problem is None:
            row = builder.controls_identity(folders[run_a], controls_dir, capture)
            detail = ("%s vs %s (pinned by %s): %d control poses, png %d/%d with 0 differing pixels (max channel difference %s, "
                      "%d byte-identical), raw HDR %d/%d byte-identical" % (
                          run_a, row["run"], row["checkpoint"], row["total"], row["pngWithZeroDifferingPixels"], row["total"],
                          row["maxChannelDifference"], row["pngByteIdentical"], row["rawHdrIdentical"], row["total"]))
            if row["result"] != "equal":
                problem = "controls differ from %s: %s" % (row["run"], json.dumps(
                    [r["file"] for r in row["rows"] if r["differingPixels"] != 0 or not r["rawHdrIdentical"]])[:300])
            elif row != controls:
                problem = "recomputed controls section differs from the checkpoint"
    sections.append(("controls", detail, problem))

    problem, detail = "not checked (spec or runs mismatch)", "not computed"
    if runs_ok:
        results = [builder.surface_section(folders[name], reports[name], capture, surface) for name in (run_a, run_b)]
        problem = results[0][0] or results[1][0]
        section = results[0][1]
        centers = "; ".join("%s %s" % (camera, ", ".join("%g" % row["centerDepthCm"] for row in rows))
                            for camera, rows in section["wallCenterDepths"].items())
        worst = max([abs(row["centerDepthCm"] - row["expectedCm"]) for rows in section["wallCenterDepths"].values() for row in rows] or [0])
        detail = ("%d surface rows per run, %d depth files (%s, %dx%d); wall center depths in cm, offsets %s: %s; worst deviation "
                  "from %g + s %.4f cm (limit %g)" % (
                      section["rows"], section["depthFiles"], surfaces.DEPTH_ENCODING, capture["imageSize"], capture["imageSize"],
                      ", ".join(str(s) for s in surface["walls"]["offsetsCm"]), centers, capture["cameraDistance"], worst,
                      builder.DEPTH_TOLERANCE_CM))
        if problem is None and section != data["surfaces"]:
            problem = "recomputed surfaces section differs from the checkpoint"
    sections.append(("surfaces", detail, problem))

    problem = None
    for code_path, digest in sorted(data["codeHashes"].items()):
        actual = profiled.text_sha256(os.path.join(root, code_path))
        if actual != digest:
            problem = "%s: text sha256 %s, checkpoint %s" % (code_path, actual, digest)
            break
    sections.append(("codeHashes", "%d files (text, LF)" % len(data["codeHashes"]), problem))
    count, problem = base_checker.check_rows([(p, os.path.join(root, p), d) for p, d in sorted(data["binaryHashes"].items())])
    sections.append(("binaryHashes", "%d files" % count, problem))

    failed = False
    for name, detail, problem in sections:
        if problem is None:
            print("%s: %s OK" % (name, detail))
        else:
            failed = True
            print("%s: MISMATCH %s" % (name, problem))
    print("RESULT " + ("mismatch" if failed else "OK"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
