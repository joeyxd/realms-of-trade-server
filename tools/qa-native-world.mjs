#!/usr/bin/env node
// Native Niagara effects in the game world (T-1024-38): the real client in solo mode (SoloWorker, local static server),
// presentation bindings set through window.__mn.world.nativeFx. Proves: (a) no bindings = no native instances and the
// procedural fires as before; (b) campfire + brazier bound = loop instances near the fires and no procedural flame or smoke
// for the bound kinds, with frame time and draw calls; (c) meleeHit and damageHit bursts rise and return to 0; (d) live
// rebind and unbind without leaks; (e) no console errors. Samples per rendered frame, not by wall clock (SwiftShader
// freezes during screenshots). Output (JSON + screenshots) under MN_QA_OUT, outside git.
import fs from 'node:fs';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.env.MN_QA_ALLOW_BROWSER !== '1') throw new Error('Set MN_QA_ALLOW_BROWSER=1 to launch this local browser harness.');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(repo, process.env.MN_QA_OUT || '.scratch/qa-native-world/run');
if (fs.existsSync(out)) throw new Error(`QA run already exists: ${out}`);
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || resolve(repo, '../visual-revamp/node_modules/playwright/index.mjs'))).href);
const threeRoot = resolve(repo, 'node_modules/three');
const gsapRoot = resolve(process.env.MN_GSAP || resolve(repo, '../gm-editor-first/.scratch/gsap-local/package'));
const FLAME = 'niagara-985a431dc6c0d1ca', HIT = 'niagara-97a82bae61b29237';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };
const check = (value, message) => { if (!value) throw new Error(message); };
const summary = { ticket: 'T-1025-33', at: new Date().toISOString(), mode: 'solo', quality: 'high', viewport: [1280, 720], steps: {}, screenshots: [], consoleErrors: [], status: 'running' };

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  const file = resolve(repo, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(repo + sep) || pathname.includes('/.env') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ ...(process.env.MN_BROWSER ? { executablePath: resolve(process.env.MN_BROWSER) } : { channel: 'chrome' }),
  headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
let page;
const shot = async (label) => { const file = `${label}.jpg`; await page.screenshot({ path: resolve(out, file), type: 'jpeg', quality: 88 }); summary.screenshots.push(file); };
// Frames rendered since the sampler started; waits by frames, not wall clock.
const frames = (n) => page.evaluate(n => new Promise(done => { const q = window.__qa, until = q.frame + n; q.waiters.push([until, done]); }), n);
const window_ = (n) => page.evaluate(async n => {
  const q = window.__qa; q.window = { frames: 0, updateMs: 0, renderMs: 0, calls: 0, native: 0, maxInstances: 0 };
  const spawns = { ...window.__mn.world.effects.fireSpawns };
  await new Promise(done => q.waiters.push([q.frame + n, done]));
  const w = q.window, now = window.__mn.world.effects.fireSpawns; q.window = null;
  return { frames: w.frames, updateMs: +(w.updateMs / w.frames).toFixed(3), renderMs: +(w.renderMs / w.frames).toFixed(3),
    frameMs: +((w.updateMs + w.renderMs) / w.frames).toFixed(3), drawCalls: +(w.calls / w.frames).toFixed(1), nativeDrawCalls: +(w.native / w.frames).toFixed(2),
    maxInstances: w.maxInstances, proceduralSpawns: { campfire: now.campfire - spawns.campfire, brazier: now.brazier - spawns.brazier } };
}, n);
const fxState = () => page.evaluate(() => { const fx = window.__mn.world.nativeFx, m = fx.metrics, bySlot = {};
  for (const list of fx.loops.values()) bySlot[list[0].slot] = (bySlot[list[0].slot] || 0) + list.length;
  let meshes = 0; window.__mn.world.scene.traverse(o => { if (o.geometry?.attributes?.particleFrame) meshes++; });
  const mem = window.__mn.world.renderer.info.memory;
  return { ...m, player: [+window.__mn.ps.x.toFixed(1), +window.__mn.ps.z.toFixed(1)], hp: window.__mn.ps.hp, loopsBySlot: bySlot, nativeMeshes: meshes, gpu: { geometries: mem.geometries, textures: mem.textures },
    loopReady: { campfire: fx.loopReady('campfire'), brazier: fx.loopReady('brazier') } }; });
const binding = (effect, parameters) => ({ effect, parameters: { seed: 6371, scale: 1, height: 1, duration: 1, speed: 1, brightness: 1, opacity: 1, tint: '#ffffff', ...parameters } });
const setBindings = (bindings) => page.evaluate(b => window.__mn.world.nativeFx.setBindings(b && { schema: 'marea.presentation-bindings', version: 1, bindings: b }), bindings);

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.on('pageerror', error => summary.consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') summary.consoleErrors.push(message.text()); });
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? threeRoot : gsapRoot, match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, headers: { 'content-type': mime[extname(file)] || 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => route.fulfill({ status: 200, body: '' }));
  await page.goto(`${base}/?solo&q=high&tod=day&debug`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__mn && document.querySelector('#btn-play') && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
  await page.locator('#btn-play').click({ force: true });
  // The character picker intercepts Play on a fresh browser: create one and play with it (as qa-touch-layout.mjs).
  if (await page.getByRole('button', { name: /Crear personaje/ }).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) {
    await page.getByRole('button', { name: /Crear personaje/ }).first().click({ force: true });
    await page.getByRole('button', { name: /Crear y continuar/ }).first().click({ force: true });
    const go = page.getByRole('button', { name: /Jugar con este personaje/ }).first();
    await go.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /Jugar con este personaje/.test(b.textContent) && !b.disabled), null, { timeout: 30000 });
    await go.click({ force: true });
  }
  await page.waitForFunction(() => window.__mn?.st.mode === 'playing' && window.__mn.world.nativeFx, null, { timeout: 120000 });
  // Per-frame sampler around the scene's update and render (draw calls: renderer.info is reset at the start of each render).
  await page.evaluate(() => {
    const world = window.__mn.world, q = window.__qa = { frame: 0, waiters: [], window: null };
    const update = world.update.bind(world), render = world.render.bind(world);
    world.update = (...args) => { const t = performance.now(); update(...args); if (q.window) q.window.updateMs += performance.now() - t; };
    world.render = (...args) => {
      const t = performance.now(); render(...args);
      if (q.window) { const w = q.window; w.renderMs += performance.now() - t; w.calls += world.renderer.info.render.calls; w.frames++;
        w.native += world.nativeFx.drawCalls; w.maxInstances = Math.max(w.maxInstances, world.nativeFx.metrics.instances); }
      q.frame++;
      const due = q.waiters.filter(([until]) => q.frame >= until);
      q.waiters = q.waiters.filter(([until]) => q.frame < until); due.forEach(([, done]) => done());
    };
  });
  // The campfire with the nearest brazier or gate torch: both kinds load within the 60 m loop radius.
  const target = await page.evaluate(() => {
    // Outside La Cala Calavera: its pirates and mobs would kill the QA character mid-run.
    const map = window.__mn.map, safe = p => !map.lawlessAt?.(p.x, p.z);
    const props = map.props, camps = props.filter(p => p.kind === 'campfire' && safe(p)), braz = props.filter(p => (p.kind === 'brazier' || p.kind === 'gatePost') && safe(p));
    let best = null;
    for (const c of camps) for (const b of braz) { const d = Math.hypot(c.x - b.x, c.z - b.z); if (!best || d < best.d) best = { c, b, d }; }
    return best && { campfire: { x: best.c.x, z: best.c.z }, brazier: { x: best.b.x, z: best.b.z, kind: best.b.kind }, distance: +best.d.toFixed(1) };
  });
  check(target, 'the map has no campfire and brazier pair');
  summary.target = target;
  const stand = { x: target.campfire.x + 2.5, z: target.campfire.z + 3.5 };
  await page.evaluate(({ x, z }) => window.__mn.teleport(x, z), stand);
  await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.ps.x - x, window.__mn.ps.z - z) < 2, stand, { timeout: 30000, polling: 'raf' });
  await frames(30);
  const baseline = await fxState();

  // (a) No bindings.
  await setBindings(null);
  const a = { metrics: await fxState(), window: await window_(120) };
  check(a.metrics.instances === 0 && a.metrics.nativeMeshes === 0, `(a) native instances without bindings: ${JSON.stringify(a.metrics)}`);
  check(a.window.proceduralSpawns.campfire > 0, `(a) the procedural campfire must spawn: ${JSON.stringify(a.window.proceduralSpawns)}`);
  summary.steps.a = a;
  await shot('a-procedural-campfire');

  // (b) Campfire and brazier bound.
  await setBindings({ campfire: binding(FLAME, { count: 1 }), brazier: binding(FLAME, { count: 1 }) });
  await page.waitForFunction(() => window.__mn.world.nativeFx.loopReady('campfire'), null, { timeout: 60000, polling: 'raf' });
  await frames(10);
  const b = { metrics: await fxState(), window: await window_(120) };
  check(Math.hypot(b.metrics.player[0] - stand.x, b.metrics.player[1] - stand.z) < 6, `(b) the player left the campfire: ${b.metrics.player}`);
  check(b.metrics.loopsBySlot.campfire > 0, `(b) no campfire loop: ${JSON.stringify(b.metrics)}`);
  if (target.distance < 55) check(b.metrics.loopsBySlot.brazier > 0, `(b) no brazier loop: ${JSON.stringify(b.metrics)}`);
  check(b.window.proceduralSpawns.campfire === 0 && b.window.proceduralSpawns.brazier === 0, `(b) procedural flame/smoke for bound kinds: ${JSON.stringify(b.window.proceduralSpawns)}`);
  summary.steps.b = b;
  await shot('b-native-campfire');
  // (b2) The brazier slot where its anchor stands (when the pair is farther apart than the loop radius), then back.
  const goTo = async (spot) => {
    await page.evaluate(({ x, z }) => window.__mn.teleport(x, z), spot);
    await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.ps.x - x, window.__mn.ps.z - z) < 2, spot, { timeout: 30000, polling: 'raf' });
    await frames(30);
  };
  if (!(b.metrics.loopsBySlot.brazier > 0)) {
    await goTo({ x: target.brazier.x + 2.5, z: target.brazier.z + 3.5 });
    const b2 = { metrics: await fxState(), window: await window_(120) };
    check(b2.metrics.loopsBySlot.brazier > 0 && b2.window.proceduralSpawns.brazier === 0, `(b2) brazier: ${JSON.stringify({ loops: b2.metrics.loopsBySlot, spawns: b2.window.proceduralSpawns })}`);
    summary.steps.b2 = b2;
    await shot('b2-native-brazier');
    await goTo(stand);
  }

  // (c) Bursts next to the camera focus: chest height, 1.4 m to the player's screen right (clear of the tutorial hint below them).
  const point = await page.evaluate(() => { const { ps, map, world } = window.__mn, c = world.camera.position;
    const d = Math.hypot(c.x - ps.x, c.z - ps.z) || 1, rx = -(c.z - ps.z) / d, rz = (c.x - ps.x) / d;
    return [ps.x + rx * 1.4, map.heightAt(ps.x, ps.z) + 1.1, ps.z + rz * 1.4]; });
  await setBindings({ campfire: binding(FLAME, { count: 1 }), brazier: binding(FLAME, { count: 1 }), meleeHit: binding(HIT, {}), damageHit: binding(HIT, { speed: 1.5 }) });
  await page.waitForFunction(() => window.__mn.world.nativeFx.metrics.effects.every(e => e.state === 'ready'), null, { timeout: 60000, polling: 'raf' });
  const c = {};
  for (const slot of ['meleeHit', 'damageHit']) {
    const started = await page.evaluate(({ slot, p }) => window.__mn.world.nativeFx.burst(slot, p[0], p[1], p[2]), { slot, p: point });
    check(started, `(c) ${slot} did not start`);
    const peak = await page.evaluate(() => new Promise(done => { let max = 0, n = 0; const q = window.__qa, fx = window.__mn.world.nativeFx;
      const tick = () => { max = Math.max(max, fx.metrics.bursts); n++; if (fx.metrics.bursts === 0 && n > 1) done({ peak: max, frames: n }); else q.waiters.push([q.frame + 1, tick]); };
      tick(); }));
    c[slot] = { started, ...peak, after: (await fxState()).bursts };
    check(c[slot].peak > 0 && c[slot].after === 0, `(c) ${slot}: ${JSON.stringify(c[slot])}`);
  }
  summary.steps.c = c;
  // Hit screenshot: a slowed binding (duration 3, speed 0.25 = 5 steps per second) so the burst outlives the capture.
  await setBindings({ campfire: binding(FLAME, { count: 1 }), brazier: binding(FLAME, { count: 1 }), meleeHit: binding(HIT, { duration: 3, speed: 0.25 }) });
  await page.waitForFunction(() => window.__mn.world.nativeFx.metrics.effects.every(e => e.state === 'ready'), null, { timeout: 60000, polling: 'raf' });
  await page.evaluate(p => window.__mn.world.nativeFx.burst('meleeHit', p[0], p[1], p[2]), point);
  // Capture at the Taller's impact frame (+6 steps).
  await page.waitForFunction(() => (window.__mn.world.nativeFx.bursts[0]?.sim.step ?? 99) >= 6, null, { timeout: 60000, polling: 'raf' });
  summary.steps.cShot = { ...await fxState(), hit: await page.evaluate(() => { const fx = window.__mn.world.nativeFx, e = [...fx.entries.values()].find(x => x.effect.recipe === 'basichit-v1');
    return { step: fx.bursts[0]?.sim.step, layers: e.particles.layers.map(m => { const n = m.geometry.instanceCount, s = m.geometry.attributes.particleSize.array, c = m.geometry.attributes.particleColor.array;
      let size = 0, alpha = 0; for (let i = 0; i < n; i++) { size = Math.max(size, s[i * 2]); alpha = Math.max(alpha, c[i * 4 + 3]); } return { n, maxSize: +size.toFixed(2), maxAlpha: +alpha.toFixed(2), blending: m.material.blending }; }) }; }) };
  await shot('c-native-hit');

  // (d) Live rebind with new parameters, then unbind.
  await setBindings({ campfire: binding(FLAME, { count: 4, scale: 1.4, tint: '#88aaff', brightness: 1.5, seed: 100 }), brazier: binding(FLAME, { count: 2, opacity: 0.6 }) });
  await frames(20);
  const rebound = await fxState();
  check(rebound.loopsBySlot.campfire === 4 * (rebound.loopsBySlot.campfire / 4 | 0) && rebound.loopsBySlot.campfire >= 4, `(d) rebind count: ${JSON.stringify(rebound.loopsBySlot)}`);
  await shot('d-rebound-campfire');
  await setBindings(null);
  await frames(20);
  const unbound = await fxState();
  check(unbound.instances === 0 && unbound.resources === 0 && unbound.nativeMeshes === 0, `(d) leak after unbind: ${JSON.stringify(unbound)}`);
  check(!unbound.loopReady.campfire && !unbound.loopReady.brazier, '(d) unbound slots must be procedural');
  const after = await window_(60);
  check(after.proceduralSpawns.campfire > 0, '(d) the procedural campfire is back');
  summary.steps.d = { rebound, unbound, baseline, procedural: after.proceduralSpawns,
    gpuDelta: { geometries: unbound.gpu.geometries - baseline.gpu.geometries, textures: unbound.gpu.textures - baseline.gpu.textures } };

  // (f) Close, identical framing: source HDR vs the original FX fallback, day and night.
  check(await page.evaluate(() => window.__mn.world.pipeline.nativeHalf), 'STOPPED: no half-float render target; fallback remains available');
  await goTo({ x: target.campfire.x + 1, z: target.campfire.z + 2 });
  await page.evaluate(() => {
    const w = window.__mn.world, lighting = w.lighting, set = lighting.setGameplay.bind(lighting);
    lighting.setGameplay = () => set(false); lighting.setGameplay(false);
    w.rig.distTarget = 10;
  });
  const tod = async mode => { await page.evaluate(m => window.__mn.world.lighting.setTimeOfDay(m, 0), mode); await frames(30); };
  await setBindings({ campfire: binding(FLAME, { count: 1 }) });
  await page.waitForFunction(() => window.__mn.world.nativeFx.loopReady('campfire'), null, { timeout: 60000, polling: 'raf' });
  summary.steps.f = {}; summary.steps.g = {};
  for (const mode of ['day', 'night']) {
    await tod(mode);
    for (const hdr of [true, false]) {
      await page.evaluate(v => { window.__mn.world.nativeFx.hdr = v; }, hdr); await frames(2);
      summary.steps.f[`${mode}-${hdr ? 'hdr' : 'fallback'}`] = await fxState();
      await shot(`f-campfire-${mode}-${hdr ? 'hdr' : 'fallback'}`);
    }
    summary.steps.g[mode] = (await fxState()).loopGain;
  }
  check(Math.abs(summary.steps.g.day - 1) < 1e-6 && Math.abs(summary.steps.g.night - 1.6) < 1e-6, `(g) night gain: ${JSON.stringify(summary.steps.g)}`);
  await page.evaluate(() => { window.__mn.world.nativeFx.hdr = true; }); await frames(2);

  // (j) Frozen frame, pre-bloom readback: pick the corner farthest from every live flame, then compare all RGBA bytes.
  summary.steps.j = await page.evaluate(() => {
    const w = window.__mn.world, p = w.pipeline, fx = w.nativeFx, r = w.renderer, rt = p.rtPost, size = 24;
    const points = [...fx.loops.values()].flat().map(a => w.camera.position.clone().set(a.x, a.y + 1, a.z).project(w.camera));
    const corners = [[4, 4], [rt.width-size-4, 4], [4, rt.height-size-4], [rt.width-size-4, rt.height-size-4]];
    const distance = ([x,y]) => Math.min(...points.map(v => Math.hypot((v.x+1)*rt.width/2-x-size/2,(v.y+1)*rt.height/2-y-size/2)));
    corners.sort((a,b) => distance(b)-distance(a)); const [x,y] = corners[0];
    const read = hdr => { fx.hdr = hdr; fx.update(0, window.__mn.ps, w.camera); p.render();
      const bytes = new Uint8Array(size*size*4); r.readRenderTargetPixels(rt,x,y,size,size,bytes); return bytes; };
    const a = read(true), b = read(false); let changed = 0;
    for (let i=0;i<a.length;i++) if(a[i]!==b[i]) changed++;
    fx.hdr = true; fx.update(0, window.__mn.ps, w.camera);
    return { x,y,width:size,height:size,flameDistance:distance([x,y]),bytes:a.length,changed };
  });
  check(summary.steps.j.flameDistance > 200 && summary.steps.j.changed === 0, `(j) empty pixels changed: ${JSON.stringify(summary.steps.j)}`);

  // (h) Whole-world experiment without bindings. Returning OFF restores the original material and every output byte.
  await setBindings(null); summary.steps.h = {};
  for (const mode of ['day', 'dusk', 'night']) {
    await tod(mode);
    await page.evaluate(() => { const p = window.__mn.world.pipeline; p.filmWorld = true; p.nativeFilm.load(); });
    await page.waitForFunction(() => !!window.__mn.world.pipeline.nativeFilm.lut, null, { timeout: 60000, polling: 'raf' });
    summary.steps.h[mode] = await page.evaluate(() => {
      const w = window.__mn.world, p = w.pipeline, r = w.renderer, gl = r.getContext();
      const read = on => { p.filmWorld = on; p.render(); const bytes = new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
        gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes); return bytes; };
      const a = read(false), b = read(true), c = read(false); let restored = 0, graded = 0;
      for (let i=0;i<a.length;i++) { if(a[i]!==c[i]) restored++; if(a[i]!==b[i]) graded++; }
      return { restoredDifferences:restored,gradedDifferences:graded,originalMaterial:p.finalQuad.mesh.material===p.final,exposure:p.filmWorldExposure };
    });
    check(summary.steps.h[mode].restoredDifferences === 0 && summary.steps.h[mode].gradedDifferences > 0 && summary.steps.h[mode].originalMaterial, `(h) Filmic toggle: ${JSON.stringify(summary.steps.h[mode])}`);
    for (const on of [false,true]) { await page.evaluate(v => { window.__mn.world.pipeline.filmWorld = v; }, on); await frames(2); await shot(`h-world-${mode}-${on ? 'filmic' : 'original'}`); }
  }
  await page.evaluate(() => { window.__mn.world.pipeline.filmWorld = false; }); await tod('day');

  // (i) Measure full and half FX resolution with exactly 0, 1 and 10 native loops (same view and anchors).
  summary.steps.i = {};
  const savedAnchors = await page.evaluate(() => window.__mn.world.nativeFx.anchors.map(a => ({ ...a, kind:a.slot })));
  for (const scale of [1, 0.5]) {
    await page.evaluate(v => { window.__mn.world.pipeline.nativeFilm.scale = v; }, scale);
    const measurements = {};
    for (const count of [0,1,10]) {
      await setBindings(count ? { [count === 1 ? 'campfire' : 'brazier']: binding(FLAME,{ count:1 }) } : null);
      await page.evaluate(count => { const { world:w,ps } = window.__mn;
        w.nativeFx.setAnchors(Array.from({length:count},(_,i) => ({ x:ps.x+(i%5-2)*2,y:window.__mn.map.heightAt(ps.x,ps.z)+0.3,z:ps.z+Math.floor(i/5)*2,kind:count===1?'campfire':'brazier' }))); }, count);
      if (count) await page.waitForFunction(() => window.__mn.world.nativeFx.metrics.effects.every(e => e.state==='ready'), null, {timeout:60000,polling:'raf'});
      await frames(30); measurements[count] = await window_(120);
      check((await fxState()).loops === count, `(i) expected ${count} loops`);
    }
    summary.steps.i[scale] = measurements;
  }
  const full = summary.steps.i[1], half = summary.steps.i[0.5];
  summary.steps.i.selectedScale = Math.max(full[1].frameMs-half[1].frameMs,full[10].frameMs-half[10].frameMs)>0.5 ? 0.5 : 1;
  await setBindings(null);
  await page.evaluate(({ anchors,scale }) => { const w=window.__mn.world; w.nativeFx.setAnchors(anchors); w.pipeline.nativeFilm.scale=scale; }, { anchors:savedAnchors,scale:summary.steps.i.selectedScale });
  summary.steps.k = {consoleErrors:summary.consoleErrors};
  check(!summary.consoleErrors.length, `(k) console errors: ${summary.consoleErrors.join(' | ')}`);

  // (e) Console.
  check(!summary.consoleErrors.length, `(e) console errors: ${summary.consoleErrors.join(' | ')}`);
  summary.status = 'passed';
} catch (error) {
  summary.status = 'failed'; summary.error = String(error?.stack || error);
  try { await shot('failure'); } catch {}
} finally {
  await browser.close().catch(() => {}); server.close();
}
await writeFile(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1));
process.exitCode = summary.status === 'passed' ? 0 : 1;
