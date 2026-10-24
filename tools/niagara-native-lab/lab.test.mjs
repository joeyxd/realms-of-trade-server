import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PilotParticles, toScene, validateFrame } from '../../src/render/vfx/niagara/particles.js';

const frame = () => ({ schema: 'st01c-cpu-frame/v1', systemAge: 1,
  emitters: ['NE_Flame_Basic_001', 'NE_Smoke_Basic'].map(name => ({ name, particles: [{
    position: [100, 200, 300], size: [120, 140], color: [40, .7, .2, 1], rotation: 20, subImage: 3
  }] })) });

test('rejects malformed source frames before GPU upload', () => {
  for (const mutate of [
    f => { f.emitters.reverse(); }, f => { f.emitters[0].particles[0].position[0] = Infinity; },
    f => { f.emitters[1].particles[0].color.pop(); },
    f => { f.emitters[0].particles = Array(513).fill(f.emitters[0].particles[0]); },
    f => { f.systemAge = NaN; }, f => { f.emitters[0].particles[0].size[1] = -1; }
  ]) { const f = frame(); mutate(f); assert.throws(() => validateFrame(f)); }
});

test('observed attributes keep independent 3D centers and survive layer toggling without source mutation', () => {
  const scene = new THREE.Scene(), textures = [new THREE.Texture(), new THREE.Texture()];
  const particles = new PilotParticles(scene, textures), source = frame(), before = structuredClone(source);
  particles.update(source);
  assert.equal(particles.count, 2);
  assert.deepEqual(toScene([100, 200, 300]), [2, 3, -1]);
  assert.deepEqual(Array.from(particles.layers[0].geometry.attributes.particlePosition.array.slice(0, 3)), [2, 3, -1]);
  assert.equal(particles.layers[0].material.toneMapped, false);
  particles.update(source, [false, true]); assert.equal(particles.count, 1);
  assert.deepEqual(source, before);
  let disposed = 0;
  particles.layers.forEach(m => { m.geometry.addEventListener('dispose', () => disposed++); m.material.addEventListener('dispose', () => disposed++); });
  particles.dispose(); particles.dispose();
  assert.equal(disposed, 4); assert.equal(scene.children.length, 0);
  textures.forEach(t => t.dispose());
});
