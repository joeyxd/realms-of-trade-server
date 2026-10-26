// Isolated renderer experiment. Observed or locally evolved attributes, never Niagara bytecode.
import * as THREE from 'three';
import { frameSpec, validateFrame as validateFrameSpec } from './core/frame-spec.js';
import { spriteLayer, SPRITE_VERTEX_SHADER, SPRITE_FRAGMENT_SHADER } from './core/sprite-shader.js';
import { DEPTH_FADE_DISTANCE } from './core/depth-fade.js';

export const toScene = ([x, y, z]) => [y / 100, z / 100, -x / 100];
// Pilot bindings: the three frame schemas of the two NS_Flame_Single emitters, and their sprite layers
// (MI_Flame_2 8x4 and MI_Smoke_1 10x6 over the M_Smoke parent: textured, DepthFade 100 cm).
const PILOT_FRAME = frameSpec({ schemas: ['st01c-cpu-frame/v1', 'st01c-update-frame/v1', 'st01c-native-frame/v1'], limit: 512,
  emitters: [{ name: 'NE_Flame_Basic_001', subImage: 'required' }, { name: 'NE_Smoke_Basic', subImage: 'required' }] });
const LIMIT = PILOT_FRAME.limit;
const FLAME = spriteLayer({ grid: [8, 4], texture: true, depthFade: DEPTH_FADE_DISTANCE });
const SMOKE = spriteLayer({ grid: [10, 6], texture: true, depthFade: DEPTH_FADE_DISTANCE });
export function validateFrame(frame) {
  return validateFrameSpec(frame, PILOT_FRAME);
}

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
      const layer = index ? SMOKE : FLAME;
      const material = new THREE.ShaderMaterial({ vertexShader: SPRITE_VERTEX_SHADER, fragmentShader: SPRITE_FRAGMENT_SHADER,
        defines: { ...layer.defines },
        uniforms: { atlas: { value: texture }, grid: { value: new THREE.Vector2(...layer.grid) },
          opaqueDepth: { value: texture }, depthSize: { value: new THREE.Vector2(512, 512) },
          nearFar: { value: new THREE.Vector2(.01, 100) }, orthographic: { value: true }, depthFadeEnabled: { value: false },
          ...(layer.depthFade === null ? {} : { depthFadeDistance: { value: layer.depthFade } }) },
        transparent: true, toneMapped: false, depthWrite: false, depthTest: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = index;
      scene.add(mesh);
      return mesh;
    });
    this.count = 0;
  }
  // Explicit perspective opt-in, as BasicHitParticles: the pilot's lab path (no option) is unchanged.
  setDepth(texture, camera, width, height, enabled, { perspective = false } = {}) {
    if (perspective && camera.isPerspectiveCamera !== true) throw new Error('Perspective DepthFade needs a perspective camera');
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
