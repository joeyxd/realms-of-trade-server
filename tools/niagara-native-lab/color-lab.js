import * as THREE from 'three';
import { PilotParticles, toScene } from '../../src/render/vfx/niagara/particles.js';
import { NativeSimulation } from '../../src/render/vfx/niagara/native-simulation.js';
import { SOURCE_PRESET_SHA256 } from '../../src/render/vfx/niagara/source-identity.js';
import { FILM_SOURCE_SHA256 } from '../../src/render/vfx/niagara/film-identity.js';
import { createFilmLUT, filmFragment } from '../../src/render/vfx/niagara/film-color.js';
const $ = id => document.getElementById(id);
const run = new URLSearchParams(location.search).get('run') || 'color07';
if (!/^[a-zA-Z0-9_-]{1,40}$/.test(run)) throw new Error('Invalid color run');
const base = `/.scratch/unreal/${run}/`;
const state = { ready: false, errors: [] }; window.colorLab = state;
try {
  const getJson = async path => { const r = await fetch(path); if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`); return r.json(); };
  async function pinned(path, hash) {
    const r = await fetch(path); if (!r.ok) throw new Error('Missing source preset');
    const bytes = await r.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    if (digest !== hash) throw new Error('Source preset hash mismatch');
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const report = await getJson(base+'color-report.json');
  if (report.schema !== 'st01c-color-reference/v1' || report.status !== 'complete' || report.images?.length !== 8 || report.chart?.length !== 48 ||
      report.settings.ldr_target_gamma !== 2.2 || report.settings.pre_exposure_override !== 1 ||
      report.source_sha256 !== '985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165') throw new Error('Unexpected color reference');
  for (const row of report.images) for (const f of Object.values(row.files))
    if (!/^(pilot|chart)EV[01]_(front|side|oblique)_(ldr\.png|hdr\.hdr|hdr\.rgba16f)$/.test(f.file)) throw new Error('Invalid reference path');
  for (const row of report.chart) if (row.rgb?.length !== 3 || !row.rgb.every(v => Number.isFinite(v) && v >= 0 && v <= 40)) throw new Error('Invalid chart');
  const film = createFilmLUT(await pinned('../../src/render/vfx/niagara/film-source.json', FILM_SOURCE_SHA256));
  const simulation = new NativeSimulation(await pinned('../../src/render/vfx/niagara/pilot-source.json', SOURCE_PRESET_SHA256));
  const snapshot = simulation.seek(120);
  const sourceReport = await getJson('/.scratch/unreal/reference11/capture-report.json');
  const textures = await Promise.all(sourceReport.renderer_textures.map(async row => {
    const t = await new THREE.TextureLoader().loadAsync('/.scratch/unreal/reference11/'+row.file);
    t.colorSpace = row.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t;
  }));
  const renderer = new THREE.WebGLRenderer({ canvas: $('preview'), antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(512, 512, false); renderer.info.autoReset = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
  const chartScene = new THREE.Scene(); chartScene.background = new THREE.Color(0);
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .01, 100);
  const target = new THREE.Vector3(...toScene([0, 0, 100]));
  const particles = new PilotParticles(scene, textures); particles.update(snapshot);
  const chartMeshes = report.chart.map((row, i) => {
    const color = new THREE.Color().setRGB(...row.rgb, THREE.LinearSRGBColorSpace);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(.4, .4), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false }));
    mesh.position.set(...toScene([0, 175-50*(i%8), 225-50*Math.floor(i/8)])); mesh.rotation.y = Math.PI;
    chartScene.add(mesh); return mesh;
  });
  const hdr = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: true });
  hdr.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const outputScene = new THREE.Scene(), outputCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = { image: { value: hdr.texture }, exposure: { value: 1 }, filmLUT: { value: film.texture } };
  const filmMaterial = new THREE.ShaderMaterial({ uniforms, glslVersion: THREE.GLSL3, toneMapped: false,
    vertexShader: 'out vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: filmFragment,
    depthTest: false, depthWrite: false });
  const previousMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `uniform sampler2D image;uniform float exposure;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(image,vUv).rgb*exposure,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), filmMaterial); outputScene.add(quad);
  const references = new Map(), pending = new Map(); let epoch = 0;
  function rowFor() { return report.images.find(row => row.case === $('case').value+'EV'+$('bias').value && row.camera === $('camera').value); }
  function draw() {
    if (state.disposed) return;
    const row = rowFor(); camera.position.set(...toScene(row.position_cm)); camera.lookAt(target); camera.updateMatrixWorld();
    renderer.info.reset(); renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(hdr); renderer.render($('case').value === 'chart' ? chartScene : scene, camera);
    renderer.setRenderTarget(null);
    uniforms.image.value = $('use-ue-hdr').checked ? references.get(row.files.raw.file) : hdr.texture;
    uniforms.exposure.value = 2**Number($('bias').value);
    quad.material = $('tone').value === 'film' ? filmMaterial : previousMaterial;
    renderer.toneMapping = $('tone').value === 'aces' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    renderer.render(outputScene, outputCamera);
    $('reference').src = base+row.files.ldr.file;
    $('reference-label').textContent = `Unreal · ${row.camera} · ${$('bias').value} EV · 2 s`;
    $('preview-label').textContent = `${$('use-ue-hdr').checked ? 'RGB de Unreal' : 'Generador propio'} · ${$('tone').selectedOptions[0].textContent}`;
    state.case = $('case').value; state.camera = $('camera').value; state.bias = Number($('bias').value);
    state.snapshot = snapshot; state.chart = report.chart;
    state.stats = { calls: renderer.info.render.calls, textures: renderer.info.memory.textures, generatedLutBytes: film.generatedBytes };
    $('status').textContent = `${state.case === 'chart' ? '48 muestras de color' : '22 partículas nativas'} · ${state.bias} EV · perfil SDR sRGB sin bloom`;
  }
  async function select() {
    if (state.disposed) return;
    const ticket = ++epoch;
    if ($('case').value === 'chart') $('camera').value = 'front';
    $('camera').disabled = $('case').value === 'chart';
    const row = rowFor(); if (!row) throw new Error('Unknown color case');
    const name = row.files.raw.file;
    if (!references.has(name)) {
      if (!pending.has(name)) pending.set(name, fetch(base+name).then(async r => {
        if (!r.ok) throw new Error('Missing raw HDR');
        const bytes = await r.arrayBuffer(); if (bytes.byteLength !== 512*512*8) throw new Error('Invalid raw HDR size');
        const t = new THREE.DataTexture(new Uint16Array(bytes), 512, 512, THREE.RGBAFormat, THREE.HalfFloatType);
        t.flipY = true; t.needsUpdate = true; t.colorSpace = THREE.LinearSRGBColorSpace;
        if (state.disposed) t.dispose(); else references.set(name, t);
      }).finally(() => pending.delete(name)));
      await pending.get(name);
    }
    if (ticket === epoch && !state.disposed) draw();
  }
  const change = () => select().catch(e => { state.errors.push(String(e)); $('status').textContent = e.message; });
  for (const id of ['case', 'camera', 'bias']) $(id).onchange = change;
  $('tone').onchange = $('use-ue-hdr').onchange = draw;
  $('reset').onclick = () => { $('case').value = 'pilot'; $('camera').value = 'oblique'; $('bias').value = '0'; $('tone').value = 'film'; $('use-ue-hdr').checked = false; change(); };
  state.select = async (kind, view, bias = 0) => { $('case').value = kind; $('camera').value = view; $('bias').value = bias; await select(); };
  state.dispose = () => { if (state.disposed) return; state.disposed = true; ++epoch;
    particles.dispose(); textures.forEach(t => t.dispose()); film.texture.dispose(); hdr.dispose(); references.forEach(t => t.dispose());
    chartMeshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    quad.geometry.dispose(); filmMaterial.dispose(); previousMaterial.dispose(); renderer.dispose(); state.ready = false;
    state.resourcesAfterDispose = { ...renderer.info.memory }; };
  window.addEventListener('pagehide', state.dispose, { once: true });
  await select(); state.ready = true;
} catch (e) { state.errors.push(String(e)); $('status').textContent = `No se pudo abrir el color: ${e.message}`; console.error(e); }
