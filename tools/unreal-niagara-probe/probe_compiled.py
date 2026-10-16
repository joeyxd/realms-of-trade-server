"""Export effective CPU translations of the scoped pilot; never save an asset."""
import hashlib
import json
from pathlib import Path
import re
import unreal

project = Path(unreal.Paths.project_dir()).resolve()
assert project.name == 'unreal' and project.parent.name == '.scratch'
match = re.search(r'(?:^|\s)-CompiledRun=([A-Za-z0-9_-]{1,40})(?:\s|$)', unreal.SystemLibrary.get_command_line())
assert match, 'A fresh bounded CompiledRun is required'
out = project / match[1]
assert not out.exists(), 'Refusing to replace evidence'
out.mkdir()
system = unreal.load_asset('/Game/sA_Megapack_v1/sA_StylizedAttacksPack/FX/NiagaraSystems/NS_Flame_Single')
assert system
settings = json.loads(unreal.ST01cRuntimeProbe.configure_pilot(system))
assert 'error' not in settings
payload = json.loads(unreal.ST01cRuntimeProbe.read_compiled_pilot(system))
assert payload['schema'] == 'st01c-compiled-pilot/v1'
assert len(payload['scripts']) == 10
rows = []
for index, script in enumerate(payload['scripts']):
    text = script.pop('hlsl')
    filename = f'{index:02d}-{script["usage"]}.hlsl'
    data = text.encode('utf8')
    (out / filename).write_bytes(data)
    rows.append({**script, 'file': filename, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
report = {'schema': payload['schema'], 'system': payload['system'], 'settings': settings, 'scripts': rows,
          'vmReciprocalEstimates': payload['vmReciprocalEstimates'],
          'scope': 'Effective CPU compiler output with in-memory fixture seeds; source assets never saved.'}
(out / 'report.json').write_bytes((json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf8'))
unreal.log('ST01c compiled pilot report: ' + str(out / 'report.json'))
