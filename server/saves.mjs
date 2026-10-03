// Signed saves for the Node server (M4 P3): blob = base64url(profile JSON) + '.' + HMAC-SHA256 of that text.
// The secret comes from SAVE_SECRET; without one a random secret is made at start (saves then die with the
// process: fine for a LAN game, not for a deploy — render.yaml generates one).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { MAX_SAVE } from '../src/net/saves.js';

export function hmacSaves(secret) {
  const key = Buffer.from(String(secret || ''), 'utf8');
  if (!key.length) throw new Error('hmacSaves: empty secret');
  const sign = (text) => createHmac('sha256', key).update(text).digest('base64url');
  return {
    kind: 'hmac',
    load(blob) {
      if (typeof blob !== 'string' || blob.length > MAX_SAVE) return null;
      const dot = blob.lastIndexOf('.');
      if (dot <= 0) return null;
      const body = blob.slice(0, dot), sig = Buffer.from(blob.slice(dot + 1)), want = Buffer.from(sign(body));
      if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
      try { return sanitizeProfile(JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))); } catch { return null; }
    },
    store(p) {
      const body = Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
      return body + '.' + sign(body);
    },
  };
}

// SAVE_SECRET, or a fresh random one (and a warning).
export function saveSecret(env = process.env, log = console.log) {
  if (env.SAVE_SECRET) return env.SAVE_SECRET;
  log('[saves] SAVE_SECRET is not set: using a random secret, saved games will not survive a restart');
  return randomBytes(32).toString('hex');
}
