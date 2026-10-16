// Root-only serial GPU comparison; source overrides and camera fixtures do not change the live game.
async page => {
  const device = 'desktop', phase = 'after', baselineSources = null;
  const mobile = ['mobile', 'low', 'portrait'].includes(device);
  const viewport = device === 'portrait' ? { width: 390, height: 844 } : { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 };
  const out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/town-furniture';
  const context = await page.context().browser().newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], requests = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
  p.on('request', r => { if (/town-wood-v1/.test(r.url())) requests.push(r.url()); });
  try {
    if (phase === 'before') {
      for (const name of ['props.js', 'resourceNodes.js']) {
        let source = baselineSources?.[name];
        if (!source) {
          const response = await context.request.get('http://127.0.0.1:5190/files/docs/art/source/town-furniture-v1/before/' + name);
          if (!response.ok()) throw Error('Missing immutable S19 baseline ' + name);
          source = await response.text();
        }
        await p.route('**/src/render/' + name, route => route.fulfill({ contentType: 'text/javascript', body: source }));
      }
    }
    if (device === 'missing-albedo') await p.route('**/assets/textures/town-wood-v1/atlas-albedo-desktop.webp', route => route.fulfill({ status: 404, body: '' }));
    if (device === 'missing-normal') await p.route('**/assets/textures/town-wood-v1/atlas-normal-desktop.webp', route => route.fulfill({ status: 404, body: '' }));
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=day&q=' + (device === 'low' ? 'low' : mobile ? 'medium' : 'high') + (device === 'disabled' ? '&noassets' : ''));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 60000 });
    await p.locator('#btn-play').click({ force: true });
    await p.waitForFunction(() => __mn.client.resources?.bench && __mn.world.resources.bench);
    await p.evaluate(() => { const b = __mn.client.resources.bench; __mn.teleport(b.x + 2, b.z + 2); });
    await p.waitForTimeout(700);
    const capture = await p.evaluate(async () => {
      const m = __mn, T = await import('three'), { U } = await import('./src/render/toon.js');
      m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise(r => setTimeout(r, 140)); m.world.rig.blend = null; m.world.nearFade(false); U.mnTime.value = 4.2;
      m.world.render();
      const hashArray = async a => {
        const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
        return { bytes: a.byteLength, sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') };
      };
      const meshRecord = async o => {
        const attrs = {};
        for (const [name, a] of Object.entries(o.geometry.attributes)) attrs[name] = { itemSize: a.itemSize, ...await hashArray(a.array) };
        return { name: o.name, animated: o === m.world.props.ship.userData.flag || m.world.props.flags.includes(o), attributes: attrs,
          index: o.geometry.index ? await hashArray(o.geometry.index.array) : null,
          matrix: o.matrix.toArray(), triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3,
          count: o.count ?? null, castShadow: o.castShadow, receiveShadow: o.receiveShadow,
          key: o.material.customProgramCacheKey(), metadata: o.userData.townFurniture || null };
      };
      const all = []; m.world.props.group.traverse(o => { if (o.isMesh) all.push(o); });
      const bench = m.world.resources.bench, sepia = all.filter(o => o.userData.townFurniture?.kind === 'sepia');
      const meshes = await Promise.all(all.map(meshRecord));
      const benchMeshes = await Promise.all(bench.children.filter(o => o.isMesh).map(meshRecord));
      window.__furnitureCamera = name => {
        const v = m.map.landmarks.village, b = m.client.resources.bench, n = m.map.npcs.find(n => n.id === 'tattoo'), f = n.facing || 0;
        const target = name === 'overview' ? new T.Vector3(v.x, m.map.groundAt(v.x, v.z), v.z)
          : name === 'bench' ? new T.Vector3(b.x, b.y + .55, b.z)
          : new T.Vector3(n.x - Math.sin(f) * 2, m.map.groundAt(n.x - Math.sin(f) * 2, n.z - Math.cos(f) * 2) + 1, n.z - Math.cos(f) * 2);
        const rig = m.world.rig;
        rig.yaw = rig.yawTarget = name === 'sepia' ? f + .55 : Math.PI / 4;
        rig.pitch = rig.pitchTarget = name === 'overview' ? .85 : name === 'sepia' ? .50 : .65;
        rig.dist = rig.distTarget = name === 'overview' ? 39 : name === 'sepia' ? 6.1 : 4.2;
        rig.trauma = rig.punch = 0; rig.snapTo(target); rig.update(0, target, null, 1); window.__furnitureTarget = target.toArray();
        m.world.lights.update(0, target, null);
      };
      window.__furnitureRender = () => { m.world.render(); window.__furnitureRaf = requestAnimationFrame(__furnitureRender); };
      __furnitureRaf = requestAnimationFrame(__furnitureRender);
      window.__furnitureState = () => {
        const r = m.world.renderer, gl = r.getContext(), body = bench.children.find(o => o.name === 'townWorkbench');
        const info = (id, slot) => {
          const tex = m.assets.texture(id);
          return tex ? { src: m.assets.list().find(e => e.id === id)?.selectedSrc, width: tex.image.width, height: tex.image.height,
            colorSpace: tex.colorSpace, textureRef: tex.uuid, shared: !!body && body.material[slot] === tex } : null;
        };
        return { quality: m.quality.current, coarse: matchMedia('(pointer: coarse)').matches,
          furniture: { applied: !!body, albedo: info('tex:town-wood-albedo-v1', 'map'), normal: info('tex:town-wood-normal-v1', 'normalMap'),
            bench: { mapped: !!body, meshes: bench.children.filter(o => o.isMesh).length, geometry: body?.geometry.uuid || null,
              material: body?.material.uuid || null, metadata: bench.userData.townFurniture || null },
            sepia: sepia.map(o => o.userData.townFurniture) },
          assetErrors: m.assets.errors, gameErrors: m.errors, glError: gl.getError(),
          programsLinked: r.info.programs.every(pr => gl.getProgramParameter(pr.program, gl.LINK_STATUS)),
          camera: { position: m.world.camera.position.toArray(), target: [...__furnitureTarget], fov: m.world.camera.fov } };
      };
      return { resourceAnchor: m.client.resources.bench, resourceNodes: await hashArray(new TextEncoder().encode(JSON.stringify(m.client.resources.nodes))),
        benchPose: bench.position.toArray(), mapProps: { count: m.map.props.length, ...await hashArray(new TextEncoder().encode(JSON.stringify(m.map.props))) }, meshes, benchMeshes };
    });
    const views = [];
    for (const name of ['bench', 'sepia', 'overview']) {
      await p.evaluate(name => { document.getElementById('ui').style.visibility = name === 'overview' ? 'visible' : 'hidden'; __furnitureCamera(name); }, name);
      await p.waitForTimeout(180); await p.screenshot({ path: `${out}/${device}-${name}-${phase}-v1.png` });
      views.push({ name, state: await p.evaluate(() => __furnitureState()) });
    }
    const transitions = await p.evaluate(() => {
      const initial = JSON.stringify(__furnitureState().furniture), states = [];
      for (const tier of ['high', 'low', 'medium', 'high']) {
        __mn.quality.set(tier); __mn.world.render(); const state = __furnitureState();
        states.push({ tier, reused: JSON.stringify(state.furniture) === initial, ...state });
      }
      cancelAnimationFrame(__furnitureRaf); return states;
    });
    return { device, phase, viewport, ...capture, requests, errors, consoleErrors, views, transitions };
  } finally { await context.close(); }
}
