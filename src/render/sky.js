// Stylized sky dome (gradient + sun + toon clouds). The same skyColor() feeds the water fresnel.
import * as THREE from 'three';
import { GLSL_COMMON, U } from './toon.js';

export const SKY = {
  skyTop: { value: new THREE.Color(0x3aa0e8) },
  skyHorizon: { value: new THREE.Color(0xc4ecf7) },
  skyBottom: { value: new THREE.Color(0x7fd3e0) },
  sunDir: { value: new THREE.Vector3(-0.6, 0.75, 0.2).normalize() },
  sunColor: { value: new THREE.Color(0xfff1d8) },
};

export const GLSL_SKY = /* glsl */ `
uniform vec3 skyTop;
uniform vec3 skyHorizon;
uniform vec3 skyBottom;
uniform vec3 sunDir;
uniform vec3 sunColor;
vec3 skyColor(vec3 dir, float withSun) {
  float y = dir.y;
  vec3 c = mix(skyHorizon, skyTop, pow(smoothstep(0.0, 0.65, y), 0.75));
  c = mix(c, skyBottom, smoothstep(0.0, -0.25, y));
  float s = max(dot(dir, sunDir), 0.0);
  c += sunColor * withSun * (smoothstep(0.9993, 0.9996, s) * 1.6 + pow(s, 14.0) * 0.22);
  return c;
}
`;

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...SKY, mnTime: U.mnTime, mnWind: U.mnWind, mnPlayer: U.mnPlayer, mnOccR: U.mnOccR, mnOccOn: U.mnOccOn, mnNearFade: U.mnNearFade, mnCloud: U.mnCloud },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      ${GLSL_SKY}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d, 1.0);
        // Toon clouds: puffy noise band near the horizon, 2-tone shaded.
        float band = smoothstep(0.02, 0.12, d.y) * (1.0 - smoothstep(0.32, 0.55, d.y));
        vec2 q = d.xz / max(d.y + 0.15, 0.05) * 0.9 + mnWind * mnTime * 0.004;
        float n = mnFbm(q * 1.4);
        float cloud = smoothstep(0.52, 0.56, n) * band;
        float shade = smoothstep(0.56, 0.68, mnFbm(q * 1.4 + vec2(0.06, -0.04)));
        vec3 cc = mix(vec3(0.86, 0.9, 1.0), vec3(1.0), shade) * mix(vec3(1.0), sunColor, 0.25);
        c = mix(c, cc, cloud * 0.95);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  return mesh;
}
