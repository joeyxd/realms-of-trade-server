"""Enable the reviewed starter workshop on the existing idle VPS authority only.

Run via SSH stdin as root. Never prints environment contents or credentials.
The resource upgrade is durable: do not turn the workshop flag off after v3 adoption.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import time

spec = importlib.util.spec_from_file_location("marea_update", "/opt/marea-negra/ops/vps-update.py")
update = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update)
expected = "f939152e24b51774faab3239a902c6cc76e01d3f"
required = ("MN_ECONOMIC_OPERATIONS", "MN_RESOURCE_OPERATIONS", "MN_LOGGING_OPERATIONS",
            "MN_ARTISAN_OPERATIONS", "MN_STARTER_WORKSHOP")
probe = """
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from './server/store.mjs';
import { upgradeTimingState } from './server/resourceState.mjs';
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k,canonical(x[k])])) : x;
const hash = x => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const client = createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}});
const readiness=[];
for(const name of ['mn_ground_world_adoption_ready','mn_starter_workshop_ready',
  'mn_fire_operations_ready','mn_artisan_operations_ready']) {
  const {data,error}=await client.rpc(name);assert.equal(error,null);assert.equal(data?.version,1);
  readiness.push({function:name,version:1});
}
const {data:adoption,error}=await client.rpc('mn_load_ground_world_adoption',{p_world:'marea-negra'});
assert.equal(error,null);
const row=await storeFromEnv().loadWorld('marea-negra'),r=row.data.resources;
console.log(JSON.stringify({at:new Date().toISOString(),readiness,adopted:adoption!==null,
  worldVersion:row.version,resourceVersion:r.v,tick:r.tick,nodes:r.nodes.length,
  palms:r.nodes.filter(n=>n.kind==='palm').length,nodesHash:hash(r.nodes),
  cooldownsHash:hash(r.cooldowns),communityHash:hash(row.data.community),seedHash:hash(row.data.seed),
  upgradedLoggingHash:hash(upgradeTimingState(r).logging),currentLoggingHash:hash(r.logging)}));
"""

def snapshot(container):
    result = update.run(["docker", "exec", "-i", container, "node", "--input-type=module"],
                        input_text=probe, timeout=45)
    return json.loads(result.stdout)

with update.LOCK.open("a+") as lock:
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    with update.content_exclusive_lock():
        old = update.active_container()
        if old is None or update.active_revision(old) != expected:
            raise RuntimeError("active release changed; inspect before activation")
        before_status = update.local_status(old)
        if not update.is_idle_and_durable(before_status):
            raise RuntimeError("world is busy or storage not quiescent; activation withheld")
        before = snapshot(old)
        if before["adopted"] or before["resourceVersion"] not in (2, 3):
            raise RuntimeError("requires unadopted v2/v3 world; no legacy conversion allowed")
        image = update.run(["docker", "inspect", "--format", "{{.Config.Image}}", old]).stdout.strip()
        image_id, revision = update.image_metadata(image)
        if revision != expected:
            raise RuntimeError("image revision mismatch")
        release = update.RELEASES / expected
        if Path("/opt/marea-negra/current").resolve() != release:
            raise RuntimeError("current symlink mismatch")
        env_path, values = update.write_compose_env(expected, image, before_status["version"])
        update.compose(release, env_path, "config", "--quiet")
        # Recheck immediately before changing configuration and stopping the sole authority.
        if update.active_container() != old or not update.is_idle_and_durable(update.local_status(old)):
            raise RuntimeError("world changed or became busy; activation withheld")
        private = Path("/etc/marea-negra/alpha.env")
        text = private.read_text(encoding="utf-8")
        backup = private.with_name("alpha.env.prg01d-before-" + str(time.time_ns()))
        shutil.copyfile(private, backup)
        os.chmod(backup, 0o600)
        for key in required:
            pattern = re.compile(r"^" + re.escape(key) + r"=.*$", re.MULTILINE)
            if len(pattern.findall(text)) > 1:
                raise RuntimeError("duplicate reviewed flag; activation withheld")
            if pattern.search(text):
                text = pattern.sub(key + "=1", text)
            else:
                text = text.rstrip("\n") + "\n" + key + "=1\n"
        temp = private.with_name("alpha.env.prg01d-next")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as target:
            target.write(text)
        os.replace(temp, private)
        print(json.dumps({"stage": "reviewed_flags_saved", "revision": expected,
                          "before": before}), flush=True)
        update.compose(release, env_path, "stop", "-t", "90", update.SERVICE)
        if update.active_container() is not None:
            raise RuntimeError("old authority still running; refusing overlap")
        update.compose(release, env_path, "up", "-d", "--no-build", "--scale",
                       update.SERVICE + "=1", update.SERVICE)
        current = update.active_container()
        if not current or current == old or update.active_revision(current) != expected:
            raise RuntimeError("new authority identity mismatch; inspect without disabling v3 flag")
        if not update.runtime_ready(current, time.monotonic() + 75):
            raise RuntimeError("activation not healthy; inspect without disabling v3 flag")
        after_status, after = update.local_status(current), snapshot(current)
        if after_status["storage"]["workshop"] != {"enabled": True, "ready": True}:
            raise RuntimeError("workshop not ready")
        if after_status["storage"]["artisan"] != {"enabled": True, "ready": True}:
            raise RuntimeError("artisan not ready")
        for field in ("nodes", "palms", "nodesHash", "cooldownsHash", "communityHash", "seedHash"):
            if before[field] != after[field]:
                raise RuntimeError("unexpected durable world change: " + field)
        if after["resourceVersion"] != 3 or before["upgradedLoggingHash"] != after["currentLoggingHash"]:
            raise RuntimeError("timing upgrade did not preserve exact logging ledger")
        if after["tick"] < before["tick"]:
            raise RuntimeError("resource clock regressed")
        print(json.dumps({"stage": "activation_accepted", "revision": expected, "image": image,
                          "imageId": image_id, "before": before, "after": after,
                          "status": after_status, "limits": ["Offline pause not remeasured.",
                          "Authenticated gameplay canary is the next check."]}), flush=True)
