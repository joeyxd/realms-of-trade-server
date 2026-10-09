// Server catalog definitions for W00 equipment. A valid definition is not proof of a legitimate item origin.
import { createHash } from 'node:crypto';
import { BASES, ITEMS, RARITIES } from '../../src/data/items.js';
import { sanitizeItem, itemStats, emptyStats } from '../../src/sim/items.js';
import { AssetRegistryError, exact, key, canonical, requestOf, assetOf } from './assetContract.mjs';

const input = () => { throw new AssetRegistryError('input'); };
const knownBase = (id) => { key(id); if (!Object.hasOwn(BASES, id)) input(); return id; };
const digest = (content) => createHash('sha256').update(canonical(content), 'utf8').digest('hex');
const array = (value) => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) input();
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) input();
  return value;
};

export function equipmentDefinition(raw) {
  if (raw?.mode === 'appearance') {
    exact(raw, ['v', 'mode', 'baseId', 'appearanceId', 'appearanceHash']);
    if (raw.v !== 1) input();
    knownBase(raw.baseId); key(raw.appearanceId);
    if (typeof raw.appearanceHash !== 'string' || raw.appearanceHash.length !== 64
      || !/^[0-9a-f]{64}$/.test(raw.appearanceHash)) input();
    return { v: 1, mode: 'appearance', baseId: raw.baseId,
      appearanceId: raw.appearanceId, appearanceHash: raw.appearanceHash };
  }
  if (raw?.mode !== 'functional') input();
  exact(raw, ['v', 'mode', 'item']);
  if (raw.v !== 1) input();
  const item = exact(raw.item, ['b', 'r', 'l', 'a']);
  knownBase(item.b);
  if (!Number.isSafeInteger(item.r) || item.r < 0 || item.r >= RARITIES.length
    || !Number.isSafeInteger(item.l) || item.l < 1 || item.l > ITEMS.maxLevel
    || array(item.a).length > RARITIES[item.r].affixes) input();
  for (const affix of item.a) {
    if (array(affix).length !== 2 || typeof affix[0] !== 'string'
      || !Number.isFinite(affix[1]) || affix[1] < 0) input();
  }
  const sanitized = sanitizeItem({ u: 1, ...item });
  if (!sanitized) input();
  const { u, ...definition } = sanitized;
  if (canonical(definition) !== canonical(item)) input();
  return { v: 1, mode: 'functional', item: definition };
}

export function equipmentStats(raw) {
  const definition = equipmentDefinition(raw);
  return definition.mode === 'appearance' ? emptyStats() : itemStats({ u: 0, ...definition.item });
}

export function equipmentContentHash(raw) { return digest(equipmentDefinition(raw)); }

export function equipmentRegistration(raw, content) {
  exact(raw, ['operationId', 'assetId', 'worldId', 'worldGeneration', 'sourceKey', 'contentId', 'rightsHash', 'to']);
  return requestOf({ ...raw, action: 'register', assetClass: 'equipment', contentHash: equipmentContentHash(content) });
}

export function equipmentContentFor(rawAsset, rawContent) {
  const asset = assetOf(rawAsset), content = equipmentDefinition(rawContent);
  if (asset.assetClass !== 'equipment' || asset.contentHash !== digest(content)) throw new AssetRegistryError('response');
  return content;
}
