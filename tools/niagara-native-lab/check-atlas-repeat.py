"""Compare decoded pixel bytes, not PNG compression or diagnostic timings."""
import hashlib
import json
import re
import sys
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
runs=sys.argv[1:] or ['budget01','budget02']
if len(runs)!=2 or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,40}',r) for r in runs): raise ValueError('Pass two local run IDs')
folders=[ROOT/'.scratch/atlas-lab'/r for r in runs]
cases=[json.loads((folder/'cases.json').read_text(encoding='utf8')) for folder in folders]
assert cases[0]==cases[1],'Comparison corpus changed'
count=0; hashes=[]
for variant in ['source','full','half','quarter']:
    digest=hashlib.sha256()
    for case in cases[0]:
        data=[]
        for folder in folders:
            with Image.open(folder/variant/case['file']) as image:
                assert image.size==(512,512)
                data.append(image.convert('RGBA').tobytes())
        assert data[0]==data[1],f"Repeat changed: {variant}/{case['file']}"
        digest.update(data[0]);count+=1
    hashes.append({'variant':variant,'decodedRgbaCorpusSha256':digest.hexdigest()})
result={'schema':'st01c-atlas-repeat/v1','runs':runs,'comparedImages':count,'allDecodedPixelsEqual':True,'corpusHashes':hashes}
(folders[1]/'repeat.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8',newline='\n')
print(json.dumps(result))
