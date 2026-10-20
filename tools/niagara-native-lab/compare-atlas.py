"""Compare atlas derivatives with the original rendering under predeclared gates."""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image
ROOT = Path(__file__).resolve().parents[2]
run = sys.argv[1] if len(sys.argv) > 1 else 'budget01'
if not run.replace('_','').replace('-','').isalnum() or len(run)>40: raise ValueError('Invalid run')
out = ROOT/'.scratch/atlas-lab'/run
cases = json.loads((out/'cases.json').read_text(encoding='utf8'))
ue = json.loads((ROOT/'.scratch/unreal/color07/color-report.json').read_text(encoding='utf8'))
def image(path): return np.asarray(Image.open(path).convert('RGB'),dtype=np.float64)
def metrics(a,b):
    assert a.shape==b.shape==(512,512,3)
    union=(a.max(2)>8)|(b.max(2)>8); ma=a.max(2)>32;mb=b.max(2)>32
    error=np.abs(a-b); active=error[union];denom=(ma|mb).sum()
    return {'mae255':float(active.mean()) if union.any() else 0.,
            'p95Channel255':float(np.percentile(active,95)) if union.any() else 0.,
            'maskIoU32':float((ma&mb).sum()/denom) if denom else 1.,
            'max255':float(error.max()),'pixelsEqual':bool(np.array_equal(a,b)),
            'emptyPreserved':bool(np.array_equal(a,b)) if not (a>0).any() else True}
variants=[]
# KTX2 variants are evaluated only when the run folder has them, so earlier runs still compare.
for variant in ['full','half','quarter']+[v for v in ['ktx2-uastc','ktx2-uastc-box','ktx2-rgba8','ktx2-rgba8-box'] if (out/v).is_dir()]:
    rows=[];ue_rows=[]
    for case in cases:
        baseline=image(out/'source'/case['file']);candidate=image(out/variant/case['file'])
        m=metrics(baseline,candidate)
        m['accepted']=m['emptyPreserved'] and (m['pixelsEqual'] if variant=='full' else m['mae255']<=2 and m['p95Channel255']<=6 and m['maskIoU32']>=.98)
        rows.append({'case':case,**m})
        if case['kind']=='pilot' and case['tick']==120:
            row=next(r for r in ue['images'] if r['case']=='pilotEV'+str(case['bias']) and r['camera']==case['view'])
            comparison=metrics(image(ROOT/'.scratch/unreal/color07'/row['files']['ldr']['file']),candidate)
            ue_rows.append({'view':case['view'],'bias':case['bias'],**comparison,
                'accepted':comparison['mae255']<=10 and comparison['maskIoU32']>=.94})
    variants.append({'variant':variant,'accepted':all(r['accepted'] for r in rows+ue_rows),
                     'failures':sum(not r['accepted'] for r in rows+ue_rows),'originalFailures':sum(not r['accepted'] for r in rows),
                     'ueFailures':sum(not r['accepted'] for r in ue_rows),
                     'worstCase':{'maxMae255':max(rows,key=lambda r:r['mae255'])['case'],'minIoU':min(rows,key=lambda r:r['maskIoU32'])['case'],
                                  'maxP95':max(rows,key=lambda r:r['p95Channel255'])['case']},
                     'originalCases':rows,'ueCases':ue_rows})
result={'schema':'st01c-atlas-comparison/v1','run':run,'thresholdsBeforeReview':{'mae255':2,'p95Channel255':6,'maskIoU32':.98,'ueMae255':10,'ueIoU32':.94},'variants':variants}
(out/'comparison.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8',newline='\n')
for row in variants:
 print(json.dumps({'variant':row['variant'],'accepted':row['accepted'],'failures':row['failures'],
   'maxMae255':max(r['mae255'] for r in row['originalCases']),'minIoU':min(r['maskIoU32'] for r in row['originalCases']),
   'maxP95':max(r['p95Channel255'] for r in row['originalCases']),'ueMaxMae255':max(r['mae255'] for r in row['ueCases'])}))
assert variants[0]['accepted'],'Lossless full variant must preserve original pixels'
