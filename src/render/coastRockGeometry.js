// Reuse one exported rock mesh as three silhouettes inside the existing collision radius.
import * as THREE from 'three';

export const COAST_ROCK_ID = 'model:coast-rock-v1';
export const COAST_ROCK_VARIANTS = Object.freeze([
  Object.freeze({ name: 'compact', x: 1, z: 1, height: 0.78 }),
  Object.freeze({ name: 'ledge', x: 1.25, z: 0.7, height: 0.56 }),
  Object.freeze({ name: 'low', x: 0.86, z: 1.16, height: 0.36 }),
]);

export function isCoastRock(map, p) {
  if (p.kind !== 'rock' || map.materialAt(p.x, p.z) !== 'sand') return false;
  const masks = map.masks(p.x, p.z);
  return masks.volcanic < 0.2 && masks.arenaFloor < 0.1 && masks.lava < 0.1 && masks.path < 0.2;
}

export function coastRockVariant(p, index = null) {
  if (Number.isInteger(index) && index >= 0) return index % 3;
  return Math.min(2, Math.max(0, Math.floor(p.v * 3)));
}

export function coastRockGeometry(source, variant = 0) {
  const style = COAST_ROCK_VARIANTS[variant];
  if (!style) throw new Error('Unknown coastal rock variant');
  const geo = source.index ? source.toNonIndexed() : source.clone();
  for (const key of Object.keys(geo.attributes)) if (key !== 'position') geo.deleteAttribute(key);
  geo.clearGroups();
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  const height = box.max.y - box.min.y;
  if (!(height > 0)) { geo.dispose(); throw new Error('Rock mesh has no height'); }
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const pos = geo.attributes.position;
  let radius = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = (pos.getX(i) - cx) * style.x, z = (pos.getZ(i) - cz) * style.z;
    const y = (pos.getY(i) - box.min.y) / height * style.height;
    pos.setXYZ(i, x, y, z);
    radius = Math.max(radius, Math.hypot(x, z));
  }
  if (!(radius > 0)) { geo.dispose(); throw new Error('Rock mesh has no footprint'); }
  // Worldgen's rock collider has radius 0.55 * scale. Leave a small margin at every rotation.
  const fit = 0.52 / radius;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * fit, pos.getY(i), pos.getZ(i) * fit);
  geo.computeVertexNormals();
  const normal = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const base = new THREE.Color(0x918d83), top = new THREE.Color(0xb8ae97), shade = new THREE.Color(0x746f73);
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / style.height;
    const upward = Math.max(0, normal.getY(i));
    color.copy(base).lerp(top, Math.min(1, 0.2 + t * 0.3 + upward * 0.3));
    color.lerp(shade, (1 - t) * 0.25);
    color.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.coastVariant = style.name;
  return geo;
}

// Embed the base below the lowest nearby terrain sample, without changing the shared map.
export function coastRockBase(map, p) {
  let base = map.heightAt(p.x, p.z);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, r = 0.48 * p.scale;
    base = Math.min(base, map.heightAt(p.x + Math.cos(angle) * r, p.z + Math.sin(angle) * r));
  }
  return base - 0.035 * p.scale;
}
