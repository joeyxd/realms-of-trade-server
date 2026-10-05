// Look check (the screenshots every visual change is reviewed with): solo on a static server, a few places at a
// quality, desktop or phone viewport, then the console errors. Headless Chromium + SwiftShader (slow but honest).
// env: OUT (dir), Q (high | ultra | medium | low), VW / VH (viewport), DPR, PHONE=1 (touch + mobile), TOD (day |
//      night | ...), SCEN (comma list: spawn, close, village, fight, cala, caldera, path, impact, vclose, pause, tattoo,
//      sepia, pearl, escarcha, tormenta, tinta),
//      PERF=1 (print the perf line), MN_LIBS (a dir with three-0.160.0/package and gsap-3.12.5/package unpacked from
//      npm, served instead of the CDN when the network blocks it), ROOT (the repo; default: this one).
//      MN_PLAYWRIGHT / MN_BROWSER (installed module / browser paths), MN_THREE / MN_GSAP (package directories).
// Example: OUT=shots/look Q=ultra SCEN=village,impact node tools/look.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
let chromium;
try { ({ chromium } = await import(process.env.MN_PLAYWRIGHT ? pathToFileURL(process.env.MN_PLAYWRIGHT).href : 'playwright')); }
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
const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const W = +(process.env.VW || 1280), H = +(process.env.VH || 720);
const phone = !!process.env.PHONE;
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: +(process.env.DPR || 1), ...(phone ? { isMobile: true, hasTouch: true } : {}) });
const page = await ctx.newPage();
const libs = process.env.MN_LIBS;
const local = { 'three@0.160.0': 'three-0.160.0/package', 'gsap@3.12.5': 'gsap-3.12.5/package' };
if (libs || process.env.MN_THREE) await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, (route) => {
  const m = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
  const packageDir = m[1] === 'three@0.160.0' ? process.env.MN_THREE : process.env.MN_GSAP;
  if (!packageDir && !libs) return route.continue();
  const f = packageDir ? path.join(packageDir, m[2]) : path.join(libs, local[m[1]], m[2]);
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
try {
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
} catch (err) {
  console.error('Boot failed:', [...logs].join('\n'), await page.locator('body').innerText());
  await page.screenshot({ path: OUT + '/boot-failed.png' });
  await browser.close(); server.close(); throw err;
}
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
let storeTouch;
try {
for (const s of scen) {
  if (s === 'tinta') {
    await tp('70-tinta-before', L.spawn.x, L.spawn.z);
    await dev({ op: 'clock', hours: 12 });
    await dev({ op: 'pearl', kind: 'tinta' });
    await page.waitForFunction(() => window.__mn.client.profile?.pearls?.bag.some((q) => q.kind === 'tinta'));
    await page.keyboard.press('KeyP');
    await page.locator('[data-pearl-op="swallow"]').first().click();
    await page.waitForFunction(() => window.__mn.client.profile?.pearls?.swallowed?.kind === 'tinta');
    await shot('71-tinta-panel');
    await page.locator('.cp-body').evaluate((el) => { el.scrollTop = 0; });
    await shot('71b-tinta-panel-top');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__mn.ps.cdG <= 0, null, { timeout: 60000 });
    await page.evaluate(() => {
      const m = window.__mn, onEvent = m.client.onEvent.bind(m.client), tickInput = m.client.tickInput.bind(m.client), viewTick = m.client.viewTick.bind(m.client);
      window.__inkHeld = false;
      m.client.onEvent = (ev) => {
        onEvent(ev);
        if (ev.type !== 'inkCloud' || ev.e !== m.client.youServer) return;
        m.client.tickInput = () => {};
        m.client.viewTick = () => ev.t0 + 20;
        m.transport.send({ t: 'cmd', type: 'pause', on: true });
        window.__inkHeld = true;
      };
      window.__inkRestore = () => {
        m.client.onEvent = onEvent; m.client.tickInput = tickInput; m.client.viewTick = viewTick;
        m.transport.send({ t: 'cmd', type: 'pause', on: false });
      };
    });
    let inkTouch;
    if (!phone) {
      await page.mouse.move(W * 0.5, H * 0.54);
      await page.keyboard.down('KeyG');
      await page.waitForFunction(() => window.__mn.aimCtl.preview?.slot === 'g' && window.__mn.world.indicators.marker.mesh.visible);
      await shot('72-tinta-aim');
      await page.keyboard.press('Escape'); await page.keyboard.up('KeyG');
      await page.waitForFunction(() => !window.__mn.aimCtl.preview);
      const canceled = await page.evaluate(() => ({ cd: window.__mn.ps.cdG, fields: window.__mn.client.pred.inkClouds.length }));
      if (canceled.cd > 0 || canceled.fields) throw new Error('Cancelling Nube spent cooldown or created a cloud');
      await page.keyboard.down('KeyG'); await page.keyboard.up('KeyG');
    } else {
      const button = await page.locator('.t-g').boundingBox();
      if (!button || button.y < 0 || button.y + button.height > H) throw new Error('Nube touch button is outside the viewport');
      if (!(await page.locator('.t-g').innerText()).includes('NUBE')) throw new Error('Touch G still names another pearl');
      inkTouch = await ctx.newCDPSession(page);
      const x = button.x + button.width / 2, y = button.y + button.height / 2;
      await inkTouch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await inkTouch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 10, y: y - 6 }] });
      await page.waitForFunction(() => window.__mn.aimCtl.preview?.slot === 'g');
      await shot('72-tinta-aim');
      await inkTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await page.waitForFunction(() => {
      const m = window.__mn, t = m.client.viewTick(m.loop.alpha);
      return window.__inkHeld && m.client.pred.inkClouds.some((f) => !f.predicted && t >= f.t0 && t < f.tEnd)
        && m.world.inkFx.clouds.some((s) => s.live);
    }, null, { timeout: 60000 });
    await wait(800); await shot('73-tinta-cloud');
    console.log('tinta', JSON.stringify(await page.evaluate(() => ({ pearl: window.__mn.client.profile.pearls.swallowed.kind,
      fields: window.__mn.client.pred.inkClouds, hour: window.__mn.client.pred.hourAt(window.__mn.client.viewTick(0)),
      cd: window.__mn.ps.cdG, errors: window.__mn.errors }))));
    await page.evaluate(() => window.__inkRestore());
    await dev({ op: 'clock', hours: 22 });
    await page.waitForFunction(() => window.__mn.client.pred.isNightAt(window.__mn.client.viewTick(0)), null, { timeout: 30000 });
    await page.evaluate(() => window.__mn.tod('night'));
    await wait(1000); await shot('74-tinta-night');
    // Put the marked target above the feet prompt so the tutorial does not obscure its ring in the capture.
    await dev({ op: 'spawn', kind: 'dummy', dist: 1.8, ang: -Math.PI / 2 });
    await page.waitForFunction(() => [...window.__mn.client.entities.values()].some((r) => r.enemy === 'dummy'
      && Math.hypot(r.r.x - window.__mn.ps.x, r.r.z - window.__mn.ps.z) < 2.5));
    await page.evaluate(() => {
      const m = window.__mn, onSnapshot = m.client.onSnapshot.bind(m.client);
      const tickInput = m.client.tickInput.bind(m.client), viewTick = m.client.viewTick.bind(m.client);
      window.__markHeld = false;
      m.client.onSnapshot = (snapshot) => {
        onSnapshot(snapshot);
        if (!snapshot.ink?.marks?.length) return;
        m.client.tickInput = () => {};
        m.client.viewTick = () => snapshot.tick + 4;
        m.transport.send({ t: 'cmd', type: 'pause', on: true });
        window.__markHeld = true;
      };
      window.__markRestore = () => {
        m.client.onSnapshot = onSnapshot; m.client.tickInput = tickInput; m.client.viewTick = viewTick;
        m.transport.send({ t: 'cmd', type: 'pause', on: false });
      };
    });
    if (!phone) {
      const targetScreen = await page.evaluate(async () => {
        const m = window.__mn, { Vector3 } = await import('three');
        const p = new Vector3(m.ps.x - 1.8, m.ps.y, m.ps.z).project(m.world.camera);
        return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
      });
      await page.mouse.move(targetScreen.x, targetScreen.y); await page.mouse.down();
    } else {
      const attack = await page.locator('.t-atk').boundingBox();
      if (!attack) throw new Error('Attack touch button is missing');
      await inkTouch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: attack.x + attack.width / 2, y: attack.y + attack.height / 2 }] });
    }
    await page.waitForFunction(() => window.__markHeld && window.__mn.world.inkFx.marks.some((m) => m.live), null, { timeout: 45000 });
    if (!phone) await page.mouse.up();
    else await inkTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await shot('75-tinta-mark');
    console.log('tinta-mark', JSON.stringify(await page.evaluate(() => ({ marks: window.__mn.client.pred.inkMarks, errors: window.__mn.errors }))));
    await page.evaluate(() => window.__markRestore());
    if (inkTouch) await inkTouch.detach();
  }
  if (s === 'tormenta') {
    await tp('60-tormenta-before', L.spawn.x, L.spawn.z);
    await dev({ op: 'pearl', kind: 'tormenta' });
    await page.waitForFunction(() => window.__mn.client.profile?.pearls?.bag.some((p) => p.kind === 'tormenta'));
    await page.keyboard.press('KeyP');
    await page.locator('[data-pearl-op="swallow"]').first().click();
    await page.waitForFunction(() => window.__mn.client.profile?.pearls?.swallowed?.kind === 'tormenta');
    await shot('61-tormenta-panel');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__mn.ps.cdG <= 0, null, { timeout: 60000 });
    // Stationary practice targets exercise a real chain without NPC movement during software rendering.
    for (const dist of [4, 7, 10, 13, 16]) await dev({ op: 'spawn', kind: 'dummy', ang: Math.PI / 2, dist });
    await page.waitForFunction(() => [...window.__mn.client.entities.values()].filter((r) => r.enemy === 'dummy' && r.ready).length >= 5);
    await page.evaluate(() => {
      const m = window.__mn, input = m.client.tickInput.bind(m.client), event = m.client.onEvent.bind(m.client), fx = m.world.stormFx.update.bind(m.world.stormFx);
      window.__stormChargeHeld = false; window.__stormLightning = null;
      m.client.tickInput = (cmd) => {
        input(cmd);
        const ecs = m.client.pred.ecs, e = m.client.youLocal;
        if (ecs.chg[e] && ecs.castK[e] === 3 && ecs.castT[e] >= 1.2) {
          m.client.tickInput = () => {};
          m.transport.send({ t: 'cmd', type: 'pause', on: true });
          window.__stormChargeHeld = true;
        }
      };
      m.client.onEvent = (ev) => {
        event(ev);
        if (ev.type !== 'lightning' || ev.kind !== 'mastbolt' || ev.e !== m.client.youServer) return;
        window.__stormLightning = ev;
        m.client.tickInput = () => {};
        m.transport.send({ t: 'cmd', type: 'pause', on: true });
        m.world.stormFx.update = () => fx(0);
      };
      window.__stormRelease = () => { m.client.tickInput = input; m.transport.send({ t: 'cmd', type: 'pause', on: false }); };
      window.__stormRestore = () => { m.client.tickInput = input; m.client.onEvent = event; m.world.stormFx.update = fx; m.transport.send({ t: 'cmd', type: 'pause', on: false }); };
    });
    if (!phone) {
      const cursor = await page.evaluate(async () => {
        const { Vector3 } = await import('three'), m = window.__mn;
        const v = new Vector3(m.ps.x + 4, m.ps.y, m.ps.z).project(m.world.camera);
        return { x: (v.x + 1) * innerWidth / 2, y: (1 - v.y) * innerHeight / 2 };
      });
      await page.mouse.move(cursor.x, cursor.y); await page.keyboard.down('KeyG');
    } else {
      const button = await page.locator('.t-g').boundingBox();
      if (!button || button.y < 0 || button.y + button.height > H || !(await page.locator('.t-g').innerText()).includes('RAYO')) throw new Error('Rayo touch control is missing or outside the viewport');
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: button.x + button.width / 2, y: button.y + button.height / 2, id: 1 }] });
      // Drag in the screen direction of +x so the held charge aims at the practice line.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: button.x + button.width / 2 + 28, y: button.y + button.height / 2 + 18, id: 1 }] });
      storeTouch = cdp;
    }
    await page.waitForFunction(() => window.__stormChargeHeld && window.__mn.world.indicators.chargeRing.mesh.visible, null, { timeout: 60000 });
    await shot('62-tormenta-charge');
    await page.evaluate(() => window.__stormRelease());
    if (!phone) await page.keyboard.up('KeyG');
    else await storeTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => window.__stormLightning && window.__mn.world.stormFx.bolts.some((b) => b.mesh.visible), null, { timeout: 60000 });
    await shot('63-tormenta-chain');
    console.log('tormenta', JSON.stringify(await page.evaluate(() => ({ pearl: window.__mn.client.profile.pearls.swallowed.kind,
      elem: window.__mn.ps.elem, lightning: window.__stormLightning, cd: window.__mn.ps.cdG, errors: window.__mn.errors }))));
    await page.evaluate(() => window.__stormRestore());
  }
  if (s === 'escarcha') {
    await tp('50-escarcha-before', L.spawn.x, L.spawn.z);
    await dev({ op: 'pearl', kind: 'escarcha' });
    await page.waitForFunction(() => window.__mn.client.profile?.pearls?.bag.some((q) => q.kind === 'escarcha'));
    await page.keyboard.press('KeyP');
    await page.locator('[data-pearl-op="swallow"]').first().click();
    await page.waitForFunction(() => window.__mn.client.profile?.pearls?.swallowed?.kind === 'escarcha');
    await shot('51-escarcha-panel');
    await page.keyboard.press('Escape');
    try {
      await page.waitForFunction(() => window.__mn.ps.cdG <= 0, null, { timeout: 60000 });
    } catch (err) {
      console.error('Escarcha cooldown stalled', await page.evaluate(() => ({ st: window.__mn.st,
        cd: window.__mn.ps.cdG, panel: window.__mn.panels.charPanel.isOpen,
        tick: window.__mn.client.pred.tick, errors: window.__mn.errors })), [...logs]);
      await browser.close(); server.close(); throw err;
    }
    // Capture a real authoritative cast on its own timeline. SwiftShader may draw only a few
    // frames during the whole field lifetime; hold the received field before the next render.
    await page.evaluate(() => {
      const m = window.__mn, onEvent = m.client.onEvent.bind(m.client), tickInput = m.client.tickInput.bind(m.client), viewTick = m.client.viewTick.bind(m.client);
      window.__frostHeld = false;
      m.client.onEvent = (ev) => {
        onEvent(ev);
        if (ev.type !== 'frostField' || ev.e !== m.client.youServer) return;
        m.client.tickInput = () => {};
        m.client.viewTick = () => ev.t0 + Math.min(12, (ev.tEnd - ev.t0) / 2);
        m.transport.send({ t: 'cmd', type: 'pause', on: true });
        window.__frostHeld = true;
      };
      window.__frostRestore = () => {
        m.client.onEvent = onEvent; m.client.tickInput = tickInput; m.client.viewTick = viewTick;
        m.transport.send({ t: 'cmd', type: 'pause', on: false });
      };
    });
    if (!phone) {
      await page.mouse.move(W * 0.64, H * 0.51);
      await page.keyboard.down('KeyG');
      await page.waitForFunction(() => window.__mn.aimCtl.preview?.slot === 'g' && window.__mn.world.indicators.marker.mesh.visible);
      await shot('52-escarcha-aim');
      await page.keyboard.press('Escape'); await page.keyboard.up('KeyG');
      await page.waitForFunction(() => !window.__mn.aimCtl.preview && !window.__mn.world.indicators.marker.mesh.visible);
      const canceled = await page.evaluate(() => ({ cd: window.__mn.ps.cdG, fields: window.__mn.client.hazards.frostFields.length }));
      if (canceled.cd > 0 || canceled.fields) throw new Error('Cancelling Ancla spent its cooldown or created a field');
      await page.keyboard.down('KeyG');
      await page.waitForFunction(() => window.__mn.aimCtl.preview?.slot === 'g' && window.__mn.world.indicators.marker.mesh.visible);
      await page.keyboard.up('KeyG');
    } else {
      const button = await page.locator('.t-g').boundingBox();
      if (!button || button.y < 0 || button.y + button.height > H) throw new Error('Ancla touch button is outside the viewport');
      if (!(await page.locator('.t-g').innerText()).includes('ANCLA')) throw new Error('Touch G still names another pearl');
      await page.locator('.t-g').tap();
    }
    try {
      await page.waitForFunction(() => {
        const m = window.__mn, t = m.client.viewTick(m.loop.alpha);
        return window.__frostHeld && m.client.hazards.frostFields.some((f) => !f.predicted && t >= f.t0 && t < f.tEnd)
          && m.world.frostFx.slots.some((s) => s.live && s.disk.visible);
      }, null, { timeout: 60000 });
    } catch (err) {
      console.error('Escarcha cast stalled', await page.evaluate(() => ({ st: window.__mn.st,
        cd: window.__mn.ps.cdG, skill: window.__mn.ps.skG, preview: window.__mn.aimCtl.preview,
        input: window.__mn.input.slots, fields: window.__mn.client.hazards.frostFields,
        pt: window.__mn.client.ptCur, errors: window.__mn.errors })), [...logs]);
      await browser.close(); server.close(); throw err;
    }
    await wait(800); await shot('53-escarcha-field');
    console.log('escarcha', JSON.stringify(await page.evaluate(() => ({ pearl: window.__mn.client.profile.pearls.swallowed.kind, elem: window.__mn.ps.elem,
      fields: window.__mn.client.hazards.frostFields, pt: window.__mn.client.viewTick(window.__mn.loop.alpha),
      visible: window.__mn.world.frostFx.slots.filter((s) => s.live && s.disk.visible).length,
      cd: window.__mn.ps.cdG, errors: window.__mn.errors }))));
    await page.evaluate(() => window.__frostRestore());
  }
  if (s === 'pearl') {
    await tp('40-pearl-before', L.spawn.x, L.spawn.z);
    await dev({ op: 'pearl', kind: 'brasa' });
    await wait(1800); await page.keyboard.press('KeyP'); await wait(1000); await shot('41-pearl-bag');
    if (phone) { await page.locator('[data-pearl-op="swallow"]').scrollIntoViewIfNeeded(); await shot('41b-pearl-actions'); }
    await page.click('[data-pearl-op="swallow"]');
    await page.waitForFunction(() => window.__mn.client.profile?.pearls?.swallowed, null, { timeout: 15000 });
    await shot('42-pearl-swallowed');
    await page.keyboard.press('Escape'); await wait(4700);
    await page.evaluate(() => {
      const m = window.__mn, emit = m.client.bus.emit.bind(m.client.bus), update = m.world.effects.update.bind(m.world.effects);
      window.__pearlRestore = () => { m.client.bus.emit = emit; m.world.effects.update = update; };
      m.client.bus.emit = (type, ev) => {
        emit(type, ev);
        if (type === 'combat' && ev.type === 'cometTrail') {
          // Publish the newly spawned particles once, then hold their age while continuing GPU uploads.
          for (const pool of [m.world.effects.streaks, m.world.effects.alpha, m.world.effects.add])
            for (let i = 0; i < pool.cap; i++) if (pool.alive[i] && pool.life[i] === 0) pool.life[i] = 0.2;
          update(0, m.world.effects.focus);
          m.world.effects.update = (_dt, focus) => update(0, focus);
        }
      };
    });
    if (phone) await page.locator('.t-g').tap();
    else await page.keyboard.press('KeyG');
    await page.waitForFunction(() => window.__mn.ps.cdG > 5, null, { timeout: 15000 });
    await wait(1200); await shot('43-comet');
    await page.evaluate(() => window.__pearlRestore());
    console.log('pearl', JSON.stringify(await page.evaluate(() => ({ profile: window.__mn.client.profile.pearls, skill: window.__mn.ps.skG, cd: window.__mn.ps.cdG, elem: window.__mn.ps.elem, errors: window.__mn.errors }))));
    await page.keyboard.press('KeyP'); await wait(900); await page.click('[data-pearl-op="spit"]');
    await page.waitForFunction(() => !window.__mn.client.profile?.pearls?.swallowed, null, { timeout: 15000 });
    await page.keyboard.press('Escape'); await wait(1200); await shot('44-pearl-ground');
    // Test the replacement confirmation through the actual panel, including an unchanged UID after cancel.
    await dev({ op: 'pearl', kind: 'brasa' }); await dev({ op: 'pearl', kind: 'brasa' });
    await wait(1800); await page.keyboard.press('KeyP'); await wait(800);
    await page.locator('[data-pearl-op="swallow"]').first().click(); await wait(1800);
    const before = await page.evaluate(() => window.__mn.client.profile.pearls.swallowed.uid);
    await page.locator('[data-pearl-op="swallow"]').first().click(); await wait(600); await shot('45-pearl-confirm');
    const confirmation = await page.locator('.pearl-confirm').boundingBox();
    if (!confirmation || confirmation.y < 0 || confirmation.y + confirmation.height > H) throw new Error('Replacement warning is outside the viewport');
    await page.click('[data-pearl-op="cancel"]');
    const after = await page.evaluate(() => window.__mn.client.profile.pearls.swallowed.uid);
    if (before !== after) throw new Error('Cancelling changed the swallowed pearl');
    await page.keyboard.press('Escape');
  }
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
  if (s === 'lineup' || s === 'lineup-run') {
    // LOOKS (comma list of look indices; default the first eight) in a row, imported models and procedural alike.
    const looks = (process.env.LOOKS || '0,1,2,3,4,5,6,7').split(',').map(Number);
    await tp(s === 'lineup' ? '12-lineup-ref' : '13-lineup-run-ref', L.spawn.x, L.spawn.z, null, 2500);
    console.log(JSON.stringify(await page.evaluate(([k, run]) => window.__mn.lineup(k, { run }), [looks, s === 'lineup' ? 0 : 0.8])));
    await wait(4000); await shot(s === 'lineup' ? '12-lineup' : '13-lineup-run');
    await page.evaluate(() => window.__mn.lineup());
  }
  if (s === 'tattoo') {
    // M4.7 P4: the tattoos. The real flow (keys → aim controller → sim events → VFX) is counted; the timed effects are
    // then frozen in place so the slow software renderer can show them.
    await tp('20-tattoo-ref', L.arena.x + 6, L.arena.z + 6, null, 3500);
    await dev({ op: 'tattoos', rank: 5 });
    await dev({ op: 'tattoo', id: 'tromba', rank: 3, form: 1 });
    await dev({ op: 'loadout', slot: 'q', id: 'tromba' });
    await dev({ op: 'loadout', slot: 'e', id: 'leap' });
    await dev({ op: 'spawn', kind: 'grunt', ang: 0.6, dist: 6 });
    await dev({ op: 'spawn', kind: 'sentinel', ang: 0.9, dist: 6.5 });
    await wait(1500);
    await page.evaluate(() => {
      const m = window.__mn, F = m.world.skillFx, I = m.world.indicators;
      m.fxCount = {};
      for (const [o, ks] of [[F, ['spout', 'vortex', 'leap', 'slam', 'wheel', 'wheelBack', 'wheelEnd', 'charging']], [I, ['tromba', 'area', 'charge']]]) {
        for (const k of ks) { const f = o[k].bind(o); o[k] = (...a) => { m.fxCount[k] = (m.fxCount[k] || 0) + 1; return f(...a); }; }
      }
    });
    // (a) Tromba aimed (Q held): range ring and marker, the HUD slots with their rank and form.
    await page.mouse.move(W / 2 + 150, H / 2 - 40); await wait(400);
    const probe = (tag) => page.evaluate((tag) => { const m = window.__mn; return tag + ' ' + JSON.stringify({ pv: m.aimCtl.preview, held: m.input.slotHeld('q'), q: m.slotD.q.id, kq: m.slotD.q.kind, cdQ: +m.ps.cdQ.toFixed(2), castK: m.ps.castK, chg: m.ps.chg, act: m.ps.act, fps: +m.st.fps.toFixed(1) }); }, tag).then(console.log);
    await page.keyboard.down('KeyQ'); await wait(1600); await probe('held'); await shot('21-tromba-aim');
    await page.keyboard.up('KeyQ'); await wait(400); await probe('released'); await wait(2100);
    // (c) Abordaje aimed: its landing marker and arc.
    await page.mouse.move(W / 2 - 160, H / 2 + 30); await wait(400);
    await page.keyboard.down('KeyE'); await wait(1600); await shot('22-leap-aim');
    await page.keyboard.up('KeyE'); await wait(3000);
    // (d) Timón: charging (the arrow and the ring), then thrown.
    await dev({ op: 'loadout', slot: 'q', id: 'wheel' });
    await wait(16000); // the Tromba's cooldown (the software renderer runs the game slower than the clock)
    await page.mouse.move(W / 2 + 170, H / 2 + 10); await wait(300);
    await probe('before-wheel');
    await page.keyboard.down('KeyQ'); await wait(1800); await probe('wheel-held'); await shot('23-wheel-charge');
    await page.keyboard.up('KeyQ'); await wait(300);
    await page.evaluate(() => { window.__mn.world.skillFx.freeze = true; });
    await wait(1200); await shot('24-wheel-out');
    console.log('wheel', JSON.stringify(await page.evaluate(() => window.__mn.world.skillFx.wheels.filter((w) => w.m.visible).map((w) => ({ ph: w.ph, x: +w.m.position.x.toFixed(1), z: +w.m.position.z.toFixed(1), s: +w.m.scale.x.toFixed(2) })))));
    await page.evaluate(() => { window.__mn.world.skillFx.freeze = false; });
    await wait(3000);
    console.log('fx calls', JSON.stringify(await page.evaluate(() => window.__mn.fxCount)));
    // (b) Frozen: a spout on the two enemies, a whirlpool, a slam ring, a wheel in flight, a Tromba warning.
    await page.evaluate(() => {
      const m = window.__mn, W2 = m.world, F = W2.skillFx, I = W2.indicators, ps = m.ps;
      const x = ps.x + 3.5, z = ps.z - 2.5;
      F.spout(x, z, 3.0); F.vortex(99, x, z, 3.0, 1e9);
      F.spouts.forEach((q) => { if (q.t >= 0) q.t = 0.2; });
      F.vortices.forEach((q) => { if (q.live) q.t = 1; });
      F.wheel({ e: -5, id: 1, x: ps.x - 1, z: ps.z + 1, dx: -0.7, dz: 0.7, v0: 13, R: 12, r: 0.8, hang: 0, tick: m.client.viewTick(0) - 20, form: 0 });
      I.tromba(777, ps.x - 4, ps.z - 3, 2.4, m.client.viewTick(0) - 10, m.client.viewTick(0) + 20, false);
      I.freeze = true; I.freezeTick = m.client.viewTick(0) + 5;
      F.freeze = true; F.frozenTick = m.client.viewTick(0);
      F.spouts.forEach((q) => { if (q.t >= 0) q.t = 0.2; });
    });
    await wait(2500); await shot('25-spout-frozen');
    console.log('wheels', JSON.stringify(await page.evaluate(() => window.__mn.world.skillFx.wheels.map((w) => ({ v: w.m.visible, ph: w.ph, hand: w.hand, ev: !!w.ev, x: +w.m.position.x.toFixed(1), y: +w.m.position.y.toFixed(1), z: +w.m.position.z.toFixed(1), s: +w.m.scale.x.toFixed(2) })))), JSON.stringify(await page.evaluate(() => ({ x: window.__mn.ps.x, z: window.__mn.ps.z }))));
    await page.evaluate(() => { const m = window.__mn; m.world.skillFx.freeze = false; m.world.indicators.freeze = false; });
  }
  if (s === 'sepia') {
    // M4.7 P5: Doña Sepia, her stall, her dialog and the Tatuajes tab (learning at her stall).
    const n = await page.evaluate(() => { const d = window.__mn.map.npcs.find((q) => q.id === 'tattoo'); return { x: d.x, z: d.z, f: d.facing }; });
    await page.mouse.move(W / 2, H / 2); await page.mouse.wheel(0, -400); await wait(1500);
    await tp('30-sepia', n.x + Math.sin(n.f) * 3, n.z + Math.cos(n.f) * 3, null, 4000);
    await page.mouse.wheel(0, 400); await wait(800);
    await page.keyboard.press('KeyF'); await wait(1800); await shot('31-sepia-dialog');
    const tat = await page.$('[data-tattoo]');
    if (tat) await tat.click({ force: true });
    else await page.evaluate(() => window.__mn.panels.charPanel.open('tattoo', { learn: true }));
    await wait(1500); await shot('32-tattoo-tab');
    const learn = await page.$('[data-tt="tromba"]');
    if (learn) { await learn.click({ force: true }); await wait(600); const b = await page.$('[data-learn]'); if (b) await b.click({ force: true }); await wait(1500); }
    const put = await page.$('[data-put="q"]');
    if (put) { await put.click({ force: true }); await wait(1500); }
    await shot('33-tattoo-learned');
    await page.keyboard.press('Escape'); await wait(600);
  }
  if (s === 'pause') {
    await page.keyboard.press('Escape'); await wait(1200); await shot('09-pause');
    await page.keyboard.press('Escape'); await wait(600);
  }
}
if (process.env.PERF) console.log(await page.evaluate(() => document.querySelector('#perf')?.textContent));
console.log([...logs].join('\n') || '(clean)');
} catch (err) {
  console.error('Look check failed:', [...logs].join('\n'), await page.evaluate(() => ({
    state: window.__mn?.st, errors: window.__mn?.errors, marks: window.__mn?.client.pred.inkMarks,
    elem: window.__mn?.ps.elem, facing: window.__mn?.ps.f, cast: window.__mn?.ps.castK,
  })).catch(() => null));
  throw err;
} finally {
  await browser.close(); server.close();
}
