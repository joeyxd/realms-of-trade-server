import datetime
import importlib.util
import json
import urllib.request

spec=importlib.util.spec_from_file_location('u','/opt/marea-negra/ops/vps-update.py')
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
revision='d9620558a93f6a6ed88614857b03d7d9822a4b1b'
version='0.6.0-alpha.38'
protocol=46
container=u.active_container()
actual=u.active_revision(container)
assert actual == revision, 'expected reviewed release is not active yet'
inspection=json.loads(u.run(['docker','inspect','--format','{{json .State}}',container]).stdout)
assert inspection['Running'] and inspection['Health']['Status']=='healthy'
image=u.run(['docker','inspect','--format','{{.Image}}',container]).stdout.strip()
full_id=u.run(['docker','inspect','--format','{{.Id}}',container]).stdout.strip()
status=u.local_status(container)
assert status['version']==version
st=status['storage']
assert status['errors']==0 and st['errors']==0 and st['unsaved']==0
assert st['durable'] and st['accounts'] and not st['tickBlocked']
assert st['economic']['pending']==0 and not st['economic']['failed']
assert st['world']['ready'] and not st['world']['failed']
assert st['resources']['ready'] and st['workshop']['ready'] and st['artisan']['ready']
base='https://marea.62.171.136.148.sslip.io'
def get(path):
    with urllib.request.urlopen(base+path,timeout=15) as response:
        return response.status,response.read().decode('utf-8')
health_code,health=get('/health');assert health_code==200 and health.strip()=='ok'
status_code,public=get('/status');public=json.loads(public)
assert status_code==200 and public['version']==version and public['storage']['world']['ready']
protocol_code,source=get('/src/net/protocol.js');assert protocol_code==200 and 'PROTOCOL_VERSION = 46' in source
meta_code,meta=get('/src/data/meta.js');assert meta_code==200 and version in meta
auth_code,auth=get('/auth/config');assert auth_code==200 and json.loads(auth)['enabled'] is True
timer=u.run(['systemctl','is-active','marea-negra-update.timer'],check=False).stdout.strip()
code="""import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
const c=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const ready={};for(const name of ['mn_starter_workshop_ready','mn_workshop_raft_identifiers_ready']) {
const r=await c.rpc(name);if(r.error||r.data?.version!==1) throw Error('readiness mismatch');ready[name]=r.data.version;}
const files=['server/economicAuthority.mjs','src/data/meta.js','src/net/protocol.js','package.json'];
console.log(JSON.stringify({readiness:ready,sourceHashes:Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))}));"""
try:
    proof=json.loads(u.run(['docker','exec','-i',container,'node','--input-type=module'],input_text=code,timeout=45).stdout)
except Exception:
    raise RuntimeError('read-only source/readiness verification failed') from None
print(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readonly':True,
 'revision':actual,'version':version,'protocol':protocol,'imageId':image,'containerId':full_id,
 'containerStartedAt':inspection['StartedAt'],'singleAuthority':True,'dockerHealth':inspection['Health']['Status'],
 'publicHealthStatus':health_code,'publicStatusStatus':status_code,'publicProtocolMatches':True,'publicVersionMatches':True,
 'authEnabled':True,'timer':timer,'players':status['players'],'sockets':status['sockets'],
 'storage':{'kind':st['kind'],'durable':st['durable'],'accounts':st['accounts'],'errors':st['errors'],
  'unsaved':st['unsaved'],'profileWrites':st['profileWrites'],'worldWriting':st['worldWriting'],
  'tickBlocked':st['tickBlocked'],'economic':st['economic'],'resources':st['resources'],
  'workshop':st['workshop'],'artisan':st['artisan'],'world':st['world']},**proof}))
