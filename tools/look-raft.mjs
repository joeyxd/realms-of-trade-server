// Visual and snapshot-continuity QA for the real public starter raft (no synthetic gameplay/state).
// env: OUT, Q, TOD, PHONE, VW, VH, DPR, ROOT, NOASSETS, SKIN=0, ATLAS_FAIL=404|bad, HERO=1,
// MN_PLAYWRIGHT, MN_BROWSER, MN_LIBS, MN_THREE, MN_GSAP.
// SwiftShader images are visual evidence only; this script makes no FPS or hardware-performance claim.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

let chromium;
try {
  ({ chromium } = await import(process.env.MN_PLAYWRIGHT ? pathToFileURL(process.env.MN_PLAYWRIGHT).href : 'playwright'));
} catch {
  ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.ROOT || path.join(scriptDir, '..'));
const releasePath = path.join(root, 'release.json');
const releaseInfo = fs.existsSync(releasePath) ? JSON.parse(fs.readFileSync(releasePath, 'utf8')) : null;
const release = releaseInfo ? { sourceSha: releaseInfo.sourceSha, version: releaseInfo.version, protocolVersion: releaseInfo.protocolVersion } : null;
const quality = process.env.Q || 'high';
const tod = process.env.TOD || 'day';
const phone = !!process.env.PHONE;
const noAssets = !!process.env.NOASSETS;
const skin = process.env.SKIN !== '0';
const heroEnabled = process.env.HERO === '1';
const atlasFail = process.env.ATLAS_FAIL || '';
if (atlasFail && !['404', 'bad'].includes(atlasFail)) throw new Error('ATLAS_FAIL must be 404 or bad');
const width = +(process.env.VW || (phone ? 844 : 1280));
const height = +(process.env.VH || (phone ? 390 : 720));
const out = path.resolve(process.env.OUT || path.join(root, 'shots', 'look-raft', `${quality}-${tod}-${phone ? 'phone' : 'desktop'}${noAssets ? '-noassets' : ''}${!skin ? '-skin-off' : ''}${atlasFail ? `-atlas-${atlasFail}` : ''}${heroEnabled ? '-hero' : ''}`));
const timeouts = { boot: 180000, join: 90000, snapshot: 60000, save: 30000, pause: 12000 };
let observedGitHead = null;
try {
  observedGitHead = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch { /* A source archive can run the visual harness without Git metadata. */ }
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
const pageErrors = [], consoleErrors = [], textureRequests = [];
const expectedTextureSrc = `textures/raft/comic-materials-v1${phone ? '-mobile' : ''}.webp`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/assets\/textures\/raft\/comic-materials-v1.*\.(png|webp)$/.test(pathname)) textureRequests.push(pathname);
  });
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
  if (atlasFail) await page.route('**/assets/textures/raft/comic-materials-v1*.webp', (route) => atlasFail === '404'
    ? route.fulfill({ status: 404, contentType: 'image/webp', body: '' })
    : route.fulfill({ status: 200, contentType: 'image/webp', body: 'intentionally invalid WebP bytes' }));
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());

  const query = new URLSearchParams({ q: quality, debug: '', maxdt: '0.5', tod });
  if (noAssets) query.set('noassets', '');
  if (!skin) query.set('raftskin', '0');
  await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`, { waitUntil: 'domcontentloaded' });

  const joinNormalWorker = async (reload = false) => {
    if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: timeouts.boot });
    await page.click('#btn-play', { force: true });
    await page.waitForFunction(() => window.__mn?.client?.joined && !window.__mn.client.awaitingFirst, null, { timeout: timeouts.join });
    await page.waitForFunction(() => window.__mn?.st.mode === 'playing', null, { timeout: timeouts.join });
    await page.waitForFunction(() => {
      const m = window.__mn;
      return m?.transport?.kind === 'worker' && Array.isArray(m.client.pred.rafts) && m.client.pred.rafts.length === 1
        && m.world.rafts?.views?.size === 1;
    }, null, { timeout: timeouts.snapshot });
    const data = await page.evaluate(() => {
      const m = window.__mn;
      return { transport: m.transport.kind, profile: !!m.client.profile, online: !!m.st.online,
        record: JSON.parse(JSON.stringify(m.client.pred.rafts[0])), viewIds: [...m.world.rafts.views.keys()] };
    });
    if (data.transport !== 'worker' || data.online) throw new Error(`Expected local normal Worker, got ${JSON.stringify({ transport: data.transport, online: data.online })}`);
    if (data.viewIds.length !== 1 || data.viewIds[0] !== String(data.record.id)) throw new Error(`Public record/view mismatch: ${JSON.stringify(data)}`);
    return data;
  };

  const firstJoin = await joinNormalWorker(false);
  const saveKey = await page.evaluate(async () => `${(await import('./src/data/meta.js')).GAME.saveKey}.save.solo`);

  const waitForNormalSave = async (record) => {
    await page.waitForFunction(({ saveKey, id }) => {
      const m = window.__mn, blob = localStorage.getItem(saveKey);
      if (!m?.client?.profile?.eco?.ships || !blob) return false;
      try {
        const saved = JSON.parse(blob);
        return saved?.eco?.ships?.some((s) => s.kind === 'raft' && s.id === id && Array.isArray(s.grid?.parts));
      } catch { return false; }
    }, { saveKey, id: record.id }, { timeout: timeouts.save });
  };
  await waitForNormalSave(firstJoin.record);
  const firstEvidence = await page.evaluate(({ saveKey, id }) => {
    const m = window.__mn, record = m.client.pred.rafts.find((r) => r.id === id);
    const saved = JSON.parse(localStorage.getItem(saveKey));
    const own = m.client.profile?.eco?.ships?.find((s) => s.kind === 'raft' && s.id === id);
    const savedOwn = saved?.eco?.ships?.find((s) => s.kind === 'raft' && s.id === id);
    const hold = (s) => s ? { cap: s.hold?.cap ?? 0,
      goods: Object.fromEntries(Object.entries(s.hold?.goods || {}).sort(([a], [b]) => a.localeCompare(b))) } : null;
    return {
      saveKey, saveBlobBytes: localStorage.getItem(saveKey)?.length || 0,
      publicRecord: record ? JSON.parse(JSON.stringify(record)) : null,
      ownProfile: own ? { id: own.id, parts: own.grid?.parts?.map((p) => [...p]) || [], hold: hold(own) } : null,
      persistedProfile: savedOwn ? { id: savedOwn.id, parts: savedOwn.grid?.parts?.map((p) => [...p]) || [], hold: hold(savedOwn) } : null,
    };
  }, { saveKey, id: firstJoin.record.id });
  if (!firstEvidence.publicRecord || !firstEvidence.ownProfile || !firstEvidence.persistedProfile) throw new Error('The normal Worker save did not contain the visible raft and own profile record');
  if (JSON.stringify(firstEvidence.publicRecord.parts) !== JSON.stringify(firstEvidence.persistedProfile.parts)) throw new Error('Public raft parts differ from the normal persisted own raft');

  // Establish a real paused snapshot boundary before stopping the render loop for stable captures.
  await page.evaluate(() => {
    const m = window.__mn, previous = m.client.onSnapshot.bind(m.client);
    const observer = { tick: -1, at: performance.now(), n: 0 };
    m.client.onSnapshot = (s) => { previous(s); observer.tick = s.tick; observer.at = performance.now(); observer.n++; };
    window.__raftPause = { observer, previous, started: performance.now() };
  });
  await page.waitForFunction(() => window.__raftPause?.observer.n > 0, null, { timeout: timeouts.snapshot });
  await page.evaluate(() => window.__mn.transport.send({ t: 'cmd', type: 'pause', on: true }));
  await page.waitForFunction(() => {
    const p = window.__raftPause;
    return p && performance.now() - p.observer.at > 350;
  }, null, { timeout: timeouts.pause });
  const pauseInfo = await page.evaluate(() => {
    window.__mn.loop.running = false;
    return { snapshotTick: window.__raftPause.observer.tick, stableMs: Math.round(performance.now() - window.__raftPause.observer.at) };
  });

  const cameraAndRender = async (name, distance, heroPhoto = false) => {
    const details = await page.evaluate(async ({ name, distance, heroPhoto }) => {
      const THREE = await import('three');
      const { RAFT } = await import('./src/data/raftparts.js');
      const m = window.__mn, record = m.client.pred.rafts[0], layer = m.world.rafts;
      if (!record || layer.views.size !== 1) throw new Error(`${name}: expected exactly one actual public raft/view`);
      const view = layer.views.get(String(record.id));
      const foundations = record.parts.filter((p) => p[0] === 'foundation');
      if (!foundations.length) throw new Error(`${name}: public record has no foundations`);
      let lx = 0, lz = 0;
      for (const p of foundations) { lx += (p[1] + 0.5) * RAFT.cell; lz += (p[2] + 0.5) * RAFT.cell; }
      lx /= foundations.length; lz /= foundations.length;
      const c = Math.cos(record.yaw), s = Math.sin(record.yaw);
      const focus = new THREE.Vector3(record.x + c * lx + s * lz, record.y + (heroPhoto ? 1.2 : 0.95), record.z - s * lx + c * lz);
      m.world.nearFade(false);
      const rig = m.world.rig;
      rig.blend = null; // QA camera replaces the title fly-in, which is very slow under SwiftShader.
      rig.snapTo(focus); rig.dist = distance; rig.distTarget = distance;
      rig.update(0, focus, null, m.loop.timeScale);
      if (heroPhoto) {
        // A camera-only photograph of this real public raft; leave its record and profile untouched.
        m.world.camera.position.set(focus.x + c * 6 + s * 7, focus.y + 4.5, focus.z - s * 6 + c * 7);
        m.world.camera.lookAt(focus);
        m.world.camera.updateMatrixWorld(true);
      }
      const records = m.client.pred.rafts;
      const rootBefore = view.root;
      const sameChanged = layer.update(records, 0, m.client.youServer);
      const sameRoot = layer.views.get(String(record.id))?.root === rootBefore;
      if (sameChanged || !sameRoot || layer.views.size !== 1) throw new Error(`${name}: identical snapshot rebuilt raft`);
      const removedChanged = layer.update([], 0, m.client.youServer);
      const emptyCount = layer.views.size;
      const restoredChanged = layer.update(records, 0, m.client.youServer);
      const restoredCount = layer.views.size;
      const restoredRoot = layer.views.get(String(record.id))?.root;
      if (!removedChanged || emptyCount !== 0 || !restoredChanged || restoredCount !== 1 || !restoredRoot) throw new Error(`${name}: empty/full-list cleanup test failed`);
      const renderedView = layer.views.get(String(record.id));
      const bounds = new THREE.Box3().setFromObject(renderedView.root);
      const meshNames = [];
      let raftMeshes = 0;
      renderedView.root.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { raftMeshes++; meshNames.push(o.name || o.material?.name || o.type); } });
      const surfaceCounts = Object.fromEntries(['wood', 'iron', 'rope', 'cloth'].map((surface) => [surface, { materials: 0, texturedMaterials: 0, maps: 0 }]));
      let texturedMaps = 0;
      renderedView.root.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh)) return;
        for (const material of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!material?.map) continue;
          texturedMaps++;
          const surface = material.userData?.raftSurface;
          if (surfaceCounts[surface]) {
            surfaceCounts[surface].texturedMaterials++;
            surfaceCounts[surface].maps++;
          }
        }
        for (const material of (Array.isArray(o.material) ? o.material : [o.material])) {
          const surface = material?.userData?.raftSurface;
          if (surfaceCounts[surface]) surfaceCounts[surface].materials++;
        }
      });
      const atlasEntry = m.assets.list().find((entry) => entry.id === 'tex:raft-comic-v1') || null;
      const atlasApplied = !!layer.atlas;
      const atlasTexture = m.assets.texture('tex:raft-comic-v1') || null;
      const image = atlasTexture?.image || atlasTexture?.source?.data || null;
      const atlasWidth = Number(image?.width || image?.naturalWidth) || null;
      const atlasHeight = Number(image?.height || image?.naturalHeight) || null;
      const decodedRgbaBytesEstimate = atlasWidth && atlasHeight ? atlasWidth * atlasHeight * 4 : null;
      const decodedRgbaMipBytesEstimate = decodedRgbaBytesEstimate === null ? null : Math.ceil(decodedRgbaBytesEstimate * 4 / 3);
      m.world.pipeline.markDirty();
      m.world.render();
      const info = m.world.renderer.info;
      return {
        name, publicRecord: JSON.parse(JSON.stringify(record)), focus: focus.toArray(), distance,
        camera: { position: m.world.camera.position.toArray(), target: rig.target.toArray(), scripted: true,
          mode: heroPhoto ? 'hero-oblique' : 'rig', localOffset: heroPhoto ? [6, 4.5, 7] : null },
        viewCount: layer.views.size, sameSnapshotChanged: sameChanged, sameRoot, emptyListChanged: removedChanged,
        emptyListViews: emptyCount, restoredListChanged: restoredChanged, restoredViews: restoredCount,
        renderedPieceNames: record.parts.map((p) => p[0]), meshNames, raftMeshes,
        importedCrates: renderedView.external.length, isLocal: renderedView.isLocal,
        skinEnabled: !!layer.skinEnabled, atlas: atlasApplied, atlasTextureLoaded: !!atlasTexture,
        atlasAsset: atlasEntry ? { state: atlasEntry.state, error: atlasEntry.error || '', src: atlasEntry.src,
          selectedSrc: atlasEntry.selectedSrc } : { state: 'absent', error: '' },
        atlasImage: { width: atlasWidth, height: atlasHeight,
          decodedRgbaBytesEstimate, decodedRgbaMipBytesEstimate, estimateOnly: true, notVram: true },
        texturedMaps, surfaceCounts, renderTime: 0,
        raftBounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new THREE.Vector3()).toArray() },
        programs: info.programs?.length ?? null, calls: info.render.calls, triangles: info.render.triangles,
        memory: { geometries: info.memory.geometries, textures: info.memory.textures },
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, touch: matchMedia('(pointer: coarse)').matches },
        softwareQA: { forcedSwiftShader: true, visualOnly: true, performanceClaim: false },
      };
    }, { name, distance, heroPhoto });
    const png = await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false });
    return { ...details, screenshot: path.join(out, `${name}.png`), screenshotBytes: png.length };
  };

  // These DOM labels were projected by the gameplay camera before it froze. Hide them for model photos.
  await page.addStyleTag({ content: '.prompt, .nameplate, .tracker { visibility: hidden !important; }' });
  const overview = await cameraAndRender('overview', 20);
  const close = await cameraAndRender('close', 13);
  let heroCapture = null;
  if (heroEnabled) {
    const heroStyle = await page.addStyleTag({ content: '#ui { visibility: hidden !important; } #ui * { visibility: hidden !important; }' });
    try { heroCapture = await cameraAndRender('hero', 10.5, true); }
    finally { await heroStyle.evaluate((style) => style.remove()); }
  }
  const expectedAtlas = skin && !noAssets && !atlasFail;
  const allCaptures = [overview, close, ...(heroCapture ? [heroCapture] : [])];
  if (!noAssets && allCaptures.some((capture) => capture.atlasAsset.selectedSrc !== expectedTextureSrc)) {
    throw new Error('Wrong desktop/mobile texture source was selected');
  }
  if (!noAssets && !atlasFail && allCaptures.some((capture) => capture.atlasImage.width !== (phone ? 512 : 1024)
      || capture.atlasImage.height !== (phone ? 512 : 1024))) throw new Error('Wrong atlas resolution was loaded');
  if (allCaptures.some((capture) => capture.skinEnabled !== skin)) throw new Error('Raft skin toggle did not match SKIN');
  if (expectedAtlas && allCaptures.some((capture) => !capture.atlas || !capture.atlasTextureLoaded || capture.atlasAsset.state !== 'ok')) {
    throw new Error('Raft comic atlas is enabled but missing or not loaded');
  }
  if (expectedAtlas && allCaptures.some((capture) => ['wood', 'iron', 'rope', 'cloth']
      .some((kind) => capture.surfaceCounts[kind].texturedMaterials === 0))) {
    throw new Error('One of the four raft surfaces is not visibly using the atlas');
  }
  if (atlasFail && allCaptures.some((capture) => capture.atlasAsset.state !== 'error' || capture.atlas || capture.atlasTextureLoaded
      || ['wood', 'iron', 'rope', 'cloth'].some((surface) => capture.surfaceCounts[surface].texturedMaterials !== 0))) {
    throw new Error('Failed atlas did not leave the raft on its untextured fallback');
  }
  if ((!skin || noAssets || atlasFail) && allCaptures.some((capture) => capture.surfaceCounts.wood.texturedMaterials
      || capture.surfaceCounts.iron.texturedMaterials || capture.surfaceCounts.rope.texturedMaterials || capture.surfaceCounts.cloth.texturedMaterials)) {
    throw new Error('Fallback/skin-off capture still has textured raft surface materials');
  }
  const firstGameErrors = await page.evaluate(() => [...(window.__mn?.errors || [])]);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const secondJoin = await joinNormalWorker(false);
  await waitForNormalSave(secondJoin.record);
  const secondEvidence = await page.evaluate(({ saveKey, id }) => {
    const m = window.__mn, record = m.client.pred.rafts.find((r) => r.id === id);
    const own = m.client.profile?.eco?.ships?.find((s) => s.kind === 'raft' && s.id === id);
    const saved = JSON.parse(localStorage.getItem(saveKey) || 'null');
    const savedOwn = saved?.eco?.ships?.find((s) => s.kind === 'raft' && s.id === id);
    const hold = (s) => s ? { cap: s.hold?.cap ?? 0,
      goods: Object.fromEntries(Object.entries(s.hold?.goods || {}).sort(([a], [b]) => a.localeCompare(b))) } : null;
    return {
      publicRecord: record ? JSON.parse(JSON.stringify(record)) : null,
      ownProfile: own ? { id: own.id, parts: own.grid?.parts?.map((p) => [...p]) || [], hold: hold(own) } : null,
      persistedProfile: savedOwn ? { id: savedOwn.id, parts: savedOwn.grid?.parts?.map((p) => [...p]) || [], hold: hold(savedOwn) } : null,
      viewIds: [...m.world.rafts.views.keys()], transport: m.transport.kind,
    };
  }, { saveKey, id: firstJoin.record.id });
  if (!secondEvidence.publicRecord || !secondEvidence.ownProfile || !secondEvidence.persistedProfile || secondEvidence.viewIds.length !== 1) {
    throw new Error(`Reconnect did not restore one owned public raft/view: ${JSON.stringify(secondEvidence)}`);
  }
  if (firstEvidence.publicRecord.id !== secondEvidence.publicRecord.id
      || JSON.stringify(firstEvidence.publicRecord.parts) !== JSON.stringify(secondEvidence.publicRecord.parts)
      || firstEvidence.persistedProfile.id !== secondEvidence.persistedProfile.id
      || JSON.stringify(firstEvidence.persistedProfile.parts) !== JSON.stringify(secondEvidence.persistedProfile.parts)
      || JSON.stringify(firstEvidence.persistedProfile.hold) !== JSON.stringify(secondEvidence.persistedProfile.hold)
      || JSON.stringify(firstEvidence.ownProfile.hold) !== JSON.stringify(secondEvidence.ownProfile.hold)) {
    throw new Error('Reload continuity mismatch for raft id, public parts, or own hold');
  }
  await page.evaluate(() => {
    const m = window.__mn, previous = m.client.onSnapshot.bind(m.client);
    const observer = { tick: -1, at: performance.now(), n: 0 };
    m.client.onSnapshot = (s) => { previous(s); observer.tick = s.tick; observer.at = performance.now(); observer.n++; };
    window.__raftPause = { observer, previous, started: performance.now() };
  });
  await page.waitForFunction(() => window.__raftPause?.observer.n > 0, null, { timeout: timeouts.snapshot });
  await page.evaluate(() => window.__mn.transport.send({ t: 'cmd', type: 'pause', on: true }));
  await page.waitForFunction(() => window.__raftPause && performance.now() - window.__raftPause.observer.at > 350, null, { timeout: timeouts.pause });
  const reconnectPause = await page.evaluate(() => {
    window.__mn.loop.running = false;
    return { snapshotTick: window.__raftPause.observer.tick, stableMs: Math.round(performance.now() - window.__raftPause.observer.at) };
  });
  await page.addStyleTag({ content: '.prompt, .nameplate, .tracker { visibility: hidden !important; }' });
  const reconnectCapture = await cameraAndRender('reconnect', 13);
  if (reconnectCapture.skinEnabled !== skin || (expectedAtlas && (!reconnectCapture.atlas || !reconnectCapture.atlasTextureLoaded || reconnectCapture.atlasAsset.state !== 'ok'))) {
    throw new Error('Raft atlas state changed across normal save/reload');
  }
  if (atlasFail && (reconnectCapture.atlasAsset.state !== 'error' || reconnectCapture.atlas || reconnectCapture.atlasTextureLoaded)) {
    throw new Error('Failed atlas did not remain on fallback after normal save/reload');
  }
  if ((!skin || noAssets || atlasFail) && ['wood', 'iron', 'rope', 'cloth']
      .some((surface) => reconnectCapture.surfaceCounts[surface].texturedMaterials !== 0)) {
    throw new Error('Fallback/skin-off reconnect still has textured raft surface materials');
  }
  const gameErrorsAfterReload = await page.evaluate(() => [...(window.__mn?.errors || [])]);
  if (noAssets ? textureRequests.length !== 0 : !textureRequests.length
      || textureRequests.some((src) => src !== `/assets/${expectedTextureSrc}`)) {
    throw new Error('Texture network requests loaded an unexpected variant or the PNG source');
  }
  if (!noAssets && reconnectCapture.atlasAsset.selectedSrc !== expectedTextureSrc) throw new Error('Reload changed the texture variant');

  const evidence = {
    base: release?.sourceSha || observedGitHead, observedGitHead, workingTree: !release, release, root, quality, tod, noAssets, skin, atlasFail, hero: heroEnabled,
    viewport: { width, height, dpr: +(process.env.DPR || 1), phone },
    textureRequests, expectedTextureSrc,
    transport: 'local WorkerTransport', saves: { slot: saveKey, normalWorkerSaveObserved: true, firstBytes: firstEvidence.saveBlobBytes,
      first: firstEvidence, afterReload: secondEvidence },
    pause: { first: pauseInfo, reconnect: reconnectPause },
    captures: [overview, close, ...(heroCapture ? [heroCapture] : []), reconnectCapture],
    pageErrors, consoleErrors, gameErrors: { first: firstGameErrors, afterReload: gameErrorsAfterReload },
    softwareQA: { forcedSwiftShader: true, visualOnly: true, noFPSOrHardwareClaim: true },
  };
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  if (pageErrors.length || firstGameErrors.length || gameErrorsAfterReload.length) {
    throw new Error('Browser or game errors occurred; inspect evidence.json');
  }
  if (evidence.captures.some((c) => c.importedCrates !== (noAssets ? 0 : 1) || !c.isLocal)) {
    throw new Error('Owned raft crate adoption/fallback mismatch; inspect evidence.json');
  }
  console.log(JSON.stringify({ out, raftId: firstEvidence.publicRecord.id, captures: evidence.captures.map((c) => c.screenshot), pageErrors: pageErrors.length, consoleErrors: consoleErrors.length }));
} catch (error) {
  const pages = context?.pages() || [];
  const page = pages[0];
  if (page) {
    const state = await page.evaluate(() => ({ mode: window.__mn?.st.mode, joined: window.__mn?.client.joined,
      rafts: window.__mn?.client.pred.rafts?.length, views: window.__mn?.world.rafts?.views.size,
      errors: window.__mn?.errors || [] })).catch(() => null);
    fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ error: error.message, state, pageErrors, consoleErrors }, null, 2));
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (closeServer) await closeServer().catch(() => {});
  else if (server.listening) await new Promise((resolve) => server.close(resolve));
}
