// Dash afterimages: pooled ghost copies of a character's pose (same geometry, frozen matrices),
// additive fresnel tint in the accent color, fading over ~0.25 s. FX layer (never outlined).
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';

const VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vN;
varying vec3 vV;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vN = normalize(normalMatrix * objectNormal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform vec3 uColor;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vV;
void main() {
  float fr = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = smoothstep(0.35, 0.85, fr);
  float a = (0.32 + 0.6 * rim) * uAlpha * fxDepthFade(0.25);
  vec3 c = mix(uColor * 0.85, mix(uColor, vec3(1.0), 0.55), rim);
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

export class Afterimages {
  constructor(scene, count = 12) {
    this.ghosts = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...FXU, uColor: { value: new THREE.Color(0x3bf0ff) }, uAlpha: { value: 0 } },
        vertexShader: VERT, fragmentShader: FRAG,
        transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      });
      // Frozen bones: never in the scene graph, matrixWorld copied at capture time.
      const bones = Array.from({ length: 8 }, () => { const b = new THREE.Bone(); b.matrixAutoUpdate = false; b.matrixWorldAutoUpdate = false; return b; });
      const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), mat);
      mesh.bindMode = 'detached';
      mesh.layers.set(LAYER.FX);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.ghosts.push({ mat, mesh, bones, t: 0, life: 0, active: false, bound: false });
    }
    this.cursor = 0;
    this.pending = [];
  }

  // Snapshot a character view's current pose.
  capture(view, color, life = 0.25, alpha = 0.7) {
    const g = this.ghosts[this.cursor];
    this.cursor = (this.cursor + 1) % this.ghosts.length;
    view.root.updateMatrixWorld(true);
    const src = view.mesh.skeleton;
    if (!g.bound) {
      g.mesh.bind(new THREE.Skeleton(g.bones, src.boneInverses.map((m) => m.clone())), new THREE.Matrix4());
      g.bound = true;
    }
    g.mesh.geometry = view.mesh.geometry;
    for (let k = 0; k < g.bones.length; k++) g.bones[k].matrixWorld.copy(src.bones[k].matrixWorld);
    g.mesh.visible = true;
    g.mat.uniforms.uColor.value.set(color);
    g.alpha = alpha;
    g.t = 0; g.life = life; g.active = true;
  }

  // Schedule captures at offsets (seconds) for a dash.
  dash(view, color, offsets, life) {
    for (const o of offsets) this.pending.push({ view, color, at: o, life });
  }

  update(dt) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.at -= dt;
      if (p.at <= 0) { this.capture(p.view, p.color, p.life); this.pending.splice(i, 1); }
    }
    for (const g of this.ghosts) {
      if (!g.active) continue;
      g.t += dt;
      const k = 1 - g.t / g.life;
      if (k <= 0) { g.active = false; g.mesh.visible = false; continue; }
      g.mat.uniforms.uAlpha.value = g.alpha * k * k;
    }
  }
}
