// NS_BasicHit native render: BasicHitSimulation -> instanced layers (basichit-render.js) -> half-float HDR target ->
// the color lab's Filmic LUT (film-color.js) -> canvas, at the reference's 1024 px with its cameras. The "isolate color"
// path sends Unreal's raw RGBA16F SceneColor HDR through the same LUT (transfer precondition, as color-lab.js:71 feeds
// row.files.raw). Reference sets (?reference=<set>, profile controlled-sdr/v1): gate, basichit-reference05 pinned by
// reference-profiled-checkpoint.json; wrap, basichit-reference10 pinned by wrap-reference-checkpoint.json (steps 20-23, the
// Flame's SubUV past its 8x4 grid, WRAP.md); depth, basichit-reference12 pinned by depth-reference-checkpoint.json (steps
// 6 and 12: 3 controls plus 13 opaque black planes per step, the Flame with DepthFade, DEPTH.md). Image steps and the transfer step (the linear step) come from the
// checkpoint settings. Captured particle states are never read; every reference file is checked against its pin first.
import * as THREE from 'three';
import { toScene } from '../../src/render/vfx/niagara/particles.js';
import { BasicHitSimulation } from '../../src/render/vfx/niagara/basichit-simulation.js';
import { BasicHitParticles, BASICHIT_LAYERS, BASICHIT_DEPTH_LAYERS, DRAW_ORDERS } from '../../src/render/vfx/niagara/basichit-render.js';
import { BasicHitDepthStage, planeFromSurface } from './basichit-depth.js';
import { FILM_SOURCE_SHA256 } from '../../src/render/vfx/niagara/film-identity.js';
import { createFilmLUT, filmFragment } from '../../src/render/vfx/niagara/film-color.js';
import { SUBUV_POLICIES } from '../../src/render/vfx/niagara/core/subuv-atlas.js';
const $ = id => document.getElementById(id);
const REFERENCES = { gate: ['basichit-reference05', 'reference-profiled-checkpoint.json'],
  wrap: ['basichit-reference10', 'wrap-reference-checkpoint.json'], depth: ['basichit-reference12', 'depth-reference-checkpoint.json'] };
const SET = new URLSearchParams(location.search).get('reference') ?? 'gate';
const [RUN, CHECKPOINT] = REFERENCES[SET] ?? [], PROFILE = 'controlled-sdr/v1', base = `/.scratch/unreal/${RUN}/`, docs = '/docs/delivery/st01c/basichit/';
const DEPTH = SET === 'depth', LABEL = /^(front|oblique|side)_(wall-25|wall0|wall50|wall150|floor)$/;
const SIZE = 1024, RAW_ENCODING = 'little-endian RGBA float16; top row first';
const pad = step => String(step).padStart(4, '0'), seconds = step => (step / 60).toFixed(2).replace('.', ',');
const state = { ready: false, errors: [] }; window.basicHitLab = state;
try {
  if (!RUN) throw new Error('Unknown BasicHit reference set');
  const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  const getBytes = async path => { const r = await fetch(path); if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`); return r.arrayBuffer(); };
  const decode = bytes => JSON.parse(new TextDecoder().decode(bytes));
  async function pinnedLocal(path, hash) {
    const bytes = await getBytes(path);
    if (await hex(bytes) !== hash) throw new Error('Source hash mismatch: ' + path);
    return decode(bytes);
  }
  const reference = decode(await getBytes(docs + CHECKPOINT));
  const pinnedRun = reference.runs?.find(r => r.name === RUN);
  const STEPS = reference.settings?.imageSteps, TRANSFER_STEP = reference.settings?.linearStep;
  if (reference.referenceRun !== RUN || reference.profile?.id !== PROFILE || !Array.isArray(pinnedRun?.files) ||
      !Array.isArray(STEPS) || !STEPS.every(Number.isInteger) || !STEPS.includes(TRANSFER_STEP))
    throw new Error('Unexpected BasicHit reference checkpoint');
  state.reference = { set: SET, run: RUN, steps: [...STEPS], transferStep: TRANSFER_STEP };
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
      report.images?.length !== STEPS.length * 3 || report.empty_baseline?.step !== 0 || report.empty_baseline.camera !== 'front')
    throw new Error('Unexpected BasicHit capture');
  for (const row of [report.empty_baseline, ...report.images]) {
    if (row.file !== `frames/t${pad(row.step)}_${row.camera}.png` || !/^(front|oblique|side)$/.test(row.camera) ||
        (row !== report.empty_baseline && !STEPS.includes(row.step)) ||
        !pins.has(row.file) || ![row.position_cm, row.target_cm].every(v => v?.length === 3 && v.every(Number.isFinite)))
      throw new Error('Invalid reference row');
    const raw = row.hdr_raw;
    if (row.step === TRANSFER_STEP && (raw?.file !== `frames/t${pad(TRANSFER_STEP)}_${row.camera}_hdr.rgba16f` || raw.encoding !== RAW_ENCODING ||
        raw.width !== SIZE || raw.height !== SIZE || raw.bytes !== SIZE * SIZE * 8 || pins.get(raw.file) !== raw.sha256))
      throw new Error('Invalid raw HDR reference');
  }
  // Depth set: every plane pose is a row of surface_images (view, label, surface, hdr_raw at the transfer step).
  const surfaceRows = DEPTH ? report.surface_images : [];
  if (DEPTH) {
    if (!Array.isArray(surfaceRows) || surfaceRows.length !== STEPS.length * 13) throw new Error('Unexpected BasicHit surface poses');
    for (const row of surfaceRows) {
      const raw = row.hdr_raw;
      if (row.camera !== row.surface?.label || !LABEL.test(row.camera) || row.view !== row.camera.split('_')[0] || !STEPS.includes(row.step) ||
          row.file !== `frames/t${pad(row.step)}_${row.camera}.png` || !pins.has(row.file) ||
          ![row.position_cm, row.target_cm].every(v => v?.length === 3 && v.every(Number.isFinite)) ||
          (row.step === TRANSFER_STEP && (raw?.file !== `frames/t${pad(TRANSFER_STEP)}_${row.camera}_hdr.rgba16f` || raw.encoding !== RAW_ENCODING ||
            raw.width !== SIZE || raw.height !== SIZE || raw.bytes !== SIZE * SIZE * 8 || pins.get(raw.file) !== raw.sha256)))
        throw new Error('Invalid reference surface row');
      planeFromSurface(row.surface);
    }
  }
  const film = createFilmLUT(await pinnedLocal('../../src/render/vfx/niagara/film-source.json', FILM_SOURCE_SHA256));
  const simulationCheckpoint = decode(await getBytes(docs + 'simulation-checkpoint.json'));
  const simulation = new BasicHitSimulation(await pinnedLocal('../../src/render/vfx/niagara/basichit-source.json', simulationCheckpoint.source.sha256),
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
  // Keyed by row.camera: the view for a control, "<view>_<label>" for a plane pose (unique per step).
  for (const row of [...report.images, ...surfaceRows].filter(r => r.step === TRANSFER_STEP)) {
    const bytes = await pinned(row.hdr_raw.file);
    if (bytes.byteLength !== SIZE * SIZE * 8) throw new Error('Invalid raw HDR size');
    const littleEndian = new DataView(bytes), halfFloats = new Uint16Array(SIZE * SIZE * 4);
    for (let i = 0; i < halfFloats.length; i++) halfFloats[i] = littleEndian.getUint16(i * 2, true);
    const t = new THREE.DataTexture(halfFloats, SIZE, SIZE, THREE.RGBAFormat, THREE.HalfFloatType);
    t.flipY = true; t.needsUpdate = true; t.colorSpace = THREE.LinearSRGBColorSpace;
    linear.set(row.camera, t);
  }
  if (linear.size !== (DEPTH ? 16 : 3)) throw new Error('Missing raw HDR references');
  const renderer = new THREE.WebGLRenderer({ canvas: $('preview'), antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(SIZE, SIZE, false); renderer.info.autoReset = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  // The depth stage clears the HDR target itself: a Color background here would force a clear after the opaque pass.
  const scene = new THREE.Scene(); scene.background = DEPTH ? null : new THREE.Color(0);
  const half = s.orthographic_width_cm / 200;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, .01, 100);
  const particles = new BasicHitParticles(scene, textures, 'gate', DEPTH ? BASICHIT_DEPTH_LAYERS : BASICHIT_LAYERS);
  const stage = DEPTH ? new BasicHitDepthStage(SIZE) : null;
  if (DEPTH) $('depth-bar').style.display = '';
  const hdr = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType, depthBuffer: true });
  hdr.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const outputScene = new THREE.Scene(), outputCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = { image: { value: hdr.texture }, exposure: { value: 1 }, filmLUT: { value: film.texture } };
  const filmMaterial = new THREE.ShaderMaterial({ uniforms, glslVersion: THREE.GLSL3, toneMapped: false,
    vertexShader: 'out vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: filmFragment,
    depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), filmMaterial); outputScene.add(quad);
  $('step').replaceChildren(...[0, ...STEPS].map(step =>
    new Option(step ? `${seconds(step)} s` : '0,00 s · vacío', String(step), false, step === TRANSFER_STEP)));
  $('hdr-at').textContent = `${seconds(TRANSFER_STEP)} s`;
  // pose: 'none' (the control) or a plane label without its view ('wall0', 'floor', ...; depth set only).
  const rowFor = (step, view, pose = 'none') => step === 0 ? report.empty_baseline : pose === 'none' ?
    report.images.find(r => r.step === step && r.camera === view) : surfaceRows.find(r => r.step === step && r.camera === `${view}_${pose}`);
  function draw() {
    if (state.disposed) return;
    const step = Number($('step').value), view = $('camera').value, order = $('order').value, subUV = $('subuv').value;
    const pose = DEPTH ? $('surface').value : 'none', fade = DEPTH && $('fade').checked;
    const row = rowFor(step, view, pose); if (!row) throw new Error('Unknown BasicHit view');
    const transfer = $('use-ue-hdr').checked && step === TRANSFER_STEP;
    camera.position.set(...toScene(row.position_cm)); camera.lookAt(new THREE.Vector3(...toScene(row.target_cm))); camera.updateMatrixWorld();
    const frame = simulation.seek(step);
    particles.setOrder(order); particles.setSubUV(subUV); particles.update(frame);
    renderer.info.reset();
    if (DEPTH) { stage.configure(row.surface ?? null); stage.render(renderer, camera, hdr, scene, particles, fade); }
    else { renderer.setRenderTarget(hdr); renderer.render(scene, camera); renderer.setRenderTarget(null); }
    uniforms.image.value = transfer ? linear.get(row.camera) : hdr.texture;
    renderer.render(outputScene, outputCamera);
    $('reference').src = base + row.file;
    $('reference-label').textContent = `Unreal · ${view}${pose === 'none' ? '' : ' · ' + pose} · ${(step / 60).toFixed(2)} s · imagen final`;
    $('preview-label').textContent = transfer ? 'HDR crudo de Unreal · Filmic del laboratorio' : `Generador nativo · Filmic${order === 'reverse' ? ' · orden inverso (diagnóstico)' : ''}${subUV === 'clamp' ? ' · SubUV clamp (diagnóstico)' : ''}${DEPTH && pose !== 'none' && !fade ? ' · DepthFade de la llama apagado (diagnóstico)' : ''}`;
    Object.assign(state, { step, camera: view, order, subUV, pose, depthFade: fade, source: transfer ? 'transfer' : 'native', snapshot: frame,
      counts: [...particles.counts], stats: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        textures: renderer.info.memory.textures, generatedLutBytes: film.generatedBytes } });
    const [flame, flash, burst] = particles.counts;
    $('status').textContent = `${flame + flash + burst} partículas nativas (llama ${flame}, destello ${flash}, ráfaga ${burst}) · ${(step / 60).toFixed(2)} s · perfil SDR sRGB sin bloom`;
  }
  function select() {
    if (state.disposed) return;
    if ($('step').value === '0') { $('camera').value = 'front'; $('surface').value = 'none'; }
    $('camera').disabled = $('surface').disabled = $('step').value === '0';
    // A pose that does not exist for this view (the floor is oblique only) falls back to the control.
    if (DEPTH && !rowFor(Number($('step').value), $('camera').value, $('surface').value)) $('surface').value = 'none';
    $('use-ue-hdr').disabled = Number($('step').value) !== TRANSFER_STEP;
    draw();
  }
  const change = () => { try { select(); } catch (e) { state.errors.push(String(e)); $('status').textContent = e.message; } };
  for (const id of ['step', 'camera', 'order', 'subuv', 'use-ue-hdr', 'surface', 'fade']) $(id).onchange = change;
  $('reset').onclick = () => { $('step').value = String(TRANSFER_STEP); $('camera').value = 'front'; $('order').value = 'gate';
    $('subuv').value = 'wrap'; $('use-ue-hdr').checked = false; $('surface').value = 'none'; $('fade').checked = true; change(); };
  // pose and fade only act in the depth set; fade false is the diagnostic with the Flame's DepthFade off.
  state.select = async (step, view, order = 'gate', source = 'native', subUV = 'wrap', pose = 'none', fade = true) => {
    if (![0, ...STEPS].includes(step) || (pose !== 'none' && !(DEPTH && step !== 0 && rowFor(step, view, pose))) || typeof fade !== 'boolean' || !Object.hasOwn(DRAW_ORDERS, order) || !['native', 'transfer'].includes(source) ||
        !SUBUV_POLICIES.includes(subUV) || (source === 'transfer' && step !== TRANSFER_STEP) || (step === 0 && view !== 'front'))
      throw new Error('Invalid BasicHit selection');
    $('step').value = String(step); $('camera').value = view; $('order').value = order; $('subuv').value = subUV;
    $('use-ue-hdr').checked = source === 'transfer';
    $('surface').value = pose; $('fade').checked = fade;
    select();
  };
  state.dispose = () => { if (state.disposed) return; state.disposed = true;
    particles.dispose(); textures.forEach(t => t?.dispose()); bitmaps.forEach(b => b.close()); film.texture.dispose(); hdr.dispose(); stage?.dispose();
    linear.forEach(t => t.dispose()); quad.geometry.dispose(); filmMaterial.dispose(); renderer.dispose(); state.ready = false;
    state.resourcesAfterDispose = { ...renderer.info.memory }; };
  window.addEventListener('pagehide', state.dispose, { once: true });
  select(); state.ready = true;
} catch (e) { state.errors.push(String(e)); $('status').textContent = `No se pudo abrir BasicHit: ${e.message}`; console.error(e); }
