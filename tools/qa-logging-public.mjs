// Read-only public release checks. No account credentials, gameplay commands, or SQL writes.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import WebSocket from 'ws';
import { GAME } from '../src/data/meta.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const origin = 'https://marea.62.171.136.148.sslip.io', checks = [];
const loggingEnabled = process.argv.includes('--logging-enabled');
assert.ok(process.argv.slice(2).every(arg => arg === '--logging-enabled'), 'unknown public QA option');
const record = (check, extra = {}) => checks.push({ check, pass: true, ...extra });
const get = path => fetch(origin + path, { cache: 'no-store', signal: AbortSignal.timeout(15000) });

try {
  const health = await get('/health');
  assert.equal(health.status, 200); assert.equal(await health.text(), 'ok'); record('health');
  const status = await (await get('/status')).json();
  assert.equal(status.version, GAME.version); assert.equal(status.errors, 0);
  assert.equal(status.storage.kind, 'supabase'); assert.equal(status.storage.durable, true);
  assert.equal(status.storage.accounts, true); assert.equal(status.storage.errors, 0);
  assert.equal(status.storage.economic.failed, false); assert.equal(status.storage.tickBlocked, false);
  assert.equal(status.storage.resources.ready, true); assert.equal(status.storage.resources.logging, loggingEnabled);
  record(loggingEnabled ? 'compatible_runtime_logging_on' : 'compatible_runtime_logging_off', { version: status.version });
  assert.ok((await (await get('/src/net/protocol.js')).text()).includes(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`));
  record('protocol', { version: PROTOCOL_VERSION });
  assert.ok((await (await get('/src/ui/loggingSkill.js')).text()).includes('loggingSkillHtml'));
  record('logging_card_module');
  assert.equal((await get('/server/migrations/016_logging_operations.sql')).status, 404);
  record('server_files_not_public');

  const socket = new WebSocket(origin.replace('https:', 'wss:') + '/ws', { origin, handshakeTimeout: 12000 });
  const messages = [];
  socket.on('message', raw => messages.push(JSON.parse(raw)));
  socket.on('error', () => {});
  const closed = once(socket, 'close');
  try {
    await once(socket, 'open');
    socket.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Logging release QA', skin: 0, weapon: 0 }));
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline && ![MSG.WELCOME, MSG.PROFILE, MSG.SNAPSHOT].every(t => messages.some(m => m.t === t))) {
      assert.equal(messages.some(m => m.t === MSG.ERROR || m.t === MSG.FULL), false);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok([MSG.WELCOME, MSG.PROFILE, MSG.SNAPSHOT].every(t => messages.some(m => m.t === t)));
    record('guest_public_entry_profile_snapshot');
  } finally {
    if (socket.readyState < 2) socket.close();
    const timer = setTimeout(() => socket.terminate(), 1500);
    await closed; clearTimeout(timer);
  }
  const report = { schema: 'mn.logging.public.v1', at: new Date().toISOString(), pass: true, checks,
    limits: [...(loggingEnabled ? [] : ['Logging remains disabled pending SQL016 and authenticated acceptance.']),
      'Guest entry does not verify a durable logging award.'] };
  await writeFile(new URL(`../docs/delivery/prg01b2-logging/${loggingEnabled ? 'public-active-smoke' : 'public-smoke'}.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(JSON.stringify({ pass: false, checks, why: error.code ?? 'public check failed' }));
  process.exitCode = 1;
}
