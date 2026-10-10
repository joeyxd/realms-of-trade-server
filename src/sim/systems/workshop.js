// Pure, profile-only workshop plans. The host must commit the returned profile atomically.
import { WORKSHOP } from '../../data/workshop.js';
import { readProgression } from './progression.js';

const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const record = o => o !== null && typeof o === 'object' && !Array.isArray(o)
  && [Object.prototype, null].includes(Object.getPrototypeOf(o));
const fail = code => { throw new WorkshopError(code); };

function exact(raw, keys) {
  if (!record(raw)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => {
    const d = descriptors[key]; return d?.enumerable && Object.hasOwn(d, 'value');
  });
}

function data(raw, key, optional = false) {
  if (!record(raw)) fail('profile');
  const d = Object.getOwnPropertyDescriptor(raw, key);
  if (!d) {
    if (optional) {
      for (let p = Object.getPrototypeOf(raw); p; p = Object.getPrototypeOf(p))
        if (Object.getOwnPropertyDescriptor(p, key)) fail('profile');
      return undefined;
    }
    fail('profile');
  }
  if (!d.enumerable || !Object.hasOwn(d, 'value')) fail('profile');
  return d.value;
}

function copyDataRecord(raw) {
  if (!record(raw)) fail('profile');
  const out = {}, descriptors = Object.getOwnPropertyDescriptors(raw);
  for (const key of Reflect.ownKeys(descriptors)) {
    const d = descriptors[key];
    if (!d.enumerable || !Object.hasOwn(d, 'value')) fail('profile');
    Object.defineProperty(out, key, { value: d.value, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

export class WorkshopError extends Error {
  constructor(code) { super(`Workshop: ${code}`); this.name = 'WorkshopError'; this.code = code; }
}

export function newWorkshop() { return { v: WORKSHOP.version, boards: 0, storageCredit: false, crateKits: 0 }; }

// An absent legacy field is empty; present malformed/future values fail closed.
export function readWorkshop(raw) {
  if (raw === undefined) return newWorkshop();
  if (!exact(raw, ['v', 'boards', 'storageCredit', 'crateKits'])
      || raw.v !== WORKSHOP.version || !integer(raw.boards, 0, WORKSHOP.boardsRequired)
      || typeof raw.storageCredit !== 'boolean' || !integer(raw.crateKits, 0, WORKSHOP.maxCrateKits)) fail('state');
  return { v: raw.v, boards: raw.boards, storageCredit: raw.storageCredit, crateKits: raw.crateKits };
}

function profileState(profile) {
  const rawWorkshop = data(profile, 'workshop', true);
  const state = readWorkshop(rawWorkshop);
  const progression = readProgression(data(profile, 'progression', true));
  // Old profiles that already know the lesson completed the quest before this field existed.
  if (rawWorkshop === undefined && progression.knowledge.includes(WORKSHOP.lesson)) {
    state.boards = WORKSHOP.boardsRequired;
    state.storageCredit = false;
  }
  return { state, progression };
}

function cloneProfile(profile, state, progression, pack) {
  if (!record(profile)) fail('profile');
  const descriptors = Object.getOwnPropertyDescriptors(profile), clone = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    const d = descriptors[key];
    if (!d.enumerable || !Object.hasOwn(d, 'value')) fail('profile');
    Object.defineProperty(clone, key, { value: d.value, enumerable: true, writable: true, configurable: true });
  }
  clone.workshop = state;
  if (progression) clone.progression = progression;
  if (pack) clone.eco = { ...copyDataRecord(data(profile, 'eco')), pack };
  return clone;
}

function packState(profile) {
  const eco = data(profile, 'eco'), pack = data(eco, 'pack'), goods = data(pack, 'goods');
  const rev = data(eco, 'tradeRev');
  if (!integer(rev, 0, 2147483646) || !record(goods)) fail('profile');
  const wood = data(goods, WORKSHOP.boardGood, true);
  if (wood !== undefined && !integer(wood, 0, Number.MAX_SAFE_INTEGER)) fail('profile');
  return { eco, pack, goods, wood: wood ?? 0, rev };
}

function commandData(command, type) {
  const keys = type === 'contribute' ? ['type', 'amount', 'expectedRev'] : ['type', 'expectedRev'];
  if (!exact(command, keys) || command.type !== type || !integer(command.expectedRev, 0, 2147483646)
      || (type === 'contribute' && !integer(command.amount, 1, 10))) fail('input');
}

// `contribute` uses only boards already in the personal pack. `craftCrate` consumes two.
export function workshopPlan(profile, command) {
  if (!record(command)) fail('input');
  const type = data(command, 'type');
  if (type !== 'contribute' && type !== 'craftCrate') fail('input');
  commandData(command, type);
  const { state, progression } = profileState(profile), { eco, pack, goods, wood, rev } = packState(profile);
  if (command.expectedRev !== rev) fail('conflict');
  if (progression.knowledge.includes(WORKSHOP.lesson) && type === 'contribute') fail('lessonKnown');
  if (state.boards >= WORKSHOP.boardsRequired && type === 'contribute') fail('questComplete');
  if (rev >= 2147483646) fail('limit');

  const nextState = { ...state }, nextGoods = copyDataRecord(goods);
  let nextProgression;
  if (type === 'contribute') {
    const amount = command.amount;
    if (state.boards + amount > WORKSHOP.boardsRequired) fail('overflow');
    if (wood < amount) fail('goods');
    nextState.boards += amount;
    if (wood === amount) delete nextGoods[WORKSHOP.boardGood];
    else nextGoods[WORKSHOP.boardGood] = wood - amount;
    if (nextState.boards === WORKSHOP.boardsRequired) {
      nextState.storageCredit = true;
      nextProgression = { ...progression, knowledge: [...progression.knowledge, WORKSHOP.lesson] };
    }
  } else {
    if (nextState.crateKits >= WORKSHOP.maxCrateKits) fail('limit');
    if (wood < WORKSHOP.crateBoardCost) fail('goods');
    nextState.crateKits++;
    const rest = wood - WORKSHOP.crateBoardCost;
    if (rest) nextGoods[WORKSHOP.boardGood] = rest; else delete nextGoods[WORKSHOP.boardGood];
  }
  const nextPack = { ...copyDataRecord(pack), goods: nextGoods };
  const nextEco = { ...copyDataRecord(eco), pack: nextPack, tradeRev: rev + 1 };
  const nextProfile = cloneProfile(profile, nextState, nextProgression, nextPack);
  nextProfile.eco = nextEco;
  return { profile: nextProfile, workshop: nextState, tradeRev: rev + 1,
    taught: !!nextProgression, crafted: type === 'craftCrate' };
}

// Called by the raft-building authority as part of that authority's same atomic profile update.
export function consumeStorageCredit(profile) {
  const { state, progression } = profileState(profile);
  if (!state.storageCredit) return { profile, consumed: false };
  state.storageCredit = false;
  const nextProfile = cloneProfile(profile, state, null, null);
  return { profile: nextProfile, consumed: true, progression };
}
