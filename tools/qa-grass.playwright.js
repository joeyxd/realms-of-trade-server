// Inspect the ordinary map, actual distance LOD and a temporary native-scale gallery.
async (page) => {
  const device = 'desktop';
  const mobile = ['mobile', 'low'].includes(device), out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/grass';
  const context = await page.context().browser().newContext({ viewport: { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], requests = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
  p.on('request', (r) => { if (/\/assets\//.test(r.url())) requests.push(r.url()); });
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
      window.__grassU = U;
      window.__grassCamera = (x, z, dist, lift = 0.6) => {
        const focus = new T.Vector3(x, m.map.heightAt(x, z) + lift, z);
        m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = dist; m.world.rig.update(0, focus, null, 1);
      };
      m.world.grass.update({ x: 96, z: 84 }); __grassCamera(96, 84, 25);
      window.__grassRender = () => { m.world.render(); window.__grassRaf = requestAnimationFrame(__grassRender); };
      __grassRaf = requestAnimationFrame(__grassRender);
    });
    await p.waitForTimeout(200); await p.screenshot({ path: `${out}/${device}-map-v1.png` });
    const state = await p.evaluate(() => {
      const m = __mn, r = m.world.renderer, gl = r.getContext(), g = m.world.grass.group;
      const measure = () => { r.info.autoReset = false; r.info.reset(); m.world.render(); return { ...r.info.render }; };
      const enabled = measure(); g.visible = false; const disabled = measure(); g.visible = true; r.info.autoReset = true;
      return { seed: m.map.seed, quality: m.quality.current, coarse: matchMedia('(pointer: coarse)').matches,
        grass: JSON.parse(JSON.stringify(g.userData.grass)), errors: m.errors, glError: gl.getError(),
        programsLinked: r.info.programs.every((pr) => gl.getProgramParameter(pr.program, gl.LINK_STATUS)),
        counts: { enabled, disabled, extraCalls: enabled.calls - disabled.calls, extraTriangles: enabled.triangles - disabled.triangles },
        material: { opaque: !g.children[0].material.transparent, map: !!g.children[0].material.map,
          normalMap: !!g.children[0].material.normalMap, alphaTest: g.children[0].material.alphaTest,
          allShadowOff: g.children.every((o) => !o.castShadow), allNoOutline: g.children.every((o) => o.layers.mask === 4) } };
    });
    await p.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; __grassCamera(100, 84, 5, 0.35); });
    await p.waitForTimeout(160); await p.screenshot({ path: `${out}/${device}-close-v1.png` });
    if (device !== 'disabled') {
      await p.evaluate(async () => {
        const m = __mn, T = await import('three'), { grassGeometry } = await import('./src/render/grassGeometry.js');
        const gallery = new T.Group(), material = m.world.grass.group.children[0].material;
        for (let i = 0; i < 3; i++) {
          const item = new T.Group(), k = (i - 1) * 1.8;
          item.position.set(101 + k * Math.SQRT1_2, m.map.heightAt(101 + k * Math.SQRT1_2, 99 - k * Math.SQRT1_2) - 0.02, 99 - k * Math.SQRT1_2);
          const mesh = new T.Mesh(grassGeometry(i, { low: __mn.quality.current === 'low' }), material);
          mesh.receiveShadow = true; mesh.layers.set(2); item.add(mesh); gallery.add(item);
        }
        window.__grassViews = [...m.world.views.values()].map((v) => [v.root, v.root.visible]);
        for (const [o] of __grassViews) o.visible = false;
        window.__grassOcc = __grassU.mnOccOn.value; __grassU.mnOccOn.value = 0;
        m.world.vegetation.visible = false; m.world.scene.add(gallery); window.__grassGallery = gallery;
        m.world.pipeline.markDirty(); __grassCamera(101, 99, 7, 0.3);
      });
      await p.waitForTimeout(160); await p.screenshot({ path: `${out}/${device}-gallery-v1.png` });
      if (device === 'desktop') {
        for (const [i, style] of ['tuft', 'fan', 'wild'].entries()) {
          await p.evaluate((index) => { __grassGallery.children.forEach((o, j) => { o.visible = j === index; }); const o = __grassGallery.children[index]; __grassCamera(o.position.x, o.position.z, 3.2, 0.3); }, i);
          await p.waitForTimeout(120); await p.screenshot({ path: `${out}/variant-${style}-preview-v1.png` });
        }
        await p.evaluate(() => { __grassGallery.children.forEach((o) => { o.visible = true; }); __grassCamera(101, 99, 7, 0.3); __grassU.mnTime.value = 0; });
        await p.waitForTimeout(120); await p.screenshot({ path: `${out}/desktop-wind-0-v1.png` });
        await p.evaluate(() => { __grassU.mnTime.value = 2.1; });
        await p.waitForTimeout(120); await p.screenshot({ path: `${out}/desktop-wind-2-v1.png` });
      }
      await p.evaluate(() => { __mn.world.scene.remove(__grassGallery); __grassGallery.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
        __mn.world.vegetation.visible = true; __grassU.mnOccOn.value = __grassOcc;
        for (const [o, visible] of __grassViews) o.visible = visible; __mn.world.pipeline.markDirty(); });
    }
    await p.evaluate(() => cancelAnimationFrame(__grassRaf));
    const transitions = await p.evaluate(() => {
      const m = __mn, result = [];
      for (const tier of ['high', 'low', 'medium', 'high']) { m.quality.set(tier); m.world.grass.update({ x: 96, z: 84 }); result.push({ tier, ...JSON.parse(JSON.stringify(m.world.grass.group.userData.grass)) }); }
      m.world.grass.update({ x: -1000, z: -1000 }); result.push({ tier: 'off-island', ...JSON.parse(JSON.stringify(m.world.grass.group.userData.grass)) });
      return result;
    });
    return { device, errors, consoleErrors, requests, state, transitions };
  } finally { await context.close(); }
}
