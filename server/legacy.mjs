// A signed legacy pirate identity is the receipt key across all versions of its blob.
// Old id-less saves cannot establish a one-time identity and are not imported.
import { createHash } from 'node:crypto';
import { StoreError } from './store.mjs';

export function legacyKey(profile) {
  if (!profile?.pirateId || profile.pirateId.startsWith('account:')) throw new StoreError('legacy');
  return createHash('sha256').update('marea-legacy-v1:' + profile.pirateId, 'utf8').digest('hex');
}
