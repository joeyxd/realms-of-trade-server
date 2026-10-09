// Local game captures; two standalone gallery bases are QA-only objects at native scale.
async (page) => {
  const device = 'desktop';
  const root = 'C:/DEV/real of trade/realms-of-trade-server', out = root + '/docs/art/palm-bases';
  const mobile = ['mobile', 'low'].includes(device), positive = ['desktop', 'mobile', 'low'].includes(device);
  const context = await page.context().browser().newContext({ viewport: { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], requests = [], failedResponses = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  p.on('request', (r) => { if (/\/models\/palm-base-|\/textures\/palm-base-v1/.test(r.url())) requests.push(r.url()); });
  p.on('response', (r) => { if (r.status() >= 400) failedResponses.push({ url: r.url(), status: r.status() }); });
  if (device === 'missing-model') await p.route('**/models/palm-base-*.glb', (r) => r.fulfill({ status: 404, body: 'S06 missing model fixture' }));
  if (device === 'invalid-model') await p.route('**/models/palm-base-*.glb', (r) => r.fulfill({ status: 200, body: 'S06 invalid model fixture' }));
  if (device === 'missing-color') await p.route('**/textures/palm-base-v1/albedo-*.webp', (r) => r.fulfill({ status: 404, body: 'S06 missing albedo fixture' }));
  if (device === 'missing-normal') await p.route('**/textures/palm-base-v1/normal-*.webp', (r) => r.fulfill({ status: 404, body: 'S06 missing normal fixture' }));
  try {
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=day&q=' + (device === 'low' ? 'low' : mobile ? 'medium' : 'high') + (device === 'disabled' ? '&noassets' : ''));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled);
    await p.locator('#btn-play').click({ force: true }); await p.waitForFunction(() => window.__mn?.world?.footprints?.active);
    await p.evaluate(() => __mn.teleport(103, 99)); await p.waitForTimeout(600);
    await p.waitForFunction(() => __mn.world.lighting.shadowHalf === 30);
    await p.evaluate(async () => {
      const m = __mn, T = await import('three'), { U } = await import('./src/render/toon.js');
      m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise((r) => setTimeout(r, 150)); m.world.rig.blend = null; m.world.nearFade(false);
      window.__baseCamera = (x, z, dist, y = 0.25) => {
        const focus = new T.Vector3(x, m.map.heightAt(x, z) + y, z);
        m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = dist; m.world.rig.update(0, focus, null, 1);
      };
      window.__baseU = U;
      __baseCamera(101, 103, 23, 1.8);
      window.__baseRender = () => { m.world.render(); window.__baseRaf = requestAnimationFrame(__baseRender); };
      window.__baseRaf = requestAnimationFrame(__baseRender);
    });
    await p.waitForTimeout(200); await p.screenshot({ path: `${out}/${device}-map-v1.png` });
    await p.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; });
    await p.screenshot({ path: `${out}/${device}-map-clean-v1.png` });
    await p.evaluate(() => { __baseCamera(103.97700796369463, 103.88836386613548, 6.5); });
    await p.waitForTimeout(200); await p.screenshot({ path: `${out}/${device}-contact-v1.png` });
    const state = await p.evaluate(() => {
      const m = __mn, gl = m.world.renderer.getContext(), batches = [];
      m.world.vegetation.getObjectByName('palmBases').traverse((o) => {
        if (!o.isInstancedMesh) return;
        const image = (t) => t && { url: t.image.currentSrc || t.image.src, width: t.image.width, height: t.image.height };
        const flex = o.geometry.attributes.aFlex, weights = Array.from({ length: flex.count }, (_, i) => flex.getX(i));
        batches.push({ family: o.parent.name, count: o.count, trianglesPerInstance: (o.geometry.index?.count || o.geometry.attributes.position.count) / 3,
          uv: o.geometry.attributes.uv?.count, flexMin: Math.min(...weights), flexMax: Math.max(...weights), flexNormalized: flex.normalized,
          alphaTest: o.material.alphaTest, outlineAlpha: o.userData.nm?.alphaTest, shadowAlpha: o.customDepthMaterial?.alphaTest,
          normalStrength: o.material.normalScale.toArray(), color: image(o.material.map), normal: image(o.material.normalMap) });
      });
      return { seed: m.map.seed, bases: m.world.vegetation.getObjectByName('palmBases').userData.bases,
        palms: m.world.vegetation.userData.palms, batches, coarse: matchMedia('(pointer: coarse)').matches,
        assets: m.assets.list().filter((a) => /^(model|tex):palm-base-/.test(a.id)),
        programs: m.world.renderer.info.programs.map((pr) => ({ name: pr.name, linked: gl.getProgramParameter(pr.program, gl.LINK_STATUS), log: gl.getProgramInfoLog(pr.program) })),
        errors: m.errors, assetErrors: m.assets.errors, glError: gl.getError() };
    });
    if (positive) {
      await p.evaluate(async () => {
        const m = __mn, T = await import('three'), gallery = new T.Group(); gallery.name = 'QA-only-S06-gallery';
        for (let i = 0; i < 2; i++) {
          const item = new T.Group(), k = (i - 0.5) * 3.4;
          item.position.set(101 + k * Math.SQRT1_2, m.map.heightAt(101 + k * Math.SQRT1_2, 99 - k * Math.SQRT1_2) - 0.1, 99 - k * Math.SQRT1_2);
          for (const family of ['palmBaseRoots', 'palmBaseLeaves']) {
            const src = m.world.vegetation.getObjectByName(family + i).children[0], mesh = new T.Mesh(src.geometry, src.material);
            mesh.castShadow = mesh.receiveShadow = true; mesh.userData.nm = src.userData.nm; mesh.customDepthMaterial = src.customDepthMaterial; item.add(mesh);
          }
          gallery.add(item);
        }
        window.__baseViewVisibility = [...m.world.views.values()].map((v) => [v.root, v.root.visible]);
        for (const [o] of __baseViewVisibility) o.visible = false;
        m.world.vegetation.visible = false; m.world.scene.add(gallery); m.world.pipeline.markDirty(); window.__baseGallery = gallery;
        __baseCamera(101, 99, 10);
      });
      await p.waitForTimeout(200); await p.screenshot({ path: `${out}/${device}-gallery-v1.png` });
      if (device === 'desktop') {
        for (const [i, style] of ['open', 'lush'].entries()) {
          await p.evaluate((index) => { __baseGallery.children.forEach((o, j) => { o.visible = j === index; }); const o = __baseGallery.children[index]; __baseCamera(o.position.x, o.position.z, 5); }, i);
          await p.waitForTimeout(200); await p.screenshot({ path: `${out}/base-${style}-preview-v1.png` });
        }
        await p.evaluate(() => { __baseGallery.children.forEach((o) => { o.visible = true; }); __baseCamera(101, 99, 10); __baseU.mnTime.value = 0; });
        await p.waitForTimeout(200); await p.screenshot({ path: `${out}/desktop-wind-0-v1.png` });
        await p.evaluate(() => { __baseU.mnTime.value = 2.1; });
        await p.waitForTimeout(200); await p.screenshot({ path: `${out}/desktop-wind-2-v1.png` });
        await p.evaluate(() => { __baseGallery.traverse((o) => { if (o.isMesh) o.material.normalScale.set(0, 0); }); });
        await p.waitForTimeout(200); await p.screenshot({ path: `${out}/desktop-normal-off-v1.png` });
        await p.evaluate(() => { __baseGallery.traverse((o) => { if (o.isMesh) o.material.normalScale.set(0.16, 0.16); }); });
      }
      await p.evaluate(() => { __mn.world.scene.remove(__baseGallery); __mn.world.vegetation.visible = true;
        for (const [o, visible] of __baseViewVisibility) o.visible = visible; __mn.world.pipeline.markDirty(); });
    }
    await p.evaluate(() => { cancelAnimationFrame(__baseRaf); });
    const post = await p.evaluate(() => { const r = __mn.world.renderer, gl = r.getContext(); return { gameErrors: __mn.errors,
      glError: gl.getError(), linked: r.info.programs.every((p) => gl.getProgramParameter(p.program, gl.LINK_STATUS)) }; });
    return { device, errors, consoleErrors, failedResponses, requests, state, post };
  } finally { await context.close(); }
}
