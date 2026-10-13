// Browser acceptance for imported world-item models. Uses an isolated, in-memory game host.
// Do not point this script at the public server: its resource event is a local cosmetic fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';

const root = resolve('.');
const out = resolve(process.env.MN_ITEM_MODELS_OUT || 'docs/delivery/item-models-v1/local');
const ids = ['model:item-antorcha-v1', 'model:item-resina-v1', 'model:item-coco-v1'];
const atlasWood = { u0: .012, v0: .512, u1: .488, v1: .988 };
await mkdir(out, { recursive: true });
const playwrightPath = resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const host = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 2, dev: false,
  worldId: null, store: createMemoryStore(), saveSecret: 'isolated-item-model-visual-qa',
  chat: { enabled: false }, log() {} });
const browser = await chromium.launch({ headless: true,
  ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : { channel: 'chrome' }),
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const evidence = {
  generatedAt: new Date().toISOString(),
  scope: 'local Chrome browser acceptance on an isolated in-memory game host; no production authority or persistence writes',
  viewports: [], failures: [],
};
const must = (value, message) => { if (!value) throw new Error(message); };
const frameMetrics = async (page, frames = 36) => page.evaluate(async (count) => {
  const renderer = __mn.world.renderer;
  renderer.info.reset();
  const intervals = [];
  let previous = performance.now();
  for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame((time) => {
    intervals.push(time - previous); previous = time; resolve();
  }));
  const sorted = [...intervals].sort((a, b) => a - b);
  return { frames: count,
    meanFrameMs: intervals.reduce((sum, n) => sum + n, 0) / intervals.length,
    p95FrameMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))],
    renderCalls: renderer.info.render.calls,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
}, frames);

try {
  const port = await host.listen();
  for (const spec of [
    { name: 'desktop', width: 1280, height: 720, touch: false, mapSize: 512 },
    { name: 'mobile-landscape', width: 844, height: 390, touch: true, mapSize: 256 },
  ]) {
    const result = { ...spec, errors: [], requests: [], checks: [], screenshots: [] };
    evidence.viewports.push(result);
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height },
      hasTouch: spec.touch, isMobile: spec.touch, deviceScaleFactor: 1 });
    const page = await context.newPage();
    try {
      await page.addInitScript(() => localStorage.setItem('mareanegra.v1.settings', JSON.stringify({
        skin: 0, name: 'Modelo QA', quality: 'low', muted: true, landscape: false, reducedMotion: true,
      })));
      page.on('pageerror', (error) => result.errors.push(String(error)));
      page.on('console', (message) => {
        if (message.type() === 'error' && !/Failed to load resource|fonts\.g/.test(message.text())) result.errors.push(message.text());
      });
      page.on('request', (request) => {
        if (/\.glb(?:[?#]|$)|assets\/editor\/(catalog|thumbnails)\.json/.test(request.url())) result.requests.push(request.url());
      });
      await page.goto(`http://127.0.0.1:${port}/?debug&q=low`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play')?.disabled,
        null, { timeout: 180000 });

      result.bootModels = await page.evaluate((wanted) => {
        const assets = window.__mn.assets;
        return wanted.map((id) => {
          const entry = assets.entry(id), state = assets.list().find((row) => row.id === id), data = assets.data(id);
          const maps = (data?.parts || []).flatMap((part) => (Array.isArray(part.mat) ? part.mat : [part.mat])
            .filter(Boolean).map((material) => {
              const image = material.map?.image;
              return image ? { width: image.width, height: image.height, url: image.currentSrc || image.src || '' } : null;
            }).filter(Boolean));
          return { id, src: entry?.src, mobileSrc: entry?.mobileSrc, selectedSrc: state?.selectedSrc,
            state: state?.state, tris: state?.tris, maps, parts: data?.parts?.length || 0 };
        });
      }, ids);
      result.deferredAtBoot = await page.evaluate(() => {
        const assets = window.__mn.assets, requests = performance.getEntriesByType('resource').map((entry) => entry.name);
        return assets.list().map((row) => ({ ...row, entry: assets.entry(row.id) }))
          .filter((row) => row.entry?.kind === 'model' && row.entry.preload === false)
          .map((row) => ({ id: row.id, state: row.state, src: row.entry.src, mobileSrc: row.entry.mobileSrc || null,
            fetched: requests.some((url) => url.endsWith('/' + row.entry.src)
              || (row.entry.mobileSrc && url.endsWith('/' + row.entry.mobileSrc))) }));
      });
      must(result.bootModels.length === 3 && result.bootModels.every((model) => model.state === 'ok'),
        'The torch, resin, and coconut models did not all load at boot.');
      must(result.bootModels.every((model) => model.src && model.mobileSrc && model.maps.length > 0),
        'Each boot model needs desktop/mobile GLB sources with an embedded base-color map.');
      must(result.bootModels.every((model) => model.maps.every((map) => map.width === spec.mapSize && map.height === spec.mapSize)),
        `Expected embedded ${spec.mapSize}x${spec.mapSize} model maps on ${spec.name}.`);
      must(result.bootModels.every((model) => model.selectedSrc === (spec.touch ? model.mobileSrc : model.src)),
        `Wrong model source selected for ${spec.name}.`);
      must(result.deferredAtBoot.length === 9 && result.deferredAtBoot.every((row) => row.state === 'pending' && !row.fetched),
        `Expected nine non-boot models to remain pending without downloads on ${spec.name}.`);
      for (const model of result.bootModels) {
        const file = spec.touch ? model.mobileSrc : model.src;
        const requests = result.requests.filter((url) => new URL(url).pathname.endsWith('/' + file.replaceAll('\\', '/')));
        must(requests.length === 1, `${model.id} should request exactly one device GLB (${file}); saw ${requests.length}.`);
      }
      result.checks.push('booted all three registered item models', 'one GLB device variant requested per item',
        `read embedded maps at ${spec.mapSize}x${spec.mapSize}`);
      await page.screenshot({ path: resolve(out, `${spec.name}-boot-title.png`) });
      result.screenshots.push(`${spec.name}-boot-title.png`);

      await page.locator('#btn-play').click({ force: true });
      await page.waitForFunction(() => window.__mn?.client.joined && window.__mn.st.mode === 'playing'
        && window.__mn.input.enabled && !window.__mn.st.paused, null, { timeout: 60000 });
      result.player = await page.evaluate(() => ({ joined: __mn.client.joined, id: __mn.client.youServer,
        mode: __mn.st.mode, renderer: __mn.world.renderer.info.render.calls }));
      must(result.player.joined && result.player.mode === 'playing', 'The browser did not join the isolated game.');
      result.checks.push('joined the real game client against the local memory host');
      await page.screenshot({ path: resolve(out, `${spec.name}-joined-overview.png`) });
      result.screenshots.push(`${spec.name}-joined-overview.png`);

      result.wood = await page.evaluate((rect) => {
        const resources = __mn.world.resources, atlas = __mn.assets.texture('tex:raft-comic-v1');
        const material = resources.woodPaint, uv = resources.wood?.getAttribute?.('uv');
        const values = [];
        if (uv) for (let i = 0; i < uv.count; i++) values.push([uv.getX(i), uv.getY(i)]);
        const finite = values.length > 0 && values.every((pair) => pair.every(Number.isFinite));
        const insideWood = finite && values.every(([u, v]) => u >= rect.u0 - .001 && u <= rect.u1 + .001
          && v >= rect.v0 - .001 && v <= rect.v1 + .001);
        return { atlasLoaded: !!atlas, sameAtlas: material?.map === atlas, material: material?.name,
          uvCount: values.length, finiteUv: finite, insideAtlasWoodSwatch: insideWood,
          atlasSize: atlas?.image ? [atlas.image.width, atlas.image.height] : null,
          woodGeometryVertices: resources.wood?.getAttribute?.('position')?.count || 0 };
      }, atlasWood);
      must(result.wood.atlasLoaded && result.wood.sameAtlas && result.wood.finiteUv
        && result.wood.insideAtlasWoodSwatch && result.wood.woodGeometryVertices > 0,
      'Collectible wood does not render from the raft atlas with finite UVs inside the wood swatch.');
      result.checks.push('collectible wood material uses the loaded raft atlas', 'wood UVs map inside the atlas wood swatch');

      result.cosmetic = await page.evaluate(async () => {
        const THREE = await import('three');
        const { CharacterView } = await import('/src/render/characters.js');
        const view = new CharacterView(0, { sword: false });
        const imported = view.personalLantern?.children?.find((child) => child.name === 'model:item-antorcha-v1');
        view.setLantern(false, true);
        const unlit = { imported: !!imported, flame: view.personalLanternFlame.visible,
          core: view.personalLanternCore.visible, carried: view.personalLantern.visible };
        view.setLantern(true, true);
        const lit = { flame: view.personalLanternFlame.visible, core: view.personalLanternCore.visible,
          carried: view.personalLantern.visible };
        const hidden = (() => { view.setLantern(true, false); return {
          flame: view.personalLanternFlame.visible, core: view.personalLanternCore.visible,
          carried: view.personalLantern.visible,
        }; })();
        view.setLantern(false, false);
        return { unlit, lit, hidden, three: !!THREE.Scene };
      });
      must(result.cosmetic.unlit.imported && !result.cosmetic.unlit.flame && !result.cosmetic.unlit.core
        && result.cosmetic.lit.flame && result.cosmetic.lit.core && result.cosmetic.hidden.carried === false
        && !result.cosmetic.hidden.flame && !result.cosmetic.hidden.core,
      'The CharacterView lantern fixture did not toggle imported torch and flame/core visibility correctly.');
      result.checks.push('CharacterView imported torch is unlit by default', 'setLantern toggles flame/core and carried visibility');

      result.awardHook = await page.evaluate(async () => {
        const { bus } = await import('/src/core/events.js');
        const { world, client, resources } = __mn;
        const before = world.harvestGoods.items.length;
        const opId = 'item-model-qa-local-award';
        const node = { id: 'qa-node-item-models', kind: 'wood', x: client.ps?.x ?? __mn.ps.x, y: 0, z: client.ps?.z ?? __mn.ps.z };
        const oldNodes = client.resources.nodes;
        client.resources.nodes = [...oldNodes, node];
        resources.gathers.set(opId, { command: { op: 'gather', opId, node: node.id, expectedRev: 0 },
          def: { tool: false }, good: 'tronco', count: 1, sentAt: 0, until: 0 });
        const event = { type: 'resource', op: 'gather', ok: true, felled: true, replay: false, historical: false,
          opId, rev: 1, count: 1, profileRev: 1, actionTicks: 1, loot: { resina: 1, coco: 1 } };
        bus.emit('resource', event);
        const first = world.harvestGoods.items.length;
        bus.emit('resource', event);
        const second = world.harvestGoods.items.length;
        const rows = world.harvestGoods.items.slice(before).map(({ object }) => object.userData.harvestGood);
        client.resources.nodes = oldNodes;
        world.harvestGoods.reset();
        return { before, first, second, rows, authority: 'isolated memory host only' };
      });
      must(result.awardHook.first === result.awardHook.before + 2
        && result.awardHook.second === result.awardHook.first
        && result.awardHook.rows.sort().join(',') === 'coco,resina',
      'The real resource event hook did not resolve its acknowledged node through resources.gathers or deduplicate the cosmetic award.');
      result.checks.push('main.js resource hook maps ack opId to the gathered node',
        'cosmetic resina/coco reveal is receipt-deduplicated and does not write game authority');

      result.lineup = await page.evaluate(async () => {
        const THREE = await import('three');
        const world = __mn.world, assets = __mn.assets;
        const scene = world.scene, renderer = world.renderer, camera = world.camera;
        const group = new THREE.Group(); group.name = 'qa-item-models-temporary-lineup';
        const direction = new THREE.Vector3(0, 0, -1); camera.getWorldDirection(direction).normalize();
        const target = camera.position.clone().addScaledVector(direction, 7);
        const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
        const models = ['model:item-antorcha-v1', 'model:item-resina-v1', 'model:item-coco-v1'];
        const originals = [];
        for (const [index, id] of models.entries()) {
          const object = assets.model(id);
          if (!object) throw new Error(`assets.model unavailable for ${id}`);
          object.scale.setScalar(1.05); object.position.copy(right).multiplyScalar((index - 1) * 1.2);
          object.position.add(target); object.position.y -= .65;
          group.add(object); originals.push(object);
        }
        const { CharacterView } = await import('/src/render/characters.js');
        const torch = new CharacterView(0, { sword: false }); torch.setLantern(true, true);
        torch.root.scale.setScalar(.34); torch.root.position.copy(target).addScaledVector(right, -2.6); torch.root.position.y -= .42;
        group.add(torch.root); originals.push(torch.root);
        const resources = world.resources;
        const wood = new THREE.Mesh(resources.wood, resources.woodPaint);
        wood.position.copy(target).addScaledVector(right, 2.8); wood.position.y -= .55;
        wood.scale.setScalar(.85); group.add(wood); originals.push(wood);
        const sceneChildrenBefore = scene.children.length;
        scene.add(group);
        const warm = await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const baseline = { sceneChildren: group.children.length, geometryRefs: new Set(), materialRefs: new Set() };
        group.traverse((object) => {
          if (object.geometry) baseline.geometryRefs.add(object.geometry);
          for (const material of (Array.isArray(object.material) ? object.material : [object.material])) if (material) baseline.materialRefs.add(material);
        });
        const baselineFrames = await measure(30);
        const copies = new THREE.Group(); copies.name = 'qa-item-models-48-copy-stress';
        for (let index = 0; index < 48; index++) {
          const source = originals[index % originals.length];
          const copy = source.clone(true);
          const col = index % 8, row = Math.floor(index / 8);
          copy.scale.multiplyScalar(.28);
          copy.position.copy(target).addScaledVector(right, -2.8 + col * .8);
          copy.position.y += .15 + row * .42;
          copies.add(copy);
        }
        group.add(copies);
        const stressFrames = await measure(45);
        const copiedRefs = { geometryRefs: new Set(), materialRefs: new Set() };
        copies.traverse((object) => {
          if (object.geometry) copiedRefs.geometryRefs.add(object.geometry);
          for (const material of (Array.isArray(object.material) ? object.material : [object.material])) if (material) copiedRefs.materialRefs.add(material);
        });
        group.remove(copies);
        const postFrames = await measure(30);
        const originalFov = camera.fov;
        window.__qaItemModels = { group, copies, originals, torch, scene, camera, originalFov, target, sceneChildrenBefore };
        return { target: target.toArray(), counts: { baseline: originals.length, stress: 48, removedCopies: copies.children.length },
          references: { baselineGeometries: baseline.geometryRefs.size, baselineMaterials: baseline.materialRefs.size,
            copyGeometries: copiedRefs.geometryRefs.size, copyMaterials: copiedRefs.materialRefs.size,
            sharedOnly: [...copiedRefs.geometryRefs].every((ref) => baseline.geometryRefs.has(ref))
              && [...copiedRefs.materialRefs].every((ref) => baseline.materialRefs.has(ref)) },
          baselineFrames, stressFrames, postFrames, warm: warm !== undefined };

        async function measure(frames) {
          renderer.info.reset();
          const intervals = []; let prior = performance.now();
          for (let i = 0; i < frames; i++) await new Promise((resolve) => requestAnimationFrame((time) => {
            intervals.push(time - prior); prior = time; resolve();
          }));
          const sorted = [...intervals].sort((a, b) => a - b);
          return { frames, meanFrameMs: intervals.reduce((sum, n) => sum + n, 0) / intervals.length,
            p95FrameMs: sorted[Math.floor(sorted.length * .95)], calls: renderer.info.render.calls,
            geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
        }
      });
      must(result.lineup.references.sharedOnly, 'Stress copies allocated new model geometry/material instead of sharing the loaded assets.');
      must(result.lineup.stressFrames.calls > result.lineup.baselineFrames.calls
        && result.lineup.postFrames.geometries === result.lineup.baselineFrames.geometries
        && result.lineup.postFrames.textures === result.lineup.baselineFrames.textures,
      'The 48-copy fixture did not increase draw calls or scene/resource counters failed to return to the warmed baseline after copy removal.');
      await page.screenshot({ path: resolve(out, `${spec.name}-item-lineup.png`) });
      result.screenshots.push(`${spec.name}-item-lineup.png`);
      await page.evaluate(async () => {
        const THREE = await import('three');
        const fixture = window.__qaItemModels, { group, originals, camera, torch } = fixture;
        const world = __mn.world, ps = __mn.ps;
        fixture.rig = world.rig;
        fixture.rigHadOwnUpdate = Object.prototype.hasOwnProperty.call(world.rig, 'update');
        fixture.rigUpdate = world.rig.update;
        world.rig.update = () => {};
        fixture.cameraPosition = camera.position.clone(); fixture.cameraQuaternion = camera.quaternion.clone();
        fixture.cameraUp = camera.up.clone(); fixture.cameraFov = camera.fov;
        fixture.hud = document.querySelector('#hud'); fixture.hudOpacity = fixture.hud?.style.opacity || '';
        if (fixture.hud) fixture.hud.style.opacity = '0';
        fixture.closeTarget = new THREE.Vector3((ps?.x ?? 0) + 7, (ps?.y ?? 0) + 1.2, ps?.z ?? 0);
        fixture.setCamera = (target) => {
          camera.position.copy(target).add(new THREE.Vector3(3, 3, 4));
          camera.up.set(0, 1, 0); camera.lookAt(target); camera.fov = 30; camera.updateProjectionMatrix();
        };
        for (const object of group.children) object.visible = false;
        torch.root.scale.setScalar(.82); torch.root.position.copy(fixture.closeTarget);
        torch.root.visible = true; torch.setLantern(true, true); fixture.setCamera(fixture.closeTarget);
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: resolve(out, `${spec.name}-torch-lit-closeup.png`) });
      result.screenshots.push(`${spec.name}-torch-lit-closeup.png`);
      await page.evaluate(() => window.__qaItemModels.torch.setLantern(false, true));
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: resolve(out, `${spec.name}-torch-unlit-closeup.png`) });
      result.screenshots.push(`${spec.name}-torch-unlit-closeup.png`);
      await page.evaluate(async () => {
        const THREE = await import('three');
        const fixture = window.__qaItemModels, { group, originals, torch } = fixture;
        for (const object of group.children) object.visible = false;
        torch.root.visible = false;
        originals[1].position.copy(fixture.closeTarget).add(new THREE.Vector3(-.48, -.35, 0));
        originals[2].position.copy(fixture.closeTarget).add(new THREE.Vector3(.48, -.35, 0));
        originals[1].scale.setScalar(1.05); originals[2].scale.setScalar(1.05);
        originals[1].visible = true; originals[2].visible = true;
        fixture.setCamera(fixture.closeTarget);
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: resolve(out, `${spec.name}-new-goods-closeup.png`) });
      result.screenshots.push(`${spec.name}-new-goods-closeup.png`);
      await page.evaluate(() => {
        const fixture = window.__qaItemModels, { originals, torch } = fixture;
        for (const object of fixture.group.children) object.visible = false;
        torch.root.visible = false; originals[4].visible = true;
        originals[4].position.copy(fixture.closeTarget); originals[4].scale.setScalar(1.25);
        __mn.world.nearFade(false); fixture.setCamera(fixture.closeTarget);
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: resolve(out, `${spec.name}-wood-closeup.png`) });
      result.screenshots.push(`${spec.name}-wood-closeup.png`);
      await page.evaluate(() => {
        const fixture = window.__qaItemModels;
        __mn.world.nearFade(true);
        fixture.camera.position.copy(fixture.cameraPosition); fixture.camera.quaternion.copy(fixture.cameraQuaternion);
        fixture.camera.up.copy(fixture.cameraUp); fixture.camera.fov = fixture.cameraFov; fixture.camera.updateProjectionMatrix();
        if (fixture.hud) fixture.hud.style.opacity = fixture.hudOpacity;
        if (fixture.rigHadOwnUpdate) fixture.rig.update = fixture.rigUpdate;
        else { delete fixture.rig.update; }
      });
      result.lineup.postRemovalFrames = await page.evaluate(async () => {
        const fixture = window.__qaItemModels, renderer = __mn.world.renderer;
        fixture.scene.remove(fixture.group);
        fixture.camera.fov = fixture.originalFov; fixture.camera.updateProjectionMatrix();
        delete window.__qaItemModels;
        renderer.info.reset();
        const intervals = []; let prior = performance.now();
        for (let i = 0; i < 30; i++) await new Promise((resolve) => requestAnimationFrame((time) => { intervals.push(time - prior); prior = time; resolve(); }));
        const sorted = [...intervals].sort((a, b) => a - b);
        return { frames: 30, meanFrameMs: intervals.reduce((sum, n) => sum + n, 0) / intervals.length,
          p95FrameMs: sorted[Math.floor(sorted.length * .95)], calls: renderer.info.render.calls,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
          fixtureRemoved: !fixture.group.parent, sceneChildrenBefore: fixture.sceneChildrenBefore,
          sceneChildrenAfter: fixture.scene.children.length, sceneChildrenRestored: fixture.scene.children.length === fixture.sceneChildrenBefore };
      });
      must(result.lineup.postRemovalFrames.fixtureRemoved && result.lineup.postRemovalFrames.sceneChildrenRestored
        && result.lineup.postRemovalFrames.geometries === result.lineup.baselineFrames.geometries
        && result.lineup.postRemovalFrames.textures === result.lineup.baselineFrames.textures,
      'The visual lineup leaked a scene object or changed warmed geometry/texture counters after removal.');
      result.checks.push('captured imported models in the live game scene', '48-copy desktop/mobile render stress reused geometry/material',
        'captured lit/unlit torch, atlas wood, and new-goods close-ups', 'temporary scene lineup removed after the captures');
      result.lineup.browserFrames = await frameMetrics(page);
      await page.waitForTimeout(6500);

      // Exercise the same editor catalog selection path used to prepare imported models on demand.
      result.editor = await page.evaluate(async (touch) => {
        const { EditorCatalog } = await import('/src/editor/catalog.js');
        const assets = __mn.assets, root = document.createElement('div');
        root.dataset.qa = 'item-model-editor-catalog'; document.body.append(root);
        // This is the same catalog class the WorldEditor constructs; its choose() calls ensureModel on demand.
        const catalog = new EditorCatalog({ root, assets, t: (en) => en });
        await catalog.ready;
        const rows = catalog.items || [];
        const item = rows.find((entry) => {
          const text = `${entry.category || ''} ${entry.status || ''} ${entry.id || ''} ${entry.label?.en || entry.label?.es || ''}`;
          return entry.id?.startsWith('model:item-') && assets.entry(entry.id)?.preload === false
            && /cooking|food|comida|cocina|meal|proposed|candidate|propuesta|candidato|lima|lime|hierbas|especias|cana/i.test(text);
        });
        if (!item) throw new Error('The editor catalog needs a manifest model:item entry with preload:false for on-demand QA.');
        const beforeState = assets.list().find((record) => record.id === item.id);
        if (beforeState?.state !== 'pending') throw new Error(`${item.id} was not pending at boot (${beforeState?.state || 'missing'}).`);
        const before = assets.list().map((record) => record.id);
        const requestsBefore = performance.getEntriesByType('resource').map((entry) => entry.name);
        const expectedSrc = touch ? item.mobileSrc || item.src : item.src;
        if (requestsBefore.some((url) => url.endsWith('/' + item.src) || (item.mobileSrc && url.endsWith('/' + item.mobileSrc))))
          throw new Error(`${item.id} GLB was fetched during boot.`);
        let selected = null;
        catalog.onSelect = (value) => { selected = value; };
        await catalog.choose(item.id);
        const state = assets.list().find((record) => record.id === item.id);
        const data = assets.data(item.id);
        const maps = (data?.parts || []).flatMap((part) => (Array.isArray(part.mat) ? part.mat : [part.mat])
          .filter(Boolean).map((material) => material.map?.image).filter(Boolean).map((image) => [image.width, image.height]));
        const after = performance.getEntriesByType('resource').map((entry) => entry.name);
        return { id: item.id, status: item.status || '', category: item.category || '', src: item.src,
          mobileSrc: item.mobileSrc || null, selectedSrc: state?.selectedSrc, state: state?.state,
          selectedModel: !!selected?.object, expectedSrc, expectedMapSize: touch ? 256 : 512, maps,
          beforePending: before.includes(item.id) && beforeState?.state === 'pending', requestsBefore: requestsBefore.filter((url) => url.endsWith('/' + item.src)
            || (item.mobileSrc && url.endsWith('/' + item.mobileSrc))),
          requestsAfter: after.filter((url) => url.endsWith('/' + expectedSrc)) };
      }, spec.touch);
      result.editor.requestsAfter = result.requests.filter((url) => new URL(url).pathname.endsWith('/' + result.editor.expectedSrc));
      must(result.editor.state === 'ok' && result.editor.selectedModel && result.editor.selectedSrc === result.editor.expectedSrc,
        `Editor on-demand selection failed for ${result.editor.id} or selected the wrong device model source.`);
      must(result.editor.beforePending && result.editor.requestsBefore.length === 0
        && result.editor.requestsAfter.length === 1,
      `${result.editor.id} was downloaded at boot or was not fetched exactly once by the editor.`);
      must(result.editor.maps.length > 0 && result.editor.maps.every(([width, height]) => width === result.editor.expectedMapSize && height === result.editor.expectedMapSize),
        `Editor item ${result.editor.id} did not load its ${result.editor.expectedMapSize}px device material map.`);
      result.checks.push('editor catalog keeps non-boot cooking/proposal model unloaded at boot',
        'editor selection invokes ensureModel and loads the 512px desktop / 256px mobile source');

      result.allModels = await page.evaluate(async (touch) => {
        const assets = __mn.assets, world = __mn.world;
        const entries = assets.list().map((row) => assets.entry(row.id))
          .filter((entry) => entry?.kind === 'model' && entry.id?.startsWith('model:item-'));
        const loaded = [];
        for (const entry of entries) {
          const ok = await assets.ensureModel(entry, { base: entry.base || 'assets/' });
          if (!ok) throw new Error(`ensureModel failed for ${entry.id}`);
          const state = assets.list().find((row) => row.id === entry.id);
          const data = assets.data(entry.id);
          const maps = (data?.parts || []).flatMap((part) => (Array.isArray(part.mat) ? part.mat : [part.mat])
            .filter(Boolean).map((material) => material.map?.image).filter(Boolean).map((image) => [image.width, image.height]));
          loaded.push({ id: entry.id, state: state?.state, selectedSrc: state?.selectedSrc,
            expectedSrc: touch ? entry.mobileSrc || entry.src : entry.src, maps });
        }
        if (loaded.length !== 12) throw new Error(`Expected 12 registered imported item models, saw ${loaded.length}`);
        return { loaded, allOk: loaded.every((row) => row.state === 'ok' && row.selectedSrc === row.expectedSrc
          && row.maps.length > 0 && row.maps.every(([w, h]) => w === (touch ? 256 : 512) && h === (touch ? 256 : 512))) };
      }, spec.touch);
      must(result.allModels.allOk, `One or more imported item models failed the all-12 device source/map audit on ${spec.name}.`);
      // Keep the contact-sheet capture in the actual game scene after every model is parsed.
      result.allModels.contactCount = await page.evaluate(async () => {
        const THREE = await import('three'), assets = __mn.assets, world = __mn.world, camera = world.camera, rig = world.rig;
        const entries = assets.list().map((row) => assets.entry(row.id)).filter((entry) => entry?.kind === 'model'
          && entry.id?.startsWith('model:item-'));
        const ps = __mn.ps, center = new THREE.Vector3((ps?.x ?? 0) + 7, (ps?.y ?? 0) + .3, ps?.z ?? 0);
        const group = new THREE.Group(); group.name = 'qa-item-models-12-contact-sheet';
        const position = camera.position.clone(), quaternion = camera.quaternion.clone(), fov = camera.fov;
        const up = camera.up.clone();
        const hud = document.querySelector('#hud'), hudOpacity = hud?.style.opacity || '';
        if (hud) hud.style.opacity = '0';
        const hadOwnUpdate = Object.prototype.hasOwnProperty.call(rig, 'update'), oldUpdate = rig.update;
        rig.update = () => {};
        camera.position.copy(center).add(new THREE.Vector3(3, 3, 4)); camera.up.set(0, 1, 0);
        camera.lookAt(center); camera.fov = 34; camera.updateProjectionMatrix();
        for (const [index, entry] of entries.entries()) {
          const object = assets.model(entry.id); object.scale.setScalar(.55);
          object.position.set(center.x + (index % 4 - 1.5) * .85,
            center.y - .4 + (Math.floor(index / 4) - 1) * .05,
            center.z + (Math.floor(index / 4) - 1) * .72);
          group.add(object);
        }
        world.scene.add(group);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.__qaContactSheet = { group, world, camera, rig, position, quaternion, up, fov, hadOwnUpdate, oldUpdate, hud, hudOpacity };
        return group.children.length;
      });
      await page.screenshot({ path: resolve(out, `${spec.name}-all-12-item-contact.png`) });
      result.screenshots.push(`${spec.name}-all-12-item-contact.png`);
      await page.evaluate(() => {
        const fixture = window.__qaContactSheet;
        fixture.world.scene.remove(fixture.group);
        fixture.camera.position.copy(fixture.position); fixture.camera.quaternion.copy(fixture.quaternion);
        fixture.camera.up.copy(fixture.up); fixture.camera.fov = fixture.fov; fixture.camera.updateProjectionMatrix();
        if (fixture.hud) fixture.hud.style.opacity = fixture.hudOpacity;
        if (fixture.hadOwnUpdate) fixture.rig.update = fixture.oldUpdate; else delete fixture.rig.update;
        delete window.__qaContactSheet;
      });
      result.checks.push('all 12 imported item models parsed on demand with the correct device map size',
        'captured a 12-item contact sheet in the actual game scene');

      const gl = await page.evaluate(() => {
        const gl = __mn.world.renderer.getContext(); const errors = [];
        for (let error = gl.getError(); error !== gl.NO_ERROR; error = gl.getError()) errors.push(error);
        return { errors, gameErrors: [...__mn.errors.entries()] };
      });
      result.webgl = gl;
      must(gl.errors.length === 0, `WebGL context reported errors: ${gl.errors.join(', ')}`);
      must(result.errors.length === 0, `Browser errors: ${result.errors.join('; ')}`);
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed'; result.failure = String(error.stack || error);
      evidence.failures.push(`${spec.name}: ${error.message}`);
      await page.screenshot({ path: resolve(out, `${spec.name}-failure.png`) }).catch(() => {});
    } finally { await context.close(); }
    console.log(`${spec.name}: ${result.status}${result.failure ? `: ${result.failure.split('\n')[0]}` : ''}`);
  }
} finally {
  await browser.close(); await host.close();
  await writeFile(resolve(out, 'browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
}
if (evidence.failures.length) process.exitCode = 1;
