"""Apply the brief's predeclared image thresholds under one shared color transform."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[2] / '.scratch/depth-lab/depth02'
rows = []
names = [f'{name}_{view}' for view in ('front', 'oblique', 'side')
         for name in ('none', 'wall-25', 'wall0', 'wall50', 'wall150')] + ['floor_oblique']
for name in names:
    a = np.asarray(Image.open(root / f'{name}-ue.png').convert('RGB'), dtype=float)
    b = np.asarray(Image.open(root / f'{name}-native.png').convert('RGB'), dtype=float)
    assert a.shape == b.shape == (512, 512, 3)
    active = (a.max(2) > 8) | (b.max(2) > 8)
    ma, mb = a.max(2) > 32, b.max(2) > 32
    union = (ma | mb).sum()
    mae = float(abs(a-b)[active].mean()) if active.any() else 0.
    iou = float((ma & mb).sum() / union) if union else 1.
    rows.append({'case': name, 'activePixels': int(active.sum()), 'rgbMae255': mae,
                 'maskIoU32': iou, 'maxChannelDifference255': float(abs(a-b).max()),
                 'accepted': mae <= 10. and iou >= .94})
result = {'method': '512px; step120; shared Three ACES exposure1; union max>8; masks max>32',
          'thresholdsBeforeReview': {'rgbMae255Max': 10, 'maskIoU32Min': .94},
          'cases': rows, 'accepted': all(r['accepted'] for r in rows), 'finalUnrealColorParity': False}
(root / 'comparison.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf8', newline='\n')
print(json.dumps(result, indent=2))
assert result['accepted'], 'Depth image threshold failed; keep failure evidence and investigate'
