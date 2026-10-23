// Root-only serial GPU comparison for the map terrain revamp.
async page => {
  const device = 'desktop', phase = 'after', baselineSources = null;
  const mobile = ['mobile', 'low', 'portrait'].includes(device);
  const viewport = device === 'portrait' ? { width: 390, height: 844 } : { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 };
  const out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/map-revamp';
  const context = await page.context().browser().newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
  try {
    if (phase === 'before') {
      const routes = [
        ['worldgen.js', 'src/sim/worldgen.js'],
        ['terrain.js', 'src/render/terrain.js'],
        ['resources.js', 'src/data/resources.js'],
        ['mapview.js', 'src/ui/mapview.js'],
      ];
      for (const [name, path] of routes) {
        let source = baselineSources?.[name];
        if (!source) {
          const response = await context.request.get('http://127.0.0.1:5190/files/docs/art/source/map-revamp-v1/before/' + name);
          if (!response.ok()) throw Error('Missing immutable map revamp baseline ' + name);
          source = await response.text();
        }
        await p.route('**/' + path, route => route.fulfill({ contentType: 'text/javascript', body: source }));
      }
    }
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=day&q=' + (device === 'low' ? 'low' : mobile ? 'medium' : 'high') + (device === 'noassets' ? '&noassets' : ''));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 60000 });
    await p.locator('#btn-play').click({ force: true });
    await p.waitForFunction(() => __mn.client.resources?.bench && __mn.world.resources?.bench);
    const capture = await p.evaluate(async () => {
      const m = __mn, T = await import('three'), { U } = await import('./src/render/toon.js');
      m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise(r => setTimeout(r, 140)); m.world.rig.blend = null; m.world.nearFade(false); U.mnTime.value = 4.2;
      m.world.render();
      const hashArray = async a => {
        const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
        return { bytes: a.byteLength, sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') };
      };
      const map = m.map, terrain = m.world.terrain;
      const heightTexture = m.world.water?.userData?.materials?.simple?.uniforms?.uHeight?.value
        || m.world.water?.material?.uniforms?.uHeight?.value || null;
      const props = (map.props || []).map((o, index) => ({ index, kind: o.kind, x: o.x, z: o.z, y: o.y, rot: o.rot, scale: o.scale, metadata: o.metadata || o.extra || null }));
      const mesh = terrain;
      const meshBytes = Object.values(mesh.geometry.attributes).reduce((n, a) => n + a.array.byteLength, 0) + (mesh.geometry.index?.array.byteLength || 0);
      const geometryId = mesh.geometry.uuid, heightTextureId = heightTexture?.uuid || null;
      window.__mapCamera = name => {
        const L = m.map.landmarks;
        const targets = {
          town: { point: L.village, offset: 3, dist: 65, pitch: 0.65, yaw: Math.PI / 4 },
          island: { point: m.map.toWorld(30, -20), offset: 0, dist: 820, pitch: 0.95, yaw: Math.PI / 4 },
          volcano: { point: L.volcano, offset: 5, dist: 180, pitch: 0.65, yaw: Math.PI / 4 },
          boss: { point: L.arena, offset: 3, dist: 80, pitch: 0.65, yaw: Math.PI / 4 },
          pvp: { point: m.map.cala, offset: 3, dist: 100, pitch: 0.65, yaw: Math.PI / 4 },
        };
        const c = targets[name], target = new T.Vector3(c.point.x, m.map.groundAt(c.point.x, c.point.z) + c.offset, c.point.z), rig = m.world.rig;
        rig.yaw = rig.yawTarget = c.yaw; rig.pitch = rig.pitchTarget = c.pitch; rig.dist = rig.distTarget = c.dist;
        rig.trauma = rig.punch = 0; rig.snapTo(target); rig.update(0, target, null, 1);
        // The full-map inspection camera is beyond the playable fog range; expose terrain for this view only.
        m.world.scene.fog.near = name === 'island' ? 1500 : 220;
        m.world.scene.fog.far = name === 'island' ? 2000 : 950;
        window.__mapTarget = target.toArray(); m.world.lights.update(0, target, null);
      };
      window.__mapRender = () => { m.world.render(); window.__mapRaf = requestAnimationFrame(__mapRender); };
      window.__mapRaf = requestAnimationFrame(__mapRender);
      window.__mapState = () => {
        const r = m.world.renderer, gl = r.getContext();
        return { quality: m.quality.current, mapSize: map.size, gridResolution: map.res, gridN: map.N,
          heightGridBytes: map.heights?.byteLength ?? null,
          terrain: { geometry: mesh.geometry.uuid, segments: Math.round(Math.sqrt(mesh.geometry.attributes.position.count) - 1),
            vertices: mesh.geometry.attributes.position.count, triangles: mesh.geometry.index?.count / 3,
            attributeBytes: Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([k, a]) => [k, a.array.byteLength])),
            indexBytes: mesh.geometry.index?.array.byteLength || 0, totalBytes: meshBytes },
          heightTexture: heightTexture ? { uuid: heightTexture.uuid, width: heightTexture.image.width, height: heightTexture.image.height,
            bytes: heightTexture.image.data?.byteLength ?? null, type: heightTexture.type } : null,
          assetErrors: m.assets.errors, gameErrors: m.errors, glError: gl.getError(),
          programLinked: r.info.programs.every(pr => gl.getProgramParameter(pr.program, gl.LINK_STATUS)),
          camera: { position: m.world.camera.position.toArray(), target: [...__mapTarget], fov: m.world.camera.fov } };
      };
      __mapCamera('town');
      const contract = { landmarks: map.landmarks, cala: map.cala, dock: map.dock, npcs: map.npcs, colliders: map.colliders };
      const nodes = m.client.resources.nodes || [];
      const placement = async points => ({ count: points?.length || 0,
        contract: await hashArray(new TextEncoder().encode(JSON.stringify((points || []).map(({ y, nx, ny, nz, ...p }) => p)))) });
      return { map: { size: map.size, half: map.half, gridResolution: map.res, gridN: map.N, gridBytes: map.heights?.byteLength ?? null,
          landmarks: map.landmarks, cala: map.cala, props, propsXZ: props.map(({ index, kind, x, z, metadata }) => ({ index, kind, x, z, metadata })),
          propsContract: await hashArray(new TextEncoder().encode(JSON.stringify(props))),
          gameplayContract: await hashArray(new TextEncoder().encode(JSON.stringify(contract))) },
        resourceNodes: { count: nodes.length, bench: m.client.resources.bench, nodes,
          contract: await hashArray(new TextEncoder().encode(JSON.stringify(nodes))) },
        dressing: { metadata: m.world.vegetation.userData, grass: await placement(m.world.grass.points),
          debris: await placement(m.world.beachDebris.points), seaweed: await placement(m.world.seaweed.points) },
        terrainGeometry: { geometry: geometryId, triangles: mesh.geometry.index.count / 3, bytes: meshBytes },
        heightTextureId, initialState: window.__mapState() };
    });
    await p.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; });
    const views = [];
    for (const name of ['town', 'island', 'volcano', 'boss', 'pvp']) {
      await p.evaluate(name => __mapCamera(name), name);
      await p.waitForTimeout(180); await p.screenshot({ path: `${out}/${device}-${name}-${phase}-v1.png` });
      views.push({ name, state: await p.evaluate(() => __mapState()) });
    }
    const transitions = await p.evaluate(() => {
      const baseline = __mapState(), states = [];
      for (const tier of ['high', 'low', 'medium', 'high']) {
        __mn.quality.set(tier); __mn.world.render(); const state = __mapState();
        states.push({ tier, terrainGeometryReused: state.terrain.geometry === baseline.terrain.geometry,
          heightTextureReused: state.heightTexture?.uuid === baseline.heightTexture?.uuid, state });
      }
      cancelAnimationFrame(__mapRaf); return states;
    });
    return { device, phase, viewport, ...capture, views, transitions, errors, consoleErrors };
  } finally { await context.close(); }
}
