// TA03: client side of the hold-to-chop (spec-tala-v1.md "Client feel"). Only runs when the snapshot says chop mode is on
// (client.resources.chop === 1). ChopController holds the logic and has no DOM, so node tests can drive it with fake clocks;
// ChopBar is the per-swing bar and is the only part that touches the document.
import { HARVEST, sanitizeTools } from '../data/resources.js';
import { AXES, CHOP, greenTicks } from '../data/chopping.js';
import { GOODS } from '../data/goods.js';
import { DT } from '../data/tuning.js';
import { loggingStatus } from '../sim/systems/progression.js';
import { loggingTimingRank } from '../sim/systems/loggingTiming.js';
import { dataParam, rich, setAttributeText } from '../core/i18n.js';

const TICK_MS = DT * 1000, PICKUP_RETRY_MS = 2000, RETRY_MIN_MS = 120, FALLEN_KEEP = 64;
const EPS = 1e-6; // the server's busy() threshold: any motion cancels a swing there
const ticksSince = (t0, t) => (t - t0) / TICK_MS + 1e-6; // the epsilon absorbs float error at exact tick boundaries

export const axeTier = (profile) => sanitizeTools(profile?.tools).axe;
// Same rule as the server (sim/systems/chopping.js cadenceOf / timingRank): the learned cadence at logging rank 2.
export function chopCadence(profile, tier = axeTier(profile)) {
  if (!AXES[tier]) return 0;
  let learned = false;
  try { learned = loggingStatus(profile?.progression).rank === 2; } catch { /* corrupt progression: base cadence */ }
  return learned ? AXES[tier].learned : AXES[tier].cadence;
}
export function chopGreen(profile, cadence) {
  const practice = profile?.progression?.practice?.logging;
  let rank = 1;
  try { rank = loggingTimingRank(Number.isSafeInteger(practice) && practice >= 0 ? practice : 0); } catch { /* base rank */ }
  return greenTicks(rank, cadence);
}
const defaultOpId = () => globalThis.crypto.randomUUID();

export class ChopController {
  // client(): the GameClient; profile(): its profile; player(): {x, y, z, vx, vz, mag, dead, swim, dashT, atkStage, castK};
  // now(): ms; send(cmd): true when the command went out; enabled(): the same gate as ResourceActions; held(): F or the touch
  // action button is down; aboard(): on a raft or ship. Callbacks: onSwing({node, cadence, tier}), onPickup(ack),
  // onPackFull(pile), onRefuse(why, ev).
  constructor({ client, profile, player, now = () => performance.now(), send, enabled = () => true, held = () => false,
    aboard = () => false, opId = defaultOpId, onSwing, onPickup, onPackFull, onRefuse }) {
    Object.assign(this, { client, profile, player, now, send, enabled, held, aboard, opId, onSwing, onPickup, onPackFull, onRefuse });
    this.reset();
  }
  reset() {
    this.tap = false;         // a press shorter than a frame still starts one swing
    this.target = null;       // node id kept until it falls or leaves range
    this.swing = null;        // { start (ms), cadence (ticks), green (ticks), node, tier, crit: null | 'hit' | 'miss' }
    this.retryAt = 0; this.retried = false; this.blocked = false;
    this.piles = new Map();   // pile id -> { rev, at, opId, answered }
    this.fullToast = new Set(); this.fallen = new Map();
  }
  get on() { const c = this.client(); return c?.resources?.chop === 1 && !!c.joined; }

  moving(p) {
    return p.mag > EPS || Math.hypot(p.vx || 0, p.vz || 0) > EPS || p.dashT >= 0 || p.atkStage > 0 || p.castK > 0;
  }
  // Nearest standing palm in reach, kept while it stays valid.
  pick(p) {
    const rows = this.client().resources?.nodes || [];
    const ok = (n) => {
      if (n.kind !== 'palm' || n.ready === false || n.hp <= 0 || Math.abs(p.y - n.y) > CHOP.dy) return false;
      return this.fallen.get(n.id) !== n.rev && Math.hypot(p.x - n.x, p.z - n.z) <= HARVEST.radius;
    };
    const cur = this.target && rows.find((n) => n.id === this.target);
    if (cur && ok(cur)) return cur;
    let best = null, bd = Infinity;
    for (const n of rows) {
      if (!ok(n)) continue;
      const d = Math.hypot(p.x - n.x, p.z - n.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  // Once per frame.
  update() {
    if (!this.on) { if (this.swing || this.target || this.piles.size) this.reset(); return; }
    const p = this.player(), t = this.now();
    const live = !!p && !p.dead && !p.swim && !this.aboard() && this.enabled();
    // A moving or dead player is cancelled on the server, and a finished swing frees the next one.
    if (this.swing && (!live || this.moving(p) || ticksSince(this.swing.start, t) >= this.swing.cadence)) this.swing = null;
    if (live) this.pickups(p, t); else this.piles.clear();
    const held = this.held() || this.tap;
    this.tap = false;
    if (!live || !held) { this.target = null; this.retryAt = 0; this.retried = false; this.blocked = false; return; }
    const node = this.pick(p);
    this.target = node?.id ?? null;
    if (!node || this.blocked || this.swing || this.moving(p) || t < this.retryAt) return;
    const profile = this.profile(), tier = axeTier(profile);
    if (tier < 1) return; // the prompt already says an axe is needed
    const cadence = chopCadence(profile, tier);
    // Exactly these keys: the server refuses any other shape.
    const sent = this.send({ t: 'cmd', type: 'resource', op: 'chop', node: node.id });
    if (!sent) { this.retryAt = t + 250; return; }
    this.swing = { start: t, cadence, green: chopGreen(profile, cadence), node: node.id, tier, crit: null };
  }

  press() { this.tap = true; }

  // G or the touch crit button. True when the press was spent on the swing (so it must not reach the skill slot).
  crit() {
    const s = this.swing;
    if (!s || !this.on) return false;
    if (s.crit) return true; // one attempt per swing; more presses are swallowed too
    const inside = ticksSince(s.start, this.now()) >= s.cadence - s.green;
    s.crit = inside ? 'hit' : 'miss';
    this.send({ t: 'cmd', type: 'resource', op: 'crit' });
    return true;
  }

  // View state for the bar and the touch crit button; null while no swing runs.
  bar() {
    const s = this.swing;
    if (!s) return null;
    const elapsed = ticksSince(s.start, this.now());
    return { progress: Math.min(1, Math.max(0, elapsed / s.cadence)), green: s.green / s.cadence, inGreen: elapsed >= s.cadence - s.green,
      crit: s.crit, tier: s.tier };
  }

  pickups(p, t) {
    const piles = this.client().resources?.piles || [], near = new Set();
    for (const pile of piles) {
      if (Math.hypot(p.x - pile.x, p.z - pile.z) > CHOP.pileRadius) continue;
      near.add(pile.id);
      const q = this.piles.get(pile.id);
      if (q && q.rev === pile.rev && (q.answered || t - q.at < PICKUP_RETRY_MS)) continue;
      const opId = this.opId();
      this.piles.set(pile.id, { rev: pile.rev, at: t, opId, answered: false });
      this.send({ t: 'cmd', type: 'resource', op: 'pickup', pile: pile.id, expectedRev: pile.rev, opId });
    }
    for (const id of this.piles.keys()) if (!near.has(id)) this.piles.delete(id); // walking away re-arms the pile
  }

  // The private 'resource' acks for chop and pickup. Returns true when the event was handled here.
  onResult(ev) {
    if (ev?.op === 'chop') return this.onChopAck(ev);
    if (ev?.op === 'crit') return true;
    if (ev?.op !== 'pickup') return false;
    for (const [id, q] of this.piles) {
      if (q.opId !== ev.opId) continue;
      q.answered = true;
      if (ev.ok) this.onPickup?.(ev);
      else if (ev.why === 'full' && !this.fullToast.has(`${id}:${q.rev}`)) {
        this.fullToast.add(`${id}:${q.rev}`);
        while (this.fullToast.size > FALLEN_KEEP) this.fullToast.delete(this.fullToast.values().next().value);
        this.onPackFull?.(id);
      }
    }
    return true;
  }
  onChopAck(ev) {
    const s = this.swing;
    if (ev.ok) {
      this.retried = false;
      if (s && Number.isFinite(ev.cadence) && ev.cadence > 0 && ev.cadence !== s.cadence) { s.cadence = ev.cadence; s.green = chopGreen(this.profile(), ev.cadence); }
      this.onSwing?.({ node: ev.node, cadence: s?.cadence ?? ev.cadence, tier: s?.tier ?? axeTier(this.profile()) });
      return true;
    }
    this.swing = null;
    if (ev.why === 'cooldown' || ev.why === 'busy') {
      // A cooldown is clock drift or network jitter (the send arrived early): retry after the server's wait for as long as
      // the hold lasts, one send per refusal. A busy player retries once.
      if (ev.why === 'busy' && this.retried) this.blocked = true;
      else { if (ev.why === 'busy') this.retried = true; this.retryAt = this.now() + Math.max(RETRY_MIN_MS, (Number.isFinite(ev.wait) ? ev.wait : 0) * 1000); }
      return true;
    }
    this.blocked = true; this.target = null;
    this.onRefuse?.(ev.why, ev);
    return true;
  }

  // Public chop events (chopHit / chopFell), already filtered by the caller to what concerns this player or the node.
  onHit(ev) {
    const me = this.client().youServer;
    if (ev?.cancelled && ev.e === me && this.swing?.node === ev.node) this.swing = null;
  }
  onFell(ev) {
    const node = this.client().resources?.nodes?.find((n) => n.id === ev?.node);
    if (node) {
      this.fallen.set(node.id, node.rev); // skipped until the snapshot shows the new revision
      while (this.fallen.size > FALLEN_KEEP) this.fallen.delete(this.fallen.keys().next().value);
    }
    if (this.target === ev?.node) this.target = null;
    if (this.swing?.node === ev?.node) this.swing = null;
  }
}

// "+N tronco" and the loot goods, translated.
export function pickupMessage(goods) {
  return Object.entries(goods || {}).filter(([, n]) => Number.isSafeInteger(n) && n > 0).map(([good, count]) => good === 'tronco'
    ? rich('systems.resource.gain.logs', { count })
    : rich('systems.chop.gain', { count, good: dataParam(GOODS[good]?.name ?? good, 'lower') })).join(' · ');
}

// The per-swing bar: fills over the local swing, the green zone at its end, a mark for the crit attempt.
export class ChopBar {
  // parent: the HUD layer the bar is positioned in (main.js passes #ui); defaults to the body.
  constructor({ doc = globalThis.document, parent = doc?.body } = {}) {
    if (!doc?.createElement || !parent) throw new TypeError('Chop bar needs a document body');
    const root = doc.createElement('div');
    root.className = 'chop-bar'; root.hidden = true; root.setAttribute('role', 'progressbar');
    root.setAttribute('aria-valuemin', '0'); root.setAttribute('aria-valuemax', '100'); setAttributeText(root, 'aria-label', 'systems.chop.bar');
    root.innerHTML = '<i class="chop-bar__green"></i><b class="chop-bar__fill"></b>';
    parent.append(root);
    this.root = root; this.green = root.firstChild; this.fill = root.lastChild; this.shown = false;
  }
  render(state) {
    const root = this.root;
    if (!state) { if (this.shown) { root.hidden = true; this.shown = false; } return; }
    if (!this.shown) { root.hidden = false; this.shown = true; }
    this.green.style.width = `${(state.green * 100).toFixed(1)}%`;
    this.fill.style.width = `${(state.progress * 100).toFixed(1)}%`;
    root.dataset.crit = state.crit || '';
    root.dataset.window = state.inGreen ? 'green' : 'approach';
    root.setAttribute('aria-valuenow', String(Math.round(state.progress * 100)));
  }
}
