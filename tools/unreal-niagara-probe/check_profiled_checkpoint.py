"""Re-verify the checkpoint of the reference pair captured under the controlled SDR color profile.

python check_profiled_checkpoint.py [<checkpoint.json>] [--root <repo>]
(default checkpoint: docs/delivery/st01c/basichit/reference-profiled-checkpoint.json)

Driven by the checkpoint (schema st01c-reference-profiled-checkpoint/1); nothing it states is trusted without a
recomputation:
- spec: the spec text hash, and each run holding exactly the files the spec capture block implies (PNG frames, one raw
  RGBA16F per PNG, the linear-step Radiance files, the particle states, the textures, capture-report.json);
- runs: every file of both runs re-hashed, and no other file in the run folders;
- profile: the capture-report profile of both runs equal to the pinned one, id controlled-sdr/v1, the cvar read-back
  equal to the request, LDR target gamma 2.2, AntiAliasing off, persistent view state;
- pair: recomputed from the files (decoded PNG pixels, raw HDR bytes, Radiance bytes, particle states, textures,
  report keys) and printed;
- base: the base run still matches its own checkpoint pins, and the particle states of the reference run equal it;
- code and binary hashes.
One line per section, then RESULT OK or mismatch. Exit 0 only when every section matches, 1 on a mismatch, 2 on a
usage or input error. Uses build_profiled_checkpoint.py, compare_reference_runs.py and check_reference_checkpoint.py
as libraries.
"""
import argparse
import json
import os
import sys

import build_profiled_checkpoint as builder
import check_reference_checkpoint as base_checker
import compare_reference_runs as compare

DEFAULT = os.path.join("docs", "delivery", "st01c", "basichit", "reference-profiled-checkpoint.json")


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
        spec_entry, base = data["system"]["spec"], data["base"]
        if sorted(folders) != sorted([run_a, run_b]):
            raise ValueError("runs must be exactly the reference and the repeat run")
    except (OSError, ValueError, KeyError, TypeError) as error:
        print("ERROR cannot read the checkpoint: %s" % error, file=sys.stderr)
        return 2

    sections = []
    spec_path = os.path.join(root, spec_entry["file"])
    problem, capture = None, None
    if builder.text_sha256(spec_path) != spec_entry["sha256Lf"]:
        problem = "spec %s text sha256 %s, checkpoint %s" % (spec_entry["file"], builder.text_sha256(spec_path), spec_entry["sha256Lf"])
    else:
        capture = compare.load_json(spec_path)["capture"]
        png, raw, hdr, particles, textures = builder.expected_files(capture)
        expected = sorted(png + raw + hdr + particles + textures + ["capture-report.json"])
        for row in data["runs"]:
            if sorted(f["file"] for f in row["files"]) != expected:
                problem = "%s: pinned files differ from the spec capture block" % row["name"]
    sections.append(("spec", "%s, %d files per run" % (spec_entry["file"], len(data["runs"][0]["files"])), problem))

    problem = None
    for row in data["runs"]:
        folder = folders[row["name"]]
        count, problem = base_checker.check_rows([(row["name"] + "/" + f["file"], os.path.join(folder, f["file"]), f["sha256"])
                                                  for f in row["files"]])
        if problem is None and os.path.isdir(folder) and builder.run_listing(folder) != sorted(f["file"] for f in row["files"]):
            extra = sorted(set(builder.run_listing(folder)) - set(f["file"] for f in row["files"]))
            problem = "%s holds files the checkpoint does not pin: %s" % (row["name"], extra[:3])
        if problem:
            break
    sections.append(("runs", "%s and %s, %d files each" % (run_a, run_b, len(data["runs"][0]["files"])), problem))

    problem, detail = "not checked (runs mismatch)", "not read"
    if sections[1][2] is None:
        reports = {name: compare.load_json(os.path.join(folders[name], "capture-report.json")) for name in (run_a, run_b)}
        profile = data["profile"]
        readback = profile.get("readback", {})
        flags = {row["name"]: row["enabled"] for row in readback.get("show_flag_settings", [])}
        checks = [
            (reports[run_a].get("capture_profile") == profile, "%s capture_profile differs from the checkpoint" % run_a),
            (reports[run_b].get("capture_profile") == profile, "%s capture_profile differs from %s" % (run_b, run_a)),
            (profile.get("id") == builder.PROFILE_ID, "profile id is not " + builder.PROFILE_ID),
            (profile.get("cvars_readback") == profile.get("cvars_requested"), "cvar read-back differs from the request"),
            (abs(readback.get("ldr_target", {}).get("target_gamma", 0) - 2.2) < 1e-6, "LDR target gamma is not 2.2"),
            (flags.get("AntiAliasing") is False, "AntiAliasing is not off"),
            (readback.get("always_persist_rendering_state") is True, "persistent view state is off"),
            (reports[run_a]["system_spec"]["sha256"] == spec_entry["sha256"], "the capture recorded another spec hash"),
        ]
        # The code each run executed (hashed by the capture itself) is the code pinned here.
        for name in (run_a, run_b):
            for row in reports[name].get("capture_code", []):
                checks.append((data["codeHashes"].get(row["file"]) == row["sha256"],
                               "%s ran %s with sha256 %s, the checkpoint pins %s" % (
                                   name, row["file"], row["sha256"], data["codeHashes"].get(row["file"]))))
            checks.append((len(reports[name].get("capture_code", [])) == 4, "%s does not record its 4 code files" % name))
        failed = [text for ok, text in checks if not ok]
        problem = failed[0] if failed else None
        detail = "%s; cvars %s; LDR %s gamma %s, HDR %s; AntiAliasing off; persistent view state" % (
            profile.get("id"), ", ".join("%s %g" % (k, v) for k, v in (profile.get("cvars_readback") or {}).items()),
            readback.get("ldr_target", {}).get("render_target_format"), readback.get("ldr_target", {}).get("target_gamma"),
            readback.get("hdr_target", {}).get("render_target_format"))
    sections.append(("profile", detail, problem))

    problem, detail = "not checked (spec or runs mismatch)", "not computed"
    if capture is not None and sections[1][2] is None:
        problem = None
        pair = builder.pair_identity(folders[run_a], folders[run_b], capture)
        png_rows = pair["png"]
        detail = ("%s vs %s: png %d/%d with 0 differing pixels (%s differing pixels in total, %d byte-identical files); "
                  "rgba16f %d/%d byte-identical; rgbe %d/%d byte-identical; particles %d/%d identical; textures %d/%d; "
                  "report keys %s" % (run_a, run_b, png_rows["withZeroDifferingPixels"], png_rows["total"],
                                      png_rows["differingPixels"], png_rows["byteIdentical"],
                                      pair["rgba16f"]["identical"], pair["rgba16f"]["total"], pair["rgbe"]["identical"],
                                      pair["rgbe"]["total"], pair["particles"]["identical"], pair["particles"]["total"],
                                      pair["textures"]["identical"], pair["textures"]["total"],
                                      ", ".join("%s %s" % (k, "equal" if v else "differs") for k, v in pair["reportKeysEqual"].items())))
        if pair["result"] != "equal":
            problem = "the two runs differ: " + json.dumps({k: v.get("differing") for k, v in pair.items() if isinstance(v, dict) and v.get("differing")})[:300]
        elif pair != data["pair"]:
            problem = "recomputed pair section differs from the checkpoint"
    sections.append(("pair", detail, problem))

    problem, detail = "not checked (spec or runs mismatch)", "not computed"
    if capture is not None and sections[1][2] is None:
        problem = None
        base_dir = os.path.join(runs_dir, base["run"])
        base_data = compare.load_json(os.path.join(root, base["checkpoint"]))
        pins = {row["file"]: row["sha256"] for row in base_data["referenceFiles"]}
        _, _, _, particles, textures = builder.expected_files(capture)
        if base_data["referenceRun"] != base["run"]:
            problem = "%s does not pin %s" % (base["checkpoint"], base["run"])
        else:
            count, problem = base_checker.check_rows([(base["run"] + "/" + name, os.path.join(base_dir, name), pins.get(name))
                                                      for name in particles + textures])
        if problem is None:
            row = builder.base_particles(folders[run_a], base_dir, capture)
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

    problem = None
    for code_path, digest in sorted(data["codeHashes"].items()):
        actual = builder.text_sha256(os.path.join(root, code_path))
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
