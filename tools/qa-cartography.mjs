#!/usr/bin/env node
// Serial browser proof against an isolated normal-game host; replacement geography is a display-only fixture.
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';

const out = resolve('docs/delivery/cartography'); await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const evidence = { generatedAt: new Date().toISOString(), localOnly: true, displayFixtureOnly: true,
  purpose: 'Normal game minimap and M overview on foot/helm, shared atlas, and replacement shifted multi-island display metadata. No .env, SQL, live services or performance acceptance.', cases: [] };
const check = (value, message) => { if (!value) throw Error(message); };
const specs = [{ name: 'desktop', width: 1365, height: 768, touch: false },
  { name: 'touch-landscape', width: 844, height: 390, touch: true }, { name: 'touch-portrait', width: 390, height: 844, touch: true }];
if (process.env.MN_QA_VIEWPORT) specs.splice(0, specs.length, ...specs.filter(s => s.name.includes(process.env.MN_QA_VIEWPORT)));

async function routes(page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => route.abort());
  await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async route => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? 'node_modules/three' : '.scratch/gsap-local/package', match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route => route.fulfill({ status: 200, body: '' }));
}
async function snapshot(page, result, name) {
  await page.waitForFunction(() => !__mn.panels.mapView.isOpen || Number(getComputedStyle(document.querySelector('.mapv')).opacity) > .99);
  const file = `${result.name}-${name}.png`; await page.screenshot({ path: resolve(out, file) }); result.screenshots.push(file);
}
async function readings(page) {
  return page.evaluate(() => {
    const m = window.__mn, mini = m.panels.miniMap, map = m.panels.mapView, stage = m.navigation.stage;
    const r = mini.root.getBoundingClientRect(), corners = [[r.left, r.top], [r.right, r.bottom]].map(([x, y]) => stage.toLocal(x, y));
    const data = mini.canvas.getContext('2d').getImageData(0, 0, 192, 192).data, colors = new Set();
    for (let i = 0; i < data.length; i += 4) if (data[i + 3]) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return { visible: !document.querySelector('#hud').hidden && getComputedStyle(mini.root).display !== 'none',
      local: { left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)),
        top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) },
      stage: { width: stage.w, height: stage.h, rotated: stage.rotated }, colors: colors.size,
      player: { x: Number(mini.root.dataset.x), z: Number(mini.root.dataset.z) }, span: map.span,
      title: map.description.title, labels: [...document.querySelectorAll('.mapv-labels span')].map(p => p.textContent),
      open: map.isOpen, errors: [...m.errors], baseSize: map.base && [map.base.width, map.base.height] };
  });
}

try {
  for (const spec of specs) {
    const result = { ...spec, screenshots: [], errors: [], status: 'running' }; evidence.cases.push(result);
    const host = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, maxPlayers: 1, dev: false,
      worldId: null, store: createMemoryStore(), saveSecret: `qa-cartography-${spec.name}`, chat: { enabled: false }, log() {} });
    let context;
    try {
      const port = await host.listen(); context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, hasTouch: spec.touch, isMobile: spec.touch });
      const page = await context.newPage(); page.on('pageerror', e => result.errors.push(e.message)); await routes(page);
      await page.goto(`http://127.0.0.1:${port}/?debug&q=low`);
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
      await page.locator('#btn-play').click({ force: true });
      await page.waitForFunction(() => window.__mn?.client?.joined && window.__mn.st.mode === 'playing' && window.__mn.input.enabled
        && document.querySelector('.world-minimap')?.dataset.x, null, { timeout: 90000 });
      result.foot = await readings(page);
      check(result.foot.visible && result.foot.colors > 16 && !result.foot.errors.length, 'minimap is missing, empty, or failed on foot');
      const bounds = result.foot.local, stage = result.foot.stage;
      check(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= stage.width && bounds.bottom <= stage.height, 'minimap escapes the stage');
      await snapshot(page, result, '01-foot');
      if (spec.touch) await page.locator('.world-minimap').tap(); else await page.keyboard.press('KeyM');
      await page.waitForFunction(() => window.__mn.panels.mapView.isOpen);
      result.overview = await readings(page); check(result.overview.span === 255 && result.overview.labels.length >= 4, 'current overview lost island labels');
      result.sharedAtlas = await page.evaluate(async () => {
        const { mapAtlas } = await import('/src/ui/mapCanvas.js');
        return mapAtlas(__mn.map, document).base === __mn.panels.mapView.base;
      }); check(result.sharedAtlas, 'charts do not share the terrain atlas');
      await snapshot(page, result, '02-overview'); await page.keyboard.press('Escape');
      await page.waitForFunction(() => !window.__mn.panels.mapView.isOpen);
      const entity = await page.evaluate(() => __mn.client.youServer), world = host.game.server.world;
      const raft = publicRafts(world).find(r => r.owner === entity), helm = pilotPoint(raft, raft.helm), ecs = world.ecs;
      ecs.x[entity] = helm.x; ecs.y[entity] = helm.y; ecs.z[entity] = helm.z; ecs.facing[entity] = helm.f;
      ecs.vx[entity] = ecs.vz[entity] = ecs.moveMag[entity] = 0; world.raftDeck.update(publicRafts(world)); host.game.server.broadcastSnapshot();
      await page.waitForFunction(() => window.__mn.navigation.canAct() && window.__mn.navigation.keyAction('F')?.verb === 'Pilotar');
      if (spec.touch) await page.locator('.ln-prompt [data-run]').tap(); else await page.keyboard.press('KeyF');
      await page.waitForFunction(() => __mn.client.naval.active && document.body.classList.contains('is-naval'));
      await page.waitForFunction(() => Math.abs(Number(__mn.panels.miniMap.root.dataset.x) - __mn.navigation.lastPose.x) < .1);
      result.helm = await readings(page); check(result.helm.visible && result.helm.colors > 16, 'chart disappears at helm');
      await snapshot(page, result, '03-helm');
      if (spec.touch) await page.locator('.world-minimap').tap(); else await page.keyboard.press('KeyM');
      await page.waitForFunction(() => __mn.panels.mapView.isOpen);
      result.helmOverview = await readings(page); check(result.helmOverview.open, 'overview cannot open at helm');
      result.helmOverview.uncovered = await page.evaluate(() => {
        const canvas = document.querySelector('.mapv-body canvas'), r = canvas.getBoundingClientRect();
        return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height * .85)?.closest('#mapview');
      });
      check(result.helmOverview.uncovered, 'naval controls cover the overview');
      await page.keyboard.press('Escape');
      // Change UI map inputs only. This does not install alpha towns or change authoritative terrain.
      result.replacement = await page.evaluate(() => {
        const m = __mn; m.loop.running = false; m.input.clearActions(); m.client.neutralNaval();
        const points = [{ id: 'a', name: 'Puerto de ensayo', kind: 'town', x: 1000, z: 0 },
          { id: 'b', name: 'Isla de ensayo', kind: 'town', x: 1600, z: 450 }];
        const chart = { cartography: { title: 'Archipiélago · fixture visual', revision: 'qa-1',
          bounds: { minX: 700, maxX: 1900, minZ: -300, maxZ: 700 }, points, regions: [] },
          groundAt(x, z) { return points.some(p => Math.hypot(x - p.x, z - p.z) < 110) ? 3 : -6; } };
        const player = { x: 1000, z: 0, f: 0 }, markers = { target: { ...points[1], label: 'Isla de ensayo' } };
        m.panels.miniMap.setMap(chart); m.panels.mapView.setMap(chart);
        m.panels.mapView.open(); m.panels.mapView.update(player, [], null, 0, markers); m.panels.miniMap.update(1, player, markers);
        window.__qaChart = chart;
        return { span: m.panels.mapView.span, playerPixel: m.panels.mapView.px(player.x, player.z, 640),
          pins: points.map(p => m.panels.mapView.px(p.x, p.z, 640)), labels: [...document.querySelectorAll('.mapv-labels span')].map(p => p.textContent),
          title: document.querySelector('.mapv-title').textContent, noLegacy: !document.querySelector('.mapv-labels').textContent.includes('Caldera') };
      });
      check(result.replacement.span > 700 && result.replacement.noLegacy && result.replacement.pins.flat().every(v => v >= 0 && v <= 640), 'replacement map is cropped or contains stale locations');
      await snapshot(page, result, '04-replacement-overview');
      result.revision = await page.evaluate(async () => {
        const { mapAtlas } = await import('/src/ui/mapCanvas.js'), m = __mn, old = m.panels.mapView.base, map = window.__qaChart;
        map.cartography.revision = 'qa-2'; map.cartography.title = 'Revisión de ensayo';
        map.groundAt = () => -6; m.panels.mapView.update({ x: 1000, z: 0, f: 0 }, [], null, 0);
        m.panels.miniMap.update(1, { x: 1000, z: 0, f: 0 });
        const fresh = mapAtlas(map, document), pixel = [...fresh.base.getContext('2d').getImageData(320, 320, 1, 1).data];
        return { newBase: fresh.base !== old, shared: m.panels.mapView.base === fresh.base,
          title: document.querySelector('.mapv-title').textContent, miniRevision: m.panels.miniMap.root.dataset.revision, pixel };
      });
      check(result.revision.newBase && result.revision.shared && result.revision.miniRevision === 'qa-2'
        && result.revision.title === 'Revisión de ensayo' && result.revision.pixel[1] === 60, 'revision did not invalidate both charts');
      result.terrainInvalidation = await page.evaluate(async () => {
        const { mapAtlas } = await import('/src/ui/mapCanvas.js'), map = window.__qaChart, first = mapAtlas(map, document);
        map.terrainRevision = 1; const terrain = mapAtlas(map, document);
        map.groundAt = () => 3; const query = mapAtlas(map, document);
        const result = { terrainRevision: terrain !== first, queryChange: query !== terrain };
        map.groundAt = () => -6; __mn.panels.mapView.update({ x: 1000, z: 0, f: 0 }, [], null, 0);
        __mn.panels.miniMap.update(1, { x: 1000, z: 0, f: 0 });
        return result;
      });
      check(result.terrainInvalidation.terrainRevision && result.terrainInvalidation.queryChange, 'terrain/query changes retain an obsolete atlas');
      await page.evaluate(() => { __mn.panels.mapView.close(); }); await snapshot(page, result, '05-replacement-minimap');
      result.disposal = await page.evaluate(() => { const mini = __mn.panels.miniMap; mini.dispose(); return mini.disposed && !document.querySelector('.world-minimap'); });
      check(result.disposal && !result.errors.length, `chart cleanup or runtime errors: ${JSON.stringify(result.errors)}`);
      result.status = 'passed'; console.log(`${spec.name}: passed`);
    } catch (error) { result.status = 'failed'; result.failure = String(error.stack || error); console.log(`${spec.name}: ${error.message}`); }
    finally { await context?.close(); await host.close(); }
  }
} finally { await browser.close(); await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2)); }
if (!evidence.cases.length || evidence.cases.some(c => c.status !== 'passed')) process.exitCode = 1;
