"""Compare decoded screenshot bytes; PNG lossless compression is not pixel evidence."""
import hashlib
import json
import re
import sys
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]/'.scratch/unreal'
runs = sys.argv[1:]
assert len(runs) == 2 and all(re.fullmatch(r'[A-Za-z0-9_-]{1,40}', r) for r in runs)
reports = [json.loads((root/r/'color-report.json').read_text(encoding='utf8')) for r in runs]
rows = []
for a, b in zip(reports[0]['images'], reports[1]['images']):
    names = [r['files']['ldr']['file'] for r in (a, b)]
    assert names[0] == names[1] and re.fullmatch(r'[A-Za-z0-9_-]+\.png', names[0])
    images = [Image.open(root/run/name).convert('RGBA') for run, name in zip(runs, names)]
    assert all(i.size == (512, 512) for i in images)
    data = [i.tobytes() for i in images]
    assert data[0] == data[1], 'Repeated screenshot pixels differ: '+names[0]
    assert set(data[0][3::4]) == {255}, 'Controlled SDR screenshot must be opaque'
    rows.append({'file': names[0], 'decodedRgbaSha256': hashlib.sha256(data[0]).hexdigest(), 'allAlpha255': True})
print(json.dumps(rows))
