// Local lights: lanterns, braziers, the campfire, lava, hut windows at night, sentinel eyes, the
// player's light radius and short flashes (dash, later hits). No three.js lights: the nearest few
// go into two uniform arrays and every lit shader evaluates them in the same banded style as the
// sun (toon.js / water.js). Selection never pops: each chosen light fades out as the first light
// left out gets as close as it, so a swap happens at zero weight.
import * as THREE from 'three';
import { U, MAX_LIGHTS } from './toon.js';

export { MAX_LIGHTS };

// Light kinds: base color, intensity, radius, flicker amount/speed, wrap, which preset knob scales it.
const KINDS = {
  lantern: { color: 0xffb35a, i: 2.6, r: 7.5, flicker: 0.08, speed: 1.6, wrap: 0.35, knob: 'fire' },
  brazier: { color: 0xff7a2a, i: 3.6, r: 9.5, flicker: 0.2, speed: 2.6, wrap: 0.35, knob: 'fire' },
  campfire: { color: 0xff8a32, i: 3.8, r: 10, flicker: 0.24, speed: 2.9, wrap: 0.35, knob: 'fire' },
  lava: { color: 0xff5a1e, i: 3.0, r: 12, flicker: 0.1, speed: 0.6, wrap: 0.5, knob: 'lava' },
  window: { color: 0xffa648, i: 2.2, r: 6, flicker: 0.05, speed: 0.9, wrap: 0.2, knob: 'night' },
  eyes: { color: 0x5ad8ff, i: 1.4, r: 3.2, flicker: 0, speed: 0, wrap: 0.6, knob: 'eyes' },
  // Soft up-light from the glowing cracks of the Caldera floor.
  arena: { color: 0xff5a24, i: 1.5, r: 20, flicker: 0.06, speed: 0.5, wrap: 0.85, knob: 'lava' },
};

// Points on the lava river and crater: greedy picks on a 3 u grid, at least 9 u apart (also used
// by the lava bubbles in effects.js).
const lavaCache = new WeakMap();
export function lavaPoints(map) {
  if (lavaCache.has(map)) return lavaCache.get(map);
  const picks = [];
  const half = map.size / 2;
  for (let z = -half; z < half; z += 3) {
    for (let x = -half; x < half; x += 3) {
      if (map.masks(x, z).lava < 0.75) continue;
      if (picks.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < 81)) continue;
      picks.push({ x, y: map.heightAt(x, z), z });
    }
  }
  lavaCache.set(map, picks);
  return picks;
}

export class LocalLights {
  constructor(map) {
    this.sources = [];
    this.flashes = [];
    this.max = 8;
    this.time = 0;
    this.knobs = { fire: 1, lava: 1, night: 0, eyes: 1, player: 0 };
    this.playerColor = new THREE.Color(0xffe4c4);
    this.playerPos = new THREE.Vector3();
    this.picked = [];
    const add = (kind, x, y, z, extra = {}) => {
      const k = KINDS[kind];
      this.sources.push({
        kind, x, y, z, r: extra.r ?? k.r, i: extra.i ?? k.i, color: new THREE.Color(extra.color ?? k.color),
        flicker: k.flicker, speed: k.speed, wrap: k.wrap, knob: k.knob, seed: this.sources.length * 1.618 + 0.37, d: 0, w: 0,
      });
    };
    for (const p of map.props) {
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      // Local (lx, lz) offset rotated like the prop (three.js Y rotation).
      const at = (lx, ly, lz) => [p.x + lx * c + lz * s, p.y + ly, p.z - lx * s + lz * c];
      if (p.kind === 'lantern') add('lantern', ...at(0.42, 1.8, 0));
      else if (p.kind === 'brazier') add('brazier', p.x, p.y + 1.6, p.z);
      else if (p.kind === 'gatePost') add('brazier', p.x, p.y + 5.2, p.z, { r: 10 });
      else if (p.kind === 'campfire') add('campfire', p.x, p.y + 0.8, p.z);
      else if (p.kind === 'hut') add('window', ...at(0.7, 2.2, 2.6));
    }
    // Sentinel eyes: start at the spawn points; the scene moves them with the enemies (follow()).
    for (const sp of map.enemySpawns || []) {
      if (sp.kind !== 'sentinel') continue;
      add('eyes', sp.x + Math.sin(sp.facing) * 0.45, map.groundAt(sp.x, sp.z) + 1.6, sp.z + Math.cos(sp.facing) * 0.45);
      this.sources[this.sources.length - 1].follow = true;
    }
    // Lava: a light a little above each lava point.
    for (const q of lavaPoints(map)) add('lava', q.x, q.y + 1.4, q.z);
    const A = map.landmarks.arena;
    add('arena', A.x, map.groundAt(A.x, A.z) + 1.2, A.z, { r: map.landmarks.arenaR + 6 });
  }

  // Short-lived light (dash, hits). Fades with (1 - t)^2.
  flash(x, y, z, color, radius = 5, intensity = 3, life = 0.3) {
    let f = this.flashes.find((q) => q.t >= q.life);
    if (!f) { if (this.flashes.length >= 6) return; f = { color: new THREE.Color() }; this.flashes.push(f); }
    Object.assign(f, { x, y, z, r: radius, i: intensity, life, t: 0 });
    f.color.set(color);
  }

  update(dt, focus, playerPos) {
    this.time += dt;
    const t = this.time, K = this.knobs;
    let n = 0;
    const pos = U.mnLightPos.value, col = U.mnLightCol.value;
    const put = (x, y, z, r, color, intensity, wrap) => {
      if (n >= this.max || intensity < 0.01) return;
      pos[n].set(x, y, z, r);
      col[n].set(color.r * intensity, color.g * intensity, color.b * intensity, wrap);
      n++;
    };
    // Static sources get a fixed number of slots (so a flash or the player light turning on never
    // pushes one out abruptly); the player light and flashes use the reserved ones.
    const reserve = this.max >= 8 ? 2 : 1;
    const slots = this.max - reserve;
    // Rank by distance from the focus minus part of the radius (big lights count from farther).
    const list = this.picked;
    list.length = 0;
    for (const s of this.sources) {
      s.w = 0;
      const knob = K[s.knob] ?? 1;
      if (knob < 0.01) continue;
      s.d = Math.hypot(s.x - focus.x, s.z - focus.z) - s.r * 0.5;
      if (s.d > 40) continue;
      list.push(s);
    }
    list.sort((a, b) => a.d - b.d);
    const cut = list.length > slots ? list[slots].d : 40;
    for (let i = 0; i < Math.min(slots, list.length); i++) {
      const s = list[i];
      const fade = Math.min(1, (cut - s.d) / 6) * (1 - THREE.MathUtils.smoothstep(s.d, 30, 40));
      if (fade <= 0) continue;
      s.w = fade;
      // Flicker: two incommensurate sines + a faster jitter, never below 1 - 2*amount.
      const fl = 1 + s.flicker * (Math.sin(t * s.speed * 3.1 + s.seed * 7) * 0.6 + Math.sin(t * s.speed * 7.3 + s.seed * 3) * 0.4 + Math.sin(t * s.speed * 17 + s.seed) * 0.3);
      put(s.x, s.y + (s.flicker > 0.15 ? Math.sin(t * 9 + s.seed) * 0.08 : 0), s.z, s.r, s.color, s.i * fl * fade * K[s.knob], s.wrap);
    }
    // Player light radius (dusk and night), then flashes while there is room.
    if (playerPos && K.player > 0.01) put(playerPos.x, playerPos.y + 2.2, playerPos.z, 6, this.playerColor, 1.4 * K.player, 0.6);
    for (const f of this.flashes) {
      if (f.t >= f.life) continue;
      f.t += dt;
      const k = Math.max(0, 1 - f.t / f.life);
      put(f.x, f.y, f.z, f.r, f.color, f.i * k * k, 0.6);
    }
    U.mnLightCount.value = n;
  }
}
