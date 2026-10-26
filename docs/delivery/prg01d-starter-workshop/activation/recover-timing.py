"""Guarded same-image recovery from the exact disposable PRG01d timing failure.

Restore the confirmed baseline so the ordinary guarded updater can deploy the
reviewed fix. No gameplay QA is run against this old image. No migration,
feature-flag change, direct DB write, or updater modification is performed.
"""

# Root opens this gate only after reviewing the local SQL-backed regression.
ROOT_REVIEWED = True

# SQL024 rejects a timed gather whose live economy differs from its saved baseline.
FAILURE_CAUSE = (
    "SQL024 timed-gather non-resource world comparison rejects advanced live economy; "
    "the missing pre-operation checkpoint fences M5 with no QA economic receipt."
)
READINESS_RPCS = (
    ("mn_starter_workshop_ready", 1),             # SQL024
    ("mn_workshop_raft_identifiers_ready", 1),     # SQL026
    ("mn_companion_control_ready", 1),             # SQL027
)
EXPECTED_PROFILE_VERSION = 3
EXPECTED_PROFILE_SHA256 = "af95c5025025974408b80af27a8dd9ebd276a1bd683f78be18aefed8c0bbcc5e"
EXPECTED_WORLD_VERSION = 1936
EXPECTED_WORLD_SHA256 = "fce2f81a12a023d05e44a91087b2a8cb9e0ccf3a11c778c7d5efc3f3912d4035"

if ROOT_REVIEWED is not True:
    raise SystemExit("Draft only: root review gate is closed; no VPS or DB action was taken")
if (not isinstance(FAILURE_CAUSE, str) or not FAILURE_CAUSE.strip() or not READINESS_RPCS or
        EXPECTED_PROFILE_VERSION != 3 or not EXPECTED_PROFILE_SHA256 or
        EXPECTED_WORLD_VERSION != 1936 or not EXPECTED_WORLD_SHA256):
    raise SystemExit("Reviewed durable baseline is incomplete")

import fcntl
import importlib.util
import json
from pathlib import Path
import time


spec = importlib.util.spec_from_file_location("marea_update", "/opt/marea-negra/ops/vps-update.py")
update = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update)

OLD_REVISION = "8ce31ce442e8e6bffd430b80690f8441f44314fd"
OLD_VERSION = "0.6.0-alpha.37"
OLD_IMAGE_ID = "sha256:c7b719fc0b38cef85a7c78021c5655c50374c4c3aac37e192bc2fe42da4d26f7"
OLD_CONTAINER_ID = "af449b9cc2a50b3049709979c23f9ec14f550456b86d09e399c0958b7dd84faf"
MARKER = "mnQaWorkshopPublic:7a949137-a098-4b6d-887d-a8600c11b303"
WORLD = "marea-negra"

READINESS_RPCS = tuple(READINESS_RPCS)

probe = r"""
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from './server/store.mjs';
const marker = __MARKER__;
const readinessRpcs = __READINESS_RPCS__;
const expected = __EXPECTED__;
const preflight = __PREFLIGHT__;
const PAGE_SIZE = 500;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

// Read the complete Auth listing. Never infer identity from the first page.
const users = [];
for (let page = 1; page <= 10000; page++) {
  const reply = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  assert.equal(reply.error, null, 'complete Auth listing unavailable');
  const rows = reply.data?.users;
  assert.ok(Array.isArray(rows) && rows.length <= 1000, 'malformed Auth page');
  users.push(...rows);
  if (rows.length < 1000) break;
  assert.ok(page < 10000, 'Auth pagination bound exceeded');
}
assert.equal(new Set(users.map(user => user.id)).size, users.length, 'duplicate Auth identity across pages');
const matches = users.filter(user => user.user_metadata?.mn_qa_marker === marker);
assert.equal(matches.length, 1, 'exact disposable QA identity missing or ambiguous');
const account = matches[0].id;
const store = storeFromEnv();
const profileRow = await store.loadProfile(account);
const worldRow = await store.loadWorld('marea-negra');
assert.equal(profileRow?.data?.pirateId, `account:${account}`, 'QA profile pirateId does not match exact Auth owner');
assert.equal(profileRow.version, expected.profileVersion, 'QA profile version differs from reviewed baseline');
assert.ok(worldRow?.version >= expected.worldVersion, 'world version regressed');
const profileHash = hash(profileRow.data), worldHash = hash(worldRow.data);
assert.equal(profileHash, expected.profileSha256, 'QA profile differs from reviewed durable baseline');
if (preflight) {
  assert.equal(worldRow.version, expected.worldVersion, 'world version differs from reviewed diagnostic fixture');
  assert.equal(worldHash, expected.worldSha256, 'world differs from reviewed durable baseline');
}
assert.equal(worldRow.data?.resources?.v, 3, 'world resource checkpoint is not v3');

const readiness = [];
for (const [name, version] of readinessRpcs) {
  const reply = await admin.rpc(name);
  assert.equal(reply.error, null, `required readiness RPC unavailable: ${name}`);
  assert.deepEqual(reply.data, { version }, `readiness mismatch: ${name}`);
  readiness.push({ rpc: name, version });
}
// Inventory receipts for this exact QA Auth owner through every page. Never
// assume the first page is complete and never emit operation IDs or account IDs.
let qaReceiptCount = 0;
for (let offset = 0; ; offset += PAGE_SIZE) {
  const reply = await admin.from('mn_economic_operations').select('operation_id,request')
    .eq('request->>account', account).order('operation_id', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);
  assert.equal(reply.error, null, 'paginated exact-owner receipt inventory unavailable');
  assert.ok(Array.isArray(reply.data) && reply.data.length <= PAGE_SIZE, 'malformed receipt inventory page');
  for (const row of reply.data) {
    assert.equal(row?.request?.account, account, 'receipt owner filter returned a different account');
    qaReceiptCount++;
  }
  if (reply.data.length < PAGE_SIZE) break;
  assert.ok(offset < 5_000_000, 'receipt inventory pagination bound exceeded');
}
assert.equal(qaReceiptCount, 0, 'exact QA owner has an economic receipt; refusing to treat it as the failed operation');
const resources = worldRow.data.resources;
const economy = worldRow.data.economy;
assert.ok(economy && typeof economy === 'object', 'world economy missing');
const worldCore = structuredClone(worldRow.data);
delete worldCore.resources.tick;
for (const key of ['acc', 'hours', 'rng', 'markets']) delete worldCore.economy[key];
console.log(JSON.stringify({ pirateIdMatched: true, profileVersion: profileRow.version,
  profileSha256: profileHash, worldVersion: worldRow.version, worldSha256: worldHash,
  worldCoreSha256: hash(worldCore), economyPlotsSha256: hash(economy.plots),
  nodesSha256: hash(resources.nodes), cooldownsSha256: hash(resources.cooldowns),
  loggingLedgerSha256: hash(resources.logging || {}), communitySha256: hash(worldRow.data.community),
  seedSha256: hash(worldRow.data.seed), qaReceiptCount,
  resourceVersion: resources.v, tick: resources.tick, readiness }));
""".replace("__MARKER__", json.dumps(MARKER)).replace(
    "__READINESS_RPCS__", json.dumps(READINESS_RPCS)
).replace("__EXPECTED__", json.dumps({
    "profileVersion": EXPECTED_PROFILE_VERSION,
    "profileSha256": EXPECTED_PROFILE_SHA256,
    "worldVersion": EXPECTED_WORLD_VERSION,
    "worldSha256": EXPECTED_WORLD_SHA256,
}))


def snapshot(container, preflight=True):
    try:
        result = update.run(["docker", "exec", "-i", container, "node", "--input-type=module"],
                            input_text=probe.replace("__PREFLIGHT__", "true" if preflight else "false"), timeout=60)
        return json.loads(result.stdout)
    except Exception:
        # Do not expose service credentials, account metadata, or RPC details.
        raise RuntimeError("read-only timing recovery probe failed; authority was not changed by the probe") from None


def inspect(container):
    result = update.run(["docker", "inspect", "--format", "{{json .State}}|{{.Image}}|{{.Id}}", container], timeout=15)
    state_text, image_id, container_id = result.stdout.strip().split("|", 2)
    return json.loads(state_text), image_id, container_id


def safe_status(status):
    storage = status.get("storage", {})
    world, economic = storage.get("world", {}) or {}, storage.get("economic", {}) or {}
    return {"version": status.get("version"), "players": status.get("players"), "sockets": status.get("sockets"),
            "errors": status.get("errors"), "unsaved": storage.get("unsaved"),
            "profileWrites": storage.get("profileWrites"), "worldWriting": storage.get("worldWriting"),
            "tickBlocked": storage.get("tickBlocked"), "worldReady": world.get("ready"),
            "worldFailed": world.get("failed"), "economicFailed": economic.get("failed"),
            "economicPending": economic.get("pending"), "resourcesReady": (storage.get("resources") or {}).get("ready"),
            "workshop": storage.get("workshop"), "artisan": storage.get("artisan")}


def require_failure_precondition(status):
    storage = status.get("storage", {})
    world, economic = storage.get("world", {}) or {}, storage.get("economic", {}) or {}
    if not (status.get("version") == OLD_VERSION and status.get("players") == 0 and status.get("sockets") == 0
            and storage.get("unsaved") == 1 and storage.get("profileWrites") == 0
            and storage.get("worldWriting") is False and storage.get("tickBlocked") is True
            and world.get("failed") is True and economic.get("failed") is True
            and economic.get("pending") == 1):
        raise RuntimeError("live timing failure differs from reviewed 0-player/0-socket, failed=1, pending=1, unsaved=1 precondition")


with update.LOCK.open("a+") as lock:
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    with update.content_exclusive_lock():
        old = update.active_container()
        if old is None or update.active_revision(old) != OLD_REVISION:
            raise RuntimeError("active release changed; timing recovery withheld")
        state, image_id, container_id = inspect(old)
        if not state.get("Running") or image_id != OLD_IMAGE_ID or container_id != OLD_CONTAINER_ID:
            raise RuntimeError("active container or image digest differs from reviewed alpha.37 deployment")
        release = update.RELEASES / OLD_REVISION
        if Path("/opt/marea-negra/current").resolve() != release:
            raise RuntimeError("current release symlink mismatch")

        # The public proxy currently returns 503 HTML. Use only the updater's
        # local Docker status probe; never treat the public route as JSON here.
        before_status = update.local_status(old)
        require_failure_precondition(before_status)
        before = snapshot(old)
        print(json.dumps({"stage": "preflight", "revision": OLD_REVISION, "version": OLD_VERSION,
                          "cause": FAILURE_CAUSE,
                          "status": safe_status(before_status), "evidence": before}), flush=True)

        # Stop the only authority, then restore its exact confirmed state from M5.
        update.run(["docker", "stop", "--time", "90", old], timeout=105)
        stopped, stopped_image, stopped_id = inspect(old)
        if (stopped.get("Running") or stopped_image != OLD_IMAGE_ID or stopped_id != OLD_CONTAINER_ID
                or update.active_container() is not None):
            raise RuntimeError("old authority did not stop cleanly; refusing to start any container")
        update.run(["docker", "start", old], timeout=20)
        current = update.active_container()
        if current != old or update.active_revision(current) != OLD_REVISION:
            raise RuntimeError("same-container authority identity changed")
        state, image_id, container_id = inspect(current)
        if not state.get("Running") or image_id != OLD_IMAGE_ID or container_id != OLD_CONTAINER_ID:
            raise RuntimeError("same-container image identity mismatch")
        if not update.runtime_ready(current, time.monotonic() + 90):
            raise RuntimeError("same-container recovery did not become healthy")

        after_status = update.local_status(current)
        storage = after_status.get("storage", {})
        world, economic = storage.get("world", {}) or {}, storage.get("economic", {}) or {}
        if not (after_status.get("version") == OLD_VERSION and after_status.get("players") == 0
                and after_status.get("sockets") == 0 and after_status.get("errors") == 0
                and storage.get("errors") == 0 and storage.get("unsaved") == 0
                and storage.get("profileWrites") == 0 and storage.get("worldWriting") is False
                and storage.get("tickBlocked") is False and world.get("failed") is False
                and world.get("ready") is True and economic.get("failed") is False
                and economic.get("pending") == 0):
            raise RuntimeError("post-restart local authority health does not satisfy reviewed recovery conditions")
        after = snapshot(current, preflight=False)
        for field in ("profileVersion", "profileSha256", "readiness", "qaReceiptCount",
                      "nodesSha256", "cooldownsSha256", "loggingLedgerSha256",
                      "communitySha256", "seedSha256", "economyPlotsSha256"):
            if before[field] != after[field]:
                raise RuntimeError("profile/world/readiness/failed-operation preservation check failed: " + field)
        if (after["worldVersion"] < before["worldVersion"] or after["tick"] < before["tick"]
                or after["resourceVersion"] != 3):
            raise RuntimeError("world/resource clock regressed or resource version changed")
        if before["worldCoreSha256"] != after["worldCoreSha256"]:
            raise RuntimeError("world changed beyond the allowed resources.tick/economy clock-market fields")
        print(json.dumps({"stage": "recovery_accepted", "revision": OLD_REVISION,
                          "version": OLD_VERSION, "imageId": OLD_IMAGE_ID,
                          "status": safe_status(after_status), "evidence": after}), flush=True)
