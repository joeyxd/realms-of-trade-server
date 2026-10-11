// Private, derived carrying forecast. No good identities/counts enter public raft records.
import { raftCapacity } from '../economy/raftCapacity.js';
import { publicRafts } from './rafts.js';
import { hullIntegrity, repairPartCost } from '../naval/structure.js';
import { raftConditionEntry } from '../naval/condition.js';

export function ownerRaftCapacity(w, e, records = null) {
  const profile = w.profiles?.get(e);
  const ship = profile?.eco?.ships?.find((s) => s.kind === 'raft' && s.at === 'aldea' && s.hp > 0);
  if (!ship || w.rafts?.get(ship.id)?.owner !== e) return null;
  const record = (records || publicRafts(w)).find((r) => r.id === ship.id && r.owner === e);
  if (!record) return null;
  const naval = w.navalPilot?.snapshot(e), voyage = w.navalPilot?.voyageSnapshot(e);
  const mode = voyage?.active && voyage.phase === 'shore' ? 'reboard' : naval?.active ? 'sailing' : 'port';
  const rig = mode === 'sailing' ? naval.body.operational.rig : null;
  return { id: ship.id, raftRev: ship.rev, tradeRev: profile.eco.tradeRev, mode,
    ...raftCapacity(record.parts, ship.hold, profile.eco.pack, rig, w.navalPilot?.payload(ship.id)),
    condition: w.rafts.get(ship.id).condition ? {
      hull: { ...hullIntegrity(w.rafts.get(ship.id).condition) },
      entries: ship.grid.parts.map((piece, index) => {
        const entry = raftConditionEntry(w.rafts.get(ship.id), index);
        return { index, id: entry.id, piece: [...piece], hp: entry.hp, maxHp: entry.maxHp, cost: repairPartCost(entry) };
      }),
    } : null };
}
