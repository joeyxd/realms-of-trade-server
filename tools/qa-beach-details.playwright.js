// Run through browser_run_code_unsafe. Uses the real local game; galleries are temporary render-only props.
async (page) => {
  const device = 'desktop';
  const root = 'C:/DEV/real of trade/realms-of-trade-server', out = root + '/docs/art/beach-details';
  const mobile = device !== 'desktop', failure = ['missing', 'invalid', 'disabled'].includes(device);
  const context = await page.context().browser().newContext({ viewport: { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], modelRequests = [], failedResponses = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  p.on('request', (r) => { if (/\/models\/beach-.+\.glb/.test(r.url())) modelRequests.push(r.url()); });
  p.on('response', (r) => { if (r.status() >= 400) failedResponses.push({ url: r.url(), status: r.status() }); });
  if (device === 'missing') await p.route('**/models/beach-*.glb', (r) => r.fulfill({ status: 404, body: 'missing S04 fixture' }));
  if (device === 'invalid') await p.route('**/models/beach-*.glb', (r) => r.fulfill({ status: 200, contentType: 'model/gltf-binary', body: 'invalid S04 fixture' }));
  try {
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=day&q=' + (device === 'low' ? 'low' : mobile ? 'medium' : 'high') + (device === 'disabled' ? '&noassets' : ''));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled);
    await p.locator('#btn-play').click({ force: true });
    await p.waitForFunction(() => window.__mn?.world?.footprints?.active);
    await p.evaluate(() => __mn.teleport(103, 99));
    await p.waitForTimeout(700);
    await p.evaluate(async () => {
      const m = __mn, T = await import('three');
      m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise((r) => setTimeout(r, 150));
      m.world.rig.blend = null; m.world.nearFade(false);
      window.__detailCamera = (x, z, dist) => {
        const focus = new T.Vector3(x, m.map.heightAt(x, z) + 0.25, z);
        m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = dist;
        m.world.rig.update(0, focus, null, 1);
      };
      __detailCamera(103, 103, 20);
      window.__detailRender = () => { m.world.render(); window.__detailRaf = requestAnimationFrame(__detailRender); };
      window.__detailRaf = requestAnimationFrame(__detailRender);
    });
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${out}/${device}-map-v1.png` });
    await p.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; });
    await p.screenshot({ path: `${out}/${device}-map-clean-v1.png` });
    const state = await p.evaluate(async () => {
      const m = __mn, { buildBeachDetails } = await import('./src/render/beachDetails.js'), placements = buildBeachDetails(m.map);
      const group = m.world.vegetation.getObjectByName('beachDetails'), batches = [];
      group.traverse((o) => { if (o.isInstancedMesh) batches.push({ family: o.parent.name, count: o.count, trianglesPerInstance: o.geometry.attributes.position.count / 3, radius: o.boundingSphere?.radius, castsShadow: o.castShadow, layerMask: o.layers.mask }); });
      return { seed: m.map.seed, details: group.userData.details, batches, assets: m.assets.list().filter((a) => a.id.startsWith('model:beach-')),
        nearCamera: Object.fromEntries(Object.entries(placements).map(([k, list]) => [k, list.filter((p) => Math.hypot(p.x - 103, p.z - 103) < 16)])),
        gameErrors: m.errors, assetErrors: m.assets.errors, coarse: matchMedia('(pointer: coarse)').matches,
        glError: m.world.renderer.getContext().getError(), renderedCalls: m.world.renderer.info.render.calls, camera: m.world.camera.position.toArray() };
    });
    if (!failure) {
      // Close inspection uses an existing fan placement, at its actual scale and terrain contact.
      await p.evaluate(async () => {
        const { buildBeachDetails } = await import('./src/render/beachDetails.js');
        const fan = buildBeachDetails(__mn.map).shells.filter((p) => p.variant === 0).sort((a, b) => Math.hypot(a.x - 100, a.z - 108) - Math.hypot(b.x - 100, b.z - 108))[0];
        __detailCamera(fan.x, fan.z, 5);
      });
      await p.waitForTimeout(200); await p.screenshot({ path: `${out}/${device}-contact-v1.png` });
      if (device === 'desktop') {
        await p.evaluate(async () => {
          const m = __mn, T = await import('three'), group = new T.Group(); group.name = 'QA-only-S04-gallery';
          const ids = ['model:beach-shell-fan-v1', 'model:beach-shell-oval-v1', 'model:beach-shell-chip-v1', 'model:beach-pebbles-v1'];
          ids.forEach((id, i) => {
            const material = m.world.vegetation.getObjectByName(i < 3 ? 'beachShells' + i : 'beachPebbleClusters').children[0].material;
            const mesh = new T.Mesh(m.assets.data(id).parts[0].geo, material), k = (i - 1.5) * 1.7;
            mesh.position.set(109 + k * Math.SQRT1_2, m.map.heightAt(109 + k * Math.SQRT1_2, 99 - k * Math.SQRT1_2), 99 - k * Math.SQRT1_2);
            mesh.scale.setScalar(1.7); mesh.layers.set(2); mesh.receiveShadow = true; group.add(mesh);
          });
          m.world.vegetation.visible = false;
          m.world.scene.add(group); window.__detailGallery = group; __detailCamera(109, 99, 10);
        });
        await p.waitForTimeout(200); await p.screenshot({ path: `${out}/desktop-gallery-v1.png` });
        const names = ['shell-fan', 'shell-oval', 'shell-chip', 'pebbles'];
        for (let i = 0; i < names.length; i++) {
          await p.evaluate((index) => { __detailGallery.children.forEach((o, j) => { o.visible = j === index; }); const o = __detailGallery.children[index]; __detailCamera(o.position.x, o.position.z, 4.5); }, i);
          await p.waitForTimeout(150); await p.screenshot({ path: `${out}/${names[i]}-preview-v1.png` });
        }
        await p.evaluate(() => { __mn.world.scene.remove(__detailGallery); __mn.world.vegetation.visible = true; });
      }
    }
    await p.evaluate(() => { cancelAnimationFrame(__detailRaf); document.getElementById('ui').style.visibility = ''; });
    return { device, errors, consoleErrors, failedResponses, modelRequests, state };
  } finally { await context.close(); }
}
