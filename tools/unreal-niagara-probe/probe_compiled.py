"""Export effective CPU translations of a scoped system; never save an asset.

Command line: -SystemSpec=<absolute systems/*.json> -ProbeRun=<fresh name>.
Writes <project>/<ProbeRun>/ (report.json plus one .hlsl per script).
"""
import hashlib
import json
from pathlib import Path
import re
import unreal


def command_line_value(name):
    """Value of -name=... from the command line; handles a whole-argument quote and spaces."""
    line = unreal.SystemLibrary.get_command_line()
    match = re.search(r'-' + name + '=', line, re.IGNORECASE)
    if not match:
        return None
    rest = line[match.end():]
    if match.start() > 0 and line[match.start() - 1] == '"':
        return rest.split('"', 1)[0]
    if rest.startswith('"'):
        return rest[1:].split('"', 1)[0]
    return rest.split()[0] if rest.split() else None


project = Path(unreal.Paths.project_dir()).resolve()
assert project.name == 'unreal' and project.parent.name == '.scratch'
spec_path = command_line_value('SystemSpec')
run = command_line_value('ProbeRun')
assert spec_path and Path(spec_path).is_file(), 'A -SystemSpec=<absolute spec json> is required'
assert run and re.fullmatch(r'[A-Za-z0-9_-]{1,40}', run), 'A fresh bounded -ProbeRun is required'
spec_text = Path(spec_path).read_text(encoding='utf-8')
spec = json.loads(spec_text)
assert spec.get('schema') == 'st01c-system-spec/v1', 'Unsupported system spec schema'
out = project / run
assert not out.exists(), 'Refusing to replace evidence'
out.mkdir()
system = unreal.load_asset(spec['systemPackage'])
assert system
# The spec text goes to the plugin as is; it validates path, handles, seeds and script count.
settings = json.loads(unreal.ST01cRuntimeProbe.configure_system(system, spec_text))
assert 'error' not in settings, settings
payload = json.loads(unreal.ST01cRuntimeProbe.read_compiled_system(system, spec_text))
assert 'error' not in payload, payload
assert payload['schema'] == 'st01c-compiled-pilot/v1'
if spec.get('expectedScriptCount') is not None:
    assert len(payload['scripts']) == spec['expectedScriptCount']
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
unreal.log('ST01c compiled report: ' + str(out / 'report.json'))
