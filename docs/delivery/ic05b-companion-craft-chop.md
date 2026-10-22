# IC05b + IC05c: the companion body crafts a stone tool and works palms, rocks and iron ore

Tickets T-1021-58 (implementation) and T-1021-61 (this doc). AREA17, 2026-10-21. Builds on
[IC05a](ic05a-companion-gather.md). No SQL. Protocol 68 -> 69 and version 0.6.0-alpha.96 -> 0.6.0-alpha.97
(`src/net/protocol.js:3`, `src/data/meta.js`, `package.json`, `package-lock.json`). The work is uncommitted in the
`area17-market` worktree at the time of writing.

## What changed

- `server/companionPresence.mjs`: new presence op `craft`, request keys exactly `[t, requestId, op, expectedRevision,
  recipe]`, `recipe` matches `/^[a-z_]{1,32}$/` (:11 `RECIPE`, :13-15 `OPS` and `MIND_OPS`, keys check near :185). The
  owner session and the attached mind may send it. The forbidden, busy, rate, CAS, unavailable, recovery,
  no_companion and safety rules are the ones of `follow`, in the same order. Then (:230-240): a recipe other than
  `hacha_piedra` or `pico_piedra` (`CRAFT_TOOLS`, :22) is `unsupported_recipe`; a tool the body already owns at that
  tier is `already_owned`; inputs missing from the body's own pack (`profile.eco.pack.goods`, 3 tronco + 2 piedra) are
  `materials`. On accept the order is `wait` with `reason` `crafting` and a `craft` task held in memory (lost on
  restart); the body stands still while it runs.
- `craftStep` (:469) waits for the settled preconditions (`unsettled`, :31) and for the body's resource cooldown, then
  submits one `resource` / `craft` command (`n: 1`, `expectedRev` = the body's `eco.tradeRev`) between ticks
  (`submitCraft`, :478) through `host.residentCommand`, the same economic lane and busy retry (3 times, at least
  1 s apart) as the IC05a gather. The result comes from the authority ack in `observe` (:486): `crafted` or the
  authority refusal code. A submission without any result for 600 ticks ends `unavailable`.
- Gather (:243-256) now accepts `palm`, `rock` and `iron_ore` besides `wood` and `stone` (`TOOL_KINDS`, :20). The
  tool is `RESOURCE_KINDS[kind].tool` (palm: axe; rock, iron_ore: pickaxe). Without it on the body belt
  (`profile.tools[tool] === 1`) the order is refused `no_tool` before the body takes a step. A palm that holds
  another pirate perfect hits of the current cycle is refused `shared_palm` (:253, and again between hits at :421).
  Other kinds stay `unsupported_node`.
- Hit chain (`gatherStep`, :405-425; `outcome`, :495-515): one order strikes until the node final hit. Each hit is
  its own economic op with its own `opId`. After a hit with `remaining > 0` in the ack the task resets `tries`, `at` and
  the challenge, sets `reason` `hit_N_of_M`, and the next hit waits for the body resource cooldown
  (`w.resources.cooldowns`, :418). On the final hit the order ends `wait` with `felled` (palm), `broken` (rock or
  ore, `ack.broken`) or `gathered`. Any new order (`e.order` changed, `e.gather` or `e.craft` replaced) stops the
  chain: the hit in flight lands but `observe` and `submit` ignore it. On a rock or ore final hit the node breaks
  (`ack.broken`, outcome `broken`); by the existing game law the pickaxe is a belt tool and is never consumed.
- Palm timing for a body (`server/loggingAim.mjs`): the aim is refactored into a private `#issue` that the player
  path and the new `resident(id, node, expectedRev)` (:24) both call, so a body meets every precondition of a
  player aim. `resident` is keyed by the body client id, requires `client.companionResident === true`, no socket and
  `workshopOperations` on; otherwise it answers `command` or `disabled`. The row is marked `resident`. `proof`
  (:55-69) stamps `receivedTick` from `worldState.resourceTick()` at the moment the economic authority asks for the
  proof (`server/economicAuthority.mjs:233`), and a resident row whose quality would be above 0 returns no proof, so
  the simulation denies the hit. The body also swings only after the perfect window and not past the accepted one
  (`swingReady`, :443; re-checked in `submit`, :458), so its quality is 0 by construction. No client message creates,
  reads or answers a body row, and the player path is unchanged.
- Observation (`server/agentPerception.mjs:24`, `#kit` :209): the `world` block gains an optional `kit`:
  `{tools: {axe, pickaxe}, pack: {tronco, piedra}}`, tools as 0 or 1, pack as counts, present only when the body has a
  profile with a pack (absent otherwise). `tools/agent/contract.mjs` `validKit` and `validWorld` accept the key as
  optional and exact; `network-client.mjs` `normalizeWorld` (now exported) keeps a valid kit and drops only a
  malformed one.
- Runner and mind: `PRESENCE_ORDERS` gains `craft` and `PRESENCE_RECIPES` (`hacha_piedra`, `pico_piedra`) is new
  (`tools/agent/contract.mjs`). `network-client.presence('craft', {expectedRevision, recipe})`, `PresenceDriver.order(op,
  arg)` and `PairedCompanion` forward the recipe. The body schema enum gains `craft` plus an optional `args.recipe`;
  `parseDecision` keeps a craft only with a stone-tool recipe, and a gather also for palm, rock and iron_ore nodes of
  `confirmed.world` (`tools/agent/mind-contract.mjs`); the EN body instruction and the ES local hint are extended.
- Cards and CLI: the `src/ui/companionPresence.js` safe, separate and mindOn texts (ES and EN) now mention stone
  tools, palms and rocks. `tools/agent/pair-companion.mjs` has fixed Spanish lines for craft accepted, `no_tool`,
  `unsupported_recipe`, `already_owned`, `materials`, `shared_palm`, and the outcomes `crafting`, `crafted`, `felled`,
  `broken` and `hit_N_of_M` ("Lleva N de M golpes."); the connected line names the new verbs.
- `server/host.mjs` is unchanged: `residentCommand` and the `observe` hook are the IC05a ones. The zone stays
  `PRESENCE_RADIUS` 30; water and a larger zone are the later ticket IC05d.

## How a body meets the aim preconditions

The body has an account session (`client.serverProfile` and the open profile session since join), so the
`account_required` rule holds. Stationary, calm and cooldown: `gatherStep` and `craftStep` wait for
`regenT >= TRADE.calm`, zero velocity, no dash, cast or attack stage and an expired resource cooldown before they
send anything (`unsettled`, :31), and `#issue` checks the same rules itself. The IC05a change that advances the body
`regenT` each tick is what makes calm reachable. No player precondition was loosened: `#issue` is the old player
code moved into a method, with the socket id replaced by a client id.

## Compatibility

- The projection keeps the same 7 keys and the receipt the same 6; `craft` is a new request op but never an order
  value (the order of a crafting body is `wait`, `reason` `crafting`). Old runners reject the unknown op, hence
  protocol 67.
- New refusal codes (all match `/^[a-z0-9_]{1,64}$/`): `unsupported_recipe`, `already_owned`, `materials`, `no_tool`,
  `shared_palm`. New outcome reasons: `crafting`, `crafted`, `felled`, `broken`, `hit_N_of_M`. A palm gather with no
  axe was `unsupported_node` in IC05a and is now `no_tool`.
- With economic resource operations off (no timed palm) the palm is chopped on the direct `resourceCmd` path with the
  untimed yield `RESOURCE_KINDS.palm.yield` (2), the same a player gets there.

## Palm yield

A body timed palm gives `timingYield([0, 0, 0])` = 3 tronco (`baseYield`), exactly what a player gets with three
hits at quality 0 (a player with three perfect hits gets 6), plus the node fixed harvest loot. The palm ledger
`worldState.resources.logging[node].quality` stays 0 after a body chop. A rock gives `RESOURCE_KINDS.rock.yield`
(2 piedra) over 4 hits; iron ore has 5 hits and yields 1 mineral.

## Tests

- `tests/companion-presence-craft.test.mjs` (new, 11): owner craft through the economic lane; missing inputs;
  `already_owned` and the pickaxe; mind craft and refused recipes; a new order before submit cancels; busy retried;
  direct path with economic ops off; the mind sees the kit; runner parse and driver; CLI lines; network client.
- `tests/companion-presence-chop.test.mjs` (new, 10): `no_tool` before walking; palm with three quality-0 hits and the
  all-zero yield; no client can supply, read or raise a body challenge; rock with four hits ending `broken`; a new
  order stops the chain; busy retry with a fresh challenge; direct path; bootstrap (gather wood and stone, craft, chop);
  CLI lines; `shared_palm`.
- `tests/helpers/companion-presence-room.mjs` (new): the shared room fixture of both files.
- Changed: `tests/companion-presence-gather.test.mjs` (palm refusal is `no_tool`),
  `tests/paired-companion-presence.test.mjs` (enum with `craft`, palm kept by parse), `tools/qa-companion-presence.mjs`
  (card text).
- Measured by the chef: the two new files pass 21/21. The wide companion, agent, logging and resource suite runs 1095
  tests with 11 failures, and all 11 fail identically on the base commit 011aef1 without this change (pre-existing,
  not caused by IC05b/c): 5 in `tests/agent-inventory-projection.test.mjs`, 1 each in `agent-market-cli`,
  `agent-memory-recovery`, `agent-movement-network`, `agent-pve-network`, `agent-trade-runner` and
  `resource-loop-server`.

## Not included

Water and a larger zone (IC05d), cooking, hunting, handing goods to the owner, pathfinding, persistence of orders,
a web button for craft or chop, recipes other than the two stone hand tools, iron tools.
