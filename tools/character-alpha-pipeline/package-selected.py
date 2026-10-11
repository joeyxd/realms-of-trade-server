"""Package validated character artwork without including rejected generation attempts."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[2]
source = root / 'docs/art/source/character-alpha-v1'
selected = json.loads((source / 'selected-sources.json').read_text(encoding='utf-8'))
if selected['status'] != 'pass':
    raise ValueError('Selected source validation must pass before packaging')
output = root / 'docs/art/character-alpha-v1/character-alpha-v1-selected.zip'
output.parent.mkdir(parents=True, exist_ok=True)
files = []
for image in selected['images']:
    if Path(image['file']).name != image['file']:
        raise ValueError('Invalid source filename')
    original = source / image['file']
    if hashlib.sha256(original.read_bytes()).hexdigest() != image['sha256']:
        raise ValueError('Source hash changed before packaging')
    files.extend([original, source / 'mobile' / image['file']])
files.extend(source / name for name in ['manifest.json', 'prompts.json', 'selected-sources.json', 'alpha-inspection.json', 'mobile/derivatives-receipt.json'])
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, 'character-alpha-v1/' + file.relative_to(source).as_posix())
with zipfile.ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise ValueError('Archive CRC validation failed')
    if any(name.endswith('/' + bad['file']) for name in archive.namelist() for bad in selected['excludedImages']):
        raise ValueError('Rejected PNG was included in the archive')
print(json.dumps({'archive':str(output),'entries':len(files),'bytes':output.stat().st_size,'crc':'pass','selectedPngs':selected['usedImageCount']}))
