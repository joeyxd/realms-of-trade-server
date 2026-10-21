"""Pack thumbnails from actual AW01 renderer screenshots and retain their provenance."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / '.scratch' / 'aw-thumbnails'
OUTPUT = ROOT / 'assets' / 'workshop' / 'thumbnails'
OUTPUT.mkdir(parents=True, exist_ok=True)
rows = json.loads((INPUT / 'inputs.json').read_text(encoding='utf-8'))
entries = []
for row in rows:
    with Image.open(INPUT / f"{row['slug']}.png") as source:
        width, height = source.size
        side = min(width, height)
        crop = source.crop(((width-side)//2, (height-side)//2, (width+side)//2, (height+side)//2))
        crop.resize((160, 160), Image.Resampling.LANCZOS).convert('RGB').save(OUTPUT / f"{row['slug']}.webp", quality=78)
    artifact = OUTPUT / f"{row['slug']}.webp"
    entries.append({ 'id': row['id'], 'sourceRevision': row['sourceRevision'], 'presentation': row['presentation'],
        'url': f"assets/workshop/thumbnails/{row['slug']}.webp", 'bytes': artifact.stat().st_size,
        'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest(), 'width': 160, 'height': 160,
        'label': 'Render del derivado en el taller; no es una captura Unreal.' })
(OUTPUT.parent / 'thumbnails.json').write_text(json.dumps({ 'schema': 'marea.asset-thumbnails.v1', 'entries': entries }, indent=2) + '\n', encoding='utf-8')
print(f"Packed {len(entries)} real renderer thumbnails.")
