# IC05a: the companion body gathers wood and stone

Ticket T-1021-16 (AREA17, 2026-10-21). Builds on [IC04](ic04-observation-v2.md). No SQL. Protocol 63 -> 64 and
version 0.6.0-alpha.86 -> 0.6.0-alpha.89 (alpha.87 and alpha.88 went to the asset workshop).

## What changed

- `server/companionPresencePolicy.mjs`: `PRESENCE_RADIUS` 12 -> 30 (owner decision). Everything else in the footprint
  is unchanged: lawless Cala, docks, raft decks, practice targets, deep water, danger rules, `PRESENCE_ANCHOR_RADIUS` 3,
  join and retire rules. New `presenceWorkPoint(world, node, from)`: the allowed standing point nearest to `from`
  among the node itself and 16 points within 1.8 of it. `pointOnRouteReason` is exported.
- `server/companionPresence.mjs`: new op `gather`, request keys exactly `[t, requestId, op, expectedRevision, node]`,
  `node` matches `/^[A-Za-z0-9:_-]{1,64}$/`. The owner session and the attached mind may send it (`MIND_OPS`). The
  forbidden, busy, rate, CAS, unavailable, recovery, no_companion and safety rules are the ones of `follow`, in the
  same order (body and owner safety). Then: unknown node `no_node`; a kind other than wood or stone
  `unsupported_node`; no work point, or a straight route that leaves the footprint, `outside_zone`; a node not ready
  `depleted`. On accept the order is `gather` with the node held in memory (lost on restart, like every order).
- `step()`: the body walks with `advancePresence` toward the work point until it is within 2 of the node (reach 2.5),
  waits for the stationary and calm preconditions of `resourceCmd`, then submits one gather between ticks
  (`queueMicrotask`, where a player's command arrives). The result comes only from the authority: success ends
  `wait` / `gathered`; a refusal ends `wait` with the refusal code (`full`, `far`, `cooldown`, ...; camelCase becomes
  snake_case, `node` becomes `no_node`); `busy` is retried at most 3 times, at least 60 ticks (1 s) apart, then
  `wait` / `busy`. Danger (body or owner) stops the body and keeps the order, as for `follow`. 180 ticks without
  progress end `wait` / `blocked`. A submission without any result for 600 ticks ends `wait` / `unavailable`.
- A resident body runs no commands, so its out-of-combat clock never advanced (`regenT` stayed 0 and `resourceCmd`
  always answered `combat`). `step()` now advances `regenT` by one tick for every present body, as the per-command
  combat update does for a player. Damage still resets it.
- Outcome reasons stay on the projection until the next order. Only the safety reasons `dead`, `outside_zone` and
  `danger` clear by themselves (before: every reason except `blocked`; the same set in practice).
- `server/host.mjs`: `residentCommand(id, msg)` sends the body's command into the lane a player's CMD takes on this
  host: `economicAuthority.handle({ id }, msg)` when it owns the command (economic resource ops on), else
  `server.receive(id, msg)` (the direct `resourceCmd` path). `sendTo` hands every message for a socketless id to
  `companionPresence.observe` before the attached-mind fallback; the service matches the resource ack by `opId`.
  `server/economicAuthority.mjs` is unchanged.
- Clients: `src/client/companionPresence.js` accepts the order value `gather`; the card labels it (ES "recolectar",
  EN "gather") through its COPY table. The web panel has no gather button.
- Runner: `PRESENCE_ORDERS` gains `gather` (`PRESENCE_NODE` regex); `network-client.presence('gather',
  { expectedRevision, node })` sends `node` only for gather and validates it locally; receipts with order `gather`
  validate; `PresenceDriver.order(op, node)` and `PairedCompanion` forward the node.
- Mind: the body schema `args.body` enum gains `gather` plus an optional `args.node`; `parseDecision` requires
  `node` exactly when `body` is `gather` and keeps the gather only when the node is a wood or stone node of the
  observation's `confirmed.world`, otherwise it drops the body proposal and the reply survives. The body instruction
  (EN) and the local Spanish hint each gain one sentence on `confirmed.world` and one on how to gather.
- CLI: fixed Spanish lines for gather accepted, `no_node`, `unsupported_node`, `depleted` and the `gathered` outcome;
  the connected line names "recoge madera o piedra".

## How the body enters the economic lane

`host.residentCommand` (server/host.mjs) calls the unchanged `EconomicAuthority.handle` with a socketless
`{ id: bodyClientId }`. Every check a player passes still applies: `economicCommand` keys, `serverProfile` and an open
profile session (the body has both since join), the single-flight busy check, `commandAvailable`, pearl lanes, the
draft through `draftResource` -> `resourceCmd` on a cloned world, the CAS commit of profile and world versions and the
apply in `drain()`. Replies addressed to the body id reach `sendTo`; with a mind attached the agent projection drops
PROFILE and non-own EVENT messages, so nothing of the gather reaches the runner. Player commands never take this
entry point, so player semantics are unchanged.

## Compatibility

- The projection keeps the same 7 keys and the receipt the same 6; only the order value is new. Old runners and web
  clients reject an unknown order strictly, hence protocol 64.
- New refusal codes match `/^[a-z0-9_]{1,64}$/`: `no_node`, `unsupported_node`, `depleted`; outcome reasons
  `gathered`, `busy` and the authority codes.
- With economic resource operations off the yield lands in the live profile like any other change to a body and is
  written at retire or shutdown (resident bodies have no periodic saves).

## Tests

- `tests/companion-presence-gather.test.mjs` (new, 9): owner gather through the economic lane (one submission, one
  CAS commit, pack +1, node rev and readyAt durable); mind gather; refusals; depleted; busy retried then success;
  four busy lanes end `busy`; danger during the walk; direct path with economic ops off; D6 (no PROFILE, SAVE or
  resource event reaches the mind, which stays open and answers its next ops).
- `tests/paired-companion-presence.test.mjs` (+3): parse rules, driver node forwarding, and an end-to-end paired
  runner whose fake model answers body gather. Two assertions now look for the enum string with `gather`.
- `tests/agent-network-client.test.mjs` (+1), `tests/pair-companion-cli.test.mjs` (+1),
  `tests/companion-presence-policy.test.mjs` (+1), `tests/companion-presence-client.test.mjs` (+1),
  `tests/companion-presence-ui.test.mjs` (+1).

## Fixture node

Seed 42, anchor (102.53, 94.05): `coast-4` (wood) at 17.49 from the anchor, the nearest wood or stone node beyond the
old 12 zone with a work point and a clear straight route; the tests find it by script.

## Not included

Palms, axes and the logging timing challenge, rock and iron ore, water, cooking, hunting, handing goods to the owner,
the body pack in the observation, gather loops, pathfinding, persistence of orders, the Studio UI.
