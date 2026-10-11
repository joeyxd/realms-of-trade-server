// Real input, network and native swimming checks on an isolated memory authority.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { tuning } from '../src/data/tuning.js';
const out = resolve('docs/delivery/buccaneer-v1/ranged-swim'); await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.MN_PLAYWRIGHT).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const host = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 2, dev: false, worldId: null,
  store: createMemoryStore(), saveSecret: 'isolated-ranged-swim-qa', chat: { enabled: false }, log() {} });
const evidence = { generatedAt: new Date().toISOString(), sessions: [] }, check = (x, m) => { if (!x) throw new Error(m); };
try {
  const port = await host.listen(), w = host.game.server.world, ecs = w.ecs;
  for (const spec of [{ name: 'desktop', width: 1280, height: 900, touch: false }, { name: 'mobile', width: 844, height: 390, touch: true }]) {
    const result = { ...spec, errors: [], requests: [], checks: [] }; evidence.sessions.push(result);
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, hasTouch: spec.touch, isMobile: spec.touch });
    const page = await context.newPage();
    const cdp = spec.touch ? await context.newCDPSession(page) : null;
    try {
      await context.addInitScript(() => localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ skin: 2, name: 'Bucanero', quality: 'medium', muted: true, reducedMotion: false })));
      await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\//, (route) => {
        const m = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
        return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(resolve(m[1].startsWith('three') ? 'node_modules/three' : process.env.MN_GSAP, m[2])) });
      });
      page.on('pageerror', (e) => result.errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) result.errors.push(m.text()); });
      page.on('request', (r) => { if (/buccaneer.*\.glb/.test(r.url())) result.requests.push(r.url()); });
      await page.goto(`http://127.0.0.1:${port}/?debug&q=${spec.touch ? 'low' : 'medium'}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade')).display === 'none');
      await page.locator('#btn-play').click({ force: true });
      await page.waitForFunction(() => window.__mn.client.joined && window.__mn.st.mode === 'playing' && window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 90000 });
      const e = await page.evaluate(() => window.__mn.client.youServer);
      w.debugClear();
      const A = w.map.landmarks.arena, dry = { x: A.x, z: A.z + 4 };
      const place = async ({ x, z }) => {
        ecs.x[e] = x; ecs.z[e] = z; ecs.y[e] = w.map.groundAt(x, z); ecs.god[e] = 1;
        ecs.vx[e] = ecs.vz[e] = 0;
        await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.ps.x - x, window.__mn.ps.z - z) < .1, { x, z });
        await page.waitForTimeout(1800);
      };
      await place(dry);
      check(ecs.weapon[e] === 1 && await page.evaluate(() => window.__mn.ps.weapon === 1), 'New Bucanero did not start with pistols');
      result.checks.push('new Bucanero starter equipment from authority');
      await page.evaluate(async () => {
        const { bus } = await import('/src/core/events.js');
        window.__rangedQA = { events: [] }; bus.on('combat', ev => window.__rangedQA.events.push({ ...ev }));
      });
      const aim = async () => {
        const xy = await page.evaluate(async () => {
          const { Vector3 } = await import('three'), m = window.__mn;
          const v = new Vector3(m.ps.x + 3, m.ps.y, m.ps.z).project(m.world.camera);
          return { x: (v.x + 1) * innerWidth / 2, y: (1 - v.y) * innerHeight / 2 };
        }); await page.mouse.move(xy.x, xy.y); await page.waitForTimeout(100);
      };
      const fires = () => page.evaluate(() => window.__rangedQA.events.filter(e => e.type === 'fire' && e.me));
      const shoot = async (button, ms) => {
        if (spec.touch) {
          const el = page.locator(button === 'left' ? '.t-atk' : '.t-parry');
          const box = await el.boundingBox();
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 11 }] });
          await page.waitForTimeout(ms); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else { await page.mouse.down({ button }); await page.waitForTimeout(ms); await page.mouse.up({ button }); }
      };
      await aim();
      await shoot('left', 480); await aim(); await shoot('right', 800);
      result.fires = await fires();
      check(result.fires.some(e => e.hand === 1 && !e.secondary) && result.fires.some(e => e.hand === -1 && e.secondary), 'Both input triggers must fire their own hand');
      check(!await page.evaluate(() => window.__rangedQA.events.some(e => e.type === 'guard' && e.me)), 'Pistols incorrectly raised guard');
      result.hud = await page.evaluate(() => ({ l: document.querySelector('.lmb-slot').title, r: document.querySelector('.rmb-slot').title,
        touch: document.querySelector('.t-parry')?.getAttribute('aria-label') }));
      check(/rápido|rapid/i.test(result.hud.l) && /potente|powerful/i.test(result.hud.r), 'HUD does not describe different pistols');
      await page.screenshot({ path: resolve(out, `${spec.name}-pistols.png`) });
      result.checks.push('real primary/secondary input and independent hands', 'secondary fires instead of guard', 'contextual HUD/touch');
      // Emit a visible hostile bullet through the real PATTERN transport, then aim at its flight.
      await aim(); await page.waitForTimeout(700);
      const pid = w.nextPid;
      w.firePattern({ type: 'pattern', pid0: pid, tick: w.tick, src: 0, pat: 'single', ptype: 'parry', n: 1,
        speed: 8, dmg: 4, x: ecs.x[e] + 9, y: ecs.y[e] + 1.15, z: ecs.z[e], ang: -Math.PI / 2 });
      // Touch auto-aim follows an incoming threat; mouse keeps the explicit +X aim above.
      await shoot('left', 500);
      await page.waitForFunction(pid => window.__rangedQA.events.some(e => e.type === 'parry' && e.intercept && e.pid === pid), pid, { timeout: 8000 });
      result.intercept = await page.evaluate(pid => window.__rangedQA.events.filter(e => e.pid === pid && ['parry', 'shot'].includes(e.type)), pid);
      check(w.hazards.kill[w.hazards.slot.get(pid)] === 3, 'Authority did not reflect the hostile');
      result.checks.push('moving bullet collision confirmed through real network');
      let wet;
      for (let r = 6; r < 80 && !wet; r += 2) for (let a = 0; a < 32; a++) {
        const x = w.map.landmarks.spawn.x + Math.cos(a / 32 * Math.PI * 2) * r, z = w.map.landmarks.spawn.z + Math.sin(a / 32 * Math.PI * 2) * r;
        if (w.map.groundAt(x, z) < -1.8 && !w.map.onDock(x, z) && w.map.queryColliders(x, z, 1).length === 0) { wet = { x, z }; break; }
      }
      check(wet, 'No real water location found');
      await place(wet);
      await page.waitForFunction(() => window.__mn.client.entities.get(window.__mn.client.youServer).view.wasNativeSwim === true);
      const swimState = () => page.evaluate(() => {
        const m = window.__mn, v = m.client.entities.get(m.client.youServer).view, n = v.nativeSwim, mesh = n.meshes[0];
        const box = new mesh.geometry.boundingBox.constructor().setFromObject(n.root, true);
        return { time: n.mixer.time, actionTime: n.mixer._actions[0].time, bodyVisible: v.mesh.visible, nativeVisible: n.root.visible,
          bones: mesh.skeleton.bones.length, width: mesh.material.map.image.width, root: v.root.position.toArray(),
          min: box.min.toArray(), max: box.max.toArray(), shadow: mesh.castShadow && mesh.receiveShadow,
          inNormalPass: m.world.pipeline.casters.includes(mesh), state: m.ps.st };
      });
      result.swimStart = await swimState(); await page.screenshot({ path: resolve(out, `${spec.name}-swim-start.png`) });
      await page.waitForTimeout(6500); result.swimLoop = await swimState();
      await page.screenshot({ path: resolve(out, `${spec.name}-swim-loop.png`) });
      check(result.swimLoop.time > result.swimStart.time + 5.7 && result.swimLoop.actionTime < 5.7084, 'Swim loop did not advance and wrap');
      check(result.swimLoop.bones === 65 && !result.swimLoop.bodyVisible && result.swimLoop.nativeVisible && result.swimLoop.shadow, 'Native rig visibility or shadows incorrect');
      check(Math.abs(result.swimLoop.root[0] - result.swimStart.root[0]) < .01 && Math.abs(result.swimLoop.root[2] - result.swimStart.root[2]) < .01, 'Swim moved the authoritative root');
      if (!spec.touch) check(result.swimLoop.inNormalPass, 'Native mesh missing from normal/depth pass');
      result.checks.push('native 65-bone swim / one device GLB', 'loop without forward drift', 'water framing / shadow / depth');
      await place(dry);
      check(await page.evaluate(() => { const v = window.__mn.client.entities.get(window.__mn.client.youServer).view; return v.mesh.visible && !v.nativeSwim.root.visible; }), 'Leaving water did not restore gameplay mesh');
      result.checks.push('leaving water restores body and weapons');
      // Lifecycle fixtures use the actual view, without touching durable data or gameplay authority.
      result.lifecycle = await page.evaluate(() => {
        const m = window.__mn, v = m.client.entities.get(m.client.youServer).view, swim = { ...m.ps, st: 2, dead: 0, act: 0 };
        v.update(.016, swim); const reentered = v.nativeSwim.mixer.time < .1 && v.wasNativeSwim;
        v.update(.016, { ...swim, dead: 1, act: 6 }); const death = v.mesh.visible && !v.nativeSwim.root.visible;
        v.nativeSwim.advance = () => { throw new Error('Expected swim fallback fixture'); };
        v.update(.016, swim); const fallback = v.mesh.visible && !v.nativeSwim && v.meshes.length === 1;
        v.update(.016, m.ps);
        return { reentered, death, fallback };
      });
      check(Object.values(result.lifecycle).every(Boolean), 'Swim lifecycle fixture failed'); result.checks.push('reentry / death / failed native fallback');
      check(result.requests.length === 1, 'Extra character model downloaded');
      check(!result.errors.length && await page.evaluate(() => window.__mn.errors.size === 0), result.errors.join('; ') || 'Application error');
      result.passed = true; console.log(`${spec.name}: ${result.checks.length} checks passed`);
    } catch (error) { await page.screenshot({ path: resolve(out, `${spec.name}-failure.png`) }); throw error; }
    finally { await context.close(); }
  }
} catch (error) { evidence.failure = String(error); throw error; }
finally { await browser.close(); await host.close(); await writeFile(resolve(out, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n'); }
