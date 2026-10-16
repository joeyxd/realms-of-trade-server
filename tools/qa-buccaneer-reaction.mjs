// Local-only acceptance for the Bucanero's source hit reaction and differentiated pistol recoil.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hurtPlayer } from '../src/sim/systems/combat.js';

const out = resolve('docs/delivery/buccaneer-v1/combat-reaction/qa');
await mkdir(out, { recursive: true });
const playwright = process.env.MN_PLAYWRIGHT ? pathToFileURL(resolve(process.env.MN_PLAYWRIGHT)).href : 'playwright';
const { chromium } = await import(playwright);
const browser = await chromium.launch({ headless: true,
  ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : { channel: 'chrome' }),
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const host = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 2, dev: false,
  worldId: null, store: createMemoryStore(), saveSecret: 'isolated-buccaneer-reaction-qa',
  chat: { enabled: false }, log() {} });
const evidence = { generatedAt: new Date().toISOString(), sessions: [] };
const check = (condition, message) => { if (!condition) throw new Error(message); };

try {
  const port = await host.listen(), world = host.game.server.world, ecs = world.ecs;
  world.debugClear();
  for (const spec of [
    { name: 'desktop', width: 1280, height: 900, touch: false, quality: 'medium' },
    { name: 'mobile', width: 844, height: 390, touch: true, quality: 'low' },
  ]) {
    const result = { ...spec, errors: [], modelRequests: [], checks: [] };
    evidence.sessions.push(result);
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height },
      hasTouch: spec.touch, isMobile: spec.touch });
    const page = await context.newPage();
    const cdp = spec.touch ? await context.newCDPSession(page) : null;
    try {
      await context.addInitScript(() => localStorage.setItem('mareanegra.v1.settings', JSON.stringify({
        skin: 2, name: 'Bucanero QA', quality: 'low', muted: true, reducedMotion: false,
      })));
      if (process.env.MN_GSAP) await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\//, (route) => {
        const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
        const root = match[1].startsWith('three') ? 'node_modules/three' : process.env.MN_GSAP;
        return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' },
          body: fs.readFileSync(resolve(root, match[2])) });
      });
      page.on('pageerror', error => result.errors.push(String(error)));
      page.on('console', message => {
        if (message.type() === 'error' && !/Failed to load resource|fonts\.g/.test(message.text())) result.errors.push(message.text());
      });
      page.on('request', request => { if (/buccaneer.*\.glb/.test(request.url())) result.modelRequests.push(request.url()); });
      await page.goto(`http://127.0.0.1:${port}/?debug&tod=day&q=${spec.quality}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade')).display === 'none');
      await page.locator('#btn-play').click({ force: true });
      await page.waitForFunction(() => window.__mn.client.joined && window.__mn.st.mode === 'playing' &&
        window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 90000 });

      const entity = await page.evaluate(() => window.__mn.client.youServer);
      world.debugClear();
      const arena = world.map.landmarks.arena;
      const dry = { x: arena.x, z: arena.z + 4 };
      const place = async ({ x, z }) => {
        ecs.x[entity] = x; ecs.z[entity] = z; ecs.y[entity] = world.map.groundAt(x, z);
        ecs.vx[entity] = ecs.vz[entity] = 0; ecs.kbx[entity] = ecs.kbz[entity] = 0;
        await page.waitForFunction(({ x, z }) => Math.hypot(window.__mn.ps.x - x, window.__mn.ps.z - z) < .1, { x, z });
        await page.waitForTimeout(1800);
      };
      await place(dry);
      // Bring the real gameplay camera closer so the reaction is inspectable in captures.
      await page.evaluate(() => { window.__mn.world.rig.distTarget = 8; });
      await page.waitForTimeout(900);
      check(ecs.weapon[entity] === 1 && await page.evaluate(() => window.__mn.ps.weapon === 1), 'New Bucanero did not enter with pistols');
      await page.evaluate(async () => {
        const { bus } = await import('/src/core/events.js');
        window.__reactionQA = { hurts: [], fires: [] };
        bus.on('combat', ev => {
          const m = window.__mn, view = m.client.entities.get(m.client.youServer)?.view;
          if (ev.type === 'hurt' && ev.me) window.__reactionQA.hurts.push({ dmg: ev.dmg, fromServer: !!ev.fromServer });
          if (ev.type === 'fire' && ev.me) window.__reactionQA.fires.push({ hand: ev.hand, secondary: !!ev.secondary,
            recoilLAmp: view?.recoilLAmp, recoilRAmp: view?.recoilRAmp,
            speed: Math.hypot(m.ps.vx, m.ps.vz), act: m.ps.act });
        });
      });
      const base = await page.evaluate(() => {
        const m = window.__mn, v = m.client.entities.get(m.client.youServer).view;
        return { mesh: v.mesh, geometry: v.mesh.geometry.uuid, bones: v.mesh.skeleton.bones.length,
          renderMeshes: v.meshes.length, visible: v.mesh.visible, weapon: m.ps.weapon };
      });
      check(base.bones === 15 && base.renderMeshes === 1 && base.visible && base.weapon === 1, 'Armed gameplay mesh baseline is not the 15-bone body');
      result.baseline = { geometry: base.geometry, bones: base.bones, renderMeshes: base.renderMeshes, visible: base.visible, weapon: base.weapon };

      const sample = () => page.evaluate(() => {
        const m = window.__mn, rec = m.client.entities.get(m.client.youServer), v = rec?.view, reaction = v?.reaction;
        return { active: !!reaction?.active, time: reaction?.time || 0, duration: reaction?.duration || 0,
          weight: reaction?.weight || 0, fallback: !!v?.reactionUnavailable, hitK: v?.hitK,
          geometry: v?.mesh.geometry.uuid, bones: v?.mesh.skeleton.bones.length, renderMeshes: v?.meshes.length,
          bodyVisible: v?.mesh.visible, swimVisible: !!v?.nativeSwim?.root.visible,
          speed: Math.hypot(m.ps.vx, m.ps.vz), act: m.ps.act, swimState: m.ps.st,
          hp: m.ps.hp, day: m.world.lighting.tod };
      });
      const waitHurt = async (n) => page.waitForFunction(count => window.__reactionQA.hurts.length >= count, n, { timeout: 10000 });
      const hurt = (raw = 2) => {
        const x = ecs.x[entity], z = ecs.z[entity]; ecs.god[entity] = 0;
        const dealt = hurtPlayer(world, entity, raw, { x: x + 1, z, kind: 'reaction-qa', noInv: true, pierce: true, knock: 0 });
        check(dealt > 0, 'Local authority fixture did not apply damage');
      };
      const waitActive = () => page.waitForFunction(() => {
        const v = window.__mn.client.entities.get(window.__mn.client.youServer)?.view, r = v?.reaction;
        return !!r?.active && r.time > .04 && r.weight > 0;
      }, null, { timeout: 8000 });
      const assertBaseMesh = async (where, expectedRenderMeshes = base.renderMeshes) => {
        const current = await page.evaluate(() => {
          const v = window.__mn.client.entities.get(window.__mn.client.youServer).view;
          return { geometry: v.mesh.geometry.uuid, bones: v.mesh.skeleton.bones.length,
            renderMeshes: v.meshes.length, visible: v.mesh.visible };
        });
        check(current.geometry === base.geometry && current.bones === 15 && current.renderMeshes === expectedRenderMeshes && current.visible,
          `${where}: hit reaction changed/added the armed gameplay mesh`);
      };

      const firstHurt = await page.evaluate(() => window.__reactionQA.hurts.length) + 1;
      hurt(); await waitHurt(firstHurt); await waitActive();
      await page.waitForFunction(() => window.__mn.client.entities.get(window.__mn.client.youServer).view.reaction.time > .18);
      result.idleHurt = await sample(); await assertBaseMesh('idle hurt');
      check(result.idleHurt.active && result.idleHurt.weight > 0 && result.idleHurt.speed < .2, 'Authoritative idle hurt did not activate source reaction');
      await page.screenshot({ path: resolve(out, `${spec.name}-idle-hurt.png`) });
      result.checks.push('server hurt reaches Feedback and activates the original clip while armed mesh stays intact');

      const resetAt = await page.evaluate(() => window.__reactionQA.hurts.length) + 1;
      hurt(); await waitHurt(resetAt);
      await page.waitForFunction(() => {
        const r = window.__mn.client.entities.get(window.__mn.client.youServer).view.reaction;
        return r?.active && r.time < .1;
      }, null, { timeout: 6000 });
      result.repeatReset = await sample();
      check(result.repeatReset.time < .1 && result.repeatReset.active, 'Confirmed repeated hurt did not restart reaction from frame zero');
      await page.waitForFunction(() => {
        const r = window.__mn.client.entities.get(window.__mn.client.youServer).view.reaction;
        return r && !r.active && r.weight === 0;
      }, null, { timeout: 3500 });
      result.recovered = await sample();
      check(result.recovered.duration >= 1.29 && !result.recovered.active && result.recovered.weight === 0,
        'Source reaction did not complete its full ~1.3 second clip and settle');
      await assertBaseMesh('reaction recovery');
      result.checks.push('repeat hurt restarts once; full source clip returns to base pose');

      // Test the source-layer rule directly on the active real view: moving and shooting preserve both arm poses.
      const armPreservation = await page.evaluate(async () => {
        const { ACT } = await import('/src/sim/ecs.js');
        const m = window.__mn, v = m.client.entities.get(m.client.youServer).view;
        const run = (state) => {
          v.reaction.restart(1);
          const l = v.armL.quaternion.toArray(), r = v.armR.quaternion.toArray();
          const torso = v.chest.quaternion.toArray();
          v.reaction.apply(v, .04, { ...m.ps, dead: 0, st: 0, ...state });
          return { left: l.every((n, i) => Math.abs(n - v.armL.quaternion.toArray()[i]) < 1e-8),
            right: r.every((n, i) => Math.abs(n - v.armR.quaternion.toArray()[i]) < 1e-8),
            torsoChanged: torso.some((n, i) => Math.abs(n - v.chest.quaternion.toArray()[i]) > 1e-5),
            active: v.reaction.active, weight: v.reaction.weight };
        };
        return { moving: run({ vx: 1, vz: 0, act: ACT.IDLE }), firing: run({ vx: 0, vz: 0, act: ACT.SHOOT }) };
      });
      result.armPreservation = armPreservation;
      check(['moving', 'firing'].every(mode => armPreservation[mode].left && armPreservation[mode].right &&
        armPreservation[mode].active && armPreservation[mode].weight > 0) &&
        armPreservation.moving.torsoChanged && armPreservation.firing.torsoChanged, 'Reaction did not preserve procedural arms while moving/firing');
      result.checks.push('source reaction bends torso while preserving procedural arms for run/fire');

      // Generate real movement and both real trigger events; the listener samples amplitudes synchronously at recoil.
      const aim = async () => {
        const point = await page.evaluate(async () => {
          const { Vector3 } = await import('three'), m = window.__mn;
          const p = new Vector3(m.ps.x + 3, m.ps.y, m.ps.z).project(m.world.camera);
          return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
        });
        await page.mouse.move(point.x, point.y); await page.waitForTimeout(100);
      };
      const shoot = async (button, ms, during = null) => {
        if (spec.touch) {
          const selector = button === 'left' ? '.t-atk' : '.t-parry', box = await page.locator(selector).boundingBox();
          check(box, `Touch control ${selector} is missing`);
          const id = button === 'left' ? 21 : 22;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id }] });
          if (during) await during();
          await page.waitForTimeout(ms - (during ? 180 : 0)); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.down({ button });
          if (during) await during();
          await page.waitForTimeout(ms - (during ? 180 : 0)); await page.mouse.up({ button });
        }
      };
      await aim();
      const leftAt = await page.evaluate(() => window.__reactionQA.fires.length);
      await shoot('left', 470);
      await page.waitForFunction(count => window.__reactionQA.fires.length > count, leftAt, { timeout: 6000 });
      const rightAt = await page.evaluate(() => window.__reactionQA.fires.length);
      await aim(); await shoot('right', 780, async () => {
        await page.waitForFunction(count => window.__reactionQA.fires.length > count, rightAt, { timeout: 6000 });
        await page.waitForTimeout(100);
        await page.screenshot({ path: resolve(out, `${spec.name}-secondary-shot.png`) });
      });
      await page.waitForFunction(count => window.__reactionQA.fires.length > count, rightAt, { timeout: 6000 });
      result.triggers = await page.evaluate(() => window.__reactionQA.fires);
      check(result.triggers.some(e => e.hand === 1 && !e.secondary && e.recoilLAmp === 1), 'Primary input did not create the quick left recoil');
      check(result.triggers.some(e => e.hand === -1 && e.secondary && e.recoilRAmp === 1.45), 'Secondary input did not create the powerful right recoil');
      result.checks.push('real mouse/CDP touch primary and secondary fire with 1.0/1.45 per-hand recoil');

      // Hold an actual movement key while firing, then deliver another authoritative network hurt.
      await page.keyboard.down('d'); await page.waitForTimeout(500);
      const speedBefore = await page.evaluate(() => Math.hypot(window.__mn.ps.vx, window.__mn.ps.vz));
      check(speedBefore > .35, 'Real movement input did not move the local player');
      await aim(); const movingFireAt = await page.evaluate(() => window.__reactionQA.fires.length);
      await shoot('left', 350);
      await page.waitForFunction(count => window.__reactionQA.fires.length > count, movingFireAt, { timeout: 6000 });
      const movingHurtAt = await page.evaluate(() => window.__reactionQA.hurts.length) + 1;
      hurt(); await waitHurt(movingHurtAt); await waitActive();
      result.movingHurt = await sample(); await assertBaseMesh('moving hurt');
      check(result.movingHurt.active && result.movingHurt.weight > 0 && result.movingHurt.speed > .2,
        'Authoritative hurt did not activate during normal movement');
      result.movingFire = await page.evaluate(() => window.__reactionQA.fires.slice(-3));
      check(result.movingFire.some(e => e.speed > .2), 'No real fire event was recorded while moving');
      await page.screenshot({ path: resolve(out, `${spec.name}-moving-hurt.png`) });
      result.checks.push('real movement/fire continues during the network-confirmed moving hurt');
      await page.keyboard.up('d');

      // A fresh hit followed by a one-frame dash/death state must cancel, never queue a later flinch.
      const cancelWithState = async (kind) => {
        const count = await page.evaluate(() => window.__reactionQA.hurts.length) + 1;
        hurt(); await waitHurt(count); await waitActive();
        const out = await page.evaluate(async kind => {
          const { ACT } = await import('/src/sim/ecs.js');
          const m = window.__mn, v = m.client.entities.get(m.client.youServer).view;
          const state = kind === 'dash' ? { ...m.ps, st: 1, dead: 0, act: ACT.IDLE }
            : { ...m.ps, st: 0, dead: 1, act: ACT.DEAD };
          v.update(.016, state);
          const cancelled = !!v.reaction && !v.reaction.active && v.reaction.weight === 0;
          v.update(.016, { ...m.ps, st: 0, dead: 0, act: ACT.IDLE });
          return { cancelled, noDeferred: !!v.reaction && !v.reaction.active && v.reaction.weight === 0 };
        }, kind);
        return out;
      };
      result.dashCancel = await cancelWithState('dash');
      result.deathCancel = await cancelWithState('dead');
      check(result.dashCancel.cancelled && result.dashCancel.noDeferred, 'Dash failed to cancel without deferring the reaction');
      check(result.deathCancel.cancelled && result.deathCancel.noDeferred, 'Death failed to cancel without deferring the reaction');
      result.checks.push('dash/death cancel active reaction and do not defer it');

      // Reuse the real map water fixture: swim starts through server state, not a synthetic visual flag.
      let wet;
      for (let radius = 6; radius < 80 && !wet; radius += 2) for (let angle = 0; angle < 32; angle++) {
        const x = world.map.landmarks.spawn.x + Math.cos(angle / 32 * Math.PI * 2) * radius;
        const z = world.map.landmarks.spawn.z + Math.sin(angle / 32 * Math.PI * 2) * radius;
        if (world.map.groundAt(x, z) < -1.8 && !world.map.onDock(x, z) && world.map.queryColliders(x, z, 1).length === 0) { wet = { x, z }; break; }
      }
      check(wet, 'No unobstructed water fixture found'); result.waterTarget = wet;
      await place(wet);
      await page.waitForFunction(() => window.__mn.client.entities.get(window.__mn.client.youServer).view.wasNativeSwim, null, { timeout: 12000 });
      const swimHurtAt = await page.evaluate(() => window.__reactionQA.hurts.length) + 1;
      hurt(); await waitHurt(swimHurtAt);
      await page.waitForFunction(() => {
        const m = window.__mn, v = m.client.entities.get(m.client.youServer).view;
        return v.wasNativeSwim && v.reaction && !v.reaction.active && v.reaction.weight === 0;
      }, null, { timeout: 5000 });
      await place(dry);
      result.swimCancel = await sample();
      check(!result.swimCancel.active && !result.swimCancel.swimVisible && result.swimCancel.bodyVisible,
        'Water cancelled hit motion but did not restore the original body on shore');
      result.checks.push('server-positioned real swim cancels hit reaction; shore return does not replay it');

      // Force an animation-sampler failure on the real view, then confirm procedural fallback remains usable.
      await page.evaluate(() => {
        const v = window.__mn.client.entities.get(window.__mn.client.youServer).view;
        if (!v.reaction) throw new Error('Source reaction instance was not retained after lifecycle tests');
        v.reaction.apply = () => { throw new Error('Injected reaction QA failure'); };
      });
      const fallbackAt = await page.evaluate(() => window.__reactionQA.hurts.length) + 1;
      hurt(); await waitHurt(fallbackAt);
      await page.waitForFunction(() => {
        const v = window.__mn.client.entities.get(window.__mn.client.youServer).view;
        return v.reactionUnavailable && !v.reaction && v.hitK > 0;
      }, null, { timeout: 5000 });
      result.fallback = await sample();
      check(result.fallback.fallback && result.fallback.hitK > 0 && result.fallback.bodyVisible,
        'Sampler failure did not recover through the procedural flinch');
      await assertBaseMesh('sampler failure fallback', result.swimCancel.renderMeshes);
      result.checks.push('injected clip-apply failure recovers to procedural flinch');

      check(result.modelRequests.length === 1, `Expected one Bucanero model download, got ${result.modelRequests.length}`);
      check(!result.errors.length && await page.evaluate(() => window.__mn.errors.size === 0), result.errors.join('; ') || 'Application error');
      result.passed = true;
      console.log(`${spec.name}: ${result.checks.length} reaction checks passed`);
    } catch (error) {
      try { await page.screenshot({ path: resolve(out, `${spec.name}-failure.png`) }); } catch { /* Preserve the original failure. */ }
      throw error;
    } finally { await context.close(); }
  }
} catch (error) {
  evidence.failure = String(error);
  throw error;
} finally {
  await browser.close(); await host.close();
  await writeFile(resolve(out, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n');
}
