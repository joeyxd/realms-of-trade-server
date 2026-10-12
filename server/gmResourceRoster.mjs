import { checkedResourceState } from './resourceState.mjs';
import { HARVEST } from '../src/data/resources.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const idPattern = /^gm_[0-9a-f]{32}$/;
const fail = () => { throw Object.assign(new TypeError('Invalid GM resource roster'), { code: 'gm_resource_roster' }); };

/** Admit new identities only. Removed resources remain dormant, including their logging ledger. */
export function appendGmResourceRoster(raw, nodes) {
  const next = checkedResourceState(raw);
  if (!Array.isArray(nodes) || nodes.length > HARVEST.maxAuthoredNodes) fail();
  const existing = new Map(next.nodes.map(n => [n.id, n])), seen = new Set();
  for (const node of nodes) {
    if (!node || !idPattern.test(node.id) || !['palm', 'stone'].includes(node.kind) || seen.has(node.id)) fail();
    seen.add(node.id);
    if (existing.has(node.id)) {
      if (existing.get(node.id).kind !== node.kind) fail();
      continue;
    }
    if (next.nodes.length >= HARVEST.maxSavedNodes) fail();
    const row = { id: node.id, kind: node.kind, rev: 1, hits: 0, readyAt: 0 };
    next.nodes.push(row); existing.set(row.id, row);
    if (node.kind === 'palm' && next.v >= 2) next.logging[node.id] = {
      cycle: 1, contributors: [], ...(next.v === 3 ? { quality: 0 } : {}),
    };
  }
  return checkedResourceState(next);
}

/** Same contract as SQL036; ordinary world saves never call this exception. */
export function validGmResourceAppend(before, after) {
  try {
    const old = checkedResourceState(before), next = checkedResourceState(after);
    if (old.v !== next.v || old.tick !== next.tick || !same(old.cooldowns, next.cooldowns) ||
        next.nodes.length < old.nodes.length || !same(old.nodes, next.nodes.slice(0, old.nodes.length))) return false;
    const added = next.nodes.slice(old.nodes.length);
    if (added.length > HARVEST.maxAuthoredNodes) return false;
    const expected = appendGmResourceRoster(old, added);
    return same(expected, next);
  } catch { return false; }
}
