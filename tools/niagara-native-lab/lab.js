import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { PilotParticles, toScene, validateFrame } from './particles.js';
import { UpdateSimulation, CONTROL_SPEC } from './update-simulation.js';
import { NativeSimulation, CONTROL_SPEC as NATIVE_CONTROLS } from './native-simulation.js';
import { SOURCE_PRESET_SHA256 } from './source-identity.js';

const $ = id => document.getElementById(id);
const run = new URLSearchParams(location.search).get('run') || 'reference11';
if (!/^[a-zA-Z0-9_-]{1,40}$/.test(run)) throw new Error('Invalid local capture name');
const base = `/.scratch/unreal/${run}/`;
const state = { ready: false, errors: [], playing: false, frame: 120, freeCamera: false, yaw: 0, pitch: 0,
  mode: ['update', 'native'].includes(new URLSearchParams(location.search).get('mode')) ? new URLSearchParams(location.search).get('mode') : 'observed' };
window.pilot = state;

try {
  const read = async path => {
    const r = await fetch(base + path);
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  };
  const report = await read('capture-report.json');
  if (report.status !== 'complete' || report.source_copy_package_sha256 !==
      '985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165' ||
      report.particle_samples?.length !== 241 || report.renderer_textures?.length !== 2 || report.images?.length !== 15)
    throw new Error('Incomplete or unexpected pilot capture');
  let frames, simulation, nativeSimulation;
  const currentSimulation = () => state.mode === 'native' ? nativeSimulation : simulation;
  const readFrames = () => Promise.all(report.particle_samples.map((row, step) => {
    if (row.step !== step || row.file !== `particles/step_${String(step).padStart(4, '0')}.json`)
      throw new Error('Invalid sample sequence');
    return read(row.file).then(validateFrame);
  }));
  async function loadMode(mode) {
    if (mode === 'observed' && !frames) frames = await readFrames();
    if (mode === 'update' && !simulation) simulation = new UpdateSimulation(await read('update-fixture.json'));
    if (mode === 'native' && !nativeSimulation) {
      const r = await fetch('./pilot-source.json');
      if (!r.ok) throw new Error(`Native source: HTTP ${r.status}`);
      const bytes = await r.arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
      if (digest !== SOURCE_PRESET_SHA256) throw new Error('Native source hash mismatch');
      nativeSimulation = new NativeSimulation(JSON.parse(new TextDecoder().decode(bytes)));
    }
    state.mode = mode;
    $('mode').value = mode;
    $('time').max = mode === 'observed' ? 240 : 480;
    $('time').value = Math.min(Number($('time').value), Number($('time').max));
    $('update-controls').hidden = mode === 'observed';
    $('control-intro').textContent = mode === 'native'
      ? 'Nacimientos, posiciones, tamaño, color, movimiento y vida se generan aquí desde las fórmulas del piloto. Rangos experimentales del laboratorio.'
      : 'Vida, movimiento, desvanecimiento y atlas se calculan aquí. Los 50 nacimientos conservan sus tiempos y estados originales de Unreal. Rangos experimentales del laboratorio.';
    $('control-note').textContent = mode === 'native'
      ? 'La emisión local continúa hasta 8 s. Semilla 6371: misma fixture determinista de Unreal; otra semilla cambia la distribución.'
      : 'El registro incluye nacimientos observados hasta los 4 s. La vista continúa hasta 8 s para ver cómo desaparecen las partículas.';
    $('preview-label').textContent = mode === 'native' ? 'Three.js · generación y evolución local'
      : mode === 'update' ? 'Three.js · evolución calculada aquí' : 'Three.js · atributos 3D observados';
    if (mode !== 'observed') renderControls();
  }
  await loadMode(state.mode);
  const loader = new THREE.TextureLoader();
  const textures = await Promise.all(report.renderer_textures.map(async row => {
    const texture = await loader.loadAsync(base + row.file);
    texture.colorSpace = row.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }));
  const linearReferences = new Map(await Promise.all(report.images.filter(row => row.linear).map(async row =>
    [row.camera, await new RGBELoader().loadAsync(base + row.linear.file)])));
  $('linear-reference').disabled = linearReferences.size !== 3;
  const renderer = new THREE.WebGLRenderer({ canvas: $('preview'), antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(512, 512, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
  const width = report.settings.orthographic_width_cm / 100;
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, width / 2, -width / 2, .01, 100);
  const particles = new PilotParticles(scene, textures);
  // Blend translucent layers in linear HDR, then map the assembled image once.
  const hdr = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: true });
  hdr.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const outputScene = new THREE.Scene();
  const outputCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const outputMaterial = new THREE.ShaderMaterial({
    uniforms: { image: { value: hdr.texture }, exposure: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `uniform sampler2D image; uniform float exposure; varying vec2 vUv;
      void main(){gl_FragColor=vec4(texture2D(image,vUv).rgb*exposure,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false
  });
  const outputQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), outputMaterial);
  outputScene.add(outputQuad);
  renderer.info.autoReset = false;
  const target = new THREE.Vector3(...toScene(report.settings.target_cm));
  let raf, last = 0, accumulator = 0;
  function draw() {
    state.frame = Number($('time').value);
    $('clock').textContent = (state.frame / 60).toFixed(2) + ' s';
    const view = $('camera').value;
    const images = report.images.filter(row => row.camera === view);
    const reference = images.reduce((a, b) => Math.abs(a.step - state.frame) <= Math.abs(b.step - state.frame) ? a : b);
    const source = base + reference.file;
    const compareLinear = $('linear-reference').checked;
    if (!compareLinear && !$('reference').src.endsWith(source)) $('reference').src = source;
    $('reference-label').textContent = compareLinear ? 'Unreal · RGB lineal con la misma presentación de color' : 'Unreal · captura de referencia original';
    if (state.freeCamera) {
      const d = 5;
      camera.position.set(target.x + Math.sin(state.yaw) * Math.cos(state.pitch) * d,
        target.y + Math.sin(state.pitch) * d, target.z + Math.cos(state.yaw) * Math.cos(state.pitch) * d);
    } else camera.position.set(...toScene(reference.position_cm));
    camera.lookAt(target); camera.updateMatrixWorld();
    const frame = state.mode === 'observed' ? frames[state.frame] : currentSimulation().seek(state.frame);
    particles.update(frame, [$('flame').checked, $('smoke').checked]);
    state.particleSnapshot = frame;
    renderer.info.reset();
    renderer.setRenderTarget(hdr);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    outputMaterial.uniforms.exposure.value = Number($('exposure').value);
    renderer.toneMapping = $('tone').value === 'aces' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    if (compareLinear) {
      outputMaterial.uniforms.image.value = linearReferences.get(view);
      renderer.render(outputScene, outputCamera);
      $('reference').src = renderer.domElement.toDataURL();
      outputMaterial.uniforms.image.value = hdr.texture;
    }
    renderer.render(outputScene, outputCamera);
    state.count = particles.count;
    state.drawCalls = renderer.info.render.calls;
    state.triangles = renderer.info.render.triangles;
    state.textures = renderer.info.memory.textures;
    $('status').textContent = `${particles.count} partículas · ${state.drawCalls} llamadas de dibujo · Referencia izquierda: ${(reference.step / 60).toFixed(2)} s${state.freeCamera ? ' · cámara libre a la derecha' : ''}${state.mode === 'native' ? ' · Nacimientos y evolución locales' : state.mode === 'update' ? ' · Nacimientos de Unreal; evolución local' : ''}${state.frame > 240 ? ' · fuera de los 4 s de referencia' : ''}`;
  }
  function renderControls() {
    $('control-fields').replaceChildren();
    const specTable = state.mode === 'native' ? NATIVE_CONTROLS : CONTROL_SPEC;
    for (const [key, spec] of Object.entries(specTable)) {
      const wrapper = document.createElement('label'); wrapper.className = 'control';
      const title = document.createElement('span'); title.textContent = spec.label;
      const value = currentSimulation().options[key];
      const output = document.createElement('output'); output.textContent = `${value} ${spec.unit}`;
      const input = document.createElement('input'); input.type = 'range'; input.id = key;
      input.min = spec.min; input.max = spec.max; input.step = spec.step; input.value = value;
      input.setAttribute('aria-label', spec.label);
      const help = document.createElement('small'); help.id = `${key}-help`; help.textContent = spec.help;
      input.setAttribute('aria-describedby', help.id);
      wrapper.append(title, output, input, help); $('control-fields').append(wrapper);
      input.oninput = () => {
        output.textContent = `${input.value} ${spec.unit}`;
        currentSimulation().configure(Object.fromEntries(Object.keys(specTable).map(k => [k, Number($(k).value)])));
        draw();
      };
    }
  }
  $('reset-update').onclick = () => {
    currentSimulation().configure(); renderControls(); draw();
  };
  $('mode').onchange = async () => {
    state.playing = false; $('play').textContent = 'Reproducir'; $('mode').disabled = true;
    try { await loadMode($('mode').value); draw(); }
    catch (error) { state.errors.push(String(error)); $('status').textContent = error.message; $('mode').value = state.mode; }
    finally { $('mode').disabled = false; }
  };
  $('play').onclick = () => { state.playing = !state.playing; $('play').textContent = state.playing ? 'Pausar' : 'Reproducir'; };
  for (const id of ['time', 'flame', 'smoke', 'exposure', 'tone']) $(id).oninput = draw;
  $('camera').onchange = () => { state.freeCamera = false; draw(); };
  $('linear-reference').onchange = () => {
    state.playing = false; $('play').textContent = 'Reproducir';
    $('time').disabled = $('play').disabled = $('linear-reference').checked;
    if ($('linear-reference').checked) { $('time').value = 120; state.freeCamera = false; }
    draw();
  };
  let drag;
  $('preview').onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; e.target.setPointerCapture(e.pointerId); };
  $('preview').onpointermove = e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!state.freeCamera) {
      const offset = camera.position.clone().sub(target);
      state.yaw = Math.atan2(offset.x, offset.z); state.pitch = Math.asin(offset.y / offset.length());
    }
    state.freeCamera = true; state.yaw -= (e.clientX - drag.x) * .01;
    state.pitch = THREE.MathUtils.clamp(state.pitch + (e.clientY - drag.y) * .01, -1.2, 1.2);
    drag.x = e.clientX; drag.y = e.clientY; draw();
  };
  $('preview').onpointerup = $('preview').onpointercancel = () => { drag = null; };
  function tick(now) {
    if (state.playing && last) {
      accumulator += Math.min((now - last) / 1000, .1);
      while (accumulator >= 1 / 60) {
        $('time').value = Number($('time').value) % Number($('time').max) + 1; accumulator -= 1 / 60;
      }
      draw();
    }
    last = now; raf = requestAnimationFrame(tick);
  }
  state.seek = step => { $('time').value = step; draw(); };
  state.setCamera = view => { $('camera').value = view; state.freeCamera = false; draw(); };
  state.dispose = () => {
    cancelAnimationFrame(raf); particles.dispose(); textures.forEach(t => t.dispose());
    linearReferences.forEach(t => t.dispose());
    hdr.dispose(); outputQuad.geometry.dispose(); outputMaterial.dispose(); renderer.dispose(); state.ready = false;
    state.resourcesAfterDispose = { ...renderer.info.memory };
  };
  window.addEventListener('pagehide', state.dispose, { once: true });
  draw(); state.ready = true; raf = requestAnimationFrame(tick);
} catch (error) {
  state.errors.push(String(error)); $('status').textContent = `No se pudo abrir la captura: ${error.message}`;
  console.error(error);
}
