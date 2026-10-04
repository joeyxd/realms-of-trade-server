// Look check (the screenshots every visual change is reviewed with): solo on a static server, a few places at a
// quality, desktop or phone viewport, then the console errors. Headless Chromium + SwiftShader (slow but honest).
// env: OUT (dir), Q (high | ultra | medium | low), VW / VH (viewport), DPR, PHONE=1 (touch + mobile), TOD (day |
//      night | ...), SCEN (comma list: spawn, close, village, fight, cala, caldera, path, impact, vclose, pause),
//      PERF=1 (print the perf line), MN_LIBS (a dir with three-0.160.0/package and gsap-3.12.5/package unpacked from
//      npm, served instead of the CDN when the network blocks it), ROOT (the repo; default: this one).
// Example: OUT=shots/look Q=ultra SCEN=village,impact node tools/look.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const root = process.env.ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT || '.'; fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.ktx2': 'image/ktx2' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const W = +(process.env.VW || 1280), H = +(process.env.VH || 720);
const phone = !!process.env.PHONE;
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: +(process.env.DPR || 1), ...(phone ? { isMobile: true, hasTouch: true } : {}) });
const page = await ctx.newPage();
const libs = process.env.MN_LIBS;
const local = { 'three@0.160.0': 'three-0.160.0/package', 'gsap@3.12.5': 'gsap-3.12.5/package' };
if (libs) await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, (route) => {
  const m = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
  const f = path.join(libs, local[m[1]], m[2]);
  if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
  route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(f) });
});
await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (r) => r.abort());
const logs = new Set();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.add(`[${m.type()}] ` + m.text().slice(0, 300)); });
page.on('pageerror', (e) => logs.add('[pageerror] ' + e.message));
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (n) => { await page.screenshot({ path: OUT + '/' + n + '.png' }); console.log('shot', n); };
await page.goto(`http://127.0.0.1:${port}/?q=${process.env.Q || 'high'}&debug&maxdt=0.5&tod=${process.env.TOD || 'day'}`);
await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
if (process.env.TITLE) { await wait(2500); await shot('00-title'); }
await page.click('#btn-play', { force: true });
await page.waitForFunction(() => window.__mn.st.mode === 'playing', null, { timeout: 90000 });
await page.waitForFunction(() => !window.__mn.world.rig.blend, null, { timeout: 90000 });
const dev = (o) => page.evaluate((o) => window.__mn.transport.send({ t: 'cmd', type: 'dev', ...o }), o);
await dev({ op: 'god', on: true });
await page.evaluate(() => window.__mn.client.send({ t: 'cmd', type: 'tut', i: 5 }));
await wait(2500);
const L = await page.evaluate(() => {
  const m = window.__mn, L = m.map.landmarks;
  const a = m.map.enemySpawns.find((e) => e.kind === 'grunt');
  return { spawn: L.spawn, village: L.village, arena: L.arena, path: L.path, cala: m.map.cala, grunt: { x: a.x, z: a.z } };
});
const tp = async (name, x, z, extra, ms = 5000) => { await page.evaluate(([x, z]) => window.__mn.teleport(x, z), [x, z]); await wait(ms); if (extra) await extra(); await shot(name); };
const scen = (process.env.SCEN || 'spawn,village,fight,cala,caldera').split(',');
for (const s of scen) {
  if (s === 'spawn') await tp('01-spawn', L.spawn.x, L.spawn.z);
  if (s === 'close') { await page.mouse.move(W / 2, H / 2); await page.mouse.wheel(0, -400); await wait(3000); await tp('01b-close', L.spawn.x, L.spawn.z); await page.mouse.wheel(0, 400); await wait(2000); }
  if (s === 'village') await tp('02-village', L.village.x + 6, L.village.z + 6);
  if (s === 'fight') await tp('03-fight', L.grunt.x + 5, L.grunt.z + 4, async () => { await page.keyboard.press('KeyJ'); await wait(250); await page.keyboard.press('KeyJ'); await wait(200); });
  if (s === 'cala') await tp('04-cala', L.cala.x + 4, L.cala.z + 6, null, 7000);
  if (s === 'caldera') await tp('05-caldera', L.arena.x + 6, L.arena.z + 6);
  if (s === 'path') await tp('06-path', L.path[3].x, L.path[3].z);
  if (s === 'impact') {
    await tp('00-impact-ref', L.grunt.x + 5, L.grunt.z + 4, null, 4000);
    // Freeze the comic effects so a slow software renderer still shows them: no decay, the frame held, words kept.
    await page.evaluate(() => {
      const m = window.__mn, P = m.world.pipeline;
      P.update = () => {};
      m.comic.hit(m.ps.x + 1.2, m.ps.y + 1.3, m.ps.z + 1.2, { word: '¡CLANG!', frame: true, lines: true, color: 0xffc46a });
      P.hit.frames = 1e9; P.hit.linesT = 0.3;
      for (const f of m.comic.cfg.worldUI.floats) f.life = 1e9;
    });
    await wait(1500);
    await page.addStyleTag({ content: '.ono-in { animation: none !important; }' });
    await wait(1500); await shot('07-impact');
    await page.evaluate(() => {
      const m = window.__mn, P = m.world.pipeline;
      P.hit.frames = 0; P.hit.lastT = -1e9;
      m.comic.alive.length = 0; m.comic.lastWord = -1e9;
      for (const f of m.comic.cfg.worldUI.floats) { f.active = false; f.el.hidden = true; }
      m.comic.hit(m.ps.x, m.ps.y + 1.6, m.ps.z, { word: '¡KABUM!', big: true, lines: true, color: 0xff7a2a });
      m.comic.lastWord = -1e9;
      m.comic.hit(m.ps.x - 2.5, m.ps.y + 2.4, m.ps.z + 2.5, { word: '¡ZAS!' });
      P.hit.linesT = 0.3;
      for (const f of m.comic.cfg.worldUI.floats) f.life = 1e9;
    });
    await wait(1500); await shot('08-lines-words');
  }
  if (s === 'vclose') {
    await page.mouse.move(W / 2, H / 2); await page.mouse.wheel(0, -400); await wait(3000);
    await tp('10-village-close', L.village.x + 6, L.village.z + 6, null, 4000);
    await tp('11-fight-close', L.grunt.x + 5, L.grunt.z + 4, null, 4000);
    await page.mouse.wheel(0, 400); await wait(1500);
  }
  if (s === 'pause') {
    await page.keyboard.press('Escape'); await wait(1200); await shot('09-pause');
    await page.keyboard.press('Escape'); await wait(600);
  }
}
if (process.env.PERF) console.log(await page.evaluate(() => document.querySelector('#perf')?.textContent));
console.log([...logs].join('\n') || '(clean)');
await browser.close(); server.close();
