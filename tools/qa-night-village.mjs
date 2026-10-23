import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const { chromium } = await import('file:///C:/DEV/real%20of%20trade/visual-revamp/node_modules/playwright/index.mjs');
const root = 'C:/DEV/real of trade/visual-revamp';
const out = process.argv[2];
const [x, z, zoom, yawq] = [process.argv[3] ?? -100, process.argv[4] ?? -4, process.argv[5] ?? 1, process.argv[6] ?? 1].map(Number);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(root, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 760 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (['error','warning'].includes(m.type())) logs.push(m.text().slice(0,300)); });
  page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
  await page.goto(`http://localhost:${port}/?q=high&tod=day&debug&maxdt=0.5`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
  await page.click('#btn-play', { force: true });
  for (let i = 0; i < 12; i++) {
    if (await page.evaluate(() => window.__mn.st.mode === 'playing')) break;
    const act = await page.evaluate(() => {
      const vis = (b) => b && !b.disabled && b.offsetParent !== null;
      const sec = [...document.querySelectorAll('.player-characters-secondary')].filter(vis);
      const pri = [...document.querySelectorAll('.player-characters-primary')].filter(vis);
      return { sec: sec.map((b) => b.textContent), pri: pri.map((b) => b.textContent) };
    });
    console.log('dialog', JSON.stringify(act));
    const pri = page.locator('.player-characters-primary:visible:not([disabled])');
    if (await pri.count()) await pri.first().click({ force: true });
    else { const sec = page.locator('.player-characters-secondary:visible:not([disabled])'); if (await sec.count()) await sec.first().click({ force: true }); }
    await page.waitForTimeout(2500);
  }
  try { await page.waitForFunction(() => window.__mn.st.mode === 'playing', null, { timeout: 60000 }); } catch (e) { console.log('NOT PLAYING', await page.evaluate(() => JSON.stringify({ mode: window.__mn.st.mode, joined: window.__mn.client?.joined, body: document.body.innerText.slice(0, 400) }))); console.log(logs.join(' | ')); throw e; }
  await page.waitForFunction(() => !window.__mn.world.rig.blend, null, { timeout: 240000 });
  await page.evaluate(([x, z, zoom]) => { const m = window.__mn, r = m.world.rig; const V = m.map.landmarks.village; m.teleport(V.x + x, V.z + z); r.yaw = r.yawTarget = Math.PI / 4; r.zoom(zoom - r.zoomIdx); const L = m.world.lighting; L.setGameplay = function () { this.gameplay = false; }; m.tod('night'); }, [x, z, zoom]);
  await page.waitForFunction(() => window.__mn.world.lighting.cur.sunI <= 0.02, null, { timeout: 60000 });
  await page.waitForTimeout(9000);
  console.log(await page.evaluate(() => JSON.stringify({ x: window.__mn.ps.x, z: window.__mn.ps.z, V: window.__mn.map.landmarks.village })));
  const variants = JSON.parse(process.env.VARIANTS || '[{}]');
  for (let n = 0; n < variants.length; n++) {
    await page.evaluate(async (v) => { const { PRESETS } = await import('/src/render/lighting.js'); for (const [k, val] of Object.entries(v)) { const [pn, key] = k.split('.'); const cur = PRESETS[pn][key]; if (cur && cur.isColor) cur.set(val); else PRESETS[pn][key] = val; } }, variants[n]);
    await page.waitForTimeout(2500);
    console.log(await page.evaluate(() => { const c = window.__mn.world.lighting.cur; return JSON.stringify({ hemiI: c.hemiI, bounce: c.lightBounce, soft: c.lightSoft, sunI: c.sunI, uni: [window.__mn.world.lighting.hemi.intensity] }); }));
    await page.screenshot({ path: out.replace('.png', '-v' + n + '.png'), timeout: 120000 });
  }
  console.log('shot', out);
  console.log(await page.evaluate(() => JSON.stringify(window.__mn.world.lights.picked.filter((s) => s.w > 0).map((s) => s.kind))));
  console.log(logs.length ? logs.join('\n') : '(clean)');
} finally { await browser.close(); server.close(); }
