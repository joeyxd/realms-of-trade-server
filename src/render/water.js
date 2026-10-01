// Stylized ocean: depth from the terrain heightmap (turquoise shallows → deep blue, transparent over
// sand), toon foam at the shore, quantized sun glints, sky fresnel, sun shadows and the shared mnBand.
import * as THREE from 'three';
import { GLSL_COMMON, GLSL_BAND, U } from './toon.js';
import { GLSL_SKY, SKY } from './sky.js';

export function createWater(map, heightTex) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
  Object.assign(uniforms, SKY, {
    mnTime: U.mnTime, mnWind: U.mnWind, mnCloud: U.mnCloud,
    uHeight: { value: heightTex },
    uWorldHalf: { value: map.size / 2 },
    uShallow: { value: new THREE.Color(0x46e6d6) },
    uMid: { value: new THREE.Color(0x16a8cf) },
    uDeep: { value: new THREE.Color(0x0d4f9a) },
    uFoam: { value: new THREE.Color(0xffffff) },
    uWaves: { value: 1 },
  });
  // GLSL_COMMON declares mnPlayer etc. too; they just need to exist.
  Object.assign(uniforms, { mnPlayer: U.mnPlayer, mnOccR: U.mnOccR, mnOccOn: U.mnOccOn, mnNearFade: U.mnNearFade });

  const mat = new THREE.ShaderMaterial({
    uniforms,
    lights: true,
    fog: true,
    transparent: true,
    depthWrite: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      #include <shadowmap_pars_vertex>
      varying vec3 vWorld;
      varying vec3 vViewPos;
      void main() {
        vec3 transformed = position;
        vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
        vWorld = worldPosition.xyz;
        vec3 objectNormal = vec3(0.0, 1.0, 0.0);
        vec3 transformedNormal = normalMatrix * objectNormal;
        vec4 mvPosition = viewMatrix * worldPosition;
        vViewPos = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <shadowmap_vertex>
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <packing>
      #include <fog_pars_fragment>
      #include <bsdfs>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>
      ${GLSL_COMMON}
      ${GLSL_BAND}
      ${GLSL_SKY}
      uniform sampler2D uHeight;
      uniform float uWorldHalf;
      uniform vec3 uShallow, uMid, uDeep, uFoam;
      uniform float uWaves;
      varying vec3 vWorld;
      varying vec3 vViewPos;

      float terrainH(vec2 xz) {
        vec2 uv = xz / (uWorldHalf * 2.0) + 0.5;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -20.0;
        return texture2D(uHeight, uv).r;
      }
      // Two layers of moving gradient noise -> normal perturbation.
      vec2 waveGrad(vec2 p, float t) {
        float e = 0.35;
        vec2 a = p * 0.22 + mnWind * t * 0.05;
        vec2 b = p * 0.47 - vec2(mnWind.y, -mnWind.x) * t * 0.08;
        float h0 = mnNoise(a) + 0.5 * mnNoise(b);
        float hx = mnNoise(a + vec2(e * 0.22, 0.0)) + 0.5 * mnNoise(b + vec2(e * 0.47, 0.0));
        float hz = mnNoise(a + vec2(0.0, e * 0.22)) + 0.5 * mnNoise(b + vec2(0.0, e * 0.47));
        return vec2(hx - h0, hz - h0) / e;
      }
      void main() {
        float t = mnTime;
        vec2 xz = vWorld.xz;
        float th = terrainH(xz);
        float depth = max(vWorld.y - th, 0.0);
        vec2 g = waveGrad(xz, t) * 0.55 * uWaves;
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - vWorld);

        // Depth color.
        vec3 col = mix(uShallow, uMid, smoothstep(0.2, 2.6, depth));
        col = mix(col, uDeep, smoothstep(2.6, 9.0, depth));
        // Banded sun lighting (same mnBand as toon materials) with shadows and cloud shadows.
        float vis = getShadowMask() * mnCloudShadow(xz);
        float ndl = mix(-1.0, dot(n, sunDir), vis);
        float band = mnBand(ndl);
        col *= mix(0.72, 1.06, band);
        // Fresnel towards the sky color.
        float fr = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        col = mix(col, skyColor(reflect(-V, n), 0.0), fr * 0.45);
        // Quantized sun glints.
        vec3 Hh = normalize(sunDir + V);
        float sp = pow(max(dot(n, Hh), 0.0), 220.0) * vis;
        float tw = mnNoise(xz * 1.7 + t * 1.3);
        col += sunColor * step(0.35, sp * (0.6 + tw)) * 0.9;
        // Shore foam: solid edge + toon stripes drifting in.
        float edge = 1.0 - smoothstep(0.12, 0.32, depth + (mnNoise(xz * 1.3 + t * 0.4) - 0.5) * 0.18);
        float ph = depth * 5.5 - t * 1.4 + mnNoise(xz * 0.45) * 4.0;
        float stripes = step(0.82, sin(ph) * 0.5 + 0.5) * (1.0 - smoothstep(0.35, 1.25, depth)) * step(0.0, th + 1.6);
        stripes *= smoothstep(0.35, 0.55, mnNoise(xz * 0.8 - t * 0.2));
        float foam = max(edge, stripes);
        // Sparse open-water whitecaps.
        float caps = step(0.86, mnNoise(xz * 0.35 + t * 0.12)) * step(0.6, mnNoise(xz * 1.9 - t * 0.5)) * smoothstep(3.0, 8.0, depth) * 0.85;
        foam = max(foam, caps);
        col = mix(col, uFoam * mix(0.82, 1.0, band), foam);
        float alpha = mix(0.28, 0.96, smoothstep(0.0, 1.8, depth));
        alpha = max(alpha, foam);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });

  const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = map.landmarks ? 0 : 0;
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.name = 'water';
  mesh.frustumCulled = false;
  return mesh;
}
