"""Pack reviewed Unreal frame exports into bounded web derivatives; originals remain outside runtime."""
import argparse, hashlib, json, math, re
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r'C:\Unreal')
SHA256_RE = re.compile(r'^[0-9a-f]{64}$')
MAX_FRAME_BYTES = 32 * 1024 * 1024
MAX_FRAME_DIMENSION = 4096
MAX_FRAME_PIXELS = 4_194_304
MAX_TOTAL_FRAME_BYTES = 128 * 1024 * 1024
MAX_TOTAL_FRAME_PIXELS = 67_108_864


def require_outside(path, source_root, label):
    resolved = path.resolve()
    if resolved == source_root or resolved.is_relative_to(source_root):
        raise SystemExit(f'{label} must be outside the read-only source root: {resolved}')
    return resolved


parser = argparse.ArgumentParser()
parser.add_argument('spec', type=Path)
parser.add_argument('--source-root', type=Path, default=SOURCE_ROOT)
parser.add_argument('--replace-reviewed', action='store_true',
                    help='allow replacement of existing reviewed atlas and manifest outputs')
args = parser.parse_args()

# Resolve and reject destinations before reading frame bytes or creating anything.
spec_path = args.spec.resolve(strict=True)
source_root = args.source_root.resolve(strict=True)
output_root = REPO_ROOT.resolve(strict=True)
assert output_root != source_root and not output_root.is_relative_to(source_root), 'repository root must remain outside the read-only source root'
spec = json.loads(spec_path.read_text(encoding='utf-8'))
effect_id = spec['id']
assert effect_id.startswith('niagara-') and len(effect_id) == 24
assert all(c in '0123456789abcdef' for c in effect_id[8:])
assert spec['review']['accepted'] is True, 'Explicit source/render review is required'
assert spec['role'] in ('source-texture', 'system-capture')
source_sha = spec.get('sourceSha256')
assert isinstance(source_sha, str) and SHA256_RE.fullmatch(source_sha), 'sourceSha256 must be 64 lowercase hex characters'
assert effect_id == 'niagara-' + source_sha[:16]
source_path = Path(spec['sourcePath']).resolve(strict=True)
assert source_path.is_relative_to(source_root), 'Source reference must remain under the read-only source root'
assert hashlib.sha256(source_path.read_bytes()).hexdigest() == source_sha, 'Source changed'
paths = [(spec_path.parent / name).resolve(strict=True) for name in spec['frames']]
assert 4 <= len(paths) <= 64
assert len(set(paths)) == len(paths), 'Frame inputs must be unique'
duration = spec.get('duration')
assert isinstance(duration, (int, float)) and math.isfinite(duration) and 0 < duration <= 20
world_width, world_height = spec.get('worldWidth', 6), spec.get('worldHeight', 6)
assert isinstance(world_width, (int, float)) and math.isfinite(world_width) and 0 < world_width <= 100
assert isinstance(world_height, (int, float)) and math.isfinite(world_height) and 0 < world_height <= 100
assert spec['blend'] in ('alpha', 'additive')
atlas_id = spec.get('atlasId', effect_id)
if atlas_id != effect_id:
    component = spec.get('component', {})
    texture_sha = component.get('textureSha256', '')
    assert isinstance(texture_sha, str) and SHA256_RE.fullmatch(texture_sha), 'Shared component texture hash required'
    assert type(component.get('columns')) is int and type(component.get('rows')) is int
    assert 1 <= component['columns'] <= 64 and 1 <= component['rows'] <= 64
    mapping_suffix = {'original-rgba': 'rgba', 'original-alpha-to-white': 'alpha',
                      'luminance-to-white-alpha': 'luma'}.get(component.get('mapping'))
    assert mapping_suffix and spec['role'] == 'source-texture'
    assert atlas_id == f"component-{texture_sha[:16]}-{component['columns']}x{component['rows']}-{mapping_suffix}", 'Shared atlas ID must match its exact component'
desktop_tile = spec.get('desktopTile', 256)
assert type(desktop_tile) is int and desktop_tile in (256, 512), 'Desktop tile must be 256 or 512 pixels'
total_frame_bytes = 0
total_frame_pixels = 0
frames = []
for path in paths:
    byte_count = path.stat().st_size
    assert byte_count <= MAX_FRAME_BYTES, f'Frame exceeds byte limit: {path}'
    total_frame_bytes += byte_count
    assert total_frame_bytes <= MAX_TOTAL_FRAME_BYTES, 'Frame inputs exceed aggregate byte limit'
    with Image.open(path) as source_image:
        width, height = source_image.size
        assert 0 < width <= MAX_FRAME_DIMENSION and 0 < height <= MAX_FRAME_DIMENSION, f'Frame dimensions exceed bounds: {path}'
        pixels = width * height
        assert pixels <= MAX_FRAME_PIXELS, f'Frame pixel count exceeds bound: {path}'
        total_frame_pixels += pixels
        assert total_frame_pixels <= MAX_TOTAL_FRAME_PIXELS, 'Frame inputs exceed aggregate pixel limit'
        source_image.load()
        frames.append(source_image.convert('RGBA'))
assert len({im.size for im in frames}) == 1, 'Frame dimensions changed'
hashes = [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths]
assert len(set(hashes)) >= min(4, len(paths)), 'No verified animation'
assert any(im.getbbox() for im in frames), 'All exported frames are empty'

if spec['role'] == 'system-capture':
    alpha_values = set()
    has_transparency = False
    has_visible_alpha = False
    has_nonzero_rgb = False
    for im in frames:
        alpha = im.getchannel('A')
        extrema = alpha.getextrema()
        has_transparency |= extrema[0] < 255
        has_visible_alpha |= extrema[1] > 0
        pixels = im.load()
        for y in range(im.height):
            for x in range(im.width):
                pixel = pixels[x, y]
                if len(alpha_values) < 4:
                    alpha_values.add(pixel[3])
                if pixel[3] > 0 and any(pixel[:3]):
                    has_nonzero_rgb = True
                if len(alpha_values) >= 4 and has_nonzero_rgb:
                    break
            if len(alpha_values) >= 4 and has_nonzero_rgb:
                break
    assert has_transparency and has_visible_alpha, 'System captures need meaningful non-opaque alpha'
    assert len(alpha_values) >= 4, 'System captures need at least four distinct alpha values'
    assert has_nonzero_rgb, 'System captures need visible nonzero RGB content'

columns = 4 if len(frames) <= 16 else 8
rows = 2 ** math.ceil(math.log2(math.ceil(len(frames) / columns)))
out = output_root / 'assets' / 'vfx' / 'niagara'
manifest = output_root / 'docs' / 'art' / 'niagara-v1' / f'{atlas_id}.json'
require_outside(out, source_root, 'asset output directory')
require_outside(manifest.parent, source_root, 'manifest output directory')
for quality in ('desktop', 'mobile'):
    require_outside(out / f'{atlas_id}-{quality}.webp', source_root, f'{quality} atlas output')
require_outside(manifest, source_root, 'manifest output')
outputs = [out / f'{atlas_id}-{quality}.webp' for quality in ('desktop', 'mobile')] + [manifest]
existing_outputs = [path for path in outputs if path.exists()]
assert not existing_outputs or args.replace_reviewed, (
    'Output already exists; pass --replace-reviewed only when intentionally replacing reviewed derivatives: '
    + ', '.join(str(path) for path in existing_outputs)
)
out.mkdir(parents=True, exist_ok=True)
files = {}
for quality, tile in (('desktop', desktop_tile), ('mobile', 128)):
    atlas = Image.new('RGBA', (columns * tile, rows * tile))
    for i, im in enumerate(frames):
        # Transparent gutters prevent linear filtering from sampling a neighboring frame.
        atlas.paste(im.resize((tile - 4, tile - 4), Image.Resampling.LANCZOS), ((i % columns) * tile + 2, (i // columns) * tile + 2))
    path = out / f'{atlas_id}-{quality}.webp'
    atlas.save(path, format='WEBP', quality=90 if quality == 'desktop' else 82, method=6)
    with Image.open(path) as check:
        assert check.size == atlas.size and check.mode == 'RGBA'
    files[quality] = {'url': '/' + path.relative_to(output_root).as_posix(), 'bytes': path.stat().st_size,
                      'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'width': atlas.width, 'height': atlas.height}
result = {'schema': 'marea.niagara-web-derivative', 'version': 1, 'id': effect_id,
          'atlasId': atlas_id,
          'sourceSha256': source_sha, 'sourceFrames': hashes, 'files': files,
          'derivative': {'adapter': 'flipbook-v1', 'role': spec['role'], 'atlas': {key: file['url'] for key, file in files.items()},
                         'columns': columns, 'rows': rows, 'frames': len(frames), 'duration': duration,
                         'width': world_width, 'height': world_height, 'blend': spec['blend']},
          'review': spec['review'], 'camera': spec['camera'], 'provenance': spec.get('provenance', {}),
          'packing': {'desktopTile': desktop_tile, 'mobileTile': 128, 'gutter': 2,
                      'oneAtlasVariantLoaded': True},
          'limitations': (['Original SubUV texture only; the complete Niagara system is pending.',
                           'Playback duration is an editor default, not verified Niagara emitter timing.']
                          if spec['role'] == 'source-texture' else
                          ['One baked camera view; not the original 3D Niagara simulation.']) + [
                          'Presentation controls do not modify Niagara emitter particle counts.']}
if atlas_id != effect_id:
    result['derivative'].update({'atlasId': atlas_id, 'component': spec['component'],
                                 'sourceBinding': spec['sourceBinding']})
manifest.parent.mkdir(parents=True, exist_ok=True)
manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'manifest': str(manifest), 'files': files, 'frames': len(frames)}))
