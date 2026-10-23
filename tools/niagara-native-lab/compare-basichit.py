"""BasicHit render gate on one qa-basichit.mjs run folder. Thresholds and definitions are read from
docs/delivery/st01c/basichit/render-sources.json (never retyped); the pattern is compare-color.py.
Reference: basichit-reference05 (profile controlled-sdr/v1); every reference file is checked against
docs/delivery/st01c/basichit/reference-profiled-checkpoint.json before use.
Transfer precondition: the lab Filmic LUT on the Unreal raw RGBA16F SceneColor HDR (each row's hdr_raw) vs the Unreal
FinalColorLDR (step 12, 3 cameras). Native rows: the lab chain vs the Unreal FinalColorLDR, 15 frames at 1024 px, no
resampling, gate draw order; they are computed only when every transfer row passes (no native result on an uncontrolled
reference). Diagnostics, never part of accepted: the lab transfer canvas against the exact film-color.js transform of the
same raw HDR (computed by node, as transfer-basichit.mjs does), the reverse draw order and the empty t0000.
usage: compare-basichit.py <qa-basichit run folder> [--transfer-only]
Full mode writes comparison.json into the run folder, prints it, and exits 1 when the gate fails (after writing).
--transfer-only writes transfer-check.json (identity and transfer rows only), prints it, and exits 1 when a transfer
row fails."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REFERENCE, PROFILE = 'basichit-reference05', 'controlled-sdr/v1'
USAGE = 'usage: compare-basichit.py <qa-basichit run folder> [--transfer-only]'
root = Path(__file__).resolve().parents[2]
lab_dir = Path(__file__).resolve().parent
args = sys.argv[1:]
transfer_only = '--transfer-only' in args
args = [a for a in args if a != '--transfer-only']
if len(args) != 1 or not Path(args[0]).is_dir():
    raise SystemExit(USAGE)
out = Path(args[0])
delivery = root/'docs/delivery/st01c/basichit'
sha = lambda data: hashlib.sha256(data).hexdigest()
sources_bytes = (delivery/'render-sources.json').read_bytes()
thresholds = json.loads(sources_bytes)['thresholds']
transfer = thresholds['transferPrecondition']
size = thresholds['resolutionPx']
checkpoint_bytes = (delivery/'reference-profiled-checkpoint.json').read_bytes()
checkpoint = json.loads(checkpoint_bytes)
pinned_run = next((r for r in checkpoint.get('runs', []) if r.get('name') == REFERENCE), None)
if checkpoint.get('referenceRun') != REFERENCE or checkpoint.get('profile', {}).get('id') != PROFILE or pinned_run is None:
    raise SystemExit('Unexpected BasicHit reference checkpoint')
capture = root/'.scratch/unreal'/REFERENCE
pins = {row['file']: row['sha256'] for row in pinned_run['files']}


def reference(file):
    data = (capture/file).read_bytes()
    if file not in pins or sha(data) != pins[file]:
        raise SystemExit('Reference hash mismatch: ' + file)
    return data


def rgb(path):
    with Image.open(path) as image:
        a = np.asarray(image.convert('RGB'), dtype=float)
    if a.shape != (size, size, 3):
        raise SystemExit(f'{path.name}: {a.shape[1]}x{a.shape[0]}, expected {size}x{size} (no resampling)')
    return a


def lab(file):
    path = out/file
    with Image.open(path) as image:
        digest = sha(image.convert('RGBA').tobytes())
    return rgb(path), digest


def metrics(a, b):
    # compare-color.py lines 28-37: mask = max channel > 32 on each image; union = max channel > 8 on either.
    union = (a.max(2) > 8) | (b.max(2) > 8)
    ma, mb = a.max(2) > 32, b.max(2) > 32
    error = abs(a-b)
    both = int((ma | mb).sum())
    return {'maskIoU32': float((ma & mb).sum()/both) if both else None, 'mae255': float(error[union].mean()) if union.any() else 0.0,
            'p95ChannelError255': float(np.percentile(error[union], 95)) if union.any() else 0.0,
            'maxChannelError255': float(error.max()), 'unionPixels': int(union.sum()),
            'uePixelsGt32': int(ma.sum()), 'labPixelsGt32': int(mb.sum())}


# The exact film-color.js transform of one raw RGBA16F file, as transfer-basichit.mjs transfer() computes it: half float
# -> NaN to 0, clamp [0, 65504] (the shader's max(0, x) with exposure 1) -> createFilmTransform(film-source.json).encode ->
# round(clamp01 * 255). Prints RGB bytes, top row first. Runs in tools/niagara-native-lab so 'three' resolves as there.
EXACT_JS = r"""
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DataUtils } from 'three';
import { createFilmTransform } from './film-color.js';
import { FILM_SOURCE_SHA256 } from './film-identity.js';
const [file, expected, size] = process.argv.slice(1), n = Number(size) * Number(size);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const filmBytes = fs.readFileSync('./film-source.json');
if (sha(filmBytes) !== FILM_SOURCE_SHA256) throw new Error('film-source.json hash mismatch');
const bytes = fs.readFileSync(file);
if (sha(bytes) !== expected || bytes.length !== n * 8) throw new Error('raw HDR hash or size mismatch: ' + file);
const film = createFilmTransform(JSON.parse(filmBytes));
const MAXH = 65504, toByte = v => Math.round(Math.min(1, Math.max(0, v)) * 255);
const linearOf = h => { const v = DataUtils.fromHalfFloat(h); return Number.isNaN(v) ? 0 : Math.min(MAXH, Math.max(0, v)); };
const out = Buffer.alloc(n * 3), cache = new Map();
for (let i = 0; i < n; i++) {
  const r = bytes.readUInt16LE(i * 8), g = bytes.readUInt16LE(i * 8 + 2), b = bytes.readUInt16LE(i * 8 + 4), key = r * 4294967296 + g * 65536 + b;
  let rgb = cache.get(key);
  if (!rgb) { rgb = film.encode([linearOf(r), linearOf(g), linearOf(b)]).map(toByte); cache.set(key, rgb); }
  out[i * 3] = rgb[0]; out[i * 3 + 1] = rgb[1]; out[i * 3 + 2] = rgb[2];
}
process.stdout.write(out);
"""


def exact_transfer(file):
    reference(file)
    done = subprocess.run(['node', '--input-type=module', '-e', EXACT_JS, str(capture/file), pins[file], str(size)],
                          cwd=lab_dir, capture_output=True, check=False)
    if done.returncode != 0 or len(done.stdout) != size*size*3:
        raise SystemExit('Exact film transform failed: ' + done.stderr.decode('utf8', 'replace'))
    return np.frombuffer(done.stdout, dtype=np.uint8).reshape(size, size, 3).astype(float)


report = json.loads(reference('capture-report.json'))
rows = sorted(report['images'], key=lambda r: (r['step'], ['front', 'oblique', 'side'].index(r['camera'])))
assert len(rows) == 15 and report['settings']['resolution'] == [size, size] and report['settings']['color_profile'] == PROFILE
name = lambda row, kind: 't%04d_%s_%s.png' % (row['step'], row['camera'], kind)
case = lambda row: 't%04d_%s' % (row['step'], row['camera'])
transfer_rows, identity_rows, native_rows, diagnostics = [], [], [], []
for row in rows:
    if row['step'] != transfer['step'] or row['camera'] not in transfer['cameras']:
        continue
    raw = row['hdr_raw']
    assert raw['file'] == 'frames/t%04d_%s_hdr.rgba16f' % (row['step'], row['camera']) and raw['sha256'] == pins[raw['file']]
    reference(row['file'])
    a = rgb(capture/row['file'])
    t, digest = lab(name(row, 'transfer'))
    m = metrics(a, t)
    transfer_rows.append({'case': case(row), 'ue': row['file'], 'ueHdr': raw['file'], 'lab': name(row, 'transfer'), 'labRgbaSha256': digest,
                          'transferMae255': m['mae255'], 'transferP95ChannelError255': m['p95ChannelError255'],
                          'maxChannelError255': m['maxChannelError255'], 'unionPixels': m['unionPixels'],
                          'accepted': m['mae255'] <= transfer['transferMae255Max'] and m['p95ChannelError255'] <= transfer['transferP95ChannelError255Max']})
    e = metrics(exact_transfer(raw['file']), t)
    identity_rows.append({'case': case(row), 'kind': 'lab GPU transfer canvas vs exact film-color.js transform of the same raw HDR (diagnostic)',
                          'ueHdr': raw['file'], 'lab': name(row, 'transfer'), 'mae255': e['mae255'],
                          'p95ChannelError255': e['p95ChannelError255'], 'maxChannelError255': e['maxChannelError255'],
                          'unionPixels': e['unionPixels']})
assert len(transfer_rows) == len(transfer['cameras'])
transfer_ok = all(r['accepted'] for r in transfer_rows)
head = {'reference': {'run': REFERENCE, 'profile': PROFILE, 'checkpoint': 'docs/delivery/st01c/basichit/reference-profiled-checkpoint.json',
                      'checkpointSha256': sha(checkpoint_bytes), 'transferInput': 'raw RGBA16F SceneColor HDR (images[].hdr_raw)'},
        'chain': 'BasicHitSimulation -> instanced sprite layers -> half-float HDR target -> film-color.js Filmic LUT -> canvas',
        'thresholdsBeforeReview': {'source': 'docs/delivery/st01c/basichit/render-sources.json', 'sha256': sha(sources_bytes),
                                   'thresholds': thresholds}}
if transfer_only:
    result = {'schema': 'st01c-basichit-transfer-check/v1', **head, 'transferIdentity': identity_rows,
              'transfer': transfer_rows, 'transferAccepted': transfer_ok}
    (out/'transfer-check.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf8', newline='\n')
    print(json.dumps(result, indent=2))
    sys.exit(0 if transfer_ok else 'BasicHit transfer precondition failed; no native result is computed')
if transfer_ok:
    for row in rows:
        reference(row['file'])
        a = rgb(capture/row['file'])
        for kind in ('native', 'reverse'):
            b, digest = lab(name(row, kind))
            m = metrics(a, b)
            entry = {'case': case(row), 'ue': row['file'], 'lab': name(row, kind), 'labRgbaSha256': digest,
                     'nativeMaskIoU32': m['maskIoU32'], 'nativeMae255': m['mae255'], 'nativeMaxChannelError255': m['maxChannelError255'],
                     'unionPixels': m['unionPixels'], 'uePixelsGt32': m['uePixelsGt32'], 'labPixelsGt32': m['labPixelsGt32']}
            if kind == 'native':
                entry['accepted'] = m['maskIoU32'] is not None and m['maskIoU32'] >= thresholds['maskIoUMin'] and m['mae255'] <= thresholds['meanRgbMax255']
                native_rows.append(entry)
            else:
                entry['kind'] = 'reverse draw order (diagnostic)'
                diagnostics.append(entry)
    assert len(native_rows) == 15
    baseline = report['empty_baseline']
    reference(baseline['file'])
    b, digest = lab(name(baseline, 'native'))
    a = rgb(capture/baseline['file'])
    diagnostics.append({'case': 't0000_front', 'kind': 'empty baseline (diagnostic)', 'ue': baseline['file'], 'lab': name(baseline, 'native'),
                        'labRgbaSha256': digest, 'ueMaxChannel255': float(a.max()), 'labMaxChannel255': float(b.max())})
native_ok = transfer_ok and all(r['accepted'] for r in native_rows)
result = {'schema': 'st01c-basichit-render-comparison/v2', **head,
          'transfer': transfer_rows, 'transferAccepted': transfer_ok,
          'native': native_rows, 'nativeAccepted': native_ok if transfer_ok else None,
          'transferIdentity': identity_rows, 'diagnostics': diagnostics,
          'accepted': transfer_ok and native_ok}
(out/'comparison.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf8', newline='\n')
print(json.dumps(result, indent=2))
if not result['accepted']:
    sys.exit('BasicHit render gate failed (transfer %s, native %s); evidence kept in comparison.json' %
             ('pass' if transfer_ok else 'FAIL', ('pass' if native_ok else 'FAIL') if transfer_ok else 'not computed'))
