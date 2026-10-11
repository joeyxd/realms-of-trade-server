// Settle completed-tick progress inside the common owner's existing reservation.
import { StoreError } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';

export async function settleGroundProfile(sessions, endpoint, before, reservation, assertCurrent) {
  assertCurrent();
  const s = endpoint.session;
  sessions.save(endpoint.clientId, before, reservation);
  while (s.running || s.pending) {
    if (!s.running) sessions.kick(s);
    if (s.running) await s.running;
    assertCurrent();
    if (s.pending && !s.running) throw new StoreError('busy');
  }
  if (s.closed || s.failed || s.pearlBusy || s.version < 1 || s.version >= 2147483647 ||
      canonicalText(s.confirmed) !== canonicalText(before)) throw new StoreError('conflict');
}
