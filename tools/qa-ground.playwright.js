// Actual-map captures; each invocation creates and closes one device context.
async (page) => {
  const device = 'desktop'; // desktop, mobile, low, missing-color, missing-normal, disabled
  const mobile = device !== 'desktop';
  const context = await page.context().browser().newContext({ viewport: { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], groundRequests = [];
  p.on('request', (r) => { if (r.url().includes('/ground-family-v1/')) groundRequests.push(r.url()); });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  if (device.startsWith('missing')) await p.route('**/ground-family-v1/atlas-' + (device === 'missing-color' ? 'albedo' : 'normal') + '-*.webp', (r) => r.fulfill({ status: 404, body: '' }));
  await p.goto('http://127.0.0.1:5192/?solo&debug&tod=day&q=' + (device === 'low' || device === 'disabled' ? 'low' : mobile ? 'medium' : 'high') + (device === 'disabled' ? '&noassets' : ''));
  await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled);
  await p.locator('#btn-play').click({ force: true });
  await p.waitForFunction(() => window.__mn?.world?.footprints?.active);
  await p.evaluate(() => __mn.teleport(98, 92)); await p.waitForTimeout(800);
  await p.evaluate(async () => {
    const m = __mn; m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
    await new Promise((r) => setTimeout(r, 150)); m.world.rig.blend = null; m.world.nearFade(false);
    window.__groundRender = () => { m.world.render(); window.__groundRaf = requestAnimationFrame(window.__groundRender); };
    window.__groundRaf = requestAnimationFrame(window.__groundRender);
  });
  const shots = [], samples = [];
  for (const view of [{ name: 'beach', x: 98, z: 92, dist: 20 }, { name: 'road', x: 55.5, z: 52, dist: 20 }, { name: 'town', x: 66.5, z: 75, dist: 29 }, { name: 'arena', x: -17.7, z: -17.7, dist: 40 }]) {
    await p.evaluate(async (v) => {
      const m = __mn, T = await import('three'), focus = new T.Vector3(v.x, m.map.heightAt(v.x, v.z) + 0.45, v.z);
      m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = v.dist; m.world.rig.update(0, focus, null, 1);
    }, view);
    await p.waitForTimeout(250);
    const file = 'docs/art/ground/' + device + '-' + view.name + '-v1.png';
    await p.screenshot({ path: 'C:/DEV/real of trade/realms-of-trade-server/' + file }); shots.push(file);
    if (!device.startsWith('missing') && device !== 'disabled' && view.name !== 'arena') {
      await p.evaluate(() => { document.querySelector('#ui').style.visibility = 'hidden'; });
      const clean = file.replace('-v1.png', '-clean-v1.png');
      await p.screenshot({ path: 'C:/DEV/real of trade/realms-of-trade-server/' + clean }); shots.push(clean);
      await p.evaluate(() => { document.querySelector('#ui').style.visibility = ''; });
    }
    samples.push(await p.evaluate((v) => ({ ...v, height: __mn.map.heightAt(v.x, v.z), masks: __mn.map.masks(v.x, v.z), material: __mn.map.materialAt(v.x, v.z) }), view));
    if (device.startsWith('missing') || device === 'disabled') break;
  }
  const state = await p.evaluate(() => {
    const m = __mn, terrain = m.world.scene.getObjectByName('terrain'), gl = m.world.renderer.getContext();
    const entry = m.world.renderer.properties.get(terrain.material).currentProgram;
    let samplers = [];
    if (entry?.program) for (let i = 0; i < gl.getProgramParameter(entry.program, gl.ACTIVE_UNIFORMS); i++) {
      const u = gl.getActiveUniform(entry.program, i);
      if (u.type === gl.SAMPLER_2D || u.type === gl.SAMPLER_CUBE || u.type === gl.SAMPLER_2D_SHADOW) samplers.push({ name: u.name, size: u.size });
    }
    return { loaded: terrain.userData.ground.loaded, enabled: terrain.userData.ground.uniforms.mnGroundEnabled.value,
      normalOn: terrain.userData.ground.uniforms.mnGroundNormalOn.value,
      atlases: ['atlas-albedo','atlas-normal'].map((n) => { const id = 'tex:ground-' + n + '-v1', s = m.assets.state.get(id), t = m.assets.texture(id);
        return { id, state: s?.state ?? 'absent', selectedSrc: s?.selectedSrc ?? null, width: t?.image?.width ?? null, height: t?.image?.height ?? null, colorSpace: t?.colorSpace ?? null }; }),
      requestedGround: performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('ground-family-v1')),
      coarse: matchMedia('(pointer: coarse)').matches, gameErrors: m.errors, assetErrors: m.assets.errors,
      glError: gl.getError(), linked: entry?.program ? gl.getProgramParameter(entry.program, gl.LINK_STATUS) : null,
      samplerLimit: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), activeSamplers: samplers, camera: m.world.camera.position.toArray() };
  });
  await context.close();
  return { device, state, samples, shots, groundRequests, pageErrors: errors, consoleErrors };
}
