// Repaint existing cargo geometry without changing silhouettes, fitting or registry-owned models.
import * as THREE from 'three';
import { townRect, townNeutral } from './townMaterials.js';
import { townCoverNeutral } from './townCovers.js';

export function portCargoGeometry(source, kind) {
  if (!['crate', 'barrel'].includes(kind)) throw new Error('Unknown cargo surface: ' + kind);
  const geometry = source.clone();
  geometry.computeBoundingBox();
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  const min = geometry.boundingBox.min.toArray(), max = geometry.boundingBox.max.toArray();
  const size = max.map((v, i) => v - min[i]);
  const at = (i, axis) => axis === 0 ? p.getX(i) : axis === 1 ? p.getY(i) : p.getZ(i);
  const unit = (i, axis) => size[axis] > 1e-8 ? (at(i, axis) - min[axis]) / size[axis] : .5;
  const uv = new Float32Array(p.count * 2), roles = { planks: 0, floor: 0, iron: 0 };
  // The native barrel is non-indexed. Classify each complete lathe triangle, so no UV
  // interpolation can cross atlas tiles at a hoop edge or at the angular seam.
  for (let start = 0; start < p.count; start += kind === 'barrel' && !geometry.index ? 3 : 1) {
    const count = kind === 'barrel' && !geometry.index ? Math.min(3, p.count - start) : 1;
    let y = 0, ny = 0;
    const angles = [];
    for (let j = 0; j < count; j++) {
      y += unit(start + j, 1) / count; ny += Math.abs(n.getY(start + j)) / count;
      angles.push(Math.atan2(p.getX(start + j), p.getZ(start + j)) / (2 * Math.PI) + .5);
    }
    const hoop = kind === 'barrel' && ny < .8 && ((y > .124 && y < .251) || (y > .749 && y < .876));
    const role = ny > .8 ? 'floor' : hoop ? 'iron' : 'planks', rect = townRect(role);
    const seam = Math.max(...angles) - Math.min(...angles) > .5;
    for (let j = 0; j < count; j++) {
      const i = start + j, nx = n.getX(i), nz = n.getZ(i);
      let u = ny > .8 ? unit(i, 0) : Math.abs(nx) > Math.abs(nz) ? unit(i, 2) : unit(i, 0);
      let v = ny > .8 ? unit(i, 2) : unit(i, 1);
      if (kind === 'barrel' && ny < .8) {
        u = seam && angles[j] < .5 ? 1 : angles[j];
        if (hoop) {
          // Crop only the painted top iron strap, excluding the wood between straps.
          const base = y < .5 ? .125 : .75;
          v = .835 + THREE.MathUtils.clamp((unit(i, 1) - base) / .125, 0, 1) * .06;
        }
      } else if ((Math.abs(nx) > Math.abs(nz) && nx > 0) || (Math.abs(nz) >= Math.abs(nx) && nz < 0)) u = 1 - u;
      // The accepted open crate has horizontal wall boards; rotate the supplied vertical grain.
      if (kind === 'crate' && ny < .8) [u, v] = [v, u];
      uv[i * 2] = rect.u0 + THREE.MathUtils.clamp(u, 0, 1) * (rect.u1 - rect.u0);
      uv[i * 2 + 1] = rect.v0 + THREE.MathUtils.clamp(v, 0, 1) * (rect.v1 - rect.v0);
      roles[role]++;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('aTownWood', new THREE.BufferAttribute(new Float32Array(p.count).fill(1), 1));
  townCoverNeutral(townNeutral(geometry));
  geometry.userData.portCargo = { family: 'port-cargo-v1', kind, roles, texturesAdded: 0 };
  return geometry;
}

// The registry owns the original geometry/material. Only these fitted static instances get clones.
export function paintPortCargoInstances(group, material) {
  group.traverse(mesh => {
    if (!mesh.isInstancedMesh) return;
    mesh.geometry = portCargoGeometry(mesh.geometry, 'crate');
    mesh.material = material;
    mesh.userData.portCargo = { ...mesh.geometry.userData.portCargo, instances: mesh.count };
  });
  return group;
}
