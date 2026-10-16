#!/usr/bin/env python3
"""Extract bounded, explicitly unaccepted SubUV frame candidates from safe PNG/EXR exports.

Spec JSON (all input paths are read-only):
  {"schema":"marea.niagara-subuv-extract-spec","version":1,
   "sourcePath":"C:/Unreal/.../NS_Example.uasset","sourceSha256":"<64 lowercase hex>",
   "imagePath":".../safe-export.png","imageSha256":"<64 lowercase hex>",
   "grid":{"columns":8,"rows":8,"evidence":"verified SubImageSize"},
   "mapping":"luminance-to-white-alpha","outputSize":[256,256],
   "resample":"bicubic", "sourceIndices":[...]}

For more than 64 source cells, sourceIndices must be the deterministic evenly
spaced selection recorded by this tool. Outputs are restricted to repo .scratch.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError


REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r'C:\Unreal')
SHA256_LEN = 64
MAX_SOURCE_IMAGE_BYTES = 128 * 1024 * 1024
MAX_IMAGE_DIMENSION = 8192
MAX_IMAGE_PIXELS = 16_777_216
# Four float32 channels for a bounded 4096x4096 source; checked before decode.
MAX_EXR_DECODE_BYTES = 256 * 1024 * 1024
MAX_OUTPUT_DIMENSION = 1024
MAX_FRAMES = 64
MAPPINGS = {'original-rgba', 'original-alpha-to-white', 'luminance-to-white-alpha', 'black-background-additive'}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def checked_hash(value, label: str) -> str:
    require(isinstance(value, str) and len(value) == SHA256_LEN and all(c in '0123456789abcdef' for c in value),
            f'{label} must be 64 lowercase hexadecimal characters')
    return value


def ensure_output_root(path: Path, source_root: Path) -> Path:
    resolved = path.resolve()
    require(resolved != source_root and not resolved.is_relative_to(source_root),
            f'output directory must be outside the read-only source root: {resolved}')
    scratch = (REPO_ROOT / '.scratch').resolve()
    require(resolved != scratch and resolved.is_relative_to(scratch),
            f'output directory must be under repository .scratch: {resolved}')
    return resolved


def require_fresh_output(path: Path) -> None:
    require(not path.exists() or (path.is_dir() and not any(path.iterdir())),
            f'output directory must be new or empty: {path}')


def evenly_selected_indices(total: int, count: int) -> list[int]:
    if count == 1:
        return [total // 2]
    return [round(i * (total - 1) / (count - 1)) for i in range(count)]


def load_png(path: Path) -> tuple[np.ndarray, dict]:
    with Image.open(path) as image:
        width, height = image.size
        require(width <= MAX_IMAGE_DIMENSION and height <= MAX_IMAGE_DIMENSION and width * height <= MAX_IMAGE_PIXELS,
                'source image dimensions exceed bounds')
        image.load()
        native_alpha = 'A' in image.getbands() or 'transparency' in image.info
        source_mode = image.mode
        color_profile = {key: image.info[key] for key in ('gamma', 'srgb') if key in image.info}
        if 'icc_profile' in image.info:
            profile = image.info['icc_profile']
            profile_bytes = profile if isinstance(profile, bytes) else bytes(profile)
            color_profile['iccProfile'] = {'bytes': len(profile_bytes), 'sha256': hashlib.sha256(profile_bytes).hexdigest()}
        rgba = np.asarray(image.convert('RGBA'), dtype=np.uint8).copy()
    return rgba.astype(np.float32) / 255.0, {
        'format': 'PNG', 'width': width, 'height': height, 'nativeAlpha': native_alpha,
        'sourceMode': source_mode, 'colorMetadata': color_profile,
        'pixelMethod': 'Pillow PNG RGBA8; PNG sRGB-encoded RGB and linear alpha values preserved',
    }


def load_exr(path: Path) -> tuple[np.ndarray, dict]:
    probe = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'json', str(path)],
        check=True, capture_output=True, text=True,
    )
    streams = json.loads(probe.stdout).get('streams', [])
    require(len(streams) == 1, 'EXR must contain exactly one video stream')
    width, height = int(streams[0]['width']), int(streams[0]['height'])
    require(width > 0 and height > 0 and width <= MAX_IMAGE_DIMENSION and height <= MAX_IMAGE_DIMENSION
            and width * height <= MAX_IMAGE_PIXELS, 'source EXR dimensions exceed bounds')
    pixel_format = str(streams[0].get('pix_fmt', ''))
    native_alpha = 'a' in pixel_format
    expected = width * height * 4 * 4
    require(expected <= MAX_EXR_DECODE_BYTES, 'decoded EXR payload exceeds byte limit')
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(path), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gbrapf32le', '-'],
        check=True, capture_output=True,
    ).stdout
    require(len(raw) == expected, f'EXR float pixel payload size mismatch: {len(raw)} != {expected}')
    planes = np.frombuffer(raw, dtype='<f4').reshape(4, height, width)
    rgba = np.stack((planes[2], planes[0], planes[1], planes[3]), axis=2).copy()
    require(np.isfinite(rgba).all(), 'EXR contains non-finite channel values')
    if not native_alpha:
        rgba[:, :, 3] = 1.0
    return rgba, {
        'format': 'EXR', 'width': width, 'height': height, 'nativeAlpha': native_alpha,
        'sourceMode': pixel_format,
        'pixelMethod': 'census ffmpeg gbrapf32le plane decode reordered to linear RGBA; no preview normalization applied',
    }


def load_image(path: Path) -> tuple[np.ndarray, dict]:
    suffix = path.suffix.lower()
    if suffix == '.png':
        return load_png(path)
    if suffix == '.exr':
        return load_exr(path)
    raise SystemExit('imagePath must reference a PNG or EXR export')


def srgb_to_linear(value: np.ndarray) -> np.ndarray:
    return np.where(value <= 0.04045, value / 12.92, ((value + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(value: np.ndarray) -> np.ndarray:
    value = np.clip(value, 0.0, 1.0)
    return np.where(value <= 0.0031308, value * 12.92, 1.055 * np.power(value, 1.0 / 2.4) - 0.055)


def map_rgba(rgba: np.ndarray, mapping: str, image_info: dict) -> tuple[np.ndarray, str]:
    rgb, source_alpha = rgba[:, :, :3], rgba[:, :, 3]
    if mapping == 'original-rgba':
        if image_info['format'] == 'EXR':
            converted = rgba.copy()
            converted[:, :, :3] = linear_to_srgb(converted[:, :, :3])
            return converted, 'EXR linear RGB converted to sRGB for PNG storage; source alpha retained as linear alpha'
        return rgba.copy(), 'RGB and A retained from decoded source image; PNG sRGB RGB / linear alpha or EXR linear RGBA'
    if mapping == 'original-alpha-to-white':
        require(image_info['nativeAlpha'], 'original-alpha-to-white requires a native source alpha channel')
        return np.dstack((np.ones_like(rgb), source_alpha)), 'RGB=white; A=native source alpha without remapping'
    if mapping == 'luminance-to-white-alpha':
        luminance = rgb[:, :, 0] * 0.299 + rgb[:, :, 1] * 0.587 + rgb[:, :, 2] * 0.114
        return np.dstack((np.ones_like(rgb), luminance)), 'RGB=white; A=0.299R+0.587G+0.114B in source channel domain'
    if mapping == 'black-background-additive':
        linear = srgb_to_linear(np.clip(rgb, 0.0, 1.0)) if image_info['format'] == 'PNG' else rgb
        require(float(np.min(linear)) >= 0 and float(np.max(linear)) <= 1.00001,
                'black-background-additive requires source RGB in linear range 0..1')
        alpha = np.max(linear, axis=2)
        unpremultiplied = np.divide(linear, alpha[:, :, None], out=np.zeros_like(linear), where=alpha[:, :, None] > 0)
        return np.dstack((linear_to_srgb(unpremultiplied), alpha)), 'A=max(linear RGB); RGB=linearRGB/A converted to sRGB; zero RGB maps transparent'
    raise SystemExit(f'unsupported mapping: {mapping}')


def _catmull_rom_weights(distance: np.ndarray) -> np.ndarray:
    distance = np.abs(distance)
    a = -0.5
    near = ((a + 2) * distance - (a + 3)) * distance * distance + 1
    far = ((a * distance - 5 * a) * distance + 8 * a) * distance - 4 * a
    return np.where(distance < 1, near, np.where(distance < 2, far, 0)).astype(np.float32)


def _resample_axis(values: np.ndarray, coordinates: np.ndarray, axis: int, low: int, high: int) -> np.ndarray:
    require(low <= high, 'fractional SubUV cell contains no source pixel centers')
    base = np.floor(coordinates).astype(np.int64)
    result_shape = list(values.shape)
    result_shape[axis] = len(coordinates)
    result = np.zeros(result_shape, dtype=np.float32)
    for offset in (-1, 0, 1, 2):
        indices = np.clip(base + offset, low, high)
        weights = _catmull_rom_weights(coordinates - (base + offset))
        sampled = np.take(values, indices, axis=axis)
        shape = [1] * sampled.ndim
        shape[axis] = len(weights)
        result += sampled * weights.reshape(shape)
    return result


def transform_channel(channel: np.ndarray, box: tuple[float, float, float, float], size: tuple[int, int]) -> np.ndarray:
    left, top, right, bottom = box
    out_width, out_height = size
    x_coordinates = left + (np.arange(out_width, dtype=np.float32) + 0.5) * (right - left) / out_width - 0.5
    y_coordinates = top + (np.arange(out_height, dtype=np.float32) + 0.5) * (bottom - top) / out_height - 0.5
    x_low, x_high = math.ceil(left - 0.5), math.floor(right - 0.5)
    y_low, y_high = math.ceil(top - 0.5), math.floor(bottom - 0.5)
    horizontal = _resample_axis(channel.astype(np.float32), x_coordinates, 1, x_low, x_high)
    return _resample_axis(horizontal, y_coordinates, 0, y_low, y_high)


def frame_image(mapped: np.ndarray, width: int, height: int, columns: int, rows: int, index: int, out_size: tuple[int, int]) -> Image.Image:
    column, row = index % columns, index // columns
    box = (column * width / columns, row * height / rows,
           (column + 1) * width / columns, (row + 1) * height / rows)
    channels = [transform_channel(mapped[:, :, c], box, out_size) for c in range(4)]
    pixels = np.clip(np.stack(channels, axis=2), 0.0, 1.0)
    return Image.fromarray(np.rint(pixels * 255).astype(np.uint8), mode='RGBA')


def contact_sheet(frames: list[Image.Image], indices: list[int], columns: int = 8) -> Image.Image:
    tile, label_height, margin = 116, 18, 8
    rows = math.ceil(len(frames) / columns)
    sheet = Image.new('RGB', (margin + columns * (tile + margin), margin + rows * (tile + label_height + margin)), '#20272c')
    draw = ImageDraw.Draw(sheet); font = ImageFont.load_default()
    for position, (frame, source_index) in enumerate(zip(frames, indices)):
        x = margin + (position % columns) * (tile + margin)
        y = margin + (position // columns) * (tile + label_height + margin)
        checker = Image.new('RGBA', frame.size, (0, 0, 0, 0)); checker_draw = ImageDraw.Draw(checker)
        block = 16
        for cy in range(0, frame.height, block):
            for cx in range(0, frame.width, block):
                color = (70, 70, 70, 255) if (cx // block + cy // block) % 2 else (110, 110, 110, 255)
                checker_draw.rectangle((cx, cy, cx + block - 1, cy + block - 1), fill=color)
        preview = Image.alpha_composite(checker, frame).convert('RGB').resize((tile, tile), Image.Resampling.NEAREST)
        sheet.paste(preview, (x, y)); draw.text((x, y + tile + 2), f'frame {position} / source {source_index}', font=font, fill='white')
    return sheet


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('spec', type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--source-root', type=Path, default=SOURCE_ROOT)
    args = parser.parse_args()

    source_root = args.source_root.resolve(strict=True)
    output_dir = ensure_output_root(args.output_dir, source_root)
    require_fresh_output(output_dir)
    spec_path = args.spec.resolve(strict=True)
    require(not spec_path.is_relative_to(output_dir), 'output directory must not contain or overwrite the specification')
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    require(spec.get('schema') == 'marea.niagara-subuv-extract-spec' and spec.get('version') == 1, 'unsupported spec schema/version')

    source_path = Path(spec['sourcePath']).resolve(strict=True)
    require(source_path.is_relative_to(source_root), 'sourcePath must resolve under the read-only source root')
    source_sha = checked_hash(spec.get('sourceSha256'), 'sourceSha256')
    require(sha256_file(source_path) == source_sha, 'sourcePath SHA-256 mismatch')
    image_path = Path(spec['imagePath']).resolve(strict=True)
    require(not image_path.is_relative_to(output_dir), 'output directory must not contain or overwrite the source image')
    require(image_path.suffix.lower() in ('.png', '.exr'), 'imagePath must be PNG or EXR')
    require(image_path.stat().st_size <= MAX_SOURCE_IMAGE_BYTES, 'source image exceeds byte limit')
    image_sha = checked_hash(spec.get('imageSha256'), 'imageSha256')
    require(sha256_file(image_path) == image_sha, 'imagePath SHA-256 mismatch')

    grid = spec.get('grid')
    require(isinstance(grid, dict), 'grid must be an object')
    columns, rows = grid.get('columns'), grid.get('rows')
    require(type(columns) is int and type(rows) is int and 1 <= columns <= 256 and 1 <= rows <= 256,
            'grid columns and rows must be positive integers <= 256')
    require(isinstance(grid.get('evidence'), str) and grid['evidence'].strip(), 'grid.evidence is required')
    total = columns * rows
    indices = spec.get('sourceIndices')
    if total <= MAX_FRAMES:
        expected_indices = list(range(total))
        require(indices is None or indices == expected_indices, 'sourceIndices must retain every source cell when grid <= 64')
        indices = expected_indices
    else:
        require(isinstance(indices, list) and 1 <= len(indices) <= MAX_FRAMES,
                'grids above 64 cells require an explicit sourceIndices selection of at most 64 cells')
        require(all(type(i) is int and 0 <= i < total for i in indices), 'sourceIndices must be valid integer cell indexes')
        require(indices == evenly_selected_indices(total, len(indices)), 'sourceIndices must be evenly selected and ordered')
    require(len(set(indices)) == len(indices), 'sourceIndices must not contain duplicates')

    mapping = spec.get('mapping')
    require(mapping in MAPPINGS, f'mapping must be one of: {", ".join(sorted(MAPPINGS))}')
    out_size = spec.get('outputSize', [256, 256])
    require(isinstance(out_size, list) and len(out_size) == 2 and all(type(n) is int and 16 <= n <= MAX_OUTPUT_DIMENSION for n in out_size),
            'outputSize must contain two integers in 16..1024')
    resample = spec.get('resample', 'bicubic')
    require(resample == 'bicubic', 'only the recorded bicubic resampler is supported')

    rgba, image_info = load_image(image_path)
    height, width = rgba.shape[:2]
    require(width == image_info['width'] and height == image_info['height'], 'decoded image dimensions mismatch')
    require(width <= MAX_IMAGE_DIMENSION and height <= MAX_IMAGE_DIMENSION and width * height <= MAX_IMAGE_PIXELS,
            'source image dimensions exceed bounds')
    mapped, mapping_formula = map_rgba(rgba, mapping, image_info)
    frames = [frame_image(mapped, width, height, columns, rows, index, (out_size[0], out_size[1])) for index in indices]

    # Validate concrete outputs under .scratch and outside sourceRoot before any writes.
    output_dir = ensure_output_root(output_dir, source_root)
    require_fresh_output(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    frame_records = []
    for position, (source_index, image) in enumerate(zip(indices, frames)):
        path = output_dir / f'frame_{position:03d}_source_{source_index:04d}.png'
        image.save(path, format='PNG', optimize=True)
        frame_records.append({'index': position, 'sourceIndex': source_index, 'file': path.name,
                              'width': image.width, 'height': image.height, 'bytes': path.stat().st_size,
                              'sha256': sha256_file(path)})
    sheet = contact_sheet(frames, indices)
    sheet_path = output_dir / 'contact-sheet.png'
    sheet.save(sheet_path, format='PNG', optimize=True)
    result = {
        'schema': 'marea.niagara-subuv-candidate', 'version': 1,
        'status': 'extracted-unreviewed', 'accepted': False, 'runtimeRegistration': False, 'originalsModified': False,
        'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'source': {'path': str(source_path), 'sha256': source_sha, 'bytes': source_path.stat().st_size},
        'image': {'path': str(image_path), 'sha256': image_sha, 'bytes': image_path.stat().st_size, **image_info},
        'grid': {'columns': columns, 'rows': rows, 'cells': total, 'evidence': grid['evidence']},
        'sourceIndices': indices,
        'mapping': mapping,
        'mappingFormula': mapping_formula,
        'resample': {'method': 'separable Catmull-Rom bicubic (a=-0.5)',
                     'bounds': 'exact fractional source-pixel intervals; bicubic taps clamp to native pixel centers inside each cell',
                     'coordinates': 'pixel centers: L+(outputIndex+0.5)*cellSize/outputSize-0.5',
                     'outputSize': out_size},
        'frames': frame_records,
        'contactSheet': {'file': sheet_path.name, 'bytes': sheet_path.stat().st_size, 'sha256': sha256_file(sheet_path)},
        'limitations': ['Extraction candidate only; no visual acceptance, Niagara behavior claim, runtime packaging, or registration.'],
    }
    manifest_path = output_dir / 'manifest.json'
    manifest_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'manifest': str(manifest_path), 'frames': len(frames), 'sourceSha256': source_sha, 'imageSha256': image_sha}))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, json.JSONDecodeError, subprocess.CalledProcessError, UnidentifiedImageError, ValueError) as error:
        print(f'extract-niagara-subuv: {error}', file=sys.stderr)
        raise SystemExit(2)
