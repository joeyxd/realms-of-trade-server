# Cut painted item sheets (flat magenta background) into the UI kit icon atlases and the recipe hero art.
# Usage: python tools/crafting-ui/icons.py <repo-root> [--singles <dir>]
# Sources live in docs/art/crafting-ui-v1/source and docs/art/ui-kit-v1/source (not served). Runtime derivatives:
# assets/ui/kit/{items,gear,misc}[-mobile].webp (shared by every panel) and assets/ui/crafting/hero-*.webp.
# --singles also writes every cut icon as a transparent PNG at source resolution (image-to-3D input, not served).
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image

ARGS = sys.argv[1:]
SINGLES = None
if '--singles' in ARGS:
    at = ARGS.index('--singles')
    SINGLES = Path(ARGS[at + 1]).resolve()
    del ARGS[at:at + 2]
ROOT = Path(ARGS[0] if ARGS else '.').resolve()
SRC = ROOT / 'docs' / 'art' / 'crafting-ui-v1' / 'source'
SRC_KIT = ROOT / 'docs' / 'art' / 'ui-kit-v1' / 'source'
KIT = ROOT / 'assets' / 'ui' / 'kit'
HEROES = ROOT / 'assets' / 'ui' / 'crafting'
CELL, CELL_MOBILE = 128, 64
HERO, HERO_MOBILE = 512, 256

# sheet file, columns, rows, cell index -> id. Atlas orders below must match ICON_ATLASES in src/ui/kit.js.
SHEETS = [
    (SRC / 'sheet-a.png', 4, 4, {0: 'hacha_piedra', 3: 'agua', 4: 'madera', 7: 'fruta', 12: 'pescado'}),
    (SRC / 'sheet-b.png', 4, 4, {0: 'pico_piedra', 1: 'tronco', 2: 'piedra', 3: 'mineral_hierro', 4: 'hierro', 5: 'harina',
                                 6: 'galleta', 7: 'ron', 8: 'cana', 9: 'azufre', 10: 'lona', 11: 'polvora', 12: 'balas',
                                 13: 'tabaco', 14: 'especias', 15: 'seda'}),
    (SRC / 'sheet-c.png', 3, 2, {0: 'hero:hacha_piedra', 1: 'hero:pico_piedra', 2: 'hero:madera', 3: 'coral', 4: 'perlas'}),
    # Gear bases (data/items.js BASES), in their catalog order.
    (SRC_KIT / 'sheet-d.png', 5, 4, {i: k for i, k in enumerate(
        ['sable', 'daga', 'ancla', 'chispa', 'duelo', 'trabuco', 'panuelo', 'tricornio', 'sombrero', 'chaleco',
         'casaca', 'coraza', 'botas', 'altas', 'viento', 'anillo', 'diente', 'brujula', 'amuleto', 'moneda'])}),
    # Upcoming recipes and UI objects.
    (SRC_KIT / 'sheet-e.png', 4, 4, {i: k for i, k in enumerate(
        ['antorcha', 'lanza', 'arpon', 'cuerda', 'arco', 'flechas', 'fogata', 'potion', 'crate', 'crate2', 'crate3',
         'mochila', 'cinturon', 'oro', 'mapa', 'diario'])}),
]
ATLASES = {
    'items': (6, ['hacha_piedra', 'pico_piedra', 'madera', 'tronco', 'piedra', 'mineral_hierro', 'hierro', 'pescado', 'fruta',
                  'harina', 'galleta', 'ron', 'agua', 'cana', 'azufre', 'lona', 'polvora', 'balas', 'tabaco', 'especias',
                  'seda', 'coral', 'perlas']),
    'gear': (5, ['sable', 'daga', 'ancla', 'chispa', 'duelo', 'trabuco', 'panuelo', 'tricornio', 'sombrero', 'chaleco',
                 'casaca', 'coraza', 'botas', 'altas', 'viento', 'anillo', 'diente', 'brujula', 'amuleto', 'moneda']),
    'misc': (4, ['antorcha', 'lanza', 'arpon', 'cuerda', 'arco', 'flechas', 'fogata', 'potion', 'crate', 'crate2', 'crate3',
                 'mochila', 'cinturon', 'oro', 'mapa', 'diario']),
}


def key_out(cell):
    """Alpha from the cell's own key colour (sheets vary from hot pink to violet) or strong magenta, then un-mix the key
    colour from soft edges and glows (despill)."""
    a = np.asarray(cell.convert('RGB'), np.float32) / 255
    k = max(2, int(min(a.shape[:2]) * 0.03))
    ring = np.concatenate([a[:k].reshape(-1, 3), a[-k:].reshape(-1, 3), a[:, :k].reshape(-1, 3), a[:, -k:].reshape(-1, 3)])
    m = np.median(ring, axis=0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    magenta = np.clip(np.minimum(r, b) - g, 0, 1) * np.clip((np.minimum(r, b) - 0.35) / 0.4, 0, 1)
    near = 1 - np.clip((np.sqrt(((a - m) ** 2).sum(axis=2)) - 0.10) / 0.22, 0, 1)
    alpha = 1 - np.maximum(np.clip((magenta - 0.28) / 0.42, 0, 1), near)
    safe = np.maximum(alpha, 1e-3)[..., None]
    rgb = np.clip((a - (1 - alpha)[..., None] * m) / safe, 0, 1)
    rgba = np.concatenate([rgb, alpha[..., None]], axis=2)
    return Image.fromarray((rgba * 255).round().astype(np.uint8), 'RGBA')


def fit(img, size, pad=0.06):
    box = img.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    if box:
        img = img.crop(box)
    side = max(img.width, img.height)
    side = int(side * (1 + 2 * pad))
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((side - img.width) // 2, (side - img.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def main():
    KIT.mkdir(parents=True, exist_ok=True)
    HEROES.mkdir(parents=True, exist_ok=True)
    cut = {}
    for path, cols, rows, mapping in SHEETS:
        if not path.exists():
            print('missing', path)
            continue
        sheet = Image.open(path).convert('RGB')
        cw, ch = sheet.width / cols, sheet.height / rows
        inset = round(min(cw, ch) * 0.025)
        for index, ident in mapping.items():
            x, y = index % cols, index // cols
            box = (round(x * cw) + inset, round(y * ch) + inset, round((x + 1) * cw) - inset, round((y + 1) * ch) - inset)
            cut[ident] = key_out(sheet.crop(box))
    report = {}
    for name, (cols, ids) in ATLASES.items():
        rows = -(-len(ids) // cols)
        for size, suffix in ((CELL, ''), (CELL_MOBILE, '-mobile')):
            atlas = Image.new('RGBA', (cols * size, rows * size), (0, 0, 0, 0))
            for n, ident in enumerate(ids):
                if ident in cut:
                    atlas.alpha_composite(fit(cut[ident], size), ((n % cols) * size, (n // cols) * size))
            atlas.save(KIT / f'{name}{suffix}.webp', 'WEBP', quality=90 if not suffix else 84, method=6)
        report[name] = {'cols': cols, 'rows': rows, 'missing': [i for i in ids if i not in cut]}
    for ident, img in cut.items():
        if not ident.startswith('hero:'):
            continue
        rid = ident.split(':', 1)[1]
        full = fit(img, HERO, pad=0.02)
        full.save(HEROES / f'hero-{rid}.webp', 'WEBP', quality=88, method=6)
        full.resize((HERO_MOBILE, HERO_MOBILE), Image.LANCZOS).save(HEROES / f'hero-{rid}-mobile.webp', 'WEBP', quality=84, method=6)
    if SINGLES:
        SINGLES.mkdir(parents=True, exist_ok=True)
        for ident, img in cut.items():
            name = ident.replace('hero:', 'hero-')
            fit(img, max(img.width, img.height), pad=0.04).save(SINGLES / f'{name}.png', optimize=True)
        report['singles'] = {'dir': str(SINGLES), 'count': len(cut)}
    print(json.dumps(report))


main()
