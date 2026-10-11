import test from 'node:test';
import assert from 'node:assert/strict';
import { runnerMindSnapshot } from '../tools/agent/mind-snapshot.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { ITEMS, SLOTS, CONSUMABLES } from '../src/data/items.js';
import { GOODS } from '../src/data/goods.js';
import { TOWNS } from '../src/data/towns.js';
import { goodVolume, PACK_CAP } from '../src/sim/economy/cargo.js';
import { rollItem } from '../src/sim/items.js';
import { buildRunnerContext } from '../tools/agent/runner-context.mjs';

const copy = (v) => structuredClone(v);
const scope = { ownerId: 'owner-1', characterId: 'agent-1', worldId: 'world-1', sessionId: 'session-1' };
const grant = (capabilities = ['move', 'inventory_read', 'market_read']) => fixtureGrant({ scope,
  controlRevision: 5, expiresAtMs: 100000, capabilities });
const observation = (g = grant(), overrides = {}) => fixtureObservation({ scope: g.scope,
  controlRevision: g.controlRevision, revision: 2, tick: 10, receivedAtMs: 100, source: 'server', ...overrides });
const authority = (g) => ({ state: 'active', taskRevision: 0, grant: copy(g), task: null });

function maxCatalogInventory() {
  const item = (uid, base) => rollItem(() => 0.5, { uid, base, rarity: 0, lvl: 1 });
  const equipment = Object.fromEntries(SLOTS.map((slot, index) => [slot,
    item(1000 + index, ({ weapon: 'sable', head: 'panuelo', chest: 'chaleco', boots: 'botas', ring1: 'anillo', ring2: 'diente' })[slot])]));
  const goods = [];
  let used = 0;
  for (const id of Object.keys(GOODS).sort()) {
    const volume = goodVolume(id);
    if (used + volume <= PACK_CAP) { goods.push({ id, quantity: 1 }); used += volume; }
  }
  return { v: 1, gold: 1_000_000_000,
    bag: { capacity: ITEMS.bag, items: Array.from({ length: ITEMS.bag }, (_, i) => item(i + 1, 'sable')) },
    equipment, potions: { count: CONSUMABLES.potion.max, capacity: CONSUMABLES.potion.max },
    pack: { capacity: PACK_CAP, used, goods } };
}

function maxCatalogMarket() {
  const town = Object.keys(TOWNS).find((id) => TOWNS[id].walkable);
  return { v: 1, op: 'list', town, rows: Object.keys(GOODS).sort().map((g) => ({ g,
    stock: 1_000_000_000, buy: 1_000_000_000, sell: 1_000_000_000, trend: 1,
    illegal: !!GOODS[g].illegal })) };
}

function files() { return { files: {
  personality: { content: 'calm', sha256: 'a'.repeat(64) },
  objectives: { revision: 1, goals: [], sha256: 'b'.repeat(64) },
  memory: { records: [], sha256: 'c'.repeat(64) },
} }; }

function runner(overrides = {}) {
  const g = grant();
  return {
    state: 'ready', grant: g, authority: authority(g), observation: observation(g), nowMs: 100,
    maxObservationAgeMs: 1500, actions: [], priorUncertainty: [],
    chat: { self: 'agent-1', available: true, config: {}, peers: [], historyBeforeSession: 0,
      requests: [], messages: [] },
    inventory: { available: true, fresh: true, scope: copy(g.scope), controlRevision: g.controlRevision,
      source: 'server_private', tick: 10, receivedAtMs: 100, maxAgeMs: 1500, validUntilMs: 1600,
      inventory: maxCatalogInventory(), durability: 'session_only',
      requests: [{ requestId: 'private-ledger-secret', payload: { token: 'do-not-export' } }] },
    market: { available: true, fresh: true, scope: copy(g.scope), controlRevision: g.controlRevision,
      tick: 10, receivedAtMs: 100, maxAgeMs: 1500, validUntilMs: 1600, market: maxCatalogMarket(),
      durability: 'session_only', requests: [{ requestId: 'market-ledger-secret', token: 'do-not-export' }] },
    ...overrides,
  };
}

const snapshot = (value, nowMs = value.nowMs) => runnerMindSnapshot(value, files(), nowMs);

test('fresh private inventory and market are detached, bounded read-only projections', () => {
  const r = runner(), result = snapshot(r), economy = result.required.tools.economy;
  assert.ok(economy);
  assert.equal(economy.spendingEnabled, false);
  assert.equal(economy.inventory.method, 'readInventory');
  assert.equal(economy.inventory.readOnly, true);
  assert.equal(economy.inventory.source, 'server_private');
  assert.equal(economy.market.method, 'readMarket');
  assert.equal(economy.market.readOnly, true);
  assert.equal(economy.market.market.rows.length, Object.keys(GOODS).length);
  assert.equal(economy.inventory.inventory.bag.items.length, ITEMS.bag);
  assert.equal(economy.inventory.inventory.pack.goods.length, maxCatalogInventory().pack.goods.length);
  const text = JSON.stringify(result.required);
  assert.equal(text.includes('private-ledger-secret'), false);
  assert.equal(text.includes('market-ledger-secret'), false);
  assert.equal(text.includes('do-not-export'), false);
  assert.equal(text.includes('authToken'), false);
  assert.ok(Buffer.byteLength(text, 'utf8') < 12000,
    'maximum catalog inventory and market rows fit the default 12,000-byte required-context budget');
  r.inventory.inventory.gold = 0;
  assert.equal(result.required.tools.economy.inventory.inventory.gold, 1_000_000_000,
    'provider data is detached from runner state');
});

test('authorized read methods are advertised before their first result, without forwarding a historical view', () => {
  const r = runner();
  r.inventory = { ...r.inventory, fresh: false, source: null, tick: null, receivedAtMs: null,
    validUntilMs: null, inventory: null };
  r.market = { ...r.market, fresh: false, tick: null, receivedAtMs: null,
    validUntilMs: null, market: null };
  const required = snapshot(r).required;
  assert.deepEqual(required.tools.reads, { inventory: { method: 'readInventory', capability: 'inventory_read', readOnly: true },
    market: { method: 'readMarket', capability: 'market_read', readOnly: true,
      operations: ['list', 'quote'], maxQuantity: 500, quote: 'advisory_only' }, spendingEnabled: false });
  assert.equal(required.tools.economy, undefined, 'a method description is not a current inventory or quote');
  assert.ok(required.tools.capabilities.includes('inventory_read'));
  assert.ok(required.tools.capabilities.includes('market_read'));
});

test('a least-privilege requested subset of the server grant retains its private reads', () => {
  const r = runner();
  r.authority.grant.capabilities.push('aim', 'chat');
  const result = snapshot(r);
  assert.ok(result.required.tools.reads.inventory);
  assert.ok(result.required.tools.reads.market);
  assert.ok(result.required.tools.economy.inventory);
  r.authority.grant.capabilities = r.authority.grant.capabilities.filter(cap => cap !== 'market_read');
  assert.equal(snapshot(r).required.tools.reads, undefined, 'a grant absent from server authority is not usable');
});

test('historical, stale, expired, unauthorized, dead, stopped, or mismatched economic views are omitted', () => {
  const fresh = runner();
  assert.ok(snapshot(fresh).required.tools.economy);

  const stale = runner({ nowMs: 1601, observation: observation(grant(), { receivedAtMs: 100 }) });
  assert.equal(snapshot(stale, 1601).required.tools.economy, undefined);
  assert.equal(snapshot(stale, 1601).required.tools.reads, undefined);
  assert.equal(snapshot(stale, 1601).required.tools.capabilities.includes('inventory_read'), false);
  assert.equal(snapshot(stale, 1601).required.tools.capabilities.includes('market_read'), false);
  const staleViews = runner({ inventory: { ...runner().inventory, fresh: false, inventory: null },
    market: { ...runner().market, fresh: false, market: null } });
  assert.equal(snapshot(staleViews).required.tools.economy, undefined);

  const noCapabilityGrant = grant(['move']);
  const noCapability = runner({ grant: noCapabilityGrant, authority: authority(noCapabilityGrant),
    observation: observation(noCapabilityGrant) });
  assert.equal(snapshot(noCapability).required.tools.economy, undefined);
  const staleAuthority = runner({ authority: authority(grant(['move', 'inventory_read'])) });
  assert.equal(snapshot(staleAuthority).required.tools.economy, undefined,
    'a server controller grant with a different capability set is not the active runner grant');
  const unauthenticated = runner({ inventory: { ...runner().inventory, available: false },
    market: { ...runner().market, available: false } });
  const unavailable = snapshot(unauthenticated).required.tools;
  assert.equal(unavailable.economy, undefined);
  assert.equal(unavailable.reads, undefined);
  assert.equal(unavailable.capabilities.includes('inventory_read'), false);
  assert.equal(unavailable.capabilities.includes('market_read'), false);
  const dead = runner({ observation: observation(grant(), { confirmed: { self: { hp: 0, dead: true } } }) });
  assert.equal(snapshot(dead).required.tools.economy, undefined);
  assert.equal(snapshot(runner({ state: 'stopped' })).required.tools.economy, undefined);

  const changedScope = runner({ inventory: { ...runner().inventory,
    scope: { ...scope, sessionId: 'previous-session' } } });
  assert.equal(snapshot(changedScope).required.tools.economy.market !== undefined, true);
  assert.equal(snapshot(changedScope).required.tools.economy.inventory, undefined);
  const changedEpoch = runner({ market: { ...runner().market, controlRevision: 4 } });
  assert.equal(snapshot(changedEpoch).required.tools.economy.inventory !== undefined, true);
  assert.equal(snapshot(changedEpoch).required.tools.economy.market, undefined);
  const expired = runner({ grant: { ...grant(), expiresAtMs: 100 }, authority: authority(grant()) });
  assert.equal(snapshot(expired, 100).required.tools.economy, undefined);
  assert.equal(snapshot(expired, 100).required.tools.reads, undefined);
  assert.equal(snapshot(expired, 100).required.tools.capabilities.includes('market_read'), false);
  const localAuthority = runner({ authority: { ...authority(grant()), state: 'inactive' } });
  assert.equal(snapshot(localAuthority).required.tools.economy, undefined);
});

test('maximum catalog views fail closed when required context exceeds its byte budget', () => {
  const required = snapshot(runner()).required;
  const size = Buffer.byteLength(JSON.stringify({ v: 1, required, memory: [] }), 'utf8');
  const result = buildRunnerContext({ required, memory: [], queryTags: [],
    scope: { ownerId: scope.ownerId, characterId: scope.characterId, worldId: scope.worldId },
    nowMs: 100, countUnits: () => 1, limits: { maxInputBytes: size - 1 } });
  assert.equal(result.ok, false);
  assert.equal(result.why, 'required_context_over_budget');
  assert.equal(result.report.requiredOverBudget, true);
  assert.ok(required.rules.grant, 'the required authority rules remain intact');
  assert.ok(required.tools.economy.inventory, 'the required view was not silently truncated');
  assert.ok(required.tools.economy.market, 'the required market rows were not silently truncated');
});
