"""Use the predeclared color gates; calibrated transfer and complete effect are separate."""
import json
from pathlib import Path
import numpy as np
from PIL import Image
root = Path(__file__).resolve().parents[2]
capture = root/'.scratch/unreal/color07'
out = root/'.scratch/color-lab/color07'
report = json.loads((capture/'color-report.json').read_text(encoding='utf8'))
rows = []
for row in report['images']:
    name = row['case']+'_'+row['camera']
    a = np.asarray(Image.open(capture/row['files']['ldr']['file']).convert('RGB'), dtype=float)
    b = np.asarray(Image.open(out/(name+'_native.png')).convert('RGB'), dtype=float)
    t = np.asarray(Image.open(out/(name+'_transfer.png')).convert('RGB'), dtype=float)
    assert a.shape == b.shape == t.shape == (512, 512, 3)
    if name.startswith('chart'):
        native, decoded, raw = [], [], []
        for i, sample in enumerate(report['chart']):
            x, y = sample['sample_xy']
            native.append(b[y, x]); decoded.append(a[y, x]); raw.append(row['samples'][i]['ldr_byte_rgb'])
        error = abs(np.asarray(native)-decoded)
        assert np.array_equal(np.asarray(raw), decoded), 'Raw byte readback differs from PNG'
        rows.append({'case': name, 'kind': 'calibration', 'samples': 48, 'rawBytesEqualPng': True,
                     'nativeVsUeMax255': float(error.max()), 'nativeVsUeMean255': float(error.mean()),
                     'accepted': bool(error.max() <= 4 and error.mean() <= 2)})
    else:
        active = (a.max(2)>8) | (t.max(2)>8)
        transfer_error = abs(a-t)[active]
        active_native = (a.max(2)>8) | (b.max(2)>8)
        ma, mb = a.max(2)>32, b.max(2)>32
        mae = float(abs(a-b)[active_native].mean())
        iou = float((ma&mb).sum()/(ma|mb).sum())
        te = float(transfer_error.mean()); p95 = float(np.percentile(transfer_error, 95))
        rows.append({'case': name, 'kind': 'pilot', 'transferMae255': te, 'transferP95ChannelError255': p95,
                     'nativeMae255': mae, 'nativeMaskIoU32': iou, 'nativeMaxChannelError255': float(abs(a-b).max()),
                     'accepted': te <= 2 and p95 <= 4 and mae <= 10 and iou >= .94})
result = {'schema': 'st01c-color-comparison/v1', 'profile': 'controlled UE5.8 Filmic SDR sRGB, targetGamma2.2, no bloom',
          'thresholdsBeforeReview': {'calibrationMax255': 4, 'calibrationMean255': 2,
              'transferMae255': 2, 'transferP95ChannelError255': 4, 'nativeMae255': 10, 'nativeIoUMin': .94},
          'cases': rows, 'accepted': all(row['accepted'] for row in rows), 'bloomOrArbitraryGradingAccepted': False}
(out/'comparison.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf8', newline='\n')
print(json.dumps(result, indent=2))
assert result['accepted'], 'Declared color gate failed; retain evidence and investigate'
