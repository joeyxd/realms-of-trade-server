// Real browser acceptance, loopback fixtures or the existing public authority.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { validateGmPublication } from '../src/editor/publicationValidation.js';
import { projectGmContent, validateGmRoutes } from '../src/editor/contentProjection.js';

const production = process.env.MN_GM_QA_PUBLIC === '1';
const out = resolve(process.env.MN_GM_QA_OUTPUT || 'docs/delivery/gm03b2');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const GM = '77777777-7777-4777-8777-777777777777';
let server, origin = 'https://marea.62.171.136.148.sslip.io';
if (!production) {
  // This storage label exercises the real gate, but is explicitly simulated, not durable-storage proof.
  const store = createMemoryStore(); store.durable = true;
  server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log() {}, store,
    saveSecret: 'gm-activation-fixture', gmAccountIds: [GM], worldSaveMs: 60_000,
    gmContentDirectory: await mkdtemp(join(tmpdir(), 'gm-activation-')),
    gmContentLock: { async run(fn) { return fn({ assertHeld() {} }); } },
    publicAuth: { enabled: true, url: 'http://127.0.0.1:1', publicKey: 'sb_publishable_fixture' },
    resolvePlayer: async (_req, hello) => hello.token === 'gm-fixture' ? GM : null });
  origin = `http://127.0.0.1:${await server.listen()}`;
}
const evidence = { schema: 'gm03b2-browser/v1', production, simulatedAuth: !production,
  simulatedGameplayStorage: !production, version: GAME.version, at: new Date().toISOString(), checks: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const contexts = [];
async function context(gm = false) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); contexts.push(ctx);
  if (!production) {
    if (gm) await ctx.addInitScript((accountId) => {
      const session = { access_token: 'gm-fixture', user: { id: accountId, email: 'qa@example.invalid' } };
      window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session } }),
        onAuthStateChange() {}, signInWithPassword: async () => ({ data: { session } }),
        signUp: async () => ({ data: { session } }), signOut: async () => ({ error: null }) } }) };
    }, GM);
    await ctx.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
      const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
      const file = match && resolve(match[1].startsWith('three') ? 'node_modules/three' : (process.env.MN_GSAP || '.scratch/gsap-local/package'), match[2]);
      if (!file || !fs.existsSync(file)) return route.abort();
      await route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
    });
  }
  return ctx;
}
async function boot(ctx, suffix = '') {
  const page = await ctx.newPage(); page.on('pageerror', () => evidence.errors.push('page_error'));
  page.on('console', (message) => { if (message.type() === 'error') console.error('Browser: ' + message.text().slice(0, 400)); });
  await page.goto(origin + '/?q=' + (production ? 'high' : 'low') + '&tod=day' + suffix, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__mn, null, { timeout: 90000 });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
  return page;
}
async function check(name, fn) { await fn(); evidence.checks.push(name); console.log('PASS ' + name); }
const publicState = async () => (await fetch(origin + '/api/world/content')).json();
let gmPage, baselineDraft, lastDraft, baselineContent, lastContent, local, activation;
const api = async (route, method, input) => gmPage.evaluate(async ({ route, method, input }) => {
  const session = await __mn.gmEntry.auth.sessionIdentity();
  const r = await fetch('/api/gm/' + route, { method, headers: { authorization: 'Bearer ' + session.token,
    ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
  return { status: r.status, body: await r.json() };
}, { route, method, input });
try {
  const status = await (await fetch(origin + '/status')).json();
  assert.equal(status.version, GAME.version); assert.equal(status.players, 0, 'Canary requires empty world');
  baselineContent = await publicState(); lastContent = baselineContent;
  const gmContext = await context(true);
  let suffix = '';
  if (production) {
    const file = process.env.MN_GM_SETUP_FILE;
    const { tokenHash } = JSON.parse(await readFile(file, 'utf8')); await unlink(file);
    assert.match(tokenHash, /^[a-f0-9]{32,128}$/i); suffix = '&account-setup=1#gm_setup_token=' + tokenHash;
  }
  gmPage = await boot(gmContext, suffix);
  await gmPage.waitForFunction(() => __mn.gmEntry.allowed, null, { timeout: 30000 });
  if (production) { await gmPage.waitForSelector('.gm-account-setup-overlay:not([hidden])'); await gmPage.locator('.gm-account-setup-card [data-action="cancel"]').click(); }
  await gmPage.locator('#btn-gm-editor').click();
  await gmPage.waitForFunction(() => __mn.gmEditor?.active && __mn.gmEditor.remotePanel.content);
  local = await gmPage.evaluate(() => __mn.gmEditor.history.current());
  baselineDraft = (await api('draft', 'GET')).body.head; lastDraft = baselineDraft;
  const map = generateWorld(GAME.seed);
  let document;
  const village = map.landmarks.village;
  outer: for (let ring = 15; ring <= 65; ring += 5) for (let a = 0; a < 32; a++) {
    const x = village.x + Math.cos(a * Math.PI / 16) * ring, z = village.z + Math.sin(a * Math.PI / 16) * ring;
    if (Math.abs(x) > 270 || Math.abs(z) > 270 || map.groundAt(x, z) < 1 || map.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 3)) continue;
    const doc = createDocument({ seed: GAME.seed, baseRevision: 'terrain-s21-v1', objects: [createDecoration({ id: 'qa-shared-crate', assetId: 'prop:storage-crate', position: { x, y: map.groundAt(x,z), z }, collider: { type: 'circle', radius: 1 } })] });
    if (validateGmPublication({ map, document: doc, baseRevision: 'terrain-s21-v1' }).valid && validateGmRoutes(map, projectGmContent(map, doc)).valid) { document = doc; break outer; }
  }
  assert.ok(document, 'Need safe visible crate location'); evidence.placement = document.objects[0].transform.position;
  await gmPage.evaluate(async (doc) => { const e = __mn.gmEditor; await e._hydrate(doc); e._clearGhost(); e.transform.detach(); e.selectedId = null; e._commit(doc); await e.saveNow(); }, document);
  await gmPage.locator('[data-action="remote"]').click();
  await gmPage.locator('[data-remote="refresh"]').click();
  await gmPage.waitForFunction(() => __mn.gmEditor.remotePanel.state === 'ready');
  await gmPage.locator('[data-remote="save"]').click(); await gmPage.locator('[data-remote="confirm"]').click();
  await gmPage.waitForFunction(() => __mn.gmEditor.remotePanel.state === 'ready');
  lastDraft = await gmPage.evaluate(() => __mn.gmEditor.remotePanel.head);
  await check('saved_draft_prepared_and_registered_by_exact_hash', async () => {
    await gmPage.locator('[data-remote="prepare"]').click();
    await gmPage.waitForSelector('.gm-publication-report[data-valid="true"]');
    await gmPage.locator('[data-remote="content-register"]').click();
    await gmPage.waitForFunction(() => !__mn.gmEditor.remotePanel.busy && __mn.gmEditor.remotePanel.content.revisions.some((r) => r.revisionId === __mn.gmEditor.remotePanel.prepared.revision.revisionId));
    evidence.revisionId = await gmPage.evaluate(() => __mn.gmEditor.remotePanel.prepared.revision.revisionId);
    assert.equal((await publicState()).revisionId, baselineContent.revisionId);
  });
  await check('activation_review_es_en_and_empty_world_switch', async () => {
    await gmPage.locator('[data-content-revision]').selectOption(evidence.revisionId);
    await gmPage.locator('[data-remote="content-activate"]').click();
    await gmPage.locator('[data-remote="content-confirm"]').scrollIntoViewIfNeeded();
    await gmPage.screenshot({ path: resolve(out, (production ? 'public' : 'local') + '-activation-es.png') });
    await gmPage.locator('[data-remote="language"]').click();
    await gmPage.locator('[data-remote="content-confirm"]').scrollIntoViewIfNeeded();
    await gmPage.screenshot({ path: resolve(out, (production ? 'public' : 'local') + '-activation-en.png') });
    await gmPage.locator('[data-remote="language"]').click();
    await gmPage.locator('[data-remote="content-confirm"]').click();
    await gmPage.waitForFunction(() => !!__mn.gmEditor.remotePanel.contentApplied, null, { timeout: 30000 });
    lastContent = await publicState(); assert.equal(lastContent.revisionId, evidence.revisionId);
    assert.equal(lastContent.generation, baselineContent.generation + 1);
    assert.equal(await gmPage.evaluate(() => __mn.gmEditor.active && __mn.st.contentStale), true);
    activation = await gmPage.evaluate(() => __mn.gmEditor.remotePanel.contentApplied);
    assert.deepEqual((await api('draft', 'GET')).body.head, lastDraft);
    if (production && process.env.MN_GM_QA_CHECK_IMAGE === '1') {
      const checked = spawnSync('ssh', ['-o', 'BatchMode=yes', 'root@62.171.136.148',
        "flock -n /opt/marea-negra/content/switch.lock docker run --rm --network none --cpus 1 --memory 1g --volume /opt/marea-negra/content:/var/lib/marea-content:ro --env MN_GM_CONTENT_DIR=/var/lib/marea-content $(docker inspect -f '{{.Image}}' marea-negra-alpha-marea-negra-alpha-1) node server/gmContentCheck.mjs"],
        { encoding: 'utf8', timeout: 120000 });
      assert.equal(checked.status, 0, checked.stderr); assert.match(checked.stdout, /content compatible/);
      evidence.offlineActiveImageCheck = checked.stdout.trim();
    }
  });
  const readers = [];
  await check('two_real_clients_load_same_visible_document_and_collision_then_join', async () => {
    for (let i = 0; i < 2; i++) {
      const ctx = await context(), page = await boot(ctx); readers.push({ ctx, page });
      const identity = await page.evaluate(() => __mn.map.gmContentIdentity);
      assert.deepEqual(identity, { generation: lastContent.generation, revisionId: evidence.revisionId });
      assert.equal(await page.evaluate(() => !!__mn.world.scene.getObjectByName('gm:qa-shared-crate')), true);
      const collisionHash = await page.evaluate(async () => (await import('/src/editor/activeContent.js')).gmContentHash(__mn.map.colliders));
      assert.equal(collisionHash, lastContent.revision.content.collision.sha256);
      assert.deepEqual(await page.evaluate(async (p) => {
        const { canStand } = await import('/src/sim/systems/movement.js');
        return [canStand(__mn.client.pred, p.x, p.z), canStand(__mn.client.pred, p.x+2.8, p.z)];
      }, evidence.placement), [false, true]);
      await page.locator('#btn-play').click({ force: true }); await page.waitForFunction(() => __mn.client.joined, null, { timeout: 30000 });
      if (!i) {
        await page.evaluate((p) => { __mn.loop.running = false; __mn.world.camera.position.set(p.x+6,p.y+5,p.z+6); __mn.world.camera.lookAt(p.x,p.y+.6,p.z); __mn.world.camera.updateMatrixWorld(); for(let n=0;n<3;n++) __mn.world.render(); }, evidence.placement);
        await page.screenshot({ path: resolve(out, (production ? 'public' : 'local') + '-shared-crate.png') });
        await page.evaluate(() => { __mn.loop.start(); });
      }
      assert.deepEqual(await page.evaluate(() => [...__mn.errors]), []);
    }
    assert.equal((await (await fetch(origin + '/status')).json()).players, 2);
  });
  await check('activation_rejected_while_players_are_present', async () => {
    const r = await api('activate', 'POST', { operationId: randomUUID(), expectedGeneration: lastContent.generation, revisionId: baselineContent.revisionId });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'gm_content_busy');
    assert.equal((await publicState()).revisionId, evidence.revisionId);
  });
  for (const r of readers) await r.ctx.close();
  for (let i=0;i<100;i++) { const s=await (await fetch(origin+'/status')).json(); if (!s.players && !s.storage.profileWrites && !s.storage.worldWriting) break; await new Promise((r)=>setTimeout(r,100)); }
  await check('rollback_restores_previous_content_without_replacing_private_draft', async () => {
    await gmPage.locator('[data-content-revision]').selectOption(baselineContent.revisionId || '');
    await gmPage.locator('[data-remote="content-activate"]').click(); await gmPage.locator('[data-remote="content-confirm"]').click();
    await gmPage.waitForFunction((generation) => __mn.gmEditor.remotePanel.content?.active.generation === generation, lastContent.generation+1);
    lastContent = await publicState(); assert.equal(lastContent.revisionId, baselineContent.revisionId);
    assert.deepEqual((await api('draft', 'GET')).body.head, lastDraft);
    const ctx = await context(), page = await boot(ctx);
    assert.deepEqual(await page.evaluate(() => __mn.map.gmContentIdentity), { generation: lastContent.generation, revisionId: baselineContent.revisionId });
    assert.equal(await page.evaluate(() => !!__mn.world.scene.getObjectByName('gm:qa-shared-crate')), false);
    await page.locator('#btn-play').click({ force: true }); await page.waitForFunction(() => __mn.client.joined);
    await ctx.close();
  });
  await check('old_generation_cannot_replace_rollback', async () => {
    const r = await api('activate', 'POST', { operationId: randomUUID(), expectedGeneration: baselineContent.generation, revisionId: evidence.revisionId });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'gm_content_conflict');
    assert.equal((await publicState()).generation, lastContent.generation);
  });
  evidence.activation = { generation: activation.generation, revisionId: activation.revisionId };
  evidence.finalContent = { generation: lastContent.generation, revisionId: lastContent.revisionId };
} catch (error) {
  console.error(error.message);
  if (gmPage) {
    evidence.failure = await gmPage.evaluate(() => ({ error: __mn.gmEditor?.remotePanel.contentError,
      busy: __mn.gmEditor?.remotePanel.busy, active: __mn.gmEditor?.active, mode: __mn.st.mode }));
    console.error('QA state ' + JSON.stringify(evidence.failure));
    await gmPage.screenshot({ path: resolve(out, 'failure.png') });
  }
  throw error;
} finally {
  try {
    for (const ctx of contexts.slice(1)) await ctx.close().catch(() => {});
    if (gmPage && baselineContent) {
      const current = await publicState();
      if (current.revisionId === evidence.revisionId && current.generation === baselineContent.generation+1) {
        const r = await api('activate', 'POST', { operationId: randomUUID(), expectedGeneration: current.generation, revisionId: baselineContent.revisionId });
        evidence.emergencyRollback = r.status;
      }
      if (baselineDraft && lastDraft && lastDraft.revision !== baselineDraft.revision && baselineDraft.document) {
        const observed = (await api('draft','GET')).body.head;
        assert.equal(observed.revision,lastDraft.revision,'Concurrent draft wins');
        const r = await api('draft','PUT',{operationId:randomUUID(),expectedRevision:lastDraft.revision,document:baselineDraft.document});
        evidence.draftRestore = { status:r.status, from:baselineDraft.revision, to:r.body.head?.revision };
        assert.equal(r.status,200);
      }
      if (local) await gmPage.evaluate(async (doc) => { const e=__mn.gmEditor; await e._hydrate(doc); e._commit(doc); await e.saveNow(); },local);
    }
  } catch (error) { evidence.errors.push('restore_failed'); console.error(error.message); }
  await browser.close(); await server?.close();
  await writeFile(resolve(out, production ? 'public-evidence.json' : 'local-browser-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
}
assert.deepEqual(evidence.errors,[]);
console.log(`${evidence.checks.length} activation browser checks passed`);
