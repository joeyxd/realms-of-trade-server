import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const base = 'https://marea.62.171.136.148.sslip.io';
const out = resolve('docs/delivery/buccaneer-v1/idle/public');
await mkdir(out, { recursive: true });
const evidence = { generatedAt: new Date().toISOString(), expectedRevision: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(), sources: [], viewports: [] };
const check = (x, m) => { if (!x) throw new Error(m); };
const hash = (b) => createHash('sha256').update(b).digest('hex');
const status = async () => {
  const s = await (await fetch(`${base}/status`)).json();
  return { version: s.version, players: s.players, sockets: s.sockets, errors: s.errors,
    storage: { kind: s.storage.kind, durable: s.storage.durable, accounts: s.storage.accounts,
      errors: s.storage.errors, unsaved: s.storage.unsaved, tickBlocked: s.storage.tickBlocked, worldReady: s.storage.world?.ready } };
};
evidence.before = await status(); check(evidence.before.version === '0.6.0-alpha.56', 'Wrong public version');
for (const file of ['assets/manifest.json', 'src/data/meta.js', 'src/render/characters.js', 'src/render/charlooks.js', 'src/render/assets/manifest.js', 'src/render/assets/registry.js', 'src/render/assets/characterFigure.js', 'src/render/assets/rebind.js', 'src/ui/figureLoop.js', 'src/ui/characterScreen.js', 'src/main.js', 'assets/models/buccaneer-v1-desktop.glb', 'assets/models/buccaneer-v1-mobile.glb', 'assets/ui/portraits/buccaneer-v1-desktop.webp', 'assets/ui/portraits/buccaneer-v1-mobile.webp']) {
  const response = await fetch(`${base}/${file}`, { cache: 'no-cache' });
  check(response.ok, `Missing ${file}`);
  const actual = Buffer.from(await response.arrayBuffer()), expected = execFileSync('git', ['show', `HEAD:${file}`], { maxBuffer: 8000000 });
  check(hash(actual) === hash(expected), `Hash mismatch ${file}`);
  evidence.sources.push({ file, sha256: hash(actual), bytes: actual.length, matchesGit: true });
}
const { chromium } = await import(pathToFileURL(process.env.MN_PLAYWRIGHT).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  for (const spec of [{ name: 'desktop', width: 1280, height: 900, touch: false }, { name: 'mobile', width: 844, height: 390, touch: true }]) {
    const result = { ...spec, errors: [], requests: [] }; evidence.viewports.push(result);
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, hasTouch: spec.touch, isMobile: spec.touch });
    try {
      await context.addInitScript(() => localStorage.setItem('mareanegra.v1.settings', JSON.stringify({ skin: 2, name: 'QA_Bucanero', quality: 'low', muted: true, reducedMotion: false })));
      const page = await context.newPage();
      await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\//, (route) => {
        const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
        const file = resolve(match[1].startsWith('three') ? 'node_modules/three' : process.env.MN_GSAP, match[2]);
        return fs.existsSync(file) ? route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) }) : route.abort();
      });
      page.on('pageerror', (err) => result.errors.push(String(err)));
      page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) result.errors.push(m.text()); });
      page.on('request', (r) => { if (/buccaneer-v1/.test(r.url())) result.requests.push(r.url()); });
      await page.goto(`${base}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled, null, { timeout: 180000 });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade')).display === 'none');
      await page.screenshot({ path: resolve(out, `${spec.name}-selector.png`) });
      await page.locator('#btn-play').click({ force: true });
      await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing' && window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 90000 });
      result.player = await page.evaluate(() => {
        const mn = window.__mn, r = mn.client.entities.get(mn.client.youServer);
        return { online: mn.transport.kind === 'ws', skin: r.skin, imported: r.view?.ext?.id,
          height: r.view?.height, portraitFrame: r.view?.look.portraitFrame, figureZoom: r.view?.look.figureZoom,
          tris: r.view?.built.geo.attributes.position.count / 3, assets: mn.assets.list().filter((x) => /buccaneer/.test(x.id)),
          albedo: mn.assets.data('char:buccaneer-v1').bake.groups[0].mat.map.image.width,
          portrait: mn.assets.texture('tex:portrait-buccaneer-v1').image.width };
      });
      check(result.player.online && result.player.skin === 2 && result.player.imported === 'char:buccaneer-v1', 'Public player is not the imported Bucanero');
      check(Math.abs(result.player.height - 2.12) < .001 && result.player.portraitFrame.zoom === 1.6 && result.player.figureZoom === 1.1, 'Wrong public size presentation');
      check(result.player.albedo === (spec.touch ? 512 : 1024) && result.player.portrait === (spec.touch ? 256 : 512), 'Public resolution mismatch');
      check(result.requests.filter((u) => u.endsWith('.glb')).length === 1, 'Duplicate public GLB load');
      await page.screenshot({ path: resolve(out, `${spec.name}-game.png`) });
      await page.evaluate(() => {
        window.__publicFigures = [];
        const a = window.__mn.assets, make = a.characterFigure.bind(a);
        a.characterFigure = (...args) => { const v = make(...args); window.__publicFigures.push(v); return v; };
      });
      await page.locator('#hud-bag').click({ force: true }); await page.locator('[data-tab="stats"]').click({ force: true });
      await page.waitForSelector('.ch-model canvas'); await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => window.__publicFigures[0]?.mixer.time > .25);
      const start = await page.evaluate(() => window.__publicFigures[0].mixer.time);
      await page.waitForTimeout(700);
      result.sheet = await page.evaluate(() => {
        const v = window.__publicFigures[0], bones = [];
        v.root.traverse((o) => { if (o.isSkinnedMesh) bones.push(o.skeleton.bones.length); });
        return { nativeIdle: v.nativeIdle, time: v.mixer.time, bones, pending: window.__mn.panels.charPanel.figureLoop.pending };
      });
      check(result.sheet.nativeIdle && result.sheet.time > start && result.sheet.bones.every((n) => n === 65), 'Public native idle is not advancing');
      await page.screenshot({ path: resolve(out, `${spec.name}-character.png`) });
      check(!result.errors.length, `Public browser errors ${result.errors.join('; ')}`);
      result.status = 'passed'; console.log(`${spec.name}: passed`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
evidence.after = await status();
check(!evidence.after.errors && !evidence.after.storage.errors && !evidence.after.storage.unsaved, 'Public server errors after QA');
await writeFile(resolve(out, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(`Public verified: ${evidence.sources.length} hashes, ${evidence.viewports.length} browsers`);
