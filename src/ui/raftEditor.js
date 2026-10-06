// The raft editor is an intent client: it previews a single cell and waits for both an ack and a public snapshot.
import * as THREE from 'three';
import { RAFT, RAFT_PARTS } from '../data/raftparts.js';
import { EDITOR_PARTS, EDITOR_REASONS, EDITOR_RADIUS } from '../data/raftEditor.js';
import { canPlace } from '../sim/economy/raft.js';
import { holdUsed, roomFor } from '../sim/economy/cargo.js';
import { raftGangplank } from '../sim/raftGeometry.js';
import { stage } from './stage.js';

const IDS = EDITOR_PARTS;
const DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const direction = (id, dir) => (id === 'stairs' ? ['Sur', 'Este', 'Norte', 'Oeste'] : ['Norte', 'Este', 'Sur', 'Oeste'])[dir];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtGoods = (goods = {}) => Object.entries(goods).filter(([, n]) => n > 0).map(([g, n]) => `${n} ${g}`).join(' · ') || '0 materiales';
const partMeta = (id) => RAFT_PARTS[id] || {};
const reasonText = (why) => EDITOR_REASONS[why] || ({ '': 'Lugar válido', goods: 'Faltan materiales', gold: 'No tienes oro suficiente.', market: 'El mercado no ofrece ese material.', stock: 'No queda material en Aldea.', calm: 'Espera a estar en calma para comprar.' })[why] || 'Lugar no válido';
const fromLocal = (r, x, z) => ({ x: r.x + Math.cos(r.yaw) * x + Math.sin(r.yaw) * z,
  z: r.z - Math.sin(r.yaw) * x + Math.cos(r.yaw) * z });
const toLocal = (r, x, z) => { const dx = x - r.x, dz = z - r.z; return [Math.cos(r.yaw) * dx - Math.sin(r.yaw) * dz, Math.sin(r.yaw) * dx + Math.cos(r.yaw) * dz]; };

export class RaftEditor {
  constructor(opts) {
    Object.assign(this, opts);
    this.active = false; this.selected = 'foundation'; this.level = 0; this.dir = 0; this.quote = null; this.removeChoice = 0;
    this.mode = 'place'; this.target = null; this.pending = null; this.lastResult = '';
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2(); this.plane = new THREE.Plane(); this.up = new THREE.Vector3(0, 1, 0); this.planePoint = new THREE.Vector3();
    this.hit = new THREE.Vector3(); this.v = new THREE.Vector3();
    this.ghost = new THREE.Group(); this.ghostCell = new THREE.Mesh(new THREE.BoxGeometry(RAFT.cell * 0.9, 0.09, RAFT.cell * 0.9), new THREE.MeshBasicMaterial({ color: 0x69db72, transparent: true, opacity: 0.52, depthTest: false }));
    this.ghostPart = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x9be879, transparent: true, opacity: 0.38, depthTest: false }));
    this.ghostArrow = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 4), new THREE.MeshBasicMaterial({ color: 0xf7e58c, depthTest: false }));
    this.ghostArrow.rotation.x = Math.PI / 2; this.ghostArrow.position.set(0, 0.16, 0.72); this.ghost.add(this.ghostCell, this.ghostPart, this.ghostArrow); this.ghost.renderOrder = 1000;
    this.scene.add(this.ghost); this.ghost.visible = false;
    this.root = document.createElement('section'); this.root.className = 'raft-editor'; this.root.hidden = true;
    this.launcher = document.createElement('button'); this.launcher.type = 'button'; this.launcher.className = 'raft-build-launcher'; this.launcher.textContent = 'Construir · B';
    this.launcher.hidden = true; this.parent.appendChild(this.launcher);
    this.root.innerHTML = `<header class="re-head"><b>ASTILLERO DE CUBIERTA</b><button class="re-close" type="button" aria-label="Salir">×</button></header>
      <div class="re-tabs" role="tablist"><button data-mode="place" type="button">Construir</button><button data-mode="remove" type="button">Retirar</button></div>
      <div class="re-pieces" aria-label="Piezas"></div><div class="re-details"></div>
      <div class="re-options"><label>Nivel <select class="re-level"><option value="0">Cubierta</option><option value="1">Nivel 1</option><option value="2">Nivel 2</option></select></label><button class="re-rotate" type="button">Girar · R</button></div>
      <div class="re-status" aria-live="polite"></div><button class="re-retry" type="button" hidden>Reenviar misma solicitud</button><div class="re-supplies"></div><div class="re-remove-choice"><button class="re-cycle" type="button">Cambiar pieza</button><span></span></div>
      <footer><small class="re-route">Materiales: bodega de la balsa → mochila. Retiro: devuelve la mitad, primero a bodega y luego a mochila.</small><button class="re-action" type="button">Colocar</button></footer>`;
    this.parent.appendChild(this.root);
    this.$ = (s) => this.root.querySelector(s);
    this.bind(); this.renderPalette(); this.render();
    this.onPointerMove = (e) => { if (!this.active) return; this.pointer(e); };
    this.onPointerDown = (e) => { if (!this.active || e.button !== 0 || e.target.closest('.raft-editor')) return; e.preventDefault(); this.pointer(e); if (this.mode === 'remove') this.render(); else if (e.pointerType === 'touch') this.render(); else this.act(); };
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
  }

  bind() {
    this.$('.re-close').addEventListener('click', () => this.close());
    this.launcher.addEventListener('click', () => this.toggle());
    this.$('.re-rotate').addEventListener('click', () => this.rotate());
    this.$('.re-level').addEventListener('change', (e) => { this.level = +e.target.value; this.reproject(); this.render(); });
    this.$('.re-action').addEventListener('click', () => this.act());
    this.$('.re-supplies').addEventListener('click', (e) => { const b = e.target.closest('[data-supply]'); if (b) this.buy(b.dataset.supply); });
    this.$('.re-cycle').addEventListener('click', () => this.cycleTarget());
    this.$('.re-retry').addEventListener('click', () => this.retryPending());
    this.root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { this.mode = b.dataset.mode; this.target = null; this.removeChoice = 0; this.reproject(); this.render(); }));
  }

  renderPalette() {
    const ids = IDS.filter((id) => !EDITOR_PARTS || (Array.isArray(EDITOR_PARTS) ? EDITOR_PARTS.includes(id) || EDITOR_PARTS.some((p) => p.id === id) : !!EDITOR_PARTS[id]));
    this.$('.re-pieces').innerHTML = ids.map((id) => `<button type="button" data-part="${id}" title="${esc(partMeta(id).name)}"><i>${({ foundation: '▦', floor: '▤', pillar: '▥', wall: '▰', railing: '⌁', stairs: '▧', crate: '▣', net: '▩', grill: '♨' })[id]}</i><span>${esc(partMeta(id).name)}</span></button>`).join('');
    this.root.querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', () => { this.selected = b.dataset.part; if (this.selected === 'floor' && this.level === 0) this.level = 1; if (this.selected === 'foundation' || this.selected === 'net') this.level = 0; this.mode = 'place'; this.target = null; this.reproject(); this.render(); }));
  }

  toggle() { if (this.active) this.close(); else { if (this.enabled && !this.enabled()) return; this.active = true; this.root.hidden = false; this.lastResult = ''; this.target = null; this.quote = null; this.onContext?.(true); this.render(); this.requestQuote(); } }
  close() { if (!this.active) return; this.active = false; this.root.hidden = true; this.ghost.visible = false; this.target = null; this.onContext?.(false); }
  rotate() { if (!this.active) return; this.dir = (this.dir + 1) & 3; this.render(); }
  key(e) { if (!this.active || e.repeat) return false; if (e.key.toLowerCase() === 'r') { this.rotate(); return true; } if (e.key === 'Escape') { this.close(); return true; } return false; }

  context() {
    const record = (this.rafts() || []).find((r) => r.owner === this.youServer());
    const profile = this.profile();
    const ship = record && profile?.eco?.ships?.find((s) => s.kind === 'raft' && s.id === record.id);
    const player = this.player();
    if (!record || !ship || ship.at !== 'aldea' || !(ship.hp > 0) || !player || player.dead || !Number.isFinite(player.x + player.y + player.z)) return null;
    const deck = this.raftDeck?.()?.surface(player.x, player.z, player.y);
    const plank = raftGangplank(record, this.map?.dock);
    const d = this.map?.dock;
    const dockDistance = d ? Math.hypot(player.x - d.base.x - d.dir.x * Math.max(0, d.len - 10),
      player.z - d.base.z - d.dir.z * Math.max(0, d.len - 10)) : Infinity;
    const nearPlank = !!plank && dockDistance <= EDITOR_RADIUS && Math.hypot(player.x - plank.x, player.z - plank.z) <= 2.5;
    if (deck?.id !== record.id && !nearPlank) return null;
    return { record, ship, player, profile };
  }

  pointer(e) {
    const c = this.context(); if (!c) return;
    this.pointerLocal(stage.toLocal(e.clientX, e.clientY));
  }

  pointerLocal(p, shouldRender = true) {
    const c = this.context(); if (!c) return;
    this.lastPointer = p;
    const w = stage.w || this.canvas.clientWidth, h = stage.h || this.canvas.clientHeight;
    this.ndc.set(p.x / w * 2 - 1, -(p.y / h) * 2 + 1); this.ray.setFromCamera(this.ndc, this.camera);
    const y = c.record.y + Math.max(0, this.level) * RAFT.levelHeight;
    this.plane.setFromNormalAndCoplanarPoint(this.up, this.planePoint.set(0, y, 0));
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) { this.target = null; return; }
    const [lx, lz] = toLocal(c.record, this.hit.x, this.hit.z);
    const x = Math.floor(lx / RAFT.cell), z = Math.floor(lz / RAFT.cell);
    if (this.target && (this.target.x !== x || this.target.z !== z || this.target.level !== (this.mode === 'remove' ? this.level : this.target.level))) { this.removeChoice = 0; this.lastResult = ''; }
    this.target = { x, z, level: this.mode === 'remove' ? this.level : this.selected === 'foundation' ? 0 : Math.max(this.selected === 'floor' ? 1 : 0, this.level), dir: this.dir };
    if (shouldRender) this.render();
  }

  proposed(c) { return c && this.target ? [this.selected, this.target.x, this.target.z, this.target.level, this.target.dir] : null; }
  removalTarget(c) {
    if (!c || !this.target) return null;
    const r = c.record; const center = fromLocal(r, (this.target.x + 0.5) * RAFT.cell, (this.target.z + 0.5) * RAFT.cell);
    const candidates = [];
    (r.parts || []).forEach((p, index) => {
      const id = p[0], def = partMeta(id); let wx, wz;
      if (def.layer === 'edge') { const d = p[4] || 0; const px = p[1] * RAFT.cell, pz = p[2] * RAFT.cell;
        const ex = d === 1 ? RAFT.cell : d === 2 ? RAFT.cell / 2 : d === 0 ? RAFT.cell / 2 : 0;
        const ez = d === 0 ? 0 : d === 1 ? RAFT.cell / 2 : d === 2 ? RAFT.cell : RAFT.cell / 2; wx = px + ex; wz = pz + ez;
      } else { wx = (p[1] + 0.5) * RAFT.cell; wz = (p[2] + 0.5) * RAFT.cell; }
      const pos = fromLocal(r, wx, wz); const projected = this.v.set(pos.x, r.y + p[3] * RAFT.levelHeight + 0.55, pos.z).project(this.camera);
      const px = (projected.x + 1) * (stage.w || this.canvas.clientWidth) / 2, py = (1 - projected.y) * (stage.h || this.canvas.clientHeight) / 2;
      const localPointer = this.lastPointer; const d2 = localPointer ? (px - localPointer.x) ** 2 + (py - localPointer.y) ** 2 : (pos.x - center.x) ** 2 + (pos.z - center.z) ** 2;
      if (IDS.includes(id) && p[3] === this.level && p[1] === this.target.x && p[2] === this.target.z && d2 < (localPointer ? 38 ** 2 : 0.75)) candidates.push({ index, p, d2 });
    });
    candidates.sort((a, b) => a.d2 - b.d2);
    return candidates[this.removeChoice % Math.max(1, candidates.length)] || null;
  }

  act() {
    if (!this.active || this.pending) return;
    const c = this.context(); if (!c) { this.close(); return; }
    if (c.record.rev !== c.ship.rev) { this.lastResult = 'Sincronizando plano y perfil; espera el siguiente snapshot.'; this.render(); return; }
    if (this.mode === 'remove') {
      const chosen = this.removalTarget(c); if (!chosen) { this.lastResult = 'Toca o apunta a una pieza para retirarla.'; this.render(); return; }
      const id = crypto.randomUUID(); const message = { type: 'raft', op: 'remove', id: c.record.id, expectedRev: c.record.rev, opId: id, index: chosen.index, piece: [...chosen.p] };
      this.pending = { id, expectedRev: c.record.rev, op: 'remove', message, sentAt: performance.now() }; this.send(message);
    } else {
      const piece = this.proposed(c); if (!piece) return;
      const why = canPlace(c.record.parts, piece); if (why) { this.lastResult = reasonText(why); this.render(); return; }
      const id = crypto.randomUUID(); const message = { type: 'raft', op: 'place', id: c.record.id, expectedRev: c.record.rev, opId: id, piece };
      this.pending = { id, expectedRev: c.record.rev, op: 'place', message, sentAt: performance.now() }; this.send(message);
    }
    this.render();
  }

  cycleTarget() { this.removeChoice = (this.removeChoice || 0) + 1; this.render(); }
  onResult(ev) {
    if (!this.active || !ev) return;
    if (ev.type === 'raftEdit' && (ev.op === 'quote' || Array.isArray(ev.supplies) && !ev.opId)) {
      const c = this.context(); if (!c || ev.id !== c.record.id || ev.rev !== c.record.rev) return;
      this.quotePending = null; if (ev.ok) this.quote = { rev: ev.rev, supplies: ev.supplies || [] }; else this.lastResult = reasonText(ev.why || 'market'); this.render(); return;
    }
    if (!this.pending || ev.opId !== this.pending.id || ev.id !== this.pending.message.id || ev.op && ev.op !== this.pending.op) return;
    const denied = ev.type === 'raftDenied' || ev.ok === false || !!ev.why;
    if (denied) { this.lastResult = reasonText(ev.why || 'invalid'); this.pending = null; }
    else { this.pending.ack = true; this.pending.resultRev = ev.rev; this.lastResult = this.pending.op === 'supply' ? 'Compra aceptada; esperando inventario actualizado…' : 'Servidor aceptó; esperando el plano actualizado…'; }
    this.render();
  }

  render() {
    const c = this.context(); if (this.active && !c) { this.close(); return; }
    const disabled = !c || !!this.pending;
    this.root.classList.toggle('is-remove', this.mode === 'remove');
    this.root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === this.mode));
    this.root.querySelectorAll('[data-part]').forEach((b) => b.classList.toggle('on', b.dataset.part === this.selected));
    this.$('.re-level').value = String(this.level);
    const def = partMeta(this.selected), selection = this.mode === 'remove' ? this.removalTarget(c) : null;
    const cost = def.cost || {};
    const refund = Object.fromEntries(Object.entries(cost).map(([g, n]) => [g, Math.floor(n * RAFT.refund)]).filter(([, n]) => n > 0));
    this.$('.re-details').innerHTML = this.mode === 'remove'
      ? `<b>${selection ? esc(partMeta(selection.p[0]).name) : 'Elige una pieza'}</b><small>Devolución prevista: ${fmtGoods(selection ? Object.fromEntries(Object.entries(partMeta(selection.p[0]).cost || {}).map(([g,n]) => [g, Math.floor(n * RAFT.refund)])) : {})}</small>`
      : `<b>${esc(def.name)}</b><small>Coste: ${fmtGoods(cost)} · ${direction(this.selected, this.dir)}</small>`;
    const pack = c?.ship?.hold?.goods || {}, bag = c?.ship && this.profile()?.eco?.pack?.goods || {};
    const stock = Object.fromEntries([...new Set([...Object.keys(pack), ...Object.keys(bag), ...Object.keys(cost)])].map((g) => [g, (pack[g] || 0) + (bag[g] || 0)]));
    const hold = c?.ship?.hold || { cap: 0, goods: {} }, packStore = c?.profile?.eco?.pack || { cap: 0, goods: {} };
    this.$('.re-route').textContent = `Tienes ${fmtGoods(stock)} · bodega ${holdUsed(hold)}/${hold.cap} · mochila ${holdUsed(packStore)}/${packStore.cap}. ${c?.record.parts.filter((p) => p[0] === 'foundation').length || 0}/${RAFT.maxCells} cimientos; ${c?.record.parts.length || 0}/600 piezas. Compra/obra: bodega → mochila. Retiro: mitad.`;
    const gold = c?.profile?.gold ?? 0;
    const offers = c && this.quote?.rev === c.record.rev ? this.quote.supplies : [];
    this.$('.re-supplies').innerHTML = offers.map((offer) => {
      const room = roomFor(hold, offer.g) + roomFor(packStore, offer.g);
      return `<button type="button" data-supply="${esc(offer.g)}" ${disabled || offer.stock < 1 || gold < offer.price || room < 1 ? 'disabled' : ''}>${offer.g === 'madera' ? 'Madera' : 'Hierro'} +1 · ${offer.price} oro</button>`;
    }).join('');
    let reason = this.lastResult;
    if (!reason && c && this.mode === 'place' && this.target) reason = reasonText(canPlace(c.record.parts, this.proposed(c)));
    if (!reason && this.mode === 'remove' && selection) reason = 'Confirma para retirar; se valida soporte y ocupantes en servidor.';
    const coord = `Casilla ${this.target ? `${this.target.x}, ${this.target.z}` : '—'} · nivel ${this.target?.level ?? this.level} · ${direction(this.selected, this.dir)}`;
    this.$('.re-status').textContent = this.pending ? `${coord} · ${this.pending.ack ? 'Esperando snapshot e inventario…' : 'Enviando intención…'}${this.lastResult ? ` · ${this.lastResult}` : ''}` : `${coord} · ${reason || 'Listo'}`;
    this.$('.re-retry').hidden = !this.pending || performance.now() - this.pending.sentAt < 5000;
    this.$('.re-action').textContent = this.mode === 'remove' ? 'Confirmar retiro' : 'Colocar';
    this.$('.re-action').disabled = disabled || c.record.rev !== c.ship.rev || (this.mode === 'place' ? !this.target || !!canPlace(c.record.parts, this.proposed(c)) : !selection);
    this.$('.re-cycle').hidden = this.mode !== 'remove';
    this.$('.re-remove-choice span').textContent = selection ? `#${selection.index} · ${esc(partMeta(selection.p[0]).name)} · ${selection.p[1]}, ${selection.p[2]}, nivel ${selection.p[3]}` : 'Apunta a una pieza';
    if (this.target && c) {
      const p = fromLocal(c.record, (this.target.x + 0.5) * RAFT.cell, (this.target.z + 0.5) * RAFT.cell);
      const placeDir = this.mode === 'remove' && selection ? selection.p[4] || 0 : this.dir;
      const previewId = this.mode === 'remove' && selection ? selection.p[0] : this.selected;
      const def = partMeta(previewId);
      const edgeOffset = def.layer === 'edge' ? { x: DIR[placeDir][0] * RAFT.cell / 2, z: DIR[placeDir][1] * RAFT.cell / 2 } : { x: 0, z: 0 };
      this.ghost.position.set(p.x + Math.cos(c.record.yaw) * edgeOffset.x + Math.sin(c.record.yaw) * edgeOffset.z, c.record.y + this.target.level * RAFT.levelHeight + 0.08, p.z - Math.sin(c.record.yaw) * edgeOffset.x + Math.cos(c.record.yaw) * edgeOffset.z);
      this.ghost.rotation.set(0, c.record.yaw + placeDir * Math.PI / 2, 0);
      const valid = this.mode === 'place' && !canPlace(c.record.parts, this.proposed(c));
      this.ghostCell.material.color.setHex(valid ? 0x70e47a : 0xf06454);
      const layer = def.layer;
      const dims = layer === 'pillar' ? [0.28, RAFT.levelHeight * 0.92, 0.28]
        : layer === 'edge' ? [RAFT.cell * 0.88, previewId === 'railing' ? 0.75 : RAFT.levelHeight * 0.82, 0.12]
          : this.selected === 'crate' || this.mode === 'remove' && selection?.p[0] === 'crate' ? [0.75, 0.72, 0.75]
            : layer === 'floor' || layer === 'base' ? [RAFT.cell * 0.9, 0.12, RAFT.cell * 0.9]
              : [RAFT.cell * 0.72, 0.28, RAFT.cell * 0.72];
      this.ghostPart.scale.set(...dims); this.ghostPart.position.y = dims[1] / 2;
      this.ghostArrow.position.set(0, Math.max(0.16, dims[1] + 0.12), 0.72);
      const arrowSign = def.layer === 'edge' && placeDir % 2 === 0 ? -1 : 1;
      this.ghostArrow.rotation.set(arrowSign * Math.PI / 2, 0, 0);
      this.ghostArrow.position.z = arrowSign * 0.72;
      this.ghostPart.material.color.setHex(valid ? 0x9be879 : 0xf06454);
      this.ghost.visible = true;
    } else this.ghost.visible = false;
    this.renderKey = this.signature();
  }

  update() {
    const canOpen = !!this.context() && (!this.enabled || this.enabled());
    this.launcher.hidden = this.active || !canOpen;
    if (!this.active) return;
    if (this.enabled && !this.enabled()) { this.close(); return; }
    const c = this.context(); if (!c) { this.close(); this.launcher.hidden = true; return; }
    if (this.lastPointer) this.pointerLocal(this.lastPointer, false);
    if (this.pending?.ack && Number.isSafeInteger(this.pending.resultRev) && c.record.rev >= this.pending.resultRev && c.ship.rev >= this.pending.resultRev) {
      const op = this.pending.op; this.pending = null; this.quote = null; this.quotePending = null;
      this.lastResult = op === 'supply' ? 'Compra confirmada por snapshot.' : 'Plano confirmado por snapshot.';
      this.requestQuote(); this.render();
    }
    if (this.pending && performance.now() - this.pending.sentAt >= 5000 && this.$('.re-retry').hidden) this.render();
    if (!this.pending) this.requestQuote();
    const sig = this.signature(); if (sig !== this.renderKey) this.render();
  }

  requestQuote() {
    if (!this.active) return;
    const c = this.context(); if (!c || this.quote?.rev === c.record.rev || this.quotePending === c.record.rev) return;
    this.quotePending = c.record.rev;
    this.send({ type: 'raft', op: 'quote', id: c.record.id, expectedRev: c.record.rev });
  }

  buy(g) {
    if (!this.active || this.pending || !['madera', 'hierro'].includes(g)) return;
    const c = this.context(), offer = this.quote?.supplies?.find((x) => x.g === g);
    if (!c || !offer || this.quote.rev !== c.record.rev || c.ship.rev !== c.record.rev || offer.stock < 1) return;
    const id = crypto.randomUUID(); const message = { type: 'raft', op: 'supply', id: c.record.id, expectedRev: c.record.rev, opId: id, g, n: 1 };
    this.pending = { id, expectedRev: c.record.rev, op: 'supply', message, sentAt: performance.now() }; this.send(message); this.render();
  }

  retryPending() { if (!this.active || !this.pending?.message) return; this.pending.sentAt = performance.now(); this.send(this.pending.message); this.render(); }
  reproject() { if (this.lastPointer) this.pointerLocal(this.lastPointer, false); }

  signature() {
    const c = this.context(); if (!c) return 'off';
    return JSON.stringify([c.record.rev, c.ship.rev, c.ship.hold?.goods, c.profile.gold, c.profile.eco?.pack?.goods,
      this.quote, this.target, this.selected, this.level, this.dir, this.mode, this.lastResult,
      this.pending && [this.pending.id, this.pending.ack, this.pending.resultRev, this.pending.sentAt], this.removeChoice]);
  }

  destroy() { this.close(); this.canvas.removeEventListener('pointermove', this.onPointerMove); this.canvas.removeEventListener('pointerdown', this.onPointerDown); this.ghost.removeFromParent(); this.ghostCell.geometry.dispose(); this.ghostCell.material.dispose(); this.ghostPart.geometry.dispose(); this.ghostPart.material.dispose(); this.ghostArrow.geometry.dispose(); this.ghostArrow.material.dispose(); this.root.remove(); this.launcher.remove(); }
}
