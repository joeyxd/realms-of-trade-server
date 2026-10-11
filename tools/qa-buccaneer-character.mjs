// Reproducible browser QA against an isolated memory host; never mounts production storage.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';

const out = resolve(process.env.MN_BUCCANEER_OUT || 'docs/delivery/buccaneer-v1');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ headless: true,
  ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : { channel: 'chrome' }),
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const evidence = { generatedAt: new Date().toISOString(), viewports: [], failures: [] };
const assert = (value, message) => { if (!value) throw new Error(message); };
const host = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 2, dev: false,
  worldId: null, store: createMemoryStore(), saveSecret: 'isolated-buccaneer-visual-qa', chat: { enabled: false }, log() {} });
try {
  const port = await host.listen();
  for (const spec of [{ name: 'desktop', width: 1280, height: 900, touch: false }, { name: 'mobile', width: 390, height: 844, touch: true }]) {
    const result = { ...spec, errors: [], requests: [], checks: [] };
    evidence.viewports.push(result);
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, hasTouch: spec.touch, isMobile: spec.touch });
    const page = await context.newPage();
    try {
      await page.route('**/assets/models/buccaneer-source-qa.glb', (route) => route.fulfill({
        contentType: 'model/gltf-binary', body: fs.readFileSync(resolve('docs/art/source/buccaneer-v1/male anime+character+3d+model.glb')) }));
      await page.addInitScript(() => localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ skin: 2, name: 'Bucanero', quality: 'low', muted: true, landscape: false, reducedMotion: true })));
      if (process.env.MN_GSAP) await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\//, async (route) => {
        const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
        const file = match && resolve(match[1].startsWith('three') ? 'node_modules/three' : process.env.MN_GSAP, match[2]);
        if (!file || !fs.existsSync(file)) return route.abort();
        await route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
      });
      page.on('pageerror', (err) => result.errors.push(String(err)));
      page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource|fonts\.g/.test(message.text())) result.errors.push(message.text()); });
      page.on('request', (req) => { if (/buccaneer-v1/.test(req.url())) result.requests.push(req.url()); });
      await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
      result.assets = await page.evaluate(() => {
        const a = window.__mn.assets;
        return { list: a.list().filter((x) => /buccaneer/.test(x.id)), errors: a.errors,
          albedo: a.data('char:buccaneer-v1')?.bake.groups.map((g) => ({ width: g.mat.map?.image.width, height: g.mat.map?.image.height })),
          portrait: { width: a.texture('tex:portrait-buccaneer-v1')?.image.width } };
      });
      assert(result.assets.list.length === 2 && result.assets.list.every((x) => x.state === 'ok'), 'Bucanero assets failed to load');
      assert(result.assets.albedo.every((x) => x.width === (spec.touch ? 512 : 1024)), 'Wrong character texture resolution');
      assert(result.assets.portrait.width === (spec.touch ? 256 : 512), 'Wrong portrait resolution');
      assert(result.requests.filter((u) => u.endsWith('.glb')).length === 1, 'More than one character GLB downloaded');
      assert(result.assets.list.every((x) => x.selectedSrc.includes('-mobile') === spec.touch), 'Wrong device source');
      result.checks.push('asset load', 'single GLB variant', 'actual albedo resolution', 'actual portrait resolution');
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.title-card')).opacity) > 0.99
        && getComputedStyle(document.querySelector('#fade')).display === 'none');
      await page.screenshot({ path: resolve(out, `${spec.name}-selector.png`) });
      await page.locator('#btn-play').click({ force: true });
      await page.waitForFunction(() => window.__mn?.client.joined && window.__mn.st.mode === 'playing'
        && window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 60000 });
      result.player = await page.evaluate(() => {
        const rec = window.__mn.client.entities.get(window.__mn.client.youServer);
        return { skin: rec.skin, imported: rec.view?.ext?.id, settings: window.__mn.settings.skin };
      });
      assert(result.player.skin === 2, 'Joined with the wrong look');
      await page.screenshot({ path: resolve(out, `${spec.name}-game.png`) });
      await page.locator('#hud-bag').click({ force: true });
      await page.locator('[data-tab="stats"]').click({ force: true });
      await page.waitForSelector('.ch-model canvas');
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: resolve(out, `${spec.name}-character-es.png`) });
      await page.evaluate(async () => (await import('/src/core/locale.js')).setLocale('en'));
      await page.screenshot({ path: resolve(out, `${spec.name}-character-en.png`) });
      result.checks.push('join as Bucanero', 'character sheet ES/EN');
      if (!spec.touch) {
        await page.setViewportSize({ width: 1280, height: 1200 });
        result.poses = await page.evaluate(async () => {
          const THREE = await import('three');
          const { CharacterView, PortraitStudio } = await import('/src/render/characters.js');
          const { bakeCharacter, sizedCharacter } = await import('/src/render/assets/rebind.js');
          const { buildLook, buildWeaponOnly } = await import('/src/render/charlooks.js');
          const { startHarvestPose } = await import('/src/render/harvestPose.js');
          const { ACT } = await import('/src/sim/ecs.js');
          const studio = new PortraitStudio(window.__mn.world.renderer);
          const v = new CharacterView(2), all = [];
          v.blob.visible = false; studio.views.set(2, v);
          const sheet = document.createElement('div');
          sheet.id = 'buccaneer-poses';
          sheet.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#183346;display:grid;grid-template-columns:repeat(4,1fr);color:white;font:16px sans-serif;overflow:auto';
          const poses = [ ['idle', {}], ['run', { vx: 6.5 }], ['guard', { act: ACT.GUARD }], ['dash', { st: 1 }],
            ['swim', { st: 2, wade: 1 }], ['swing', { act: ACT.SWING1, actT: 0.17 }], ['pistols', { weapon: 'pistolas', act: ACT.SHOOT, actT: 0.05 }], ['hit', { act: ACT.HIT }], ['harvest', {}] ];
          for (const [name, fields] of poses) {
            v.setWeapon(fields.weapon || 'sable');
            const state = { x: 0, y: 0, z: 0, f: 0, vx: 0, vz: 0, st: 0, wade: 0, act: ACT.IDLE, actT: 0, ...fields };
            if (name === 'hit') { v.hit(); v.flash(); }
            if (name === 'harvest') startHarvestPose(v, { kind: 'rock', x: 0, z: 1 });
            for (let i = 0; i < 16; i++) v.update(1 / 60, state);
            const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 330;
            studio.renderFigure(2, canvas, { yaw: 0.2 });
            v.root.updateMatrixWorld(true); v.mesh.skeleton.update();
            const p = new THREE.Vector3(), bounds = new THREE.Box3();
            for (let i = 0; i < v.mesh.geometry.attributes.position.count; i++) {
              p.fromBufferAttribute(v.mesh.geometry.attributes.position, i); v.mesh.applyBoneTransform(i, p);
              if (![p.x, p.y, p.z].every(Number.isFinite)) throw new Error(`Nonfinite vertex in ${name}`);
              bounds.expandByPoint(p);
            }
            all.push({ name, min: bounds.min.toArray(), max: bounds.max.toArray(), imported: v.ext.id, bones: v.mesh.skeleton.bones.length });
            const cell = document.createElement('div'); cell.style.cssText = 'display:flex;flex-direction:column;align-items:center'; cell.append(name, canvas); sheet.append(cell);
          }
          // Same pose, camera and shader: source 2048 vs runtime 1024 and 512 albedo.
          v.setWeapon('sable');
          for (let i = 0; i < 60; i++) v.update(1 / 60, { x: 0, y: 0, z: 0, f: 0, vx: 0, vz: 0, st: 0, wade: 0, act: ACT.IDLE });
          const current = v.mesh.geometry, currentExt = v.ext;
          const a = window.__mn.assets, entry = a.entry('char:buccaneer-v1'), loader = await a.gltfLoader();
          for (const [name, path] of [['runtime-1024', null], ['source-2048', '/assets/models/buccaneer-source-qa.glb'], ['mobile-512', '/assets/models/buccaneer-v1-mobile.glb']]) {
            if (path) {
              const gltf = await loader.loadAsync(path), bake = bakeCharacter(gltf.scene, entry);
              const built = sizedCharacter(bake, v.built.height, buildWeaponOnly(2, true), buildLook(2, false).J);
              v.mesh.geometry = built.geo; v.ext = { ...currentExt, mats: built.mats }; v.mesh.material = v.extMaterials();
            } else { v.mesh.geometry = current; v.ext = currentExt; v.mesh.material = v.extMaterials(); }
            const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 330;
            studio.renderFigure(2, canvas, { yaw: 0.2 });
            const cell = document.createElement('div'); cell.style.cssText = 'display:flex;flex-direction:column;align-items:center'; cell.append(name, canvas); sheet.append(cell);
          }
          v.mesh.geometry = current; v.ext = currentExt;
          const { Debris } = await import('/src/render/vfx/debris.js');
          const debris = new Debris(new THREE.Scene(), { groundAt: () => 0 }); debris.burst(v);
          if (debris.list.length < 5) throw new Error('Missing imported death debris');
          all.push({ name: 'debris', pieces: debris.list.length, imported: v.ext.id, bones: v.mesh.skeleton.bones.length });
          document.body.append(sheet);
          return all;
        });
        assert(result.poses.every((p) => p.imported === 'char:buccaneer-v1' && p.bones === 15), 'Pose did not use the imported rig');
        await page.screenshot({ path: resolve(out, 'desktop-poses.png') });
        result.checks.push('nine armed/harvest action poses on imported 15-bone rig', 'finite deformed vertices', 'same-pose source/desktop/mobile comparison', 'death debris');
      }
      await page.setViewportSize({ width: spec.width, height: spec.height });
      await page.route(/\/assets\/.*buccaneer-v1.*\.(glb|webp)$/, (route) => route.fulfill({ status: 404, body: 'Expected QA asset failure' }));
      await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
      result.fallback = await page.evaluate(async () => {
        const { CharacterView, PortraitStudio } = await import('/src/render/characters.js');
        const v = new CharacterView(2), studio = new PortraitStudio(window.__mn.world.renderer);
        return { imported: !!v.ext, portrait: !!studio.render(2), assets: window.__mn.assets.list().filter((x) => /buccaneer/.test(x.id)) };
      });
      assert(!result.fallback.imported && result.fallback.portrait && result.fallback.assets.every((x) => x.state === 'error'), '404 fallback did not keep the character usable');
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.title-card')).opacity) > 0.99
        && getComputedStyle(document.querySelector('#fade')).display === 'none');
      await page.screenshot({ path: resolve(out, `${spec.name}-fallback.png`) });
      result.checks.push('actual character/portrait 404 fallback');
      if (!spec.touch) {
        await page.goto(`http://127.0.0.1:${port}/?debug&q=low&noassets`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 60000 });
        assert(await page.evaluate(() => !window.__mn.assets.has('char:buccaneer-v1')), 'noassets did not skip the imported character');
        result.checks.push('noassets fallback');
      }
      assert(result.errors.length === 0, `Page errors: ${result.errors.join('; ')}`);
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed'; result.failure = String(error.stack || error); evidence.failures.push(`${spec.name}: ${error.message}`);
      await page.screenshot({ path: resolve(out, `${spec.name}-failure.png`) }).catch(() => {});
    } finally { await context.close(); }
    console.log(`${spec.name}: ${result.status}${result.failure ? ': ' + result.failure.split('\n')[0] : ''}`);
  }
} finally { await browser.close(); await host.close(); }
await writeFile(resolve(out, 'browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
if (evidence.failures.length) process.exitCode = 1;
