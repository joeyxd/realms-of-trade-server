// Isolated D05 UI acceptance: real DOM input and local Worker authority, software GPU only.
// env: PHONE=1, PORTRAIT=1, OUT, MN_PLAYWRIGHT, MN_BROWSER, MN_THREE, MN_GSAP.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.MN_PLAYWRIGHT ? pathToFileURL(process.env.MN_PLAYWRIGHT).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phone = process.env.PHONE === '1', portrait = process.env.PORTRAIT === '1';
const width = portrait ? 390 : phone ? 844 : 1280, height = portrait ? 844 : phone ? 390 : 720;
const out = path.resolve(process.env.OUT || path.join(root, 'shots/review/d05', portrait ? 'portrait' : phone ? 'mobile' : 'desktop'));
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.resolve(root, `.${name === '/' ? '/index.html' : name}`);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
const hash = (file) => { const b = fs.readFileSync(file); return { bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }; };
const evidence = { purpose: 'D05 editor real UI/Worker software acceptance', base: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  viewport: { width, height, phone, portrait, dpr: 1 }, fixture: 'Unmodified six-piece starter; gold 1200 in isolated solo save. No free materials/pieces.',
  renderScheduling: 'Normal input/frame/Worker ticks remain active; GPU draws only at screenshots. Fixed camera composition.',
  physicalDevice: false, fpsClaim: false, actions: [], screenshots: [], textureRequests: [], pageErrors: [], consoleErrors: [], requestFailures: [] };
let browser, page;
const ensure = (v, message) => { if (!v) throw new Error(message); };
async function state() {
  return page.evaluate(() => {
    const m = window.__mn, b = m.panels.raftEditor, r = m.client.pred.rafts.find((a) => a.owner === m.client.youServer), s = m.client.profile.eco.ships.find((a) => a.id === r.id);
    return { rev: r.rev, shipRev: s.rev, parts: r.parts, pose: { x: r.x, y: r.y, z: r.z, yaw: r.yaw },
      gold: m.client.profile.gold, hold: s.hold, pack: m.client.profile.eco.pack, active: b.active,
      pending: b.pending && { id: b.pending.id, ack: b.pending.ack, rev: b.pending.resultRev }, target: b.target, dir: b.dir,
      status: b.root.querySelector('.re-status').textContent, predErr: m.client.stats.predErr,
      errors: [...m.errors], transport: m.transport.kind, online: m.st.online };
  });
}
async function settle() {
  await page.waitForFunction(() => { const m = window.__mn, b = m.panels.raftEditor, r = m.client.pred.rafts.find((a) => a.owner === m.client.youServer), s = m.client.profile?.eco?.ships.find((a) => a.id === r?.id);
    return !b.pending && r?.rev === s?.rev; }, null, { timeout: 20000 });
}
async function shot(name) {
  await page.evaluate(() => { const m = window.__mn; m.world.pipeline.markDirty(); m.__editorDraw(); });
  const file = path.join(out, `${name}.png`); await page.screenshot({ path: file });
  evidence.screenshots.push({ name, path: path.relative(root, file).replaceAll('\\', '/'), ...hash(file) });
  evidence.actions.push({ name, state: await state() });
}
async function buy(n) {
  for (let i = 0; i < n; i++) {
    await page.waitForFunction(() => { const b = window.__mn.panels.raftEditor, button = b.root.querySelector('[data-supply="madera"]'); return button && !button.disabled && !b.pending; }, null, { timeout: 20000 });
    const before = await state(); await page.locator('[data-supply="madera"]').click(); await settle(); const after = await state();
    ensure(after.rev === before.rev + 1 && after.gold < before.gold, 'Supply must charge authoritative gold exactly once');
    ensure((after.hold.goods.madera || 0) + (after.pack.goods.madera || 0) === (before.hold.goods.madera || 0) + (before.pack.goods.madera || 0) + 1, 'Supply must deliver one real wood');
    evidence.actions.push({ name: 'buy-one-wood', before, after });
  }
}
async function aimAt(x, z, level, heightOffset = 0) {
  const p = await page.evaluate(async ({ x, z, level, heightOffset }) => {
    const THREE = await import('three'), { stage } = await import('./src/ui/stage.js');
    const m = window.__mn, r = m.client.pred.rafts.find((a) => a.owner === m.client.youServer), c = Math.cos(r.yaw), s = Math.sin(r.yaw);
    const lx = (x + .5) * 2, lz = (z + .5) * 2;
    const v = new THREE.Vector3(r.x + c * lx + s * lz, r.y + level * 2.6 + heightOffset, r.z - s * lx + c * lz).project(m.world.camera);
    const sx = (v.x + 1) * stage.w / 2, sy = (1 - v.y) * stage.h / 2;
    return { x: stage.rotated ? innerWidth - sy : sx, y: stage.rotated ? sx : sy, sx, sy };
  }, { x, z, level, heightOffset });
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, p);
  ensure(hit === 'game', `Target ${x},${z},${level} covered by UI (${hit}) at ${JSON.stringify(p)}`);
  if (phone) await page.touchscreen.tap(p.x, p.y); else await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(70);
  const selected = await state(); ensure(selected.target?.x === x && selected.target?.z === z, `Ray did not select ${x},${z}: ${JSON.stringify(selected.target)}`);
  return p;
}
async function place(piece, snapshot = false) {
  const [id, x, z, level, dir] = piece;
  await page.locator(`[data-part="${id}"]`).click(); await page.locator('.re-level').selectOption(String(level));
  while ((await state()).dir !== dir) { if (phone) await page.locator('.re-rotate').click(); else await page.keyboard.press('KeyR'); }
  const p = await aimAt(x, z, level), before = await state();
  if (snapshot) await shot(`preview-${id}`);
  if (phone) await page.locator('.re-action').click(); else await page.mouse.click(p.x, p.y);
  await settle(); const after = await state();
  ensure(after.rev === before.rev + 1 && after.parts.length === before.parts.length + 1, `Placement ${id} failed: ${after.status}`);
  ensure(after.parts.some((p) => p.length === 5 && p.every((n, i) => n === piece[i])), `Missing authoritative ${id} tuple`);
  ensure(JSON.stringify(before.pose) === JSON.stringify(after.pose), 'Editing must not shift the live mooring pose');
  evidence.actions.push({ name: `place-${id}`, before, after });
}

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.MN_BROWSER || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  page = await context.newPage();
  page.on('pageerror', (e) => { evidence.pageErrors.push(e.message); console.log('pageerror', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') evidence.consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => evidence.requestFailures.push({ url: r.url(), error: r.failure()?.errorText }));
  page.on('request', (r) => { if (/comic-materials-v1.*\.webp/.test(r.url())) evidence.textureRequests.push(new URL(r.url()).pathname); });
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const m = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/), dir = m[1].startsWith('three') ? process.env.MN_THREE : process.env.MN_GSAP;
    if (!dir) return route.continue(); const file = path.join(dir, m[2]);
    return route.fulfill({ status: fs.existsSync(file) ? 200 : 404, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.existsSync(file) ? fs.readFileSync(file) : '' });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (r) => r.abort());
  const url = `http://127.0.0.1:${server.address().port}/?solo&debug&q=${phone ? 'low' : 'high'}&tod=day&maxdt=0.5`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  console.log('boot-title', { phone, portrait });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
  await page.evaluate(async () => {
    const { GAME } = await import('./src/data/meta.js'), { newProfile } = await import('./src/sim/systems/inventory.js');
    const p = newProfile(); p.gold = 1200; localStorage.setItem(`${GAME.saveKey}.save.solo`, JSON.stringify(p));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').click();
  console.log('join-worker');
  await page.waitForFunction(() => window.__mn.st.mode === 'playing' && window.__mn.input.enabled && window.__mn.client.pred.rafts.length === 1, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const THREE = await import('three'), m = window.__mn, d = m.map.dock;
    m.__editorDraw = m.world.render.bind(m.world); m.world.render = () => {};
    m.teleport(d.base.x + d.dir.x * (d.len - 10), d.base.z + d.dir.z * (d.len - 10));
    const r = m.client.pred.rafts[0], c = Math.cos(r.yaw), s = Math.sin(r.yaw), yaw = m.world.rig.yaw;
    const center = new THREE.Vector3(r.x + c * 1.5 + s * 2.5, r.y + .4, r.z - s * 1.5 + c * 2.5);
    center.x += Math.cos(yaw) * 2.5; center.z -= Math.sin(yaw) * 2.5;
    const update = m.world.rig.update.bind(m.world.rig); m.world.rig.blend = null; m.world.rig.dist = m.world.rig.distTarget = 19;
    m.world.rig.snapTo(center); m.world.rig.update = (dt, focus, aim, scale) => update(dt, center, null, scale);
    m.world.nearFade(false);
    m.__editorEvents = []; const { bus } = await import('./src/core/events.js'); bus.on('raftEdit', (ev) => m.__editorEvents.push(ev));
  });
  await page.waitForFunction(() => !document.querySelector('.raft-build-launcher').hidden, null, { timeout: 20000 });
  const initial = await state(); ensure(initial.parts.length === 6 && initial.gold === 1200 && initial.transport === 'worker' && !initial.online, 'Isolated starter witness failed');
  if (phone) await page.locator('.raft-build-launcher').click(); else await page.keyboard.press('KeyB');
  await page.waitForFunction(() => window.__mn.panels.raftEditor.active && document.querySelector('[data-supply="madera"]'), null, { timeout: 20000 });
  await shot('01-starter-editor'); await aimAt(0, 0, 0); await shot('02-invalid-overlap');
  console.log('editor-ready');
  ensure((await state()).status.includes('ocupado'), 'Overlap reason must be visible');
  await buy(4); await place(['foundation', 0, 2, 0, 0], true);
  await buy(2); await place(['pillar', 0, 2, 0, 0]);
  await buy(3); await place(['floor', 0, 2, 1, 0], true);
  await buy(4); await place(['stairs', 0, 1, 0, 0]);
  await buy(3); await place(['wall', 1, 0, 0, 2], true);
  await buy(1); await place(['railing', 0, 2, 1, 2]);
  await buy(2); await place(['crate', 0, 2, 1, 0]);
  await shot('03-seven-pieces-built');
  await page.locator('[data-mode="remove"]').click(); await page.locator('.re-level').selectOption('1');
  const removePoint = await aimAt(0, 2, 1, .55); if (!phone) await page.mouse.click(removePoint.x, removePoint.y);
  let selected = await page.locator('.re-details').innerText();
  for (let i = 0; !selected.includes('Caja') && i < 6; i++) { await page.locator('.re-cycle').click(); selected = await page.locator('.re-details').innerText(); }
  ensure(selected.includes('Caja'), 'Removal must select the added crate');
  const beforeRemove = await state(); ensure(beforeRemove.parts.length === 13, 'Canvas selection must not remove a piece');
  await shot('04-explicit-remove-refund'); await page.locator('.re-action').click(); await settle();
  const afterRemove = await state(); ensure(afterRemove.parts.length === 12 && afterRemove.rev === beforeRemove.rev + 1, 'Explicit removal failed');
  ensure((afterRemove.hold.goods.madera || 0) + (afterRemove.pack.goods.madera || 0) === 1, 'Crate refund must restore exactly one wood');
  await shot('05-remove-confirmed');
  if (phone) await page.locator('.re-close').click(); else await page.keyboard.press('Escape');
  ensure(!(await state()).active, 'Exit must close editor');
  if (!phone) {
    await page.keyboard.press('KeyI'); ensure(await page.locator('#charpanel').isVisible(), 'I still opens inventory'); await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__mn.loop.running = false; window.__mn.input.clearActions(); });
    await page.keyboard.down('KeyR'); const skill = await page.evaluate(() => window.__mn.input.consumeSlots({ down: {}, up: {}, held: {} }));
    ensure(skill.down.r && skill.held.r, 'R must remain a skill outside construction'); await page.keyboard.up('KeyR');
    await page.mouse.down({ button: 'right' });
    const guard = await page.evaluate(() => window.__mn.input.held); await page.mouse.up({ button: 'right' });
    ensure(guard & 4, 'RMB must remain guard outside construction');
    const cleared = await page.evaluate(() => { const m = window.__mn; m.input.clearActions(); m.aimCtl.reset(); m.loop.running = true; return m.input.consumePresses(); });
    ensure(cleared === 0, 'Boundary cleanup leaked combat presses'); evidence.actions.push({ name: 'outside-inventory-R-and-guard', skill, guard });
  }
  await page.waitForFunction(() => { const p = JSON.parse(localStorage.getItem('mareanegra.v1.save.solo') || 'null'); return p?.eco?.ships?.[0]?.grid?.parts?.length === 12; }, null, { timeout: 20000 });
  evidence.final = await state(); evidence.events = await page.evaluate(() => window.__mn.__editorEvents);
  ensure(evidence.final.errors.length === 0 && evidence.pageErrors.length === 0, 'Runtime errors occurred');
  const atlas = await page.evaluate(() => { const a = window.__mn.assets.texture('tex:raft-comic-v1'), im = a?.image || a?.source?.data; return { width: im?.width, height: im?.height }; });
  evidence.atlas = atlas; ensure(atlas.width === (phone ? 512 : 1024), 'Wrong device atlas loaded');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mareanegra.v1.save.solo')));
  evidence.saved = { rev: saved.eco.ships[0].rev, parts: saved.eco.ships[0].grid.parts, hold: saved.eco.ships[0].hold, pack: saved.eco.pack, gold: saved.gold, berthBasis: saved.eco.ships[0].berthBasis };
  ensure(evidence.saved.rev === evidence.final.rev && evidence.saved.gold === evidence.final.gold, 'Saved authority differs from UI state');
  evidence.accepted = true; fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ accepted: true, out, shots: evidence.screenshots.length, rev: evidence.final.rev, parts: evidence.final.parts.length, atlas, pageErrors: evidence.pageErrors }));
} catch (e) {
  evidence.accepted = false; evidence.failure = e.stack;
  if (page) { try { await shot('failure'); } catch {} }
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2)); throw e;
} finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
