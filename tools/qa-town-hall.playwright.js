// Root-only serial GPU comparison; source overrides and camera fixtures do not change the live game.
async page => {
  const device = 'desktop', phase = 'after', baselineSources = null;
  const mobile = ['mobile', 'low', 'portrait'].includes(device);
  const viewport = device === 'portrait' ? { width: 390, height: 844 } : { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 };
  const out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/town-hall';
  const context = await page.context().browser().newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], requests = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
  p.on('request', r => { if (/town-wood-v1/.test(r.url())) requests.push(r.url()); });
  try {
    if (phase === 'before') {
      for (const name of ['props.js']) {
        let source = baselineSources?.[name];
        if (!source) {
          const response = await context.request.get('http://127.0.0.1:5190/files/docs/art/source/town-hall-v1/before/' + name);
          if (!response.ok()) throw Error('Missing immutable S20 baseline ' + name);
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
      const { selectTownHall } = await import('./src/render/townHall.js');
      const hall = selectTownHall(m.map), banner = all.find(o => o.name === 'townHallBanner');
      const meshes = await Promise.all(all.map(meshRecord));
      window.__hallCamera = name => {
        const v = m.map.landmarks.village, f = hall.rot;
        const target = name === 'overview' ? new T.Vector3(v.x + (hall.x - v.x) * .1, m.map.groundAt(v.x, v.z) + 1, v.z + (hall.z - v.z) * .1)
          : name === 'arrival' ? new T.Vector3(hall.x, hall.y + 2.8, hall.z)
          : new T.Vector3(hall.x, hall.y + 3.9, hall.z);
        const rig = m.world.rig;
        rig.yaw = rig.yawTarget = name === 'overview' ? Math.PI / 4 : f - Math.PI / 2 + .35;
        rig.pitch = rig.pitchTarget = name === 'overview' ? .85 : name === 'arrival' ? .55 : .28;
        rig.dist = rig.distTarget = name === 'overview' ? 49 : name === 'arrival' ? 20 : 11;
        rig.trauma = rig.punch = 0; rig.snapTo(target); rig.update(0, target, null, 1); window.__hallTarget = target.toArray();
        m.world.lights.update(0, target, null);
      };
      window.__hallRender = () => { m.world.render(); window.__hallRaf = requestAnimationFrame(__hallRender); };
      __hallRaf = requestAnimationFrame(__hallRender);
      window.__hallState = () => {
        const r = m.world.renderer, gl = r.getContext();
        const info = id => {
          const tex = m.assets.texture(id);
          return tex ? { src: m.assets.list().find(e => e.id === id)?.selectedSrc, width: tex.image.width, height: tex.image.height,
            colorSpace: tex.colorSpace, textureRef: tex.uuid } : null;
        };
        return { quality: m.quality.current, coarse: matchMedia('(pointer: coarse)').matches,
          hall: { applied: !!banner, metadata: m.world.props.group.userData.townHall || null,
            albedo: info('tex:town-wood-albedo-v1'), normal: info('tex:town-wood-normal-v1'),
            banner: banner ? { geometry: banner.geometry.uuid, material: banner.material.uuid, texture: banner.material.map.uuid,
              width: banner.material.map.image.width, height: banner.material.map.image.height, colorSpace: banner.material.map.colorSpace,
              triangles: banner.geometry.index.count / 3, castShadow: banner.castShadow, receiveShadow: banner.receiveShadow } : null },
          assetErrors: m.assets.errors, gameErrors: m.errors, glError: gl.getError(),
          programsLinked: r.info.programs.every(pr => gl.getProgramParameter(pr.program, gl.LINK_STATUS)),
          camera: { position: m.world.camera.position.toArray(), target: [...__hallTarget], fov: m.world.camera.fov } };
      };
      return { resourceAnchor: m.client.resources.bench, resourceNodes: await hashArray(new TextEncoder().encode(JSON.stringify(m.client.resources.nodes))),
        mapProps: { count: m.map.props.length, ...await hashArray(new TextEncoder().encode(JSON.stringify(m.map.props))) },
        mapContract: await hashArray(new TextEncoder().encode(JSON.stringify({ landmarks: m.map.landmarks, dock: m.map.dock, npcs: m.map.npcs, colliders: m.map.colliders }))),
        hallAnchor: { x: hall.x, y: hall.y, z: hall.z, rot: hall.rot, scale: hall.scale }, meshes };
    });
    const views = [];
    for (const name of ['hall', 'arrival', 'overview']) {
      await p.evaluate(name => { document.getElementById('ui').style.visibility = 'hidden'; __hallCamera(name); }, name);
      await p.waitForTimeout(180); await p.screenshot({ path: `${out}/${device}-${name}-${phase}-v1.png` });
      views.push({ name, state: await p.evaluate(() => __hallState()) });
    }
    const transitions = await p.evaluate(() => {
      const initial = JSON.stringify(__hallState().hall), states = [];
      for (const tier of ['high', 'low', 'medium', 'high']) {
        __mn.quality.set(tier); __mn.world.render(); const state = __hallState();
        states.push({ tier, reused: JSON.stringify(state.hall) === initial, ...state });
      }
      cancelAnimationFrame(__hallRaf); return states;
    });
    return { device, phase, viewport, ...capture, requests, errors, consoleErrors, views, transitions };
  } finally { await context.close(); }
}
