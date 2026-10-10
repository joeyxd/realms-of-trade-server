// The raft editor is an intent client: it previews a single cell and waits for both an ack and a public snapshot.
import * as THREE from 'three';
import { RAFT, RAFT_LOAD, RAFT_PARTS, RAFT_REINFORCEMENT } from '../data/raftparts.js';
import { EDITOR_PARTS, EDITOR_RADIUS } from '../data/raftEditor.js';
import { ARTISAN } from '../data/artisan.js';
import { readProgression } from '../sim/systems/progression.js';
import { canPlace } from '../sim/economy/raft.js';
import { holdUsed, roomFor, goodMass } from '../sim/economy/cargo.js';
import { raftCapacity } from '../sim/economy/raftCapacity.js';
import { repairPartCost, salvagePartCost } from '../sim/naval/structure.js';
import { raftGangplank } from '../sim/raftGeometry.js';
import { stage } from './stage.js';
import { onLocaleChange, t, formatNumber, translateData } from '../core/i18n.js';
import { GOODS } from '../data/goods.js';

const IDS = EDITOR_PARTS;
const DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const direction = (id, dir) => (id === 'stairs'
  ? [t('systems.raft.direction.south'), t('systems.raft.direction.east'), t('systems.raft.direction.north'), t('systems.raft.direction.west')]
  : [t('systems.raft.direction.north'), t('systems.raft.direction.east'), t('systems.raft.direction.south'), t('systems.raft.direction.west')])[dir];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtGoods = (goods = {}) => Object.entries(goods).filter(([, n]) => n > 0).map(([g, n]) => `${formatNumber(n)} ${translateData(GOODS[g]?.name || g)}`).join(' · ') || `0 ${t('systems.raft.materials')}`;
const fmtHp = (n) => formatNumber(Number(n), { maximumFractionDigits: 1 });
const partMeta = (id) => RAFT_PARTS[id] || {};
const english = () => globalThis.document?.documentElement?.lang?.startsWith('en') === true;
const reasonText = (why) => t(`systems.raft.reason.${why || 'valid'}`);
const STORAGE_REASONS = {
  '': { es: 'Lugar válido.', en: 'Valid placement.' },
  knowledge: { es: 'Aprende Bodega con la artesana del banco antes de construirla.', en: 'Learn Storage from the workbench artisan before building it.' },
  practice: { es: 'Alcanza 60 puntos de tala para aprender Bodega.', en: 'Reach 60 logging points to learn Storage.' },
  learned: { es: 'Ya conoces la receta Bodega.', en: 'You already know the Storage recipe.' },
  land: { es: 'La obra comunitaria de carpintería aún no está completa.', en: 'The community carpentry project is not complete yet.' },
  disabled: { es: 'La construcción de bodega no está disponible en este mundo.', en: 'Storage construction is not available in this world.' },
  account_required: { es: 'Vincula una cuenta para guardar la construcción de forma duradera.', en: 'Link an account to save this build durably.' },
  busy: { es: 'Ya hay una acción pendiente. Espera su respuesta.', en: 'Another action is pending. Wait for its response.' },
  storage: { es: 'El servidor no pudo confirmar el guardado. Vuelve a conectar.', en: 'The save could not be confirmed. Reconnect to continue.' },
  duplicate: { es: 'La solicitud ya corresponde a otra acción.', en: 'This request already belongs to another action.' },
  command: { es: 'La solicitud de construcción no es válida.', en: 'The storage placement request is invalid.' },
  goods: { es: 'Faltan materiales en la bodega y la mochila.', en: 'The hold and pack do not contain enough materials.' },
  materials: { es: 'Faltan materiales en la bodega y la mochila.', en: 'The hold and pack do not contain enough materials.' },
  full: { es: 'No hay espacio suficiente para conservar la carga.', en: 'There is not enough room to preserve the cargo.' },
  room: { es: 'No cabe toda la carga en la bodega y la mochila.', en: 'The hold and pack cannot fit all cargo.' },
  capacity: { es: 'La carga excede el límite de peso de la balsa.', en: 'The cargo exceeds the raft mass limit.' },
  unknown: { es: 'Pieza desconocida.', en: 'Unknown piece.' }, size: { es: 'La balsa alcanzó su tamaño máximo.', en: 'The raft reached its size limit.' },
  adjacent: { es: 'El cimiento debe tocar la balsa.', en: 'The foundation must touch the raft.' }, overlap: { es: 'Ese espacio ya está ocupado.', en: 'That space is already occupied.' },
  deck: { es: 'Coloca la pieza sobre una cubierta.', en: 'Place this piece on a free deck or floor cell.' }, edge: { es: 'La pieza debe estar junto a una cubierta.', en: 'Place this piece beside a deck or floor cell.' },
  level: { es: 'Nivel o dirección inválidos.', en: 'Invalid level or direction.' }, support: { es: 'La pieza necesita soporte.', en: 'This piece needs structural support.' },
  owner: { es: 'Esa balsa no es tuya.', en: 'That raft does not belong to you.' },
  revision: { es: 'El plano cambió. Revisa la balsa antes de intentarlo otra vez.', en: 'The blueprint changed. Review the raft and try again.' },
  revisionLimit: { es: 'El plano alcanzó su límite de cambios.', en: 'The blueprint reached its change limit.' },
};
export const storageEditorReason = (why, lang = globalThis.document?.documentElement?.lang || 'es') =>
  STORAGE_REASONS[why]?.[String(lang).startsWith('en') ? 'en' : 'es'] || reasonText(why);
export const knowsRaftStorage = (profile) => {
  try { return readProgression(profile?.progression).knowledge.includes(ARTISAN.lesson); }
  catch { return false; }
};
export function raftPlacementReason(profile, parts, piece) {
  if (piece?.[0] === ARTISAN.part && !knowsRaftStorage(profile)) return 'knowledge';
  return canPlace(parts, piece);
}

const fromLocal = (r, x, z) => ({ x: r.x + Math.cos(r.yaw) * x + Math.sin(r.yaw) * z,
  z: r.z - Math.sin(r.yaw) * x + Math.cos(r.yaw) * z });
const toLocal = (r, x, z) => { const dx = x - r.x, dz = z - r.z; return [Math.cos(r.yaw) * dx - Math.sin(r.yaw) * dz, Math.sin(r.yaw) * dx + Math.cos(r.yaw) * dz]; };

export class RaftEditor {
  constructor(opts) {
    Object.assign(this, opts);
    this.active = false; this.selected = 'foundation'; this.level = 0; this.dir = 0; this.quote = null; this.removeChoice = 0;
    this.mode = 'place'; this.target = null; this.pending = null; this.lastResult = ''; this.lastResultKey = ''; this.lastResultParams = {}; this.lastResultStorageReason = null; this.repairChoiceId = null;
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2(); this.plane = new THREE.Plane(); this.up = new THREE.Vector3(0, 1, 0); this.planePoint = new THREE.Vector3();
    this.hit = new THREE.Vector3(); this.v = new THREE.Vector3();
    this.ghost = new THREE.Group(); this.ghostCell = new THREE.Mesh(new THREE.BoxGeometry(RAFT.cell * 0.9, 0.09, RAFT.cell * 0.9), new THREE.MeshBasicMaterial({ color: 0x69db72, transparent: true, opacity: 0.52, depthTest: false }));
    this.ghostPart = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x9be879, transparent: true, opacity: 0.38, depthTest: false }));
    this.ghostArrow = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 4), new THREE.MeshBasicMaterial({ color: 0xf7e58c, depthTest: false }));
    this.ghostArrow.rotation.x = Math.PI / 2; this.ghostArrow.position.set(0, 0.16, 0.72); this.ghost.add(this.ghostCell, this.ghostPart, this.ghostArrow); this.ghost.renderOrder = 1000;
    this.scene.add(this.ghost); this.ghost.visible = false;
    this.root = document.createElement('section'); this.root.className = 'raft-editor'; this.root.hidden = true;
    this.launcher = document.createElement('button'); this.launcher.type = 'button'; this.launcher.className = 'raft-build-launcher'; this.launcher.textContent = t('systems.raft.launcher');
    this.launcher.hidden = true; this.parent.appendChild(this.launcher);
    this.root.innerHTML = `<header class="re-head"><b>${t('systems.raft.title')}</b><button class="re-close" type="button" aria-label="${t('systems.raft.exit')}">×</button></header>
      <div class="re-tabs" role="tablist"><button data-mode="place" type="button">${t('systems.raft.build')}</button><button data-mode="repair" type="button">${t('systems.raft.repair')}</button><button data-mode="reinforce" type="button">${t('systems.raft.reinforce')}</button><button data-mode="remove" type="button">${t('systems.raft.remove')}</button></div>
      <div class="re-pieces" aria-label="${t('systems.raft.pieces')}"></div><div class="re-repair-list" aria-label="${t('systems.raft.damagedPieces')}"></div><div class="re-details"></div><small class="re-shelter-help" hidden></small><div class="re-capacity" aria-live="polite"></div>
      <div class="re-options"><label><span class="re-level-label">${t('systems.raft.level')}</span> <select class="re-level"><option value="0">${t('systems.raft.deck')}</option><option value="1">${t('systems.raft.levelN', { n: 1 })}</option><option value="2">${t('systems.raft.levelN', { n: 2 })}</option></select></label><button class="re-rotate" type="button">${t('systems.raft.rotate')}</button></div>
      <div class="re-status" aria-live="polite"></div><button class="re-retry" type="button" hidden>${t('systems.raft.retry')}</button><div class="re-supplies"></div><div class="re-remove-choice"><button class="re-cycle" type="button">${t('systems.raft.changePiece')}</button><span></span></div>
      <footer><small class="re-route">${t('systems.raft.route')}</small><button class="re-action" type="button">${t('systems.raft.place')}</button></footer>`;
    this.parent.appendChild(this.root);
    this.$ = (s) => this.root.querySelector(s);
    this.bind(); this.refreshLocale(); this.renderPalette(); this.render();
    this.unsubscribeLocale = onLocaleChange(() => {
      if (this.lastResultStorageReason) this.lastResult = storageEditorReason(this.lastResultStorageReason);
      else if (this.lastResultKey) this.lastResult = t(this.lastResultKey, this.resultParams());
      this.refreshLocale(); this.renderPalette(); this.render();
    });
    this.onPointerMove = (e) => { if (!this.active) return; this.pointer(e); };
    this.onPointerDown = (e) => { if (!this.active || e.button !== 0 || e.target.closest('.raft-editor')) return; e.preventDefault(); this.pointer(e); if (this.mode !== 'place' || e.pointerType === 'touch') { this.render(); if (this.mode === 'reinforce') this.revealDecision(); } else this.act(); };
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
  }

  refreshLocale() {
    this.launcher.textContent = t('systems.raft.launcher');
    this.$('.re-head > b').textContent = t('systems.raft.title');
    this.$('.re-close').setAttribute('aria-label', t('systems.raft.exit'));
    this.$('[data-mode="place"]').textContent = t('systems.raft.build');
    this.$('[data-mode="repair"]').textContent = t('systems.raft.repair');
    this.$('[data-mode="reinforce"]').textContent = t('systems.raft.reinforce');
    this.$('[data-mode="remove"]').textContent = t('systems.raft.remove');
    this.$('.re-pieces').setAttribute('aria-label', t('systems.raft.pieces'));
    this.$('.re-repair-list').setAttribute('aria-label', t('systems.raft.damagedPieces'));
    this.$('.re-level-label').textContent = t('systems.raft.level');
    [...this.$('.re-level').options].forEach((option, index) => { option.textContent = index === 0 ? t('systems.raft.deck') : t('systems.raft.levelN', { n: index }); });
    this.$('.re-rotate').textContent = t('systems.raft.rotate');
    this.$('.re-retry').textContent = t('systems.raft.retry');
    this.$('.re-cycle').textContent = t('systems.raft.changePiece');
    this.$('.re-route').textContent = t('systems.raft.route');
  }

  resultParams() {
    if (this.lastResultKey === 'systems.raft.status.missingMaterials' && this.lastResultParams.goods && typeof this.lastResultParams.goods === 'object')
      return { ...this.lastResultParams, goods: fmtGoods(this.lastResultParams.goods) };
    return this.lastResultParams;
  }
  setResult(key, params = {}) { this.lastResultKey = key; this.lastResultParams = params; this.lastResultStorageReason = null; this.lastResult = t(key, this.resultParams()); }
  setStorageResult(why) { this.lastResultStorageReason = why; this.lastResultKey = ''; this.lastResultParams = {}; this.lastResult = storageEditorReason(why); }
  clearResult() { this.lastResult = ''; this.lastResultKey = ''; this.lastResultParams = {}; this.lastResultStorageReason = null; }

  bind() {
    this.$('.re-close').addEventListener('click', () => this.close());
    this.launcher.addEventListener('click', () => this.toggle());
    this.$('.re-rotate').addEventListener('click', () => this.rotate());
    this.$('.re-level').addEventListener('change', (e) => { this.level = +e.target.value; this.reproject(); this.render(); });
    this.$('.re-action').addEventListener('click', () => this.act());
    this.$('.re-repair-list').addEventListener('click', (e) => {
      const button = e.target.closest('[data-repair-id]');
      if (button) { this.repairChoiceId = button.dataset.repairId; this.render(); this.revealDecision(); }
    });
    this.$('.re-supplies').addEventListener('click', (e) => { const b = e.target.closest('[data-supply]'); if (b) this.buy(b.dataset.supply); });
    this.$('.re-cycle').addEventListener('click', () => this.cycleTarget());
    this.$('.re-retry').addEventListener('click', () => this.retryPending());
    this.root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { this.mode = b.dataset.mode; if (this.mode !== 'repair') this.repairChoiceId = null; if (this.mode === 'reinforce' || this.mode === 'repair' || this.mode === 'place' && partMeta(this.selected).layer === 'base') this.level = 0; this.target = null; this.removeChoice = 0; this.reproject(); this.render(); }));
  }

  knowsStorage(c = null) { return knowsRaftStorage(c?.profile || this.profile?.()); }

  syncStoragePalette() {
    const button = this.$('.re-pieces [data-part="storage"]');
    if (!button) return;
    const learned = this.knowsStorage();
    const text = learned
      ? (english() ? 'Storage' : 'Bodega')
      : (english() ? 'Storage · learn from the workbench artisan' : 'Bodega · aprende con la artesana del banco');
    button.title = text; button.setAttribute('aria-label', text); button.querySelector('span').textContent = english() ? 'Storage' : 'Bodega'; button.classList.toggle('is-locked', !learned);
    button.dataset.locked = String(!learned);
  }

  renderPalette() {
    const ids = IDS.filter((id) => !EDITOR_PARTS || (Array.isArray(EDITOR_PARTS) ? EDITOR_PARTS.includes(id) || EDITOR_PARTS.some((p) => p.id === id) : !!EDITOR_PARTS[id]));
    this.$('.re-pieces').innerHTML = ids.map((id) => `<button type="button" data-part="${id}" title="${esc(translateData(partMeta(id).name))}"><i>${({ foundation: '▦', floor: '▤', pillar: '▥', wall: '▰', door: '▯', roof: '⌂', railing: '⌁', stairs: '▧', crate: '▣', storage: '▣', net: '▩', grill: '♨', lantern: '☼' })[id]}</i><span>${esc(translateData(partMeta(id).name))}</span></button>`).join('');
    this.syncStoragePalette();
    this.root.querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', () => { this.selected = b.dataset.part; if (partMeta(this.selected).layer === 'floor' && this.level === 0) this.level = 1; if (partMeta(this.selected).layer === 'base' || this.selected === 'net') this.level = 0; this.mode = 'place'; this.target = null; this.reproject(); this.render(); }));
  }

  toggle() { if (this.active) this.close(); else { if (this.enabled && !this.enabled()) return; this.active = true; this.root.hidden = false; this.clearResult(); this.target = null; this.quote = null; this.onContext?.(true); this.render(); this.requestQuote(); } }
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
    const plank = raftGangplank({ ...record, parts: ship.grid.parts }, this.map?.dock);
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
    if (this.mode === 'repair') { this.target = null; if (shouldRender) this.render(); return; }
    const w = stage.w || this.canvas.clientWidth, h = stage.h || this.canvas.clientHeight;
    this.ndc.set(p.x / w * 2 - 1, -(p.y / h) * 2 + 1); this.ray.setFromCamera(this.ndc, this.camera);
    const y = c.record.y + Math.max(0, this.level) * RAFT.levelHeight;
    this.plane.setFromNormalAndCoplanarPoint(this.up, this.planePoint.set(0, y, 0));
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) { this.target = null; return; }
    const [lx, lz] = toLocal(c.record, this.hit.x, this.hit.z);
    const x = Math.floor(lx / RAFT.cell), z = Math.floor(lz / RAFT.cell);
    if (this.target && (this.target.x !== x || this.target.z !== z || this.target.level !== (this.mode === 'remove' ? this.level : this.target.level))) { this.removeChoice = 0; this.clearResult(); }
    const selectedLayer = partMeta(this.selected).layer;
    this.target = { x, z, level: this.mode === 'remove' ? this.level : this.mode === 'reinforce' || selectedLayer === 'base' ? 0 : Math.max(selectedLayer === 'floor' ? 1 : 0, this.level), dir: this.dir };
    if (shouldRender) this.render();
  }

  proposed(c) { return c && this.target ? [this.selected, this.target.x, this.target.z, this.target.level, this.target.dir] : null; }
  gridParts(c) { return c?.ship?.grid?.parts || c?.record?.parts || []; }
  conditionFor(c) {
    const capacity = this.capacity?.(), condition = capacity?.condition;
    if (!c || !condition || capacity.id !== c.record.id || capacity.raftRev !== c.ship.rev || capacity.mode !== 'port' ||
        c.record.rev !== c.ship.rev || !condition.hull || !Array.isArray(condition.entries)) return null;
    const parts = this.gridParts(c);
    if (condition.entries.length !== parts.length) return null;
    const indexes = new Set();
    const valid = condition.entries.every((entry) => {
      const piece = entry?.piece;
      if (!Number.isSafeInteger(entry?.index) || entry.index < 0 || entry.index >= parts.length || indexes.has(entry.index)) return false;
      indexes.add(entry.index);
      return Array.isArray(piece) && JSON.stringify(piece) === JSON.stringify(parts[entry.index]) &&
        typeof entry.id === 'string' && Number.isFinite(entry.hp) && Number.isFinite(entry.maxHp) &&
        entry.maxHp === partMeta(piece[0]).hp && entry.hp >= 0 && entry.hp <= entry.maxHp;
    });
    return valid && indexes.size === parts.length ? condition : null;
  }
  conditionEntries(c) { return this.conditionFor(c)?.entries || []; }
  placementReason(c, piece = this.proposed(c)) {
    return raftPlacementReason(c?.profile, this.gridParts(c), piece) || (['roof', 'lantern'].includes(piece[0])
      ? canPlace(c.record.parts || this.gridParts(c), piece) : '');
  }
  repairCost(entry) {
    return entry?.cost && typeof entry.cost === 'object' ? entry.cost
      : repairPartCost({ ...entry, part: entry?.piece });
  }
  damagedEntries(c) { return this.conditionEntries(c).filter((entry) => entry.hp < entry.maxHp); }
  repairTarget(c) { return this.damagedEntries(c).find((entry) => entry.id === this.repairChoiceId) || null; }
  conditionEntry(c, index) { return this.conditionEntries(c).find((entry) => entry.index === index) || null; }
  repairAffordable(c, entry) {
    if (!c || !entry) return false;
    const stock = { ...(c.ship.hold?.goods || {}) };
    for (const [g, n] of Object.entries(c.profile?.eco?.pack?.goods || {})) stock[g] = (stock[g] || 0) + n;
    return Object.entries(this.repairCost(entry)).every(([g, n]) => (stock[g] || 0) >= n);
  }
  placementForecast(c) {
    if (!c) return null;
    const hold = c.ship.hold || { cap: 0, goods: {} }, pack = c.profile?.eco?.pack || { cap: 0, goods: {} };
    const parts = this.gridParts(c), liveParts = c.record.parts || parts;
    const serverCapacity = this.capacity?.();
    const options = serverCapacity?.id === c.record.id && serverCapacity.raftRev === c.ship.rev
      && serverCapacity.tradeRev === c.profile?.eco?.tradeRev && Number.isFinite(serverCapacity.crewMass)
      && Number.isFinite(serverCapacity.crewCount) && Number.isFinite(serverCapacity.guestMass)
      ? { crewMass: serverCapacity.crewMass, crewCount: serverCapacity.crewCount, guestMass: serverCapacity.guestMass } : undefined;
    const before = raftCapacity(liveParts, hold, pack, null, options);
    if (this.mode === 'repair') return { before, after: null, state: 'repair' };
    if (this.mode === 'remove') return { before, after: null, state: 'remove' };
    if (this.mode === 'reinforce') {
      if (!this.target) return { before, after: null, state: 'idle' };
      const target = this.reinforcementTarget(c);
      if (!target) return { before, after: null, state: 'invalid', reason: 'Apunta a un cimiento básico.' };
      const holdGoods = { ...(hold.goods || {}) }, packGoods = { ...(pack.goods || {}) };
      for (const [g, count] of Object.entries(RAFT_REINFORCEMENT)) {
        let remaining = count;
        const fromHold = Math.min(remaining, holdGoods[g] || 0);
        holdGoods[g] = (holdGoods[g] || 0) - fromHold; remaining -= fromHold;
        const fromPack = Math.min(remaining, packGoods[g] || 0);
        packGoods[g] = (packGoods[g] || 0) - fromPack; remaining -= fromPack;
        if (remaining > 0) return { before, after: null, state: 'goods', reason: `Falta ${remaining} ${g}` };
        if (!holdGoods[g]) delete holdGoods[g];
        if (!packGoods[g]) delete packGoods[g];
      }
      const condition = this.conditionEntries(c);
      const nextParts = condition.length
        ? condition.filter((entry) => entry.hp > 0).map((entry) => entry.index === target.index
          ? ['reinforcedFoundation', ...entry.piece.slice(1)] : entry.piece)
        : liveParts.map((p) => JSON.stringify(p) === JSON.stringify(target.p) ? ['reinforcedFoundation', ...p.slice(1)] : p);
      const nextHoldCap = nextParts.reduce((sum, p) => sum + (RAFT_PARTS[p[0]]?.hold || 0), 0);
      const after = raftCapacity(nextParts, { ...hold, cap: nextHoldCap, goods: holdGoods }, { ...pack, goods: packGoods }, null, options);
      return { before, after, state: 'valid', target };
    }
    if (!this.target) return { before, after: null, state: 'idle' };
    const piece = this.proposed(c), why = this.placementReason(c, piece);
    if (why) return { before, after: null, state: 'invalid', reason: piece[0] === ARTISAN.part ? storageEditorReason(why) : reasonText(why) };
    const cost = partMeta(piece[0]).cost || {}, holdGoods = { ...(hold.goods || {}) }, packGoods = { ...(pack.goods || {}) };
    for (const [g, count] of Object.entries(cost)) {
      let remaining = count;
      const fromHold = Math.min(remaining, holdGoods[g] || 0);
      holdGoods[g] = (holdGoods[g] || 0) - fromHold; remaining -= fromHold;
      const fromPack = Math.min(remaining, packGoods[g] || 0);
      packGoods[g] = (packGoods[g] || 0) - fromPack; remaining -= fromPack;
      if (remaining > 0) return { before, after: null, state: 'goods', reason: `Faltan ${remaining} ${g}` };
      if (!holdGoods[g]) delete holdGoods[g];
      if (!packGoods[g]) delete packGoods[g];
    }
    const nextParts = [...liveParts, piece];
    const nextHoldCap = nextParts.reduce((sum, p) => sum + (RAFT_PARTS[p[0]]?.hold || 0), 0);
    const after = raftCapacity(nextParts, { ...hold, cap: nextHoldCap, goods: holdGoods }, { ...pack, goods: packGoods }, null, options);
    return { before, after, state: 'valid' };
  }
  removalTarget(c) {
    if (!c || !this.target) return null;
    const r = c.record, parts = this.gridParts(c); const center = fromLocal(r, (this.target.x + 0.5) * RAFT.cell, (this.target.z + 0.5) * RAFT.cell);
    const candidates = [];
    parts.forEach((p, index) => {
      const id = p[0], def = partMeta(id); let wx, wz;
      if (def.layer === 'edge') { const d = p[4] || 0; const px = p[1] * RAFT.cell, pz = p[2] * RAFT.cell;
        const ex = d === 1 ? RAFT.cell : d === 2 ? RAFT.cell / 2 : d === 0 ? RAFT.cell / 2 : 0;
        const ez = d === 0 ? 0 : d === 1 ? RAFT.cell / 2 : d === 2 ? RAFT.cell : RAFT.cell / 2; wx = px + ex; wz = pz + ez;
      } else { wx = (p[1] + 0.5) * RAFT.cell; wz = (p[2] + 0.5) * RAFT.cell; }
      const pos = fromLocal(r, wx, wz); const projected = this.v.set(pos.x, r.y + p[3] * RAFT.levelHeight + 0.55, pos.z).project(this.camera);
      const px = (projected.x + 1) * (stage.w || this.canvas.clientWidth) / 2, py = (1 - projected.y) * (stage.h || this.canvas.clientHeight) / 2;
      const localPointer = this.lastPointer; const d2 = localPointer ? (px - localPointer.x) ** 2 + (py - localPointer.y) ** 2 : (pos.x - center.x) ** 2 + (pos.z - center.z) ** 2;
      if ((IDS.includes(id) || id === 'reinforcedFoundation') && p[3] === this.level && p[1] === this.target.x && p[2] === this.target.z && d2 < (localPointer ? 38 ** 2 : 0.75)) candidates.push({ index, p, d2, condition: this.conditionEntry(c, index) });
    });
    candidates.sort((a, b) => a.d2 - b.d2);
    return candidates[this.removeChoice % Math.max(1, candidates.length)] || null;
  }

  reinforcementTarget(c) {
    if (!c || !this.target) return null;
    const parts = this.gridParts(c);
    const index = parts.findIndex((p) => p[0] === 'foundation' && p[3] === 0
      && p[1] === this.target.x && p[2] === this.target.z);
    return index < 0 ? null : { index, p: parts[index], condition: this.conditionEntry(c, index) };
  }

  act() {
    if (!this.active || this.pending) return;
    const c = this.context(); if (!c) { this.close(); return; }
    if (c.record.rev !== c.ship.rev) { this.setResult('systems.raft.status.sync'); this.render(); return; }
    if (this.mode === 'remove') {
      const chosen = this.removalTarget(c); if (!chosen) { this.setResult('systems.raft.status.chooseRemove'); this.render(); return; }
      const id = crypto.randomUUID(); const message = { type: 'raft', op: 'remove', id: c.record.id, expectedRev: c.record.rev, opId: id, index: chosen.index, piece: [...chosen.p] };
      this.pending = { id, expectedRev: c.record.rev, op: 'remove', message, sentAt: performance.now() }; this.send(message);
    } else if (this.mode === 'reinforce') {
      const chosen = this.reinforcementTarget(c);
      if (!chosen) { this.setResult('systems.raft.status.chooseFoundation'); this.render(); return; }
      const id = crypto.randomUUID(); const message = { type: 'raft', op: 'reinforce', id: c.record.id, expectedRev: c.record.rev, opId: id, index: chosen.index, piece: [...chosen.p] };
      this.pending = { id, expectedRev: c.record.rev, op: 'reinforce', message, sentAt: performance.now() }; this.send(message);
    } else if (this.mode === 'repair') {
      const chosen = this.repairTarget(c);
      if (!chosen) { this.setResult('systems.raft.status.chooseDamaged'); this.render(); return; }
      const cost = this.repairCost(chosen), stock = { ...(c.ship.hold?.goods || {}) };
      for (const [g, n] of Object.entries(c.profile?.eco?.pack?.goods || {})) stock[g] = (stock[g] || 0) + n;
      if (Object.entries(cost).some(([g, n]) => (stock[g] || 0) < n)) {
        this.setResult('systems.raft.status.missingMaterials', { goods: Object.fromEntries(Object.entries(cost).map(([g, n]) => [g, Math.max(0, n - (stock[g] || 0))])) });
        this.render(); return;
      }
      const id = crypto.randomUUID(); const message = { type: 'raft', op: 'repair', id: c.record.id, expectedRev: c.record.rev,
        opId: id, index: chosen.index, piece: [...chosen.piece], partId: chosen.id, expectedHp: chosen.hp };
      this.pending = { id, expectedRev: c.record.rev, op: 'repair', message, sentAt: performance.now() }; this.send(message);
    } else {
      const piece = this.proposed(c); if (!piece) return;
      const why = this.placementReason(c, piece); if (why) { if (piece[0] === ARTISAN.part) this.setStorageResult(why); else this.setResult(`systems.raft.reason.${why}`); this.render(); return; }
      const id = crypto.randomUUID(); const message = { type: 'raft', op: 'place', id: c.record.id, expectedRev: c.record.rev, opId: id, piece };
      this.pending = { id, expectedRev: c.record.rev, op: 'place', message, sentAt: performance.now() }; this.send(message);
    }
    this.render();
  }

  cycleTarget() { this.removeChoice = (this.removeChoice || 0) + 1; this.render(); }
  revealDecision() {
    const action = this.$('.re-action');
    if (!action || this.root.clientHeight >= this.root.scrollHeight) return;
    const panel = this.root.getBoundingClientRect(), button = action.getBoundingClientRect();
    const panelEnd = stage.toLocal(panel.left, panel.bottom).y;
    const buttonEnd = stage.toLocal(button.left, button.bottom).y;
    if (buttonEnd > panelEnd) this.root.scrollTop += buttonEnd - panelEnd + 8;
  }
  onResult(ev) {
    if (!ev) return;
    if (ev.type === 'raftEdit' && (ev.op === 'quote' || Array.isArray(ev.supplies) && !ev.opId)) {
      const c = this.context(); if (!c || ev.id !== c.record.id || ev.rev !== c.record.rev) return;
      this.quotePending = null; if (ev.ok) this.quote = { rev: ev.rev, supplies: ev.supplies || [] }; else this.setResult(`systems.raft.reason.${ev.why || 'market'}`); this.render(); return;
    }
    if (!this.pending || ev.opId !== this.pending.id || ev.id !== this.pending.message.id || ev.op && ev.op !== this.pending.op) return;
    const storagePlace = this.pending.op === 'place' && this.pending.message.piece?.[0] === ARTISAN.part;
    if (storagePlace && (ev.historical || ev.replay)) { this.pending.historical = true; this.pending.ack = true; this.pending.durable = true; this.pending.resultRev = this.pending.expectedRev + 1; this.setStorageResult('storage'); if (this.active) this.render(); return; }
    const denied = ev.type === 'raftDenied' || ev.ok === false || !!ev.why;
    if (denied) { if (storagePlace) this.setStorageResult(ev.why || 'storage'); else this.setResult(`systems.raft.reason.${ev.why || 'invalid'}`); this.pending = null; }
    else if (storagePlace && (ev.durable !== true || !Number.isSafeInteger(ev.rev) || ev.rev !== this.pending.expectedRev + 1)) {
      this.setStorageResult('storage'); this.pending = null;
    } else { this.pending.ack = true; this.pending.durable = ev.durable === true; this.pending.resultRev = ev.rev; this.setResult(storagePlace ? 'systems.raft.status.planAccepted' : this.pending.op === 'supply' ? 'systems.raft.status.supplyAccepted' : this.pending.op === 'repair' ? 'systems.raft.status.repairAccepted' : this.pending.op === 'reinforce' ? 'systems.raft.status.planAccepted' : 'systems.raft.status.planAccepted'); }
    if (this.active) this.render();
  }

  render() {
    const c = this.context(); if (this.active && !c) { this.close(); return; }
    const isEnglish = english();
    this.syncStoragePalette();
    const disabled = !c || !!this.pending;
    this.root.classList.toggle('is-reinforce', this.mode === 'reinforce');
    this.root.classList.toggle('is-repair', this.mode === 'repair');
    this.root.classList.toggle('is-remove', this.mode === 'remove');
    this.root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === this.mode));
    this.root.querySelectorAll('[data-part]').forEach((b) => b.classList.toggle('on', b.dataset.part === this.selected));
    this.$('.re-level').value = String(this.level);
    this.$('.re-level').disabled = this.mode === 'repair' || this.mode === 'reinforce' || this.mode === 'place' && partMeta(this.selected).layer === 'base';
    const def = partMeta(this.selected), selection = this.mode === 'remove' ? this.removalTarget(c) : null;
    const reinforcement = this.mode === 'reinforce' ? this.reinforcementTarget(c) : null;
    const repair = this.mode === 'repair' ? this.repairTarget(c) : null;
    const cost = def.cost || {};
    const repairCost = repair ? this.repairCost(repair) : {};
    const refund = selection ? salvagePartCost(selection.condition || { part: selection.p, hp: partMeta(selection.p[0]).hp, maxHp: partMeta(selection.p[0]).hp }) : {};
    this.$('.re-details').innerHTML = this.mode === 'remove'
      ? `<b>${selection ? esc(translateData(partMeta(selection.p[0]).name)) : t('systems.raft.choosePart')}</b><small>${t('systems.raft.refund')}: ${fmtGoods(refund)}</small>`
      : this.mode === 'repair' ? `<b>${repair ? `${esc(translateData(partMeta(repair.piece[0]).name))} · ${fmtHp(repair.hp)}/${fmtHp(repair.maxHp)} HP` : t('systems.raft.chooseDamaged')}</b><small>${repair ? `${t('systems.raft.repair')}: ${fmtGoods(repairCost)} · ${t('systems.raft.cell')} ${repair.piece[1]}, ${repair.piece[2]} · ${t('systems.raft.level')} ${repair.piece[3]}` : t('systems.raft.chooseFromList')}</small>`
      : this.mode === 'reinforce' ? `<b>${reinforcement ? t('systems.raft.reinforceFoundation') : t('systems.raft.selectFoundation')}</b><small>${t('systems.raft.incrementalCost')}: ${fmtGoods(RAFT_REINFORCEMENT)} · ${t('systems.raft.replacement')}${reinforcement?.condition && reinforcement.condition.hp < reinforcement.condition.maxHp ? ` · ${t('systems.raft.retainHealth', { percent: Math.round(reinforcement.condition.hp / reinforcement.condition.maxHp * 100) })}` : ''}</small>`
      : `<b>${esc(translateData(def.name))}</b><small>${t('systems.raft.cost')}: ${fmtGoods(cost)}${this.selected === ARTISAN.part ? ` · +${partMeta(this.selected).hold} ${isEnglish ? 'hold capacity' : 'de capacidad de bodega'}` : ` · ${direction(this.selected, this.dir)}`}</small>`;
    const shelterHelp = this.$('.re-shelter-help');
    shelterHelp.hidden = this.mode !== 'place' || !['door', 'roof', 'lantern', ARTISAN.part].includes(this.selected);
    shelterHelp.textContent = this.selected === ARTISAN.part
      ? this.knowsStorage(c) ? (isEnglish ? 'Needs a free deck or floor cell. Adds cargo space; normal raft mass limits still apply.' : 'Necesita una casilla libre de cubierta o piso. Añade espacio de carga; se mantienen los límites normales de peso de la balsa.')
        : (isEnglish ? 'Learn this recipe from the workbench artisan after reaching the logging milestone and completing the community carpentry project.' : 'Aprende esta receta con la artesana del banco al alcanzar el hito de tala y completar la obra comunitaria de carpintería.')
      : this.selected === 'lantern'
      ? isEnglish ? 'Starts off. Use V or touch nearby to switch its warm light on or off. A broken lantern stops lighting; repair it and switch it on again. No fuel in this slice.'
        : 'Empieza apagado. Usa V o toca cerca para encender o apagar su luz cálida. Si se rompe deja de alumbrar; repáralo y enciéndelo otra vez. Sin combustible en este corte.'
      : this.selected === 'roof'
      ? isEnglish ? 'Needs a wall or pillar; one supported neighbour permits one cell of overhang. The roof lifts from view while you are inside.'
        : 'Necesita pared o pilar; un vecino soportado permite una casilla de voladizo. El techo se oculta al entrar debajo.'
      : isEnglish ? 'Unlocked door: anyone nearby can open it. Use V or the door button; keep the leaf clear.'
        : 'Puerta sin cerradura: cualquiera cerca puede abrirla. Usa V o el botón de puerta; deja libre la hoja.';
    const damaged = this.mode === 'repair' ? this.damagedEntries(c) : [];
    const conditionReady = !!this.conditionFor(c);
    this.$('.re-repair-list').innerHTML = this.mode !== 'repair' ? '' : !conditionReady
      ? `<small class="re-repair-empty">${t('systems.raft.updatingDiagnosis')}</small>`
      : damaged.length ? damaged.map((entry) => `<button type="button" data-repair-id="${esc(entry.id)}" aria-pressed="${entry.id === this.repairChoiceId}" ${this.pending ? 'disabled' : ''}><b>${esc(translateData(partMeta(entry.piece[0]).name))} · ${fmtHp(entry.hp)}/${fmtHp(entry.maxHp)} HP</b><span>${t('systems.raft.status.repairEntry', { x: entry.piece[1], z: entry.piece[2], level: entry.piece[3], goods: fmtGoods(entry.cost || repairPartCost({ ...entry, part: entry.piece })) })}</span></button>`).join('')
        : `<small class="re-repair-empty">${t('systems.raft.noDamaged')}</small>`;
    const forecast = this.placementForecast(c);
    const num = (value) => formatNumber(value, { maximumFractionDigits: 2 });
    const capFmt = (cap) => cap ? t('systems.raft.capacity.summary', { mass: num(cap.totalMass), limit: num(cap.totalLimit), remainder: cap.overMass > 0 ? t('systems.raft.capacity.excess', { value: num(cap.overMass) }) : t('systems.raft.capacity.free', { value: num(cap.freeMass) }) }) : t('systems.raft.capacity.unavailable');
    const serverCapacity = this.capacity?.();
    const tradeRev = c?.profile?.eco?.tradeRev;
    const confirmed = serverCapacity && c?.record?.rev === c?.ship?.rev && serverCapacity.id === c?.record?.id && serverCapacity.raftRev === c?.ship?.rev
      && serverCapacity.tradeRev === tradeRev && ['port', 'sailing', 'reboard'].includes(serverCapacity.mode)
       && Number.isFinite(serverCapacity.freeMass) && Number.isFinite(serverCapacity.dryMass)
       && Number.isFinite(serverCapacity.structuralLimit) && Number.isFinite(serverCapacity.safeDisplacement) && Number.isFinite(serverCapacity.totalLimit)
       && Number.isFinite(serverCapacity.crewMass) && Number.isFinite(serverCapacity.crewCount) && Number.isFinite(serverCapacity.guestMass)
       && ['ready', 'heavy', 'overloaded'].includes(serverCapacity.status)
      && Number.isFinite(serverCapacity.holdFree) && Number.isFinite(serverCapacity.holdCap);
    const liveCapacity = confirmed ? serverCapacity : forecast?.before;
    const heavyPct = formatNumber(RAFT_LOAD.heavyFraction * 100, { maximumFractionDigits: 0 });
    const capacityStatus = liveCapacity ? t(`systems.raft.capacity.status.${liveCapacity.status}`) : '';
    this.$('.re-capacity').innerHTML = forecast ? `<small class="re-capacity-kicker">${confirmed ? t('systems.raft.capacity.actual') : t('systems.raft.capacity.estimated')}${capacityStatus ? ` \u00b7 ${capacityStatus}` : ''}</small><div><span>${t('systems.raft.capacity.yourRaft')}</span><b>${capFmt(liveCapacity)}</b></div>${forecast.after ? `<small class="re-capacity-kicker">${t('systems.raft.capacity.preview')} ? ${this.mode === 'reinforce' ? t('systems.raft.reinforce') : t('systems.raft.build')}</small><div><span>${t('systems.raft.capacity.withPart')}</span><b>${capFmt(forecast.after)}</b></div><small class="re-capacity-note">${t('systems.raft.capacity.includesPart')}</small>` : `<small class="re-capacity-note">${forecast.state === 'idle' ? t('systems.raft.capacity.chooseCell') : forecast.state === 'remove' ? t('systems.raft.capacity.confirmRemoval') : forecast.state === 'repair' ? t('systems.raft.capacity.repairNoModules') : forecast.reason || t('systems.raft.capacity.noForecast')}</small>`}<small class="re-capacity-note">${t('systems.raft.capacity.structure', { structural: num(liveCapacity?.structuralLimit || 0), safe: num(liveCapacity?.safeDisplacement || 0) })}</small><small class="re-capacity-note">${t('systems.raft.capacity.crew', { mass: num(liveCapacity?.crewMass || 0), count: num(liveCapacity?.crewCount || 0), guests: num(liveCapacity?.guestMass || 0), heavyPct })}</small>${liveCapacity?.status === 'overloaded' ? `<small class="re-capacity-warning">${t('systems.raft.capacity.overloaded')}</small>` : ''}${confirmed ? '' : `<small class="re-capacity-note">${t('systems.raft.capacity.updating')}</small>`}` : '';
    const pack = c?.ship?.hold?.goods || {}, bag = c?.ship && this.profile()?.eco?.pack?.goods || {};
    const stock = Object.fromEntries([...new Set([...Object.keys(pack), ...Object.keys(bag), ...Object.keys(cost)])].map((g) => [g, (pack[g] || 0) + (bag[g] || 0)]));
    const hold = c?.ship?.hold || { cap: 0, goods: {} }, packStore = c?.profile?.eco?.pack || { cap: 0, goods: {} };
    const allParts = this.gridParts(c);
    const baseCount = allParts.filter((p) => partMeta(p[0]).layer === 'base').length || 0;
    this.$('.re-route').textContent = t('systems.raft.routeStatus', { stock: fmtGoods(stock), hold: holdUsed(hold), holdCap: hold.cap, pack: holdUsed(packStore), packCap: packStore.cap, bases: baseCount, maxBases: RAFT.maxCells, parts: allParts.length });
    const gold = c?.profile?.gold ?? 0;
    const offers = c && this.quote?.rev === c.record.rev ? this.quote.supplies : [];
    this.$('.re-supplies').innerHTML = offers.map((offer) => {
      const holdMassRoom = Math.max(0, Math.floor((raftCapacity(c.record.parts, hold).freeMass + 1e-8) / goodMass(offer.g)));
      const holdRoom = Math.min(roomFor(hold, offer.g), holdMassRoom);
      const room = holdRoom + roomFor(packStore, offer.g);
      return `<button type="button" data-supply="${esc(offer.g)}" ${disabled || offer.stock < 1 || gold < offer.price || room < 1 ? 'disabled' : ''}>${t('systems.raft.supply', { good: translateData(GOODS[offer.g]?.name || offer.g), price: formatNumber(offer.price) })}</button>`;
    }).join('');
    let reason = this.lastResult;
    if (!reason && c && this.mode === 'place' && this.target) { const why = this.placementReason(c); reason = this.selected === ARTISAN.part ? storageEditorReason(why) : reasonText(why); }
    if (!reason && this.mode === 'remove' && selection) reason = t('systems.raft.status.confirmRemove');
    if (!reason && this.mode === 'reinforce' && reinforcement) reason = t('systems.raft.status.confirmReinforce');
    if (!reason && this.mode === 'repair' && repair) reason = this.repairAffordable(c, repair) ? t('systems.raft.status.confirmRepair') : t('systems.raft.status.missingMaterials', { goods: fmtGoods(Object.fromEntries(Object.entries(repairCost).map(([g, n]) => [g, Math.max(0, n - (stock[g] || 0))]))) });
    if (!reason && this.mode === 'repair' && conditionReady && !damaged.length) reason = t('systems.raft.status.healthy');
    if (!reason && this.mode === 'repair' && !conditionReady) reason = t('systems.raft.status.waitingCondition');
    const coord = this.mode === 'repair'
      ? repair ? t('systems.raft.status.repairCoord', { part: translateData(partMeta(repair.piece[0]).name), hp: fmtHp(repair.hp), maxHp: fmtHp(repair.maxHp), x: repair.piece[1], z: repair.piece[2] }) : t('systems.raft.status.repairChoose')
        : t('systems.raft.status.cell', { coord: this.target ? `${this.target.x}, ${this.target.z}` : '\u2014', level: this.target?.level ?? this.level, direction: direction(this.selected, this.dir) });
    this.$('.re-status').textContent = this.pending ? `${coord} \u00b7 ${this.pending.ack ? t('systems.raft.status.waitingSnapshot') : t('systems.raft.status.sendingIntent')}${this.lastResult ? ` \u00b7 ${this.lastResult}` : ''}` : `${coord} \u00b7 ${reason || t('systems.raft.status.ready')}`;
    this.$('.re-retry').hidden = !this.pending || performance.now() - this.pending.sentAt < 5000;
    this.$('.re-action').textContent = this.mode === 'remove' ? t('systems.raft.confirmRemove') : this.mode === 'repair' ? t('systems.raft.confirmRepair') : this.mode === 'reinforce' ? t('systems.raft.confirmReinforce') : t('systems.raft.place');
    this.$('.re-action').disabled = disabled || c.record.rev !== c.ship.rev || (this.mode === 'place' ? !this.target || !!this.placementReason(c) : this.mode === 'reinforce' ? !reinforcement : this.mode === 'repair' ? !repair || !conditionReady || !this.repairAffordable(c, repair) : !selection);
    this.$('.re-cycle').hidden = this.mode !== 'remove';
    this.$('.re-remove-choice span').textContent = selection ? t('systems.raft.status.removeSelection', { index: selection.index, part: translateData(partMeta(selection.p[0]).name), x: selection.p[1], z: selection.p[2], level: selection.p[3] }) : t('systems.raft.status.pointPart');
    if (this.target && c && this.mode !== 'repair') {
      const p = fromLocal(c.record, (this.target.x + 0.5) * RAFT.cell, (this.target.z + 0.5) * RAFT.cell);
      const targetPiece = this.mode === 'remove' ? selection?.p : this.mode === 'reinforce' ? reinforcement?.p : this.mode === 'repair' ? repair?.piece : null;
      const placeDir = targetPiece ? targetPiece[4] || 0 : this.dir;
      const previewId = targetPiece ? targetPiece[0] : this.selected;
      const def = partMeta(previewId);
      const edgeOffset = def.layer === 'edge' ? { x: DIR[placeDir][0] * RAFT.cell / 2, z: DIR[placeDir][1] * RAFT.cell / 2 } : { x: 0, z: 0 };
      this.ghost.position.set(p.x + Math.cos(c.record.yaw) * edgeOffset.x + Math.sin(c.record.yaw) * edgeOffset.z, c.record.y + this.target.level * RAFT.levelHeight + 0.08, p.z - Math.sin(c.record.yaw) * edgeOffset.x + Math.cos(c.record.yaw) * edgeOffset.z);
      this.ghost.rotation.set(0, c.record.yaw + placeDir * Math.PI / 2, 0);
      const valid = this.mode === 'place' && !this.placementReason(c) || this.mode === 'reinforce' && !!reinforcement || this.mode === 'repair' && !!repair;
      this.ghostCell.material.color.setHex(valid ? 0x70e47a : 0xf06454);
      const layer = def.layer;
      const dims = layer === 'pillar' ? [0.28, RAFT.levelHeight * 0.92, 0.28]
        : layer === 'edge' ? [RAFT.cell * 0.88, previewId === 'railing' ? 0.75 : RAFT.levelHeight * 0.82, 0.12]
          : this.selected === 'crate' || this.mode === 'remove' && selection?.p[0] === 'crate' ? [0.75, 0.72, 0.75]
            : previewId === 'lantern' ? [0.5, 1.6, 0.5]
            : layer === 'roof' ? [RAFT.cell * 0.99, 0.16, RAFT.cell * 0.99]
            : layer === 'floor' || layer === 'base' ? [RAFT.cell * 0.9, 0.12, RAFT.cell * 0.9]
              : [RAFT.cell * 0.72, 0.28, RAFT.cell * 0.72];
      this.ghostPart.scale.set(...dims); this.ghostPart.position.y = layer === 'roof' ? RAFT.levelHeight - 0.13 : dims[1] / 2;
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
    this.syncStoragePalette();
    const c = this.context();
    if (this.pending?.ack && c && Number.isSafeInteger(this.pending.resultRev) && c.record.rev >= this.pending.resultRev && c.ship.rev >= this.pending.resultRev
        && (!this.pending.durable || this.pending.op !== 'place' || this.pending.message.piece?.[0] !== ARTISAN.part || this.knowsStorage(c))) {
      const op = this.pending.op, storagePlace = op === 'place' && this.pending.message.piece?.[0] === ARTISAN.part;
      this.pending = null; this.quote = null; this.quotePending = null;
      this.setResult(storagePlace ? 'systems.raft.status.planComplete' : op === 'supply' ? 'systems.raft.status.supplyComplete' : op === 'repair' ? 'systems.raft.status.repairComplete' : op === 'reinforce' ? 'systems.raft.status.reinforceComplete' : 'systems.raft.status.planComplete');
    }
    if (!this.active) return;
    if (this.enabled && !this.enabled()) { this.close(); return; }
    if (!c) { this.close(); this.launcher.hidden = true; return; }
    if (this.lastPointer) this.pointerLocal(this.lastPointer, false);
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

  retryPending() { if (!this.pending?.message) return; this.pending.sentAt = performance.now(); this.send(this.pending.message); if (this.active) this.render(); }
  reproject() { if (this.lastPointer) this.pointerLocal(this.lastPointer, false); }

  signature() {
    const c = this.context(); if (!c) return 'off';
    const capacity = this.capacity?.();
    return JSON.stringify([c.record.rev, c.ship.rev, c.ship.hold?.goods, c.profile.gold, c.profile.eco?.pack?.goods, c.profile.progression?.knowledge, globalThis.document?.documentElement?.lang,
      capacity && [capacity.id, capacity.raftRev, capacity.tradeRev, capacity.mode, capacity.freeMass, capacity.holdFree,
        capacity.crewMass, capacity.crewCount, capacity.guestMass, capacity.status,
        capacity.condition && [capacity.condition.hull, capacity.condition.entries?.filter((entry) => entry.hp < entry.maxHp)
          .map((entry) => [entry.index, entry.id, entry.hp, entry.maxHp, entry.piece, entry.cost])]],
      this.quote, this.target, this.repairChoiceId, this.selected, this.level, this.dir, this.mode, this.lastResult,
      this.pending && [this.pending.id, this.pending.ack, this.pending.resultRev, this.pending.sentAt], this.removeChoice]);
  }

  destroy() { this.unsubscribeLocale?.(); this.close(); this.canvas.removeEventListener('pointermove', this.onPointerMove); this.canvas.removeEventListener('pointerdown', this.onPointerDown); this.ghost.removeFromParent(); this.ghostCell.geometry.dispose(); this.ghostCell.material.dispose(); this.ghostPart.geometry.dispose(); this.ghostPart.material.dispose(); this.ghostArrow.geometry.dispose(); this.ghostArrow.material.dispose(); this.root.remove(); this.launcher.remove(); }
}
