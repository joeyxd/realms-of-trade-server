// Terrain mesh from the shared heightfield + splat shading in a patched MeshToonMaterial
// (same light bands as everything else). Deep-ocean cells are culled.
import * as THREE from 'three';
import { toonMesh, normalMatFor } from './toon.js';
import { INK_GLSL } from './inkGlsl.js';

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
      keep[k] = h > -7.3 ? 1 : 0;
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

  const arena = map.landmarks.arena;
  const opts = {
    key: 'terrain',
    glowMask: 'mnGlowSrc',
    // No comic hatching on lava, on the hot cracks or under water.
    hatchMask: '(1.0 - smoothstep(0.05, 0.35, vMask.w)) * (1.0 - smoothstep(0.0, 0.15, mnTerrainCrack)) * smoothstep(0.02, 0.12, vMnWorld.y)',
    vertPars: 'attribute vec4 aMask;\nvarying vec4 vMask;\nvarying vec3 vTN;\n',
    vertBody: 'vMask = aMask; vTN = normal;\n',
    fragPars: /* glsl */ `
      varying vec4 vMask;
      varying vec3 vTN;
      uniform float mnLavaPulse;
      uniform float mnTerrainCaustics;
      uniform vec3 mnArena; // arena centre x, z and floor radius (the greek-key border rides its edge)
      float mnTerrainCrack;
      float mnGlowSrc = 0.0;
      vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
      // Low-quality path only (medium/high draw caustics in the water pass).
      float caustic(vec2 p, float t) {
        float c1 = texture2D(mnNoiseTex, p * 0.055 + vec2(t * 0.011, t * 0.007)).g;
        float c2 = texture2D(mnNoiseTex, p * 0.075 - vec2(t * 0.009, -t * 0.012) + 0.41).g;
        return pow(1.0 - min(c1, c2), 7.0);
      }
    ` + INK_GLSL,
    // Painted detail (P5) is albedo only, all from mnNoiseTex, and fades out with distance (mnDetailFade).
    albedo: /* glsl */ `
      {
        vec3 wp = vMnWorld;
        float h = wp.y;
        vec3 tn = normalize(vTN);
        float slope = 1.0 - tn.y;
        float fade = mnDetailFade();
        // uv gradients of the planar maps: the detail reads below sit in branches, so they use textureGrad.
        vec4 gp = vec4(dFdx(wp.xz), dFdy(wp.xz));
        float n1 = texture2D(mnNoiseTex, wp.xz * 0.044).b;
        float n2 = texture2D(mnNoiseTex, wp.xz * 0.0087 + 0.5).b;
        vec3 sand = srgb(vec3(0.95, 0.86, 0.63));
        vec3 wet = srgb(vec3(0.82, 0.69, 0.47));
        vec3 grassA = srgb(vec3(0.46, 0.74, 0.31));
        vec3 grassB = srgb(vec3(0.34, 0.62, 0.26));
        vec3 rock = srgb(vec3(0.62, 0.57, 0.54));
        vec3 basalt = srgb(vec3(0.31, 0.26, 0.33));
        vec3 dirt = srgb(vec3(0.80, 0.63, 0.42));
        vec3 col = sand * (0.96 + 0.06 * n1);
        float gh = h + (n1 - 0.5) * 0.35;
        float grassW = smoothstep(1.3, 1.75, gh);
        vec3 grass = mix(grassA, grassB, smoothstep(0.35, 0.65, n2));
        grass = mix(grass, grass * 1.12, step(0.68, texture2D(mnNoiseTex, wp.xz * 0.2).b) * 0.6);
        col = mix(col, grass, grassW);
        float wetW = (1.0 - smoothstep(0.05, 0.5, h)) * (1.0 - grassW);
        col = mix(col, wet, wetW);
        // Rock on steep slopes.
        float rockW = smoothstep(0.28, 0.42, slope + (n1 - 0.5) * 0.08);
        col = mix(col, rock * (0.9 + 0.2 * n1), rockW);
        // Path / village dirt with flagstones: crisp ink joint, a light bevel inside each stone, a little hue per stone.
        float pathW = vMask.x * smoothstep(0.25, 0.55, vMask.x + (n1 - 0.5) * 0.4);
        if (pathW > 0.001) {
          vec4 vs = texture2D(mnNoiseTex, wp.xz * 0.1125);
          vec3 stone = mix(dirt, srgb(vec3(0.88, 0.77, 0.58)), 0.55) * (0.88 + 0.24 * vs.a);
          stone *= mix(vec3(1.0), mix(vec3(1.05, 1.0, 0.92), vec3(0.94, 1.0, 1.07), fract(vs.a * 5.0)), fade);
          float isStone = step(0.5, vMask.x);
          float gap = mix(smoothstep(0.1, 0.25, vs.g), smoothstep(0.07, 0.13, vs.g), fade); // stones reach the joint up close
          vec3 p = mix(dirt, stone, gap * isStone);
          p *= 1.0 + 0.08 * mnLine(abs(vs.g - 0.13), 0.035) * isStone * fade;
          p = mix(p, MN_INK, 0.7 * mnLine(vs.g, 0.085) * isStone * fade);
          col = mix(col, p, pathW);
        }
        // Volcanic basalt; the upper cone gets layered rock strata with an ink line on each boundary.
        float volcW = smoothstep(0.2, 0.7, vMask.y) * (1.0 - grassW * 0.3);
        col = mix(col, basalt * (0.85 + 0.3 * n1), volcW);
        float high = smoothstep(7.0, 13.0, h + (n2 - 0.5) * 3.0);
        float sf = fract(h * 0.45 + n2 * 0.8);
        float strata = step(0.5, sf);
        vec3 volc = mix(srgb(vec3(0.36, 0.3, 0.36)), srgb(vec3(0.46, 0.38, 0.40)), strata) * (0.9 + 0.2 * n1);
        col = mix(col, volc, high);
        col = mix(col, MN_INK, 0.5 * mnLine(min(abs(sf - 0.5), min(sf, 1.0 - sf)), 0.02) * high * fade);
        // Ink cracks in the rock (steep slopes, steep basalt): cell edges kept where the fbm mask passes.
        float crackW = max(rockW, volcW * smoothstep(0.12, 0.3, slope)) * (1.0 - vMask.z);
        col = mix(col, MN_INK, 0.65 * mnCracks(wp, tn, 0.13, 0.03, 0.57, fade * crackW > 0.02) * crackW * fade);
        // Sand and grass painting: only where the ground is still plain (no rock, path, basalt, arena floor, lava).
        float plain = (1.0 - rockW) * (1.0 - pathW) * (1.0 - volcW) * (1.0 - vMask.z) * (1.0 - smoothstep(0.3, 0.8, vMask.w));
        float sandW = plain * (1.0 - grassW) * smoothstep(0.25, 0.7, h);
        float grassP = plain * grassW;
        if (fade * (sandW + grassP) > 0.02) {
          // Small cells (0.38 u): dark stipple dots on sand, a few darker ticks on grass.
          vec4 st = textureGrad(mnNoiseTex, wp.xz * 0.33, gp.xy * 0.33, gp.zw * 0.33);
          if (sandW > 0.01) {
            // Wind ripples: long curvy crest lines (a tinted darker line, not pure ink), broken up by noise.
            float ph = (dot(wp.xz, vec2(0.83, 0.56)) * 2.2 + n2 * 9.0 + (n1 - 0.5) * 4.0) / 6.2832;
            float rip = mnLine(min(fract(ph), 1.0 - fract(ph)) / 0.35, 0.05) * smoothstep(0.38, 0.5, n1);
            float dots = mnLine(st.r, 0.15) * step(0.86, st.a) * smoothstep(0.45, 0.58, n2);
            col *= (1.0 - vec3(0.15, 0.19, 0.24) * rip * sandW * fade) * (1.0 - 0.2 * dots * sandW * fade);
          }
          if (grassP > 0.01) {
            // Brush strokes: fbm stretched along a rotated axis, lighter and warmer than the base.
            mat2 r30 = mat2(0.866, 0.5, -0.5, 0.866);
            vec2 sk = vec2(0.55, 0.13);
            vec2 su = r30 * wp.xz * sk + vec2((n2 - 0.5) * 2.0, 0.0);
            float stroke = smoothstep(0.56, 0.66, textureGrad(mnNoiseTex, su, r30 * gp.xy * sk, r30 * gp.zw * sk).b);
            col = mix(col, col * 1.16 + vec3(0.03, 0.025, 0.0), stroke * grassP * fade);
            col *= 1.0 - 0.3 * mnLine(st.r, 0.17) * step(st.a, 0.12) * grassP * fade;
          }
        }
        // Dark rim where the grass meets the sand (contour of the grass mask at 0.5, ~0.25 u wide) so patches read as shapes.
        float tg = sqrt(max(1.0 - tn.y * tn.y, 0.0)) / max(tn.y, 0.3);
        col *= 1.0 - 0.35 * mnLine(abs(gh - 1.525) / max(tg, 0.1), 0.125) * plain * fade;
        // Arena floor: hexy basalt tiles with lava cracks. Seams become crisp ink with a light bevel, and an
        // outer band carries a greek-key border (polar cells, a whole number of periods around the circle).
        mnTerrainCrack = 0.0;
        if (vMask.z > 0.01) {
          vec4 v = texture2D(mnNoiseTex, wp.xz * 0.0375);
          vec3 tile = mix(srgb(vec3(0.30, 0.25, 0.33)), srgb(vec3(0.38, 0.32, 0.40)), v.a);
          tile *= 0.9 + 0.15 * smoothstep(0.0, 0.6, v.r);
          float seam = smoothstep(0.075, 0.035, v.g);
          float crackMask = smoothstep(0.5, 0.66, texture2D(mnNoiseTex, wp.xz * 0.0139 + 0.2).b);
          mnTerrainCrack = seam * crackMask * vMask.z;
          // Ink core on plain seams, ink outline on both sides of the lava cracks, bevel just inside the tile.
          float inkS = mnLine(v.g, 0.045) * (1.0 - crackMask);
          float inkE = mnLine(abs(v.g - 0.092), 0.02) * crackMask;
          tile *= 1.0 + 0.16 * mnLine(abs(v.g - 0.078), 0.022) * (1.0 - crackMask) * fade;
          vec3 tc = mix(tile, srgb(vec3(0.16, 0.11, 0.17)), seam * (1.0 - fade * (1.0 - crackMask)));
          tc = mix(tc, MN_INK, 0.85 * max(inkS, inkE) * fade);
          col = mix(col, tc, vMask.z);
          col = mix(col, srgb(vec3(0.25, 0.07, 0.03)), mnTerrainCrack);
          // Greek-key band just inside the floor edge: 1.6 u wide, 5 cell rows, N periods of 6 cells (~1.9 u) around.
          vec2 ad = wp.xz - mnArena.xy;
          float da = length(ad);
          float bv = (da - (mnArena.z - 2.1)) / 1.6; // 0 inner edge .. 1 outer edge
          if (fade > 0.01 && bv > -0.1 && bv < 1.1) {
            float cells = 6.0 * floor(6.2832 * (mnArena.z - 1.3) / 1.92 + 0.5);
            float pw = max(fwidth(wp.x), fwidth(wp.z));
            vec2 pc = vec2(atan(ad.y, ad.x) / 6.2832 * cells, bv * 5.0);
            vec2 aa = vec2(cells / (6.2832 * da), 5.0 / 1.6) * pw;
            float bandM = mnLine(abs(bv - 0.5) * 1.6, 0.86) * fade * vMask.z;
            float edge = mnLine(abs(abs(bv - 0.5) * 1.6 - 0.8), 0.05);
            vec3 bandCol = srgb(vec3(0.62, 0.52, 0.5)) * (0.93 + 0.12 * v.a);
            bandCol = mix(bandCol, MN_INK, max(0.9 * mnMeander(pc, aa), 0.9 * edge));
            col = mix(col, bandCol, bandM);
            mnTerrainCrack *= 1.0 - bandM;
          }
        }
        // Lava river / crater: dark crust, emissive below.
        col = mix(col, srgb(vec3(0.2, 0.06, 0.04)), smoothstep(0.3, 0.8, vMask.w));
        // Underwater: tint and animated caustics.
        // The seabed darkens with depth (both water paths; keeps the deep floor seamless).
        col *= mix(1.0, 0.32, smoothstep(0.5, 7.0, -h));
        if (h < 0.05 && mnTerrainCaustics > 0.5) {
          float d = clamp(-h, 0.0, 6.0);
          col *= mix(vec3(1.0), vec3(0.62, 0.86, 0.9), smoothstep(0.0, 2.5, d));
          col += vec3(0.9, 1.0, 0.95) * caustic(wp.xz, mnTime) * 0.4 * (1.0 - smoothstep(0.2, 3.2, d)) * smoothstep(0.02, 0.25, d);
        }
        diffuseColor.rgb = col;
      }
    `,
    emissive: /* glsl */ `
      {
        float pulse = 0.82 + 0.18 * sin(mnTime * 2.2 + vMnWorld.x * 0.3 + vMnWorld.z * 0.2);
        float lavaFlow = texture2D(mnNoiseTex, vMnWorld.xz * 0.0625 + vec2(mnTime * 0.031, mnTime * 0.015)).b;
        // Kept orange-red so the 8-bit buffer does not clip it to flat yellow under bloom.
        vec3 lavaHot = mix(vec3(0.9, 0.2, 0.03), vec3(1.0, 0.52, 0.13), lavaFlow);
        float lavaW = smoothstep(0.35, 0.85, vMask.w);
        float crust = smoothstep(0.55, 0.7, texture2D(mnNoiseTex, vMnWorld.xz * 0.1125 - vec2(mnTime * 0.02, 0.0)).b);
        totalEmissiveRadiance += lavaHot * lavaW * (1.0 - crust * 0.8) * pulse * 1.35 * mnLavaPulse;
        // Cracks: mostly dim embers, with hot runs drifting slowly along them.
        float hot = smoothstep(0.55, 0.85, texture2D(mnNoiseTex, vMnWorld.xz * 0.045 + vec2(mnTime * 0.008, -mnTime * 0.006)).b);
        totalEmissiveRadiance += mix(vec3(0.34, 0.05, 0.02), vec3(1.0, 0.45, 0.1), hot) * mnTerrainCrack * pulse * (0.45 + 1.35 * hot) * mnLavaPulse;
        // Bloom: a soft glow over the lava flow (it is big), full glow on the hot crack runs.
        mnGlowSrc = lavaW * (1.0 - crust * 0.6) * 0.3 + mnTerrainCrack * hot;
      }
    `,
    uniforms: { mnLavaPulse: { value: 1 }, mnArena: { value: new THREE.Vector3(arena.x, arena.z, map.landmarks.arenaR) } },
  };
  const mesh = toonMesh(geo, { color: 0xffffff }, opts);
  mesh.userData.nm = normalMatFor({});
  mesh.material.userData.lavaU = opts.uniforms.mnLavaPulse;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  return mesh;
}

// Flat seabed under everything beyond the culled deep-ocean cells, so the water always has an
// opaque floor to measure depth against (no jagged edge where the terrain mesh stops).
export function createSeabed(map) {
  const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
  geo.rotateX(-Math.PI / 2);
  // Same toon lighting and sand tone as the deep terrain so the seam is invisible through the water.
  const mesh = toonMesh(geo, { color: new THREE.Color(0xf2dba0).multiplyScalar(0.32) }, { key: 'seabed', comic: false });
  mesh.receiveShadow = false;
  mesh.position.y = -7.56;
  mesh.name = 'seabed';
  mesh.frustumCulled = false;
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
