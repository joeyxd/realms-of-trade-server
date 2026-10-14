// Isolated renderer experiment. Observed or locally evolved attributes, never Niagara bytecode.
import * as THREE from 'three';

export const toScene = ([x, y, z]) => [y / 100, z / 100, -x / 100];
const LIMIT = 512;
const NAMES = ['NE_Flame_Basic_001', 'NE_Smoke_Basic'];
export function validateFrame(frame) {
  if (!frame || !['st01c-cpu-frame/v1', 'st01c-update-frame/v1', 'st01c-native-frame/v1'].includes(frame.schema) || frame.emitters?.length !== 2 ||
      !Number.isFinite(frame.systemAge) || frame.systemAge < 0) throw new Error('Invalid observed frame');
  for (let index = 0; index < 2; index++) {
    const emitter = frame.emitters[index];
    if (emitter.name !== NAMES[index] || !Array.isArray(emitter.particles) || emitter.particles.length > LIMIT)
      throw new Error('Unexpected emitter or particle bounds');
    for (const p of emitter.particles) {
      for (const [field, length] of [['position', 3], ['size', 2], ['color', 4]]) {
        if (!Array.isArray(p[field]) || p[field].length !== length || !p[field].every(Number.isFinite))
          throw new Error(`Invalid particle ${field}`);
      }
      if (!Number.isFinite(p.rotation) || !Number.isFinite(p.subImage) || p.subImage < 0 ||
          p.size.some(x => x < 0)) throw new Error('Invalid sprite attributes');
    }
  }
  return frame;
}
const vertexShader = `
attribute vec3 particlePosition;
attribute vec2 particleSize;
attribute vec4 particleColor;
attribute float particleRotation;
attribute float particleFrame;
varying vec2 atlasUv;
varying vec4 tint;
uniform vec2 grid;
void main() {
  // UE's sprite UV Y points down. Its positive rotation uses that down basis.
  float a = radians(particleRotation);
  vec2 q = position.xy * particleSize;
  q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
  vec4 center = viewMatrix * vec4(particlePosition, 1.0);
  gl_Position = projectionMatrix * (center + vec4(q, 0.0, 0.0));
  float frame = clamp(floor(particleFrame), 0.0, grid.x * grid.y - 1.0);
  atlasUv = vec2((mod(frame, grid.x) + uv.x) / grid.x,
    1.0 - (floor(frame / grid.x) + 1.0 - uv.y) / grid.y);
  tint = particleColor;
}`;
const fragmentShader = `
uniform sampler2D atlas;
uniform sampler2D opaqueDepth;
uniform vec2 depthSize;
uniform vec2 nearFar;
uniform bool orthographic;
uniform bool depthFadeEnabled;
varying vec2 atlasUv;
varying vec4 tint;
float viewDepth(float z) {
  return orthographic ? mix(nearFar.x, nearFar.y, z)
    : nearFar.x * nearFar.y / (nearFar.y - z * (nearFar.y - nearFar.x));
}
void main() {
  vec3 texel = texture2D(atlas, atlasUv).rgb;
  float fade = 1.0;
  if (depthFadeEnabled) {
    float sceneDepth = viewDepth(texture2D(opaqueDepth, gl_FragCoord.xy / depthSize).r);
    // Source DepthFade: saturate((opaque view depth - fragment view depth) / 100 cm).
    // Scene units are metres. This is axial separation, not Euclidean distance.
    fade = clamp((sceneDepth - viewDepth(gl_FragCoord.z)) / 1.0, 0.0, 1.0);
  }
  gl_FragColor = vec4(texel * tint.rgb, clamp(texel.r * tint.a, 0.0, 1.0) * fade);
}`;

export class PilotParticles {
  constructor(scene, textures) {
    this.layers = textures.map((texture, index) => {
      const plane = new THREE.PlaneGeometry(1, 1);
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.index = plane.index.clone();
      geometry.setAttribute('position', plane.attributes.position.clone());
      geometry.setAttribute('uv', plane.attributes.uv.clone());
      plane.dispose();
      for (const [name, size] of Object.entries({ particlePosition: 3, particleSize: 2,
        particleColor: 4, particleRotation: 1, particleFrame: 1 })) {
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(LIMIT * size), size).setUsage(THREE.DynamicDrawUsage));
      }
      geometry.instanceCount = 0;
      const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader,
        uniforms: { atlas: { value: texture }, grid: { value: new THREE.Vector2(...(index ? [10, 6] : [8, 4])) },
          opaqueDepth: { value: texture }, depthSize: { value: new THREE.Vector2(512, 512) },
          nearFar: { value: new THREE.Vector2(.01, 100) }, orthographic: { value: true }, depthFadeEnabled: { value: false } },
        transparent: true, toneMapped: false, depthWrite: false, depthTest: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = index;
      scene.add(mesh);
      return mesh;
    });
    this.count = 0;
  }
  setDepth(texture, camera, width, height, enabled) {
    for (const mesh of this.layers) {
      const u = mesh.material.uniforms;
      u.opaqueDepth.value = texture;
      u.nearFar.value.set(camera.near, camera.far);
      u.orthographic.value = camera.isOrthographicCamera === true;
      u.depthSize.value.set(width, height);
      u.depthFadeEnabled.value = enabled;
    }
  }
  update(frame, visible = [true, true]) {
    validateFrame(frame);
    this.count = 0;
    this.layers.forEach((mesh, index) => {
      const particles = frame.emitters[index].particles;
      if (!Array.isArray(particles) || particles.length > LIMIT) throw new Error('Particle bounds exceeded');
      const a = mesh.geometry.attributes;
      particles.forEach((p, i) => {
        a.particlePosition.setXYZ(i, ...toScene(p.position));
        a.particleSize.setXY(i, p.size[0] / 100, p.size[1] / 100);
        a.particleColor.setXYZW(i, ...p.color);
        a.particleRotation.setX(i, p.rotation);
        a.particleFrame.setX(i, p.subImage);
      });
      Object.values(a).filter(x => x.isInstancedBufferAttribute).forEach(x => { x.needsUpdate = true; });
      mesh.geometry.instanceCount = particles.length;
      mesh.visible = visible[index];
      if (visible[index]) this.count += particles.length;
    });
  }
  dispose() {
    for (const mesh of this.layers) {
      mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose();
    }
    this.layers = [];
  }
}
