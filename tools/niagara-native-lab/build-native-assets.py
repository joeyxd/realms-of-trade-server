"""Build the pinned, pixel-identical native textures: two BasicHit and two NS_Flame_Single (Pillow only)."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BASICHIT = ROOT / 'assets/vfx/niagara/native/basichit-v1'
FLAME = ROOT / 'assets/vfx/niagara/native/flame-single-v1'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    checkpoint = json.loads((ROOT / 'docs/delivery/st01c/basichit/reference-profiled-checkpoint.json').read_text('utf-8'))
    pins = {r['file']: r['sha256'] for r in next(r for r in checkpoint['runs'] if r['name'] == 'basichit-reference05')['files']}
    atlas = {i['id']: i for i in json.loads((ROOT / 'tools/niagara-native-lab/atlas-source.json').read_text('utf-8'))['inputs']}
    jobs = [(BASICHIT, 'T_FireBall', 'fireball-v1.webp', ROOT / '.scratch/unreal/basichit-reference05/textures/T_FireBall.png', pins['textures/T_FireBall.png']),
            (BASICHIT, 'T_Hit_Circle', 'hit-circle-v1.webp', ROOT / '.scratch/unreal/basichit-reference05/textures/T_Hit_Circle.png', pins['textures/T_Hit_Circle.png'])]
    jobs += [(FLAME, name, filename, ROOT / atlas[key]['file'], atlas[key]['sha256'])
             for key, name, filename in [('flame', 'T_FlameUV_2', 'flame-v1.webp'), ('smoke', 'T_Smoke_1', 'smoke-v1.webp')]]
    for dest, name, filename, source, pin in jobs:
        assert sha(source.read_bytes()) == pin, f'PNG pin mismatch: {name}'
        rgba = Image.open(source).convert('RGBA')
        output = dest / filename
        if not args.check:
            dest.mkdir(parents=True, exist_ok=True)
            rgba.save(output, 'WEBP', lossless=True, method=6, exact=True)
        decoded = Image.open(output).convert('RGBA')
        assert decoded.size == rgba.size and decoded.tobytes() == rgba.tobytes(), f'RGBA mismatch: {filename}'
        print(json.dumps({'texture': name, 'file': output.relative_to(ROOT).as_posix(), 'sha256': sha(output.read_bytes()),
                          'decodedSha256': sha(decoded.tobytes()), 'size': list(decoded.size), 'decodedRGBAIdentical': True}))

if __name__ == '__main__':
    main()
