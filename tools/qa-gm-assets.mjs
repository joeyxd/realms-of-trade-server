// Same-camera source/derivative review through the actual game loader, plus catalog thumbnails.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';

const root = resolve('.'), output = resolve('docs/delivery/gm00'), thumbnails = resolve('assets/editor/thumbnails');
await mkdir(output, { recursive: true }); await mkdir(thumbnails, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT || '.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const game = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log() {}, saveSecret: 'gm-assets-fixture' });
const port = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
const evidence = { schema: 'gm00-visual/v1', at: new Date().toISOString(), sourceIntact: true, actualGameLoader: true,
  physicalMobilePerformance: false, captures: [], models: [], errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route(/https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/, async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? 'node_modules/three' : '.scratch/gsap-local/package', match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  });
  const sources = { 'rock.glb': 'Tropical_Rock_Formation.glb', 'coral.glb': 'colorful coral reef 3d model.glb' };
  await context.route('**/__gm_sources/*.glb', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!sources[name]) return route.abort();
    return route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: fs.readFileSync(resolve('materials/imported models', sources[name])) });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => evidence.errors.push(error.stack || error.message));
  await page.goto(`http://127.0.0.1:${port}/?q=high&tod=day`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__mn, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const THREE = await import('three');
    const { createEditorModels } = await import('./src/editor/modelFactory.js');
    __mn.loop.frame = () => {};
    const entries = (await (await fetch('assets/editor/catalog.json')).json()).assets;
    for (const entry of entries) if (!(await __mn.assets.ensureModel(entry))) throw new Error(`Could not load ${entry.id}`);
    for (const name of ['rock', 'coral']) {
      if (!(await __mn.assets.ensureModel({ id: `model:gm-source-${name}`, kind: 'model', src: `${name}.glb`, fit: 'size', size: 4 }, { base: `${location.origin}/__gm_sources/` }))) throw new Error(`Could not load source ${name}`);
    }
    const editorModels = createEditorModels(__mn.assets);
    window.__gmRender = async (id, { width = 512, angle = 0.7, pbr = false } = {}) => {
      const renderer = __mn.world.renderer;
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x14252d);
      scene.add(new THREE.HemisphereLight(0xd6f6ff, 0x3f4832, 2.0));
      const sun = new THREE.DirectionalLight(0xfff1dc, 3.0); sun.position.set(4, 7, 5); scene.add(sun);
      let object;
      if (pbr) {
        const name = id.endsWith('coral') ? 'coral' : 'rock';
        const loader = await __mn.assets.gltfLoader();
        object = (await loader.loadAsync(`${location.origin}/__gm_sources/${name}.glb`)).scene;
        object.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3());
        const scale = 4 / Math.max(size.x, size.z);
        const wrapper = new THREE.Group(); wrapper.add(object); wrapper.scale.setScalar(scale);
        wrapper.position.set(-(box.min.x + box.max.x) * .5 * scale, -box.min.y * scale, -(box.min.z + box.max.z) * .5 * scale);
        object = wrapper;
      } else object = editorModels.model(id);
      if (!object) throw new Error(`Model unavailable ${id}`);
      scene.add(object);
      const box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3());
      const family = id.includes('coral') ? 'coral' : id.includes('rock') && id.startsWith('model:gm-') ? 'rock' : null;
      const frameBox = family ? new THREE.Box3().setFromObject(editorModels.model(`model:gm-source-${family}`)) : box;
      const frameSize = frameBox.getSize(new THREE.Vector3()), center = frameBox.getCenter(new THREE.Vector3());
      const camera = new THREE.PerspectiveCamera(35, 1, .05, 100);
      const distance = Math.max(frameSize.x, frameSize.y, frameSize.z) * 2.5;
      camera.position.set(center.x + Math.sin(angle) * distance, center.y + distance * .45, center.z + Math.cos(angle) * distance);
      camera.lookAt(center); camera.updateMatrixWorld();
      const target = new THREE.WebGLRenderTarget(width, width, { depthBuffer: true });
      target.texture.colorSpace = THREE.SRGBColorSpace;
      const priorTarget = renderer.getRenderTarget(), priorShadow = renderer.shadowMap.enabled;
      renderer.shadowMap.enabled = false; renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera);
      const pixels = new Uint8Array(width * width * 4); renderer.readRenderTargetPixels(target, 0, 0, width, width, pixels);
      renderer.setRenderTarget(priorTarget); renderer.shadowMap.enabled = priorShadow; target.dispose();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = width;
      const ctx = canvas.getContext('2d'), image = ctx.createImageData(width, width);
      for (let y = 0; y < width; y++) image.data.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), (width - y - 1) * width * 4);
      ctx.putImageData(image, 0, 0);
      return { png: canvas.toDataURL('image/png').split(',')[1], webp: canvas.toDataURL('image/webp', .88).split(',')[1],
        id, triangles: __mn.assets.data(id)?.tris, size: size.toArray(), camera: camera.position.toArray(), lookAt: center.toArray() };
    };
  });
  const ids = ['model:gm-source-rock', 'model:gm-rock-2k', 'model:gm-rock-1k', 'model:gm-source-coral', 'model:gm-coral-200k', 'model:gm-coral-50k'];
  for (const angle of [.7, 2.5]) for (const id of ids) {
    const image = await page.evaluate(({ id, angle }) => __gmRender(id, { angle }), { id, angle });
    const filename = `${id.replace(/:/g, '-')}-${angle}.png`;
    await writeFile(resolve(output, filename), Buffer.from(image.png, 'base64'));
    const { png, webp, ...metrics } = image; evidence.models.push({ ...metrics, angle, filename }); evidence.captures.push(filename);
  }
  for (const id of ['model:gm-source-rock', 'model:gm-source-coral']) {
    const image = await page.evaluate((id) => __gmRender(id, { pbr: true }), id);
    const filename = `${id.replace(/:/g, '-')}-pbr.png`;
    await writeFile(resolve(output, filename), Buffer.from(image.png, 'base64')); evidence.captures.push(filename);
  }
  const index = {};
  const labels = {
    'prop:storage-crate': ['Caja de almacenaje', 'Storage crate'],
    'model:coast-rock-v1': ['Roca costera', 'Coastal rock'],
    'model:beach-shell-fan-v1': ['Concha abanico', 'Fan shell'],
    'model:beach-shell-oval-v1': ['Concha ovalada', 'Oval shell'],
    'model:beach-shell-chip-v1': ['Fragmento de concha', 'Shell fragment'],
    'model:beach-pebbles-v1': ['Piedras de playa', 'Beach pebbles'],
    'model:palm-tall-v1': ['Palmera alta', 'Tall palm'],
    'model:palm-curved-v1': ['Palmera curva', 'Curved palm'],
    'model:palm-short-v1': ['Palmera baja', 'Short palm'],
    'model:palm-base-open-v1': ['Base de palmera abierta', 'Open palm base'],
    'model:palm-base-lush-v1': ['Base de palmera frondosa', 'Lush palm base'],
    'model:shrub-round-v1': ['Arbusto redondo', 'Round shrub'],
    'model:shrub-low-v1': ['Arbusto bajo', 'Low shrub'],
    'model:shrub-tall-v1': ['Arbusto alto', 'Tall shrub'],
    'model:beach-debris-branch-v1': ['Rama de playa', 'Beach branch'],
    'model:beach-debris-log-v1': ['Tronco de playa', 'Beach log'],
    'model:beach-debris-planks-v1': ['Tablas de playa', 'Beach planks'],
  };
  const entries = await page.evaluate(() => __mn.assets.list().filter((entry) => ['prop', 'model'].includes(entry.kind) && !entry.id.startsWith('model:gm-source')));
  for (const entry of entries) {
    const image = await page.evaluate((id) => __gmRender(id, { width: 192 }), entry.id);
    const filename = entry.id.replace(/[^a-zA-Z0-9._-]/g, '-') + '.webp';
    await writeFile(resolve(thumbnails, filename), Buffer.from(image.webp, 'base64'));
    const source = resolve('assets', entry.src);
    index[entry.id] = { thumbnail: `assets/editor/thumbnails/${filename}`,
      ...(labels[entry.id] ? { label: { es: labels[entry.id][0], en: labels[entry.id][1] } } : {}),
      stats: { triangles: image.triangles, ...(fs.existsSync(source) ? { bytes: fs.statSync(source).size } : {}) } };
  }
  await writeFile(resolve('assets/editor/thumbnails.json'), JSON.stringify({ version: 1, assets: index }, null, 2) + '\n');
  assert.deepEqual(evidence.errors, []); console.log(`Captured ${evidence.captures.length} comparisons and ${entries.length} thumbnails.`);
} catch (error) { evidence.errors.push(error.stack || String(error)); process.exitCode = 1; }
finally {
  await writeFile(resolve(output, 'visual-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  await browser.close(); await game.close();
}
