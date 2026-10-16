// Fixed-clock coastal comparison in isolated solo sessions; only root runs the browser/GPU.
async (page) => {
  const device = 'desktop', phase = 'before';
  const mobile = ['mobile', 'low', 'portrait'].includes(device), night = device === 'night';
  const viewport = device === 'portrait' ? { width: 390, height: 844 } : { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 };
  const out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/water-clarity';
  const context = await page.context().browser().newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
  try {
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=' + (night ? 'night' : 'day') + '&q=' + (device === 'low' ? 'low' : mobile ? 'medium' : 'high') + (device === 'disabled' ? '&noassets' : ''));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled);
    await p.locator('#btn-play').click({ force: true });
    await p.waitForFunction(() => window.__mn?.world?.footprints?.active);
    await p.evaluate(() => __mn.teleport(96, 84));
    await p.waitForFunction(() => __mn.world.lighting.shadowHalf === 30);
    await p.evaluate(async () => {
      const m = __mn, T = await import('three'), { U } = await import('./src/render/toon.js');
      m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise((r) => setTimeout(r, 140)); m.world.rig.blend = null; m.world.nearFade(false);
      U.mnTime.value = 4.2; window.__waterU = U;
      m.world.seaweed.update({ x: 116.89249224727973, z: 95.85232692072168 });
      window.__waterCamera = (x, z, dist) => {
        const focus = new T.Vector3(x, Math.max(0, m.map.heightAt(x, z)) + 0.1, z);
        window.__waterTarget = focus.toArray();
        m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = dist; m.world.rig.update(0, focus, null, 1);
      };
      window.__waterRender = () => { m.world.render(); window.__waterRaf = requestAnimationFrame(__waterRender); };
      __waterRaf = requestAnimationFrame(__waterRender);
      window.__waterState = () => {
        const r = m.world.renderer, gl = r.getContext(), w = m.world.water, u = w.material.uniforms;
        r.info.autoReset = false; r.info.reset(); m.world.render(); const counts = { ...r.info.render }; r.info.autoReset = true;
        const floats = Object.fromEntries(Object.entries(u).filter(([k, o]) => typeof o.value === 'number').map(([k, o]) => [k, o.value]));
        const samplers = Object.entries(u).filter(([k, o]) => o.value?.isTexture).map(([k, o]) => ({ name: k, width: o.value.image?.width, height: o.value.image?.height, uuid: o.value.uuid }));
        return { quality: m.quality.current, coarse: matchMedia('(pointer: coarse)').matches, mode: w.material.defines.MN_WATER_SSR === '' ? 'screen-refraction' : 'simple',
          time: U.mnTime.value, terrainCaustics: U.mnTerrainCaustics.value, uniforms: floats, samplers, counts, errors: m.errors,
          waterGeometry: w.geometry.uuid, triangles: w.geometry.index.count / 3, materials: Object.values(w.userData.materials).map(o=>o.uuid),
          glError: gl.getError(), programsLinked: r.info.programs.every((pr) => gl.getProgramParameter(pr.program, gl.LINK_STATUS)),
          camera: { position: m.world.camera.position.toArray(), target: [...__waterTarget], fov: m.world.camera.fov } };
      };
    });
    const views = [];
    for (const [name, x, z, distance] of [['map', 116.89249224727973, 95.85232692072168, 22], ['close', 116.89249224727973, 95.85232692072168, 5], ['deep', 135, 112, 32]]) {
      await p.evaluate(({ x, z, distance, hide }) => { document.getElementById('ui').style.visibility = hide ? 'hidden' : 'visible'; __waterCamera(x, z, distance); }, { x, z, distance, hide: name !== 'map' });
      await p.waitForTimeout(160); await p.screenshot({ path: `${out}/${device}-${name}-${phase}-v1.png` });
      views.push({ name, x, z, distance, state: await p.evaluate(() => __waterState()) });
    }
    const transitions = await p.evaluate(() => {
      const m = __mn, w = m.world.water, geometry = w.geometry, materials = Object.values(w.userData.materials), states = [];
      for (const tier of ['high', 'low', 'medium', 'high']) {
        m.quality.set(tier); m.world.render(); const state = __waterState();
        states.push({ tier, reused: w.geometry === geometry && Object.values(w.userData.materials).every((o, i) => o === materials[i]), ...state });
      }
      cancelAnimationFrame(__waterRaf); return states;
    });
    return { device, phase, viewport, errors, consoleErrors, views, transitions };
  } finally { await context.close(); }
}
