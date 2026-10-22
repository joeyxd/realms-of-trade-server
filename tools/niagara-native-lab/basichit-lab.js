// NS_BasicHit native render: BasicHitSimulation -> instanced layers (basichit-render.js) -> half-float HDR target ->
// the color lab's Filmic LUT (film-color.js) -> canvas, at the reference's 1024 px with its cameras. The "isolate color"
// path sends Unreal's raw RGBA16F SceneColor HDR through the same LUT (transfer precondition, as color-lab.js:71 feeds
// row.files.raw). Reference: basichit-reference05 (profile controlled-sdr/v1). Captured particle states are never read;
// every reference file is checked against reference-profiled-checkpoint.json before use.
import * as THREE from 'three';
import { toScene } from './particles.js';
import { BasicHitSimulation } from './basichit-simulation.js';
import { BasicHitParticles, BASICHIT_LAYERS, DRAW_ORDERS } from './basichit-render.js';
import { FILM_SOURCE_SHA256 } from './film-identity.js';
import { createFilmLUT, filmFragment } from './film-color.js';
const $ = id => document.getElementById(id);
const RUN = 'basichit-reference05', PROFILE = 'controlled-sdr/v1', base = `/.scratch/unreal/${RUN}/`, docs = '/docs/delivery/st01c/basichit/';
const SIZE = 1024, TRANSFER_STEP = 12, RAW_ENCODING = 'little-endian RGBA float16; top row first';
const state = { ready: false, errors: [] }; window.basicHitLab = state;
try {
  const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  const getBytes = async path => { const r = await fetch(path); if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`); return r.arrayBuffer(); };
  const decode = bytes => JSON.parse(new TextDecoder().decode(bytes));
  async function pinnedLocal(path, hash) {
    const bytes = await getBytes(path);
    if (await hex(bytes) !== hash) throw new Error('Source hash mismatch: ' + path);
    return decode(bytes);
  }
  const reference = decode(await getBytes(docs + 'reference-profiled-checkpoint.json'));
  const pinnedRun = reference.runs?.find(r => r.name === RUN);
  if (reference.referenceRun !== RUN || reference.profile?.id !== PROFILE || !Array.isArray(pinnedRun?.files))
    throw new Error('Unexpected BasicHit reference checkpoint');
  const pins = new Map(pinnedRun.files.map(f => [f.file, f.sha256]));
  async function pinned(file) {
    if (!pins.has(file)) throw new Error('Unpinned reference file: ' + file);
    const bytes = await getBytes(base + file);
    if (await hex(bytes) !== pins.get(file)) throw new Error('Reference hash mismatch: ' + file);
    return bytes;
  }
  const report = decode(await pinned('capture-report.json')), s = report.settings;
  if (report.status !== 'complete' || s.capture_source !== 'FinalColorLDR' || s.projection !== 'orthographic' || s.color_profile !== PROFILE ||
      JSON.stringify(s.resolution) !== JSON.stringify([SIZE, SIZE]) || s.orthographic_width_cm !== 850 ||
      report.images?.length !== 15 || report.empty_baseline?.step !== 0 || report.empty_baseline.camera !== 'front')
    throw new Error('Unexpected BasicHit capture');
  for (const row of [report.empty_baseline, ...report.images]) {
    if (row.file !== `frames/t${String(row.step).padStart(4, '0')}_${row.camera}.png` || !/^(front|oblique|side)$/.test(row.camera) ||
        !pins.has(row.file) || ![row.position_cm, row.target_cm].every(v => v?.length === 3 && v.every(Number.isFinite)))
      throw new Error('Invalid reference row');
    const raw = row.hdr_raw;
    if (row.step === TRANSFER_STEP && (raw?.file !== `frames/t0012_${row.camera}_hdr.rgba16f` || raw.encoding !== RAW_ENCODING ||
        raw.width !== SIZE || raw.height !== SIZE || raw.bytes !== SIZE * SIZE * 8 || pins.get(raw.file) !== raw.sha256))
      throw new Error('Invalid raw HDR reference');
  }
  const film = createFilmLUT(await pinnedLocal('./film-source.json', FILM_SOURCE_SHA256));
  const simulationCheckpoint = decode(await getBytes(docs + 'simulation-checkpoint.json'));
  const simulation = new BasicHitSimulation(await pinnedLocal('./basichit-source.json', simulationCheckpoint.source.sha256),
    { seed: reference.seedConfiguration.fixtureSeedBase });
  // Textures from the verified bytes: raw sRGB-encoded texels, rows flipped like TextureLoader's flipY.
  const bitmaps = [];
  const textures = await Promise.all(BASICHIT_LAYERS.map(async d => {
    if (!d.texture) return null;
    const row = report.renderer_textures.find(r => r.asset.endsWith('/' + d.texture));
    if (!row || row.file !== `textures/${d.texture}.png` || row.srgb !== true) throw new Error('Unexpected BasicHit texture');
    const bitmap = await createImageBitmap(new Blob([await pinned(row.file)], { type: 'image/png' }),
      { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    bitmaps.push(bitmap);
    const t = new THREE.Texture(bitmap);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  }));
  // Unreal SceneColor HDR (raw RGBA16F, pre-tonemap) at the transfer step, one per camera. Decoded little-endian like
  // transfer-basichit.mjs decodeRaw; size checked like color-lab.js; texture set up like color-lab.js (flipY: top row first).
  const linear = new Map();
  for (const row of report.images.filter(r => r.step === TRANSFER_STEP)) {
    const bytes = await pinned(row.hdr_raw.file);
    if (bytes.byteLength !== SIZE * SIZE * 8) throw new Error('Invalid raw HDR size');
    const littleEndian = new DataView(bytes), halfFloats = new Uint16Array(SIZE * SIZE * 4);
    for (let i = 0; i < halfFloats.length; i++) halfFloats[i] = littleEndian.getUint16(i * 2, true);
    const t = new THREE.DataTexture(halfFloats, SIZE, SIZE, THREE.RGBAFormat, THREE.HalfFloatType);
    t.flipY = true; t.needsUpdate = true; t.colorSpace = THREE.LinearSRGBColorSpace;
    linear.set(row.camera, t);
  }
  if (linear.size !== 3) throw new Error('Missing raw HDR references');
  const renderer = new THREE.WebGLRenderer({ canvas: $('preview'), antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(SIZE, SIZE, false); renderer.info.autoReset = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
  const half = s.orthographic_width_cm / 200;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, .01, 100);
  const particles = new BasicHitParticles(scene, textures);
  const hdr = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType, depthBuffer: true });
  hdr.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const outputScene = new THREE.Scene(), outputCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = { image: { value: hdr.texture }, exposure: { value: 1 }, filmLUT: { value: film.texture } };
  const filmMaterial = new THREE.ShaderMaterial({ uniforms, glslVersion: THREE.GLSL3, toneMapped: false,
    vertexShader: 'out vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: filmFragment,
    depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), filmMaterial); outputScene.add(quad);
  const rowFor = (step, view) => step === 0 ? report.empty_baseline : report.images.find(r => r.step === step && r.camera === view);
  function draw() {
    if (state.disposed) return;
    const step = Number($('step').value), view = $('camera').value, order = $('order').value;
    const row = rowFor(step, view); if (!row) throw new Error('Unknown BasicHit view');
    const transfer = $('use-ue-hdr').checked && step === TRANSFER_STEP;
    camera.position.set(...toScene(row.position_cm)); camera.lookAt(new THREE.Vector3(...toScene(row.target_cm))); camera.updateMatrixWorld();
    const frame = simulation.seek(step);
    particles.setOrder(order); particles.update(frame);
    renderer.info.reset();
    renderer.setRenderTarget(hdr); renderer.render(scene, camera); renderer.setRenderTarget(null);
    uniforms.image.value = transfer ? linear.get(view) : hdr.texture;
    renderer.render(outputScene, outputCamera);
    $('reference').src = base + row.file;
    $('reference-label').textContent = `Unreal · ${view} · ${(step / 60).toFixed(2)} s · imagen final`;
    $('preview-label').textContent = transfer ? 'HDR crudo de Unreal · Filmic del laboratorio' : `Generador nativo · Filmic${order === 'reverse' ? ' · orden inverso (diagnóstico)' : ''}`;
    Object.assign(state, { step, camera: view, order, source: transfer ? 'transfer' : 'native', snapshot: frame,
      counts: [...particles.counts], stats: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        textures: renderer.info.memory.textures, generatedLutBytes: film.generatedBytes } });
    const [flame, flash, burst] = particles.counts;
    $('status').textContent = `${flame + flash + burst} partículas nativas (llama ${flame}, destello ${flash}, ráfaga ${burst}) · ${(step / 60).toFixed(2)} s · perfil SDR sRGB sin bloom`;
  }
  function select() {
    if (state.disposed) return;
    if ($('step').value === '0') $('camera').value = 'front';
    $('camera').disabled = $('step').value === '0';
    $('use-ue-hdr').disabled = Number($('step').value) !== TRANSFER_STEP;
    draw();
  }
  const change = () => { try { select(); } catch (e) { state.errors.push(String(e)); $('status').textContent = e.message; } };
  for (const id of ['step', 'camera', 'order', 'use-ue-hdr']) $(id).onchange = change;
  $('reset').onclick = () => { $('step').value = '12'; $('camera').value = 'front'; $('order').value = 'gate'; $('use-ue-hdr').checked = false; change(); };
  state.select = async (step, view, order = 'gate', source = 'native') => {
    if (![0, 2, 6, 12, 18, 24].includes(step) || !Object.hasOwn(DRAW_ORDERS, order) || !['native', 'transfer'].includes(source) ||
        (source === 'transfer' && step !== TRANSFER_STEP) || (step === 0 && view !== 'front')) throw new Error('Invalid BasicHit selection');
    $('step').value = String(step); $('camera').value = view; $('order').value = order; $('use-ue-hdr').checked = source === 'transfer';
    select();
  };
  state.dispose = () => { if (state.disposed) return; state.disposed = true;
    particles.dispose(); textures.forEach(t => t?.dispose()); bitmaps.forEach(b => b.close()); film.texture.dispose(); hdr.dispose();
    linear.forEach(t => t.dispose()); quad.geometry.dispose(); filmMaterial.dispose(); renderer.dispose(); state.ready = false;
    state.resourcesAfterDispose = { ...renderer.info.memory }; };
  window.addEventListener('pagehide', state.dispose, { once: true });
  select(); state.ready = true;
} catch (e) { state.errors.push(String(e)); $('status').textContent = `No se pudo abrir BasicHit: ${e.message}`; console.error(e); }
