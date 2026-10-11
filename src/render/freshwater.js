// Static visual landmark for the authoritative Salty Shore spring.
import * as THREE from 'three';
import { freshwaterSource } from '../data/freshwater.js';
import { normalMatFor, toon } from './toon.js';

export function createFreshwaterSpring(map) {
  const source = freshwaterSource(map);
  if (!source || !Number.isFinite(source.y)) return null;
  const group = new THREE.Group();
  group.name = `freshwater-source:${source.id}`;
  group.position.set(source.x, source.y, source.z);

  const stone = toon({ color: 0x77736d }, { occluder: true, key: 'freshwater-spring-stone' });
  const normal = normalMatFor({ occluder: true, lineW: 0.65 });
  const water = new THREE.MeshBasicMaterial({ color: 0x248dba, transparent: true, opacity: 0.92, depthWrite: true });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.25, 20), water);
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.06; pool.receiveShadow = true;
  group.add(pool);
  // Individual uneven stones make a low basin rim rather than a perfect well wall.
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI * 2 / 12, radius = 1.58 + (i % 3) * 0.035;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45 + (i % 2) * 0.08, 0), stone);
    rock.position.set(Math.cos(angle) * radius, 0.25 + (i % 3) * 0.025, Math.sin(angle) * radius);
    rock.scale.set(1.2, 0.62 + (i % 2) * 0.14, 0.9);
    rock.rotation.y = angle * 0.37; rock.castShadow = true; rock.receiveShadow = true;
    rock.userData.nm = normal;
    group.add(rock);
  }
  group.userData.freshwaterSource = { id: source.id, radius: source.radius };
  return group;
}
