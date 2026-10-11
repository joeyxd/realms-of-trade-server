import test from 'node:test';
import assert from 'node:assert/strict';
import { GameClient } from '../src/client/gameClient.js';
import { ENT, MSG } from '../src/net/protocol.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { KIND } from '../src/sim/ecs.js';

function snapshot(tick, id, lit) {
  const entity = Array(ENT.LANTERN + 1).fill(0);
  entity[ENT.ID] = id;
  entity[ENT.KIND] = KIND.PLAYER;
  entity[ENT.HP] = 100;
  entity[ENT.MAXHP] = 100;
  entity[ENT.LANTERN] = Number(lit);
  return { t: MSG.SNAPSHOT, tick, ents: [entity] };
}

test('GameClient accepts same-tick lantern corrections and ignores older snapshot light state', () => {
  const transport = { onMessage() {}, onSnapshot() {}, start() {} };
  const client = new GameClient(transport, generateWorld(82), { emit() {} });
  const id = 17;
  client.youServer = id;
  const record = { id, human: true, lantern: false, buf: [], r: {}, ready: false };
  client.entities.set(id, record);

  client.onSnapshot(snapshot(10, id, true));
  assert.equal(record.lantern, true);
  assert.equal(client.personalLantern, true);
  client.onSnapshot(snapshot(10, id, false));
  assert.equal(record.lantern, false, 'equal tick snapshots still decode the authoritative flag');
  assert.equal(client.personalLantern, false);

  client.onSnapshot(snapshot(12, id, true));
  assert.equal(client.personalLantern, true);
  client.onSnapshot(snapshot(11, id, false));
  assert.equal(record.lantern, true, 'older snapshots cannot roll back a newer light state');
  assert.equal(client.personalLantern, true);
});
