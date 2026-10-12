"""Crop explicitly requested alpha atlases; retain source pixels and export UI sizes.

Usage: python tools/crafting-ui/cooking_icons.py [repo-root]
No keying, background removal, repainting, or alpha-value edits are performed.
"""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
ART = ROOT / 'docs/art/cooking-icons-v1'
SRC = ART / 'source'
KIT = ROOT / 'assets/ui/kit'
# Crop gutters follow the actual silhouettes, including the wide fish tails.
CUTS = [
    ('pescado', 'Pescado', 'sheet-a-basics.png', (0, 0, 615, 485), 'current'),
    ('fruta', 'Fruta tropical', 'sheet-a-basics.png', (615, 0, 1030, 485), 'current'),
    ('harina', 'Harina', 'sheet-a-basics.png', (1030, 0, 1536, 485), 'current'),
    ('galleta', 'Galleta de barco', 'sheet-a-basics.png', (0, 485, 512, 1024), 'current'),
    ('ron', 'Ron', 'sheet-a-basics.png', (512, 485, 1024, 1024), 'current'),
    ('agua', 'Agua dulce', 'sheet-a-basics.png', (1024, 485, 1536, 1024), 'current'),
    ('meal_roastFish', 'Pescado asado', 'sheet-b-meals-concepts.png', (0, 0, 570, 512), 'meal'),
    ('meal_grog', 'Grog', 'sheet-b-meals-concepts.png', (570, 0, 1030, 512), 'meal'),
    ('meal_heartyBiscuit', 'Galleta reforzada', 'sheet-b-meals-concepts.png', (1030, 0, 1536, 512), 'meal'),
    ('sal_marina', 'Sal marina (propuesta)', 'sheet-b-meals-concepts.png', (0, 512, 512, 1024), 'proposal'),
    ('lima', 'Lima (propuesta)', 'sheet-b-meals-concepts.png', (512, 512, 1024, 1024), 'proposal'),
    ('hierbas_aromaticas', 'Hierbas (propuesta)', 'sheet-b-meals-concepts.png', (1024, 512, 1536, 1024), 'proposal'),
    ('cana', 'Caña de azúcar', 'sheet-c-pantry.png', (0, 0, 820, 1024), 'ingredient'),
    ('especias', 'Especias', 'sheet-c-pantry.png', (820, 0, 1536, 1024), 'ingredient'),
    ('coco', 'Coco', 'coconut-reused.png', None, 'sql037-art'),
    ('resina', 'Resina (material)', 'resin-reused.png', None, 'sql037-art'),
    ('antorcha', 'Antorcha apagada (referencia)', 'torch-reused.png', None, 'reference'),
]
# Same order as ICON_ATLASES.foods in src/ui/kit.js. Concepts never enter runtime.
RUNTIME = ['pescado', 'fruta', 'harina', 'galleta', 'ron', 'agua', 'cana', 'especias',
           'coco', 'resina', 'meal_roastFish', 'meal_grog', 'meal_heartyBiscuit']
COLS, ROWS = 4, 4


def fit_native(img):
    alpha = img.getchannel('A')
    box = alpha.point(lambda value: 255 if value > 24 else 0).getbbox()
    if not box or alpha.getextrema()[0] != 0:
        raise ValueError('Expected actual transparent padding and a nonempty silhouette')
    # Threshold is only for framing/checking; saved alpha values are never changed.
    if box[0] == 0 or box[1] == 0 or box[2] == img.width or box[3] == img.height:
        raise ValueError(f'Silhouette touches cut edge: {box} in {img.size}')
    box = (max(0, box[0]-8), max(0, box[1]-8), min(img.width, box[2]+8), min(img.height, box[3]+8))
    subject = img.crop(box)
    side = round(max(subject.size) * 1.12)
    canvas = Image.new('RGBA', (side, side))
    canvas.alpha_composite(subject, ((side-subject.width)//2, (side-subject.height)//2))
    return canvas, box


def atlas(ids, icons, cell):
    sheet = Image.new('RGBA', (COLS*cell, ROWS*cell))
    for i, ident in enumerate(ids):
        sheet.alpha_composite(icons[ident].resize((cell, cell), Image.Resampling.LANCZOS),
                              ((i % COLS)*cell, (i//COLS)*cell))
    return sheet


def main():
    icons, report = {}, []
    (ART/'singles').mkdir(parents=True, exist_ok=True)
    (ART/'proposals').mkdir(parents=True, exist_ok=True)
    KIT.mkdir(parents=True, exist_ok=True)
    for ident, label, filename, crop, status in CUTS:
        original = Image.open(SRC/filename).convert('RGBA')
        image = original.crop(crop) if crop else original
        image, bounds = fit_native(image)
        folder = 'proposals' if status == 'proposal' else 'singles'
        output = ART/folder/f'{ident}.png'
        image.save(output, optimize=True)
        icons[ident] = image
        report.append({'id': ident, 'label': label, 'status': status, 'file': f'{folder}/{ident}.png',
                       'dimensions': list(image.size), 'source': f'source/{filename}',
                       'crop': list(crop) if crop else None, 'alphaBoundsInCrop': list(bounds),
                       'alphaRange': list(image.getchannel('A').getextrema()),
                       'sha256': hashlib.sha256(output.read_bytes()).hexdigest()})
    assets = []
    for cell, suffix in [(128, ''), (64, '-mobile')]:
        target = KIT/f'foods-v1{suffix}.webp'
        atlas(RUNTIME, icons, cell).save(target, 'WEBP', quality=90 if cell == 128 else 84, method=6)
        assets.append({'file': target.relative_to(ROOT).as_posix(), 'dimensions': [COLS*cell, ROWS*cell],
                       'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    # A high-resolution, regular transparent atlas for external reuse, not served by the game.
    all_ids = [entry[0] for entry in CUTS]
    cols, cell = 4, 512
    full = Image.new('RGBA', (cols*cell, ((len(all_ids)+cols-1)//cols)*cell))
    contact = Image.new('RGB', full.size, '#132b38')
    draw = ImageDraw.Draw(contact)
    for i, ident in enumerate(all_ids):
        x, y = i%cols*cell, i//cols*cell
        # Atlas sizes are derivatives. Singles above retain native source resolution.
        icon = icons[ident].resize((cell, cell), Image.Resampling.LANCZOS)
        full.alpha_composite(icon, (x, y))
        thumbnail = icons[ident].resize((cell-40, cell-40), Image.Resampling.LANCZOS)
        contact.paste(thumbnail, (x+20, y+5), thumbnail)
        draw.text((x+20, y+cell-25), ident, fill='#e8ecdf')
    full.save(ART/'cooking-atlas-alpha.png', optimize=True)
    contact.save(ART/'contact-sheet.jpg', quality=90)
    sources = [{'file': path.relative_to(ART).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'dimensions': list(Image.open(path).size)} for path in sorted(SRC.glob('*.png'))]
    manifest = {'schema': 'marea.art.cooking-icons.v1', 'generation': 'Built-in image_gen, actual alpha',
                'sourceTreatment': 'Crop, center, resize; original alpha preserved. No keying or repainting.',
                'runtime': {'columns': COLS, 'rows': ROWS, 'ids': RUNTIME, 'assets': assets},
                'externalAtlas': {'file': 'cooking-atlas-alpha.png', 'columns': 4, 'rows': 5, 'cell': 512, 'ids': all_ids},
                'sources': sources, 'items': report}
    (ART/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    # Pack only deliberate deliverables; no .scratch, secrets, or unrelated evidence.
    with zipfile.ZipFile(ART/'cooking-tripo-pack-v1.zip', 'w', compression=zipfile.ZIP_DEFLATED) as package:
        for name in ['README.md', 'manifest.json', 'prompts.json', 'source/reused-provenance.md', 'cooking-atlas-alpha.png', 'contact-sheet.jpg']:
            path = ART/name
            if path.exists():
                package.write(path, name)
        for folder in ['singles', 'proposals']:
            for path in sorted((ART/folder).glob('*.png')):
                package.write(path, path.relative_to(ART).as_posix())
    print(json.dumps({'items': len(report), 'proposals': 3, 'runtimeAssets': assets,
                      'zipBytes': (ART/'cooking-tripo-pack-v1.zip').stat().st_size}))


if __name__ == '__main__':
    main()
