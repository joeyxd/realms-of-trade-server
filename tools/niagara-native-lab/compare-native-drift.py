"""Drift of the mobile KTX2 UASTC textures against the desktop lossless WebP: same step and seed, two qa-native-studio runs (numpy only)."""
import argparse
import json
from pathlib import Path
import numpy as np


def load(run, stem, kind, width, height):
    data = np.frombuffer((run / f'{stem}-{kind}.rgba').read_bytes(), np.uint8)
    return data.reshape(height, width, 4)[..., :3].astype(np.int16)  # RGB, 0-255 per channel; alpha is the opaque stage


def stats(diff):
    values = diff.reshape(-1)
    return {'mae': round(float(values.mean()), 4), 'p95': float(np.percentile(values, 95)), 'max': int(values.max())}


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('desktop', type=Path, help='run folder captured on the desktop quality')
    parser.add_argument('mobile', type=Path, help='run folder captured on the mobile quality (the report is written here)')
    args = parser.parse_args()
    captures = {r: json.loads((r / 'evidence.json').read_text('utf-8'))['captures'] for r in (args.desktop, args.mobile)}
    rows = []
    # Pairs: the desktop-quality capture of a step against the mobile-quality capture of the same step and seed; then the control, the
    # step both runs captured on the mobile quality (the KTX2 decode is deterministic, so it must be identical).
    for desktop in captures[args.desktop]:
        for mobile in captures[args.mobile]:
            if (desktop['step'], desktop['seed']) != (mobile['step'], mobile['seed']):
                continue
            kind = {('desktop', 'mobile'): 'desktop vs mobile', ('mobile', 'mobile'): 'control (mobile vs mobile)'}.get((desktop['quality'], mobile['quality']))
            if not kind:
                continue
            a, b = [(load(r, c['stem'], 'image', c['width'], c['height']), load(r, c['stem'], 'background', c['width'], c['height']))
                    for r, c in ((args.desktop, desktop), (args.mobile, mobile))]
            assert a[0].shape == b[0].shape and (a[1] == b[1]).all(), 'the stage behind the effect must be identical'
            diff = np.abs(a[0] - b[0])
            region = ((a[0] != a[1]).any(-1) | (b[0] != b[1]).any(-1))  # pixels the effect touched in either capture
            rows.append({'comparison': kind, 'step': desktop['step'], 'seed': desktop['seed'], 'pixels': int(diff.shape[0] * diff.shape[1]),
                         'effectPixels': int(region.sum()), 'effectRegion': stats(diff[region]) if region.any() else None, 'wholeViewport': stats(diff)})
    out = {'desktopRun': args.desktop.name, 'mobileRun': args.mobile.name, 'rows': rows}
    (args.mobile / 'drift.json').write_text(json.dumps(out, indent=2) + '\n', 'utf-8')
    lines = ['| comparison | step | seed | effect px | region MAE | region P95 | region max | viewport MAE | viewport P95 | viewport max |', '|---|---|---|---|---|---|---|---|---|---|']
    for r in rows:
        e, w = r['effectRegion'] or {'mae': '-', 'p95': '-', 'max': '-'}, r['wholeViewport']
        lines.append(f"| {r['comparison']} | {r['step']} | {r['seed']} | {r['effectPixels']} | {e['mae']} | {e['p95']} | {e['max']} | {w['mae']} | {w['p95']} | {w['max']} |")
    (args.mobile / 'drift.md').write_text('\n'.join(lines) + '\n', 'utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
