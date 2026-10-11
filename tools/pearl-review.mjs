// P5 review: synthetic FX gallery or two real browser clients on a disposable local WebSocket authority.
// MODE=gallery|online|artifact, MN_RELEASE=<release folder>, PHONE=1, Q=high|low, OUT.
// Set MN_PLAYWRIGHT/MN_BROWSER/MN_BROWSER_PEER/MN_THREE/MN_GSAP for locally installed browser/libraries.
// Gallery frames deliberately hold effects; neither mode certifies hardware FPS or physical controls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';

const { chromium } = await import(process.env.MN_PLAYWRIGHT ? pathToFileURL(process.env.MN_PLAYWRIGHT).href : 'playwright');
const out = process.env.OUT || 'shots/review/p5-online';
fs.mkdirSync(out, { recursive: true });
const gallery = process.env.MODE === 'gallery', artifact = process.env.MODE === 'artifact', phone = process.env.PHONE === '1';
const release = artifact ? path.resolve(process.env.MN_RELEASE || '') : undefined;
const gs = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: true, maxPlayers: 2, lagMs: gallery ? 0 : 25, log: () => {}, ...(release ? { root: release } : {}) });
const browsers = [], pages = [], logs = [];
const stopAuthority = () => { clearInterval(gs.game.timer); gs.game.timer = null; };
const shot = async (page, name) => { await page.screenshot({ path: path.join(out, name + '.png'), timeout: 60000 }); console.log('shot', name); };
const dev = (page, op) => page.evaluate((op) => window.__mn.client.send({ t: 'cmd', type: 'dev', ...op }), op);
const until = async (predicate, message, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error(message);
};

try {
  const port = await gs.listen();
  for (let i = 0; i < (gallery || artifact ? 1 : 2); i++) {
    const executablePath = i ? process.env.MN_BROWSER_PEER : process.env.MN_BROWSER;
    assert.ok(executablePath, 'Set both browser executable paths for online review');
    const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    browsers.push(browser);
    const context = await browser.newContext({ viewport: phone ? { width: 844, height: 390 } : { width: 1280, height: 720 }, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
    await context.addInitScript(() => {
      window.__reviewPad = { connected: false, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { value: () => window.__reviewPad.connected ? [window.__reviewPad] : [] });
    });
    await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, (route) => {
      const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
      const dir = match[1].startsWith('three') ? process.env.MN_THREE : process.env.MN_GSAP;
      assert.ok(dir, 'Set local module directories');
      const file = path.join(dir, match[2]);
      return route.fulfill({ status: fs.existsSync(file) ? 200 : 404, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.existsSync(file) ? fs.readFileSync(file) : '' });
    });
    await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', (error) => logs.push(`client${i}: ${error.message}`));
    page.on('console', (message) => {
      // Blocked optional fonts are expected; shader/compiler errors are acceptance failures.
      if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED')) logs.push(`client${i} console: ${message.text()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/?debug&q=${process.env.Q || (gallery ? 'high' : 'low')}&maxdt=0.5&tod=day`);
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
    await page.locator('#title-name').fill(i ? 'P5 Edge' : 'P5 Chrome');
    await page.locator('#btn-play').click();
    await page.waitForFunction(() => window.__mn?.client.youServer && window.__mn.st.mode === 'playing', null, { timeout: 90000 });
    await page.waitForFunction(() => !window.__mn.world.rig.blend, null, { timeout: 90000 });
    await dev(page, { op: 'god', on: true });
  }
  const audioMetrics = await pages[0].evaluate(async () => {
    const { audio } = await import('./src/audio/engine.js');
    const { sfx } = await import('./src/audio/sfx.js');
    const metrics = [];
    for (let elem = 0; elem <= 4; elem++) {
      const offline = new OfflineAudioContext(1, 24000, 48000);
      const dest = offline.createGain(); dest.connect(offline.destination);
      const saved = { ctx: audio.ctx, sfx: audio.sfx, ready: audio.ready };
      // Restore synchronously before rendering so live game callbacks retain their real context.
      try { Object.assign(audio, { ctx: offline, sfx: dest, ready: true }); sfx.elemental(elem, 1); }
      finally { Object.assign(audio, saved); }
      const data = (await offline.startRendering()).getChannelData(0);
      let peak = 0, energy = 0;
      for (const sample of data) { peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; }
      metrics.push({ elem, peak, rms: Math.sqrt(energy / data.length), finite: data.every(Number.isFinite) });
    }
    return metrics;
  });
  assert.equal(audioMetrics[0].peak, 0);
  for (const m of audioMetrics.slice(1)) assert.ok(m.finite && m.peak > 0 && m.peak < 0.2, JSON.stringify(m));
  console.log('elemental audio (isolated layer, not a listening acceptance)', JSON.stringify(audioMetrics));
  if (artifact) {
    const expected = JSON.parse(fs.readFileSync(path.join(release, 'release.json'), 'utf8'));
    const observed = await pages[0].evaluate(async () => {
      const { GAME } = await import('./src/data/meta.js');
      const { PROTOCOL_VERSION } = await import('./src/net/protocol.js');
      return { version: GAME.version, protocol: PROTOCOL_VERSION, playing: window.__mn.st.mode, online: window.__mn.st.online, player: window.__mn.client.youServer };
    });
    assert.equal(observed.version, expected.version); assert.equal(observed.protocol, expected.protocolVersion);
    assert.equal(observed.playing, 'playing'); assert.equal(!!observed.online, false, 'artifact should boot its solo Web Worker');
    assert.ok(observed.player); await shot(pages[0], '95-artifact-solo');
    console.log('artifact worker smoke', JSON.stringify({ sourceSha: expected.sourceSha, ...observed }));
  } else if (gallery) {
    stopAuthority();
    const page = pages[0];
    await page.evaluate(() => {
      const m = window.__mn; m.client.tickInput = () => {}; m.st.tut = 'done'; m.world.effects.update = () => {};
      document.querySelector('.tracker').style.display = 'none';
    });
    for (const [elem, name] of [[0, 'neutral'], [1, 'brasa'], [2, 'escarcha'], [3, 'tormenta'], [4, 'tinta']]) {
      const state = await page.evaluate(async (elem) => {
        const m = window.__mn, W = m.world, F = W.skillFx, E = W.effects;
        const { elementVisual } = await import('./src/data/elements.js');
        const { SHOT, PTYPE } = await import('./src/sim/projectiles.js');
        const palette = elementVisual(elem), x = m.ps.x, z = m.ps.z, tick = m.client.viewTick(0);
        for (const s of F.spouts) { s.t = -1; s.m.visible = false; }
        for (const v of F.vortices) { v.live = false; v.m.visible = false; }
        for (const w of F.wheels) F.endWheel(w, false);
        for (const rain of W.weaponFx.rains) { rain.ring.active = false; rain.ring.mesh.visible = false; }
        W.weaponFx.rains.length = 0;
        for (const q of W.weaponFx.crescents) { q.ev = null; q.m.visible = false; }
        for (let i = 0; i < m.client.shots.cap; i++) if (m.client.shots.id[i]) m.client.shots.free(i);
        E.alpha.update(100); E.add.update(100); E.streaks.update(100);
        F.spout(x + 3.5, z - 2.5, 2.2, false, elem); F.vortex(999, x + 3.5, z - 2.5, 2.2, 100, elem);
        F.spouts.filter((s) => s.t >= 0).forEach((s) => { s.t = 0.2; });
        F.vortices.filter((v) => v.live).forEach((v) => { v.t = 1; });
        F.wheel({ e: -5, elem, id: 1, x: x - 2.8, z: z - 0.5, dx: 0, dz: 1, v0: 13, R: 12, r: 0.8, tick: tick - 1, hang: 0, form: 0 });
        F.freeze = true; F.frozenTick = tick; F.update(0, tick);
        W.weaponFx.rain({ e: -5, elem, id: 2, x: x - 3.2, z: z - 4.5, r: 1.5, tick: tick - 1, dur: 100 }, palette?.accent ?? 0x3bf0ff);
        W.weaponFx.wave({ e: -5, elem, id: 3, x: x + 1.5, z: z + 1.5, dx: 1, dz: 0, speed: 0, tick: tick - 1, end: tick + 10000, w: 0.9 }, palette?.accent ?? 0x3bf0ff);
        W.weaponFx.update(0.07, tick, null);
        m.client.spawnLocalShot(-5, { server: true, elem, kind: SHOT.BULLET, type: PTYPE.PARRY, x: x - 1.2, y: m.ps.y + 1.1, z: z - 2, dx: 1, dz: 0, speed: 0, life: 100, dmg: 1, r: 0.1 });
        E.alpha.update(0.06); E.add.update(0.06); E.streaks.update(0.06);
        m.client.stepShots = () => {};
        const normalUpdate = W.weaponFx.update.bind(W.weaponFx);
        if (!window.__weaponUpdate) window.__weaponUpdate = normalUpdate;
        W.weaponFx.update = () => {};
        // A fixed palette frame, not a simulated cast or timing/performance measurement.
        return { elem, accent: palette?.accent, spouts: F.spouts.filter((s) => s.t >= 0).length, wheels: F.wheels.filter((w) => w.ev).length, shots: m.client.shots.count };
      }, elem);
      await page.waitForTimeout(300); await shot(page, `80-${name}-kit`); console.log('gallery', JSON.stringify(state));
      await page.evaluate(() => { window.__mn.world.weaponFx.update = window.__weaponUpdate; });
    }
  } else {
    const [a, b] = pages;
    const ids = await Promise.all(pages.map((p) => p.evaluate(() => window.__mn.client.youServer)));
    assert.equal(new Set(ids).size, 2);
    await Promise.all(pages.map((p, i) => p.waitForFunction((peer) => window.__mn.client.entities.has(peer), ids[1 - i])));
    for (const [i, kind] of ['tinta', 'brasa'].entries()) {
      const page = pages[i], e = ids[i], w = gs.game.server.world;
      w.ecs.regenT[e] = 99;
      await dev(page, { op: 'pearl', kind });
      await page.waitForFunction((kind) => window.__mn.client.profile.pearls.bag.some((p) => p.kind === kind), kind);
      await page.evaluate((kind) => { const m = window.__mn, p = m.client.profile.pearls.bag.find((p) => p.kind === kind); m.client.send({ t: 'cmd', type: 'pearl', op: 'swallow', uid: p.uid }); }, kind);
      await page.waitForFunction((kind) => window.__mn.client.profile.pearls.swallowed?.kind === kind && window.__mn.ps.cdG <= 0, kind, { timeout: 60000 });
      await page.evaluate(() => {
        const m = window.__mn, onEvent = m.client.onEvent.bind(m.client);
        window.__peerEvents = [];
        window.__impacts = [];
        m.client.bus.on('combat', (ev) => { if (ev.type === 'shotImpact') window.__impacts.push({ e: ev.e, elem: ev.elem }); });
        m.client.onEvent = (ev) => { window.__peerEvents.push({ type: ev.type, e: ev.e ?? ev.owner, elem: ev.elem }); onEvent(ev); };
      });
    }
    await dev(b, { op: 'weapon', weapon: 1 });
    await b.waitForFunction(() => window.__mn.ps.weapon === 1);
    console.log('online stage: both pearls swallowed, peer pistol equipped');
    await b.mouse.move(640, 300); await b.keyboard.down('KeyJ');
    try {
      await a.waitForFunction((peer) => window.__peerEvents.some((ev) => ev.type === 'shot' && ev.e === peer && ev.elem === 1), ids[1]);
    } finally { await b.keyboard.up('KeyJ'); }
    await a.waitForFunction((peer) => window.__impacts.some((ev) => ev.e === peer && ev.elem === 1), ids[1], { timeout: 60000 });
    console.log('online stage: peer launch and deferred impact verified');
    await a.evaluate(() => { const p = window.__reviewPad; p.connected = true; p.axes[2] = 0.7; p.buttons[13] = { pressed: true, value: 1 }; });
    await a.waitForFunction(() => window.__mn.aimCtl.preview?.slot === 'g');
    await a.evaluate(() => { window.__reviewPad.buttons[1] = { pressed: true, value: 1 }; });
    await a.waitForFunction(() => !window.__mn.aimCtl.preview);
    await a.evaluate(() => { const p = window.__reviewPad; p.connected = false; p.buttons[13] = p.buttons[1] = { pressed: false, value: 0 }; });
    // Let the pad release edge finish its fixed tick before pressing the same slot on the keyboard.
    await a.waitForFunction(() => {
      const input = window.__mn.input;
      return !input.pad.active && !input.slotSrc.pad.g && !input.slots.up.g;
    });
    assert.equal(await a.evaluate(() => window.__mn.ps.cdG), 0, 'pad cancellation spent cooldown');
    assert.equal(gs.game.server.world.inkClouds.length, 0);
    console.log('online stage: emulated pad cancellation verified');
    await a.mouse.move(640, 390); await a.keyboard.down('KeyG');
    await a.waitForFunction(() => window.__mn.aimCtl.preview?.slot === 'g');
    await a.keyboard.up('KeyG');
    await until(() => gs.game.server.world.inkClouds.some((f) => f.e === ids[0]), 'The keyboard G was not accepted');
    stopAuthority();
    const field = gs.game.server.world.inkClouds.find((f) => f.e === ids[0]);
    gs.game.server.broadcastSnapshot();
    for (const page of pages) {
      await page.waitForFunction((e) => window.__mn.client.pred.inkClouds.some((f) => f.e === e && !f.predicted), ids[0]);
      await page.evaluate((tick) => { const m = window.__mn; m.client.tickInput = () => {}; m.client.viewTick = () => tick; }, field.t0 + 20);
      await page.waitForFunction(() => window.__mn.world.inkFx.clouds.some((f) => f.live));
    }
    await shot(a, '90-chrome-cloud'); await shot(b, '91-edge-cloud');
    const checkHud = async (page) => {
      const bounds = await page.evaluate(() => {
        const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
        return { clock: box('.world-clock'), party: box('.party'), toasts: box('#toasts') };
      });
      assert.ok(bounds.party.top >= bounds.clock.bottom, JSON.stringify(bounds));
      assert.ok(bounds.toasts.top >= bounds.party.bottom, JSON.stringify(bounds));
      return bounds;
    };
    const hudDesktop = await Promise.all(pages.map(checkHud));
    const hudSmall = [];
    for (const [i, page] of pages.entries()) {
      await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(300);
      hudSmall.push(await checkHud(page)); await shot(page, `9${i + 2}-small-online`);
    }
    const observed = await Promise.all(pages.map((page, i) => page.evaluate((peer) => ({ own: window.__mn.ps.elem, peer: window.__mn.client.entities.get(peer)?.r.elem, cloud: window.__mn.client.pred.inkClouds.filter((f) => !f.predicted).length, errors: window.__mn.errors }), ids[1 - i])));
    assert.deepEqual(observed.map((p) => [p.own, p.peer, p.cloud]), [[4, 1, 1], [1, 4, 1]]);
    console.log('online', JSON.stringify({ players: ids, browsers: ['Chrome', 'Edge'], pad: 'emulated G aim + B cancellation', keyboard: 'G cloud accepted', peerShot: 'Brasa pistol packet and deferred impact observed in Chrome', observed, hudDesktop, hudSmall, authorityErrors: gs.game.errors }));
  }
  assert.equal(logs.length, 0, logs.join('\n'));
  assert.equal(gs.game.errors, 0);
  for (const page of pages) assert.deepEqual(await page.evaluate(() => window.__mn.errors), {});
  console.log('review passed; software rendering only');
} catch (error) {
  console.error('Review failed:', error.stack, logs);
  for (let i = 0; i < pages.length; i++) console.log('failed state', i, await pages[i].evaluate(() => {
    const m = window.__mn;
    return { you: m?.client.youServer, weapon: m?.ps.weapon, elem: m?.ps.elem, act: m?.ps.act, mode: m?.st.mode,
      input: m?.input.enabled, focused: document.activeElement?.tagName, preview: m?.aimCtl.preview,
      peerEvents: window.__peerEvents?.slice(-12), impacts: window.__impacts?.slice(-12), errors: m?.errors };
  }).catch(() => null));
  for (let i = 0; i < pages.length; i++) await shot(pages[i], `failed-${i}`).catch(() => {});
  process.exitCode = 1;
} finally {
  for (const browser of browsers) { console.log('cleanup browser'); await browser.close(); }
  console.log('cleanup authority');
  await gs.close();
  console.log('review closed');
}
