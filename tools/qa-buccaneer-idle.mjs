// Real character-sheet idle and lifecycle checks on an isolated memory server.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
const out = resolve('docs/delivery/buccaneer-v1/idle'); await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.MN_PLAYWRIGHT).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const host = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 2, dev: false, worldId: null,
  store: createMemoryStore(), saveSecret: 'isolated-native-idle-qa', chat: { enabled: false }, log() {} });
const evidence = { generatedAt: new Date().toISOString(), sessions: [] }, check = (x, m) => { if (!x) throw new Error(m); };
try {
  const port = await host.listen();
  for (const spec of [{ name: 'desktop', width: 1280, height: 900, touch: false }, { name: 'mobile', width: 844, height: 390, touch: true }]) {
    const result = { ...spec, errors: [], requests: [], checks: [] }; evidence.sessions.push(result);
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, hasTouch: spec.touch, isMobile: spec.touch });
    try {
      await context.addInitScript(() => localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ skin: 2, name: 'Bucanero', quality: 'low', muted: true, reducedMotion: false })));
      const page = await context.newPage();
      await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\//, (route) => {
        const m = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
        return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(resolve(m[1].startsWith('three') ? 'node_modules/three' : process.env.MN_GSAP, m[2])) });
      });
      page.on('pageerror', (e) => result.errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) result.errors.push(m.text()); });
      page.on('request', (r) => { if (/buccaneer.*\.glb/.test(r.url())) result.requests.push(r.url()); });
      await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade')).display === 'none');
      await page.locator('#btn-play').click({ force: true });
      await page.waitForFunction(() => window.__mn.client.joined && window.__mn.st.mode === 'playing' && window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 90000 });
      await page.evaluate(() => {
        const mn = window.__mn, p = mn.panels.charPanel, create = mn.assets.characterFigure.bind(mn.assets), draw = p.figure;
        window.__idleQA = { draws: [], views: [] };
        mn.assets.characterFigure = (...a) => { const v = create(...a); window.__idleQA.views.push(v); return v; };
        p.figure = (c, o) => { draw(c, o); window.__idleQA.draws.push({ at: performance.now(), delta: o.delta, still: o.still }); };
      });
      await page.locator('#hud-bag').click({ force: true }); await page.locator('[data-tab="stats"]').click({ force: true });
      await page.waitForFunction(() => window.__idleQA.views.some((v) => v?.nativeIdle));
      await page.waitForTimeout(350);
      await page.screenshot({ path: resolve(out, `${spec.name}-sheet.png`) });
      result.native = await page.evaluate(() => {
        const q = window.__idleQA, mn = window.__mn, v = q.views[0], rec = mn.client.entities.get(mn.client.youServer), meshes = [];
        v.root.traverse((o) => { if (o.isSkinnedMesh) meshes.push({ bones: o.skeleton.bones.length, map: o.material.map.image.width }); });
        return { clip: mn.assets.data('char:buccaneer-v1').figure.clip.name, duration: mn.assets.data('char:buccaneer-v1').figure.clip.duration,
          meshes, worldBones: rec.view.mesh.skeleton.bones.length, height: v.height };
      });
      check(result.native.clip === 'idle' && result.native.meshes.every((m) => m.bones === 65 && m.map === (spec.touch ? 512 : 1024)) && result.native.worldBones === 15, 'Native/world rigs or texture do not match');
      check(result.requests.length === 1, 'Sheet downloaded an extra GLB'); result.checks.push('native idle / world rig isolated', 'single device GLB');
      const frames = [];
      for (const sample of [0, 4, 8, 12, 16]) {
        if (sample) await page.waitForTimeout(4000);
        const frame = await page.evaluate(() => {
          const c = document.querySelector('.ch-model canvas'), pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1, hash = 2166136261;
          for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
            const i = (y * c.width + x) * 4; hash = Math.imul(hash ^ pixels[i], 16777619);
            if (pixels[i + 3] > 40) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
          }
          return { hash, x0, y0, x1, y1, width: c.width, height: c.height, time: window.__idleQA.views[0].mixer.time };
        });
        frames.push(frame); await page.locator('.ch-model').screenshot({ path: resolve(out, `${spec.name}-idle-${sample}.png`) });
      }
      result.frames = frames;
      check(new Set(frames.map((f) => f.hash)).size === frames.length, 'Idle frames are frozen');
      check(frames.every((f) => f.x0 > 0 && f.y0 > 0 && f.x1 < f.width - 1 && f.y1 < f.height - 1), 'Idle is clipped');
      result.draws = await page.evaluate(() => {
        const a = window.__idleQA.draws, moving = a.filter((d) => d.delta > 0);
        return { animated: moving.length, thumbs: a.filter((d) => d.still).length, deltaMax: Math.max(...moving.map((d) => d.delta)),
          averageFps: (moving.length - 1) * 1000 / (moving.at(-1).at - moving[0].at) };
      });
      check(result.draws.thumbs === (spec.touch ? 0 : 6) || result.draws.thumbs === 6, 'Unexpected thumbnail redraws');
      check(result.draws.deltaMax <= .1 && result.draws.averageFps <= 24.5, 'Idle update limit exceeded'); result.checks.push('animated idle frames', 'full-body framing', '24 FPS limit / static thumbnails');
      await page.evaluate(() => { const v = window.__idleQA.views[0]; v.mixer.setTime(15.2); });
      await page.waitForTimeout(1000);
      check(await page.evaluate(() => { const v = window.__idleQA.views[0], a = v.mixer._actions[0]; return a.time < 2; }), 'Idle did not wrap across the loop seam');
      result.checks.push('native loop seam');
      await page.locator('.ch-model').dispatchEvent('wheel', { deltaY: -100 });
      await page.locator('[data-view-reset]').click({ force: true });
      check(await page.evaluate(() => window.__mn.panels.charPanel.cam.zoom === 1), 'Reset lost zoom');
      if (!spec.touch) { await page.locator('[data-view="1"]').click(); check(await page.evaluate(() => Math.abs(window.__mn.panels.charPanel.cam.yaw - Math.PI / 2) < .001), 'Turntable view lost'); }
      result.checks.push('zoom/reset/turntable');
      const count = () => page.evaluate(() => window.__idleQA.draws.filter((d) => d.delta > 0).length);
      await page.evaluate(() => { window.__mn.settings.reducedMotion = true; }); await page.waitForTimeout(400);
      let n = await count(); await page.waitForTimeout(350); check(await count() === n, 'Reduced motion did not stop idle');
      await page.evaluate(() => { window.__mn.settings.reducedMotion = false; }); await page.waitForTimeout(500); check(await count() > n, 'Reduced motion did not resume'); result.checks.push('reduced motion stop/resume');
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      n = await count(); await page.waitForTimeout(350); check(await count() === n, 'Hidden document did not stop idle');
      await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForTimeout(350); check(await count() === n, 'Pause menu kept animating the covered sheet');
      await page.locator('#btn-resume').click({ force: true }); await page.waitForTimeout(500);
      check(await count() > n, 'Visible document did not resume'); result.checks.push('visibility / pause menu stop/resume fixture');
      await page.locator('[data-tab="quests"]').click({ force: true }); n = await count(); await page.waitForTimeout(350); check(await count() === n, 'Nonfigure tab kept animating');
      await page.locator('[data-tab="stats"]').click({ force: true }); await page.waitForTimeout(350); check(await count() > n, 'Sheet did not resume'); result.checks.push('tab stop/resume');
      await page.evaluate(() => window.__mn.panels.charPanel.close()); n = await count(); await page.waitForTimeout(350); check(await count() === n, 'Closed sheet kept animating'); result.checks.push('close stops idle');
      if (!spec.touch) {
        await page.evaluate(() => {
          const mn = window.__mn, p = mn.panels.charPanel, renderer = mn.world.renderer;
          p.open('stats');
          const render = renderer.render, target = renderer.getRenderTarget();
          renderer.render = function () { renderer.render = render; throw new Error('Expected native preview QA failure'); };
          p.drawFigure();
          if (renderer.getRenderTarget() !== target) throw new Error('Render target leaked');
          p.close();
        });
        await page.waitForTimeout(250); result.checks.push('native render failure keeps renderer and fallback usable');
        await page.route('**/assets/models/buccaneer-v1-desktop.glb', (route) => route.fulfill({ contentType: 'model/gltf-binary',
          body: execFileSync('git', ['show', '1b32986:assets/models/buccaneer-v1-desktop.glb'], { maxBuffer: 4000000 }) }));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
        await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade')).display === 'none');
        await page.locator('#btn-play').click({ force: true });
        await page.waitForFunction(() => window.__mn.client.joined && window.__mn.st.mode === 'playing' && window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 90000 });
        await page.locator('#hud-bag').click({ force: true }); await page.locator('[data-tab="stats"]').click({ force: true }); await page.waitForTimeout(350);
        check(await page.evaluate(() => !window.__mn.assets.hasCharacterFigure(2) && !window.__mn.panels.charPanel.figureLoop.pending
          && document.querySelector('.ch-model canvas').getContext('2d').getImageData(0, 0, 398, 516).data.some((n) => n > 0)), 'Missing idle clip broke the fallback');
        await page.screenshot({ path: resolve(out, 'desktop-missing-clip.png') }); result.checks.push('actual GLB without idle keeps static fallback');
      }
      check(!result.errors.length, result.errors.join('; ')); result.passed = true; console.log(`${spec.name}: ${result.checks.length} checks passed`);
    } finally { await context.close(); }
  }
} catch (e) { evidence.failure = String(e); throw e; }
finally { await browser.close(); await host.close(); await writeFile(resolve(out, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n'); }
