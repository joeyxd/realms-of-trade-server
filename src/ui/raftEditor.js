// The raft editor is an intent client: it previews a single cell and waits for both an ack and a public snapshot.
import * as THREE from 'three';
import { RAFT, RAFT_LOAD, RAFT_PARTS, RAFT_REINFORCEMENT } from '../data/raftparts.js';
import { EDITOR_PARTS, EDITOR_REASONS, EDITOR_RADIUS } from '../data/raftEditor.js';
import { ARTISAN } from '../data/artisan.js';
import { readProgression } from '../sim/systems/progression.js';
import { readWorkshop } from '../sim/systems/workshop.js';
import { canPlace } from '../sim/economy/raft.js';
import { holdUsed, roomFor, goodMass } from '../sim/economy/cargo.js';
import { raftCapacity } from '../sim/economy/raftCapacity.js';
import { repairPartCost, salvagePartCost } from '../sim/naval/structure.js';
import { raftGangplank } from '../sim/raftGeometry.js';
import { stage } from './stage.js';

const IDS = EDITOR_PARTS;
const DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const direction = (id, dir) => (id === 'stairs' ? ['Sur', 'Este', 'Norte', 'Oeste'] : ['Norte', 'Este', 'Sur', 'Oeste'])[dir];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtGoods = (goods = {}) => Object.entries(goods).filter(([, n]) => n > 0).map(([g, n]) => `${n} ${g}`).join(' · ') || '0 materiales';
const fmtStorageGoods = (goods = {}) => Object.entries(goods).filter(([, n]) => n > 0).map(([g, n]) => `${n} ${{ madera: english() ? 'wood' : 'madera', hierro: english() ? 'iron' : 'hierro', piedra: english() ? 'stone' : 'piedra' }[g] || g}`).join(' · ') || (english() ? '0 materials' : '0 materiales');
const fmtHp = (n) => Number(n).toLocaleString('es-MX', { maximumFractionDigits: 1 });
const partMeta = (id) => RAFT_PARTS[id] || {};
const english = () => globalThis.document?.documentElement?.lang?.startsWith('en') === true;
const shelterName = (id) => english()
  ? ({ door: 'Door', roof: 'Roof', lantern: 'Lantern', torchFloor: 'Floor torch', torchWall: 'Wall torch', campfire: 'Campfire', storage: 'Storage' }[id] || partMeta(id).name) : partMeta(id).name;
const reasonText = (why) => EDITOR_REASONS[why] || ({ '': 'Lugar válido', goods: 'Faltan materiales', materials: 'Faltan materiales.', condition: 'El estado de la pieza cambió; actualiza el diagnóstico.', damage: 'La pieza ya no necesita reparación.', gold: 'No tienes oro suficiente.', market: 'El mercado no ofrece ese material.', stock: 'No queda material en Aldea.', calm: 'Espera a estar en calma para comprar.' })[why] || 'Lugar no válido';
const STORAGE_REASONS = {
  '': { es: 'Lugar válido.', en: 'Valid placement.' },
  knowledge: { es: 'Aprende Bodega con la artesana del banco antes de construirla.', en: 'Learn Storage from the workbench artisan before building it.' },
  crateKit: { es: 'Prepara un kit de caja en el banco de carpintería.', en: 'Craft a crate kit at the carpentry workbench.' },
  profile: { es: 'El estado del taller no está disponible.', en: 'Workshop state is unavailable.' },
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
const placementReasonText = (why, piece) => piece?.[0] === ARTISAN.part || ['crateKit', 'profile'].includes(why)
  ? storageEditorReason(why) : reasonText(why);
const workshopPaymentLabel = (payment, piece) => {
  const en = english();
  if (payment.why) return placementReasonText(payment.why, piece);
  if (payment.kit) return en ? 'Cost: 1 crate kit from the workbench.' : 'Coste: 1 kit de caja del banco.';
  if (piece?.[0] === ARTISAN.part && payment.credit) return en
    ? `First storage build paid by your workshop reward · +${partMeta(piece[0]).hold} hold capacity.`
    : `Primera bodega cubierta por la recompensa del taller · +${partMeta(piece[0]).hold} de capacidad.`;
  if (piece?.[0] === ARTISAN.part && payment.active) return en
    ? `Build cost: 10 wood · +${partMeta(piece[0]).hold} hold capacity.`
    : `Coste: 10 maderas · +${partMeta(piece[0]).hold} de capacidad.`;
  return '';
};
export const knowsRaftStorage = (profile) => {
  try { return readProgression(profile?.progression).knowledge.includes(ARTISAN.lesson); }
  catch { return false; }
};
export function workshopBuildPayment(profile, piece, workshopEnabled = false) {
  if (workshopEnabled !== true || !['crate', ARTISAN.part].includes(piece?.[0]))
    return { cost: partMeta(piece?.[0]).cost || {}, kit: false, credit: false, active: false };
  let workshop;
  try { workshop = readWorkshop(profile?.workshop); } catch { return { cost: {}, kit: false, credit: false, active: true, why: 'profile' }; }
  if (piece[0] === 'crate') return workshop.crateKits > 0
    ? { cost: {}, kit: true, credit: false, active: true, workshop: { ...workshop, crateKits: workshop.crateKits - 1 } }
    : { cost: {}, kit: true, credit: false, active: true, why: 'crateKit' };
  if (!knowsRaftStorage(profile)) return { cost: {}, kit: false, credit: false, active: true, why: 'knowledge' };
  return workshop.storageCredit
    ? { cost: {}, kit: false, credit: true, active: true, workshop: { ...workshop, storageCredit: false } }
    : { cost: { madera: 10 }, kit: false, credit: false, active: true };
}

function workshopSnapshot(profile) {
  try { return readWorkshop(profile?.workshop); } catch { return null; }
}
const workshopMatches = (profile, expected) => {
  const actual = workshopSnapshot(profile);
  return !!actual && !!expected && actual.v === expected.v && actual.boards === expected.boards
    && actual.storageCredit === expected.storageCredit && actual.crateKits === expected.crateKits;
};

export function raftPlacementReason(profile, parts, piece, workshopEnabled = false) {
  if (piece?.[0] === ARTISAN.part && !knowsRaftStorage(profile)) return 'knowledge';
  const payment = workshopBuildPayment(profile, piece, workshopEnabled);
  if (payment.why) return payment.why;
  return canPlace(parts, piece);
}

const fromLocal = (r, x, z) => ({ x: r.x + Math.cos(r.yaw) * x + Math.sin(r.yaw) * z,
  z: r.z - Math.sin(r.yaw) * x + Math.cos(r.yaw) * z });
const toLocal = (r, x, z) => { const dx = x - r.x, dz = z - r.z; return [Math.cos(r.yaw) * dx - Math.sin(r.yaw) * dz, Math.sin(r.yaw) * dx + Math.cos(r.yaw) * dz]; };

export class RaftEditor {
  constructor(opts) {
    Object.assign(this, opts);
    this.active = false; this.selected = 'foundation'; this.level = 0; this.dir = 0; this.quote = null; this.removeChoice = 0;
    this.mode = 'place'; this.target = null; this.pending = null; this.lastResult = ''; this.repairChoiceId = null;
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
      <div class="re-tabs" role="tablist"><button data-mode="place" type="button">Construir</button><button data-mode="repair" type="button">Reparar</button><button data-mode="reinforce" type="button">Reforzar</button><button data-mode="remove" type="button">Retirar</button></div>
      <div class="re-pieces" aria-label="Piezas"></div><div class="re-repair-list" aria-label="Piezas dañadas"></div><div class="re-details"></div><small class="re-shelter-help" hidden></small><div class="re-capacity" aria-live="polite"></div>
      <div class="re-options"><label>Nivel <select class="re-level"><option value="0">Cubierta</option><option value="1">Nivel 1</option><option value="2">Nivel 2</option></select></label><button class="re-rotate" type="button">Girar · R</button></div>
      <div class="re-status" aria-live="polite"></div><button class="re-retry" type="button" hidden>Reenviar misma solicitud</button><div class="re-supplies"></div><div class="re-remove-choice"><button class="re-cycle" type="button">Cambiar pieza</button><span></span></div>
      <footer><small class="re-route">Materiales: bodega de la balsa → mochila. Retiro: devuelve la mitad, primero a bodega y luego a mochila.</small><button class="re-action" type="button">Colocar</button></footer>`;
    this.parent.appendChild(this.root);
    this.$ = (s) => this.root.querySelector(s);
    this.bind(); this.renderPalette(); this.render();
    this.onPointerMove = (e) => { if (!this.active) return; this.pointer(e); };
    this.onPointerDown = (e) => { if (!this.active || e.button !== 0 || e.target.closest('.raft-editor')) return; e.preventDefault(); this.pointer(e); if (this.mode !== 'place' || e.pointerType === 'touch') { this.render(); if (this.mode === 'reinforce') this.revealDecision(); } else this.act(); };
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
  }

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
    this.$('.re-pieces').innerHTML = ids.map((id) => `<button type="button" data-part="${id}" title="${esc(shelterName(id))}"><i>${({ foundation: '▦', floor: '▤', pillar: '▥', wall: '▰', door: '▯', roof: '⌂', railing: '⌁', stairs: '▧', crate: '▣', storage: '▣', net: '▩', grill: '♨', lantern: '☼', torchFloor: '♨', torchWall: '♨', campfire: '♨' })[id]}</i><span>${esc(shelterName(id))}</span></button>`).join('');
    this.syncStoragePalette();
    this.root.querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', () => { this.selected = b.dataset.part; if (partMeta(this.selected).layer === 'floor' && this.level === 0) this.level = 1; if (partMeta(this.selected).layer === 'base' || this.selected === 'net') this.level = 0; this.mode = 'place'; this.target = null; this.reproject(); this.render(); }));
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
    if (this.target && (this.target.x !== x || this.target.z !== z || this.target.level !== (this.mode === 'remove' ? this.level : this.target.level))) { this.removeChoice = 0; this.lastResult = ''; }
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
    return (['torchFloor', 'torchWall', 'campfire'].includes(piece?.[0]) && !this.fireEnabled?.() ? 'disabled' : '') || raftPlacementReason(c?.profile, this.gridParts(c), piece, this.workshopEnabled?.() === true) || (['roof', 'lantern', 'torchFloor', 'torchWall', 'campfire'].includes(piece[0])
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
    if (why) return { before, after: null, state: 'invalid', reason: placementReasonText(why, piece) };
    const payment = workshopBuildPayment(c.profile, piece, this.workshopEnabled?.() === true);
    const cost = payment.cost, holdGoods = { ...(hold.goods || {}) }, packGoods = { ...(pack.goods || {}) };
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
      if (['edge', 'mount'].includes(def.layer)) { const d = p[4] || 0; const px = p[1] * RAFT.cell, pz = p[2] * RAFT.cell;
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
    if (c.record.rev !== c.ship.rev) { this.lastResult = 'Sincronizando plano y perfil; espera el siguiente snapshot.'; this.render(); return; }
    if (this.mode === 'remove') {
      const chosen = this.removalTarget(c); if (!chosen) { this.lastResult = 'Toca o apunta a una pieza para retirarla.'; this.render(); return; }
      const id = crypto.randomUUID(); const message = { type: 'raft', op: 'remove', id: c.record.id, expectedRev: c.record.rev, opId: id, index: chosen.index, piece: [...chosen.p] };
      const workshopRule = this.workshopEnabled?.() === true && ['crate', ARTISAN.part].includes(chosen.p[0]);
      this.pending = { id, expectedRev: c.record.rev, op: 'remove', message, sentAt: performance.now(),
        workshopRule, expectedWorkshop: workshopRule ? workshopSnapshot(c.profile) : null,
        expectedTradeRev: workshopRule ? c.profile.eco.tradeRev : null }; this.send(message);
    } else if (this.mode === 'reinforce') {
      const chosen = this.reinforcementTarget(c);
      if (!chosen) { this.lastResult = 'Apunta a un cimiento básico para reforzarlo.'; this.render(); return; }
      const id = crypto.randomUUID(); const message = { type: 'raft', op: 'reinforce', id: c.record.id, expectedRev: c.record.rev, opId: id, index: chosen.index, piece: [...chosen.p] };
      this.pending = { id, expectedRev: c.record.rev, op: 'reinforce', message, sentAt: performance.now() }; this.send(message);
    } else if (this.mode === 'repair') {
      const chosen = this.repairTarget(c);
      if (!chosen) { this.lastResult = 'Elige una pieza dañada de la lista.'; this.render(); return; }
      const cost = this.repairCost(chosen), stock = { ...(c.ship.hold?.goods || {}) };
      for (const [g, n] of Object.entries(c.profile?.eco?.pack?.goods || {})) stock[g] = (stock[g] || 0) + n;
      if (Object.entries(cost).some(([g, n]) => (stock[g] || 0) < n)) {
        this.lastResult = `Faltan materiales: ${fmtGoods(Object.fromEntries(Object.entries(cost).map(([g, n]) => [g, Math.max(0, n - (stock[g] || 0))])))}`;
        this.render(); return;
      }
      const id = crypto.randomUUID(); const message = { type: 'raft', op: 'repair', id: c.record.id, expectedRev: c.record.rev,
        opId: id, index: chosen.index, piece: [...chosen.piece], partId: chosen.id, expectedHp: chosen.hp };
      this.pending = { id, expectedRev: c.record.rev, op: 'repair', message, sentAt: performance.now() }; this.send(message);
    } else {
      const piece = this.proposed(c); if (!piece) return;
      const why = this.placementReason(c, piece); if (why) { this.lastResult = placementReasonText(why, piece); this.render(); return; }
      const id = crypto.randomUUID(); const message = { type: 'raft', op: 'place', id: c.record.id, expectedRev: c.record.rev, opId: id, piece };
      const workshopRule = this.workshopEnabled?.() === true && ['crate', ARTISAN.part].includes(piece[0]);
      const payment = workshopBuildPayment(c.profile, piece, workshopRule);
      this.pending = { id, expectedRev: c.record.rev, op: 'place', message, sentAt: performance.now(), workshopRule,
        expectedWorkshop: workshopRule ? payment.workshop || workshopSnapshot(c.profile) : null,
        expectedTradeRev: workshopRule ? c.profile.eco.tradeRev + 1 : null }; this.send(message);
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
      this.quotePending = null; if (ev.ok) this.quote = { rev: ev.rev, supplies: ev.supplies || [] }; else this.lastResult = reasonText(ev.why || 'market'); this.render(); return;
    }
    if (!this.pending || ev.opId !== this.pending.id || ev.id !== this.pending.message.id || ev.op && ev.op !== this.pending.op) return;
    const storagePlace = this.pending.op === 'place' && this.pending.message.piece?.[0] === ARTISAN.part;
    const workshopProfileOp = this.pending.workshopRule === true;
    if ((storagePlace || workshopProfileOp) && (ev.historical || ev.replay)) { this.pending.historical = true; this.pending.ack = true; this.pending.durable = true; this.pending.resultRev = this.pending.expectedRev + 1; this.lastResult = storageEditorReason('storage'); if (this.active) this.render(); return; }
    const denied = ev.type === 'raftDenied' || ev.ok === false || !!ev.why;
    if (denied) { this.lastResult = storagePlace ? storageEditorReason(ev.why || 'storage') : reasonText(ev.why || 'invalid'); this.pending = null; }
    else if ((storagePlace || workshopProfileOp) && (ev.durable !== true || !Number.isSafeInteger(ev.rev) || ev.rev !== this.pending.expectedRev + 1)) {
      this.lastResult = storageEditorReason('storage'); this.pending = null;
    } else { this.pending.ack = true; this.pending.durable = ev.durable === true; this.pending.resultRev = ev.rev; this.lastResult = (storagePlace || workshopProfileOp) ? (english() ? 'Build accepted; waiting for raft and profile updates…' : 'Obra aceptada; esperando la balsa y el perfil…') : this.pending.op === 'supply' ? 'Compra aceptada; esperando inventario actualizado…' : this.pending.op === 'repair' ? 'Reparación aceptada; esperando el estado actualizado…' : this.pending.op === 'reinforce' ? 'Refuerzo aceptado; esperando el plano actualizado…' : 'Servidor aceptó; esperando el plano actualizado…'; }
    if (this.active) this.render();
  }

  render() {
    const c = this.context(); if (this.active && !c) { this.close(); return; }
    const storageFlow = this.selected === ARTISAN.part || this.pending?.message?.piece?.[0] === ARTISAN.part
      || this.workshopEnabled?.() === true && (this.selected === 'crate' || this.pending?.message?.piece?.[0] === 'crate');
    const isEnglish = english();
    this.syncStoragePalette();
    this.$('.re-head b').textContent = storageFlow && isEnglish ? 'RAFT DECKYARD' : 'ASTILLERO DE CUBIERTA';
    this.$('.re-close').setAttribute('aria-label', storageFlow && isEnglish ? 'Close' : 'Salir');
    const modeNames = storageFlow && isEnglish ? { place: 'Build', repair: 'Repair', reinforce: 'Reinforce', remove: 'Remove' } : { place: 'Construir', repair: 'Reparar', reinforce: 'Reforzar', remove: 'Retirar' };
    this.root.querySelectorAll('[data-mode]').forEach((button) => { button.textContent = modeNames[button.dataset.mode]; });
    const levelLabel = this.$('.re-level').parentElement;
    levelLabel.firstChild.textContent = storageFlow && isEnglish ? 'Level ' : 'Nivel ';
    const options = this.$('.re-level').options;
    if (storageFlow && isEnglish) { options[0].textContent = 'Deck'; options[1].textContent = 'Level 1'; options[2].textContent = 'Level 2'; }
    else { options[0].textContent = 'Cubierta'; options[1].textContent = 'Nivel 1'; options[2].textContent = 'Nivel 2'; }
    this.$('.re-rotate').textContent = storageFlow && isEnglish ? 'Rotate · R' : 'Girar · R';
    this.$('.re-retry').textContent = storageFlow && isEnglish ? 'Retry the same request' : 'Reenviar misma solicitud';
    this.$('.re-cycle').textContent = storageFlow && isEnglish ? 'Change piece' : 'Cambiar pieza';
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
    const workshopOn = this.workshopEnabled?.() === true;
    const selectedPayment = workshopBuildPayment(c?.profile, [this.selected, this.target?.x || 0, this.target?.z || 0,
      this.target?.level || this.level, this.dir], workshopOn);
    const repairCost = repair ? this.repairCost(repair) : {};
    const refund = selection ? salvagePartCost(selection.condition || { part: selection.p, hp: partMeta(selection.p[0]).hp, maxHp: partMeta(selection.p[0]).hp }) : {};
    this.$('.re-details').innerHTML = this.mode === 'remove'
      ? `<b>${selection ? esc(partMeta(selection.p[0]).name) : storageFlow && isEnglish ? 'Choose a piece' : 'Elige una pieza'}</b><small>${storageFlow && isEnglish ? `Estimated refund: ${fmtStorageGoods(refund)}` : `Devolución prevista: ${fmtGoods(refund)}`}</small>`
      : this.mode === 'repair' ? `<b>${repair ? `${esc(partMeta(repair.piece[0]).name)} · ${fmtHp(repair.hp)}/${fmtHp(repair.maxHp)} HP` : 'Elige una pieza dañada'}</b><small>${repair ? `Reparar: ${fmtGoods(repairCost)} · casilla ${repair.piece[1]}, ${repair.piece[2]} · nivel ${repair.piece[3]}` : 'Elige una pieza de la lista para revisar su coste.'}</small>`
      : this.mode === 'reinforce' ? `<b>${reinforcement ? 'Refuerzo · Cimiento básico' : 'Selecciona un cimiento básico'}</b><small>Coste incremental: ${fmtGoods(RAFT_REINFORCEMENT)} · reemplazo 1:1${reinforcement?.condition && reinforcement.condition.hp < reinforcement.condition.maxHp ? ` · conservará ${Math.round(reinforcement.condition.hp / reinforcement.condition.maxHp * 100)}% de su vida` : ''}</small>`
      : workshopOn && ['crate', ARTISAN.part].includes(this.selected)
        ? `<b>${esc(shelterName(this.selected))}</b><small>${esc(workshopPaymentLabel(selectedPayment, [this.selected]))}</small>`
      : this.selected === ARTISAN.part
        ? `<b>${esc(shelterName(this.selected))}</b><small>${english() ? `Build cost: ${cost.madera || 6} wood · +${partMeta(this.selected).hold} hold capacity` : `Coste: ${cost.madera || 6} madera · +${partMeta(this.selected).hold} de capacidad de bodega`}</small>`
        : `<b>${esc(shelterName(this.selected))}</b><small>Coste: ${fmtGoods(cost)} · ${direction(this.selected, this.dir)}</small>`;
    const shelterHelp = this.$('.re-shelter-help');
    shelterHelp.hidden = this.mode !== 'place' || !['door', 'roof', 'lantern', 'torchFloor', 'torchWall', 'campfire', 'grill', ARTISAN.part, ...(workshopOn ? ['crate'] : [])].includes(this.selected);
    shelterHelp.textContent = workshopOn && this.selected === 'crate'
      ? isEnglish ? 'Place one crate kit prepared at the carpentry workbench. It adds raft cargo space.' : 'Coloca un kit preparado en el banco de carpintería. Añade espacio de carga a la balsa.'
      : this.selected === ARTISAN.part
      ? this.knowsStorage(c) ? (isEnglish ? 'Needs a free deck or floor cell. Adds cargo space; normal raft mass limits still apply.' : 'Necesita una casilla libre de cubierta o piso. Añade espacio de carga; se mantienen los límites normales de peso de la balsa.')
        : (isEnglish ? 'Learn this recipe from the workbench artisan after reaching the logging milestone and completing the community carpentry project.' : 'Aprende esta receta con la artesana del banco al alcanzar el hito de tala y completar la obra comunitaria de carpintería.')
      : ['lantern', 'torchFloor', 'torchWall', 'campfire', 'grill'].includes(this.selected)
      ? this.fireEnabled?.()
        ? (isEnglish ? 'Starts off. Use V or touch nearby to load one wood and light it. Fixed lamps last 60 minutes; campfires and grills last 30. Extinguish to preserve fuel. Wall torches need a wall.'
          : 'Empieza apagado. Usa V o toca cerca para cargar una madera y encender. Las luces fijas duran 60 minutos; fogatas y parrillas, 30. Apaga para conservar combustible. La antorcha de pared necesita pared.')
        : (isEnglish ? 'Starts off. Use V or touch nearby to switch the light on or off.' : 'Empieza apagado. Usa V o toca cerca para encender o apagar la luz.')
      : this.selected === 'roof'
      ? isEnglish ? 'Needs a wall or pillar; one supported neighbour permits one cell of overhang. The roof lifts from view while you are inside.'
        : 'Necesita pared o pilar; un vecino soportado permite una casilla de voladizo. El techo se oculta al entrar debajo.'
      : isEnglish ? 'Unlocked door: anyone nearby can open it. Use V or the door button; keep the leaf clear.'
        : 'Puerta sin cerradura: cualquiera cerca puede abrirla. Usa V o el botón de puerta; deja libre la hoja.';
    const damaged = this.mode === 'repair' ? this.damagedEntries(c) : [];
    const conditionReady = !!this.conditionFor(c);
    this.$('.re-repair-list').innerHTML = this.mode !== 'repair' ? '' : !conditionReady
      ? '<small class="re-repair-empty">Actualizando el diagnóstico de piezas…</small>'
      : damaged.length ? damaged.map((entry) => `<button type="button" data-repair-id="${esc(entry.id)}" aria-pressed="${entry.id === this.repairChoiceId}" ${this.pending ? 'disabled' : ''}><b>${esc(partMeta(entry.piece[0]).name)} · ${fmtHp(entry.hp)}/${fmtHp(entry.maxHp)} HP</b><span>Casilla ${entry.piece[1]}, ${entry.piece[2]} · nivel ${entry.piece[3]} · ${fmtGoods(entry.cost || repairPartCost({ ...entry, part: entry.piece }))}</span></button>`).join('')
        : '<small class="re-repair-empty">No hay piezas dañadas en este plano.</small>';
    const forecast = this.placementForecast(c);
    const num = (value) => value.toLocaleString('es-MX', { maximumFractionDigits: 2 });
    const capFmt = (cap) => cap ? `${num(cap.totalMass)} / ${num(cap.totalLimit)} uM · ${cap.overMass > 0 ? `${isEnglish ? 'over by' : 'exceso'} ${num(cap.overMass)}` : `${num(cap.freeMass)} ${isEnglish ? 'free' : 'libres'}`}` : (isEnglish ? 'Capacity unavailable' : 'Capacidad no disponible');
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
    const heavyPct = (RAFT_LOAD.heavyFraction * 100).toLocaleString('es-MX', { maximumFractionDigits: 0 });
    const capacityStatus = (isEnglish ? { ready: 'READY', heavy: 'HEAVY', overloaded: 'OVERLOADED' } : { ready: 'LISTA', heavy: 'PESADA', overloaded: 'SOBRECARGADA' })[liveCapacity?.status];
    this.$('.re-capacity').innerHTML = forecast ? `<small class="re-capacity-kicker">${confirmed ? (isEnglish ? 'CURRENT' : 'ACTUAL') : (isEnglish ? 'CURRENT · ESTIMATED' : 'ACTUAL · ESTIMADO')}${capacityStatus ? ` · ${capacityStatus}` : ''}</small><div><span>${isEnglish ? 'Your raft' : 'Tu balsa'}</span><b>${capFmt(liveCapacity)}</b></div>${forecast.after ? `<small class="re-capacity-kicker">${isEnglish ? 'PREVIEW' : 'VISTA PREVIA'} · ${this.mode === 'reinforce' ? (isEnglish ? 'REINFORCEMENT' : 'REFUERZO') : (isEnglish ? 'PLACEMENT' : 'COLOCACIÓN')}</small><div><span>${isEnglish ? 'With this piece' : 'Con la pieza'}</span><b>${capFmt(forecast.after)}</b></div><small class="re-capacity-note">${isEnglish ? 'Includes the piece and its materials.' : 'Incluye la pieza y sus materiales.'}</small>` : `<small class="re-capacity-note">${forecast.state === 'idle' ? (isEnglish ? 'Choose a valid cell to compare.' : 'Elige una casilla válida para comparar.') : forecast.state === 'remove' ? (isEnglish ? 'Confirm removal to see the result.' : 'Confirma el retiro para ver el resultado.') : forecast.state === 'repair' ? (isEnglish ? 'Repair restores a piece without adding modules.' : 'La reparación restaura una pieza sin añadir módulos.') : forecast.reason || (isEnglish ? 'No preview for this placement.' : 'Sin previsión para esta colocación.')}</small>`}<small class="re-capacity-note">${isEnglish ? 'Structure' : 'Estructura'} ${num(liveCapacity?.structuralLimit || 0)} · ${isEnglish ? 'safe displacement' : 'desplazamiento seguro'} ${num(liveCapacity?.safeDisplacement || 0)} uM.</small><small class="re-capacity-note">${isEnglish ? 'Crew' : 'Tripulación'} ${num(liveCapacity?.crewMass || 0)} uM (${num(liveCapacity?.crewCount || 0)}) · ${isEnglish ? 'guests' : 'invitados'} ${num(liveCapacity?.guestMass || 0)} uM · ${isEnglish ? 'heavy from' : 'pesado desde'} ${heavyPct}%.</small>${liveCapacity?.status === 'overloaded' ? `<small class="re-capacity-warning">${isEnglish ? 'Overloaded: cannot sail until below the limit.' : 'Sobrecargada: no puede zarpar hasta quedar bajo el límite.'}</small>` : ''}${confirmed ? '' : `<small class="re-capacity-note">${isEnglish ? 'Updating raft status…' : 'Actualizando el estado de tu balsa…'}</small>`}` : '';
    const pack = c?.ship?.hold?.goods || {}, bag = c?.ship && this.profile()?.eco?.pack?.goods || {};
    const stock = Object.fromEntries([...new Set([...Object.keys(pack), ...Object.keys(bag), ...Object.keys(cost)])].map((g) => [g, (pack[g] || 0) + (bag[g] || 0)]));
    const hold = c?.ship?.hold || { cap: 0, goods: {} }, packStore = c?.profile?.eco?.pack || { cap: 0, goods: {} };
    const allParts = this.gridParts(c);
    const baseCount = allParts.filter((p) => partMeta(p[0]).layer === 'base').length || 0;
    this.$('.re-route').textContent = storageFlow && isEnglish
      ? `You carry ${fmtStorageGoods(stock)} · raft hold ${holdUsed(hold)}/${hold.cap} · pack ${holdUsed(packStore)}/${packStore.cap}. ${baseCount}/${RAFT.maxCells} foundations; ${allParts.length}/600 pieces. Build uses hold → pack; removal refunds by condition.`
      : `Tienes ${storageFlow ? fmtStorageGoods(stock) : fmtGoods(stock)} · bodega ${holdUsed(hold)}/${hold.cap} · mochila ${holdUsed(packStore)}/${packStore.cap}. ${baseCount}/${RAFT.maxCells} cimientos; ${allParts.length}/600 piezas. Compra/obra: bodega → mochila. Retiro: según estado.`;
    const gold = c?.profile?.gold ?? 0;
    const offers = c && this.quote?.rev === c.record.rev ? this.quote.supplies : [];
    this.$('.re-supplies').innerHTML = offers.map((offer) => {
      const holdMassRoom = Math.max(0, Math.floor((raftCapacity(c.record.parts, hold).freeMass + 1e-8) / goodMass(offer.g)));
      const holdRoom = Math.min(roomFor(hold, offer.g), holdMassRoom);
      const room = holdRoom + roomFor(packStore, offer.g);
      return `<button type="button" data-supply="${esc(offer.g)}" ${disabled || offer.stock < 1 || gold < offer.price || room < 1 ? 'disabled' : ''}>${offer.g === 'madera' ? 'Madera' : 'Hierro'} +1 · ${offer.price} oro</button>`;
    }).join('');
    let reason = this.lastResult;
    if (!reason && c && this.mode === 'place' && this.target) { const why = this.placementReason(c); reason = placementReasonText(why, this.proposed(c)); }
    if (!reason && this.mode === 'remove' && selection) reason = 'Confirma para retirar; se valida soporte y ocupantes en servidor.';
    if (!reason && this.mode === 'reinforce' && reinforcement) reason = 'Confirma para sustituir este cimiento en su misma casilla.';
    if (!reason && this.mode === 'repair' && repair) reason = this.repairAffordable(c, repair) ? 'Revisa la pieza y confirma para repararla.' : `Faltan materiales: ${fmtGoods(Object.fromEntries(Object.entries(repairCost).map(([g, n]) => [g, Math.max(0, n - (stock[g] || 0))])))}`;
    if (!reason && this.mode === 'repair' && conditionReady && !damaged.length) reason = 'El plano está en buen estado.';
    if (!reason && this.mode === 'repair' && !conditionReady) reason = 'Esperando el estado confirmado de las piezas.';
    const storageDirection = ['North', 'East', 'South', 'West'][this.dir];
    const coord = this.mode === 'repair'
      ? repair ? `${partMeta(repair.piece[0]).name} · ${fmtHp(repair.hp)}/${fmtHp(repair.maxHp)} HP · casilla ${repair.piece[1]}, ${repair.piece[2]}` : 'Reparación · elige una pieza dañada'
        : `${storageFlow && isEnglish ? 'Cell' : 'Casilla'} ${this.target ? `${this.target.x}, ${this.target.z}` : '—'} · ${storageFlow && isEnglish ? 'level' : 'nivel'} ${this.target?.level ?? this.level} · ${storageFlow && isEnglish ? storageDirection : direction(this.selected, this.dir)}`;
    const waiting = english() ? (this.pending?.ack ? 'Waiting for raft and profile updates…' : 'Sending placement…') : (this.pending?.ack ? 'Esperando la balsa y el perfil…' : 'Enviando colocación…');
    this.$('.re-status').textContent = this.pending ? `${coord} · ${storageFlow ? waiting : this.pending.ack ? 'Esperando snapshot e inventario…' : 'Enviando intención…'}${this.lastResult ? ` · ${this.lastResult}` : ''}` : `${coord} · ${reason || (english() ? 'Ready' : 'Listo')}`;
    this.$('.re-retry').hidden = !this.pending || performance.now() - this.pending.sentAt < 5000;
    this.$('.re-action').textContent = this.mode === 'remove' ? (storageFlow && isEnglish ? 'Confirm removal' : 'Confirmar retiro') : this.mode === 'repair' ? (storageFlow && isEnglish ? 'Confirm repair' : 'Confirmar reparación') : this.mode === 'reinforce' ? (storageFlow && isEnglish ? 'Confirm reinforcement' : 'Confirmar refuerzo') : storageFlow && isEnglish ? 'Place' : 'Colocar';
    this.$('.re-action').disabled = disabled || c.record.rev !== c.ship.rev || (this.mode === 'place' ? !this.target || !!this.placementReason(c) : this.mode === 'reinforce' ? !reinforcement : this.mode === 'repair' ? !repair || !conditionReady || !this.repairAffordable(c, repair) : !selection);
    this.$('.re-cycle').hidden = this.mode !== 'remove';
    this.$('.re-remove-choice span').textContent = selection ? `#${selection.index} · ${esc(partMeta(selection.p[0]).name)} · ${selection.p[1]}, ${selection.p[2]}, ${storageFlow && isEnglish ? 'level' : 'nivel'} ${selection.p[3]}` : storageFlow && isEnglish ? 'Point at a piece' : 'Apunta a una pieza';
    if (this.target && c && this.mode !== 'repair') {
      const p = fromLocal(c.record, (this.target.x + 0.5) * RAFT.cell, (this.target.z + 0.5) * RAFT.cell);
      const targetPiece = this.mode === 'remove' ? selection?.p : this.mode === 'reinforce' ? reinforcement?.p : this.mode === 'repair' ? repair?.piece : null;
      const placeDir = targetPiece ? targetPiece[4] || 0 : this.dir;
      const previewId = targetPiece ? targetPiece[0] : this.selected;
      const def = partMeta(previewId);
      const edgeOffset = ['edge', 'mount'].includes(def.layer) ? { x: DIR[placeDir][0] * RAFT.cell / 2, z: DIR[placeDir][1] * RAFT.cell / 2 } : { x: 0, z: 0 };
      this.ghost.position.set(p.x + Math.cos(c.record.yaw) * edgeOffset.x + Math.sin(c.record.yaw) * edgeOffset.z, c.record.y + this.target.level * RAFT.levelHeight + 0.08, p.z - Math.sin(c.record.yaw) * edgeOffset.x + Math.cos(c.record.yaw) * edgeOffset.z);
      this.ghost.rotation.set(0, c.record.yaw + placeDir * Math.PI / 2, 0);
      const valid = this.mode === 'place' && !this.placementReason(c) || this.mode === 'reinforce' && !!reinforcement || this.mode === 'repair' && !!repair;
      this.ghostCell.material.color.setHex(valid ? 0x70e47a : 0xf06454);
      const layer = def.layer;
      const dims = layer === 'pillar' ? [0.28, RAFT.levelHeight * 0.92, 0.28]
        : ['edge', 'mount'].includes(layer) ? [RAFT.cell * 0.88, previewId === 'railing' ? 0.75 : RAFT.levelHeight * 0.82, 0.12]
          : this.selected === 'crate' || this.mode === 'remove' && selection?.p[0] === 'crate' ? [0.75, 0.72, 0.75]
            : previewId === 'lantern' ? [0.5, 1.6, 0.5]
            : layer === 'roof' ? [RAFT.cell * 0.99, 0.16, RAFT.cell * 0.99]
            : layer === 'floor' || layer === 'base' ? [RAFT.cell * 0.9, 0.12, RAFT.cell * 0.9]
              : [RAFT.cell * 0.72, 0.28, RAFT.cell * 0.72];
      this.ghostPart.scale.set(...dims); this.ghostPart.position.y = layer === 'roof' ? RAFT.levelHeight - 0.13 : dims[1] / 2;
      this.ghostArrow.position.set(0, Math.max(0.16, dims[1] + 0.12), 0.72);
      const arrowSign = ['edge', 'mount'].includes(def.layer) && placeDir % 2 === 0 ? -1 : 1;
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
    const pendingWorkshopProfile = this.pending?.workshopRule === true;
    const workshopProfileReady = !pendingWorkshopProfile || Number.isSafeInteger(c?.profile?.eco?.tradeRev)
      && c.profile.eco.tradeRev >= this.pending.expectedTradeRev && workshopMatches(c.profile, this.pending.expectedWorkshop);
    if (this.pending?.ack && c && Number.isSafeInteger(this.pending.resultRev) && c.record.rev >= this.pending.resultRev && c.ship.rev >= this.pending.resultRev
        && workshopProfileReady
        && (!this.pending.durable || this.pending.op !== 'place' || this.pending.message.piece?.[0] !== ARTISAN.part || this.knowsStorage(c))) {
      const op = this.pending.op, storagePlace = op === 'place' && this.pending.message.piece?.[0] === ARTISAN.part;
      this.pending = null; this.quote = null; this.quotePending = null;
      this.lastResult = storagePlace ? (english() ? 'Storage confirmed by raft and profile.' : 'Bodega confirmada por la balsa y el perfil.') : op === 'supply' ? 'Compra confirmada por snapshot.' : op === 'repair' ? 'Reparación confirmada por snapshot.' : op === 'reinforce' ? 'Refuerzo confirmado por snapshot.' : 'Plano confirmado por snapshot.';
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
    return JSON.stringify([c.record.rev, c.ship.rev, c.ship.hold?.goods, c.profile.gold, c.profile.eco?.tradeRev, c.profile.eco?.pack?.goods,
      c.profile.progression?.knowledge, c.profile.workshop, c.profile.carry, globalThis.document?.documentElement?.lang,
      capacity && [capacity.id, capacity.raftRev, capacity.tradeRev, capacity.mode, capacity.freeMass, capacity.holdFree,
        capacity.crewMass, capacity.crewCount, capacity.guestMass, capacity.status,
        capacity.condition && [capacity.condition.hull, capacity.condition.entries?.filter((entry) => entry.hp < entry.maxHp)
          .map((entry) => [entry.index, entry.id, entry.hp, entry.maxHp, entry.piece, entry.cost])]],
      this.quote, this.target, this.repairChoiceId, this.selected, this.level, this.dir, this.mode, this.lastResult,
      this.pending && [this.pending.id, this.pending.ack, this.pending.resultRev, this.pending.expectedWorkshop, this.pending.expectedTradeRev, this.pending.sentAt], this.removeChoice]);
  }

  destroy() { this.close(); this.canvas.removeEventListener('pointermove', this.onPointerMove); this.canvas.removeEventListener('pointerdown', this.onPointerDown); this.ghost.removeFromParent(); this.ghostCell.geometry.dispose(); this.ghostCell.material.dispose(); this.ghostPart.geometry.dispose(); this.ghostPart.material.dispose(); this.ghostArrow.geometry.dispose(); this.ghostArrow.material.dispose(); this.root.remove(); this.launcher.remove(); }
}
