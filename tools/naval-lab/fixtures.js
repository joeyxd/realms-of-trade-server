// Only synthetic ballast belongs here. It has no item id, price, capacity, owner or save identity.
import { STARTER_RAFT } from '../../src/data/raftparts.js';
const starter = () => STARTER_RAFT.map((p) => [...p]);
const foundations = (w, d) => Array.from({ length: w * d }, (_, i) => ['foundation', i % w, Math.floor(i / w), 0]);
const house = [...foundations(4, 4), ['sail', 0, 0, 0], ['sail', 3, 0, 0], ['crate', 0, 3, 0], ['crate', 3, 3, 0],
  ['pillar', 1, 2, 0], ['pillar', 2, 2, 0], ['floor', 1, 2, 1], ['floor', 2, 2, 1],
  ['wall', 1, 2, 1, 0], ['wall', 2, 2, 1, 0], ['bed', 1, 2, 1], ['roof', 1, 2, 1], ['roof', 2, 2, 1]];
export const LAB_FIXTURES = [
  { id: 'empty', name: 'Balsa ligera', detail: 'La balsa inicial, sin lastre.', parts: starter(), cargo: [] },
  { id: 'center', name: 'Carga centrada', detail: '24 de lastre cerca del centro.', parts: starter(), cargo: [{ mass: 24, x: 2, z: 2, height: 0.4 }] },
  { id: 'rim', name: 'Carga en extremos', detail: 'Mismo peso, repartido en cuatro esquinas.', parts: starter(), cargo: [
    { mass: 6, x: 0.45, z: 0.45, height: 0.4 }, { mass: 6, x: 3.55, z: 0.45, height: 0.4 },
    { mass: 6, x: 0.45, z: 3.55, height: 0.4 }, { mass: 6, x: 3.55, z: 3.55, height: 0.4 }] },
  { id: 'side', name: 'Carga alta a un lado', detail: 'Mismo peso; desequilibrio y altura penalizan el timón.', parts: starter(), cargo: [{ mass: 24, x: 3.55, z: 2, height: 3.2 }] },
  { id: 'house', name: 'Casa flotante 4 × 4', detail: 'Más cubierta, vivienda y dos velas; mayor resistencia al giro.', parts: house, cargo: [{ mass: 48, x: 4, z: 4, height: 0.4 }] },
];
export const LAB_WINDS = [
  { id: 'tail', name: 'A favor · sur ↓', yaw: 0, strength: 1 },
  { id: 'cross', name: 'Lateral · este →', yaw: Math.PI / 2, strength: 1 },
  { id: 'head', name: 'En contra · norte ↑', yaw: Math.PI, strength: 1 },
  { id: 'calm', name: 'Calma · ayuda de remo', yaw: 0, strength: 0 },
];
export function labFixture(id = 'empty') {
  const found = LAB_FIXTURES.find((f) => f.id === id);
  if (!found) throw new TypeError('Unknown lab fixture');
  return { ...found, parts: found.parts.map((p) => [...p]), cargo: found.cargo.map((c) => ({ ...c })) };
}
