"""Build the two pinned, pixel-identical BasicHit textures (Pillow only)."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'assets/vfx/niagara/native/basichit-v1'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    checkpoint = json.loads((ROOT / 'docs/delivery/st01c/basichit/reference-profiled-checkpoint.json').read_text('utf-8'))
    pins = {r['file']: r['sha256'] for r in next(r for r in checkpoint['runs'] if r['name'] == 'basichit-reference05')['files']}
    for name, filename in [('T_FireBall', 'fireball-v1.webp'), ('T_Hit_Circle', 'hit-circle-v1.webp')]:
        relative = f'textures/{name}.png'
        source = ROOT / '.scratch/unreal/basichit-reference05' / relative
        assert sha(source.read_bytes()) == pins[relative], f'PNG pin mismatch: {relative}'
        rgba = Image.open(source).convert('RGBA')
        output = DEST / filename
        if not args.check:
            DEST.mkdir(parents=True, exist_ok=True)
            rgba.save(output, 'WEBP', lossless=True, method=6, exact=True)
        decoded = Image.open(output).convert('RGBA')
        assert decoded.size == rgba.size and decoded.tobytes() == rgba.tobytes(), f'RGBA mismatch: {filename}'
        print(json.dumps({'texture': name, 'file': output.relative_to(ROOT).as_posix(), 'sha256': sha(output.read_bytes()),
                          'decodedSha256': sha(decoded.tobytes()), 'size': list(decoded.size), 'decodedRGBAIdentical': True}))


if __name__ == '__main__':
    main()
