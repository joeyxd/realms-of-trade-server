# Procedural crafting-panel textures (worn navy frame + orange brush stroke). Deterministic: same seed, same bytes.
# Usage: python -I tools/crafting-ui/textures.py <repo-root>
# Writes desktop and mobile WebP derivatives to assets/ui/kit/ (shared by every panel) and the lossless sources to docs/art/crafting-ui-v1/.
import sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
OUT = ROOT / 'assets' / 'ui' / 'kit'
SRC = ROOT / 'docs' / 'art' / 'crafting-ui-v1'
OUT.mkdir(parents=True, exist_ok=True)
SRC.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(20261010)


def noise(h, w, cells, octaves=4, wrap=False):
    """Fractal value noise in [0, 1]; cells = (rows, cols) of the coarsest octave."""
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    ch, cw = cells
    for _ in range(octaves):
        grid = rng.random((max(2, ch), max(2, cw))).astype(np.float32)
        if wrap:
            grid = np.concatenate([grid, grid[:, :1]], axis=1)
            grid = np.concatenate([grid, grid[:1, :]], axis=0)
        img = Image.fromarray((grid * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += amp * (np.asarray(img, np.float32) / 255)
        total += amp
        amp *= 0.5
        ch, cw = ch * 2, cw * 2
    return out / total


def rgba(arr_rgb, alpha):
    a = np.clip(alpha, 0, 1)[..., None]
    return Image.fromarray(np.concatenate([np.clip(arr_rgb, 0, 255), a * 255], axis=2).astype(np.uint8), 'RGBA')


def hexc(value):
    value = value.lstrip('#')
    return np.array([int(value[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


def save(img, name, mobile_scale=0.5, quality=88):
    img.save(SRC / f'{name}.png')
    img.save(OUT / f'{name}.webp', 'WEBP', quality=quality, method=6)
    small = img.resize((max(1, round(img.width * mobile_scale)), max(1, round(img.height * mobile_scale))), Image.LANCZOS)
    small.save(OUT / f'{name}-mobile.webp', 'WEBP', quality=quality - 6, method=6)


def frame(size=384):
    """9-slice panel: chipped outer edge, mottled navy fill, worn light rim and an inset hairline."""
    h = w = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy))
    edge = noise(h, w, (6, 6), 5) * 0.65 + noise(h, w, (24, 24), 2) * 0.35
    thresh = 2.5 + edge * 9
    chips = noise(h, w, (10, 10), 3)
    thresh += np.where(chips > 0.72, (chips - 0.72) * 40, 0)
    alpha = np.clip((d - thresh) * 0.9, 0, 1)
    base = hexc('#0c1a2a')
    mott = noise(h, w, (5, 5), 5)
    streak = noise(h, w, (40, 3), 2)
    tone = (mott - 0.5) * 0.5 + (streak - 0.5) * 0.12
    col = base[None, None, :] * (1 + tone[..., None])
    col += hexc('#16324c')[None, None, :] * np.clip(mott - 0.62, 0, 1)[..., None] * 0.9
    inner = d - thresh
    wear = np.clip(1 - inner / 4.5, 0, 1) * (inner >= 0)
    col = col * (1 - wear[..., None] * 0.7) + hexc('#35597a')[None, None, :] * wear[..., None] * 0.7
    vign = np.clip(1 - inner / 28, 0, 1) * 0.22
    col *= (1 - vign)[..., None]
    line_d = np.abs(inner - 7.5)
    breaks = noise(h, w, (14, 14), 2) > 0.33
    hair = np.clip(1.1 - line_d, 0, 1) * breaks * 0.55
    col = col * (1 - hair[..., None]) + hexc('#7d9cbb')[None, None, :] * hair[..., None]
    for cy, cx in ((15, 15), (15, w - 16), (h - 16, 15), (h - 16, w - 16)):
        r = np.hypot(yy - cy, xx - cx)
        rim = np.clip(4.6 - r, 0, 1)
        col = col * (1 - rim[..., None]) + hexc('#7f93a6')[None, None, :] * rim[..., None]
        head = np.clip(3.3 - r, 0, 1)
        col = col * (1 - head[..., None]) + hexc('#1d2a37')[None, None, :] * head[..., None]
        glint = np.clip(1.4 - np.hypot(yy - cy + 1.2, xx - cx + 1.2), 0, 1)
        col = col * (1 - glint[..., None] * 0.8) + hexc('#c9d7e4')[None, None, :] * glint[..., None] * 0.8
    return rgba(col, alpha)


def brush(w=720, h=150, ink_on=True):
    """Horizontal orange dry-brush stroke with ragged bristle ends and (optionally) ink splatter."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    row = noise(h, 1, (9, 1), 4)[:, 0]
    row2 = noise(h, 1, (13, 1), 4)[:, 0]
    fine = rng.random(h).astype(np.float32)
    left = 26 + row * 70 + (fine > 0.86) * rng.random(h) * 60
    right = w - 22 - row2 * 80 - (fine < 0.12) * rng.random(h) * 70
    lx = np.clip((xx - left[:, None]) / 10, 0, 1)
    rx = np.clip((right[:, None] - xx) / 10, 0, 1)
    top = 6 + noise(1, w, (1, 18), 3)[0] * 16
    bot = h - 6 - noise(1, w, (1, 18), 3)[0] * 16
    ty = np.clip((yy - top[None, :]) / 3, 0, 1)
    by = np.clip((bot[None, :] - yy) / 3, 0, 1)
    alpha = lx * rx * ty * by
    bristle = noise(h, w, (60, 2), 3)
    end = np.clip(1 - np.minimum(xx - left[:, None], right[:, None] - xx) / 110, 0, 1)
    gaps = (bristle < 0.2 + end * 0.32) & (end > 0.3)
    alpha = alpha * np.where(gaps, 0.0, 1.0)
    alpha *= np.clip(noise(h, w, (3, 30), 3) * 3.2 - 0.2, 0.93, 1)
    streak = noise(h, w, (70, 1), 3)
    tone = 0.9 + streak * 0.16 + noise(h, w, (4, 8), 4) * 0.06
    col = hexc('#f6a623')[None, None, :] * tone[..., None]
    col += hexc('#ffd36a')[None, None, :] * np.clip(streak - 0.7, 0, 1)[..., None] * 1.1
    col = np.minimum(col, 255)
    # Dark dry-brush drags over both ends, plus a few flicks; the middle stays clean for the label.
    drag = np.zeros((h, w), np.float32)
    rowsel = noise(h, 1, (24, 1), 2)[:, 0]
    for side in (0, 1):
        reach = 30 + rng.random(h) * 85
        edge = left if side == 0 else right
        dist = (xx - edge[:, None]) if side == 0 else (edge[:, None] - xx)
        mask = (dist > -24) & (dist < reach[:, None]) & (rowsel[:, None] > (0.52 if side == 0 else 0.48))
        drag = np.maximum(drag, mask * np.clip(1 - dist / reach[:, None], 0, 1) * (bristle > 0.42))
    ink = np.clip(drag * 1.6, 0, 1)
    for _ in range(46):
        side = rng.random() < 0.5
        cx = rng.uniform(0, 140) if side else rng.uniform(w - 150, w)
        cy = rng.uniform(6, h - 6)
        r = rng.uniform(0.8, 3.6)
        sx = rng.uniform(1.5, 4.0)
        ink = np.maximum(ink, np.clip(r - np.hypot((xx - cx) / sx, yy - cy), 0, 1))
    if not ink_on:
        ink = np.zeros_like(ink)
    dark = hexc('#0e1823')
    col = col * (1 - ink[..., None]) + dark[None, None, :] * ink[..., None]
    return rgba(col, np.maximum(alpha, ink * 0.92))


save(frame(), 'frame')
save(brush(), 'brush')
save(brush(ink_on=False), 'brush-clean')
print('wrote', sorted(p.name for p in OUT.iterdir()))
