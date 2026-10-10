// Profile-only fire mutations shared by the connected authority and local server.
import { changeFireSlot, readFire } from '../economy/fire.js';

const clone = structuredClone;
const MAX_REV = 2147483646;
const KINDS = new Set(['handTorch', 'lantern', 'torchFloor', 'torchWall', 'campfire', 'grill']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, wanted) => object(v) && Reflect.ownKeys(v).length === wanted.length &&
  wanted.every(k => Object.hasOwn(v, k)) && Reflect.ownKeys(v).every(k => typeof k === 'string');
const fail = why => ({ why });

function checkedCommand(command) {
  if (!keys(command, ['type', 'op', 'opId', 'ship', 'part', 'kind', 'expectedRev', 'lit']) ||
      command.type !== 'fire' || !['load', 'set'].includes(command.op) ||
      typeof command.opId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(command.opId) ||
      typeof command.ship !== 'string' || command.ship.length > 120 ||
      typeof command.part !== 'string' || command.part.length > 100 || !KINDS.has(command.kind) ||
      !Number.isSafeInteger(command.expectedRev) || command.expectedRev < 0 || command.expectedRev > MAX_REV ||
      typeof command.lit !== 'boolean') return null;
  if (command.kind === 'handTorch' ? command.ship !== '' || command.part !== 'hand' :
      !command.ship || !command.part || command.part === 'hand') return null;
  return { ...command };
}

function eligibleSlot(profile, command) {
  if (command.kind === 'handTorch') return { key: 'hand', station: null };
  if (!Array.isArray(profile.eco.ships)) return null;
  const ship = profile.eco.ships.find(s => s.id === command.ship);
  if (!ship || ship.kind !== 'raft' || ship.hp <= 0 || !Array.isArray(ship.condition?.entries)) return null;
  const entry = ship.condition.entries.find(e => Array.isArray(e) && e[0] === command.part &&
    e[1] === command.kind && e[6] > 0);
  if (!entry || !Array.isArray(ship.grid?.parts) ||
      !ship.grid.parts.some(part => Array.isArray(part) && part.length >= 5 &&
        part.slice(0, 5).every((value, i) => value === entry[i + 1]))) return null;
  return { key: JSON.stringify([command.ship, command.part]), station: { ship, entry } };
}

export function fireProfileDelta(before, commandRaw, nowSec) {
  const command = checkedCommand(commandRaw);
  if (!command || !Number.isFinite(nowSec) || nowSec < 0 || !object(before) ||
      !object(before.eco) || !Number.isSafeInteger(before.eco.tradeRev) || before.eco.tradeRev < 0 ||
      before.eco.tradeRev > MAX_REV) return fail('input');
  let fire;
  try { fire = readFire(before.fire); } catch { return fail('input'); }
  if (!keys(fire, ['v', 'rev', 'slots']) || fire.v !== 1 || !Number.isSafeInteger(fire.rev) || fire.rev < 0 ||
      fire.rev > MAX_REV || !object(fire.slots) || command.expectedRev !== fire.rev) return fail('revision');
  const selected = eligibleSlot(before, command);
  if (!selected) return fail('ownership');
  const result = changeFireSlot(fire, selected.key, { op: command.op, lit: command.lit, kind: command.kind }, nowSec);
  if (result.why) return fail(result.why);
  if (same(result.state, fire)) return { profile: clone(before), why: '' };
  const next = clone(before);
  next.fire = result.state;
  if (command.op === 'load') {
    if (before.eco.tradeRev >= MAX_REV) return fail('revisionLimit');
    const stationIndex = selected.station ? next.eco.ships.findIndex(s => s.id === command.ship) : -1;
    if (command.kind === 'handTorch') {
      const goods = next.eco.pack?.goods;
      if (!object(goods) || !Number.isSafeInteger(goods.madera) || goods.madera < 1) return fail('goods');
      goods.madera--;
      if (goods.madera === 0) delete goods.madera;
    } else {
      const holdGoods = next.eco.ships[stationIndex]?.hold?.goods;
      const packGoods = next.eco.pack?.goods;
      if (object(holdGoods) && Number.isSafeInteger(holdGoods.madera) && holdGoods.madera > 0) {
        holdGoods.madera--;
        if (holdGoods.madera === 0) delete holdGoods.madera;
      } else if (object(packGoods) && Number.isSafeInteger(packGoods.madera) && packGoods.madera > 0) {
        packGoods.madera--;
        if (packGoods.madera === 0) delete packGoods.madera;
      } else return fail('goods');
    }
    next.eco.tradeRev++;
  }
  return { profile: next, why: '' };
}

export function fireMutation(command) { return command?.type === 'fire'; }
