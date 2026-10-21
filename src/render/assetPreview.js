import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { worldToon } from './assets/toonmat.js';
import { U } from './toon.js';
import { stage } from '../ui/stage.js';

export function requireSelfContainedGlb(data) {
  const view = new DataView(data);
  if (data.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.byteLength) throw new Error('AW01 requiere un GLB 2.0 completo.');
  let document;
  for (let offset = 12; offset + 8 <= data.byteLength;) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true), end = offset + 8 + length;
    if (end > data.byteLength) throw new Error('Chunk GLB incompleto.');
    if (type === 0x4e4f534a) document = JSON.parse(new TextDecoder().decode(new Uint8Array(data, offset + 8, length)).replace(/[\s\0]+$/g, ''));
    offset = end;
  }
  if (!document) throw new Error('El GLB no contiene una escena declarada.');
  if ([...(document.images || []), ...(document.buffers || [])].some(value => value.uri && !value.uri.startsWith('data:'))) throw new Error('El derivado tiene dependencias externas. Debe prepararse como GLB autocontenido.');
}

// Each selection owns its resources. No registry fallback or persistent model cache.
export function releaseAssetObject(root) {
  if (!root) return;
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  root.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    if (node.skeleton) skeletons.add(node.skeleton);
    for (const mat of [node.material, node.userData?.awBase, node.userData?.awToon, node.userData?.awDiagnostic, node.userData?.awWireframe].flat().filter(Boolean)) {
      materials.add(mat);
      for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
    }
  });
  root.removeFromParent();
  skeletons.forEach(value => value.dispose()); geometries.forEach(value => value.dispose());
  materials.forEach(value => value.dispose()); textures.forEach(value => { value.dispose(); value.source?.data?.close?.(); });
}

export class AssetPreview {
  constructor({ renderer, viewport, onState = () => {} }) {
    Object.assign(this, { renderer, viewport, onState });
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#14232b');
    this.camera = new THREE.PerspectiveCamera(38, 1, .05, 100);
    this.scene.add(new THREE.HemisphereLight(0xc9e8f3, 0x443b31, 2.2));
    this.sun = new THREE.DirectionalLight(0xffe3ba, 3); this.sun.position.set(4, 8, 5); this.scene.add(this.sun);
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.MeshStandardMaterial({ color: 0x20353a, roughness: 1 }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -.03; this.scene.add(this.floor);
    this.grid = new THREE.GridHelper(12, 24, 0x587176, 0x2b4449); this.grid.position.y = -.01; this.scene.add(this.grid);
    this.epoch = 0; this.yaw = .6; this.pitch = .48; this.distance = 7.4;
    this.mode = 'pbr'; this.rotating = false; this.disposed = false; this.state = { status: 'idle' };
    this.events = new AbortController(); const options = { signal: this.events.signal };
    viewport.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      viewport.setPointerCapture(e.pointerId); e.preventDefault();
    }, options);
    viewport.addEventListener('pointermove', e => {
      if (this.drag?.id !== e.pointerId) return;
      const delta = stage.vec(e.clientX - this.drag.x, e.clientY - this.drag.y);
      this.yaw -= delta.x * .009; this.pitch = THREE.MathUtils.clamp(this.pitch + delta.y * .007, .08, 1.4);
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    }, options);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(name, () => { this.drag = null; }, options);
    viewport.addEventListener('wheel', e => {
      this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * .01, 3.5, 16); e.preventDefault();
    }, { ...options, passive: false });
  }

  notify(state) { this.state = state; this.onState(state); }
  clear() { this.abort?.abort(); this.epoch++; releaseAssetObject(this.object); this.object = null; this.metrics = null; }
  async select(entry, quality = 'desktop', variantId = 'base') {
    this.clear(); const epoch = this.epoch;
    const descriptor = entry.variants?.find(v => v.id === variantId)?.preview || entry.preview;
    const source = descriptor?.[quality];
    if (!source?.url) { this.notify({ status: 'pending', message: entry.limitations?.join(' ') || 'Preparación pendiente. Esta pieza todavía no tiene un derivado navegable.' }); return; }
    this.abort = new AbortController(); const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(45000)]);
    this.notify({ status: 'loading', url: source.url, quality });
    let root;
    try {
      const url = new URL(source.url, document.baseURI);
      if (url.origin !== location.origin) throw new Error('El visor solo acepta derivados de este catálogo local.');
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`Descarga HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      if (source.bytes && data.byteLength !== source.bytes) throw new Error('El tamaño del derivado cambió; necesita volver a prepararse.');
      if (/^[a-f0-9]{64}$/.test(source.sha256 || '') && globalThis.crypto?.subtle) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('');
        if (hash !== source.sha256) throw new Error('El hash del derivado no coincide con el recibo.');
      }
      if (signal.aborted || epoch !== this.epoch) return;
      let textureDimensions = [];
      if (['texture', 'material', 'icon'].includes(descriptor.kind)) {
        const blob = new Blob([data], { type: response.headers.get('content-type') || 'image/webp' });
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
        const texture = new THREE.Texture(bitmap); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true; texture.flipY = false;
        const mat = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: .85, transparent: descriptor.kind === 'icon' || entry.type === 'icon' });
        const geometry = descriptor.kind === 'material' ? new THREE.SphereGeometry(1.6, 40, 28) : new THREE.PlaneGeometry(3.7, 3.7 * bitmap.height / bitmap.width);
        root = new THREE.Group(); const mesh = new THREE.Mesh(geometry, mat); mesh.position.y = 1.9; root.add(mesh);
        textureDimensions = [{ width: bitmap.width, height: bitmap.height }];
      } else {
        requireSelfContainedGlb(data);
        const gltf = await new GLTFLoader().parseAsync(data, new URL('.', url).href);
        root = gltf.scene;
        if (gltf.animations?.length) root.userData.awClips = gltf.animations.length;
        const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
        if (box.isEmpty() || !size.toArray().every(Number.isFinite)) throw new Error('Malla vacía o bounds inválidos.');
        root.userData.awSourceBounds = size.toArray();
        const scale = 4 / Math.max(size.x, size.y, size.z, .001); root.scale.multiplyScalar(scale);
        const fit = new THREE.Box3().setFromObject(root), center = fit.getCenter(new THREE.Vector3());
        root.position.add(new THREE.Vector3(-center.x, -fit.min.y, -center.z));
      }
      if (signal.aborted || epoch !== this.epoch || this.disposed) { releaseAssetObject(root); return; }
      const textures = new Set(), geometries = new Set(); let triangles = 0, materialCount = 0;
      root.traverse(node => {
        if (!node.isMesh) return;
        const mats = Array.isArray(node.material) ? node.material : [node.material]; materialCount += mats.length;
        node.userData.awBase = node.material;
        const converted = mats.map(mat => {
          Object.values(mat).filter(v => v?.isTexture).forEach(texture => textures.add(texture));
          const converted = worldToon(mat, { toon: { sat: 1, bright: 1, posterize: 0, comic: false, occluder: false, rim: false, normal: true } });
          converted.nm.dispose(); return converted.mat;
        });
        node.userData.awToon = Array.isArray(node.material) ? converted : converted[0];
        const diagnostic = mats.map(() => new THREE.MeshStandardMaterial({ color: 0xb8c4c3, roughness: .65, side: THREE.DoubleSide }));
        const wireframe = mats.map(() => new THREE.MeshBasicMaterial({ color: 0x91d5bd, wireframe: true }));
        node.userData.awDiagnostic = Array.isArray(node.material) ? diagnostic : diagnostic[0];
        node.userData.awWireframe = Array.isArray(node.material) ? wireframe : wireframe[0];
        geometries.add(node.geometry); triangles += (node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3;
      });
      textureDimensions = [...textures].map(t => ({ width: t.image?.width || 0, height: t.image?.height || 0 }));
      this.metrics = { url: source.url, quality, bytes: data.byteLength, triangles: Math.round(triangles), materialCount,
        textureDimensions, estimatedTextureBytes: textureDimensions.reduce((sum, t) => sum + t.width * t.height * 4 * 4 / 3, 0),
        sourceBounds: root.userData.awSourceBounds, clips: root.userData.awClips || 0, geometryCount: geometries.size };
      this.object = root; this.scene.add(root); this.resetCamera();
      this.notify({ status: 'ready', ...this.metrics });
    } catch (error) {
      if (root && root !== this.object) releaseAssetObject(root);
      if (epoch !== this.epoch || this.disposed) return;
      this.notify({ status: 'error', message: error.name === 'TimeoutError' ? 'La preparación tardó demasiado en cargar. Puedes reintentar.' : error.message });
    }
  }
  resetCamera() { this.yaw = .6; this.pitch = .48; this.distance = 7.4; }
  gameCamera() { this.yaw = Math.PI / 4; this.pitch = .76; this.distance = 11.5; }
  setLight(value) { this.sun.intensity = value === 'soft' ? 1 : 3; this.sun.color.set(value === 'soft' ? 0xd2edff : 0xffe3ba); }
  setMaterial(mode) {
    const key = { toon: 'awToon', geometry: 'awDiagnostic', wireframe: 'awWireframe' }[mode] || 'awBase';
    this.object?.traverse(node => { if (node.isMesh) node.material = node.userData[key]; });
  }
  render(dt = 0) {
    if (this.disposed || document.hidden) return;
    if (this.rotating && !this.drag) this.yaw += Math.min(dt, .1) * .25;
    const rect = this.viewport.getBoundingClientRect(), p = stage.toLocal(stage.rotated ? rect.right : rect.left, rect.top);
    const width = stage.rotated ? rect.height : rect.width, height = stage.rotated ? rect.width : rect.height;
    if (width < 2 || height < 2) return;
    const r = this.renderer, size = r.getSize(new THREE.Vector2());
    const old = { target: r.getRenderTarget(), viewport: r.getViewport(new THREE.Vector4()), scissor: r.getScissor(new THREE.Vector4()), test: r.getScissorTest(), color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha(), autoClear: r.autoClear,
      cloud: U.mnCloud.value, count: U.mnLightCount.value, glow: U.mnGlowOut.value, occlusion: U.mnOccOn.value };
    try {
      U.mnCloud.value = 0; U.mnLightCount.value = 0; U.mnGlowOut.value = 0; U.mnOccOn.value = 0;
      r.setRenderTarget(null); r.setScissorTest(false); r.setViewport(0, 0, size.x, size.y); r.setClearColor(0x0c181f, 1); r.clear();
      r.setScissorTest(true); r.autoClear = true;
      const panels = this.mode === 'compare' ? ['pbr', 'toon'] : [this.mode];
      let calls = 0;
      panels.forEach((mode, i) => {
        const w = width / panels.length;
        r.setViewport(p.x + w * i, size.y - p.y - height, w, height); r.setScissor(p.x + w * i, size.y - p.y - height, w, height);
        this.camera.aspect = w / height; this.camera.updateProjectionMatrix();
        const distance = this.distance * (this.camera.aspect < .8 ? 1.45 : 1);
        const h = distance * Math.cos(this.pitch);
        this.camera.position.set(Math.sin(this.yaw) * h, 1.8 + distance * Math.sin(this.pitch), Math.cos(this.yaw) * h);
        this.camera.lookAt(0, 1.8, 0); this.setMaterial(mode);
        const before = r.info.render.calls; r.render(this.scene, this.camera);
        calls += r.info.autoReset ? r.info.render.calls : r.info.render.calls - before;
      });
      this.drawCalls = calls;
    } finally {
      r.setRenderTarget(old.target); r.setViewport(old.viewport); r.setScissor(old.scissor); r.setScissorTest(old.test); r.setClearColor(old.color, old.alpha); r.autoClear = old.autoClear;
      U.mnCloud.value = old.cloud; U.mnLightCount.value = old.count; U.mnGlowOut.value = old.glow; U.mnOccOn.value = old.occlusion;
    }
  }
  dispose() { this.disposed = true; this.events.abort(); this.clear(); releaseAssetObject(this.floor); releaseAssetObject(this.grid); this.scene.clear(); }
}
