"""Compare two reference capture runs of one system, section by section.

python compare_reference_runs.py --spec <systems/*.json> --a <run dir> --b <run dir> [--png-max N] [--json <out>]

The spec names what a run must hold (capture.lastStep, imageSteps, linearStep, cameras,
textures). Sections: CPU particle states and HDR files byte for byte, every PNG frame by
decoded pixels (PNG bytes may differ by metadata, so the largest absolute 8-bit channel
difference is measured), exported textures by sha256, and the capture-report keys
settings, seed_configuration and counts. Exit 0 only when all of them agree and every PNG
difference is <= --png-max (default 0); exit 1 when they differ; exit 2 on a usage or input error.
PNG decoding is the lab decoder (Pillow, as tools/niagara-native-lab/compare-*.py use).
"""
import argparse
import hashlib
import json
import os
import sys


def read_bytes(path):
    with open(path, "rb") as stream:
        return stream.read()


def load_json(path):
    with open(path, "r", encoding="utf-8") as stream:
        return json.load(stream)


def expected_files(capture):
    """Relative names a complete run holds, derived from the spec capture block."""
    names = [camera["name"] for camera in capture["cameras"]]
    png = ["frames/t0000_%s.png" % names[0]]
    for step in capture["imageSteps"]:
        png.extend("frames/t%04d_%s.png" % (step, name) for name in names)
    hdr = ["frames/t%04d_%s_linear.hdr" % (capture["linearStep"], name) for name in names]
    particles = ["particles/step_%04d.json" % step for step in range(capture["lastStep"] + 1)]
    textures = ["textures/%s.png" % texture.rsplit("/", 1)[1] for texture in capture["textures"]]
    return png, hdr, particles, textures


def same_bytes(run_a, run_b, rel):
    path_a, path_b = os.path.join(run_a, rel), os.path.join(run_b, rel)
    if not (os.path.isfile(path_a) and os.path.isfile(path_b)):
        return False
    return read_bytes(path_a) == read_bytes(path_b)


def png_difference(run_a, run_b, rel):
    """Largest absolute channel difference of the decoded RGBA8 pixels, or None if not comparable."""
    from PIL import Image
    import numpy as np
    path_a, path_b = os.path.join(run_a, rel), os.path.join(run_b, rel)
    if not (os.path.isfile(path_a) and os.path.isfile(path_b)):
        return None
    image_a, image_b = Image.open(path_a).convert("RGBA"), Image.open(path_b).convert("RGBA")
    if image_a.size != image_b.size:
        return None
    data_a = np.frombuffer(image_a.tobytes(), dtype=np.uint8).astype(np.int16)
    data_b = np.frombuffer(image_b.tobytes(), dtype=np.uint8).astype(np.int16)
    return int(np.abs(data_a - data_b).max()) if data_a.size else 0


def sha256_of(path):
    return hashlib.sha256(read_bytes(path)).hexdigest() if os.path.isfile(path) else None


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--spec", required=True)
    parser.add_argument("--a", required=True)
    parser.add_argument("--b", required=True)
    parser.add_argument("--png-max", type=int, default=0)
    parser.add_argument("--json")
    args = parser.parse_args(argv)
    try:
        capture = load_json(args.spec)["capture"]
        png, hdr, particles, textures = expected_files(capture)
    except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
        print("ERROR spec %s has no usable capture block: %s" % (args.spec, error), file=sys.stderr)
        return 2
    for run in (args.a, args.b):
        if not os.path.isdir(run):
            print("ERROR run folder not found: " + run, file=sys.stderr)
            return 2
    try:
        import numpy  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError as error:
        print("ERROR the PNG decoder of the lab needs Pillow and numpy: %s" % error, file=sys.stderr)
        return 2

    result = {"a": args.a, "b": args.b, "spec": args.spec}
    particle_same = [rel for rel in particles if same_bytes(args.a, args.b, rel)]
    hdr_same = [rel for rel in hdr if same_bytes(args.a, args.b, rel)]
    png_rows = {rel: png_difference(args.a, args.b, rel) for rel in png}
    png_ok = [rel for rel, diff in png_rows.items() if diff is not None and diff <= args.png_max]
    measured = [diff for diff in png_rows.values() if diff is not None]
    png_max = max(measured) if measured else None
    texture_rows = {rel: [sha256_of(os.path.join(run, rel)) for run in (args.a, args.b)] for rel in textures}
    texture_same = [rel for rel, (x, y) in texture_rows.items() if x is not None and x == y]

    report_rows = {}
    try:
        reports = [load_json(os.path.join(run, "capture-report.json")) for run in (args.a, args.b)]
        for key in ("settings", "seed_configuration", "counts"):
            report_rows[key] = key in reports[0] and key in reports[1] and reports[0][key] == reports[1][key]
    except (OSError, ValueError):
        report_rows = {"settings": False, "seed_configuration": False, "counts": False}

    print("particles %d/%d identical" % (len(particle_same), len(particles)))
    print("hdr %d/%d identical" % (len(hdr_same), len(hdr)))
    print("png %d/%d within %d (max difference %s)" % (len(png_ok), len(png), args.png_max,
                                                      "n/a" if png_max is None else png_max))
    print("textures %d/%d equal" % (len(texture_same), len(textures)))
    print("report " + ", ".join("%s %s" % (key, "equal" if same else "differs") for key, same in report_rows.items()))

    equal = (len(particle_same) == len(particles) and len(hdr_same) == len(hdr) and len(png_ok) == len(png)
             and len(texture_same) == len(textures) and all(report_rows.values()))
    print("RESULT " + ("equal" if equal else "differs"))
    if args.json:
        result.update({
            "pngMax": args.png_max,
            "particles": {"identical": len(particle_same), "total": len(particles),
                          "differing": [rel for rel in particles if rel not in particle_same]},
            "hdr": {"identical": len(hdr_same), "total": len(hdr), "differing": [rel for rel in hdr if rel not in hdr_same]},
            "png": {"maxChannelDifference": png_rows},
            "textures": {rel: {"a": x, "b": y, "equal": rel in texture_same} for rel, (x, y) in texture_rows.items()},
            "report": report_rows, "result": "equal" if equal else "differs"})
        with open(args.json, "w", encoding="utf-8") as stream:
            json.dump(result, stream, indent=2)
    return 0 if equal else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
