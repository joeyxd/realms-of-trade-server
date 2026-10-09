// Run with Playwright's browser_run_code_unsafe filename argument. Captures the actual local game.
async (page) => {
  const root = 'C:/DEV/real of trade/realms-of-trade-server';
  const out = root + '/docs/art/coast-rocks';
  const browser = page.context().browser();
  const evidence = [];
  for (const device of ['desktop', 'mobile', 'low']) {
    const mobile = device !== 'desktop';
    const context = await browser.newContext({ viewport: { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    const p = await context.newPage();
    const errors = [], consoleErrors = [];
    p.on('pageerror', (error) => errors.push(error.message));
    p.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=day&q=' + (device === 'low' ? 'low' : mobile ? 'medium' : 'high'));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled);
    await p.locator('#btn-play').click({ force: true });
    await p.waitForFunction(() => window.__mn?.world?.footprints?.active);
    await p.evaluate(() => __mn.teleport(113, 63));
    await p.waitForTimeout(1000);
    await p.evaluate(async () => {
      const m = __mn, T = await import('three');
      m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const focus = new T.Vector3(114.5, m.map.heightAt(114.5, 62) + 0.45, 62);
      m.world.rig.blend = null;
      m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = 20;
      m.world.rig.update(0, focus, null, 1); m.world.nearFade(false);
      window.__coastFocus = focus;
      window.__coastRender = () => { m.world.render(); window.__coastRaf = requestAnimationFrame(window.__coastRender); };
      window.__coastRaf = requestAnimationFrame(window.__coastRender);
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: out + '/' + device + '-map-v1.png' });
    const state = await p.evaluate(() => {
      const m = __mn, geo = [];
      m.world.vegetation.traverse((o) => { if (o.isInstancedMesh && o.parent.name.startsWith('coastRocks')) geo.push({ group: o.parent.name, instances: o.count, triangles: o.geometry.attributes.position.count / 3, bounds: { min: o.geometry.boundingBox.min.toArray(), max: o.geometry.boundingBox.max.toArray() } }); });
      return { asset: m.assets.list().find((a) => a.id === 'model:coast-rock-v1'), coast: m.world.vegetation.userData.coastRocks, groups: geo, gameErrors: m.errors, assetErrors: m.assets.errors, camera: m.world.camera.position.toArray(),
        coarse: matchMedia('(pointer: coarse)').matches, glError: m.world.renderer.getContext().getError(), footprintLimit: m.world.footprints.limit };
    });
    if (device === 'desktop') {
      await p.evaluate(() => {
        const m = __mn; m.world.rig.dist = m.world.rig.distTarget = 7.5; m.world.rig.update(0, __coastFocus, null, 1);
      });
      await p.waitForTimeout(250); await p.screenshot({ path: out + '/desktop-close-v1.png' });
      await p.evaluate(async () => {
        const m = __mn, T = await import('three');
        const { coastRockGeometry } = await import('./src/render/coastRockGeometry.js');
        const group = new T.Group(); group.name = 'QA-only-three-silhouettes';
        const material = m.world.vegetation.getObjectByName('coastRocks0').children[0].material;
        const nm = m.world.vegetation.getObjectByName('coastRocks0').children[0].userData.nm;
        const source = m.assets.data('model:coast-rock-v1').parts[0].geo;
        for (let i = 0; i < 3; i++) {
          const mesh = new T.Mesh(coastRockGeometry(source, i), material);
          const x = 115 + (i - 1) * 2, z = 68 + (i - 1) * 2;
          mesh.position.set(x, m.map.heightAt(x, z) - 0.08, z); mesh.scale.setScalar(1.5);
          mesh.castShadow = mesh.receiveShadow = true; mesh.userData.nm = nm; group.add(mesh);
        }
        window.__coastSample = group; m.world.scene.add(group); m.world.pipeline.markDirty();
        const focus = new T.Vector3(115, m.map.heightAt(115, 68) + 0.35, 68);
        m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = 10; m.world.rig.update(0, focus, null, 1);
      });
      await p.waitForTimeout(300); await p.screenshot({ path: out + '/desktop-three-silhouettes-v1.png' });
    }
    evidence.push({ device, state, pageErrors: errors, consoleErrors });
    await context.close();
  }
  for (const failure of ['missing', 'bad', 'disabled']) {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    const p = await context.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    if (failure !== 'disabled') await p.route('**/assets/models/coast-rock-v1.glb', (route) => route.fulfill({ status: failure === 'missing' ? 404 : 200, contentType: 'model/gltf-binary', body: failure === 'bad' ? 'not a glb' : '' }));
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=day&q=low' + (failure === 'disabled' ? '&noassets' : ''));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled);
    await p.locator('#btn-play').click({ force: true }); await p.waitForFunction(() => window.__mn?.world?.footprints?.active);
    await p.evaluate(() => __mn.teleport(113, 63)); await p.waitForTimeout(900);
    await p.evaluate(async () => {
      const m = __mn, T = await import('three'); m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const focus = new T.Vector3(114.5, m.map.heightAt(114.5, 62) + 0.45, 62);
      m.world.rig.blend = null; m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = 20;
      m.world.rig.update(0, focus, null, 1); m.world.nearFade(false);
      window.__coastRender = () => { m.world.render(); window.__coastRaf = requestAnimationFrame(window.__coastRender); };
      window.__coastRaf = requestAnimationFrame(window.__coastRender);
    });
    await p.waitForTimeout(250);
    evidence.push({ failure, state: await p.evaluate(() => ({ coast: __mn.world.vegetation.userData.coastRocks, errors: __mn.errors, assetErrors: __mn.assets.errors, glError: __mn.world.renderer.getContext().getError() })), pageErrors: errors });
    if (failure === 'disabled') await p.screenshot({ path: out + '/mobile-fallback-v1.png' });
    await context.close();
  }
  return evidence;
}
