# IC04: observation v2, the mind sees the world around its body

Ticket T-1021-08 (AREA17, 2026-10-21). Builds on [IC03b](ic03b-runner-presence.md). No SQL or protocol change; version 0.6.0-alpha.86.

## What changed

- `server/agentPerception.mjs`: new frozen `AGENT_WORLD_POLICY = { v: 1, radius: 24, maxNodes: 16 }`. Every projected agent
  SNAPSHOT gains one top-level key `world`, computed for the perceiving body only. `AGENT_PILOT_POLICY`, the `perception`
  key and the entity logic are unchanged.
- `tools/agent/network-client.mjs`: a valid `world` becomes `observation.confirmed.world`; a missing or malformed one
  means no `world` key and the rest of the observation is unaffected.
- `tools/agent/contract.mjs`: `validObservation` accepts `confirmed.world` as an optional exact-key block (new
  `validWorld`, `WORLD_MAX_NODES`). An observation without it stays valid.

## The world block

Server wire (`snapshot.world`): `{ v: 1, tick, hours, nodes, truncated, water, bench }`, or `null` when the body is dead,
has hp <= 0 or is not positioned.

- `nodes`: resource nodes within 24 (3D distance, like entities), nearest first (tie: id), at most 16, each
  `{ id, kind, x, y, z, ready, wait, remaining? }`; x, y, z and wait rounded to 0.1, `remaining` only for kinds with hits.
  No occlusion: the node catalogue is public. `truncated` is true when more than 16 were in radius.
- `hours`: hour of the game day (0 to 24), rounded to 0.1. `water` and `bench`: `{ x, y, z, distance }` or `null`
  (freshwater only when `freshwaterEnabled`; both only within 24).

Runner (`confirmed.world`): `{ hours, nodes: [{ ref: { nodeId }, kind, position, ready, wait, remaining? }], truncated,
water: { position, distance } | null, bench: { position, distance } | null }`. Defense in depth like entities: nodes more
than 24 away (plus 0.09 for the wire rounding) are dropped locally and the list is capped at 16 nearest first.

## Compatibility

- Old runner, new server: `#snapshot` reads only tick, ack, you, ents and perception; `world` is ignored. The WELCOME
  check and `AGENT_PILOT_POLICY` are untouched, so pinned runners keep admitting.
- New runner, old server: no `world` in the snapshot, no `world` key in the observation, same behaviour as before.
- Human client snapshots (`broadcastSnapshot`) are untouched.

## Budget

- Per agent per snapshot O(nodes in the layout), no catalogue copy; views are built for the nearest 16 only. The
  freshwater source is cached per map.
- Serialized `world` at the caps (16 nodes, water and bench set): at most 2,400 bytes (asserted).

## Tests

- `tests/agent-perception.test.mjs` (+6): policies, radius in/out, 16 nearest and `truncated`, water and bench, dead self
  gives null, size bound.
- `tests/agent-interface.test.mjs` (+2): `validObservation` with and without `world`, extra key, 17 nodes, malformed blocks.
- `tests/agent-network-client.test.mjs` (+4): `confirmed.world`, node at 30 dropped, malformed world ignored, cap 16, and a
  managed pilot on a real server seeing nodes and the bench.

## Not included

- Animals, ground items, weather, storm and frost, owner marking, fire, cookers and fuel; no prompt or instruction text
  (the model receives `world` inside the observation, with no explanation yet); no new capability, grant or verb (IC05).
