// Terrain mesh from the shared heightfield + splat shading in a patched MeshToonMaterial
// (same light bands as everything else). Deep-ocean cells are culled.
import * as THREE from 'three';
import { toonMesh, normalMatFor } from './toon.js';

export function createTerrain(map, { segments = 250 } = {}) {
  const size = map.size, half = size / 2;
  const n = segments + 1;
  const step = size / segments;
  const pos = new Float32Array(n * n * 3);
  const nrm = new Float32Array(n * n * 3);
  const msk = new Float32Array(n * n * 4);
  const keep = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = -half + i * step, z = -half + j * step;
      const h = map.heightAt(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const e = step * 0.5;
      const nx = map.heightAt(x - e, z) - map.heightAt(x + e, z);
      const nz = map.heightAt(x, z - e) - map.heightAt(x, z + e);
      const l = Math.hypot(nx, 2 * e, nz);
      nrm[k * 3] = nx / l; nrm[k * 3 + 1] = (2 * e) / l; nrm[k * 3 + 2] = nz / l;
      const m = map.masks(x, z);
      msk[k * 4] = m.path; msk[k * 4 + 1] = m.volcanic; msk[k * 4 + 2] = m.arenaFloor; msk[k * 4 + 3] = m.lava;
      keep[k] = h > -6.5 ? 1 : 0;
    }
  }
  const idx = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      if (!(keep[a] | keep[b] | keep[c] | keep[d])) continue;
      // Alternate the diagonal to avoid directional artifacts.
      if ((i + j) & 1) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('aMask', new THREE.BufferAttribute(msk, 4));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const opts = {
    key: 'terrain',
    vertPars: 'attribute vec4 aMask;\nvarying vec4 vMask;\nvarying vec3 vTN;\n',
    vertBody: 'vMask = aMask; vTN = normal;\n',
    fragPars: /* glsl */ `
      varying vec4 vMask;
      varying vec3 vTN;
      uniform float mnLavaPulse;
      float mnTerrainCrack;
      vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
      float caustic(vec2 p, float t) {
        vec2 v1 = mnVoronoi(p * 0.55 + vec2(t * 0.11, t * 0.07));
        vec2 v2 = mnVoronoi(p * 0.8 - vec2(t * 0.09, -t * 0.05) + 13.0);
        return smoothstep(0.09, 0.0, v1.y) * 0.6 + smoothstep(0.07, 0.0, v2.y) * 0.4;
      }
    `,
    albedo: /* glsl */ `
      {
        vec3 wp = vMnWorld;
        float h = wp.y;
        vec3 tn = normalize(vTN);
        float slope = 1.0 - tn.y;
        float n1 = mnNoise(wp.xz * 0.35);
        float n2 = mnNoise(wp.xz * 0.07 + 5.0);
        vec3 sand = srgb(vec3(0.95, 0.86, 0.63));
        vec3 wet = srgb(vec3(0.82, 0.69, 0.47));
        vec3 grassA = srgb(vec3(0.46, 0.74, 0.31));
        vec3 grassB = srgb(vec3(0.34, 0.62, 0.26));
        vec3 rock = srgb(vec3(0.62, 0.57, 0.54));
        vec3 basalt = srgb(vec3(0.31, 0.26, 0.33));
        vec3 dirt = srgb(vec3(0.80, 0.63, 0.42));
        vec3 col = sand * (0.96 + 0.06 * n1);
        float grassW = smoothstep(1.3, 1.75, h + (n1 - 0.5) * 0.35);
        vec3 grass = mix(grassA, grassB, smoothstep(0.35, 0.65, n2));
        grass = mix(grass, grass * 1.12, step(0.72, mnNoise(wp.xz * 1.6)) * 0.6);
        col = mix(col, grass, grassW);
        col = mix(col, wet, (1.0 - smoothstep(0.05, 0.5, h)) * (1.0 - grassW));
        // Rock on steep slopes.
        col = mix(col, rock * (0.9 + 0.2 * n1), smoothstep(0.28, 0.42, slope + (n1 - 0.5) * 0.08));
        // Path / village dirt with flagstones.
        float pathW = vMask.x * smoothstep(0.25, 0.55, vMask.x + (n1 - 0.5) * 0.4);
        if (pathW > 0.001) {
          vec2 vs = mnVoronoi(wp.xz * 0.9);
          vec3 stone = mix(dirt, srgb(vec3(0.88, 0.77, 0.58)), 0.55) * (0.9 + 0.2 * mnHash(floor(wp.xz * 0.9 + 0.5)));
          vec3 p = mix(dirt, stone, smoothstep(0.04, 0.09, vs.y) * step(0.5, vMask.x));
          col = mix(col, p, pathW);
        }
        // Volcanic basalt; the upper cone gets layered rock strata.
        col = mix(col, basalt * (0.85 + 0.3 * n1), smoothstep(0.2, 0.7, vMask.y) * (1.0 - grassW * 0.3));
        float high = smoothstep(7.0, 13.0, h + (n2 - 0.5) * 3.0);
        float strata = step(0.5, fract(h * 0.45 + n2 * 0.8));
        vec3 volc = mix(srgb(vec3(0.36, 0.3, 0.36)), srgb(vec3(0.46, 0.38, 0.40)), strata) * (0.9 + 0.2 * n1);
        col = mix(col, volc, high);
        // Arena floor: hexy basalt tiles with lava cracks.
        mnTerrainCrack = 0.0;
        if (vMask.z > 0.01) {
          vec2 v = mnVoronoi(wp.xz * 0.3);
          vec3 tile = mix(srgb(vec3(0.30, 0.25, 0.33)), srgb(vec3(0.38, 0.32, 0.40)), mnHash(floor(wp.xz * 0.3) + 3.0));
          tile *= 0.9 + 0.15 * smoothstep(0.0, 0.5, v.x);
          float seam = smoothstep(0.045, 0.018, v.y);
          float crackMask = smoothstep(0.42, 0.62, mnNoise(wp.xz * 0.11 + 2.0));
          mnTerrainCrack = seam * crackMask * vMask.z;
          col = mix(col, mix(tile, srgb(vec3(0.16, 0.11, 0.17)), seam), vMask.z);
          col = mix(col, srgb(vec3(0.25, 0.07, 0.03)), mnTerrainCrack);
        }
        // Lava river / crater: dark crust, emissive below.
        col = mix(col, srgb(vec3(0.2, 0.06, 0.04)), smoothstep(0.3, 0.8, vMask.w));
        // Underwater: tint and animated caustics.
        if (h < 0.05) {
          float d = clamp(-h, 0.0, 6.0);
          col *= mix(vec3(1.0), vec3(0.62, 0.86, 0.9), smoothstep(0.0, 2.5, d));
          col += vec3(0.9, 1.0, 0.95) * caustic(wp.xz, mnTime) * 0.32 * (1.0 - smoothstep(0.2, 3.2, d)) * smoothstep(0.02, 0.25, d);
        }
        diffuseColor.rgb = col;
      }
    `,
    emissive: /* glsl */ `
      {
        float pulse = 0.82 + 0.18 * sin(mnTime * 2.2 + vMnWorld.x * 0.3 + vMnWorld.z * 0.2);
        float lavaFlow = mnNoise(vMnWorld.xz * 0.5 + vec2(mnTime * 0.25, mnTime * 0.12));
        vec3 lavaHot = mix(vec3(1.0, 0.32, 0.04), vec3(1.0, 0.78, 0.25), lavaFlow);
        float lavaW = smoothstep(0.35, 0.85, vMask.w);
        float crust = smoothstep(0.55, 0.7, mnNoise(vMnWorld.xz * 0.9 - vec2(mnTime * 0.18, 0.0)));
        totalEmissiveRadiance += lavaHot * lavaW * (1.0 - crust * 0.75) * pulse * 2.2 * mnLavaPulse;
        totalEmissiveRadiance += vec3(1.0, 0.42, 0.08) * mnTerrainCrack * pulse * 1.8 * mnLavaPulse;
      }
    `,
    uniforms: { mnLavaPulse: { value: 1 } },
  };
  const mesh = toonMesh(geo, { color: 0xffffff }, opts);
  mesh.userData.nm = normalMatFor({});
  mesh.material.userData.lavaU = opts.uniforms.mnLavaPulse;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  return mesh;
}

// Height texture for the water shader (depth / foam), half-float red channel.
export function createHeightTexture(map, res = 256) {
  const data = new Uint16Array(res * res);
  const size = map.size, half = size / 2;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = -half + (i / (res - 1)) * size, z = -half + (j / (res - 1)) * size;
      const h = map.heightAt(x, z);
      data[j * res + i] = THREE.DataUtils.toHalfFloat(h);
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
