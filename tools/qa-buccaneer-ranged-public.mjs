// Public acceptance: exact assets/code, real guest input and ordinary walking into water.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const base = 'https://marea.62.171.136.148.sslip.io';
const out = resolve('docs/delivery/buccaneer-v1/ranged-swim/public'); await mkdir(out, { recursive: true });
const evidence = { generatedAt: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(), sources: [], sessions: [] };
const check = (x, m) => { if (!x) throw new Error(m); }, hash = b => createHash('sha256').update(b).digest('hex');
const status = async () => {
  const s = await (await fetch(`${base}/status`)).json();
  return { version: s.version, protocol: s.protocol, players: s.players, sockets: s.sockets, errors: s.errors,
    storage: { kind: s.storage.kind, durable: s.storage.durable, errors: s.storage.errors, unsaved: s.storage.unsaved,
      tickBlocked: s.storage.tickBlocked, worldReady: s.storage.world?.ready }, pending: s.economic?.pending };
};
evidence.before = await status(); check(evidence.before.version === '0.6.0-alpha.59', 'Wrong public build');
for (const file of ['src/data/meta.js', 'src/data/weapons.js', 'src/net/protocol.js', 'src/sim/ecs.js', 'src/sim/world.js',
  'src/sim/projectiles.js', 'src/sim/projectileClash.js', 'src/sim/systems/combat.js', 'src/sim/systems/skills.js',
  'src/client/gameClient.js', 'src/client/swimStatus.js', 'src/main.js', 'src/render/characters.js', 'src/render/charlooks.js',
  'src/render/assets/registry.js', 'src/render/assets/characterSwim.js', 'src/render/assets/characterFigure.js',
  'src/ui/hud.js', 'src/ui/touch.js', 'src/ui/title.js', 'src/ui/characterScreen.js', 'assets/manifest.json',
  'assets/models/buccaneer-v1-desktop.glb', 'assets/models/buccaneer-v1-mobile.glb']) {
  const r = await fetch(`${base}/${file}`, { cache: 'no-cache' }); check(r.ok, `Missing ${file}`);
  const actual = Buffer.from(await r.arrayBuffer()), expected = execFileSync('git', ['show', `HEAD:${file}`], { maxBuffer: 8000000 });
  check(hash(actual) === hash(expected), `Hash mismatch: ${file}`); evidence.sources.push({ file, bytes: actual.length, sha256: hash(actual) });
}
const { chromium } = await import(pathToFileURL(process.env.MN_PLAYWRIGHT).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  for (const spec of [{ name: 'desktop', width: 1280, height: 900, touch: false }, { name: 'mobile', width: 844, height: 390, touch: true }]) {
    const result = { ...spec, errors: [], checks: [] }; evidence.sessions.push(result);
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, hasTouch: spec.touch, isMobile: spec.touch });
    const page = await context.newPage();
    try {
      await context.addInitScript(() => localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ skin: 2, name: 'QA_Bucanero', quality: 'low', muted: true })));
      await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\//, route => {
        const m = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
        return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(resolve(m[1].startsWith('three') ? 'node_modules/three' : process.env.MN_GSAP, m[2])) });
      });
      page.on('pageerror', e => result.errors.push(String(e)));
      await page.goto(`${base}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade')).display === 'none');
      await page.locator('#btn-play').click({ force: true });
      await page.waitForFunction(() => window.__mn.client.joined && window.__mn.input.enabled && window.__mn.st.mode === 'playing', null, { timeout: 90000 });
      result.start = await page.evaluate(async () => {
        const m = window.__mn, { bus } = await import('/src/core/events.js'); window.__publicShots = [];
        bus.on('combat', e => { if (e.type === 'fire' && e.me) window.__publicShots.push({ hand: e.hand, secondary: !!e.secondary }); });
        return { x: m.ps.x, z: m.ps.z, weapon: m.ps.weapon };
      }); check(result.start.weapon === 1, 'New Bucanero is not ranged');
      if (spec.touch) {
        const cdp = await context.newCDPSession(page);
        for (const sel of ['.t-atk', '.t-parry']) {
          const b = await page.locator(sel).boundingBox();
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 3 }] });
          await page.waitForTimeout(350); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
      } else {
        await page.mouse.move(spec.width * .6, spec.height * .5);
        for (const button of ['left', 'right']) { await page.mouse.down({ button }); await page.waitForTimeout(350); await page.mouse.up({ button }); }
      }
      result.fires = await page.evaluate(() => window.__publicShots); check(result.fires.some(e => e.hand === 1) && result.fires.some(e => e.hand === -1 && e.secondary), 'Public triggers did not fire');
      result.checks.push('real guest entry / authoritative pistol kit', 'primary and secondary real input');
      const wet = await page.evaluate(() => {
        const m = window.__mn, map = m.map, sx = m.ps.x, sz = m.ps.z;
        for (let r = 4; r < 30; r += 1) for (let a = 0; a < 48; a++) {
          const x = sx + Math.cos(a / 48 * Math.PI * 2) * r, z = sz + Math.sin(a / 48 * Math.PI * 2) * r;
          if (map.groundAt(x, z) >= -1.5 || map.onDock(x, z)) continue;
          let clear = true;
          for (let j = 1; j <= r * 3; j++) {
            const q = j / (r * 3), px = sx + (x - sx) * q, pz = sz + (z - sz) * q;
            for (const k of map.queryColliders(px, pz, 2)) { const c = map.colliders[k]; if (Math.hypot(px - c.x, pz - c.z) < c.r + .4) clear = false; }
          }
          if (clear) return { x, z };
        } return null;
      }); check(wet, 'No unobstructed water route'); result.waterTarget = wet;
      const walk = async (target, swimming) => {
        let held = [];
        try {
          for (let i = 0; i < 120; i++) {
            const next = await page.evaluate(({ target, swimming }) => {
              const m = window.__mn, dx = target.x - m.ps.x, dz = target.z - m.ps.z, d = Math.hypot(dx, dz), y = m.world.rig.yawTarget;
              if (swimming ? m.ps.st === 2 : m.ps.st !== 2 && d < .8) return { done: true };
              const ix = Math.cos(y) * dx - Math.sin(y) * dz, iy = -Math.sin(y) * dx - Math.cos(y) * dz;
              return { keys: [...(Math.abs(ix) > d * .32 ? [ix > 0 ? 'KeyD' : 'KeyA'] : []), ...(Math.abs(iy) > d * .32 ? [iy > 0 ? 'KeyW' : 'KeyS'] : [])] };
            }, { target, swimming });
            if (next.done) return;
            for (const k of held) if (!next.keys.includes(k)) await page.keyboard.up(k);
            for (const k of next.keys) if (!held.includes(k)) await page.keyboard.down(k);
            held = next.keys; await page.waitForTimeout(160);
          } throw new Error('Ordinary water route timed out');
        } finally { for (const k of held) await page.keyboard.up(k); }
      };
      await walk(wet, true);
      await page.waitForFunction(() => window.__mn.client.entities.get(window.__mn.client.youServer).view.wasNativeSwim);
      const sample = () => page.evaluate(() => {
        const m = window.__mn, v = m.client.entities.get(m.client.youServer).view, n = v.nativeSwim;
        return { st: m.ps.st, bones: n.meshes[0].skeleton.bones.length, width: n.meshes[0].material.map.image.width,
          time: n.mixer.time, actionTime: n.mixer._actions[0].time, baseVisible: v.mesh.visible, nativeVisible: n.root.visible };
      });
      result.swimStart = await sample(); await page.screenshot({ path: resolve(out, `${spec.name}-swim-start.png`) });
      await page.waitForTimeout(6300); result.swimLoop = await sample(); await page.screenshot({ path: resolve(out, `${spec.name}-swim-loop.png`) });
      check(result.swimLoop.time > result.swimStart.time + 5.7 && result.swimLoop.bones === 65 && !result.swimLoop.baseVisible && result.swimLoop.nativeVisible, 'Public native swimming is not active');
      check(result.swimLoop.width === (spec.touch ? 512 : 1024), 'Wrong device model variant');
      result.checks.push('ordinary movement enters real water', 'native loop and device variant');
      await walk(result.start, false); check(await page.evaluate(() => { const v = window.__mn.client.entities.get(window.__mn.client.youServer).view; return v.mesh.visible && !v.nativeSwim.root.visible; }), 'Exit did not restore weapons');
      result.checks.push('ordinary movement returns to shore and weapons');
      await page.evaluate(async () => { const { setLocale } = await import('/src/core/i18n.js'); setLocale('en'); }); await page.waitForTimeout(250);
      result.english = await page.evaluate(() => ({ l: document.querySelector('.lmb-slot').title, r: document.querySelector('.rmb-slot').title }));
      check(/rapid/.test(result.english.l) && /powerful/.test(result.english.r), 'English pistol controls missing');
      await page.screenshot({ path: resolve(out, `${spec.name}-shore-en.png`) }); result.checks.push('Spanish / English controls');
      result.appErrors = await page.evaluate(() => [...window.__mn.errors]); check(!result.errors.length && !result.appErrors.length, 'Public browser error'); result.passed = true;
      console.log(`${spec.name}: ${result.checks.length} public checks passed`);
    } catch (error) { await page.screenshot({ path: resolve(out, `${spec.name}-failure.png`) }); throw error; }
    finally { await context.close(); }
  }
  evidence.after = await status(); check(evidence.after.errors === 0 && evidence.after.storage.errors === 0 && evidence.after.storage.unsaved === 0, 'Public authority errors');
} catch (error) { evidence.failure = String(error); throw error; }
finally { await browser.close(); await writeFile(resolve(out, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n'); }
