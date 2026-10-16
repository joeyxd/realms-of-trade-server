// Reversible transport neutralization paired with a whole-death apply. Preserve sequence, time
// and ACK; received movement/actions must not resume after death. ECS follows the real death plan.

const fields = ['seq', 'mx', 'mz', 'ax', 'az', 'btn', 'prs', 'pt', 'w'];
const same = (a, b) => a && b && Object.keys(a).length === fields.length &&
  fields.every((key) => Object.is(a[key], b[key]));
const checked = (cmd) => {
  if (!cmd || Object.keys(cmd).length !== fields.length || fields.some((key) => !Number.isFinite(cmd[key])) ||
      !Number.isInteger(cmd.btn) || !Number.isInteger(cmd.prs) ||
      cmd.btn < 0 || cmd.btn > 0x3ff || cmd.prs < 0 || cmd.prs > 0x3ff) throw new TypeError('death input command');
  return { ...cmd };
};
const filtered = (cmd) => ({ ...cmd, mx: 0, mz: 0, btn: 0, prs: 0, w: 0 });

// Preparation is read-only. The caller supplies a private assertion that permits apply only
// inside LocalServer.beforeTick. Rollback restores only this effect's own transport writes.
export function prepareDeathInputs(server, id, entity, assertBoundary) {
  assertBoundary();
  const clients = server.clients, world = server.world, ecs = world.ecs;
  const c = clients.get(id), profile = world.profiles.get(entity);
  const identity = (dead = 0) => {
    assertBoundary();
    if (server.clients !== clients || server.world !== world || world.ecs !== ecs || clients.get(id) !== c ||
        !c || c.entity !== entity || !Number.isInteger(entity) || entity < 1 || entity >= ecs.cap ||
        !ecs.alive[entity] || ecs.dead[entity] !== dead || ecs.clientId[entity] !== id ||
        !profile || world.profiles.get(entity) !== profile) throw new TypeError('death input identity');
  };
  identity();
  const queue = c.queue;
  if (!Array.isArray(queue) || Object.getPrototypeOf(queue) !== Array.prototype || Object.hasOwn(queue, 'splice') || queue.length > 30 || !Number.isInteger(c.carry) || c.carry < 0 || c.carry > 0x3ff) {
    throw new TypeError('death input queue');
  }
  const before = queue.map((cmd) => ({ ref: cmd, data: checked(cmd) }));
  const after = before.map(({ data }) => filtered(data));
  const carry = c.carry, last = c.last, lastData = last === null ? null : checked(last);
  const nextLast = lastData === null ? null : filtered(lastData);
  const counters = Object.fromEntries(['ack', 'lastPt', 'fillPt', 'starve'].map((key) => [key, c[key]]));
  let applied = false;
  const unchanged = (dead = 0) => {
    identity(dead);
    if (c.queue !== queue || Object.keys(counters).some((key) => !Object.is(c[key], counters[key]))) {
      throw new TypeError('death input lifecycle');
    }
  };
  const assertCurrent = () => {
    unchanged();
    if (queue.length !== before.length || before.some(({ ref, data }, i) => queue[i] !== ref || !same(ref, data)) ||
        c.carry !== carry || c.last !== last || (last !== null && !same(last, lastData))) {
      throw new TypeError('death input changed');
    }
  };
  return Object.freeze({
    assertCurrent,
    apply() {
      if (applied) throw new TypeError('death input replay');
      unchanged(1);
      if (queue.length !== before.length || before.some(({ ref, data }, i) => queue[i] !== ref || !same(ref, data)) ||
          c.carry !== carry || c.last !== last || (last !== null && !same(last, lastData))) throw new TypeError('death input changed');
      applied = true;
      Array.prototype.splice.call(queue, 0, queue.length, ...after);
      c.carry = 0; c.last = nextLast;
    },
    assertApplied() {
      unchanged(1);
      if (!applied || queue.length !== after.length || after.some((cmd, i) => queue[i] !== cmd || !same(cmd, filtered(before[i].data))) ||
          c.carry !== 0 || c.last !== nextLast ||
          (nextLast !== null && !same(nextLast, filtered(lastData)))) throw new TypeError('death input apply');
    },
    rollback() {
      if (!applied) return;
      if (c.queue === queue && queue.length === after.length && after.every((cmd, i) => queue[i] === cmd && same(cmd, filtered(before[i].data)))) {
        Array.prototype.splice.call(queue, 0, queue.length, ...before.map(({ ref }) => ref));
      }
      if (c.carry === 0) c.carry = carry;
      if (c.last === nextLast) c.last = last;
      applied = false;
    },
  });
}
