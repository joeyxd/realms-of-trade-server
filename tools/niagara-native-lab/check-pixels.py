"""Compare two run folders PNG by PNG on decoded RGBA pixels; PNG container bytes are not evidence."""
import fnmatch
import hashlib
import sys
from pathlib import Path
from PIL import Image, ImageChops

USAGE = 'usage: check-pixels.py <folder-a> <folder-b> [--exclude <glob> ...]'


def pngs(folder):
    return {p.relative_to(folder).as_posix() for p in folder.rglob('*') if p.is_file() and p.suffix.lower() == '.png'}


def decoded(path):
    with Image.open(path) as image:
        return image.convert('RGBA')


def difference(a, b):
    # Per-pixel maximum channel difference; counts pixels that differ in any channel by any amount.
    bands = ImageChops.difference(a, b).split()
    peak = bands[0]
    for band in bands[1:]:
        peak = ImageChops.lighter(peak, band)
    changed = sum(peak.point(lambda v: 255 if v else 0).histogram()[255:])
    return changed, peak.getextrema()[1]


def main(argv):
    excludes, folders = [], []
    while argv:
        arg = argv.pop(0)
        if arg == '--exclude':
            if not argv:
                raise SystemExit(USAGE)
            excludes.append(argv.pop(0))
        else:
            folders.append(Path(arg))
    if len(folders) != 2 or not all(f.is_dir() for f in folders):
        raise SystemExit(USAGE)
    a, b = folders
    names_a, names_b = pngs(a), pngs(b)
    compared = identical = 0
    for name in sorted(names_a | names_b):
        if any(fnmatch.fnmatchcase(name, pattern) for pattern in excludes):
            print(f'excluded {name}')
            continue
        compared += 1
        if name not in names_a or name not in names_b:
            print(f'MISSING {name} only in {"b" if name not in names_a else "a"}')
            continue
        image_a, image_b = decoded(a / name), decoded(b / name)
        if image_a.size != image_b.size:
            print(f'DIFFERENT {name} size {image_a.size[0]}x{image_a.size[1]} vs {image_b.size[0]}x{image_b.size[1]}')
            continue
        if image_a.tobytes() != image_b.tobytes():
            changed, peak = difference(image_a, image_b)
            print(f'DIFFERENT {name} pixels {changed} max-channel-delta {peak}')
            continue
        identical += 1
        digest = hashlib.sha256(image_a.tobytes()).hexdigest()[:12]
        print(f'identical {name} {image_a.size[0]}x{image_a.size[1]} rgba-sha256 {digest}')
    print(f'identical {identical}/{compared}')
    # Fail closed: any difference, any missing file, or nothing compared at all.
    return 0 if compared and identical == compared else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
