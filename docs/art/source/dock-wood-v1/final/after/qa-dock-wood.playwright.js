// Root-only serial GPU review of the real dock; no presentation geometry or server writes.
async (page) => {
  const device = 'desktop', phase = 'after';
  const baselineSource = null;
  const mobile = ['mobile', 'low', 'portrait'].includes(device), night = device === 'night';
  const viewport = device === 'portrait' ? { width: 390, height: 844 } : { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 };
  const out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/dock-wood';
  const context = await page.context().browser().newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], requests = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
  p.on('request', r => { if (/comic-materials-v1/.test(r.url())) requests.push(r.url()); });
  try {
    if (phase === 'before') {
      let source = baselineSource;
      if (source === null) {
        const response = await context.request.get('http://127.0.0.1:5190/files/docs/art/source/dock-wood-v1/before/props.source.js');
        if (!response.ok()) throw Error('Missing immutable props baseline');
        source = await response.text();
      }
      await p.route('**/src/render/props.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
    }
    if (device === 'missing') await p.route('**/comic-materials-v1.webp', route => route.fulfill({ status: 404, body: '' }));
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=' + (night ? 'night' : 'day') + '&q=' + (device === 'low' ? 'low' : mobile ? 'medium' : 'high') + (device === 'disabled' ? '&noassets' : ''));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled);
    await p.locator('#btn-play').click({ force: true });
    await p.waitForFunction(() => __mn.world?.footprints?.active);
    await p.evaluate(() => { const d = __mn.map.dock; __mn.teleport(d.base.x, d.base.z); });
    await p.waitForTimeout(700);
    const capture = await p.evaluate(async () => {
      const m = __mn, T = await import('three'), { U } = await import('./src/render/toon.js');
      m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise(r => setTimeout(r, 140)); m.world.rig.blend = null; m.world.nearFade(false); U.mnTime.value = 4.2;
      const d = m.map.dock;
      const deck = m.world.props.group.children.find(o => o.isMesh && Math.abs(o.position.x - d.base.x) < .00001 && Math.abs(o.position.z - d.base.z) < .00001 && Math.abs(o.rotation.y - Math.atan2(d.dir.x, d.dir.z)) < .00001);
      if (!deck) throw Error('Real dock deck missing');
      const hashArray = async a => {
        const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
        return { bytes: a.byteLength, sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') };
      };
      const meshes = [];
      for (const o of (() => { const all = []; m.world.props.group.traverse(x => { if (x.isMesh) all.push(x); }); return all; })()) {
        const attrs = {};
        for (const [name, a] of Object.entries(o.geometry.attributes)) attrs[name] = { itemSize: a.itemSize, normalized: a.normalized, ...await hashArray(a.array) };
        meshes.push({ deck: o === deck, animated: o === m.world.props.ship.userData.flag || m.world.props.flags.includes(o),
          name: o.name, attributes: attrs, index: o.geometry.index ? await hashArray(o.geometry.index.array) : null,
          matrix: o.matrix.toArray(), triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3,
          key: Array.isArray(o.material) ? o.material.map(mat => mat.customProgramCacheKey()) : o.material.customProgramCacheKey(),
          castShadow: o.castShadow, receiveShadow: o.receiveShadow, normalPass: !!o.userData.nm });
      }
      window.__dockDeck = deck;
      window.__dockCamera = (along, dist) => {
        const focus = new T.Vector3(d.base.x + d.dir.x * along, d.deckY + .3, d.base.z + d.dir.z * along);
        window.__dockTarget = focus.toArray(); m.world.rig.snapTo(focus); m.world.rig.dist = m.world.rig.distTarget = dist; m.world.rig.update(0, focus, null, 1);
      };
      window.__dockRender = () => { m.world.render(); window.__dockRaf = requestAnimationFrame(__dockRender); };
      __dockRaf = requestAnimationFrame(__dockRender);
      window.__dockState = () => {
        const r = m.world.renderer, gl = r.getContext(), atlas = m.assets.texture('tex:raft-comic-v1');
        return { quality: m.quality.current, coarse: matchMedia('(pointer: coarse)').matches,
          deck: { geometry: deck.geometry.uuid, material: deck.material.uuid, metadata: deck.userData.dockWood || null,
            atlasShared: !!atlas && deck.material.map === atlas, mapped: !!deck.material.map,
            atlas: atlas ? { src: m.assets.list().find(e => e.id === 'tex:raft-comic-v1')?.selectedSrc, width: atlas.image.width, height: atlas.image.height } : null },
          assetErrors: m.assets.errors, gameErrors: m.errors, glError: gl.getError(),
          programsLinked: r.info.programs.every(pr => gl.getProgramParameter(pr.program, gl.LINK_STATUS)),
          camera: { position: m.world.camera.position.toArray(), target: [...__dockTarget], fov: m.world.camera.fov } };
      };
      return { dock: d, mapProps: m.map.props, meshes };
    });
    const views = [];
    for (const [name, along, distance] of [['overview', capture.dock.len * .45, 27], ['detail', capture.dock.len * .55, 11]]) {
      await p.evaluate(({ name, along, distance }) => { document.getElementById('ui').style.visibility = name === 'overview' ? 'visible' : 'hidden'; __dockCamera(along, distance); }, { name, along, distance });
      await p.waitForTimeout(180); await p.screenshot({ path: `${out}/${device}-${name}-${phase}-v1.png` });
      views.push({ name, along, distance, state: await p.evaluate(() => __dockState()) });
    }
    const transitions = await p.evaluate(() => {
      const initial = __dockState().deck, states = [];
      for (const tier of ['high', 'low', 'medium', 'high']) {
        __mn.quality.set(tier); __mn.world.render(); const state = __dockState();
        states.push({ tier, reused: state.deck.geometry === initial.geometry && state.deck.material === initial.material, ...state });
      }
      cancelAnimationFrame(__dockRaf); return states;
    });
    return { device, phase, viewport, ...capture, requests, errors, consoleErrors, views, transitions };
  } finally { await context.close(); }
}
