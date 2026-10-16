// A shore stop changes only the captain's pack. Hull, hold and blueprint stay captured.
export function shorePackCommand(command) {
  if (command?.type === 'commerce') return ['list', 'quote', 'buy', 'sell'].includes(command.op);
  if (command?.type !== 'freshwater') return false;
  if (command.op === 'meal') return command.source === 'grog';
  return ['craftBucket', 'craftCanteen', 'fill', 'fillCanteen', 'decant', 'drink', 'eat'].includes(command.op) ||
    command.op === 'refillCanteen' && ['bucket', 'provisions'].includes(command.source);
}

export function shoreServiceAllowed(world, entity, command) {
  return shorePackCommand(command) && world.navalPilot?.shoreStop?.(entity) === true;
}
