// Real-map views and native-scale temporary gallery; fixture objects are discarded with the browser context.
async (page) => {
  const device = 'desktop';
  const mobile = ['mobile', 'low'].includes(device), out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/beach-debris';
  const context = await page.context().browser().newContext({ viewport: { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], requests = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
  p.on('request', (r) => { if (/beach-debris.*\.glb/.test(r.url())) requests.push(r.url()); });
  if (device === 'missing') await p.route('**/assets/models/beach-debris-*.glb', (route) => route.fulfill({ status: 404, body: 'fixture missing model' }));
  if (device === 'invalid') await p.route('**/assets/models/beach-debris-*.glb', (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'invalid GLB fixture' }));
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
      await new Promise((r) => setTimeout(r, 120)); m.world.rig.blend = null; m.world.nearFade(false); window.__debrisU = U;
      // Choose a real populated beach; no map prop is introduced for the map screenshots.
      const points = m.world.beachDebris.points;
      window.__debrisFocus = points.reduce((best, o) => !best || Math.hypot(o.x - 96, o.z - 84) < Math.hypot(best.x - 96, best.z - 84) ? o : best, null);
      window.__debrisCamera = (x, z, dist, lift = 0.3) => {
        const focus = new T.Vector3(x, m.map.heightAt(x, z) + lift, z);
        m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = dist; m.world.rig.update(0, focus, null, 1);
      };
      m.world.beachDebris.update(__debrisFocus); m.world.grass.update(__debrisFocus); __debrisCamera(__debrisFocus.x, __debrisFocus.z, 22);
      window.__debrisRender = () => { m.world.render(); window.__debrisRaf = requestAnimationFrame(__debrisRender); };
      __debrisRaf = requestAnimationFrame(__debrisRender);
    });
    await p.waitForTimeout(180); await p.screenshot({ path: `${out}/${device}-map-v1.png` });
    const state = await p.evaluate(async () => {
      const m = __mn, r = m.world.renderer, gl = r.getContext(), g = m.world.beachDebris.group, { assets } = await import('./src/render/assets/registry.js');
      const measure = () => { r.info.autoReset = false; r.info.reset(); m.world.render(); return { ...r.info.render }; };
      const enabled = measure(); g.visible = false; const disabled = measure(); g.visible = true; r.info.autoReset = true;
      return { seed: m.map.seed, quality: m.quality.current, coarse: matchMedia('(pointer: coarse)').matches,
        focus: { x: __debrisFocus.x, z: __debrisFocus.z }, debris: JSON.parse(JSON.stringify(g.userData.debris)), errors: m.errors,
        glError: gl.getError(), programsLinked: r.info.programs.every((pr) => gl.getProgramParameter(pr.program, gl.LINK_STATUS)),
        counts: { enabled, disabled, extraCalls: enabled.calls - disabled.calls, extraTriangles: enabled.triangles - disabled.triangles },
        assetState: assets.list().filter((e) => e.id.startsWith('model:beach-debris-')),
        material: { opaque: !g.children[0].material.transparent, map: !!g.children[0].material.map, normalMap: !!g.children[0].material.normalMap,
          alphaTest: g.children[0].material.alphaTest, allShadowOff: g.children.every((o) => !o.castShadow), allNoOutline: g.children.every((o) => o.layers.mask === 4) } };
    });
    await p.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; __debrisCamera(__debrisFocus.x, __debrisFocus.z, 5); });
    await p.waitForTimeout(140); await p.screenshot({ path: `${out}/${device}-close-v1.png` });
    await p.evaluate(async () => {
      const m = __mn, T = await import('three'), { debrisGeometry, loadedDebrisGeometry, DEBRIS_IDS } = await import('./src/render/beachDebrisGeometry.js'),
        { assets } = await import('./src/render/assets/registry.js');
      const gallery = new T.Group(), mat = m.world.beachDebris.group.children[0].material;
      for (let i = 0; i < 3; i++) {
        const k = (i - 1) * 2.5, x = 101 + k * Math.SQRT1_2, z = 99 - k * Math.SQRT1_2;
        const mesh = new T.Mesh(loadedDebrisGeometry(assets.data(DEBRIS_IDS[i])) || debrisGeometry(i), mat);
        mesh.position.set(x, m.map.heightAt(x, z) - 0.02, z); mesh.receiveShadow = true; mesh.layers.set(2); gallery.add(mesh);
      }
      window.__debrisViews = [...m.world.views.values()].map((v) => [v.root, v.root.visible]); for (const [o] of __debrisViews) o.visible = false;
      window.__debrisOcc = __debrisU.mnOccOn.value; __debrisU.mnOccOn.value = 0;
      m.world.vegetation.visible = false; m.world.scene.add(gallery); window.__debrisGallery = gallery;
      m.world.pipeline.markDirty(); __debrisCamera(101, 99, 9);
    });
    await p.waitForTimeout(140); await p.screenshot({ path: `${out}/${device}-gallery-v1.png` });
    if (device === 'desktop') for (const [i, style] of ['branch', 'log', 'planks'].entries()) {
      await p.evaluate((index) => { __debrisGallery.children.forEach((o, j) => { o.visible = j === index; }); const o = __debrisGallery.children[index]; __debrisCamera(o.position.x, o.position.z, 3.8); }, i);
      await p.waitForTimeout(120); await p.screenshot({ path: `${out}/variant-${style}-preview-v1.png` });
    }
    await p.evaluate(() => { __mn.world.scene.remove(__debrisGallery); __debrisGallery.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      __mn.world.vegetation.visible = true; __debrisU.mnOccOn.value = __debrisOcc; for (const [o, visible] of __debrisViews) o.visible = visible;
      __mn.world.pipeline.markDirty(); cancelAnimationFrame(__debrisRaf); });
    const transitions = await p.evaluate(() => {
      const m = __mn, result = [];
      for (const tier of ['high', 'low', 'medium', 'high']) { m.quality.set(tier); m.world.beachDebris.update(__debrisFocus); result.push({ tier, ...JSON.parse(JSON.stringify(m.world.beachDebris.group.userData.debris)) }); }
      m.world.beachDebris.update({ x: -1000, z: -1000 }); result.push({ tier: 'off-island', ...JSON.parse(JSON.stringify(m.world.beachDebris.group.userData.debris)) });
      return result;
    });
    return { device, errors, consoleErrors, requests, state, transitions };
  } finally { await context.close(); }
}

