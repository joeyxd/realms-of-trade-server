import test from 'node:test';
import assert from 'node:assert/strict';
import { GameHost } from '../server/host.mjs';
import { CompanionConfigService } from '../server/companionConfig.mjs';
import { CompanionControlService } from '../server/companionControl.mjs';
import { CompanionCreationService } from '../server/companionCreation.mjs';
import { CompanionPairingService } from '../server/companionPairing.mjs';
import { InferenceConfigService } from '../server/inferenceConfig.mjs';
import { companionCreationConfig, DEFAULT_COMPANION_PRESET } from '../src/net/companionCreation.js';
import { MSG } from '../src/net/protocol.js';

const OWNER = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';
const PROFILE = '30000000-0000-4000-8000-000000000001';
const OWN = '40000000-0000-4000-8000-000000000001';
const FOREIGN = '40000000-0000-4000-8000-000000000002';
const WORLD = 'character-owner-scope';
const timestamp = '2026-10-12T00:00:00.000Z';

function setup() {
  const session = { key: PROFILE, ownerKey: OWNER, closed: false, failed: false };
  const sock = { id: 'slot-socket', ws: { readyState: 1 }, agentIdentity: false };
  const replies = [];
  const owned = new Map([[OWNER, [{ characterKey: OWN, stopped: true, active: false, epoch: 1 }]],
    [OTHER, [{ characterKey: FOREIGN, stopped: true, active: false, epoch: 1 }]]]);
  const host = {
    closing: false, agentPilot: false, worldState: { id: WORLD },
    sockets: new Map([[sock.id, sock]]),
    profiles: { clients: new Map([[sock.id, session]]), accounts: new Map([[PROFILE, session]]) },
    server: { clients: new Map([[sock.id, { entity: 1, serverProfile: {} }]]) },
    sendTo: (_id, message) => replies.push(message),
    store: { durable: true },
    agentControl: {
      listOwned: owner => owned.get(owner) ?? [],
      createdBinding: () => true,
      binding: () => null,
      configuredBindings: () => [],
      registerCreated: ({ ownerId, characterId, capabilities }) => ({ ownerId, characterId, capabilities }),
    },
    agentOwnerProjection: owner => owned.get(owner) ?? [],
    publishAgentState() {},
  };
  const companionConfig = new CompanionConfigService(host);
  host.companionConfig = companionConfig;
  return { host, session, sock, replies, owned, companionConfig };
}

test('a profile UUID distinct from its auth owner can configure only account-owned companions', async () => {
  const f = setup(), scopes = [];
  f.host.store.checkCompanionConfig = async () => ({ version: 1 });
  f.host.store.saveCompanionConfig = async input => {
    scopes.push(input);
    return { ok: true, replay: false, head: { revision: 1, config: input.config, savedAt: timestamp } };
  };
  f.companionConfig.ready = true;
  const config = { v: 1, personality: 'prudente', goals: [] };
  const request = (characterKey, requestId) => f.companionConfig.dispatch(f.sock,
    { t: MSG.AGENT_COMPANION_CONFIG, requestId, op: 'save', characterKey, expectedRevision: 0, config });

  await request(OWN, 'own-config');
  assert.equal(f.replies.at(-1).ok, true);
  assert.deepEqual(scopes.map(({ world, owner, character }) => ({ world, owner, character })),
    [{ world: WORLD, owner: OWNER, character: OWN }]);
  await request(FOREIGN, 'foreign-config');
  assert.equal(f.replies.at(-1).why, 'forbidden');
  assert.equal(scopes.length, 1, 'a foreign character never reaches storage');
  assert.equal(f.host.profiles.accounts.get(PROFILE), f.session,
    'session liveness is still anchored to the profile UUID');
});

test('companion creation and pairing persist and register under the auth owner, not the selected profile', async () => {
  const f = setup(), creationScopes = [], pairingScopes = [], registrations = [];
  f.host.store.checkCompanionCreation = async () => ({ version: 1 });
  f.host.store.loadCompanionCreation = async scope => { creationScopes.push(scope); return null; };
  f.host.companionCreation = new CompanionCreationService(f.host, { enabled: true, allowMemory: true });
  f.host.companionCreation.ready = true;
  await f.host.companionCreation.dispatch(f.sock, { t: MSG.AGENT_COMPANION_CREATE,
    requestId: 'creation-load', op: 'load' });
  assert.equal(f.replies.at(-1).ok, true);
  assert.deepEqual(creationScopes, [{ world: WORLD, owner: OWNER }]);

  const control = { revision: 1, stopped: true, savedAt: timestamp };
  const config = { revision: 1, config: companionCreationConfig(DEFAULT_COMPANION_PRESET), savedAt: timestamp };
  const record = { characterKey: OWN, creationId: '50000000-0000-4000-8000-000000000001',
    preset: DEFAULT_COMPANION_PRESET, createdAt: timestamp, configuration: config, control };
  f.host.store.loadCompanionCreation = async scope => { pairingScopes.push(scope); return record; };
  f.host.companionControl = {
    ready: true, managed: true, registerCreated: () => true, allowed: () => false,
  };
  f.host.agentControl.registerCreated = input => { registrations.push(input); return input; };
  const pairing = new CompanionPairingService(f.host, { enabled: true, allowMemory: true });
  pairing.ready = true;
  const loaded = await pairing.loadOwned(f.session, f.sock);
  assert.equal(loaded.record.characterKey, OWN);
  assert.deepEqual(pairingScopes, [{ world: WORLD, owner: OWNER }]);
  assert.equal(registrations[0].ownerId, OWNER);
  assert.notEqual(registrations[0].ownerId, PROFILE);
});

test('companion-control authorization follows the owner while profile session identity stays unchanged', async () => {
  const f = setup();
  const service = new CompanionControlService(f.host);
  service.ready = true;
  service.entries.set(OWN, { binding: { ownerId: OWNER, characterId: OWN }, head: { revision: 1, stopped: true }, status: 'ready' });
  service.entries.set(FOREIGN, { binding: { ownerId: OTHER, characterId: FOREIGN }, head: { revision: 1, stopped: true }, status: 'ready' });
  const command = characterKey => service.dispatch(f.sock, { t: MSG.AGENT_OWNER, requestId: `stop-${characterKey}`,
    op: 'stop', characterKey, epoch: null, expectedRevision: 0 });

  await command(OWN);
  assert.equal(f.replies.at(-1).why, 'stale_control', 'the owned entry passes authorization and reaches epoch validation');
  await command(FOREIGN);
  assert.equal(f.replies.at(-1).why, 'forbidden');
  assert.equal(f.host.profiles.accounts.get(PROFILE), f.session);
});

test('actual host owner routes authorize by ownerKey while retaining profile-key session identity', () => {
  const f = setup(), calls = [];
  f.host.companionControl = { managed: false, projection: () => ({}) };
  f.host.publishAgentState = result => f.replies.push({ t: MSG.AGENT_STATE, ok: result.ok, state: result.state });
  f.host.agentControl.byCharacter = characterId => ({ characterId });
  f.host.agentControl.resume = (ownerId, characterId) => {
    calls.push(['resume', ownerId, characterId]);
    return ownerId === OWNER && characterId === OWN;
  };
  f.host.agentControl.revoke = (ownerId, characterId, reason) => {
    calls.push(['revoke', ownerId, characterId, reason]);
    return ownerId === OWNER && characterId === OWN ? { characterId, stopped: true } : null;
  };
  f.host.agentControl.cancelOwner = (ownerId, characterId, task) => {
    calls.push(['cancel', ownerId, characterId, task]);
    return ownerId === OWNER && characterId === OWN ? { ok: true, state: { characterId } } : { ok: false, why: 'forbidden' };
  };
  f.owned.get(OWNER)[0].stopped = false;

  GameHost.prototype.agentOwnerMessage.call(f.host, f.sock,
    { t: MSG.AGENT_OWNER, requestId: 'host-list', op: 'list' });
  assert.equal(f.replies.at(-1).ok, true);
  assert.equal(f.replies.at(-1).companions[0].characterKey, OWN);
  GameHost.prototype.agentOwnerMessage.call(f.host, f.sock,
    { t: MSG.AGENT_OWNER, requestId: 'host-stop', op: 'stop', characterKey: OWN, epoch: 1 });
  assert.equal(f.replies.at(-1).ok, true);
  GameHost.prototype.agentOwnerMessage.call(f.host, f.sock,
    { t: MSG.AGENT_OWNER, requestId: 'host-foreign-stop', op: 'stop', characterKey: FOREIGN, epoch: 1 });
  assert.equal(f.replies.at(-1).why, 'forbidden');

  GameHost.prototype.agentMessage.call(f.host, f.sock,
    { t: MSG.AGENT_CONTROL, op: 'resume', characterId: OWN });
  assert.equal(f.replies.at(-1).ok, true);
  GameHost.prototype.agentMessage.call(f.host, f.sock,
    { t: MSG.AGENT_CONTROL, op: 'resume', characterId: FOREIGN });
  assert.equal(f.replies.at(-1).ok, false);
  GameHost.prototype.agentMessage.call(f.host, f.sock,
    { t: MSG.AGENT_CONTROL, op: 'cancel', characterId: OWN, task: { requestId: 'task-own' } });
  assert.equal(f.replies.at(-1).ok, true);
  GameHost.prototype.agentMessage.call(f.host, f.sock,
    { t: MSG.AGENT_CONTROL, op: 'cancel', characterId: FOREIGN, task: { requestId: 'task-foreign' } });
  assert.equal(f.replies.at(-1).ok, false);

  assert.deepEqual(calls.map(([op, ownerId, characterId]) => [op, ownerId, characterId]), [
    ['revoke', OWNER, OWN], ['resume', OWNER, OWN], ['resume', OWNER, FOREIGN],
    ['cancel', OWNER, OWN], ['cancel', OWNER, FOREIGN],
  ]);
  assert.equal(f.host.profiles.accounts.get(PROFILE), f.session);
});

test('inference settings and rate slot use the auth owner and reject another owner’s character', async () => {
  const f = setup(), scopes = [];
  const connection = { id: 'personal', label: 'Personal', providerId: 'local', maxCeilingNanoUsd: 1000000000,
    models: ['local/test-model'] };
  const service = new InferenceConfigService(f.host, { allowMemory: true,
    catalog: [{ owner: OWNER, connections: [connection] }, { owner: OTHER, connections: [
      { id: 'personal', label: 'Other', providerId: 'local', maxCeilingNanoUsd: 1000000000, models: ['local/test-model'] }] }] });
  service.ready = true;
  f.host.companionControl = { principal: sock => sock === f.sock ? f.session : null };
  const config = { v: 1, ceilingNanoUsd: 1000000000, connections: [{ id: 'personal', ceilingNanoUsd: 1000000000 }],
    companions: [{ character: OWN, connectionId: 'personal', modelId: 'local/test-model' }] };
  f.host.store.saveInferenceConfig = async input => {
    scopes.push(input);
    return { ok: true, replay: false, head: { revision: 1, config: input.config, savedAt: timestamp } };
  };
  const save = (requestId, value) => service.dispatch(f.sock, { t: MSG.INFERENCE_CONFIG, requestId, op: 'save',
    expectedRevision: 0, config: value });

  await save('inference-own', config);
  assert.equal(f.replies.at(-1).ok, true);
  assert.equal(scopes[0].owner, OWNER);
  assert.notEqual(scopes[0].owner, PROFILE);
  assert.equal(service.rates.has(OWNER), true);
  assert.equal(service.rates.has(PROFILE), false);
  await save('inference-foreign', { ...config, companions: [{ ...config.companions[0], character: FOREIGN }] });
  assert.equal(f.replies.at(-1).why, 'ineligible');
  assert.equal(scopes.length, 1, 'a foreign character never reaches inference storage');
});
