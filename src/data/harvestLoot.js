// Stable bonus rolls use authored node identity and the final node revision, never world RNG.
const MODULUS = 2147483647;
const BONUS_CHANCES = Object.freeze({ resina: 35, coco: 40 });

function hash(text) {
  let value = 17;
  for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) % MODULUS;
  return value;
}

export function harvestLoot(kind, nodeId, finalRevision) {
  if (kind !== 'palm' || typeof nodeId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(nodeId) ||
      !Number.isSafeInteger(finalRevision) || finalRevision < 2 || finalRevision > 2147483647) return {};
  const loot = {};
  for (const [good, chance] of Object.entries(BONUS_CHANCES)) {
    if (hash(`${nodeId}:${finalRevision}:${good}`) % 100 < chance) loot[good] = 1;
  }
  return loot;
}

export { BONUS_CHANCES };
