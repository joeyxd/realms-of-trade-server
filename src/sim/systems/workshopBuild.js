// Payment for the new workshop rules is separate from legacy piece/salvage tuning.
import { readWorkshop, consumeStorageCredit } from './workshop.js';

export function workshopBuildPayment(profile, piece, rules) {
  if (rules !== 2) return null;
  if (piece[0] === 'crate') {
    const workshop = readWorkshop(profile.workshop);
    if (!workshop.crateKits) return { why: 'crateKit' };
    workshop.crateKits--;
    return { cost: {}, workshop };
  }
  if (piece[0] === 'storage') {
    const credit = consumeStorageCredit(profile);
    return { cost: credit.consumed ? {} : { madera: 10 },
      ...(credit.consumed ? { workshop: credit.profile.workshop } : {}) };
  }
  return null;
}
