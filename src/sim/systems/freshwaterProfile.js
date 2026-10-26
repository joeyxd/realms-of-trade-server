// Profile-facing predicate and pure delta. World interaction checks stay in the host.
import { checkedFreshwaterCommand, freshwaterProfileDelta } from '../economy/waterContainers.js';

export { checkedFreshwaterCommand, freshwaterProfileDelta };

export function freshwaterMutation(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command) || (Object.getPrototypeOf(command) !== Object.prototype && Object.getPrototypeOf(command) !== null)) return false;
  const value = (key) => { const d = Object.getOwnPropertyDescriptor(command, key); return d && Object.prototype.hasOwnProperty.call(d, 'value') ? d.value : undefined; };
  if (value('type') === 'freshwater') return true;
  if (value('type') !== 'raft') return false;
  const piece = value('part') ?? value('piece') ?? value('p');
  const isWaterBarrel = piece === 'waterBarrel' || (Array.isArray(piece) && piece[0] === 'waterBarrel');
  if (value('op') === 'place') return isWaterBarrel;
  if (value('op') === 'remove') return isWaterBarrel || value('id') === 'waterBarrel' || value('g') === 'waterBarrel';
  return false;
}
