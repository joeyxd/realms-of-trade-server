// Reproducible views of existing props only; root owns this serial browser/GPU review.
async (page) => {
  const device = 'desktop', phase = 'before';
  const baselineSource = null; // Initial capture may inject the frozen text before catalogue registration.
  const mobile = ['mobile', 'low', 'portrait'].includes(device), night = device === 'night';
  const viewport = device === 'portrait' ? { width: 390, height: 844 } : { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 };
  const out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/rock-faces';
  const context = await page.context().browser().newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
  try {
    if (phase === 'before') {
      let source = baselineSource;
      if (source === null) {
        const response = await context.request.get('http://127.0.0.1:5190/files/docs/art/source/rock-faces-v1/before/vegetation.source.js');
        if (!response.ok()) throw Error('Missing immutable vegetation baseline');
        source = await response.text();
      }
      await p.route('**/src/render/vegetation.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
    }
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=' + (night ? 'night' : 'day') + '&q=' + (device === 'low' ? 'low' : mobile ? 'medium' : 'high') + (device === 'disabled' ? '&noassets' : ''));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled);
    await p.locator('#btn-play').click({ force: true });
    await p.waitForFunction(() => __mn.world?.footprints?.active);
    await p.evaluate(() => __mn.teleport(113, 63));
    await p.waitForTimeout(700);
    await p.evaluate(async () => {
      const m = __mn, T = await import('three'), { U } = await import('./src/render/toon.js');
      m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise(r => setTimeout(r, 140)); m.world.rig.blend = null; m.world.nearFade(false);
      U.mnTime.value = 4.2;
      const hashes = new WeakMap(), meshes = [];
      m.world.vegetation.traverse(o => { if (o.isInstancedMesh && /^(rocks|coastRocks|volcanicRocks)/.test(o.parent.name)) meshes.push(o); });
      const hashArray = async a => {
        const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return { bytes: bytes.length, sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') };
      };
      for (const mesh of meshes) if (!hashes.has(mesh.geometry)) {
        const g = mesh.geometry, attributes = {};
        for (const [name, attr] of Object.entries(g.attributes)) attributes[name] = { itemSize: attr.itemSize, normalized: attr.normalized, ...await hashArray(attr.array) };
        hashes.set(g, { attributes, index: g.index ? await hashArray(g.index.array) : null });
      }
      window.__rockCamera = (x, z, dist) => {
        const focus = new T.Vector3(x, Math.max(0, m.map.heightAt(x, z)) + .35, z);
        window.__rockTarget = focus.toArray(); m.world.rig.snapTo(focus);
        m.world.rig.dist = m.world.rig.distTarget = dist; m.world.rig.update(0, focus, null, 1);
      };
      window.__rockRender = () => { m.world.render(); window.__rockRaf = requestAnimationFrame(__rockRender); };
      __rockRaf = requestAnimationFrame(__rockRender);
      window.__rockState = () => {
        const r = m.world.renderer, gl = r.getContext(), rocks = [];
        m.world.vegetation.traverse(o => {
          if (o.isInstancedMesh && /^(rocks|coastRocks|volcanicRocks)/.test(o.parent.name)) {
            rocks.push({ group: o.parent.name, count: o.count, key: o.material.customProgramCacheKey(),
              geometry: o.geometry.uuid, material: o.material.uuid, attributes: Object.keys(o.geometry.attributes),
              geometryBytes: hashes.get(o.geometry), flatShading: o.material.flatShading === true,
              matrices: [...o.instanceMatrix.array], colors: o.instanceColor ? [...o.instanceColor.array] : null,
              triangles: (o.geometry.index?.count || o.geometry.attributes.position.count) / 3,
              paint: o.material.userData.rockPaint ? { family: o.material.userData.rockPaint.family, palette: o.material.userData.rockPaint.palette, texturesAdded: 0 } : null,
              shadow: o.castShadow, normalPass: !!o.userData.nm });
          }
        });
        return { quality: m.quality.current, coarse: matchMedia('(pointer: coarse)').matches, time: U.mnTime.value,
          rockProps: m.map.props.filter(o => o.kind === 'rock'), rocks, metadata: m.world.vegetation.userData.rockFaces || null,
          coast: m.world.vegetation.userData.coastRocks, assetErrors: m.assets.errors, gameErrors: m.errors, errors: m.errors,
          glError: gl.getError(), programsLinked: r.info.programs.every(pr => gl.getProgramParameter(pr.program, gl.LINK_STATUS)),
          camera: { position: m.world.camera.position.toArray(), target: [...__rockTarget], fov: m.world.camera.fov } };
      };
    });
    const views = [];
    for (const [name, x, z, distance] of [['beach', 116.5221385192126, 59.48881652439013, 12], ['interior', 82.94041897170246, 70.8964933664538, 9], ['wet', -123.24299205327407, -78.14191589830443, 8]]) {
      await p.evaluate(({ x, z, distance, name }) => { document.getElementById('ui').style.visibility = name === 'beach' ? 'visible' : 'hidden'; __rockCamera(x, z, distance); }, { x, z, distance, name });
      await p.waitForTimeout(160); await p.screenshot({ path: `${out}/${device}-${name}-${phase}-v1.png` });
      views.push({ name, x, z, distance, state: await p.evaluate(() => __rockState()) });
    }
    const transitions = await p.evaluate(() => {
      const m = __mn, old = __rockState().rocks, states = [];
      for (const tier of ['high', 'low', 'medium', 'high']) {
        m.quality.set(tier); m.world.render(); const state = __rockState();
        states.push({ tier, reused: state.rocks.every((r, i) => r.geometry === old[i].geometry && r.material === old[i].material), ...state });
      }
      cancelAnimationFrame(__rockRaf); return states;
    });
    return { device, phase, viewport, errors, consoleErrors, views, transitions };
  } finally { await context.close(); }
}
