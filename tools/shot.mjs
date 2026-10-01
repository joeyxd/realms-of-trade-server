// Automated screenshots + console check (Playwright, headless Chromium with SwiftShader WebGL).
// Usage: node tools/shot.mjs [outDir] [--quality=high] [--scenario=all|title|play]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, 'shots'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const quality = opt.quality || 'high';
const scenario = opt.scenario || 'all';
const width = +(opt.w || 1280), height = +(opt.h || 720);
fs.mkdirSync(outDir, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// In the sandboxed dev container, HTTPS is re-terminated by a proxy whose CA Chromium must trust
// (scoped to that one CA's public key; set MN_PROXY_SPKI to enable).
const extra = process.env.MN_PROXY_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.MN_PROXY_SPKI}`] : [];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', ...extra] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
// Optional: serve the CDN libraries from a local copy (MN_LIBS=<dir with three-0.160.0/ and gsap-3.12.5/>),
// and fetch fonts from Node, so screenshots don't depend on the browser's network stack.
if (process.env.MN_LIBS) {
  const libs = process.env.MN_LIBS;
  const local = { 'three@0.160.0': 'three-0.160.0/package', 'gsap@3.12.5': 'gsap-3.12.5/package' };
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, (route) => {
    const m = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const f = path.join(libs, local[m[1]], m[2]);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(f) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, async (route) => {
    try { const r = await route.fetch(); await route.fulfill({ response: r, headers: { ...r.headers(), 'access-control-allow-origin': '*' } }); }
    catch { await route.abort(); }
  });
}
const logs = [];
const seen = new Map();
page.on('console', (m) => {
  if (!['error', 'warning'].includes(m.type())) return;
  const t = `[${m.type()}] ${m.text()}`;
  const k = t.slice(0, 160);
  seen.set(k, (seen.get(k) || 0) + 1);
  if (seen.get(k) === 1) logs.push(t);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + '.png') }); console.log('shot', name); };
const wait = (ms) => page.waitForTimeout(ms);
const t0 = Date.now();
await page.goto(`http://localhost:${port}/?q=${quality}&tod=day&debug&perf&maxdt=${opt.maxdt || 0.5}`, { waitUntil: "load" });
try {
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: +(opt.timeout || 120000) });
} catch (e) {
  console.log('NOT READY:', e.message);
  console.log(logs.join('\n'));
  await shot('00-fail');
  await browser.close(); server.close(); process.exit(1);
}
console.log('ready in', Date.now() - t0, 'ms');
await wait(2500);
await shot('01-title');
if (scenario !== 'title') {
  await page.click('#btn-play', { force: true });
  await page.waitForFunction(() => window.__mn.st.mode === 'playing', null, { timeout: 60000 });
  await page.waitForFunction(() => !window.__mn.world.rig.blend, null, { timeout: 90000 });
  // Enemies fight back since M2: god mode keeps the tour from ending at a checkpoint.
  await page.evaluate(() => window.__mn.client.send({ t: 'cmd', type: 'dev', op: 'god', on: true }));
  await wait(3000);
  await shot('02-spawn');
  await page.mouse.move(width * 0.5, height * 0.45);
  await page.mouse.wheel(0, -300);
  await wait(5000);
  await shot('02b-closeup');
  await page.evaluate(() => window.__mn.fxTest());
  await wait(1200);
  await shot('02c-fx');
  await page.mouse.wheel(0, 300);
  await wait(3000);
  // Walk a bit and dash.
  await page.keyboard.down('KeyD');
  await wait(1500);
  await page.keyboard.press('Space');
  await wait(60);
  await shot('03-dash');
  await wait(800);
  await page.keyboard.up('KeyD');
  await wait(800);
  const tp = async (name, x, z, extra) => {
    await page.evaluate(([x, z]) => window.__mn.teleport(x, z), [x, z]);
    await wait(6000);
    if (extra) await extra();
    await shot(name);
  };
  const L = await page.evaluate(() => {
    const m = window.__mn, L = m.map.landmarks;
    const cap = m.map.npcs.find((n) => n.id === 'captain');
    return { village: L.village, arena: L.arena, dockBase: L.dockBase, path: L.path, captain: { x: cap.x, z: cap.z } };
  });
  await tp('04-village', L.village.x + 6, L.village.z + 6);
  await tp('05-captain', L.captain.x + 1.5, L.captain.z + 1.5, async () => { await page.keyboard.press('KeyF'); await wait(2500); });
  await tp('06-path', L.path[3].x, L.path[3].z);
  await tp('07-caldera', L.arena.x + 6, L.arena.z + 6);
  await wait(2500);
  await shot('08-caldera-volcanic');
  await page.mouse.move(width * 0.5, height * 0.5);
  await page.mouse.wheel(0, 300);
  await wait(5000);
  await shot('09-zoom-far');
  await page.mouse.wheel(0, -300);
  // Water: wade in the shallows next to the spawn, then the dock with the floating cargo.
  const W = await page.evaluate(() => {
    const m = window.__mn, L = m.map.landmarks;
    let x = L.spawn.x, z = L.spawn.z;
    for (let i = 0; i < 400 && m.map.heightAt(x, z) > -0.38; i++) { x += 0.15; z += 0.15; }
    return { wade: { x, z }, dock: { x: L.dockBase.x + 4, z: L.dockBase.z + 1 } };
  });
  await tp('10-wade', W.wade.x, W.wade.z, async () => { await page.keyboard.down('KeyA'); await wait(2500); await page.keyboard.up('KeyA'); await wait(400); });
  await tp('11-dock', W.dock.x, W.dock.z);
  // Combat (M2): the practice ring under cannon fire, and the archers on the Sendero del Humo.
  const C = await page.evaluate(() => {
    const m = window.__mn, a = m.map.enemySpawns.find((e) => e.kind === 'archer');
    return { ring: m.map.practice.ring, archer: { x: a.x + 6, z: a.z + 3 } };
  });
  await tp('14-practice', C.ring.x + 1, C.ring.z - 0.5);
  await tp('15-archers', C.archer.x, C.archer.z, async () => { await page.keyboard.press('KeyJ'); await wait(300); });
  // M2.5 La Prueba de Fuego: step on the runes (wave 1), skip to wave 3, then Hellfire in both phases.
  const dev = (o) => page.evaluate((o2) => window.__mn.client.send({ t: 'cmd', type: 'dev', ...o2 }), o);
  const encSt = () => page.evaluate(() => JSON.stringify(window.__mn.client.enc && window.__mn.client.enc[0]));
  await tp('16-trial-wave1', L.arena.x + 1, L.arena.z + 1, async () => { await wait(2500); });
  await dev({ op: 'enc', sub: 'wave' }); await wait(5500);
  await dev({ op: 'enc', sub: 'wave' }); await wait(800); await dev({ op: 'enc', sub: 'wave' }); await wait(5500);
  await shot('17-trial-wave3');
  await dev({ op: 'enc', sub: 'boss' }); await wait(6500);
  await shot('18-hellfire-1');
  await dev({ op: 'enc', sub: 'phase2' }); await wait(5000);
  await shot('19-hellfire-2');
  console.log('trial', await encSt());
  await dev({ op: 'enc', sub: 'reset' });
  // Night: lanterns, hut windows, the campfire and the moonlit sea.
  await page.evaluate(() => window.__mn.tod('night'));
  await wait(1500);
  await shot('12-dock-night');
  await tp('13-village-night', L.village.x + 2, L.village.z + 1);
  const perf = await page.evaluate(() => document.querySelector('#perf').textContent);
  console.log(perf);
}
console.log('--- console (errors/warnings) ---');
console.log(logs.length ? logs.join('\n') : '(clean)');
await browser.close();
server.close();
