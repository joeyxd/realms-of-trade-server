// World-anchored DOM: nameplates (scale with distance, hide when they would cover the player),
// tutorial prompts and NPC speech bubbles. Pooled elements, transforms only.
import * as THREE from 'three';
import { clamp } from '../core/math.js';

const v = new THREE.Vector3();

export class WorldUI {
  constructor(root, camera) {
    this.root = root;
    this.camera = camera;
    this.plates = new Map();
    this.prompts = new Map();
    this.bubbles = new Map();
    this.w = innerWidth; this.h = innerHeight;
    this.playerRect = { x: 0, y: 0, w: 0, h: 0 };
  }

  resize(w, h) { this.w = w; this.h = h; }

  project(pos, out) {
    v.copy(pos).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.w;
    out.y = (-v.y * 0.5 + 0.5) * this.h;
    out.vis = v.z < 1 && v.z > -1 && out.x > -100 && out.x < this.w + 100 && out.y > -60 && out.y < this.h + 60;
    return out;
  }

  addNameplate(id, { name, level, title, kind }) {
    const el = document.createElement('div');
    el.className = 'nameplate' + (kind === 'npc' ? ' npc' : '');
    el.innerHTML = `${title ? `<div class="np-title">«${title}»</div>` : ''}<div class="np-name"><span class="lv">${kind === 'npc' ? '' : 'Nv ' + level}</span>${name}</div>${kind === 'npc' ? '' : '<div class="np-hp"><i style="width:100%"></i></div>'}`;
    this.root.appendChild(el);
    this.plates.set(id, { el, anchor: new THREE.Vector3(), p: { x: 0, y: 0, vis: false }, shown: true });
  }

  removeNameplate(id) {
    const p = this.plates.get(id);
    if (p) { p.el.remove(); this.plates.delete(id); }
  }

  setPrompt(id, html, { below = false } = {}) {
    let p = this.prompts.get(id);
    if (!p) {
      const el = document.createElement('div');
      el.className = 'prompt frame-dark';
      this.root.appendChild(el);
      p = { el, anchor: new THREE.Vector3(), p: { x: 0, y: 0, vis: false }, html: '' };
      this.prompts.set(id, p);
    }
    if (p.html !== html || p.below !== below) {
      p.el.innerHTML = html + (below ? '' : '<span class="arrow"></span>');
      p.el.classList.toggle('below', below);
      p.html = html; p.below = below;
    }
    p.el.hidden = false;
    return p;
  }

  hidePrompt(id) { const p = this.prompts.get(id); if (p) p.el.hidden = true; }

  bubble(id, html, ms = 4500) {
    let b = this.bubbles.get(id);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'bubble';
      this.root.appendChild(el);
      b = { el, anchor: new THREE.Vector3(), p: { x: 0, y: 0, vis: false }, until: 0 };
      this.bubbles.set(id, b);
    }
    b.el.innerHTML = html;
    b.until = performance.now() + ms;
    b.el.hidden = false;
    return b;
  }

  place(el, p, scale, lift = 0, below = false) {
    el.style.transform = `translate3d(${p.x}px, ${p.y - lift}px, 0) translate(-50%, ${below ? '0' : '-100%'}) scale(${scale})`;
  }

  // anchors: Map id -> {pos: Vector3, dist}; player: screen position of the player (for occlusion).
  update(anchors, playerScreen) {
    const pr = this.playerRect;
    pr.x = playerScreen.x - 40; pr.y = playerScreen.y - 110; pr.w = 80; pr.h = 120;
    const now = performance.now();
    for (const [id, plate] of this.plates) {
      const a = anchors.get(id);
      if (!a) { plate.el.hidden = true; continue; }
      const talking = this.bubbles.has(id) && now < this.bubbles.get(id).until;
      this.project(a.pos, plate.p);
      const s = clamp(21 / Math.max(a.dist, 1), 0.55, 1.1);
      const covers = plate.p.x > pr.x && plate.p.x < pr.x + pr.w && plate.p.y > pr.y && plate.p.y < pr.y + pr.h + 30;
      const show = plate.p.vis && a.dist < 42 && !covers && !a.hide && !talking;
      if (show !== plate.shown) { plate.el.hidden = !show; plate.shown = show; }
      if (show) { this.place(plate.el, plate.p, s); plate.el.style.opacity = String(clamp((42 - a.dist) / 8, 0, 1)); }
    }
    for (const [id, b] of this.bubbles) {
      const a = anchors.get(id);
      if (!a || now > b.until) { b.el.hidden = true; continue; }
      this.project(a.pos, b.p);
      b.el.hidden = !b.p.vis;
      if (b.p.vis) this.place(b.el, b.p, clamp(21 / Math.max(a.dist, 1), 0.7, 1.05), 34);
    }
    for (const [id, pm] of this.prompts) {
      if (pm.el.hidden) continue;
      const a = anchors.get(id);
      if (!a) { pm.el.hidden = true; continue; }
      this.project(a.pos, pm.p);
      if (pm.p.vis) this.place(pm.el, pm.p, 1, pm.below ? -14 : 12, pm.below);
    }
  }
}
