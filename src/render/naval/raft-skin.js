// Local art study: authored board UVs, restrained lighting relief and weathered sailcloth.
// Textures belong to this study, not the eager main-game asset registry.
import * as THREE from 'three';
import { mapRaftUV } from '../../render/raftMaterials.js';
import { toon } from '../../render/toon.js';

// Horizontal boards, inset from the sheet's black gutters. Image-space pixels are from
// the author's 2048-square pair; albedo and tangent normals use exactly the same UVs.
const board = (left, top, right, bottom) => Object.freeze({
  u0: left / 2048, v0: 1 - bottom / 2048, u1: right / 2048, v1: 1 - top / 2048,
});
export const WOOD_BOARD_RECTS = Object.freeze([
  board(1055, 287, 2018, 508), board(1055, 550, 2018, 752),
  board(40, 1050, 985, 1242), board(40, 1585, 985, 1772),
]);

export function mapWoodBoardUV(geometry, kind, options = {}) {
  if (kind !== 'wood') return false;
  const value = Number.isFinite(options.variant) ? Math.trunc(options.variant) : 0;
  const variant = ((value % WOOD_BOARD_RECTS.length) + WOOD_BOARD_RECTS.length) % WOOD_BOARD_RECTS.length;
  return mapRaftUV(geometry, kind, { ...options, rect: WOOD_BOARD_RECTS[variant], woodSlice: false });
}

const CLOTH_GRADE = /* glsl */ `{
  vec3 mnClothPaint = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(0.4545));
  float mnClothValue = dot(mnClothPaint, vec3(0.2126, 0.7152, 0.0722));
  // Preserve the painted seams and patch values while bringing red/cream into grey-green.
  vec3 mnClothGrey = mix(mnClothPaint, vec3(mnClothValue) * vec3(0.88, 0.95, 0.88), 0.91);
  diffuseColor.rgb = pow(mnClothGrey, vec3(2.2));
}`;

export function createNavalRaftSkin({ albedo = null, normal = null, mobile = false } = {}) {
  const materials = new Set();
  let relief = mobile || !normal ? 'flat' : 'soft', disposed = false;
  if (albedo) albedo.colorSpace = THREE.SRGBColorSpace;
  if (normal) normal.colorSpace = THREE.NoColorSpace;
  for (const texture of [albedo, normal]) if (texture) {
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = mobile ? 1 : 4;
    texture.generateMipmaps = true;
  }
  const applyRelief = (material) => {
    const next = relief === 'flat' ? null : normal;
    const changed = material.normalMap !== next;
    material.normalMap = next;
    material.normalScale.set(0.28, relief === 'flipped' ? -0.28 : 0.28);
    if (changed) material.needsUpdate = true;
  };
  return {
    mapUV: (geometry, kind, options) => albedo && !disposed ? mapWoodBoardUV(geometry, kind, options) : false,
    material(spec, { atlas } = {}) {
      if (disposed) return null;
      if (spec.kind === 'wood' && albedo) {
        const tint = spec.color === 0x704522 ? 0xc4c4c4 : spec.color === 0xd6a565 ? 0xffffff : 0xefefef;
        const material = toon({ color: tint, map: albedo }, {
          occluder: true, key: 'naval-author-boards-v2', hatchMask: '0.0',
        });
        material.name = 'naval:author-wood';
        applyRelief(material); materials.add(material);
        material.addEventListener('dispose', () => materials.delete(material));
        return material;
      }
      if (spec.kind === 'cloth' && atlas) return toon({ color: 0xffffff, map: atlas, side: THREE.DoubleSide }, {
        occluder: true, key: 'naval-weathered-cloth-v2', albedo: CLOTH_GRADE, hatchMask: '0.0',
      });
      return null;
    },
    setRelief(mode) {
      if (!['flat', 'soft', 'flipped'].includes(mode)) throw new Error('Unknown raft relief mode');
      relief = normal ? mode : 'flat';
      for (const material of materials) applyRelief(material);
    },
    diagnostics: () => ({
      albedo: albedo ? { src: albedo.userData.source, width: albedo.image?.width, height: albedo.image?.height } : null,
      normal: normal ? { src: normal.userData.source, width: normal.image?.width, height: normal.image?.height } : null,
      relief, mobile, disposed, woodMaterials: materials.size,
    }),
    dispose() {
      if (disposed) return;
      disposed = true; materials.clear(); albedo?.dispose(); normal?.dispose();
    },
  };
}

function loadImageTexture(url) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => { finished = true; reject(new Error(`Texture timed out: ${url}`)); }, 8000);
    new THREE.TextureLoader().load(url, (texture) => {
      if (finished) { texture.dispose(); return; }
      finished = true; clearTimeout(timer); texture.userData.source = url; resolve(texture);
    }, undefined, (error) => {
      if (finished) return;
      finished = true; clearTimeout(timer); reject(error);
    });
  });
}

export async function loadNavalRaftSkin({ mobile = false, loadTexture = loadImageTexture } = {}) {
  const base = '/assets/textures/raft/wood-boards-v2';
  // Mobile starts with the painted albedo alone: no normal request, decode or texture sample.
  const urls = [`${base}${mobile ? '-mobile' : ''}.webp`, ...(!mobile ? [`${base}-normal.webp`] : [])];
  const loaded = await Promise.allSettled(urls.map((url) => loadTexture(url)));
  return createNavalRaftSkin({ albedo: loaded[0].status === 'fulfilled' ? loaded[0].value : null,
    normal: loaded[1]?.status === 'fulfilled' ? loaded[1].value : null, mobile });
}
