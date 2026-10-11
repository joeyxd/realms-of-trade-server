// Root-only serial GPU comparison of existing lanterns/signboards, texture/model failures and quality changes.
async (page) => {
  const device = 'desktop', phase = 'after';
  const baselineSource = null;
  const mobile = ['mobile', 'low', 'portrait'].includes(device), night = device === 'night';
  const viewport = device === 'portrait' ? { width: 390, height: 844 } : { width: mobile ? 844 : 1280, height: mobile ? 390 : 720 };
  const out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/town-fixtures';
  const context = await page.context().browser().newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await context.newPage(), errors = [], consoleErrors = [], requests = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), location: m.location() }); });
  p.on('request', r => { if (/town-wood-v1|prop-storage-crate/.test(r.url())) requests.push(r.url()); });
  try {
    if (phase === 'before') {
      let source = baselineSource;
      if (source === null) {
        const response = await context.request.get('http://127.0.0.1:5190/files/docs/art/source/town-fixtures-v1/before/props.source.js');
        if (!response.ok()) throw Error('Missing immutable props baseline');
        source = await response.text();
      }
      await p.route('**/src/render/props.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
    }
    if (device === 'missing-albedo') await p.route('**/assets/textures/town-wood-v1/atlas-albedo-desktop.webp', route => route.fulfill({ status: 404, body: '' }));
    if (device === 'missing-normal') await p.route('**/assets/textures/town-wood-v1/atlas-normal-desktop.webp', route => route.fulfill({ status: 404, body: '' }));
    await p.goto('http://127.0.0.1:5192/?solo&debug&tod=' + (night ? 'night' : 'day') + '&q=' + (device === 'low' ? 'low' : mobile ? 'medium' : 'high') + (device === 'disabled' ? '&noassets' : ''));
    await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 60000 });
    await p.locator('#btn-play').click({ force: true });
    await p.waitForFunction(() => __mn.world?.footprints?.active);
    await p.evaluate(() => { const v = __mn.map.landmarks.village; __mn.teleport(v.x, v.z); });
    await p.waitForTimeout(700);
    const capture = await p.evaluate(async () => {
      const m = __mn, T = await import('three'), { U } = await import('./src/render/toon.js');
      m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
      await new Promise(r => setTimeout(r, 140)); m.world.rig.blend = null; m.world.nearFade(false); U.mnTime.value = 4.2;
      const hashArray = async a => {
        const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
        return { bytes: a.byteLength, sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') };
      };
      const all = []; m.world.props.group.traverse(o => { if (o.isMesh) all.push(o); });
      const painted = all.filter(o => o.name === 'townSign'), chunks = all.filter(o => o.name === 'propsChunk');
      const meshes = [];
      for (const o of all) {
        const attrs = {};
        for (const [name, a] of Object.entries(o.geometry.attributes)) attrs[name] = { itemSize: a.itemSize, normalized: a.normalized, ...await hashArray(a.array) };
        meshes.push({ chunk: o.name === 'propsChunk', sign: o.name === 'townSign',
          animated: o === m.world.props.ship.userData.flag || m.world.props.flags.includes(o), name: o.name,
          attributes: attrs, index: o.geometry.index ? await hashArray(o.geometry.index.array) : null,
          instanceMatrix: o.instanceMatrix ? await hashArray(o.instanceMatrix.array) : null, count: o.count ?? null,
          matrix: o.matrix.toArray(), triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3,
          key: Array.isArray(o.material) ? o.material.map(mat => mat.customProgramCacheKey()) : o.material.customProgramCacheKey(),
          castShadow: o.castShadow, receiveShadow: o.receiveShadow, normalPass: !!o.userData.nm });
      }
      window.__fixtureCamera = name => {
        const v = m.map.landmarks.village, prop = m.map.props.find(p => p.kind === (name === 'cala-sign' ? 'sign' : name) && (name === 'cala-sign' ? !!p.h : !p.h));
        const target = name === 'overview' ? new T.Vector3(v.x,v.y || m.map.groundAt(v.x,v.z),v.z)
          : new T.Vector3(prop.x,prop.y + 1.45*prop.scale,prop.z);
        const rig=m.world.rig;
        rig.yaw=rig.yawTarget=name.includes('sign')?prop.rot + .6:Math.PI/4; rig.pitch=rig.pitchTarget=name==='overview'?.85:name.includes('sign')?.22:.52;
        rig.dist=rig.distTarget=name==='overview'?39:4.6;
        rig.trauma=rig.punch=0; rig.snapTo(target); rig.update(0,target,null,1); window.__fixtureTarget=target.toArray();
        m.world.lights.update(0, target, null);
      };
      window.__fixtureRender = () => { m.world.render(); window.__fixtureRaf = requestAnimationFrame(__fixtureRender); };
      __fixtureRaf = requestAnimationFrame(__fixtureRender);
      window.__fixtureState = () => {
        const r=m.world.renderer, gl=r.getContext();
        const info = (id,slot) => {
          const tex=m.assets.texture(id);
          return tex ? {src:m.assets.list().find(e=>e.id===id)?.selectedSrc,width:tex.image.width,height:tex.image.height,
            colorSpace:tex.colorSpace,textureRef:tex.uuid,shared:painted.every(o=>o.material[slot]===tex)&&chunks.every(o=>o.material[slot]===tex)} : null;
        };
        return {quality:m.quality.current,coarse:matchMedia('(pointer: coarse)').matches,
          portFixture:{applied:!!m.assets.texture('tex:town-wood-albedo-v1'),albedo:info('tex:town-wood-albedo-v1','map'),normal:info('tex:town-wood-normal-v1','normalMap'),
            painted:painted.map(o=>({...o.userData.townFixtures,geometry:o.geometry.uuid,material:o.material.uuid,ink:o.material.userData.townFixtures?.ink?{width:o.material.userData.townFixtures.ink.image.width,height:o.material.userData.townFixtures.ink.image.height,colorSpace:o.material.userData.townFixtures.ink.colorSpace,uuid:o.material.userData.townFixtures.ink.uuid}:null,
              attributeBytes:Object.values(o.geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0),indexBytes:o.geometry.index?.array.byteLength||0}))},
          assetErrors:m.assets.errors,gameErrors:m.errors,glError:gl.getError(),
          glass:{color:m.world.props.glassMat.color.getHex(),glow:m.world.props.glassMat.userData.glow.value},
          programsLinked:r.info.programs.every(pr=>gl.getProgramParameter(pr.program,gl.LINK_STATUS)),
          camera:{position:m.world.camera.position.toArray(),target:[...__fixtureTarget],fov:m.world.camera.fov}};
      };
      const props = new TextEncoder().encode(JSON.stringify(m.map.props));
      return {dock:m.map.dock,mapProps:{count:m.map.props.length,...await hashArray(props)},
        lightSources:m.world.lights.sources.filter(s=>s.kind==='lantern').map(s=>({x:s.x,y:s.y,z:s.z,r:s.r,i:s.i,seed:s.seed})),
        fixtureCounts:Object.fromEntries(['lantern','sign'].map(kind=>[kind,m.map.props.filter(p=>p.kind===kind).length])),meshes};
    });
    const views=[];
    for(const name of ['overview','lantern','sign','cala-sign']) {
      await p.evaluate(name=>{document.getElementById('ui').style.visibility=name==='overview'?'visible':'hidden';__fixtureCamera(name);},name);
      await p.waitForTimeout(180);await p.screenshot({path:`${out}/${device}-${name}-${phase}-v1.png`});
      views.push({name,state:await p.evaluate(()=>__fixtureState())});
    }
    const transitions=await p.evaluate(()=>{
      const initial=JSON.stringify(__fixtureState().portFixture),states=[];
      for(const tier of ['high','low','medium','high']) {
        __mn.quality.set(tier);__mn.world.render();const state=__fixtureState();
        states.push({tier,reused:JSON.stringify(state.portFixture)===initial,...state});
      }
      cancelAnimationFrame(__fixtureRaf);return states;
    });
    return {device,phase,viewport,...capture,requests,errors,consoleErrors,views,transitions};
  }finally{await context.close();}
}
