// Same-pose size comparison against the shipped alpha.52 presentation, on an isolated memory host.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';

const out = resolve(process.env.MN_SIZE_OUT || 'docs/delivery/buccaneer-v1/size-review');
await mkdir(out, { recursive: true });
const baseline = 'f26aae2090d0a9edd8ed7229714db89192d52f80';
const previous = new Map(['assets/manifest.json', 'src/render/charlooks.js', 'src/render/characters.js']
  .map((file) => [file, execFileSync('git', ['show', `${baseline}:${file}`])]));
const { chromium } = await import(pathToFileURL(process.env.MN_PLAYWRIGHT).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const host = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 2, dev: false,
  worldId: null, store: createMemoryStore(), saveSecret: 'isolated-size-review', chat: { enabled: false }, log() {} });
const evidence = { generatedAt: new Date().toISOString(), baseline, sessions: [] };
const check = (x, m) => { if (!x) throw new Error(m); };
try {
  const port = await host.listen();
  for (const spec of [{ name: 'desktop', width: 1280, height: 900, touch: false }, { name: 'mobile', width: 844, height: 390, touch: true }]) {
    for (const variant of ['before', 'after']) {
      const result = { ...spec, variant, errors: [] }; evidence.sessions.push(result);
      const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, hasTouch: spec.touch, isMobile: spec.touch });
      try {
        await context.addInitScript(() => localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ skin: 2, name: 'Bucanero', quality: 'low', muted: true, reducedMotion: true })));
        const page = await context.newPage();
        await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\//, (route) => {
          const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
          const file = resolve(match[1].startsWith('three') ? 'node_modules/three' : process.env.MN_GSAP, match[2]);
          return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
        });
        if (variant === 'before') await page.route(/\/(assets\/manifest\.json|src\/render\/(charlooks|characters)\.js)(\?.*)?$/, (route) => {
          const file = new URL(route.request().url()).pathname.slice(1);
          return route.fulfill({ contentType: file.endsWith('.json') ? 'application/json' : 'text/javascript', body: previous.get(file) });
        });
        page.on('pageerror', (e) => result.errors.push(String(e)));
        await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
        await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade')).display === 'none');
        await page.screenshot({ path: resolve(out, `${spec.name}-${variant}-selector.png`) });
        await page.locator('#btn-play').click({ force: true });
        await page.waitForFunction(() => window.__mn?.client.joined && window.__mn.st.mode === 'playing' && window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 90000 });
        result.presentation = await page.evaluate(async () => {
          const THREE = await import('three');
          const { CharacterView, PortraitStudio } = await import('/src/render/characters.js');
          const mn = window.__mn, rec = mn.client.entities.get(mn.client.youServer);
          const studio = new PortraitStudio(mn.world.renderer), v = studio.view(2);
          // Remove random breathing/weight shift from the comparison.
          v.seed = 0; v.t = 0;
          v.update(0, { x: 0, y: 0, z: 0, f: 0, vx: 0, vz: 0, st: 0, wade: 1 });
          const samples = [];
          const bounds = (c) => {
            const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
            for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (data[(y * c.width + x) * 4 + 3] > 40) {
              x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
            }
            return { x0, y0, x1, y1, width: c.width, height: c.height, coverageY: (y1 - y0 + 1) / c.height };
          };
          for (const yaw of [0, 0.38, Math.PI / 2, Math.PI]) {
            const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 560;
            studio.renderFigure(2, canvas, { yaw }); samples.push({ yaw, ...bounds(canvas) });
          }
          const portrait = studio.render(2);
          // Project a fixed world-space height through the same camera for both sizes.
          const camera = new THREE.PerspectiveCamera(35, 1280 / 900, 0.5, 1400);
          camera.position.set(0, 15, 13.228756555); camera.lookAt(0, 0.9, 0); camera.updateMatrixWorld();
          const foot = new THREE.Vector3(0, 0, 0).project(camera), head = new THREE.Vector3(0, v.height, 0).project(camera);
          const strip = document.createElement('div'); strip.id = 'size-comparison';
          strip.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#183346;display:flex;align-items:center;justify-content:center;gap:20px';
          const figure = document.createElement('canvas'); figure.width = 360; figure.height = 560;
          studio.renderFigure(2, figure, { yaw: .38 }); strip.append(portrait, figure); document.body.append(strip);
          return { imported: rec.view.ext.id, height: rec.view.height, portrait: portrait.toDataURL(),
            projectedHeightPixels: Math.abs(head.y - foot.y) * 450, samples,
            albedo: mn.assets.data('char:buccaneer-v1').bake.groups[0].mat.map.image.width };
        });
        await page.screenshot({ path: resolve(out, `${spec.name}-${variant}-fixed-pose.png`) });
        // Store the actual canvas without changing the original asset.
        await writeFile(resolve(out, `${spec.name}-${variant}-portrait.png`), Buffer.from(result.presentation.portrait.split(',')[1], 'base64'));
        delete result.presentation.portrait;
        await page.evaluate(() => document.querySelector('#size-comparison').remove());
        await page.screenshot({ path: resolve(out, `${spec.name}-${variant}-game.png`) });
        await page.locator('#hud-bag').click({ force: true }); await page.locator('[data-tab="stats"]').click({ force: true });
        await page.waitForSelector('.ch-model canvas'); await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: resolve(out, `${spec.name}-${variant}-sheet.png`) });
        check(result.presentation.imported === 'char:buccaneer-v1', 'Wrong live model');
        check(result.presentation.albedo === (spec.touch ? 512 : 1024), 'Wrong device texture');
        check(result.presentation.samples.every((s) => s.x0 > 0 && s.y0 > 0 && s.x1 < s.width - 1 && s.y1 < s.height - 1), 'Full-body figure clipped');
        check(result.errors.length === 0, result.errors.join('; '));
        result.passed = true; console.log(`${spec.name} ${variant}: height ${result.presentation.height}, figure ${(result.presentation.samples[1].coverageY * 100).toFixed(1)}%`);
      } finally { await context.close(); }
    }
    const [before, after] = evidence.sessions.filter((s) => s.name === spec.name).map((s) => s.presentation);
    check(after.height > before.height * 1.12 && after.height < before.height * 1.13, 'World size did not increase 12%');
    check(after.samples[1].coverageY > before.samples[1].coverageY * 1.08, 'Sheet did not move closer');
  }
} finally { await browser.close(); await host.close(); }
await writeFile(resolve(out, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log('Size comparison passed: four browser sessions, four angles each.');
