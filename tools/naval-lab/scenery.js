import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ico, lumpy, part } from '../../src/render/geo.js';
import { LAYER } from '../../src/render/pipeline.js';

const ROCKS = Object.freeze([
  { x: -108, z: 92, width: 32, depth: 26, height: 16, form: 'low', color: 0x718692, seed: 11 },
  { x: 132, z: 118, width: 42, depth: 33, height: 27, form: 'ridge', color: 0x7b8e98, seed: 17 },
  { x: -154, z: 158, width: 46, depth: 35, height: 52, form: 'spire', color: 0x657d8b, seed: 23 },
  { x: 105, z: 184, width: 35, depth: 30, height: 21, form: 'low', color: 0x8999a0, seed: 29 },
  { x: -94, z: 224, width: 38, depth: 34, height: 30, form: 'ridge', color: 0x758994, seed: 31 },
  { x: 178, z: 244, width: 48, depth: 40, height: 63, form: 'spire', color: 0x627987, seed: 37 },
  { x: -208, z: 292, width: 58, depth: 45, height: 43, form: 'ridge', color: 0x7b8e98, seed: 41 },
  { x: 92, z: 322, width: 34, depth: 29, height: 18, form: 'low', color: 0x82939c, seed: 43 },
  { x: 226, z: 344, width: 52, depth: 43, height: 56, form: 'spire', color: 0x687f8c, seed: 47 },
]);
const SKYLINE_CORRIDOR_HALF_WIDTH = 60;

function colorAt(hex, y, seed, index) {
  const base = new THREE.Color(hex);
  const facet = ((Math.imul(seed + 1, index * 0x45d9f3b) >>> 0) % 13) / 100;
  const height = y > 0.18 ? 0.13 : -0.12;
  return base.multiplyScalar(0.94 + facet + height);
}

function addRockPiece(target, rock, { scale, position, seed, pointed = false, detail = 0 }) {
  const geometry = pointed
    ? new THREE.ConeGeometry(0.7, 1, 5, 1)
    : ico(0.7, detail);
  const rough = lumpy(geometry, pointed ? 0.08 : 0.18, seed);
  target.push(part(rough, 0xffffff, {
    scale, pos: position,
    paint: (_x, y, _z) => colorAt(rock.color, y, seed, Math.round((y + 1) * 13)),
  }));
}

function rockGeometry() {
  const pieces = [];
  for (const rock of ROCKS) {
    const { width: w, depth: d, height: h, seed } = rock;
    addRockPiece(pieces, rock, {
      scale: [w * 0.52, h * 0.7, d * 0.52], position: [rock.x, h * 0.27, rock.z], seed: seed + 1, detail: 1,
    });
    if (rock.form !== 'low') {
      const side = seed % 2 ? -1 : 1;
      addRockPiece(pieces, rock, {
        scale: [w * (rock.form === 'ridge' ? 0.32 : 0.27), h * 0.3, d * 0.3],
        position: [rock.x + side * w * 0.18, h * 0.49, rock.z - d * 0.05], seed: seed + 3, detail: 0,
      });
    }
    if (rock.form === 'ridge') {
      addRockPiece(pieces, rock, {
        scale: [w * 0.28, h * 0.23, d * 0.26],
        position: [rock.x - w * 0.2, h * 0.38, rock.z + d * 0.12], seed: seed + 5, detail: 0,
      });
    } else if (rock.form === 'spire') {
      addRockPiece(pieces, rock, {
        scale: [w * 0.17, h * 0.45, d * 0.18],
        position: [rock.x + w * 0.12, h * 0.78, rock.z + d * 0.04], seed: seed + 7, pointed: true,
      });
    }
  }
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  merged.computeBoundingSphere();
  return merged;
}

function assertClearCorridor() {
  for (const rock of ROCKS) {
    const reachesCentralWater = Math.abs(rock.x) - rock.width * 0.52 < SKYLINE_CORRIDOR_HALF_WIDTH;
    if (rock.z <= 120 && reachesCentralWater) throw new Error('Naval scenery blocks the central water corridor');
  }
}

/** Static distant shoreline silhouettes for the isolated naval lab only. */
export class NavalLabScenery {
  constructor(scene, { mobile = false } = {}) {
    if (!scene?.add) throw new TypeError('NavalLabScenery requires a Three.js scene');
    assertClearCorridor();
    this.scene = scene;
    this.mobile = !!mobile;
    this.disposed = false;
    this.updateCount = 0;
    this.lastCenter = { x: 0, z: 0 };
    this.geometry = rockGeometry();
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, fog: true, toneMapped: false });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'naval-lab-distant-rocks';
    this.mesh.layers.set(LAYER.WORLD);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  update({ x = 0, z = 0, paused = false } = {}) {
    if (this.disposed || paused) return;
    this.lastCenter = { x: Number.isFinite(x) ? x : 0, z: Number.isFinite(z) ? z : 0 };
    this.updateCount++;
  }

  reset() {
    this.updateCount = 0;
    this.lastCenter = { x: 0, z: 0 };
  }

  diagnostics() {
    return {
      disposed: this.disposed, mobile: this.mobile, formations: ROCKS.length, meshes: this.mesh ? 1 : 0,
      vertices: this.geometry?.attributes.position.count || 0,
      triangles: this.geometry?.index ? this.geometry.index.count / 3 : (this.geometry?.attributes.position.count || 0) / 3,
      clearCorridorHalfWidth: SKYLINE_CORRIDOR_HALF_WIDTH, maxHeight: Math.max(...ROCKS.map((rock) => rock.height)),
      updateCount: this.updateCount, lastCenter: { ...this.lastCenter },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.mesh = null;
    this.geometry = null;
    this.material = null;
  }
}
