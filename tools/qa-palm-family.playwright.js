// Real local game; gallery objects are temporary, render-only, at unit model scale.
async (page) => {
  const device = 'desktop';
  const root = 'C:/DEV/real of trade/realms-of-trade-server', out = root + '/docs/art/palms';
  const mobile = ['mobile', 'low'].includes(device), failure = !['desktop', 'mobile', 'low'].includes(device);
  const context = await page.context().browser().newContext({ viewport: { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], requests = [], failedResponses = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  p.on('request', (r) => { if (/\/models\/palm-|\/textures\/palm-family/.test(r.url())) requests.push(r.url()); });
  p.on('response', (r) => { if (r.status() >= 400) failedResponses.push({ url: r.url(), status: r.status() }); });
  if (device === 'missing-model') await p.route('**/models/palm-*.glb', (r) => r.fulfill({ status: 404, body: 'S05 missing model fixture' }));
  if (device === 'invalid-model') await p.route('**/models/palm-*.glb', (r) => r.fulfill({ status: 200, body: 'S05 invalid model fixture' }));
  if (device === 'missing-color') await p.route('**/textures/palm-family-v2/albedo-*.webp', (r) => r.fulfill({ status: 404, body: 'S05 missing albedo fixture' }));
  if (device === 'missing-normal') await p.route('**/textures/palm-family-v2/normal-*.webp', (r) => r.fulfill({ status: 404, body: 'S05 missing normal fixture' }));
  try {
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=day&q=' + (device === 'low' ? 'low' : mobile ? 'medium' : 'high') + (device === 'disabled' ? '&noassets' : ''));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled);
    await p.locator('#btn-play').click({ force: true }); await p.waitForFunction(() => window.__mn?.world?.footprints?.active);
    await p.evaluate(() => __mn.teleport(103, 99)); await p.waitForTimeout(700);
    await p.waitForFunction(() => __mn.world.lighting.shadowHalf === 30);
    await p.evaluate(async () => {
      const m = __mn, T = await import('three'), { U } = await import('./src/render/toon.js');
      m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise((r) => setTimeout(r, 150)); m.world.rig.blend = null; m.world.nearFade(false);
      window.__palmCamera = (x, z, dist, y = 1.8) => {
        const focus = new T.Vector3(x, m.map.heightAt(x, z) + y, z);
        m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = dist; m.world.rig.update(0, focus, null, 1);
      };
      window.__palmU = U;
      __palmCamera(101, 103, 23);
      window.__palmRender = () => { m.world.render(); window.__palmRaf = requestAnimationFrame(__palmRender); };
      window.__palmRaf = requestAnimationFrame(__palmRender);
    });
    await p.waitForTimeout(250); await p.screenshot({ path: `${out}/${device}-map-v1.png` });
    await p.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; });
    await p.screenshot({ path: `${out}/${device}-map-clean-v1.png` });
    const state = await p.evaluate(async () => {
      const m = __mn, gl = m.world.renderer.getContext(), batches = [];
      m.world.vegetation.traverse((o) => { if (o.isInstancedMesh && /^palm/.test(o.parent.name)) batches.push({ family: o.parent.name, count: o.count,
        trianglesPerInstance: (o.geometry.index?.count || o.geometry.attributes.position.count) / 3, boundRadius: o.boundingSphere?.radius,
        flex: o.geometry.attributes.aFlex?.count, uv: o.geometry.attributes.uv?.count, alphaTest: o.material.alphaTest,
        outlineAlpha: o.userData.nm?.alphaTest, outlineNormalMap: !!o.userData.nm?.normalMap, shadowAlpha: o.customDepthMaterial?.alphaTest, normalStrength: o.material.normalScale.toArray(),
        color: o.material.map && { url: o.material.map.image.currentSrc || o.material.map.image.src, width: o.material.map.image.width, height: o.material.map.image.height },
        normal: o.material.normalMap && { url: o.material.normalMap.image.currentSrc || o.material.normalMap.image.src, width: o.material.normalMap.image.width, height: o.material.normalMap.image.height } }); });
      const programs = m.world.renderer.info.programs.map((pr) => ({ name: pr.name, linked: gl.getProgramParameter(pr.program, gl.LINK_STATUS), log: gl.getProgramInfoLog(pr.program) }));
      const shadow = m.world.lighting.sun.shadow;
      return { seed: m.map.seed, palms: m.world.vegetation.userData.palms, batches, programs,
        shadow: { size: shadow.mapSize.toArray(), half: m.world.lighting.shadowHalf, radius: shadow.radius },
        assets: m.assets.list().filter((a) => /^(model|tex):palm-/.test(a.id)), errors: m.errors, assetErrors: m.assets.errors,
        coarse: matchMedia('(pointer: coarse)').matches, glError: gl.getError() };
    });
    if (!failure) {
      await p.evaluate(async () => {
        const m = __mn, T = await import('three'), gallery = new T.Group(); gallery.name = 'QA-only-S05-gallery';
        for (let i = 0; i < 3; i++) {
          const item = new T.Group(), k = (i - 1) * 6;
          item.position.set(101 + k * Math.SQRT1_2, m.map.heightAt(101 + k * Math.SQRT1_2, 99 - k * Math.SQRT1_2) - 0.1, 99 - k * Math.SQRT1_2);
          for (const family of ['palmTrunks', 'palmFronds']) {
            const src = m.world.vegetation.getObjectByName(family + i).children[0], mesh = new T.Mesh(src.geometry, src.material);
            mesh.castShadow = mesh.receiveShadow = true; mesh.userData.nm = src.userData.nm; mesh.customDepthMaterial = src.customDepthMaterial; item.add(mesh);
          }
          gallery.add(item);
        }
        m.world.vegetation.visible = false; m.world.scene.add(gallery); m.world.pipeline.markDirty(); window.__palmGallery = gallery;
        __palmCamera(101, 99, 25, 2.7);
      });
      await p.waitForTimeout(200); await p.screenshot({ path: `${out}/${device}-gallery-v1.png` });
      if (device === 'desktop') {
        for (const [i, style] of ['tall', 'curved', 'short'].entries()) {
          await p.evaluate((index) => { __palmGallery.children.forEach((o, j) => { o.visible = j === index; }); const o = __palmGallery.children[index]; __palmCamera(o.position.x, o.position.z, 13, 2.7); }, i);
          await p.waitForTimeout(200); await p.screenshot({ path: `${out}/palm-${style}-preview-v1.png` });
        }
        await p.evaluate(() => { __palmGallery.children.forEach((o) => { o.visible = true; }); __palmCamera(101, 99, 25, 2.7); __palmGallery.traverse((o) => { if (o.isMesh) o.material.normalScale.set(0, 0); }); });
        await p.waitForTimeout(200); await p.screenshot({ path: `${out}/desktop-normal-off-v1.png` });
        await p.evaluate(() => { __palmGallery.traverse((o) => { if (o.isMesh) o.material.normalScale.set(0.16, 0.16); }); __palmU.mnTime.value = 0; });
        await p.waitForTimeout(200); await p.screenshot({ path: `${out}/desktop-wind-0-v1.png` });
        await p.evaluate(() => { __palmU.mnTime.value = 2.1; }); await p.waitForTimeout(200);
        await p.screenshot({ path: `${out}/desktop-wind-2-v1.png` });
      }
      // A single production frond isolates light through its holes from overlapping canopy leaves.
      await p.evaluate(async () => {
        const m = __mn, T = await import('three'), src = m.world.vegetation.getObjectByName('palmFronds0').children[0];
        __palmGallery.visible = false;
        const geo = src.geometry.clone(); geo.setDrawRange(0, 144);
        const leaf = new T.Mesh(geo, src.material); leaf.castShadow = leaf.receiveShadow = true;
        leaf.userData.nm = src.userData.nm; leaf.customDepthMaterial = src.customDepthMaterial;
        leaf.position.set(101, m.map.heightAt(101, 99) - 0.1, 99); m.world.scene.add(leaf); window.__palmLeaf = leaf;
        const d = m.world.lighting.sun.position.clone().sub(m.world.lighting.sun.target.position).normalize();
        const x = 102.4 - d.x / d.y * 5.8, z = 99 - d.z / d.y * 5.8;
        __palmCamera(x, z, 7, 0.15); m.world.pipeline.markDirty();
      });
      await p.waitForTimeout(200); await p.screenshot({ path: `${out}/${device}-shadow-holes-v1.png` });
      if (device === 'desktop') {
        await p.evaluate(() => { __palmU.mnTime.value = 0; });
        await p.waitForTimeout(200); await p.screenshot({ path: `${out}/desktop-shadow-wind-0-v1.png` });
        await p.evaluate(() => { __palmU.mnTime.value = 2.1; });
        await p.waitForTimeout(200); await p.screenshot({ path: `${out}/desktop-shadow-wind-2-v1.png` });
        await p.evaluate(() => {
          const original = __palmLeaf.customDepthMaterial, solid = original.clone();
          solid.onBeforeCompile = (sh) => { original.onBeforeCompile(sh); sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', '')
            .replace('if (texture2D(mnPalmShadowCut, vPalmShadowUV).a < 0.35) discard;', ''); };
          solid.customProgramCacheKey = () => 'QA-only-solid-palm-shadow'; __palmLeaf.customDepthMaterial = solid; window.__palmSolidDepth = solid;
        });
        await p.waitForTimeout(200); await p.screenshot({ path: `${out}/desktop-shadow-solid-control-v1.png` });
      }
      await p.evaluate(() => { __mn.world.scene.remove(__palmLeaf); __palmLeaf.geometry.dispose(); window.__palmSolidDepth?.dispose(); });
      await p.evaluate(() => { __mn.world.scene.remove(__palmGallery); __mn.world.vegetation.visible = true; __mn.world.pipeline.markDirty(); });
      // A close camera examines an actual palm placement at the generated scale.
      await p.evaluate(() => { __palmCamera(103.97700796369463, 103.88836386613548, 12, 2.2); });
      await p.waitForTimeout(200); await p.screenshot({ path: `${out}/${device}-contact-v1.png` });
    }
    await p.evaluate(() => { cancelAnimationFrame(__palmRaf); });
    const post = await p.evaluate(() => { const r = __mn.world.renderer, gl = r.getContext(); return { gameErrors: __mn.errors,
      glError: gl.getError(), linked: r.info.programs.every((p) => gl.getProgramParameter(p.program, gl.LINK_STATUS)) }; });
    return { device, errors, consoleErrors, failedResponses, requests, state, post };
  } finally { await context.close(); }
}
