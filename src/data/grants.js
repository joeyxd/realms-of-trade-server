// Equipment loans (SK05a, PLAN-SKILLS.md 2.5): an item base may carry `grants: [{ skill, rank }]` (data/items.js BASES).
// While the item is equipped its wearer may use the lent skill; nothing lent ever gives practice, points, XP or mastery.
// Both sides derive the loan from the profile's own equipped items and the BASES catalog: it is server data, never
// client metadata, and there is nothing on the wire. Pure and shared by the sim, the server and the UI.
import { BASES, SLOTS } from './items.js';
import { ARTS, DEFAULT_LOADOUT, isArt } from './tattoos.js';
import { WEAPON_KINDS } from './weapons.js';

// What the worn items lend: { nodeId: { rank, by: [base ids] } }. Several items lending one node take the highest
// rank (never the sum). `eq` is a profile's `eq` ({ slot: item | null }); anything else lends nothing.
export function grantedSkills(eq) {
  const out = {};
  if (!eq || typeof eq !== 'object') return out;
  for (const slot of SLOTS) {
    const it = eq[slot], list = it && BASES[it.b] ? BASES[it.b].grants : null;
    if (!Array.isArray(list)) continue;
    for (const g of list) {
      const rank = Number.isInteger(g?.rank) ? g.rank : 0;
      if (typeof g?.skill !== 'string' || rank < 1) continue;
      const cur = Object.hasOwn(out, g.skill) ? out[g.skill] : (out[g.skill] = { rank: 0, by: [] });
      cur.rank = Math.max(cur.rank, rank);
      if (!cur.by.includes(it.b)) cur.by.push(it.b);
    }
  }
  return out;
}

// The rank a node counts as while shown or used: the owned rank or the lent one, whichever is higher. `granted` is
// one entry of grantedSkills (or its rank, or nothing). Points, tier gates and Subir always use the OWNED rank.
export const effectiveRank = (owned, granted) => Math.max(owned | 0, (typeof granted === 'number' ? granted : granted?.rank) | 0);

// Is `id` an art lent by `granted` (a grantedSkills result)? Lent actives in v1 are ARTS ids, in the Q / E slots only.
export const isLentArt = (granted, id) => isArt(id) && !!granted && Object.hasOwn(granted, id) && granted[id].rank > 0;

// A loadout slot that holds another weapon's art no longer lent by anything goes back to the weapon's default for that
// slot (or, if that is taken, another art of the weapon). In place on `sk` (a profile's p.sk); true when it changed
// something. The one place every path reaches (unequip, rack swap, lawless spill, profile load) through
// refreshStats -> applyLoadout, so the saved loadout and the ECS columns drop a lent art together.
export function pruneLentLoadouts(sk, granted) {
  if (!sk || !Array.isArray(sk.lo)) return false;
  let changed = false;
  WEAPON_KINDS.forEach((kind, k) => {
    const row = sk.lo[k];
    if (!Array.isArray(row)) return;
    const arts = Object.keys(ARTS).filter((a) => ARTS[a].weapon === kind);
    row.forEach((id, i) => {
      if (!isArt(id) || ARTS[id].weapon === kind || isLentArt(granted, id)) return;
      row[i] = [DEFAULT_LOADOUT[kind][i], ...arts].find((a) => !row.includes(a)) ?? DEFAULT_LOADOUT[kind][i];
      changed = true;
    });
  });
  return changed;
}
