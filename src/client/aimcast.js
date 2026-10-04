// The aim controller (M4.7 P4, PLAN-M4.7.md §2.4): turns the slot keys (Q / E / R from keyboard, pad or touch) into
// command bits and an aiming preview, by how the skill in the slot is cast (data/tattoos.js castKind):
//   dir / self  the press goes out on key down (as always)
//   ground      mode 'indicator' (default): key down shows the area marker, key up sends the press, a cancel (RMB,
//               ESC, pad B) drops it and nothing is sent; mode 'quick': the press on key down, at the cursor
//   charge      key down sends the press and the slot's held bit while the key stays down; key up lets it go (the
//               sim throws); the preview shows the charge arrow meanwhile
// One preview at a time: another slot going down replaces it (the first sends nothing). A preview whose key stopped
// being held without an up edge (a lost focus) is dropped. Pure logic: no DOM, no three.
import { BTN } from '../sim/systems/movement.js';

export const AIM_SLOTS = ['q', 'e', 'r'];
export const SLOT_BIT = { q: BTN.Q, e: BTN.E, r: BTN.R };

export class AimCast {
  constructor() {
    this.preview = null; // {slot, kind} while aiming an area or charging
  }

  reset() { this.preview = null; }

  // f: {down, up, held: {q, e, r} booleans, cancel, kinds: {q, e, r}, mode}. Returns {prs, held, preview, fire}:
  // prs / held = command bits to OR in; fire = the slot whose area press goes out now (aim it at the preview point).
  step(f) {
    const out = { prs: 0, held: 0, preview: null, fire: null };
    const kind = (s) => (f.kinds && f.kinds[s]) || 'dir';
    const quick = f.mode === 'quick';
    for (const s of AIM_SLOTS) {
      if (!f.down || !f.down[s]) continue;
      const k = kind(s);
      if (this.preview && this.preview.slot !== s) this.preview = null; // replaced: the first sends nothing
      if (k === 'ground' && !quick) this.preview = { slot: s, kind: 'ground' };
      else {
        out.prs |= SLOT_BIT[s];
        if (k === 'ground') out.fire = s;
        else if (k === 'charge') this.preview = { slot: s, kind: 'charge' };
      }
    }
    const p = this.preview;
    if (p && p.kind === 'ground') {
      if (f.cancel) this.preview = null;
      else if (f.up && f.up[p.slot]) { out.prs |= SLOT_BIT[p.slot]; out.fire = p.slot; this.preview = null; }
      else if (!(f.held && f.held[p.slot])) this.preview = null; // the key went away unseen
    } else if (p && p.kind === 'charge') {
      if (f.held && f.held[p.slot] && !(f.up && f.up[p.slot])) out.held |= SLOT_BIT[p.slot];
      else this.preview = null;
    }
    out.preview = this.preview;
    return out;
  }
}
