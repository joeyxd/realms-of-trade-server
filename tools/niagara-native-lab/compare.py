"""Diagnostic image comparison, not a visual-fidelity acceptance threshold.

Inputs are 512px PNGs written by qa.mjs. Both sides use Three ACES at exposure 1.
The UE side comes from SceneColor HDR; the browser side renders observed attributes.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[2] / '.scratch' / 'browser-lab'
result = {'method': 'same output transform; step120; RGB8; union max-channel>8; silhouette max-channel>32',
          'acceptance': False, 'views': {}}
for view in ('front', 'oblique', 'side'):
    a = np.asarray(Image.open(root / f'ue-linear-{view}.png').convert('RGB'), dtype=float)
    b = np.asarray(Image.open(root / f'canvas-{view}.png').convert('RGB'), dtype=float)
    if a.shape != (512, 512, 3) or b.shape != a.shape:
        raise ValueError('Expected original 512px framebuffer images')
    active = (a.max(2) > 8) | (b.max(2) > 8)
    ma, mb = a.max(2) > 32, b.max(2) > 32
    if not active.any() or not (ma | mb).any():
        raise ValueError('Blank comparison')
    result['views'][view] = {'activePixels': int(active.sum()),
        'activeRgbMae255': float(abs(a-b)[active].mean()),
        'maskThreshold32IoU': float((ma & mb).sum() / (ma | mb).sum()),
        'maxChannelDifference255': float(abs(a-b).max())}
(root / 'material-comparison.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps(result, indent=2))
