// A server-owned receive boundary, not a wire epoch. Commands already received keep their
// movement and sequence, but cannot start an attack with the newly swallowed pearl.
import { BTN } from '../sim/systems/movement.js';

export const PEARL_ACTION_BITS = BTN.ATTACK | BTN.Q | BTN.E | BTN.R | BTN.G;
export const PEARL_ACTION_BUFFERS = Object.freeze(['atkBuf', 'rBuf', 'qBuf', 'eBuf', 'gBuf']);
const fields = ['seq', 'mx', 'mz', 'ax', 'az', 'btn', 'prs', 'pt', 'w'];
const same = (a, b) => a && b && Object.keys(a).length === fields.length &&
  fields.every((key) => Object.is(a[key], b[key]));
const checked = (cmd) => {
  if (!cmd || Object.keys(cmd).length !== fields.length || fields.some((key) => !Number.isFinite(cmd[key])) ||
      !Number.isInteger(cmd.btn) || !Number.isInteger(cmd.prs) ||
      cmd.btn < 0 || cmd.btn > 0x3ff || cmd.prs < 0 || cmd.prs > 0x3ff) throw new TypeError('pearl input command');
  return { ...cmd };
};
const filtered = (cmd) => ({ ...cmd, btn: cmd.btn & ~PEARL_ACTION_BITS, prs: cmd.prs & ~PEARL_ACTION_BITS });

// Preparation is read-only. The caller supplies a private assertion that permits apply only
// inside LocalServer.beforeTick. Rollback restores only this effect's own transport writes.
export function preparePearlInputs(server, id, entity, assertBoundary) {
  assertBoundary();
  const clients = server.clients, world = server.world, ecs = world.ecs;
  const c = clients.get(id), profile = world.profiles.get(entity);
  const identity = () => {
    assertBoundary();
    if (server.clients !== clients || server.world !== world || world.ecs !== ecs || clients.get(id) !== c ||
        !c || c.entity !== entity || !Number.isInteger(entity) || entity < 1 || entity >= ecs.cap ||
        !ecs.alive[entity] || ecs.dead[entity] > 0 || ecs.clientId[entity] !== id ||
        !profile || world.profiles.get(entity) !== profile) throw new TypeError('pearl input identity');
  };
  identity();
  const queue = c.queue;
  if (!Array.isArray(queue) || queue.length > 30 || !Number.isInteger(c.carry) || c.carry < 0 || c.carry > 0x3ff) {
    throw new TypeError('pearl input queue');
  }
  const before = queue.map((cmd) => ({ ref: cmd, data: checked(cmd) }));
  const after = before.map(({ data }) => filtered(data));
  const carry = c.carry, last = c.last, lastData = last === null ? null : checked(last);
  const nextLast = lastData === null ? null : filtered(lastData);
  const counters = Object.fromEntries(['ack', 'lastPt', 'fillPt', 'starve'].map((key) => [key, c[key]]));
  let applied = false;
  const unchanged = () => {
    identity();
    if (c.queue !== queue || Object.keys(counters).some((key) => !Object.is(c[key], counters[key]))) {
      throw new TypeError('pearl input lifecycle');
    }
  };
  const assertCurrent = () => {
    unchanged();
    if (queue.length !== before.length || before.some(({ ref, data }, i) => queue[i] !== ref || !same(ref, data)) ||
        c.carry !== carry || c.last !== last || (last !== null && !same(last, lastData))) {
      throw new TypeError('pearl input changed');
    }
  };
  return Object.freeze({
    assertCurrent,
    apply() {
      if (applied) throw new TypeError('pearl input replay');
      assertCurrent(); applied = true;
      queue.splice(0, queue.length, ...after);
      c.carry = carry & ~PEARL_ACTION_BITS; c.last = nextLast;
    },
    assertApplied() {
      unchanged();
      if (!applied || queue.length !== after.length || after.some((cmd, i) => queue[i] !== cmd || !same(cmd, filtered(before[i].data))) ||
          c.carry !== (carry & ~PEARL_ACTION_BITS) || c.last !== nextLast ||
          (nextLast !== null && !same(nextLast, filtered(lastData)))) throw new TypeError('pearl input apply');
    },
    rollback() {
      if (!applied) return;
      if (c.queue === queue && queue.length === after.length && after.every((cmd, i) => queue[i] === cmd && same(cmd, filtered(before[i].data)))) {
        queue.splice(0, queue.length, ...before.map(({ ref }) => ref));
      }
      if (c.carry === (carry & ~PEARL_ACTION_BITS)) c.carry = carry;
      if (c.last === nextLast) c.last = last;
      applied = false;
    },
  });
}
