// Cosmetic UV study on an isolated in-memory host; never writes a public world.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';

const out = resolve(process.env.MN_WOOD_OUT || 'docs/delivery/pickup-wood-uv/local');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve('../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const host = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 2, dev: false,
  worldId: null, store: createMemoryStore(), saveSecret: 'isolated-wood-uv-qa', log() {} });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const evidence = { at: new Date().toISOString(), scope: 'isolated memory host; cosmetic geometry only', cases: [] };
try {
  const port = await host.listen();
  for (const spec of [{ name: 'desktop', width: 1280, height: 720, touch: false },
    { name: 'mobile', width: 844, height: 390, touch: true }]) {
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height },
      hasTouch: spec.touch, isMobile: spec.touch, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.locator('#btn-play').click({ force: true });
    await page.waitForFunction(() => window.__mn?.client.joined && __mn.st.mode === 'playing', null, { timeout: 60000 });
    const initial = await page.evaluate(async () => {
      const THREE = await import('three');
      const { mapRaftUV } = await import('/src/render/raftMaterials.js');
      const { DOCK_WOOD_RECTS } = await import('/src/render/dockWood.js');
      const { PICKUP_WOOD_RECT } = await import('/src/render/resourceNodes.js');
      const { assets } = __mn, world = __mn.world, camera = world.camera;
      const resources = world.resources, source = resources.wood;
      const target = new THREE.Vector3(__mn.ps.x + 7, __mn.ps.y + .2, __mn.ps.z);
      const group = new THREE.Group(); world.scene.add(group);
      const mesh = new THREE.Mesh(source.clone(), resources.woodPaint); mesh.position.copy(target); group.add(mesh);
      mesh.userData.nm = resources.woodNm;
      const before = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov,
        rigUpdate: world.rig.update, ownUpdate: Object.hasOwn(world.rig, 'update'), hud: document.querySelector('#ui')?.style.opacity || '' };
      world.rig.update = () => {}; world.nearFade(false); document.querySelector('#ui').style.opacity = '0';
      camera.position.copy(target).add(new THREE.Vector3(2.4, 2.4, 3.2)); camera.lookAt(target); camera.fov = 30; camera.updateProjectionMatrix();
      const p = source.attributes.position, uv = source.attributes.uv;
      source.computeBoundingBox();
      const bounds = source.boundingBox, r = PICKUP_WOOD_RECT;
      let topVertices = 0, aligned = true, inside = true;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), face = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        inside &&= uv.getX(i) >= r.u0 - 1e-6 && uv.getX(i) <= r.u1 + 1e-6
          && uv.getY(i) >= r.v0 - 1e-6 && uv.getY(i) <= r.v1 + 1e-6;
        if (i % 3 === 0) {
          a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
          THREE.Triangle.getNormal(a, b, c, face);
        }
        if (Math.abs(face.y) > Math.max(Math.abs(face.x), Math.abs(face.z))) {
          topVertices++;
          const expected = r.u0 + (p.getX(i) - bounds.min.x) / (bounds.max.x - bounds.min.x) * (r.u1 - r.u0);
          aligned &&= Math.abs(uv.getX(i) - expected) < 1e-6;
        }
      }
      window.__woodQA = { THREE, mapRaftUV, DOCK_WOOD_RECTS, group, mesh, source, target, before };
      return { atlas: resources.woodPaint.map === assets.texture('tex:raft-comic-v1'), flipY: resources.woodPaint.map.flipY,
        image: [resources.woodPaint.map.image.width, resources.woodPaint.map.image.height],
        vertices: source.attributes.position.count, loaded: resources.group.userData.resources.loaded,
        rect: r, topVertices, aligned, inside };
    });
    assert.equal(initial.atlas, true);
    assert.equal(initial.aligned, true); assert.equal(initial.inside, true); assert.ok(initial.topVertices > 0);
    assert.deepEqual(initial.image, spec.touch ? [512, 512] : [1024, 1024]);
    const layouts = ['before', 'after'];
    for (const layout of layouts) {
      await page.evaluate(layout => {
        const q = __woodQA;
        q.mesh.geometry.dispose(); q.mesh.geometry = q.source.clone();
        if (layout === 'before') {
          q.mapRaftUV(q.mesh.geometry, 'wood', { grain: 'box', woodSlice: false,
            rect: q.DOCK_WOOD_RECTS[0] });
        }
      }, layout);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: resolve(out, `${spec.name}-${layout}.png`) });
    }
    await page.evaluate(() => {
      const q = __woodQA, w = __mn.world, c = w.camera;
      w.scene.remove(q.group); q.mesh.geometry.dispose(); w.nearFade(true);
      c.position.copy(q.before.position); c.quaternion.copy(q.before.quaternion); c.fov = q.before.fov; c.updateProjectionMatrix();
      if (q.before.ownUpdate) w.rig.update = q.before.rigUpdate; else delete w.rig.update;
      document.querySelector('#ui').style.opacity = q.before.hud; delete window.__woodQA;
    });
    assert.deepEqual(errors, []);
    evidence.cases.push({ ...spec, initial, errors, screenshots: layouts.map(layout => `${spec.name}-${layout}.png`) });
    await context.close();
  }
} finally { await browser.close(); await host.close(); }
await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
