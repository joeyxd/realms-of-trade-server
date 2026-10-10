import json
import os
import subprocess
import re
import sys
from datetime import datetime, timezone

name = 'marea-negra-alpha-marea-negra-alpha-1'
info = json.loads(subprocess.check_output(['docker', 'inspect', name], text=True))[0]
labels = info['Config'].get('Labels', {})
state = info['State']
revision = labels.get('org.opencontainers.image.revision')
expected = sys.argv[1] if len(sys.argv) == 2 else revision
if not re.fullmatch(r'[0-9a-f]{40}', expected or '') or expected != revision:
    raise SystemExit('expected revision is not active')
with open('/opt/marea-negra/ops/validated-' + revision + '.json') as source:
    validation = json.load(source)
if validation != {'revision': revision, 'image_id': info['Image'], 'tests_passed': True}:
    raise SystemExit('image validation identity mismatch')
with open('/opt/marea-negra/ops/update-' + revision + '.log') as source:
    log = source.read()
counts = {key: int(re.findall(r'^# ' + key + r' (\d+)$', log, re.MULTILINE)[-1])
          for key in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo')}
authorities = subprocess.check_output(['docker', 'ps', '--filter',
    'label=com.docker.compose.project=marea-negra-alpha', '--format', '{{.Names}}'], text=True).splitlines()
print(json.dumps({
    'at': datetime.now(timezone.utc).isoformat(),
    'container': name,
    'revision': revision,
    'version': labels.get('org.opencontainers.image.version'),
    'image': info['Config']['Image'],
    'imageId': info['Image'],
    'containerId': info['Id'],
    'running': state['Running'],
    'health': state.get('Health', {}).get('Status'),
    'startedAt': state['StartedAt'],
    'oomKilled': state['OOMKilled'],
    'currentRelease': os.path.realpath('/opt/marea-negra/current'),
    'updateState': json.load(open('/opt/marea-negra/update-state.json')),
    'validation': validation,
    'offlineCounts': counts,
    'authorities': authorities,
    'timer': subprocess.check_output(['systemctl', 'is-active', 'marea-negra-update.timer'], text=True).strip(),
}))
