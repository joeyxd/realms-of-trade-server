// Compare the existing crate renderer with prop:storage-crate in the same frozen village scene.
// env: OUT, Q, TOD, PHONE, VW, VH, DPR, ROOT, MN_PLAYWRIGHT, MN_BROWSER, MN_LIBS, MN_THREE, MN_GSAP,
//      ASSET_FAILURE=missing|bad|disabled. SwiftShader captures are visual evidence, not GPU timing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let chromium;
try {
  ({ chromium } = await import(process.env.MN_PLAYWRIGHT ? pathToFileURL(process.env.MN_PLAYWRIGHT).href : 'playwright'));
} catch {
  ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.ROOT || path.join(scriptDir, '..'));
const quality = process.env.Q || 'high';
const tod = process.env.TOD || 'day';
const failure = process.env.ASSET_FAILURE || '';
const candidateId = 'prop:storage-crate';
const manifestPath = path.join(root, 'assets', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const candidateEntry = (manifest.assets || []).find((a) => a.id === candidateId);
const candidateSrc = candidateEntry && `/assets/${candidateEntry.src.replaceAll('\\', '/')}`;
const out = path.resolve(process.env.OUT || path.join(root, 'shots', 'crate-canary', `${quality}-${tod}-${process.env.PHONE ? 'phone' : 'desktop'}-${failure || 'success'}`));
const width = +(process.env.VW || (process.env.PHONE ? 844 : 1280));
const height = +(process.env.VH || (process.env.PHONE ? 390 : 720));
const phone = !!process.env.PHONE;
if (!['', 'missing', 'bad', 'disabled'].includes(failure)) throw new Error(`Unknown ASSET_FAILURE=${failure}`);
if (failure !== 'disabled' && !candidateEntry) throw new Error(`Manifest has no ${candidateId}; import the candidate before running this case`);
fs.mkdirSync(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2' };
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname); }
  catch { res.writeHead(400).end(); return; }
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

let browser, context, closeServer;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  closeServer = () => new Promise((resolve) => server.close(() => resolve()));
  browser = await chromium.launch({
    ...(process.env.MN_BROWSER ? { executablePath: process.env.MN_BROWSER } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: +(process.env.DPR || 1),
    ...(phone ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  const pageErrors = [], consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  const libs = process.env.MN_LIBS;
  const local = { 'three@0.160.0': 'three-0.160.0/package', 'gsap@3.12.5': 'gsap-3.12.5/package' };
  if (libs || process.env.MN_THREE) await page.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const packageDir = match[1] === 'three@0.160.0' ? process.env.MN_THREE : process.env.MN_GSAP;
    if (!packageDir && !libs) return route.continue();
    const file = packageDir ? path.join(packageDir, match[2]) : path.join(libs, local[match[1]], match[2]);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
  let interceptedCandidate = false;
  if (failure === 'missing' || failure === 'bad') await page.route(`**${candidateSrc}`, async (route) => {
    interceptedCandidate = true;
    if (failure === 'missing') return route.fulfill({ status: 404, contentType: 'model/gltf-binary', body: '' });
    return route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: Buffer.from('not-a-glb') });
  });

  const query = new URLSearchParams({ q: quality, debug: '', maxdt: '0.5', tod });
  if (failure === 'disabled') query.set('noassets', '');
  await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`);
  await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 180000 });
  await page.click('#btn-play', { force: true });
  await page.waitForFunction(() => window.__mn?.st.mode === 'playing', null, { timeout: 90000 });
  await page.waitForFunction(() => !window.__mn.world.rig.blend, null, { timeout: 90000 });
  await page.waitForTimeout(1000);

  const setup = await page.evaluate(async ({ candidateId }) => {
    const m = window.__mn;
    const THREE = await import('three');
    const { createProps } = await import('./src/render/props.js');
    const originalPropsArray = m.map.props;
    const originalPropsCount = originalPropsArray.length;
    const village = m.map.landmarks.village;
    const villageCrates = originalPropsArray.filter((p) => p.kind === 'crate')
      .sort((a, b) => (a.x - village.x) ** 2 + (a.z - village.z) ** 2 - ((b.x - village.x) ** 2 + (b.z - village.z) ** 2));
    const authored = villageCrates.length === 0;
    const qaCrate = authored ? {
      kind: 'crate', x: village.x + 3.5, y: m.map.groundAt(village.x + 3.5, village.z + 2.5), z: village.z + 2.5, rot: 0, scale: 1,
    } : villageCrates[0];
    // Keep the actual generated map untouched; add a labeled QA-only placement only when it has no crate.
    const qaMap = authored ? { ...m.map, props: [...originalPropsArray, qaCrate] } : m.map;
    const crates = qaMap.props.filter((p) => p.kind === 'crate');
    const targetIndex = crates.indexOf(qaCrate);
    const focus = new THREE.Vector3(qaCrate.x, qaCrate.y + 0.55, qaCrate.z);
    const rig = m.world.rig;
    rig.snapTo(focus); rig.dist = 7; rig.distTarget = 7; rig.update(0, focus, null, m.loop.timeScale);
    m.world.nearFade(false);
    m.transport.send({ t: 'cmd', type: 'pause', on: true });
    m.loop.running = false;
    await new Promise((resolve) => setTimeout(resolve, 250));

    const oldProps = m.world.props;
    const propBinding = m.assets.man.byProp.get('crate');
    const copyMatState = (src, dst) => {
      if (!src || !dst) return;
      if (src.color && dst.color) dst.color.copy(src.color);
      if (src.userData?.glow && dst.userData?.glow) dst.userData.glow.value = src.userData.glow.value;
      const oldMesh = src.userData?.mesh, newMesh = dst.userData?.mesh;
      if (oldMesh && newMesh) newMesh.visible = oldMesh.visible;
    };
    const boxOf = (object) => {
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object);
      return { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() };
    };
    const measureFit = () => {
      const saved = m.assets.man.byProp.get('crate');
      m.assets.man.byProp.delete('crate');
      const targetProps = createProps({ ...qaMap, props: [qaCrate], npcs: [] });
      const targetMesh = targetProps.group.children.find((o) => o.name === 'propsChunk');
      const proceduralBounds = targetMesh ? boxOf(targetMesh) : null;
      if (saved) m.assets.man.byProp.set('crate', saved);
      const loaded = m.assets.data(candidateId), entry = m.assets.entry(candidateId);
      let importedBounds = null;
      if (loaded?.parts?.length && entry) {
        m.assets.man.byProp.set('crate', candidateId);
        const importedProps = createProps({ ...qaMap, props: [qaCrate], npcs: [] });
        const importedObject = importedProps.group.getObjectByName(candidateId);
        if (importedObject) importedBounds = boxOf(importedObject);
        if (saved) m.assets.man.byProp.set('crate', saved); else m.assets.man.byProp.delete('crate');
      }
      return {
        fit: entry?.fit || 'proc', sourceBounds: loaded ? { min: loaded.min, max: loaded.max } : null,
        proceduralTargetBounds: proceduralBounds, importedFittedBounds: importedBounds,
      };
    };
    const fit = measureFit();
    // Restore the original mapping until each capture explicitly selects its variant.
    if (propBinding) m.assets.man.byProp.set('crate', propBinding); else m.assets.man.byProp.delete('crate');
    const asset = (() => {
      const s = m.assets.state.get(candidateId), d = m.assets.data(candidateId);
      return {
        state: s?.state || (m.assets.loaded ? 'absent' : 'disabled'), error: s?.error || '', errors: m.assets.errors.filter((e) => e.includes(candidateId)),
        model: d ? { tris: d.tris, parts: d.parts?.length || 0 } : null,
      };
    })();
    let currentProps = oldProps;
    const replaceProps = (useCandidate) => {
      if (useCandidate && asset.state === 'ok') m.assets.man.byProp.set('crate', candidateId);
      else m.assets.man.byProp.delete('crate');
      const next = createProps(qaMap);
      copyMatState(currentProps.windowMat, next.windowMat);
      copyMatState(currentProps.glassMat, next.glassMat);
      m.world.scene.remove(currentProps.group);
      m.world.scene.add(next.group);
      m.world.props = next;
      currentProps = next;
      m.world.pipeline.markDirty();
      m.world.renderer.shadowMap.needsUpdate = true;
      return next;
    };
    const isOriginalMapProps = () => m.map.props === originalPropsArray && m.map.props.length === originalPropsCount;
    window.__crateCanary = { THREE, asset, fit, crates: crates.length, targetIndex, focus: focus.toArray(), qaCrate, authored, replaceProps, isOriginalMapProps };
    return { asset, fit, crates: crates.length, targetIndex, focus: focus.toArray(), qaCrate, authored, originalPropsCount };
  }, { candidateId });

  if (!setup.crates || setup.targetIndex < 0) throw new Error('QA crate placement was not included in createProps');
  if ((failure === 'missing' || failure === 'bad') && (!interceptedCandidate || setup.asset.state !== 'error')) throw new Error(`Expected ${failure} candidate load error: ${JSON.stringify({ interceptedCandidate, asset: setup.asset })}`);
  if (failure === 'disabled' && setup.asset.state !== 'disabled' && setup.asset.state !== 'absent') throw new Error(`Expected disabled/missing assets: ${JSON.stringify(setup.asset)}`);
  if (!failure && setup.asset.state !== 'ok') throw new Error(`Expected loaded candidate: ${JSON.stringify(setup.asset)}`);

  // The tutorial prompt otherwise covers the selected crate at this QA camera target.
  await page.addStyleTag({ content: '.prompt { visibility: hidden !important; }' });

  const captures = [];
  const capture = async (name, useCandidate) => {
    const details = await page.evaluate(({ name, useCandidate, candidateId, expectedFocus }) => {
      const m = window.__mn, setup = window.__crateCanary;
      const props = setup.replaceProps(useCandidate);
      const assetObject = props.group.getObjectByName(candidateId);
      const procChunks = props.group.children.filter((o) => o.name === 'propsChunk');
      const expectedImported = useCandidate && setup.asset.state === 'ok';
      if (expectedImported !== !!assetObject) throw new Error(`${name}: imported prop selection=${!!assetObject}, expected=${expectedImported}`);
      const importedParts = assetObject ? assetObject.children.map((child) => ({
        name: child.name || child.material?.name || '', instanced: !!child.isInstancedMesh, count: child.count ?? null,
      })) : [];
      if (expectedImported && (!importedParts.length || importedParts.some((part) => !part.instanced || part.count !== setup.crates))) {
        throw new Error(`${name}: imported instance counts do not match ${setup.crates} crate placements: ${JSON.stringify(importedParts)}`);
      }
      const camera = m.world.camera;
      const cam = { p: camera.position.toArray(), q: camera.quaternion.toArray(), target: m.world.rig.target.toArray(), dist: m.world.rig.dist };
      const target = new setup.THREE.Vector3(...expectedFocus);
      if (new setup.THREE.Vector3(...cam.target).distanceTo(target) > 0.01) throw new Error(`${name}: camera target changed`);
      m.world.render();
      const info = m.world.renderer.info;
      const bounds = expectedImported ? setup.fit.importedFittedBounds : setup.fit.proceduralTargetBounds;
      const debug = m.world.renderer.getContext(), ext = debug.getExtension('WEBGL_debug_renderer_info');
      return {
        variant: expectedImported ? 'imported' : 'procedural-fallback', assetMapped: !!m.assets.propId('crate'),
        crateInstances: setup.crates, renderedPropChildren: expectedImported ? assetObject.children.length : procChunks.length, importedParts,
        selectedCrateBounds: bounds, drawcalls: info.render.calls, triangles: info.render.triangles, points: info.render.points,
        geometries: info.memory.geometries, textures: info.memory.textures,
        camera: cam, worldTime: m.world.time, renderer: ext ? debug.getParameter(ext.UNMASKED_RENDERER_WEBGL) : debug.getParameter(debug.RENDERER),
        originalMapPropsUnchanged: setup.isOriginalMapProps(),
      };
    }, { name, useCandidate, candidateId, expectedFocus: setup.focus });
    const png = await page.screenshot({ path: path.join(out, `${name}.png`) });
    captures.push({ ...details, png: `${name}.png`, pngBytes: png.length, pngSize: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } });
  };

  await capture('01-procedural', false);
  await capture('02-storage-crate', true);
  const pair = captures;
  if (!pair[0].originalMapPropsUnchanged || !pair[1].originalMapPropsUnchanged) throw new Error('Original generated map props changed');
  if (JSON.stringify(pair[0].camera) !== JSON.stringify(pair[1].camera) || pair[0].worldTime !== pair[1].worldTime) throw new Error('A/B camera or world time drifted');
  const pageGameErrors = await page.evaluate(() => [...window.__mn.errors]);
  if (pageErrors.length || pageGameErrors.length) throw new Error(`Runtime errors: page=${JSON.stringify(pageErrors)} game=${JSON.stringify(pageGameErrors)}`);
  const evidence = {
    case: failure || 'success', candidateId, candidateSrc, asset: setup.asset,
    scene: { authoredQaPlacement: setup.authored, originalMapPropsUnchanged: pair.every((capture) => capture.originalMapPropsUnchanged), originalMapPropsCount: setup.originalPropsCount, crateCount: setup.crates, selectedCrate: setup.qaCrate, fit: setup.fit, fitBasis: 'World-space visual bounding boxes compared with the procedural render target; this is not an independent gameplay collider test.', fullWorldContext: 'Full scene retained; createProps rebuilt with only crate registry mapping toggled. QA reconstruction allocates procedural geometries/materials; renderer memory counts are descriptive and not isolated asset deltas.' },
    qaHiddenUi: 'Tutorial prompts (.prompt) hidden only for the visual comparison.',
    quality, tod, viewport: { width, height, dpr: +(process.env.DPR || 1), phone },
    browser: { userAgent: await page.evaluate(() => navigator.userAgent), renderer: captures[0].renderer, swiftshader: /swiftshader/i.test(captures[0].renderer) },
    captures, pageErrors, gameErrors: pageGameErrors, consoleErrors,
  };
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (closeServer) await closeServer().catch(() => {});
  else if (server.listening) await new Promise((resolve) => server.close(resolve));
}
