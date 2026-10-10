import json
import os
import subprocess
from datetime import datetime, timezone

name = 'marea-negra-alpha-marea-negra-alpha-1'
info = json.loads(subprocess.check_output(['docker', 'inspect', name], text=True))[0]
labels = info['Config'].get('Labels', {})
state = info['State']
print(json.dumps({
    'at': datetime.now(timezone.utc).isoformat(),
    'container': name,
    'revision': labels.get('org.opencontainers.image.revision'),
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
}))
