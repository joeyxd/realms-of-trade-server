// Root-only serial GPU review of the existing town, including real asset failures and tier changes.
async (page) => {
  const device = 'desktop', phase = 'after';
  const baselineSource = null;
  const mobile = ['mobile', 'low', 'portrait'].includes(device), night = device === 'night';
  const viewport = device === 'portrait' ? { width: 390, height: 844 } : { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 };
  const out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/town-wood';
  const context = await page.context().browser().newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], requests = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
  p.on('request', r => { if (/town-wood-v1\/atlas-/.test(r.url())) requests.push(r.url()); });
  try {
    if (phase === 'before') {
      let source = baselineSource;
      if (source === null) {
        const response = await context.request.get('http://127.0.0.1:5190/files/docs/art/source/town-wood-v1/before/props.source.js');
        if (!response.ok()) throw Error('Missing immutable props baseline');
        source = await response.text();
      }
      await p.route('**/src/render/props.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
      await p.route('**/assets/manifest.json', async route => {
        const r = await route.fetch(), manifest = await r.json();
        manifest.assets = manifest.assets.filter(e => !/^tex:town-wood-(albedo|normal)-v1$/.test(e.id));
        await route.fulfill({ json: manifest });
      });
    }
    if (device.startsWith('missing-')) await p.route('**/town-wood-v1/atlas-' + device.slice(8) + '-desktop.webp', route => route.fulfill({ status: 404, body: '' }));
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=' + (night ? 'night' : 'day') + '&q=' + (device === 'low' ? 'low' : mobile ? 'medium' : 'high') + (device === 'disabled' ? '&noassets' : ''));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled);
    await p.locator('#btn-play').click({ force: true });
    await p.waitForFunction(() => __mn.world?.footprints?.active);
    await p.evaluate(() => { const v = __mn.map.landmarks.village; __mn.teleport(v.x, v.z); });
    await p.waitForTimeout(700);
    const capture = await p.evaluate(async () => {
      const m = __mn, T = await import('three'), { U } = await import('./src/render/toon.js');
      m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise(r => setTimeout(r, 140)); m.world.rig.blend = null; m.world.nearFade(false); U.mnTime.value = 4.2;
      const meshes = [], chunks = [];
      const hashArray = async a => {
        const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
        return { bytes: a.byteLength, sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') };
      };
      const all = []; m.world.props.group.traverse(o => { if (o.isMesh) all.push(o); });
      const tileVertices = Array(9).fill(0); let neutralVertices = 0;
      for (const o of all) {
        const chunk = o.name === 'propsChunk', attrs = {}, uv = o.geometry.attributes.uv, mask = o.geometry.attributes.aTownWood;
        if (chunk) {
          chunks.push(o);
          if (uv && mask) for (let i = 0; i < uv.count; i++) {
            if (mask.getX(i) < .5) { neutralVertices++; continue; }
            const tile = Math.floor(uv.getX(i) * 4) + 4 * Math.floor((1 - uv.getY(i)) * 4);
            if (tile >= 0 && tile < 9) tileVertices[tile]++;
          }
        }
        for (const [name, a] of Object.entries(o.geometry.attributes)) attrs[name] = { itemSize: a.itemSize, normalized: a.normalized, ...await hashArray(a.array) };
        meshes.push({ chunk, deck: o.name === 'dockDeck', animated: o === m.world.props.ship.userData.flag || m.world.props.flags.includes(o),
          name: o.name, attributes: attrs, index: o.geometry.index ? await hashArray(o.geometry.index.array) : null,
          matrix: o.matrix.toArray(), triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3,
          key: Array.isArray(o.material) ? o.material.map(mat => mat.customProgramCacheKey()) : o.material.customProgramCacheKey(),
          castShadow: o.castShadow, receiveShadow: o.receiveShadow, normalPass: !!o.userData.nm });
      }
      window.__townChunks = chunks;
      window.__townCamera = name => {
        const v = m.map.landmarks.village, h = m.map.props.find(p => p.kind === 'hut'), s = m.map.props.find(p => p.kind === 'stall'), d = m.map.dock;
        const target = name === 'overview' ? new T.Vector3(v.x, m.map.groundAt(v.x, v.z) + .5, v.z)
          : name === 'house' ? new T.Vector3(h.x, h.y + 2, h.z)
          : name === 'stall' ? new T.Vector3(s.x, s.y + .8, s.z)
          : new T.Vector3(d.base.x + d.dir.x * 5, d.deckY - .2, d.base.z + d.dir.z * 5);
        const rig = m.world.rig;
        rig.yaw = rig.yawTarget = name === 'house' ? h.rot + .55 : name === 'stall' ? s.rot + .55 : Math.PI / 4;
        rig.pitch = rig.pitchTarget = name === 'overview' ? .85 : .48;
        rig.dist = rig.distTarget = name === 'overview' ? 58 : name === 'house' ? 17 : name === 'stall' ? 12 : 20;
        rig.trauma = rig.punch = 0; rig.snapTo(target); rig.update(0, target, null, 1);
        window.__townTarget = target.toArray();
      };
      window.__townRender = () => { m.world.render(); window.__townRaf = requestAnimationFrame(__townRender); };
      __townRaf = requestAnimationFrame(__townRender);
      window.__townState = () => {
        const r = m.world.renderer, gl = r.getContext();
        const albedo = m.assets.texture('tex:town-wood-albedo-v1'), normal = m.assets.texture('tex:town-wood-normal-v1');
        const info = (tex, id, property) => tex ? { src: m.assets.list().find(e => e.id === id)?.selectedSrc,
          width: tex.image.width, height: tex.image.height, data: m.assets.man.entries.get(id)?.data, colorSpace: tex.colorSpace,
          shared: chunks.every(o => o.material[property] === tex), textureRef: tex.uuid } : null;
        return { quality: m.quality.current, coarse: matchMedia('(pointer: coarse)').matches,
          townWood: { albedo: info(albedo, 'tex:town-wood-albedo-v1', 'map'), normal: info(normal, 'tex:town-wood-normal-v1', 'normalMap'),
            mapped: chunks.every(o => !!o.material.map), normalMapped: chunks.every(o => !!o.material.normalMap),
            chunks: chunks.length, geometries: chunks.map(o => o.geometry.uuid), materials: chunks.map(o => o.material.uuid) },
          assetErrors: m.assets.errors, gameErrors: m.errors, glError: gl.getError(),
          programsLinked: r.info.programs.every(pr => gl.getProgramParameter(pr.program, gl.LINK_STATUS)),
          camera: { position: m.world.camera.position.toArray(), target: [...__townTarget], fov: m.world.camera.fov } };
      };
      const mapBytes = new TextEncoder().encode(JSON.stringify(m.map.props));
      return { dock: m.map.dock, mapProps: { count: m.map.props.length, ...await hashArray(mapBytes) }, meshes, tileVertices, neutralVertices };
    });
    const views = [];
    for (const name of ['overview', 'house', 'stall', 'dock']) {
      await p.evaluate(name => { document.getElementById('ui').style.visibility = name === 'overview' ? 'visible' : 'hidden'; __townCamera(name); }, name);
      await p.waitForTimeout(180); await p.screenshot({ path: `${out}/${device}-${name}-${phase}-v1.png` });
      views.push({ name, state: await p.evaluate(() => __townState()) });
    }
    const transitions = await p.evaluate(() => {
      const initial = __townState().townWood, states = [];
      for (const tier of ['high', 'low', 'medium', 'high']) {
        __mn.quality.set(tier); __mn.world.render(); const state = __townState();
        states.push({ tier, reused: JSON.stringify(state.townWood.materials) === JSON.stringify(initial.materials)
          && JSON.stringify(state.townWood.geometries) === JSON.stringify(initial.geometries), ...state });
      }
      cancelAnimationFrame(__townRaf); return states;
    });
    return { device, phase, viewport, ...capture, requests, errors, consoleErrors, views, transitions };
  } finally { await context.close(); }
}
