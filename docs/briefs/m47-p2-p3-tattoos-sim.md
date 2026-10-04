# Brief P2 + P3 — equippable skills («Tatuajes») in the sim (MAREA NEGRA, repo /home/user/realms-of-trade-server)

You build the base; the lead dev reviews, polishes and commits. **Do NOT git commit or push.**
Read `PLAN-M4.7.md` §0, §1, §2.2, §2.3 (Spanish) first: it is the spec, this brief is how to build it.
Work in **two phases**: Phase A (P2: slots and loadouts) → stop and report. The lead reviews, then tells you to do
Phase B (P3: the three tattoos). Another assistant is changing render / UI files in parallel: **stay in `src/sim`,
`src/data`, `src/net`, `server/`, `tests/`** (+ `src/sim/worldgen.js` only for the NPC entry). No client UI.

## How the code works (read these before writing)
- `src/data/weapons.js` (WEAPONS, SKILLS numbers, MASTERY), `src/sim/systems/skills.js` (header comment: equip,
  cast, the four weapon skills, rain), `src/sim/systems/combat.js` `stepPlayerCombat` (one command step: buffers,
  guard, `tryCast` / `stepCast`, pistols, combo, R), `src/sim/systems/stats.js` (`refreshStats`: profile → ECS
  columns; `kitUnlocked`), `src/sim/systems/inventory.js` (profiles, `newProfile`, `sanitizeProfile`,
  `masteryXp` via `world.onXp`), `src/sim/ecs.js` (columns; **`PLAYER_FIELDS`** = what the client predicts and the
  server sends back in `you`), `src/sim/world.js` (`lungeHits`, `crescentHits`, `rainHits`, `strike`,
  `guardShock` for stuns, `lawless(e)`), `src/net/localServer.js` (CMD switch ~line 150, dev commands ~200),
  `src/net/protocol.js` (`sanitizeCmd`), `tests/helpers.mjs` (`arena`, `incoming`, `clientAndServer`) and
  `tests/pistolas.test.mjs` / `tests/sable.test.mjs` / `tests/mastery.test.mjs` for the test style.
- Determinism: anything that touches hostile bullets runs in `stepPlayerCombat` at the command's projectile tick
  `pt` (shared by the server and the client's prediction). Hits on enemies are server-only (`world.isServer`,
  `world.*Hits`, lag-compensated with `historyAt(..., pt - interpTicks)`). New predicted state → new ECS columns
  **added to `PLAYER_FIELDS`**.

## Phase A — P2: slots, loadouts, tattoos meta

1. `src/data/tattoos.js` (new):
   - `SKILL_IDS = ['lunge', 'wave', 'blast', 'blink', 'tromba', 'leap', 'wheel']` (fixed order: the ECS stores the
     index). `skillIndex(id)`, `skillId(i)`.
   - `ARTS = { lunge: { weapon: 'sable', mastery: 1 }, wave: { weapon: 'sable', mastery: 2 }, blast: { weapon:
     'pistolas', mastery: 1 }, blink: { weapon: 'pistolas', mastery: 2 } }`.
   - `TATTOOS = { tromba: {...}, leap: {...}, wheel: {...} }`: `name`, `hint`, `cast: 'ground' | 'charge'`, `forms:
     [{ name, hint }, { name, hint, rank: 2 }, { name, hint, rank: 4 }]` (names/hints from PLAN §2.3: Tromba /
     Ojo de tormenta / Gemelas; Abordaje / Parpadeo / Ancla de abordaje; Timón / Remolino / Timón de guerra; hints
     ≤ 60 chars, Spanish). Gameplay numbers do NOT go here (they go in SKILLS, Phase B).
   - `TATTOO = { xp: [120, 360, 900, 2000], maxRank: 5, dmg: 0.06, catchUp: 2, swapCd: 4, calm: 3, price: 150,
     learnR: 3.5 }`, `DEFAULT_LOADOUT = { sable: ['lunge', 'wave'], pistolas: ['blast', 'blink'] }`.
   - Add `cast` kinds for the arts too (used by the client later): lunge `dir`, wave `dir`, blast `dir`, blink `self`.
2. Profile (`inventory.js`): `p.sk = { has: {}, lo: WEAPON_KINDS.map((k) => [...DEFAULT_LOADOUT[k]]), free: 1 }`;
   `has[id] = [rank, xp, form]`. `sanitizeProfile`: keep only known tattoo ids, rank 1–5, xp ≥ 0 finite, form 0–2
   and allowed by rank; loadouts: each slot a known id that is an art of that weapon or a learned tattoo, no
   duplicate in the same loadout, else the default for that slot. `PROFILE_VERSION` stays 1.
3. ECS (`ecs.js`): `skQ, skE` (skill index), `fmQ, fmE` (form), `rkQ, rkE` (rank, 1 for arts). Add them to
   `PLAYER_FIELDS`. A player without a profile (tests, bots, tools) gets `DEFAULT_LOADOUT` of its weapon, form 0,
   rank 1 — set where players spawn and in `setWeapon` (bots / profile-less) and in `refreshStats` (profiles).
4. `skillOf(ecs, e, slot)`: `'q'` / `'e'` read `skQ` / `skE` (`skillId`); `'basic'` / `'r'` keep reading the weapon.
   Everything that asks "what is in Q/E" goes through it already (check `phases`, `castPose`, `stepCast`, `tryCast`).
   `kitUnlocked(ecs, e, slot)` for q/e: an art needs its `ARTS[id].mastery` on the **current weapon's** mastery
   (0 = unmanaged = yes); a tattoo is always unlocked. `r` unchanged (MASTERY.unlock.r). Today's `MASTERY.unlock`
   q 1 / e 2 matches the default loadout, so the old mastery tests must still pass unchanged.
5. `refreshStats`: from `prof.sk.lo[weapon]` and `prof.sk.has` fill the six columns. `stepEquip`/`setWeapon` at a
   rack: the server's `world.onRack` already swaps the weapon item; make sure the loadout of the new weapon is
   applied (refreshStats after the swap) and a profile-less player gets that weapon's default.
6. Server commands (`localServer.js` CMD switch → new functions in `inventory.js`, all emitting private events
   with `to: e` like the others, then `dirty` / profile resend):
   - `{type: 'loadout', slot: 'q' | 'e', id}`: the current weapon's loadout. Denied (`{type: 'skillDenied', to, e,
     why}`) when: unknown id → 'unknown'; an art of another weapon → 'weapon'; a tattoo not learned → 'unknown';
     `world.lawless(e)` → 'lawless'; `ecs.regenT[e] < TATTOO.calm` (damage taken recently) or casting
     (`castK > 0`) → 'combat'. Same id already in the other slot → swap the two slots (not a denial). On success
     the changed slot's cooldown = `max(cd, TATTOO.swapCd)`, refreshStats, event `{type: 'loadout', to, e, lo}`.
   - `{type: 'form', id, form}`: learned tattoo, `form` 0–2, `forms[form].rank` ≤ its rank ('rank' otherwise), same
     calm / lawless rules; if it is equipped, that slot's cooldown ≥ swapCd. Event `{type: 'form', to, e, id, form}`.
   - `{type: 'learn', id}`: a tattoo not learned yet, within `TATTOO.learnR` of the NPC `tattoo` ('far'); cost 0
     when `p.sk.free` (then free = 0) else `TATTOO.price` gold ('gold' when short). `has[id] = [1, 0, 0]`. Event
     `{type: 'learned', to, e, id, cost}`.
7. NPC entry (`worldgen.js` `npcs`): `{ id: 'tattoo', name: 'Doña Sepia', title: 'Tatuadora', skin: <an NPC skin
   not used yet or 6>, ...P([..]) , facing }` in the village, ≥ 4 u from the other NPCs, props and the path (look at
   `L.vendor` / the fixed village layout). Only the NPC: no prop (the client step adds the stall). Check that the
   talk system (`talkTo` in quests.js) does not crash for her (an empty / short line is fine; P5 does the dialog).
8. Tinta (XP): in `inventory.js` next to `masteryXp`, `tattooXp(world, e, n)` called from the same `world.onXp`:
   for each of Q/E holding a learned tattoo: `gain = n × (rank < best − 1 ? catchUp : 1)` where `best` = the
   highest rank among all learned tattoos; ranks up through `TATTOO.xp`; at max rank xp = 0. On a rank: event
   `{type: 'tattooRank', to, e, id, rank}`, refreshStats.
9. Dev commands (`localServer.js` dev switch): `{op: 'tattoos', rank}` learns all at that rank (default 1);
   `{op: 'tattoo', id, rank, form}` sets one; `{op: 'loadout', slot, id}` bypasses the rules.
10. Tests (`tests/tattoos.test.mjs`, new): default loadouts = the M4.6 kit for both weapons; equip a tattoo into
    Q then E (swap when the same), every denial reason, cooldown after swap, learn (far / free / price / gold),
    form rules, tinta + catch-up + rank event, sanitize (garbage, unknown ids, arts of the wrong weapon, duplicates),
    a save/load round trip keeps `sk`. Until Phase B the tattoos have no cast: equipping one into Q and pressing Q
    must do nothing harmful (no crash, no cast event, no cooldown spent).

11. Hooks for M4.8 (`PLAN-M4.8.md`, black pearls: a third slot G and an element on every hit). Cheap now, costly
    later; no gameplay effect yet:
    - `SLOTS = ['q', 'e']` in `tattoos.js`. Write the slot code (loadout command, sanitize, refreshStats, tinta,
      skillOf) over that list and a per-slot column map (`SLOT_COLS = { q: { sk: 'skQ', fm: 'fmQ', rk: 'rkQ' },
      e: {...} }`), so adding `g` later is one entry + its columns. Do not bind G or add a third slot now.
    - ECS column `elem` (0 = none) in `PLAYER_FIELDS`, set to 0 by `refreshStats` / spawn. Every `strike` call made
      for a player's attack (melee, lunge, wave, shots, blast, rain, storm, and the new skills in Phase B) passes
      `elem: ecs.elem[e]`; `strike` copies a non-zero `elem` onto the damage event it emits. A test checks it reaches
      the event when set by hand.

`npm test` green (all 149 old tests unchanged + yours). **Stop here and report (≤ 15 lines).**

## Phase B — P3: Tromba, Abordaje, Timón (when the lead says go)

Numbers in `SKILLS` (`src/data/weapons.js`), each with `forms: [{}, {...overrides}, {...overrides}]`; a helper
`skillNum(ecs, e, slot)` / `S = formed(id, form)` merges the form's overrides over the base once (cache per id+form).
Damage of a tattoo × `(1 + TATTOO.dmg × (rank − 1))`. Cooldowns use `cdr` like the others. Ranges: the target is
the command's aim point `cmd.ax/az`, clamped to `[min, range]` from the player (like `callRain`).

**Common**: `tryCast` / `phases` / `stepCast` / `castPose` get the new ids. New ACT values: `CHARGE: 20, LEAP: 21`
(ecs.js) — `castPose` returns them. Events carry `skill`, `e`, `seq`, positions and ticks so the client can draw
remote players. Server hit helpers in `world.js`: one generic `areaHits(e, x, z, r, mult, opts, pt, seq)` (every
enemy within r + hurtR, as the attacker saw it) and `pathHits(e, x0, z0, x1, z1, r, mult, key, opts, pt, seq)`
(once per `key` per enemy, like `lungeHits`). `opts.stun` (s): enemies not boss / fixed get `stagger = max(..)`,
their brain back to chase (copy what `guardShock` does), event `stun`; in the lawless zone a player hit gets half
of it as stagger. Shared bullet clearing: a helper `clearParry(world, e, x, z, r, pt, seq, skill, gainLeft)` that
destroys live PARRY hazards within r (+ their radius), emits `destroy`, adds RIPOSTE up to a cap, returns the gain.

1. **Tromba** (`tromba`): phases `[windup 0.22, 0, recover 0.12]`, `move 0.35` in the windup. At the end of the
   windup: state `trT0` = impact tick (`pt + round(delay / DT)`), `trX, trZ`, `trId` = seq, `trF` = form, event
   `{type: 'tromba', e, id, seq, x, z, tick, r, form}`. `stepTromba(world, e, prev, pt, seq)` called next to
   `stepWave` / `stepRain` (keeps going whatever you do): at the impact tick → `clearParry` (cap riposteMax),
   server `areaHits(..., { stun: lift, knock: 3, kind: 'skill', skill: 'tromba' })`, event `{type: 'trombaHit', e,
   id, x, z}`. Form A: after the impact, linger `linger` s: every `every` s `areaHits` × `tick` mult, parryables
   inside cleared each step, enemies within r pulled toward the centre at `pull` u/s (server: add to `kbx/kbz` or
   move them with `moveWithCollision`, enemies only), end event `trombaEnd`. Form B: a second spout `gap` 0.4 s
   after the first, at the aim point **at the moment of the first impact** (clamped to range from you), same
   numbers (`trT1, trX1, trZ1`). Columns `trT0, trX, trZ, trId, trF, trEnd, trT1, trX1, trZ1` in `PLAYER_FIELDS`.
   Numbers: `range 10, r 2.4, windup 0.22, recover 0.12, move 0.35, delay 0.55, mult 2.4, lift 0.7, riposte 1,
   riposteMax 8, cd 9`; A `{ r: 3.0, mult: 1.4, linger: 2.0, every: 0.25, tick: 0.3, pull: 3.2 }`; B `{ r: 1.9,
   mult: 1.7, twin: 1, gap: 0.4 }`.
2. **Abordaje** (`leap`): phases `[windup, air, recover]`; at the cast: target clamped to `[min, range]`, then the
   landing point = the farthest point along start → target (0.3 u steps) where the pirate can stand (write a
   `canStand(world, x, z)` probe with the same rules as `moveWithCollision`: in bounds, not in a collider, not deep
   water); `lpX0, lpZ0, lpX1, lpZ1`. In the air: x/z = lerp by `smoothstep(u)` (no collision), `iframes` covers the
   air time, `castLock` = windup + air (no dash), `ACT.LEAP`. Landing (crossing windup + air): `clearParry` within
   `clearR`, server `areaHits(r, mult, { knock, stun (form B), skill: 'leap' })`, event `{type: 'slam', e, seq, x, z,
   r}`; the cast event carries `x0, z0, x1, z1, air`. Form A «Parpadeo»: no flight: at the end of the windup a
   collision-stepped blink toward the target (reuse the pistol `blink()` stepping but toward the target, up to its
   distance), iframes, event `blink` (same shape as today's) + `empT = emp` (new column): the next basic attack
   started while `empT > 0` (a sword swing stage or a pistol shot) deals × `empMult` and is a crit (add a
   `crit: true` option to `strike` / `damageEnemy` if there is none), then `empT = 0`. Numbers: `range 7, min 1.5,
   windup 0.06, air 0.42, h 2.2, recover 0.16, r 2.2, clearR 2.6, mult 1.8, knock 6, riposte 1, riposteMax 8, cd 10`;
   A `{ blink: 1, range: 6, min: 0.5, iframes: 0.3, recover: 0.08, emp: 1.5, empMult: 1.6, cd: 7 }`; B `{ air: 0.6,
   h: 3.0, r: 3.2, clearR: 3.4, mult: 2.6, stun: 0.5, cd: 13 }`. Columns `lpX0, lpZ0, lpX1, lpZ1, empT`.
3. **Timón** (`wheel`): a **charge** skill. The command now carries Q/E **held** in `btn` (`BTN.Q`, `BTN.E`);
   `sanitizeCmd`: `btn & 0x3ff`. A press (buffered as today) starts the charge if the slot is ready: `castK` =
   slot, `chg = 1` (new column), `castT` counts up, `move 0.6`, `ACT.CHARGE`, face the aim; **no cooldown yet**.
   It ends when the slot's bit is not held in the command (a tap: the same step → k = 0) or `castT ≥ maxHold`:
   throw with `k = min(1, castT / charge)`, cooldown now. Dash / stagger / death during the charge cancel it with
   no cooldown. Throw: `v0 = lerp(fast.speed, slow.speed, k)`, `R = lerp(range)`, `r`, `mult` likewise (form B:
   `r + rAdd`, `mult × multMul`, `v0 × speedMul`); `R` clipped by `clipDistance` (like the crescent, a wall makes
   it turn early). Origin `O` = you + dir × 0.6. **Out** (analytic in ticks): `s(t) = v0·t − v0²·t²/(4R)` for
   `t ∈ [0, 2R/v0]`. **Hang** (form A): `hang` s at the apex (clear parryables within `hangR`, `areaHits` × `hangMult`
   every `hangEvery`). **Back**: stepped one tick at a time from the apex toward your current position: speed
   ramps to `vRet = ret × max(v0, 14)` in `retRamp` s; caught when within `catchR` → the slot's remaining cooldown
   × `(1 − refund)`, event `wheelCatch`. Dropped (event `wheelDrop`) when you die or after `life` s. Every step
   (out, hang, back) clears the parryables its swept segment (radius r) crosses (cap riposteMax) and, on the
   server, `pathHits` with key `id × 2 + (back ? 1 : 0)` (once out, once back per enemy; form B knocks back and
   pierces — they all pierce, B just knocks). Events: `wheel` at the throw `{e, id, seq, x, z, dx, dz, v0, R, r, k,
   hang, tick, form}`, `wheelBack` `{e, id, x, z, tick}`, `wheelCatch`, `wheelDrop`. `stepWheel(world, e, prev, pt,
   seq)` next to `stepWave`. Numbers: `charge 0.9, maxHold 3, move 0.6, fast: { speed: 26, range: 7, r: 0.45,
   mult: 1.0 }, slow: { speed: 13, range: 12, r: 0.8, mult: 2.2 }, ret: 1.1, retRamp: 0.3, catchR: 0.9, refund:
   0.4, life: 4, riposte: 1, riposteMax: 6, cd: 8`; A `{ hang: 1.0, hangR: 1.3, hangEvery: 0.3, hangMult: 0.5 }`;
   B `{ rAdd: 0.35, multMul: 1.35, speedMul: 0.8, knock: 5, refund: 0 }`. Columns `chg, whT0, whX0, whZ0, whDx,
   whDz, whV, whR, whRr, whMul, whF, whPh, whX, whZ, whS, whTb, whId, whN, whSlot`.
4. **Tests** (`tests/tattoos.test.mjs` or `tests/tattoos2.test.mjs`): for each skill and form the numbers above
   (impact tick, damage = ATK × mult × rank bonus, radius in/out, stun, range clamp, landing clamp on water/rock,
   i-frames in the air against an `incoming` bullet, empowered crit, tap vs full charge speed/range, two hits per
   enemy out + back, catch refund, drop on death, wall clip, hang, bullets erased and RIPOSTE capped) and
   **prediction** with `clientAndServer` (as the M3.5 tests do): the client's predicted pirate and bullet
   clearing match the server's after a Tromba, an Abordaje, a Parpadeo and a charged Timón with return.

`npm test` green. Report (≤ 20 lines, no code dumps): files changed, columns added, anything you changed in the
spec and why, test count, open issues.

## Style
Comments in English, dense and short like the code around (each file starts with a header comment saying what it
holds; keep `skills.js`'s header up to date). No new dependencies. Numbers only in `src/data/*`.
