// Shared painted stone on existing boulders: geometric faces, restrained ink and wet feet.
import * as THREE from 'three';
import { toon } from './toon.js';
import { INK_GLSL, INK_WN } from './inkGlsl.js';

export function isNaturalRock(map, p) {
  if (p.kind !== 'rock') return false;
  const m = map.masks(p.x, p.z);
  return m.volcanic < .2 && m.arenaFloor < .1 && m.lava < .1;
}

export const ROCK_PALETTE = Object.freeze({ base: 0xaaa18d, light: 0xc9bda0, cool: 0x87828b, wet: 0x676b70 });

export function naturalRockMaterial(key = 'natural-rock-v1') {
  const uniforms = {
    mnRockBase: { value: new THREE.Color(ROCK_PALETTE.base) },
    mnRockLight: { value: new THREE.Color(ROCK_PALETTE.light) },
    mnRockCool: { value: new THREE.Color(ROCK_PALETTE.cool) },
    mnRockWet: { value: new THREE.Color(ROCK_PALETTE.wet) },
  };
  const material = toon({ color: 0xffffff, vertexColors: true }, {
    key, occluder: true, uniforms,
    vertPars: INK_WN.vertPars + 'varying vec3 vMnRockAnchor;\n',
    vertBody: INK_WN.vertBody + /* glsl */ `
      vec4 mnRockOrigin = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
      mnRockOrigin = instanceMatrix * mnRockOrigin;
      #endif
      vMnRockAnchor = (modelMatrix * mnRockOrigin).xyz;
    `,
    fragPars: INK_GLSL + INK_WN.fragPars + /* glsl */ `
      varying vec3 vMnRockAnchor;
      uniform vec3 mnRockBase;
      uniform vec3 mnRockLight;
      uniform vec3 mnRockCool;
      uniform vec3 mnRockWet;
    `,
    albedo: /* glsl */ `
      {
        vec3 wn = normalize(vMnWN);
        vec3 face = normalize(cross(dFdx(vMnWorld), dFdy(vMnWorld)));
        face *= dot(face, wn) < 0.0 ? -1.0 : 1.0;
        float top = smoothstep(-0.1, 0.75, face.y);
        float variation = mnHash(vMnRockAnchor.xz * 0.37 + 5.1);
        vec3 stone = mix(mnRockCool, mnRockBase, 0.55 + top * 0.45);
        stone = mix(stone, mnRockLight, top * (0.25 + variation * 0.15));
        stone *= 0.94 + variation * 0.12;
        // One existing RGBA noise read replaces the previous crack/brush reads.
        float detail = mnDetailFade();
        vec2 uv = mnTri(vMnWorld, face) * vec2(0.13, 0.085);
        vec2 gx = dFdx(uv), gy = dFdy(uv);
        vec4 paint = vec4(0.5, 1.0, 0.5, 0.5);
        if (detail > 0.01) paint = textureGrad(mnNoiseTex, uv, gx, gy);
        float chalk = smoothstep(0.57, 0.72, paint.b) * top * detail;
        stone = mix(stone, mnRockLight, chalk * 0.28);
        float fracture = mnLine(paint.g, 0.035) * smoothstep(0.54, 0.63, paint.b) * detail;
        float bevel = mnLine(abs(paint.g - 0.075), 0.022) * smoothstep(0.54, 0.63, paint.b) * detail;
        stone = mix(stone, mnRockLight, bevel * 0.18);
        stone = mix(stone, MN_INK, fracture * 0.55);
        // Height is the existing sea level; dry inland stones cannot get a painted wet base.
        float wet = 1.0 - smoothstep(0.02, 0.42, vMnWorld.y);
        stone = mix(stone, mix(stone * 0.63, mnRockWet, 0.2), wet);
        diffuseColor.rgb = stone;
      }
    `,
  });
  material.userData.rockPaint = { family: 'rock-faces-v1', palette: { ...ROCK_PALETTE },
    texturesAdded: 0, paintedFaces: true, wetHeight: [0.02, 0.42], uniforms };
  return material;
}
