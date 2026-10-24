"""Build the pinned native textures: lossless WebP (desktop, Pillow only) and, with --toktx, the mobile KTX2 UASTC twins."""
import argparse
import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BASICHIT = ROOT / 'assets/vfx/niagara/native/basichit-v1'
FLAME = ROOT / 'assets/vfx/niagara/native/flame-single-v1'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def atlas_build():
    # The accepted `ktx2-uastc` recipe (UASTC quality 4, Zstandard 3, sRGB, BT.709, lower-left origin) lives in atlas-build.py: reuse it as is.
    spec = importlib.util.spec_from_file_location('atlas_build', Path(__file__).with_name('atlas-build.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--toktx', type=Path, help='toktx executable; enables the KTX2 UASTC outputs (written, or compared byte for byte with --check)')
    args = parser.parse_args()
    atlas = atlas_build() if args.toktx else None
    checkpoint = json.loads((ROOT / 'docs/delivery/st01c/basichit/reference-profiled-checkpoint.json').read_text('utf-8'))
    pins = {r['file']: r['sha256'] for r in next(r for r in checkpoint['runs'] if r['name'] == 'basichit-reference05')['files']}
    atlas_inputs = {i['id']: i for i in json.loads((ROOT / 'tools/niagara-native-lab/atlas-source.json').read_text('utf-8'))['inputs']}
    jobs = [(BASICHIT, 'T_FireBall', 'fireball-v1', ROOT / '.scratch/unreal/basichit-reference05/textures/T_FireBall.png', pins['textures/T_FireBall.png']),
            (BASICHIT, 'T_Hit_Circle', 'hit-circle-v1', ROOT / '.scratch/unreal/basichit-reference05/textures/T_Hit_Circle.png', pins['textures/T_Hit_Circle.png'])]
    jobs += [(FLAME, name, filename, ROOT / atlas_inputs[key]['file'], atlas_inputs[key]['sha256'])
             for key, name, filename in [('flame', 'T_FlameUV_2', 'flame-v1'), ('smoke', 'T_Smoke_1', 'smoke-v1')]]
    for dest, name, stem, source, pin in jobs:
        assert sha(source.read_bytes()) == pin, f'PNG pin mismatch: {name}'
        rgba = Image.open(source).convert('RGBA')
        output = dest / f'{stem}.webp'
        if not args.check:
            dest.mkdir(parents=True, exist_ok=True)
            rgba.save(output, 'WEBP', lossless=True, method=6, exact=True)
        decoded = Image.open(output).convert('RGBA')
        assert decoded.size == rgba.size and decoded.tobytes() == rgba.tobytes(), f'RGBA mismatch: {stem}.webp'
        print(json.dumps({'texture': name, 'file': output.relative_to(ROOT).as_posix(), 'sha256': sha(output.read_bytes()),
                          'decodedSha256': sha(decoded.tobytes()), 'size': list(decoded.size), 'decodedRGBAIdentical': True}))
        if not atlas:
            continue
        with tempfile.TemporaryDirectory(prefix='st01c-native-ktx2-') as temp:
            row = {'id': stem, 'dimensions': list(rgba.size), 'file': source.relative_to(ROOT).as_posix()}
            _, data, info, command = atlas.encode_ktx2(args.toktx, 'ktx2-uastc', row, source, Path(temp))
        target = dest / f'{stem}.ktx2'
        if args.check:
            assert target.read_bytes() == data, f'KTX2 mismatch: {target.name}'
        else:
            target.write_bytes(data)
        print(json.dumps({'texture': name, 'file': target.relative_to(ROOT).as_posix(), 'sha256': sha(data), 'bytes': len(data),
                          'size': list(rgba.size), 'levelCount': len(info['levels']), 'gpuBlockBytes': sum(l['uncompressedByteLength'] for l in info['levels']),
                          'encoder': ' '.join(command)}))

if __name__ == '__main__':
    main()
