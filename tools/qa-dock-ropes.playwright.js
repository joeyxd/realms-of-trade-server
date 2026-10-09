// Root-only serial GPU review of the dock rope dressing, including real asset failures and tier changes.
async (page) => {
  const device = 'desktop', phase = 'after';
  const baselineSource = null;
  const mobile = ['mobile', 'low', 'portrait'].includes(device), night = device === 'night';
  const viewport = device === 'portrait' ? { width: 390, height: 844 } : { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 };
  const out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/dock-ropes';
  const context = await page.context().browser().newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], requests = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
  p.on('request', r => { if (/raft\/comic-materials-v1/.test(r.url())) requests.push(r.url()); });
  try {
    if (phase === 'before') {
      let source = baselineSource;
      if (source === null) {
        const response = await context.request.get('http://127.0.0.1:5190/files/docs/art/source/dock-ropes-v1/before/props.source.js');
        if (!response.ok()) throw Error('Missing immutable props baseline');
        source = await response.text();
      }
      await p.route('**/src/render/props.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
    }
    if (device === 'missing-rope') await p.route('**/assets/textures/raft/comic-materials-v1.webp', route => route.fulfill({ status: 404, body: '' }));
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
      const coverVertices = [0, 0, 0];
      const ropeMesh = all.find(o => o.name === 'dockRopes');
      for (const o of all) {
        const chunk = o.name === 'propsChunk', attrs = {}, mask = o.geometry.attributes.aTownCover;
        if (chunk) {
          chunks.push(o);
          if (mask) for (let i = 0; i < mask.count; i++) coverVertices[Math.round(mask.getZ(i))]++;
        }
        for (const [name, a] of Object.entries(o.geometry.attributes)) attrs[name] = { itemSize: a.itemSize, normalized: a.normalized, ...await hashArray(a.array) };
        meshes.push({ chunk, rope: o.name === 'dockRopes', deck: o.name === 'dockDeck', animated: o === m.world.props.ship.userData.flag || m.world.props.flags.includes(o),
          name: o.name, attributes: attrs, index: o.geometry.index ? await hashArray(o.geometry.index.array) : null,
          matrix: o.matrix.toArray(), triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3,
          key: Array.isArray(o.material) ? o.material.map(mat => mat.customProgramCacheKey()) : o.material.customProgramCacheKey(),
          castShadow: o.castShadow, receiveShadow: o.receiveShadow, normalPass: !!o.userData.nm });
      }
      window.__townChunks = chunks;
      window.__townCamera = name => {
        const d = m.map.dock, post = m.map.props.find(p => p.kind === 'dockPost');
        const yaw = Math.atan2(d.dir.x,d.dir.z), c=Math.cos(yaw), s=Math.sin(yaw);
        const center = ropeMesh?.userData.dockRopes.coilCenters[0] || {x:-(d.halfWidth-.46),z:Math.min(4,d.len*.28)};
        const target = name==='overview' ? new T.Vector3(d.base.x+d.dir.x*d.len*.48,d.deckY,d.base.z+d.dir.z*d.len*.48)
          : name==='wrap' ? new T.Vector3(post.x,post.y+.3*post.scale,post.z)
          : new T.Vector3(d.base.x+c*center.x+s*center.z,d.deckY+.1,d.base.z-s*center.x+c*center.z);
        const rig=m.world.rig;
        rig.yaw=rig.yawTarget=Math.PI/4; rig.pitch=rig.pitchTarget=name==='overview'?.85:name==='coil'?.72:.48;
        rig.dist=rig.distTarget=name==='overview'?44:name==='wrap'?5.5:6.5;
        rig.trauma=rig.punch=0; rig.snapTo(target); rig.update(0,target,null,1); window.__townTarget=target.toArray();
      };
      window.__townRender = () => { m.world.render(); window.__townRaf = requestAnimationFrame(__townRender); };
      __townRaf = requestAnimationFrame(__townRender);
      window.__townState = () => {
        const r = m.world.renderer, gl = r.getContext();
        const cloth = m.assets.texture('tex:raft-comic-v1');
        const info = tex => tex ? { src: m.assets.list().find(e => e.id === 'tex:raft-comic-v1')?.selectedSrc,
          width: tex.image.width, height: tex.image.height, colorSpace: tex.colorSpace,
          shared: ropeMesh?.material.map === tex,
          textureRef: tex.uuid } : null;
        return { quality: m.quality.current, coarse: matchMedia('(pointer: coarse)').matches,
          dockRopes: { atlas: info(cloth), mesh: ropeMesh ? {...ropeMesh.userData.dockRopes, geometry:ropeMesh.geometry.uuid, material:ropeMesh.material.uuid,
            attributeBytes:Object.values(ropeMesh.geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0),indexBytes:ropeMesh.geometry.index?.array.byteLength || 0} : null },
          assetErrors: m.assets.errors, gameErrors: m.errors, glError: gl.getError(),
          programsLinked: r.info.programs.every(pr => gl.getProgramParameter(pr.program, gl.LINK_STATUS)),
          camera: { position: m.world.camera.position.toArray(), target: [...__townTarget], fov: m.world.camera.fov } };
      };
      const mapBytes = new TextEncoder().encode(JSON.stringify(m.map.props));
      return { dock: m.map.dock, mapProps: { count: m.map.props.length, ...await hashArray(mapBytes) }, meshes, ropes: ropeMesh?.userData.dockRopes || null };
    });
    const views = [];
    for (const name of ['overview', 'wrap', 'coil']) {
      await p.evaluate(name => { document.getElementById('ui').style.visibility = name === 'overview' ? 'visible' : 'hidden'; __townCamera(name); }, name);
      await p.waitForTimeout(180); await p.screenshot({ path: `${out}/${device}-${name}-${phase}-v1.png` });
      views.push({ name, state: await p.evaluate(() => __townState()) });
    }
    const transitions = await p.evaluate(() => {
      const initial = __townState().dockRopes, states = [];
      for (const tier of ['high', 'low', 'medium', 'high']) {
        __mn.quality.set(tier); __mn.world.render(); const state = __townState();
        states.push({ tier, reused: state.dockRopes.mesh?.material === initial.mesh?.material
          && state.dockRopes.mesh?.geometry === initial.mesh?.geometry
          && state.dockRopes.atlas?.textureRef === initial.atlas?.textureRef, ...state });
      }
      cancelAnimationFrame(__townRaf); return states;
    });
    return { device, phase, viewport, ...capture, requests, errors, consoleErrors, views, transitions };
  } finally { await context.close(); }
}
