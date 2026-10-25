import * as THREE from 'three';
import { createFilmLUT, filmFragment } from './film-color.js';

// Reuse the source transfer, including the Taller's display gain; never fit observed pixels.
const transfer = filmFragment.slice(filmFragment.indexOf('  vec3 linearColor'), filmFragment.lastIndexOf('}'))
  .replace('texture(image,vUv).rgb * exposure', 'inputColor')
  .replace('outColor = vec4(texture(filmLUT,coords).rgb*1.05,1.0);', 'return texture(filmLUT,coords).rgb*1.05;');
const filmFunction = `precision highp sampler3D; uniform sampler3D filmLUT;
vec3 worldFilm(vec3 inputColor) { ${transfer} }`;
const vertex = 'out vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const fragment = `precision highp float;
${filmFunction}
uniform sampler2D image; uniform bool maskPass;
in vec2 vUv; out vec4 outColor;
// The LUT returns display values (the Taller writes them straight to the canvas); rtPost is an SRGB8 target that expects
// linear output and encodes on store, so decode with the exact sRGB curve to land on the same display value.
vec3 displayToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
void main() {
  vec4 src = texture(image,vUv);
  if (all(equal(src,vec4(0)))) discard; // The LUT toe must never touch empty pixels.
  float glow = clamp(max(max(src.r,src.g),src.b)-src.a,0.,1.);
  outColor = maskPass ? vec4(0.,0.,0.,glow) : vec4(displayToLinear(worldFilm(src.rgb)),clamp(src.a,0.,1.));
}`;

export class WorldFilm {
  constructor() { this.res = new THREE.Vector2(1, 1); this.scale = 1; }
  setFilm(source) {
    const identity = JSON.stringify(source);
    if (this.identity && identity !== this.identity) throw new Error('Native world Filmic profiles differ');
    if (this.lut) return;
    this.lut = createFilmLUT(source).texture; this.identity = identity;
  }
  async load() {
    if (this.disposed || this.lut || this.loading) return;
    this.loading = fetch(new URL('./film-source.json', import.meta.url)).then(r => {
      if (!r.ok) throw new Error(`World Filmic HTTP ${r.status}`);
      return r.json();
    }).then(s => { if (!this.disposed) this.setFilm(s); }).catch(e => { console.warn(e); }).finally(() => { this.loading = null; });
  }
  size(width, height) {
    this.res.set(Math.max(1, Math.floor(width * this.scale)), Math.max(1, Math.floor(height * this.scale)));
    if (this.target && (this.target.width !== this.res.x || this.target.height !== this.res.y)) this.target.setSize(this.res.x, this.res.y);
  }
  setup() {
    if (this.target) return;
    this.target = new THREE.WebGLRenderTarget(this.res.x, this.res.y, { type: THREE.HalfFloatType, depthBuffer: false });
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    const uniforms = { image: { value: this.target.texture }, filmLUT: { value: this.lut }, maskPass: { value: false } };
    this.composite = new THREE.ShaderMaterial({ uniforms, glslVersion: THREE.GLSL3, vertexShader: vertex, fragmentShader: fragment,
      transparent: true, toneMapped: false, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    this.mask = this.composite.clone(); this.mask.uniforms = { ...uniforms, maskPass: { value: true } };
    this.mask.blendSrc = THREE.ZeroFactor; this.mask.blendDst = THREE.OneFactor;
    this.mask.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.output = new THREE.Scene(); this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite); this.output.add(this.mesh);
  }
  render(renderer, scene, camera, output, quadCam, layer) {
    this.setup();
    const background = scene.background, mask = camera.layers.mask;
    const color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha(), auto = renderer.autoClear;
    try {
      scene.background = null; camera.layers.set(layer);
      renderer.setRenderTarget(this.target); renderer.setClearColor(0, 0); renderer.autoClear = true;
      renderer.render(scene, camera);
      renderer.setRenderTarget(output); renderer.autoClear = false;
      this.mesh.material = this.composite; renderer.render(this.output, quadCam);
      this.mesh.material = this.mask; renderer.render(this.output, quadCam);
    } finally {
      scene.background = background; camera.layers.mask = mask;
      renderer.setClearColor(color, alpha); renderer.autoClear = auto; renderer.setRenderTarget(output);
    }
  }
  dispose() {
    this.disposed = true;
    for (const r of [this.lut, this.target, this.composite, this.mask, this.mesh?.geometry, this.final]) r?.dispose();
  }
  finalMaterial(base, exposure) {
    if (!this.final) {
      this.final = base.clone(); this.final.uniforms = { ...base.uniforms, filmLUT: { value: this.lut }, worldFilmExposure: { value: exposure } };
      this.final.glslVersion = THREE.GLSL3;
      this.final.fragmentShader = `${filmFunction}\nuniform float worldFilmExposure; out vec4 filmOutput;\n${base.fragmentShader}`
        .replace('#include <colorspace_fragment>', 'gl_FragColor.rgb = worldFilm(col * worldFilmExposure);').replaceAll('gl_FragColor', 'filmOutput');
    }
    this.final.uniforms.worldFilmExposure.value = exposure;
    return this.final;
  }
}
