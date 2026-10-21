"""Re-hash everything a reference checkpoint pins.

python check_reference_checkpoint.py <checkpoint.json> [--root <repo>]

Driven by the checkpoint content (schema st01c-reference-checkpoint/1): the spec sha256, every
referenceFiles entry under .scratch/unreal/<referenceRun>/, every textureExports sha256 (and the
source copy package it records, under .scratch/unreal/Content), and every codeHashes entry. It also
checks that referenceFiles lists exactly the files the spec capture block expects. One line per
section with the count and OK, or the first mismatch. Exit 0 only when every section matches,
1 on a mismatch, 2 on a usage or input error. Standard library only.
"""
import argparse
import hashlib
import json
import os
import sys

import compare_reference_runs as compare

SCHEMA = "st01c-reference-checkpoint/1"


def sha256_of(path):
    if not os.path.isfile(path):
        return None
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def check_rows(rows):
    """rows: (label, path, expected sha256). Return (count, first mismatch text or None)."""
    for label, path, expected in rows:
        actual = sha256_of(path)
        if actual is None:
            return len(rows), "%s: file missing (%s)" % (label, path)
        if actual != expected:
            return len(rows), "%s: sha256 %s, checkpoint %s" % (label, actual, expected)
    return len(rows), None


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("checkpoint")
    parser.add_argument("--root", help="repository root (default: two levels above this script)")
    args = parser.parse_args(argv)
    root = os.path.abspath(args.root or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    try:
        with open(args.checkpoint, "r", encoding="utf-8") as stream:
            data = json.load(stream)
        if data.get("schema") != SCHEMA:
            raise ValueError("schema is not " + SCHEMA)
        run_dir = os.path.join(root, ".scratch", "unreal", data["referenceRun"])
        spec_entry = data["system"]["spec"]
        files, textures, codes = data["referenceFiles"], data["textureExports"], data["codeHashes"]
    except (OSError, ValueError, KeyError, TypeError) as error:
        print("ERROR cannot read the checkpoint: %s" % error, file=sys.stderr)
        return 2

    sections = []
    # spec: the pinned spec file hash, and the file list the spec expects against referenceFiles.
    spec_path = os.path.join(root, spec_entry["file"])
    count, problem = check_rows([("spec " + spec_entry["file"], spec_path, spec_entry["sha256"])])
    if problem is None:
        try:
            with open(spec_path, "r", encoding="utf-8") as stream:
                png, hdr, particles, tex = compare.expected_files(json.load(stream)["capture"])
            expected = sorted(png + hdr + particles + tex + ["capture-report.json"])
            listed = sorted(row["file"] for row in files)
            if expected != listed:
                missing = sorted(set(expected) - set(listed))
                extra = sorted(set(listed) - set(expected))
                problem = "referenceFiles differs from the spec capture block: missing %s extra %s" % (missing[:3], extra[:3])
        except (OSError, ValueError, KeyError) as error:
            problem = "spec capture block unreadable: %s" % error
    sections.append(("spec", "1 file, %d expected reference files" % len(files), problem))

    count, problem = check_rows([(row["file"], os.path.join(run_dir, row["file"]), row["sha256"]) for row in files])
    sections.append(("referenceFiles", "%d files in %s" % (count, data["referenceRun"]), problem))

    rows = [("texture " + row["file"], os.path.join(run_dir, row["file"]), row["sha256"]) for row in textures]
    for row in textures:
        if row.get("source_copy_package_sha256"):
            package = row["asset"].split(".", 1)[0]
            relative = package[len("/Game/"):].split("/")
            rows.append(("source copy " + package,
                         os.path.join(root, ".scratch", "unreal", "Content", *relative) + ".uasset",
                         row["source_copy_package_sha256"]))
    count, problem = check_rows(rows)
    sections.append(("textureExports", "%d textures, %d hashes with the source copies" % (len(textures), count), problem))

    count, problem = check_rows([(path, os.path.join(root, path), digest) for path, digest in sorted(codes.items())])
    sections.append(("codeHashes", "%d files" % count, problem))

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
