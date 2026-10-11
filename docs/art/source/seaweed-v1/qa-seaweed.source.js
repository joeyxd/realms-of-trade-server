// Inspect real submerged anchors and a temporary dry-land gallery; close each isolated context.
async (page) => {
  const device = 'desktop';
  const mobile = ['mobile', 'low'].includes(device), out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/seaweed';
  const context = await page.context().browser().newContext({ viewport: { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
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
      await new Promise((r) => setTimeout(r, 120)); m.world.rig.blend = null; m.world.nearFade(false); window.__weedU = U;
      // Select a real clump with visible depth near the existing south-east coast.
      window.__weedFocus = m.world.seaweed.points.filter((o) => o.y > -1.8).reduce((best, o) => !best ||
        Math.hypot(o.x - 96, o.z - 84) < Math.hypot(best.x - 96, best.z - 84) ? o : best, null);
      if (!__weedFocus) throw Error('The actual map has no shallow seaweed');
      window.__weedCamera = (x, z, dist, lift = 0.1) => {
        const focus = new T.Vector3(x, Math.max(0, m.map.heightAt(x, z)) + lift, z);
        m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = dist; m.world.rig.update(0, focus, null, 1);
      };
      m.world.seaweed.update(__weedFocus); m.world.grass.update(__weedFocus); m.world.beachDebris.update(__weedFocus);
      __weedCamera(__weedFocus.x, __weedFocus.z, 22);
      window.__weedRender = () => { m.world.render(); window.__weedRaf = requestAnimationFrame(__weedRender); };
      __weedRaf = requestAnimationFrame(__weedRender);
    });
    await p.waitForTimeout(160); await p.screenshot({ path: `${out}/${device}-map-v1.png` });
    const state = await p.evaluate(async () => {
      const m = __mn, r = m.world.renderer, gl = r.getContext(), g = m.world.seaweed.group;
      const measure = () => { r.info.autoReset = false; r.info.reset(); m.world.render(); return { ...r.info.render }; };
      const enabled = measure(); g.visible = false; const disabled = measure(); g.visible = true; r.info.autoReset = true;
      const mats = new Set(g.children.map((o) => o.material)), geo = new Set(g.children.map((o) => o.geometry));
      return { seed: m.map.seed, quality: m.quality.current, coarse: matchMedia('(pointer: coarse)').matches,
        focus: { x: __weedFocus.x, z: __weedFocus.z, y: __weedFocus.y }, seaweed: JSON.parse(JSON.stringify(g.userData.seaweed)), errors: m.errors,
        glError: gl.getError(), programsLinked: r.info.programs.every((pr) => gl.getProgramParameter(pr.program, gl.LINK_STATUS)),
        counts: { enabled, disabled, extraCalls: enabled.calls - disabled.calls, extraTriangles: enabled.triangles - disabled.triangles },
        resources: { materials: mats.size, geometries: geo.size, trianglesPerGeometry: [...geo].map((o) => o.index.count / 3) },
        material: { opaque: !g.children[0].material.transparent, map: !!g.children[0].material.map, normalMap: !!g.children[0].material.normalMap,
          alphaTest: g.children[0].material.alphaTest, allShadowOff: g.children.every((o) => !o.castShadow), allNoOutline: g.children.every((o) => o.layers.mask === 4) } };
    });
    await p.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; __weedCamera(__weedFocus.x, __weedFocus.z, 5); });
    await p.waitForTimeout(140); await p.screenshot({ path: `${out}/${device}-close-v1.png` });
    await p.evaluate(async (low) => {
      const m = __mn, T = await import('three'), { seaweedGeometry } = await import('./src/render/seaweedGeometry.js');
      const gallery = new T.Group(), mat = m.world.seaweed.group.children[0].material;
      for (let i = 0; i < 3; i++) {
        const k = (i - 1) * 2, x = 101 + k * Math.SQRT1_2, z = 99 - k * Math.SQRT1_2;
        const mesh = new T.Mesh(seaweedGeometry(i, { low }), mat);
        mesh.position.set(x, m.map.heightAt(x, z) - 0.02, z); mesh.receiveShadow = true; mesh.layers.set(2); gallery.add(mesh);
      }
      window.__weedViews = [...m.world.views.values()].map((v) => [v.root, v.root.visible]); for (const [o] of __weedViews) o.visible = false;
      window.__weedOcc = __weedU.mnOccOn.value; __weedU.mnOccOn.value = 0;
      m.world.vegetation.visible = false; m.world.scene.add(gallery); window.__weedGallery = gallery;
      m.world.pipeline.markDirty(); __weedCamera(101, 99, 9);
    }, device === 'low');
    await p.waitForTimeout(140); await p.screenshot({ path: `${out}/${device}-gallery-v1.png` });
    if (device === 'desktop') {
      for (const [i, style] of ['ribbon', 'fork', 'fan'].entries()) {
        await p.evaluate((index) => { __weedGallery.children.forEach((o, j) => { o.visible = j === index; }); const o = __weedGallery.children[index]; __weedCamera(o.position.x, o.position.z, 3.8); }, i);
        await p.waitForTimeout(120); await p.screenshot({ path: `${out}/variant-${style}-preview-v1.png` });
      }
      for (const [name, t] of [['0', 0], ['2', 2.1]]) {
        await p.evaluate((time) => { __weedGallery.children.forEach((o) => { o.visible = true; }); __weedCamera(101, 99, 7); __weedU.mnTime.value = time; }, t);
        await p.waitForTimeout(100); await p.screenshot({ path: `${out}/desktop-current-${name}-v1.png` });
      }
    }
    await p.evaluate(() => { __mn.world.scene.remove(__weedGallery); __weedGallery.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      __mn.world.vegetation.visible = true; __weedU.mnOccOn.value = __weedOcc; for (const [o, visible] of __weedViews) o.visible = visible;
      __mn.world.pipeline.markDirty(); cancelAnimationFrame(__weedRaf); });
    const transitions = await p.evaluate(() => {
      const m = __mn, g = m.world.seaweed.group, children = [...g.children], geometries = children.map((o) => o.geometry), result = [];
      for (const tier of ['high', 'low', 'medium', 'high']) {
        m.quality.set(tier); m.world.seaweed.update(__weedFocus);
        result.push({ tier, resourcesReused: g.children.every((o, i) => o === children[i] && o.geometry === geometries[i]), ...JSON.parse(JSON.stringify(g.userData.seaweed)) });
      }
      m.world.seaweed.update({ x: -1000, z: -1000 }); result.push({ tier: 'off-island', ...JSON.parse(JSON.stringify(g.userData.seaweed)) });
      return result;
    });
    return { device, errors, consoleErrors, state, transitions };
  } finally { await context.close(); }
}
