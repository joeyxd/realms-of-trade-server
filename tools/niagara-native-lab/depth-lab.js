import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { PilotParticles, toScene } from '../../src/render/vfx/niagara/particles.js';
import { NativeSimulation } from './native-simulation.js';
import { SOURCE_PRESET_SHA256 } from './source-identity.js';
import { DepthStage } from '../../src/render/vfx/niagara/depth-stage.js';

const $ = id => document.getElementById(id);
const run = new URLSearchParams(location.search).get('run') || 'depth02';
if (!/^[a-zA-Z0-9_-]{1,40}$/.test(run)) throw new Error('Invalid depth run');
const base = `/.scratch/unreal/${run}/`;
const state = { ready: false, errors: [], freeCamera: false };
window.depthLab = state;
try {
  const getJson = async path => { const r = await fetch(path); if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`); return r.json(); };
  const report = await getJson(base + 'depth-report.json');
  if (report.schema !== 'st01c-depth-reference/v1' || report.status !== 'complete' || report.images?.length !== 22 ||
      report.settings.depth_fade_cm !== 100 || report.settings.custom_projection !== false ||
      report.source_sha256 !== '985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165')
    throw new Error('Unexpected depth reference');
  for (const row of report.images) if (!/^(none|wall-25|wall0|wall50|wall150|floor|calibration-25|calibration0|calibration25|calibration50|calibration100|calibration150)_(front|side|oblique)\.hdr$/.test(row.file)) throw new Error('Invalid reference path');
  const r = await fetch('./pilot-source.json'); if (!r.ok) throw new Error('Source preset missing');
  const bytes = await r.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (digest !== SOURCE_PRESET_SHA256) throw new Error('Source preset hash mismatch');
  const simulation = new NativeSimulation(JSON.parse(new TextDecoder().decode(bytes)));
  const snapshot = simulation.seek(120);
  const sourceReport = await getJson('/.scratch/unreal/reference11/capture-report.json');
  const textures = await Promise.all(sourceReport.renderer_textures.map(async row => {
    const t = await new THREE.TextureLoader().loadAsync('/.scratch/unreal/reference11/' + row.file);
    t.colorSpace = row.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  }));
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  const renderer = new THREE.WebGLRenderer({ canvas: $('preview'), antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(512, 512, false);
  renderer.info.autoReset = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .01, 100);
  const target = new THREE.Vector3(...toScene([0, 0, 100]));
  const particles = new PilotParticles(scene, textures);
  const depth = new DepthStage();
  const hdr = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: true });
  hdr.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const outputScene = new THREE.Scene(), outputCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.ShaderMaterial({ uniforms: { image: { value: hdr.texture } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `uniform sampler2D image;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(image,vUv).rgb,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); outputScene.add(quad);
  const references = new Map(), pendingReferences = new Map();
  let calibration, epoch = 0, yaw = 0, pitch = 0;
  const rowFor = (name, view) => report.images.find(row => row.case === name && row.camera === view);
  function draw() {
    if (state.disposed) return;
    const name = calibration === undefined ? $('surface').value : 'calibration' + calibration;
    const view = calibration === undefined ? $('camera').value : 'front';
    const row = rowFor(name, view) || rowFor(name, 'oblique');
    // Keep authored geometry fixed in the reference world when orbiting the camera.
    camera.position.set(...toScene(row.position_cm));
    depth.configure(name === 'none' ? 'none' : name === 'floor' ? 'floor' : 'wall', row.gap_cm || 0, camera, target);
    if (state.freeCamera) camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * 5,
      target.y + Math.sin(pitch) * 5, target.z + Math.cos(yaw) * Math.cos(pitch) * 5);
    camera.lookAt(target); camera.updateMatrixWorld();
    const frame = calibration === undefined ? snapshot : { schema: 'st01c-native-frame/v1', systemAge: 2,
      emitters: ['NE_Flame_Basic_001', 'NE_Smoke_Basic'].map((name, i) => ({ name, particles: i ? [] : [{
        position: [0, 0, 100], size: [100, 100], color: [1, 1, 1, 1], rotation: 0, subImage: 0 }] })) };
    particles.layers[0].material.uniforms.atlas.value = calibration === undefined ? textures[0] : white;
    particles.update(frame, calibration === undefined ? [$('flame').checked, $('smoke').checked] : [true, false]);
    renderer.info.reset(); renderer.toneMapping = THREE.NoToneMapping;
    depth.render(renderer, camera, hdr, scene, particles, $('fade').checked);
    renderer.setRenderTarget(null); renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if (references.has(row.file)) {
      material.uniforms.image.value = references.get(row.file); renderer.render(outputScene, outputCamera);
      $('reference').src = renderer.domElement.toDataURL();
    }
    material.uniforms.image.value = hdr.texture; renderer.render(outputScene, outputCamera);
    state.count = particles.count; state.snapshot = frame; state.case = name; state.camera = view;
    state.stats = { calls: renderer.info.render.calls, textures: renderer.info.memory.textures };
    $('reference-label').textContent = `Unreal · ${row.camera} · 2 s`;
    $('status').textContent = `${particles.count} partículas · ${$('fade').checked ? 'contacto suave' : 'desvanecimiento desactivado'}${state.freeCamera ? ' · cámara libre a la derecha' : ''}`;
  }
  async function select() {
    if (state.disposed) return;
    const ticket = ++epoch;
    const name = calibration === undefined ? $('surface').value : 'calibration' + calibration;
    if (name === 'floor') $('camera').value = 'oblique';
    const view = calibration === undefined ? $('camera').value : 'front';
    const row = rowFor(name, view);
    if (!row) throw new Error('Unknown depth case');
    if (!references.has(row.file)) {
      if (!pendingReferences.has(row.file)) pendingReferences.set(row.file,
        new RGBELoader().loadAsync(base + row.file).then(texture => {
          if (state.disposed) texture.dispose();
          else references.set(row.file, texture);
        }).finally(() => pendingReferences.delete(row.file)));
      await pendingReferences.get(row.file);
      if (state.disposed) return;
    }
    if (ticket === epoch) { state.freeCamera = false; draw(); }
  }
  const change = () => { calibration = undefined; select().catch(e => { state.errors.push(String(e)); $('status').textContent = e.message; }); };
  $('surface').onchange = $('camera').onchange = change;
  for (const id of ['fade', 'flame', 'smoke']) $(id).onchange = draw;
  $('reset').onclick = () => { $('surface').value = 'wall50'; $('camera').value = 'oblique';
    for (const id of ['fade', 'flame', 'smoke']) $(id).checked = true; change(); };
  let drag;
  $('preview').onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; e.target.setPointerCapture(e.pointerId); };
  $('preview').onpointermove = e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!state.freeCamera) { const v = camera.position.clone().sub(target); yaw = Math.atan2(v.x, v.z); pitch = Math.asin(v.y / v.length()); }
    state.freeCamera = true; yaw -= (e.clientX - drag.x) * .01; pitch = THREE.MathUtils.clamp(pitch + (e.clientY - drag.y) * .01, -1.2, 1.2);
    drag.x = e.clientX; drag.y = e.clientY; draw();
  };
  $('preview').onpointerup = $('preview').onpointercancel = () => { drag = null; };
  state.select = async (name, view) => { calibration = undefined; $('surface').value = name; $('camera').value = view; await select(); };
  state.calibrate = async gap => { if (![-25, 0, 25, 50, 100, 150].includes(gap)) throw new Error('Unsupported calibration gap'); calibration = gap; await select(); };
  state.linearCenter = () => { const pixel = new Uint16Array(4); renderer.readRenderTargetPixels(hdr, 256, 256, 1, 1, pixel); return Array.from(pixel.slice(0, 3), THREE.DataUtils.fromHalfFloat); };
  state.dispose = () => { if (state.disposed) return; state.disposed = true; ++epoch; particles.dispose(); depth.dispose(); hdr.dispose();
    textures.forEach(t => t.dispose()); white.dispose(); references.forEach(t => t.dispose());
    quad.geometry.dispose(); material.dispose(); renderer.dispose(); state.ready = false;
    state.resourcesAfterDispose = { ...renderer.info.memory }; };
  window.addEventListener('pagehide', state.dispose, { once: true });
  await select(); state.ready = true;
} catch (e) { state.errors.push(String(e)); $('status').textContent = `No se pudo abrir la comparación: ${e.message}`; console.error(e); }
