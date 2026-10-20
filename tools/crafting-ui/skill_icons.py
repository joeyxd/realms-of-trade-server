"""Build the skill icon atlases and keyed hero WebP assets from source PNGs.
Usage: python skill_icons.py <root> [--out <dir>] [--kit-dir <dir>] [--hero-dir <dir>]
"""
import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont


TREE_IDS = ("combat", "survival", "sailing", "crafting", "trade", "exploration")
COMBAT_A_IDS = ("lunge", "blast", "temple", "wave", "blink", "trigger", "tromba", "leap", "wheel")
COMBAT_B_IDS = ("storm", "rain", "eye", "pearl_affinity", "deluge", "curse_tamed")
IDS = list(TREE_IDS + COMBAT_A_IDS + COMBAT_B_IDS)
HERO_IDS = ("combat", "survival", "sailing", "crafting", "trade")
CELL, MOBILE_CELL = 128, 64
HERO, MOBILE_HERO = 512, 256
NAVY = "#0d1b2b"


def key_out(image):
    """Key the uniform magenta using the reference script's chroma, near-key and despill approach."""
    rgb = image.convert("RGB")
    w, h = rgb.size
    k = max(2, int(min(w, h) * 0.03))
    px = rgb.load()
    ring = []
    for y in range(k):
        ring.extend(px[x, y] for x in range(w))
        ring.extend(px[x, h - 1 - y] for x in range(w))
    for x in range(k):
        ring.extend(px[x, y] for y in range(h))
        ring.extend(px[w - 1 - x, y] for y in range(h))
    channels = [sorted(p[c] for p in ring)[len(ring) // 2] / 255.0 for c in range(3)]
    mr, mg, mb = channels
    out = Image.new("RGBA", (w, h))
    dst = out.load()
    for y in range(h):
        for x in range(w):
            r8, g8, b8 = px[x, y]
            r, g, b = r8 / 255.0, g8 / 255.0, b8 / 255.0
            magenta = min(max(min(r, b) - g, 0.0), 1.0) * min(max((min(r, b) - 0.35) / 0.4, 0.0), 1.0)
            distance = math.sqrt((r - mr) ** 2 + (g - mg) ** 2 + (b - mb) ** 2)
            near = 1.0 - min(max((distance - 0.10) / 0.22, 0.0), 1.0)
            alpha = 1.0 - max(min(max((magenta - 0.28) / 0.42, 0.0), 1.0), near)
            safe = max(alpha, 1e-3)
            dst[x, y] = (
                round(min(max((r - (1.0 - alpha) * mr) / safe, 0.0), 1.0) * 255),
                round(min(max((g - (1.0 - alpha) * mg) / safe, 0.0), 1.0) * 255),
                round(min(max((b - (1.0 - alpha) * mb) / safe, 0.0), 1.0) * 255),
                round(alpha * 255),
            )
    return out


def fit(image, size, padding):
    box = image.getchannel("A").point(lambda value: 255 if value > 24 else 0).getbbox()
    if not box:
        raise ValueError("Keying removed the entire image")
    image = image.crop(box)
    side = max(image.size)
    canvas_side = max(1, round(side * (1 + 2 * padding)))
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    canvas.alpha_composite(image, ((canvas_side - image.width) // 2, (canvas_side - image.height) // 2))
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def recolor(image, ink):
    """Repaint every non-orange pixel of an RGBA glyph with the ink color; alpha and the orange accent are kept."""
    rgba = image.convert("RGBA")
    r, _g, b, a = rgba.split()
    orange = ImageChops.multiply(r.point(lambda v: 255 if v > 190 else 0), b.point(lambda v: 255 if v < 110 else 0))
    out = Image.composite(rgba, Image.new("RGBA", rgba.size, ink), orange)
    out.putalpha(a)
    return out


def remove_magenta_residuals(image):
    """Clear only nearly-transparent magenta edge pixels before lossy WebP encoding."""
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            if a > 0 and r > 200 and b > 200 and g < 120:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def source_paths(root):
    paths = {}
    for ident in TREE_IDS:
        paths[ident] = root / "icons" / "trees" / f"{ident}.png"
    for ident in COMBAT_A_IDS:
        paths[ident] = root / "icons" / "combat-a" / f"{ident}.png"
    for ident in COMBAT_B_IDS:
        paths[ident] = root / "icons" / "combat-b" / f"{ident}.png"
    for ident in HERO_IDS:
        paths[f"hero-{ident}"] = root / "heroes" / f"hero-{ident}.png"
    missing = [str(path) for path in paths.values() if not path.is_file()]
    if missing:
        raise FileNotFoundError("Missing input file(s):\n" + "\n".join(missing))
    return paths


def make_contact(icons, heroes, path):
    width, height = 6 * 128, 5 * 160
    sheet = Image.new("RGBA", (width, height), NAVY)
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default()
    except OSError:
        font = None
    for i, ident in enumerate(IDS):
        x, y = (i % 6) * 128, (i // 6) * 160
        thumb = fit(icons[ident], 64, 0.06)
        sheet.alpha_composite(thumb, (x + 32, y + 9))
        draw.text((x + 5, y + 82), ident, fill="#e8edf4", font=font)
    for i, ident in enumerate(HERO_IDS):
        x, y = i * 128, 4 * 160
        thumb = fit(heroes[ident], 128, 0.04)
        sheet.alpha_composite(thumb, (x, y))
        draw.text((x + 4, y + 132), f"hero-{ident}", fill="#e8edf4", font=font)
    sheet.convert("RGB").save(path, "PNG", optimize=True)


def main():
    parser = argparse.ArgumentParser(description="Cut skill icons and heroes into WebP UI assets.")
    parser.add_argument("root", type=Path, help="Folder containing icons/ and heroes/")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--kit-dir", type=Path)
    parser.add_argument("--hero-dir", type=Path)
    parser.add_argument("--ink", default="#eef3f8", help="Ink color for the icon silhouettes; the orange accent is kept")
    args = parser.parse_args()
    root = args.root.resolve()
    out = (args.out or root / "out").resolve()
    kit_dir = (args.kit_dir or out / "kit").resolve()
    hero_dir = (args.hero_dir or out / "skills").resolve()
    paths = source_paths(root)
    icons = {ident: recolor(key_out(Image.open(paths[ident])), args.ink) for ident in IDS}
    heroes = {ident: key_out(Image.open(paths[f"hero-{ident}"])) for ident in HERO_IDS}
    kit_dir.mkdir(parents=True, exist_ok=True)
    hero_dir.mkdir(parents=True, exist_ok=True)
    for size, filename, quality in ((CELL, "skills.webp", 90), (MOBILE_CELL, "skills-mobile.webp", 84)):
        atlas = Image.new("RGBA", (6 * size, 4 * size), (0, 0, 0, 0))
        for i, ident in enumerate(IDS):
            atlas.alpha_composite(fit(icons[ident], size, 0.06), ((i % 6) * size, (i // 6) * size))
        remove_magenta_residuals(atlas)
        atlas.save(kit_dir / filename, "WEBP", quality=quality, method=6)
    for ident, image in heroes.items():
        full = remove_magenta_residuals(fit(image, HERO, 0.04))
        full.save(hero_dir / f"hero-{ident}.webp", "WEBP", quality=88, method=6)
        mobile = remove_magenta_residuals(full.resize((MOBILE_HERO, MOBILE_HERO), Image.Resampling.LANCZOS))
        mobile.save(
            hero_dir / f"hero-{ident}-mobile.webp", "WEBP", quality=84, method=6
        )
    out.mkdir(parents=True, exist_ok=True)
    make_contact(icons, heroes, out / "contact.png")
    print("IDS " + json.dumps(IDS, separators=(",", ":")))


if __name__ == "__main__":
    main()
