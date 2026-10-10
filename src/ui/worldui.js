// World-anchored DOM: nameplates (scale with distance, hide when they would cover the player; enemies
// show their HP), tutorial prompts, NPC speech bubbles, floating damage numbers and combat callouts
// (¡PERFECTO!, ROCE, FANTASMA, chain). Pooled elements, transforms only.
import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { stage } from './stage.js';
import { dataText, onLocaleChange, setText, t } from '../core/i18n.js';

const v = new THREE.Vector3();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class WorldUI {
  constructor(root, camera) {
    this.root = root;
    this.camera = camera;
    this.plates = new Map();
    this.prompts = new Map();
    this.bubbles = new Map();
    this.chatBubbles = new Map();
    this._localeUnsubscribe = onLocaleChange(() => {
      for (const b of this.chatBubbles.values()) {
        if (!b.labelKey) continue;
        const params = { ...b.labelParams };
        if (b.labelNameKey && Object.hasOwn(params, 'name')) params.name = t(b.labelNameKey);
        setText(b.labelEl, b.labelKey, params);
      }
    });
    this.labels = new Map(); // loot on the ground (M4): its name in its rarity's colour
    this.w = stage.w; this.h = stage.h;
    this.playerRect = { x: 0, y: 0, w: 0, h: 0 };
    this.floats = [];
    this.floatCursor = 0;
    for (let i = 0; i < 36; i++) {
      const el = document.createElement('div');
      el.className = 'fnum';
      el.hidden = true;
      root.appendChild(el);
      this.floats.push({ el, pos: new THREE.Vector3(), p: { x: 0, y: 0, vis: false }, t: 0, life: 0, active: false, dx: 0, rise: 0, lift: 0, w: 0, h: 0, sx: undefined, sy: undefined });
    }
  }

  // Floating text at a world position. cls: dmg | crit | hurt | xp | heal | immune | callout | perfect | graze | ghost | chain
  float(x, y, z, html, cls = 'dmg', { life = 0.9, rise = 46, spread = 18 } = {}) {
    const f = this.floats[this.floatCursor];
    this.floatCursor = (this.floatCursor + 1) % this.floats.length;
    f.el.className = 'fnum ' + cls;
    f.el.innerHTML = html;
    f.el.hidden = false;
    f.el.style.opacity = '1';
    f.pos.set(x, y, z);
    f.t = 0; f.life = life; f.active = true; f.rise = rise;
    f.dx = (Math.random() - 0.5) * spread;
    // restart the pop animation
    f.el.style.animation = 'none'; void f.el.offsetWidth; f.el.style.animation = '';
    // Stack above recent floats it would cover on screen (a perfect parry, its chain, the XP and the
    // damage numbers can all pop at once around the same spot).
    f.w = f.el.offsetWidth; f.h = f.el.offsetHeight; f.lift = 0;
    this.project(f.pos, f.p);
    for (let pass = 0; pass < 6 && f.p.vis; pass++) {
      let moved = false;
      for (const o of this.floats) {
        if (o === f || !o.active || o.t > 0.6 || o.sy === undefined) continue;
        const fy = f.p.y - f.lift;
        if (Math.abs(o.sx - f.p.x) < (o.w + f.w) * 0.5 - 4 && fy > o.sy - o.h + 2 && fy - f.h < o.sy - 2) {
          f.lift += fy - (o.sy - o.h) + 2;
          moved = true;
        }
      }
      if (!moved) break;
    }
    f.sx = f.p.x; f.sy = f.p.y - f.lift;
    return f;
  }

  setPlate(id, { hp, maxHp, level } = {}) {
    const p = this.plates.get(id);
    if (!p) return;
    if (hp !== undefined && p.hpEl) {
      const fr = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 1;
      if (fr !== p.fr) { p.hpEl.style.width = (fr * 100).toFixed(1) + '%'; p.fr = fr; }
    }
    if (level !== undefined && p.lvEl && level !== p.level) { p.lvEl.innerHTML = `${dataText('Nv')} ${level}`; p.level = level; }
  }

  // A pirate who can hurt you right now (both inside the Cala Calavera, M4.5): red, with a skull.
  setPlateHostile(id, on) {
    const p = this.plates.get(id);
    if (!p || !!p.hostile === on) return;
    p.hostile = on;
    p.el.classList.toggle('hostile', on);
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
    // ally: another human pirate (online); player: a bot.
    el.className = 'nameplate' + (kind === 'npc' ? ' npc' : kind === 'enemy' ? ' enemy' : kind === 'minor' ? ' enemy minor' : kind === 'practice' ? ' practice' : kind === 'ally' ? ' ally' : '');
    const authored = kind === 'ally';
    name = authored ? esc(name) : dataText(name);
    title = title ? (authored ? esc(title) : dataText(title)) : '';
    const lv = kind === 'npc' || kind === 'practice' ? '' : `${dataText('Nv')} ${level}`;
    // Minor (swarm) enemies: just the HP bar, so a pack of ten stays readable.
    const nameRow = kind === 'minor' ? '<span class="lv" hidden></span>' : `<div class="np-name"><span class="lv">${lv}</span>${name}</div>`;
    el.innerHTML = `${title ? `<div class="np-title">«${title}»</div>` : ''}${nameRow}${kind === 'npc' || kind === 'practice' ? '' : '<div class="np-hp"><i style="width:100%"></i></div>'}`;
    this.root.appendChild(el);
    this.plates.set(id, { el, anchor: new THREE.Vector3(), p: { x: 0, y: 0, vis: false }, shown: true, hpEl: el.querySelector('.np-hp i'), lvEl: el.querySelector('.lv'), fr: 1, level, kind, range: kind === 'enemy' || kind === 'minor' ? 30 : 42 });
  }

  // A floating label for loot (anchored like the plates; hidden beyond `range` u).
  addLabel(id, html, { cls = '', color = '', range = 16 } = {}) {
    this.removeLabel(id);
    const el = document.createElement('div');
    el.className = 'loot-label ' + cls;
    el.innerHTML = html;
    if (color) el.style.setProperty('--rc', color);
    this.root.appendChild(el);
    this.labels.set(id, { el, p: { x: 0, y: 0, vis: false }, range, shown: true });
  }
  removeLabel(id) { const l = this.labels.get(id); if (l) { l.el.remove(); this.labels.delete(id); } }

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

  // Player chat uses text nodes so message content and labels are never interpreted as markup.
  chatBubble(entity, { text = '', channel = 'world', label = '', own = false, range = 42, labelKey = null, labelParams = {}, labelNameKey = null } = {}, lifeMs = 4500) {
    this.removeChatBubble(entity);
    const el = document.createElement('div');
    el.className = 'mn-chat-bubble';
    el.hidden = true;
    el.dataset.channel = channel === 'local' || channel === 'whisper' ? channel : 'world';
    if (own) el.classList.add('is-own');
    const labelEl = document.createElement('div');
    labelEl.className = 'mn-chat-bubble-label';
    if (typeof labelKey === 'string' && labelKey) {
      const params = { ...labelParams };
      if (labelNameKey && Object.hasOwn(params, 'name')) params.name = t(labelNameKey);
      setText(labelEl, labelKey, params);
    } else labelEl.textContent = String(label ?? '');
    const textEl = document.createElement('div');
    textEl.className = 'mn-chat-bubble-text';
    textEl.textContent = String(text ?? '');
    el.append(labelEl, textEl);
    this.root.appendChild(el);
    this.chatBubbles.set(entity, { el, labelEl, labelKey, labelParams: { ...labelParams }, labelNameKey, p: { x: 0, y: 0, vis: false }, range: Math.max(0, Number(range) || 0), until: performance.now() + Math.max(0, Number(lifeMs) || 0), shown: false });
    return this.chatBubbles.get(entity);
  }

  removeChatBubble(entity) {
    const b = this.chatBubbles.get(entity);
    if (b) { b.el.remove(); this.chatBubbles.delete(entity); }
  }

  clearChatBubbles() {
    for (const b of this.chatBubbles.values()) b.el.remove();
    this.chatBubbles.clear();
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
      const npcTalking = this.bubbles.has(id) && now < this.bubbles.get(id).until;
      const chatBubble = this.chatBubbles.get(id);
      this.project(a.pos, plate.p);
      const chatTalking = !!chatBubble && now < chatBubble.until && a.dist <= chatBubble.range && !a.hide && plate.p.vis;
      const s = clamp(21 / Math.max(a.dist, 1), 0.55, 1.1);
      const covers = plate.p.x > pr.x && plate.p.x < pr.x + pr.w && plate.p.y > pr.y && plate.p.y < pr.y + pr.h + 30;
      const R = plate.range;
      // Over your character a plate steps aside, except a pirate fighting you (its life matters): faded.
      const show = plate.p.vis && a.dist < R && (!covers || plate.hostile) && !a.hide && !npcTalking && !chatTalking;
      if (show !== plate.shown) { plate.el.hidden = !show; plate.shown = show; }
      if (show) { this.place(plate.el, plate.p, s); plate.el.style.opacity = String(clamp((R - a.dist) / 8, 0, 1) * (covers ? 0.55 : 1)); }
    }
    // Prompts first: the loot labels under one fade so the prompt stays readable.
    const boxes = [];
    for (const [id, pm] of this.prompts) {
      if (pm.el.hidden) continue;
      const a = anchors.get(id);
      if (!a) { pm.el.hidden = true; continue; }
      this.project(a.pos, pm.p);
      if (!pm.p.vis) { pm.el.hidden = true; continue; }
      this.place(pm.el, pm.p, 1, pm.below ? -14 : 12, pm.below);
      if (pm.w === undefined || pm.wHtml !== pm.html) { pm.w = pm.el.offsetWidth; pm.h = pm.el.offsetHeight; pm.wHtml = pm.html; }
      const top = pm.below ? pm.p.y + 14 : pm.p.y - 12 - pm.h;
      boxes.push({ x0: pm.p.x - pm.w / 2 - 6, x1: pm.p.x + pm.w / 2 + 6, y0: top - 6, y1: top + pm.h + 6 });
    }
    // Loot labels: nearest first, each one lifted above those it would cover (a pile of drops stays readable).
    const shown = [];
    for (const [id, l] of this.labels) {
      const a = anchors.get(id);
      const show = !!a && a.dist < l.range && !a.hide && (this.project(a.pos, l.p), l.p.vis);
      if (show !== l.shown) { l.el.hidden = !show; l.shown = show; }
      if (show) { if (!l.w) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; } l.d = a.dist; shown.push(l); }
    }
    shown.sort((p, q) => p.d - q.d);
    for (let i = 0; i < shown.length; i++) {
      const l = shown[i], s = clamp(18 / Math.max(l.d, 1), 0.7, 1), w = l.w * s, h = l.h * s;
      let y = l.p.y;
      for (let pass = 0; pass < 8; pass++) {
        let moved = false;
        for (let j = 0; j < i; j++) {
          const o = shown[j];
          if (Math.abs(o.sx - l.p.x) < (o.sw + w) * 0.5 && y > o.sy - o.sh - 1 && y - h < o.sy + 1) { y = o.sy - o.sh - 2; moved = true; }
        }
        if (!moved) break;
      }
      l.sx = l.p.x; l.sy = y; l.sw = w; l.sh = h;
      this.place(l.el, l.p, s, l.p.y - y);
      const under = boxes.some((b) => l.sx + w / 2 > b.x0 && l.sx - w / 2 < b.x1 && y > b.y0 && y - h < b.y1);
      l.el.style.opacity = String(clamp((l.range - l.d) / 4, 0, 1) * (under ? 0.22 : 1));
    }
    for (const [id, b] of this.bubbles) {
      const a = anchors.get(id);
      if (!a || now > b.until) { b.el.hidden = true; continue; }
      this.project(a.pos, b.p);
      b.el.hidden = !b.p.vis;
      if (b.p.vis) this.place(b.el, b.p, clamp(21 / Math.max(a.dist, 1), 0.7, 1.05), 34);
    }
    for (const [id, b] of this.chatBubbles) {
      const a = anchors.get(id);
      if (now >= b.until) { this.removeChatBubble(id); continue; }
      const visible = !!a && a.dist <= b.range && !a.hide && (this.project(a.pos, b.p), b.p.vis);
      if (!visible) { b.el.hidden = true; b.shown = false; continue; }
      b.el.hidden = false;
      const scale = clamp(21 / Math.max(a.dist, 1), 0.7, 1.05);
      const width = b.el.offsetWidth || 240, height = b.el.offsetHeight || 72;
      const half = width * scale * 0.5;
      const x = clamp(b.p.x, Math.min(this.w * 0.5, half + 8), Math.max(this.w * 0.5, this.w - half - 8));
      const bottom = clamp(b.p.y - 34, height * scale + 8, Math.max(height * scale + 8, this.h - 12));
      const lift = b.p.y - bottom;
      const tail = clamp(50 + ((b.p.x - x) / Math.max(width * scale, 1)) * 100, 12, 88);
      b.el.style.setProperty('--mn-chat-tail-x', tail + '%');
      this.place(b.el, { x, y: b.p.y }, scale, lift);
      b.shown = true;
    }
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;
    for (const f of this.floats) {
      if (!f.active) continue;
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) { f.active = false; f.el.hidden = true; continue; }
      this.project(f.pos, f.p);
      if (!f.p.vis) { f.el.style.opacity = '0'; continue; }
      const up = f.rise * (1 - (1 - k) * (1 - k));
      f.sx = f.p.x + f.dx * k; f.sy = f.p.y - up - f.lift;
      f.el.style.transform = `translate3d(${f.sx}px, ${f.sy}px, 0) translate(-50%, -100%)`;
      f.el.style.opacity = String(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    }
  }
}
