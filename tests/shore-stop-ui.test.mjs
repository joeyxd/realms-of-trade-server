import test from 'node:test';
import assert from 'node:assert/strict';
import { CommercePanel } from '../src/ui/commerce.js';
import { FreshwaterPanel } from '../src/ui/freshwaterPanel.js';
import { shoreBarrelNotice, shoreStopAvailable, shoreStopNotice, shoreVoyageActive } from '../src/ui/shoreStopState.js';

test('shore service is available only during an ordinary active shore phase', () => {
  assert.equal(shoreStopAvailable({ active: true, phase: 'shore', shoreService: true }), true);
  assert.equal(shoreStopAvailable({ active: true, phase: 'shore', shoreService: true, recovery: true }), false);
  assert.equal(shoreStopAvailable({ active: true, phase: 'shore', shoreService: false }), false);
  assert.equal(shoreStopAvailable({ active: true, phase: 'sailing', shoreService: true }), false);
  assert.equal(shoreVoyageActive({ active: true, phase: 'shore' }), true);
  assert.equal(shoreVoyageActive({ active: false, phase: 'shore' }), false);
});

test('shore notices are localized and direct cargo actions stay locked', () => {
  assert.match(shoreStopNotice('es'), /bodega permanece bloqueada/);
  assert.match(shoreStopNotice('en'), /hold stays locked/);
  const panel = Object.create(CommercePanel.prototype);
  panel.voyage = () => ({ active: true, phase: 'shore', shoreService: true });
  assert.equal(panel.toggleCargo(), false);
  assert.equal(panel.confirmTransfer(), false);
  assert.equal(panel.openProduction(), false);
});

test('shore market entry requires the server service flag and an existing walkable town', () => {
  const panel = Object.create(CommercePanel.prototype), requests = [];
  Object.assign(panel, { voyage: () => ({ active: true, phase: 'shore', shoreService: true }), enabled: () => true,
    activate(view) { this.view = view; }, clearResult() {}, request(op, payload) { requests.push({ op, payload }); }, render() {} });
  assert.equal(panel.openMarket('sol'), false, 'Puerto Sol is not fabricated as a physical shore market');
  assert.equal(requests.length, 0);
  panel.openMarket('aldea');
  assert.deepEqual(requests, [{ op: 'list', payload: { town: 'aldea' } }]);
  const unavailable = Object.create(CommercePanel.prototype);
  Object.assign(unavailable, { voyage: () => ({ active: true, phase: 'shore', shoreService: false }), enabled: () => true });
  assert.equal(unavailable.openMarket('aldea'), false, 'shore phase alone does not enable market access');
});

function freshwaterAtShore() {
  const sent = [];
  const client = {
    joined: true, youServer: 8, voyage: { active: true, phase: 'shore', shoreService: true },
    profile: { eco: { tradeRev: 7, pack: { cap: 10, goods: { agua: 2 }, vessels: [
      { id: 'bucket', kind: 'bucket', water: 1 }, { id: 'canteen', kind: 'canteen', water: 1 },
    ] } } },
    freshwaterStatus: { enabled: true, canteenEnabled: true, needs: { sat: 40, hyd: 30 }, source: { id: 'salty-spring', near: true }, barrels: [] },
    send(command) { sent.push(command); },
  };
  const panel = Object.create(FreshwaterPanel.prototype);
  Object.assign(panel, { active: true, pending: null, owner: client, session: 8, client: () => client,
    localeSource: () => 'en', now: () => 0, root: null, statusKey: '', statusReason: '' });
  return { panel, client, sent };
}

test('shore stop blocks every barrel operation while pack water and survival actions remain available', () => {
  const { panel, sent } = freshwaterAtShore();
  assert.equal(panel.transfer('deposit', 'raft-a', 'barrel-1', 1), false);
  assert.equal(panel.transfer('withdraw', 'raft-a', 'barrel-1', 1), false);
  assert.equal(panel.refillCanteen('barrel', 'raft-a', 'barrel-1', 4), false);
  assert.equal(panel.send('deposit', { source: '', n: 1 }), false, 'direct UI command path is also blocked');
  assert.equal(panel.send('withdraw', { source: '', n: 1 }), false);
  assert.equal(panel.refillCanteen('bucket'), true);
  assert.equal(sent.at(-1).op, 'refillCanteen');
  panel.pending = null;
  assert.equal(panel.refillCanteen('provisions'), true);
  assert.equal(sent.at(-1).source, 'provisions');
  panel.pending = null;
  assert.equal(panel.drink(), true);
  assert.equal(sent.at(-1).op, 'drink');
  panel.pending = null;
  assert.equal(panel.eat('agua'), true);
  assert.equal(sent.at(-1).op, 'eat');
  assert.match(shoreBarrelNotice('en'), /Barrel transfers are unavailable/);
  assert.match(shoreBarrelNotice('es'), /No puedes transferir agua al barril/);
});
