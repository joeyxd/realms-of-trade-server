#!/usr/bin/env python3
"""Convert the board card illustrations (PNG) into WebP derivatives for docs/board/img.

Usage: python tools/board/images.py --src <folder with PNGs> --out docs/board/img [--width 960] [--quality 82]
The PNG sources are never copied into the repo. Pillow only.
"""
import argparse
import os
import sys

from PIL import Image


def main():
    parser = argparse.ArgumentParser(description="PNG -> WebP for the board cards")
    parser.add_argument("--src", required=True, help="folder with the source PNG files")
    parser.add_argument("--out", required=True, help="output folder for the WebP files")
    parser.add_argument("--width", type=int, default=960)
    parser.add_argument("--quality", type=int, default=82)
    args = parser.parse_args()

    names = sorted(n for n in os.listdir(args.src) if n.lower().endswith(".png")) if os.path.isdir(args.src) else []
    if not names:
        print("no PNG files in " + args.src, file=sys.stderr)
        return 1

    os.makedirs(args.out, exist_ok=True)
    count = 0
    for name in names:
        with Image.open(os.path.join(args.src, name)) as im:
            im = im.convert("RGB")
            height = max(1, round(im.height * args.width / im.width))
            im = im.resize((args.width, height), Image.LANCZOS)
            target = os.path.join(args.out, os.path.splitext(name)[0] + ".webp")
            im.save(target, "WEBP", quality=args.quality, method=6)
        print("%s %dx%d %d" % (os.path.basename(target), args.width, height, os.path.getsize(target)))
        count += 1
    print("converted %d files" % count)
    return 0


if __name__ == "__main__":
    sys.exit(main())
