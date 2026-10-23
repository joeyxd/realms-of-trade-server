"""Guarded restart for the exact public workshop canary's failed M5 receipt.

Run by root over SSH stdin only after SQL026 is applied. It never changes the
image, release, compose configuration, or account state, and performs no direct
database rewrites. The restarted host may save normal world-clock checkpoints.
"""
import fcntl
import importlib.util
import json
from pathlib import Path
import time

spec = importlib.util.spec_from_file_location("marea_update", "/opt/marea-negra/ops/vps-update.py")
update = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update)

REVISION = "f939152e24b51774faab3239a902c6cc76e01d3f"
VERSION = "0.6.0-alpha.36"
IMAGE_ID = "sha256:2805560bd974edca1e1e31b888a25933f6d56a5673724dd2729141bc84703326"
CONTAINER_ID = "ed66bfbf317a4e4b29250cfae4c2c081b913412bd30557e8ed6e193191bac89b"
MARKER = "mnQaWorkshopPublic:c59f3d35-41eb-4532-945e-f58e436b2b66"
WORLD = "marea-negra"
FIRST_OP = "workshop-first-storage-credit"

probe = r"""
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from './server/store.mjs';
import { storageProfileDelta } from './src/sim/systems/raftEditor.js';
import { economicOperationId } from './server/economicAuthority.mjs';
const marker = __MARKER__;
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const hash = x => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const readiness = await admin.rpc('mn_workshop_raft_identifiers_ready');
assert.equal(readiness.error, null); assert.equal(readiness.data?.version, 1);
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
assert.equal(listed.error, null);
const matches = listed.data.users.filter(user => user.user_metadata?.mn_qa_marker === marker);
assert.equal(matches.length, 1, 'exact disposable QA identity missing or ambiguous');
const account = matches[0].id, store = storeFromEnv();
const profileRow = await store.loadProfile(account), worldRow = await store.loadWorld('marea-negra');
assert.equal(profileRow?.data?.pirateId, `account:${account}`, 'QA profile ownership sentinel mismatch');
assert.equal(profileRow.data.workshop?.v, 1); assert.equal(profileRow.data.workshop.storageCredit, true);
assert.equal(profileRow.data.workshop.crateKits, 1);
const ship = profileRow.data.eco?.ships?.find(s => s.kind === 'raft' && s.id === profileRow.data.eco.ships.find(x => x.kind === 'raft')?.id);
assert.ok(ship && ship.id && ship.at === 'aldea');
const operationId = economicOperationId('marea-negra', account, 'workshop-first-storage-credit');
const existing = await store.loadEconomicOperation(operationId);
assert.equal(existing, null, 'failed operation unexpectedly has a receipt');
const command = { type: 'raft', op: 'place', opId: 'workshop-first-storage-credit', id: ship.id,
  expectedRev: ship.rev, piece: ['storage', 0, 1, 0, 0], rules: 2 };
const delta = storageProfileDelta(profileRow.data, command);
assert.ok(delta.profile && delta.why === '', 'storage-credit candidate could not be reconstructed');
const request = { world: 'marea-negra', account, command, expectedProfileVersion: profileRow.version,
  expectedWorldVersion: worldRow.version, before: profileRow.data, profile: delta.profile,
  worldData: worldRow.data, ack: { type: 'raftEdit', id: ship.id, op: command.op, opId: command.opId,
    ok: true, why: '', rev: ship.rev + 1 } };
const valid = await admin.rpc('mn_valid_economic_request', { p_operation_id: operationId, p_request: request });
assert.equal(valid.error, null); assert.equal(valid.data, true, 'successful storage-credit request rejected');
const denialOp = 'workshop-recovery-unchanged-denial';
const denialId = economicOperationId('marea-negra', account, denialOp);
assert.equal(await store.loadEconomicOperation(denialId), null, 'denial control operation already exists');
const denial = structuredClone(request);
denial.command = { type: 'raft', op: 'place', opId: denialOp, id: ship.id, expectedRev: ship.rev,
  piece: ['storage', 0, 1, 0, 0], rules: 2 };
denial.profile = profileRow.data;
denial.ack = { type: 'raftEdit', id: ship.id, op: 'place', opId: denialOp, ok: false,
  why: 'occupied', rev: ship.rev,
  record: { id: ship.id, rev: ship.rev, parts: ship.grid.parts } };
const deniedValid = await admin.rpc('mn_valid_economic_request', { p_operation_id: denialId, p_request: denial });
assert.equal(deniedValid.error, null); assert.equal(deniedValid.data, true,
  'unchanged gameplay denial receipt rejected by final identifier validator');
assert.equal(JSON.stringify(denial.profile), JSON.stringify(denial.before), 'denial candidate mutates profile');
const resources = worldRow.data.resources;
assert.ok(resources && Array.isArray(resources.nodes));
console.log(JSON.stringify({ readinessVersion: 1, profileVersion: profileRow.version, worldVersion: worldRow.version,
  resourceVersion: resources.v, tick: resources.tick, nodeCount: resources.nodes.length,
  nodesHash: hash(resources.nodes), cooldownsHash: hash(resources.cooldowns), loggingLedgerHash: hash(resources.logging || {}),
  communityHash: hash(worldRow.data.community), seedHash: hash(worldRow.data.seed),
  successfulCandidateValid: true, unchangedDenialValid: true, failedReceiptAbsent: true,
  storageCreditPreserved: true, crateKitPreserved: true }));
""".replace("__MARKER__", json.dumps(MARKER))


def snapshot(container):
    try:
        result = update.run(["docker", "exec", "-i", container, "node", "--input-type=module"],
                            input_text=probe, timeout=50)
        return json.loads(result.stdout)
    except Exception:
        # A failed Node assertion or RPC can include private account details.
        raise RuntimeError("read-only recovery probe failed; authority untouched by this probe") from None


def inspect(container):
    result = update.run(["docker", "inspect", "--format", "{{json .State}}|{{.Image}}|{{.Id}}", container], timeout=15)
    state_text, image_id, container_id = result.stdout.strip().split("|", 2)
    return json.loads(state_text), image_id, container_id


def safe_status(status):
    storage = status.get("storage", {})
    world = storage.get("world", {}) or {}
    economic = storage.get("economic", {}) or {}
    return {"version": status.get("version"), "players": status.get("players"), "sockets": status.get("sockets"),
            "errors": storage.get("errors"), "unsaved": storage.get("unsaved"),
            "profileWrites": storage.get("profileWrites"), "worldWriting": storage.get("worldWriting"),
            "worldReady": world.get("ready"), "worldFailed": world.get("failed"),
            "economicFailed": economic.get("failed"), "economicPending": economic.get("pending"),
            "workshop": storage.get("workshop"), "artisan": storage.get("artisan"),
            "resources": storage.get("resources")}


def require_preflight(status):
    storage = status.get("storage", {})
    world, economic = storage.get("world", {}) or {}, storage.get("economic", {}) or {}
    if not (status.get("players") == 0 and status.get("sockets") == 0
            and storage.get("profileWrites") == 0 and storage.get("unsaved") == 1
            and world.get("failed") is True and economic.get("failed") is True
            and economic.get("pending") == 1 and storage.get("worldWriting") is False):
        raise RuntimeError("live failure state differs from the reviewed QA-only recovery precondition")


with update.LOCK.open("a+") as lock:
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    with update.content_exclusive_lock():
        old = update.active_container()
        if old is None or update.active_revision(old) != REVISION:
            raise RuntimeError("active release changed; recovery withheld")
        state, image_id, container_id = inspect(old)
        if not state.get("Running") or image_id != IMAGE_ID or container_id != CONTAINER_ID:
            raise RuntimeError("active container or image digest differs from reviewed deployment")
        release = update.RELEASES / REVISION
        if Path("/opt/marea-negra/current").resolve() != release:
            raise RuntimeError("current release symlink mismatch")
        before_status = update.local_status(old)
        if before_status.get("version") != VERSION:
            raise RuntimeError("active game version differs from reviewed deployment")
        require_preflight(before_status)
        before = snapshot(old)
        if before["resourceVersion"] != 3 or not before["failedReceiptAbsent"]:
            raise RuntimeError("QA receipt or resource state differs from reviewed recovery precondition")
        print(json.dumps({"stage": "preflight", "revision": REVISION, "version": VERSION, "imageId": IMAGE_ID,
                          "status": safe_status(before_status), "evidence": before}), flush=True)

        update.run(["docker", "stop", "--time", "90", old], timeout=105)
        stopped, stopped_image, stopped_id = inspect(old)
        if stopped.get("Running") or stopped_image != IMAGE_ID or stopped_id != CONTAINER_ID or update.active_container() is not None:
            raise RuntimeError("old authority did not stop cleanly; refusing to start any container")
        update.run(["docker", "start", old], timeout=20)
        if update.active_container() != old or update.active_revision(old) != REVISION:
            raise RuntimeError("same-container identity changed during recovery")
        state, image_id, container_id = inspect(old)
        if not state.get("Running") or image_id != IMAGE_ID or container_id != CONTAINER_ID:
            raise RuntimeError("restarted container image identity mismatch")
        if not update.runtime_ready(old, time.monotonic() + 75):
            raise RuntimeError("same-container restart did not become healthy")

        after_status = update.local_status(old)
        if after_status.get("version") != VERSION:
            raise RuntimeError("restarted game version differs from reviewed deployment")
        storage = after_status.get("storage", {})
        economic, world = storage.get("economic", {}) or {}, storage.get("world", {}) or {}
        if not (after_status.get("players") == 0 and after_status.get("sockets") == 0
                and after_status.get("errors") == 0 and storage.get("errors") == 0
                and storage.get("unsaved") == 0 and storage.get("profileWrites") == 0
                and storage.get("worldWriting") is False and world.get("failed") is False
                and world.get("ready") is True and economic.get("failed") is False
                and economic.get("pending") == 0
                and storage.get("workshop") == {"enabled": True, "ready": True}
                and storage.get("artisan") == {"enabled": True, "ready": True}
                and storage.get("resources", {}).get("ready") is True):
            raise RuntimeError("post-restart public authority health/readiness mismatch")
        after = snapshot(old)
        for field in ("failedReceiptAbsent", "storageCreditPreserved", "crateKitPreserved", "nodeCount",
                      "nodesHash", "cooldownsHash", "loggingLedgerHash", "communityHash", "seedHash"):
            if before[field] != after[field]:
                raise RuntimeError("durable QA/world preservation check failed: " + field)
        if after["resourceVersion"] != 3 or after["tick"] < before["tick"]:
            raise RuntimeError("resource version changed or clock regressed")
        print(json.dumps({"stage": "recovery_accepted", "revision": REVISION, "version": VERSION, "imageId": IMAGE_ID,
                          "status": safe_status(after_status), "evidence": after}), flush=True)
