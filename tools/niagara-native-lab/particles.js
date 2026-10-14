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
varying vec2 atlasUv;
varying vec4 tint;
void main() {
  vec3 texel = texture2D(atlas, atlasUv).rgb;
  gl_FragColor = vec4(texel * tint.rgb, clamp(texel.r * tint.a, 0.0, 1.0));
  // No opaque geometry in this comparison: DepthFade is 1, as in the source view.
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
        uniforms: { atlas: { value: texture }, grid: { value: new THREE.Vector2(...(index ? [10, 6] : [8, 4])) } },
        transparent: true, toneMapped: false, depthWrite: false, depthTest: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = index;
      scene.add(mesh);
      return mesh;
    });
    this.count = 0;
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
