// Saved games (M4 P3, PLAN-M4.md §2.4). The server turns a profile into a blob the player keeps (localStorage)
// and sends back in its next hello. Solo (Web Worker, in process) trusts it: it is your own game. The Node
// server signs it (server/saves.mjs, HMAC) so a blob from the browser cannot be edited, and needs no database:
// saves survive restarts and deploys as long as SAVE_SECRET stays the same.
import { sanitizeProfile } from '../sim/systems/inventory.js';

export const MAX_SAVE = 32 * 1024; // characters of a blob in a hello
// When the server sends a fresh blob: `after` s after a change, at once after something that matters (an item,
// a level, a mastery, a quest), and every `every` s anyway if anything differs (XP, potions, checkpoint).
export const SAVE_TIMING = { after: 3, every: 10 };
// Private events after which the player's save goes out at once.
export const SAVE_NOW = new Set(['pickup', 'mastery', 'chest', 'gear', 'sold', 'quest', 'bought', 'spill', 'learned', 'tattooRank']);

// load(blob) → profile | null (not ours / tampered); store(profile) → blob.
export const trustSaves = {
  kind: 'trust',
  load(blob) {
    if (typeof blob !== 'string' || !blob || blob.length > MAX_SAVE) return null;
    try { return sanitizeProfile(JSON.parse(blob)); } catch { return null; }
  },
  store(p) { return JSON.stringify(p); },
};
