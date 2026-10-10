import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const source = `
import subprocess,json,urllib.request,pathlib,hashlib,time
def run(args):
 return subprocess.check_output(args,text=True,timeout=15).strip()
ids=run(['docker','ps','--filter','label=com.docker.compose.project=marea-negra-alpha','--filter','label=com.docker.compose.service=marea-negra-alpha','--format','{{.ID}}']).splitlines()
out={'containers':len(ids),'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
if len(ids)==1:
 out['active']=run(['docker','inspect','--format','{{.Id}} {{.Image}} {{.State.Health.Status}} {{index .Config.Labels "org.opencontainers.image.revision"}}',ids[0]])
 out['command']=run(['docker','inspect','--format','{{json .Config.Cmd}}',ids[0]])
code="fetch('http://127.0.0.1:5173/status').then(r=>r.json()).then(s=>console.log(JSON.stringify({players:s.players,sockets:s.sockets,tick:s.tick,errors:s.errors,storage:{kind:s.storage.kind,durable:s.storage.durable,accounts:s.storage.accounts,unsaved:s.storage.unsaved,errors:s.storage.errors,tickBlocked:s.storage.tickBlocked,economic:s.storage.economic,resources:s.storage.resources,profileWrites:s.storage.profileWrites,worldWriting:s.storage.worldWriting,world:s.storage.world}})))"
if len(ids)==1:out['status']=json.loads(run(['docker','exec',ids[0],'node','-e',code]))
for route in ['health','']:
 try:
  with urllib.request.urlopen('https://marea.62.171.136.148.sslip.io/'+route,timeout=10) as r:out['public_'+(route or 'page')]=r.status
 except Exception as e:out['public_'+(route or 'page')]=type(e).__name__
if len(ids)==1:
 revision=out['active'].split()[-1]
 marker=pathlib.Path('/opt/marea-negra/ops/validated-'+revision+'.json')
 if marker.exists():out['validation']=json.loads(marker.read_text())
 log=pathlib.Path('/opt/marea-negra/ops/update-'+revision+'.log')
 if log.exists():out['offline_summary']=[line for line in log.read_text().splitlines() if line.startswith(('# tests ','# pass ','# fail ','# skipped '))][-4:]
out['current']=str(pathlib.Path('/opt/marea-negra/current').resolve())
out['timer']=subprocess.run(['systemctl','is-active','marea-negra-update.timer'],capture_output=True,text=True,timeout=15).stdout.strip()
out['service']=run(['systemctl','show','marea-negra-update.service','-p','ActiveState','-p','ExecMainStatus'])
out['updater_sha256']=hashlib.sha256(pathlib.Path('/opt/marea-negra/ops/vps-update.py').read_bytes()).hexdigest()
print(json.dumps(out))
`;
const result=JSON.parse(execFileSync('ssh.exe',['-o','BatchMode=yes','-o','ConnectTimeout=8','root@62.171.136.148','python3','-'],{input:source,encoding:'utf8',timeout:60000}));
fs.writeFileSync('.scratch/rnv03-vps-update-evidence.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
