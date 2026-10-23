// Real local game and a temporary native-scale gallery; no simulation or persistent writes.
async (page) => {
  const device = 'desktop';
  const out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/shrubs';
  const mobile = ['mobile', 'low'].includes(device), positive = ['desktop', 'mobile', 'low'].includes(device);
  const context = await page.context().browser().newContext({ viewport: { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], requests = [], failedResponses = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
  p.on('request', (r) => { if (/\/models\/shrub-|\/textures\/shrub-v1/.test(r.url())) requests.push(r.url()); });
  p.on('response', (r) => { if (r.status() >= 400) failedResponses.push({ url: r.url(), status: r.status() }); });
  if (device === 'missing-model') await p.route('**/models/shrub-*.glb', (r) => r.fulfill({ status: 404, body: 'S07 missing model fixture' }));
  if (device === 'invalid-model') await p.route('**/models/shrub-*.glb', (r) => r.fulfill({ status: 200, body: 'S07 invalid model fixture' }));
  if (device === 'missing-color') await p.route('**/textures/shrub-v1/albedo-*.webp', (r) => r.fulfill({ status: 404, body: 'S07 missing color fixture' }));
  if (device === 'missing-normal') await p.route('**/textures/shrub-v1/normal-*.webp', (r) => r.fulfill({ status: 404, body: 'S07 missing normal fixture' }));
  try {
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=day&q=' + (device === 'low' ? 'low' : mobile ? 'medium' : 'high') + (device === 'disabled' ? '&noassets' : ''));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled);
    await p.locator('#btn-play').click({ force: true });
    await p.waitForFunction(() => window.__mn?.world?.footprints?.active);
    await p.evaluate(() => __mn.teleport(96, 84));
    await p.waitForFunction(() => __mn.world.lighting.shadowHalf === 30);
    await p.evaluate(async () => {
      const m = __mn, T = await import('three'), { U } = await import('./src/render/toon.js');
      m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise((r) => setTimeout(r, 120)); m.world.rig.blend = null; m.world.nearFade(false);
      window.__shrubU = U;
      window.__shrubCamera = (x, z, dist, lift = 0.6) => {
        const focus = new T.Vector3(x, m.map.heightAt(x, z) + lift, z);
        m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = dist; m.world.rig.update(0, focus, null, 1);
      };
      __shrubCamera(96, 84, 25);
      window.__shrubRender = () => { m.world.render(); window.__shrubRaf = requestAnimationFrame(__shrubRender); };
      __shrubRaf = requestAnimationFrame(__shrubRender);
    });
    await p.waitForTimeout(180); await p.screenshot({ path: `${out}/${device}-map-v1.png` });
    await p.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; __shrubCamera(90.75583167839795, 88.75686954008415, 6, 0.8); });
    await p.waitForTimeout(150); await p.screenshot({ path: `${out}/${device}-close-v1.png` });
    const state = await p.evaluate(() => {
      const m = __mn, gl = m.world.renderer.getContext(), batches = [];
      const image = (t) => t && { url: t.image.currentSrc || t.image.src, width: t.image.width, height: t.image.height };
      m.world.vegetation.getObjectByName('shrubs').traverse((o) => {
        if (!o.isInstancedMesh) return;
        const flex = o.geometry.attributes.aFlex, weights = Array.from({ length: flex.count }, (_, i) => flex.getX(i));
        batches.push({ family: o.parent.name, count: o.count, trianglesPerInstance: (o.geometry.index?.count || o.geometry.attributes.position.count) / 3,
          flexMin: Math.min(...weights), flexMax: Math.max(...weights), alphaTest: o.material.alphaTest,
          outlineAlpha: o.userData.nm?.alphaTest, shadowAlpha: o.customDepthMaterial?.alphaTest, castShadow: o.castShadow,
          color: image(o.material.map), normal: image(o.material.normalMap) });
      });
      const families = [...new Set(batches.map((b) => b.family))].map((family) => {
        const list = batches.filter((b) => b.family === family);
        return { ...list[0], count: list.reduce((sum, b) => sum + b.count, 0), chunks: list.map((b) => b.count) };
      });
      const programs = m.world.renderer.info.programs.map((pr) => ({ linked: gl.getProgramParameter(pr.program, gl.LINK_STATUS), log: gl.getProgramInfoLog(pr.program) }));
      return { seed: m.map.seed, shrubs: m.world.vegetation.getObjectByName('shrubs').userData.shrubs, batches: families,
        coarse: matchMedia('(pointer: coarse)').matches, assets: m.assets.list().filter((a) => /^(model|tex):shrub-/.test(a.id)),
        errors: m.errors, assetErrors: m.assets.errors, glError: gl.getError(),
        programs: { count: programs.length, linked: programs.every((pr) => pr.linked), failed: programs.filter((pr) => !pr.linked || pr.log) } };
    });
    if (positive) {
      await p.evaluate(async () => {
        const m = __mn, T = await import('three'), gallery = new T.Group(); gallery.name = 'QA-only-shrub-gallery';
        for (let i = 0; i < 3; i++) {
          const item = new T.Group(), k = (i - 1) * 2.7;
          item.position.set(101 + k * Math.SQRT1_2, m.map.heightAt(101 + k * Math.SQRT1_2, 99 - k * Math.SQRT1_2) - 0.05, 99 - k * Math.SQRT1_2);
          for (const family of ['shrubStems', 'shrubLeaves']) {
            const src = m.world.vegetation.getObjectByName(family + i).children[0], mesh = new T.Mesh(src.geometry, src.material);
            mesh.castShadow = mesh.receiveShadow = true; mesh.userData.nm = src.userData.nm; mesh.customDepthMaterial = src.customDepthMaterial; item.add(mesh);
          }
          gallery.add(item);
        }
        window.__shrubViews = [...m.world.views.values()].map((v) => [v.root, v.root.visible]);
        for (const [o] of __shrubViews) o.visible = false;
        window.__shrubOcc = __shrubU.mnOccOn.value; __shrubU.mnOccOn.value = 0;
        m.world.vegetation.visible = false; m.world.scene.add(gallery); m.world.pipeline.markDirty(); window.__shrubGallery = gallery;
        __shrubCamera(101, 99, 12, 0.8);
      });
      await p.waitForTimeout(160); await p.screenshot({ path: `${out}/${device}-gallery-v1.png` });
      if (device === 'desktop') {
        for (const [i, style] of ['round', 'low', 'tall'].entries()) {
          await p.evaluate((index) => { __shrubGallery.children.forEach((o, j) => { o.visible = j === index; }); const o = __shrubGallery.children[index]; __shrubCamera(o.position.x, o.position.z, 5, 0.6); }, i);
          await p.waitForTimeout(120); await p.screenshot({ path: `${out}/variant-${style}-preview-v1.png` });
        }
        await p.evaluate(() => { __shrubGallery.children.forEach((o) => { o.visible = true; }); __shrubCamera(101, 99, 12, 0.8); __shrubU.mnTime.value = 0; });
        await p.waitForTimeout(150); await p.screenshot({ path: `${out}/desktop-wind-0-v1.png` });
        await p.evaluate(() => { __shrubU.mnTime.value = 2.1; });
        await p.waitForTimeout(150); await p.screenshot({ path: `${out}/desktop-wind-2-v1.png` });
        await p.evaluate(() => { __shrubGallery.traverse((o) => { if (o.isMesh) o.material.normalScale?.set(0, 0); }); });
        await p.waitForTimeout(150); await p.screenshot({ path: `${out}/desktop-normal-off-v1.png` });
        await p.evaluate(() => { __shrubGallery.traverse((o) => { if (o.isMesh) o.material.normalScale?.set(0.16, 0.16); }); });
      }
      await p.evaluate(() => { __mn.world.scene.remove(__shrubGallery); __mn.world.vegetation.visible = true;
        __shrubU.mnOccOn.value = __shrubOcc;
        for (const [o, visible] of __shrubViews) o.visible = visible; __mn.world.pipeline.markDirty(); });
    }
    await p.evaluate(() => cancelAnimationFrame(__shrubRaf));
    const post = await p.evaluate(() => { const r = __mn.world.renderer, gl = r.getContext(); return { errors: __mn.errors, glError: gl.getError(), linked: r.info.programs.every((pr) => gl.getProgramParameter(pr.program, gl.LINK_STATUS)) }; });
    return { device, errors, consoleErrors, requests, failedResponses, state, post };
  } finally { await context.close(); }
}
