# Our combat today (T-1024-04)

Ficha for the later Melee port ticket. Read-only map of the claude/combate worktree (origin 12332a0, alpha.101, protocol 71) plus the CMB01 instrument. Every row cites `file:line` in `C:/DEV/real of trade/combate/`; a fact not confirmed is marked UNCONFIRMED. Paths are relative to the worktree root. Constants are copied from the code, not from the briefs.

Abbreviations: `tuning` = src/data/tuning.js, `combat.js` = src/sim/systems/combat.js, `skills.js` = src/sim/systems/skills.js, `world.js` = src/sim/world.js, `LS` = src/net/localServer.js, `GC` = src/client/gameClient.js, `ECS` = src/sim/ecs.js, `FB` = src/ui/feedback.js, `CV` = src/render/characters.js. DT = 1/60 s = 0.01667 s.

---

## 1. Timing base

| item | value | file:line |
|---|---|---|
| sim tick | 60 Hz (`TICK_RATE`), DT 16.67 ms; client and server run the same fixed step | tuning.js:4-5; core/loop.js:49-53 |
| snapshot rate | every 3rd tick = 20 Hz (50 ms) | tuning.js:6; LS:784 |
| snapshot content | `ents` (public ENT tuples) + `you` (own full predicted state) + `ack` | LS:889-891 |
| client interpolation delay | `INTERP_DELAY` 0.1 s (6 ticks); remote entities sampled at `clock + serverOffset - 0.1` | tuning.js:7; GC:767 |
| interpolation gap | 2 snapshots bracket the render time; between them lerp; before the buffer, extrapolate at most 0.1 s | GC:830-856 |
| remote pose age on screen | about 100 ms + up to 50 ms of snapshot granularity + one-way latency | derived from the two rows above |
| own-player prediction | yes: `pred.applyCommand` runs the same `stepMover` + `stepPlayerCombat` at the client tick; reconcile re-runs `pending` after each snapshot | GC:699-732, 606-677 |
| prediction scope | all of PLAYER_FIELDS (movement, hp, stagger, hurtInv, act/actT, atkStage/atkT, guard*, cast*, cooldowns, shot cooldowns) | ECS:206-225 |
| input sampling | one command per client fixed tick (60 Hz) built in `tickInput`; sent through `sendInput` which only pushes to an outbox flushed once per frame | GC:680-732; net/transport.js:31; net/wsTransport.js:57; main.js:1483 |
| input message | `MSG.INPUTS {cmds:[{seq, mx, mz, ax, az, btn, prs, pt, w}]}`; axes quantised to 1/127 | net/protocol.js:10, 92-108 |
| `pt` field | "projectile tick": the server tick the client is showing, nudged toward the server clock (catches up by up to 3 extra ticks, or steps back 1) | GC:688-698 |
| server command intake | 1 command per tick normally (up to 2 / 4 when the queue backs up); a silent client gets neutral filler after `starveTicks` 12 ticks | LS:49-50, 748-761; tuning.js:90; LS:805-813 |
| server clamps a command's `pt` | to `[tick - 24, tick + 2]` (`rewind` 24 ticks = 400 ms, `lead` 2) | tuning.js:87-88; world.js:180-186 |
| melee lag compensation | victim position is read from history at `pt - interpTicks` (6): max rewind about 30 ticks = 500 ms. Applies to every sabre hit, lunge, crescent, areaHits, pathHits (`historyAt`) | world.js:572-591, 595-628, 696-726; systems/enemies.js:41-48 |
| bullet lag compensation | each shot stores `lag = clamp(tick - pt, 0, 24) + 6`; every server step the victim (mob or pirate) is placed with `lagPos(e, lag)` before the swept cylinder test. The bullet itself flies in server real time. NOTE: the 2026-10-23 read says "bullets fly in real time"; true for the projectile, but the victim IS rewound for pirate targets too (`canHit` includes lawless pirates) | world.js:313-318, 333-341, 416-424 |
| victim history depth | 32 ticks (`HIST`); a lag of 31 or more falls back to the current position. Pirates are recorded only if human (not BOT) | systems/enemies.js:18, 44; world.js:855-866 |
| server hitstop | `time` events carry `hitstop`; the server freezes the world (`freeze`) only when `ev.inst` is 1, i.e. instance time AND the striker is the only human; otherwise the event goes out with `inst 0` and nothing freezes server side | LS:639, 839-847 |
| client hitstop | `Loop.addHitstop` zeroes the simulated time for that long: the fixed step (and therefore command production) pauses. With 2 or more humans a local `me` hitstop is capped at `coopHitstop` 0.06 s (the sabre hit asks 0.045 so it is not capped) | core/loop.js:23, 42-46; FB:86-97; tuning.js:91, 157 |
| who gets the hitstop in PvP | only the striker (`meleeHits` calls `feel(e, ...)` for the attacker); `duelBlow`/`hurtByPlayer` never call `feel`, so the victim sees none | world.js:589, 606; combat.js:156-195 |
| client predicted hitstop | `mhit` combat event adds `hitstopMelee` locally on the predicted frame | GC:736-759; FB:113-125 |
| interpolation of `act` | same act in both samples: `actT` lerped; different: act switches at t=0.5 and `actT` is continued | GC:853-855 |
| bot entities | bots skip history (no lag comp) and `canHit` excludes them as PvP targets | world.js:543, 858 |

CMB01 readings (context/NOW.md:9): usable window = `win - RTT - 100 ms interp`; median -17 to -33 ms on LAN, -183 ms at RTT 200; telegraphed share 0 percent in every matchup.

---

## 2. Combat inventory

Legend for the last column: PvE = applies to mobs and pirates alike; PvP = only through the pirate-vs-pirate path, which is gated by `world.canHit` (both fighters inside the Cala `lawlessAt`, neither a bot) at world.js:539-544 and 537. There is no other PvP flag: the PvP rules inside `hurtByPlayer` are simply what runs when the victim is a pirate (`strike`, world.js:555-568, branches on `C.ENEMY`).

### 2.1 Damage pipeline

| mechanic | file:line | constants | gate |
|---|---|---|---|
| damage on a mob | `damageEnemy` (systems/enemies.js) via `strike` | `ATK * mult` | PvE |
| damage on a pirate | `hurtByPlayer` -> `hurtPlayer` | `raw * LAWLESS.pvpDmg 0.6 * (crit ? critMult 1.75 + critDAdd : 1)` then `mitigate` | PvP (Cala) |
| armour formula | `mitigate`: `max(1, round(dmg * (1 - def/(def+40))))` | `defK` 40; base DEF 2 + 1 per level; ATK 10 + 2 per level; HP 100 + 12 per level | both |
| crit | `world.rng() < crit 0.05 + critAdd[by]` or forced by `o.crit` (empowered) | critMult 1.75 | PvP path (mobs have their own roll in damageEnemy) |
| god mode | `ecs.god > 0` gives dmg 0 | | both |
| pierce | `o.pierce` ignores DEF (rain, riposte wave, reflected shots) | | both |
| bullets pay DEF, reflects do not | `pierce: !bullet` | world.js:503-504 | both |
| hurt event | `{type:'hurt', e, dmg, raw, kind, src, by, via, crit}`; `via` = skill name on PvP hurts | combat.js:94-110 | both |
| duel instrument | `duel` event per PvP blow: skill, heavy, tele (declared wind-up), win (time into the cast), out (hit/crit/block/perfect/dodge/mercy), dmg, hp | combat.js:147-160 | PvP only |
| HP regen | after `regenDelay` 5 s without damage, 5 percent of max HP per second | combat.js:614; tuning.js:81-82 | both |
| potion | heals `Pn.heal` share, cooldown `Pn.cd`, predicted | combat.js:783-794 | both |

(Source for the formulas: combat.js:42, 94-110, 156-195; tuning.js:73-78, 79-92; data/lawless.js:5.)

### 2.2 Sabre basic combo (LMB)

All three stages are in `tuning.melee.stages` (tuning.js:95-104); the state machine is combat.js:373-382 (start) and 706-727 (step). Times are seconds from the swing start.

| stage | windup | active | recover | total | arc | range | mult | lunge | move mult | heavy |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.06 (0.00-0.06) | 0.12 (0.06-0.18) | 0.16 | 0.34 | 150 deg | 2.1 u | 1.00 | 0.55 u over the active frames | 0.3 | no |
| 2 | 0.06 | 0.12 (0.06-0.18) | 0.18 | 0.36 | 150 deg | 2.1 u | 1.15 | 0.55 u | 0.3 | no |
| 3 | 0.10 (0-0.10) | 0.14 (0.10-0.24) | 0.30 | 0.64 | 360 deg | 2.5 u | 1.60 | 0 | 0.3 | yes (stagger) |

Rules around the stages:

| mechanic | file:line | constants | gate |
|---|---|---|---|
| hit detection shape | `meleeHits`: for every target each tick the swing is active, circle `range + target.hurtR` (hurtR 0.36 for pirates) and a sector test `dot(facing, dir) >= cos(arc/2)`; targets closer than 0.6 u skip the sector test. Position from lag history | world.js:572-591; combat.js:78-86 (the bullet-side sector) | both (canHit) |
| active frames | only `t in (windup, windup+active]`; `swingActive` runs the bullet logic and, on the server, `meleeHits` every tick of that window | combat.js:711-723, 386-408 | both |
| once per swing per target | `hitBy` map keyed `e * 65536 + swingId` | world.js:577-586; combat.js:375 | both |
| melee knock | `M.knock` 6 u/s (decay 10/s, about 0.6 u), then capped at 8 for pirates | tuning.js:102; combat.js:188 | both |
| heavy (stage 3) stagger | mob 0.35 s (`heavyStagger`); pirate 0.3 s (`LAWLESS.heavyStagger`), clears atkStage, guard, cast | tuning.js:103; data/lawless.js:6; combat.js:189-193 | PvE and PvP values differ |
| link to next stage | a buffered LMB (`inputBuffer` 0.13 s) when `t >= windup+active` starts the next stage immediately and skips the recovery; otherwise after the swing ends there is a `comboGap` 0.3 s to continue; stage 3 never chains | combat.js:635, 707-709, 724; tuning.js:30, 101 | both |
| recovery cancel | recovery also ends as soon as the stick asks to move (`hypot(mx,mz) > 0.2`) after the active frames | combat.js:726 | both |
| guard cancels recovery | raising the guard (RMB) while in the recovery cancels it, remembers `lastStage`, resets `comboT` | combat.js:675-681 | both |
| committed movement | `moveMul` 0.3 while windup+active, full speed in the recovery | combat.js:766-770 | both |
| face lock | `faceLock = windup + active + 0.05`, facing snapped to the aim point at swing start | combat.js:73-76, 379 | both |
| swing event | `{type:'swing', e, stage, seq}` at stage start | combat.js:380 | both |
| mercy bypass | in PvP a `melee` blow and the lunge ignore `hurtInv` (the 0.35 s mercy window) | combat.js:164 | PvP |
| hitstop on a sabre hit | `hitstopMelee` 0.045 s asked for the striker per hit | world.js:589; tuning.js:157 | both (see section 1 for who sees it) |

### 2.3 Sabre skills and R

| skill | file:line | constants | gate |
|---|---|---|---|
| Q Estocada (lunge) | skills.js:229-249, 89-100; data/weapons.js:24 | windup 0.08, move `dist` 4.5 u over `time` 0.16 s along `1-(1-u)^2`, recover 0.22, mult 1.8, width 1.0, cd 7 s; hits once per cast; `heavy:true` (stagger) | both; PvP stagger 0.3 s |
| lunge destroys parryables on the path | skills.js:240-247 | | PvE hazards only |
| E Hoja de viento (crescent) | skills.js:252-290; weapons.js:26 | windup 0.12, speed 14 u/s, life 0.75 s, half-width 0.9, depth 0.45, mult 1.4, recover 0.2, cd 5; hit knock 6 | both |
| R Tormenta (riposte wave) | combat.js:550-564, 729-735; world.js:762-769 | needs riposte meter 100; radius 6 u (8 with passive); damage `ATK * dmgMult 3`; `pierce`, `heavy`, knock 14; reflects hazards radially | both |
| cast state machine | `tryCast` / `stepCast` / `castPose` / `cancelCast`; `castK` 1 Q, 2 E, 3 G; `castT` seconds; `castLock = windup + active` (a dash cannot cancel it) | skills.js:137-209, 105-112 | both |
| Cometa / Ancla / Nube / Rayo / Timon / Abordaje (pearl and tattoo skills) | skills.js:212-227, 450-678; weapons.js:18-21, 46+ | out of scope for the port except as users of the same cast machine | both |

### 2.4 Pistols

| mechanic | file:line | constants | gate |
|---|---|---|---|
| left gun (LMB held) | skills.js:385-400; weapons.js:30 | every 0.2 s (`shotCd`), speed 20 u/s, life 0.9 s, radius 0.16, mult 0.7, spread 1.5 deg, move 0.85, no wind-up, `heavy:false` | both |
| right gun (RMB held) | skills.js:403-418; weapons.js:31 | every 0.6 s (`shotAltCd`), speed 26, life 0.95, radius 0.19, mult 1.5, spread 0.35 deg, `heavy:true`, no wind-up | both |
| right gun on a pirate | `heavy` -> `duelBlow.heavy` -> stagger 0.3 s and guard cost 1.5x, block mult 0.4, knock 7 | combat.js:180-193 | PvP |
| both guns independent | `firePrimary` and `fireSecondary` can fire in one command | combat.js:696-704 | both |
| no guard on pistols | `ecs.guardT = -1` for the pistol kit; RMB fires the steel gun | combat.js:630-634 | both |
| pellet blast (Q Descarga) | skills.js:293-318; weapons.js:33 | windup 0.05, 7 pellets over 44 deg, speed 16, life 0.4, mult 0.55 each, knock 7, recoil 5, root 0.15, cd 6 | both |
| Paso de humo (E blink) | skills.js:322-340; weapons.js:35 | dist 4.5 u collision-stepped, i-frames 0.3 s, recover 0.1, cd 7 | both |
| Lluvia de plomo (R) | skills.js:348-382; weapons.js:37 | range 9, delay 0.35, duration 1.5 s, tick 0.15 s, radius 3.2, mult 0.55, pierce, `above:true` (ignores guard) | both |
| bullet vs sabre | NO interaction: the sabre swing, lunge, crescent, blast and storm loop over `world.hazards` only; a pirate's bullet lives in `world.shots` and cannot be reflected, destroyed or caught. The one bullet/hazard clash (`SHOT.BULLET` vs mob parryables) skips player-owned hazards | combat.js:386-408 (loop at 389), 550-558; skills.js:240, 278; world.js:426-492 (skip at 433) | PvP gap |
| bullet vs dash | `strike` -> `hurtByPlayer`: `iframes > 0` returns `dodge` event, no damage, no RIPOSTE, no XP (ESQUIVA is paid only in `contacts` for hazards) | combat.js:161 vs 441-446 | PvP gap |

### 2.5 Invulnerability, hitstun, push

| mechanic | file:line | constants | gate |
|---|---|---|---|
| `hurtInv` (mercy) | set by `hurtPlayer` to `hurtIframes` after any damaging hit that is not `noInv`; bullets and AoE pass through while it runs; melee and lunge in PvP ignore it | combat.js:100, 164; tuning.js:80 | both |
| respawn i-frames | 2.0 s | tuning.js:84; combat.js:204 | both |
| stagger (hitstun) | `ecs.stagger` seconds. Locks steering and dash (`locked`), cancels cast, swing and guard, `moveMul` 0, act STAGGER. Sources: PvP heavy 0.3 s, perfect-guard shock 0.5-0.7 s, guard break 0.9 s, unstoppable spike 0.3 s, tattoo stun halved for pirates | movement.js:134-136; combat.js:613, 648-649, 189-193, 339-345, 470-473; world.js:731-746 | both |
| light hits cause no hitstun | no stagger on non-heavy hits: the victim keeps swinging, dashing and guarding (only `knock` pushes and `hurtInv` shields) | combat.js:188-194 | PvP |
| knockback model | `kbx/kbz += dir * k`; `dir` = from the blow origin (o.x, o.z) to the victim, NOT the attacker's facing; per tick moves `kb*dt` with collision then decays by `exp(-10 dt)`; stops under 0.05. Default `hitKnock` 4 u/s (0.4 u). Additive, no scaling with damage or HP, no player-side influence on direction | combat.js:101-102; movement.js:115-123; tuning.js:86 | both |
| PvP knock cap | `min(knock, 8)` | combat.js:188 | PvP |
| other knock values | block 2, heavy block 7, AoE 6, beam 4, lava 3, blast 7, riposte 14, rain 0.6 | tuning.js:149; combat.js:504, 528, 539; weapons.js:33; tuning.js:133; world.js:638 | both |
| perfect-guard shock | pirate in PvP: attacker within `shockR` 3.2 u is staggered `shockStagger` 0.5 s and loses swing, guard, cast; mobs within 3 u get 0.7 s and 5 u/s push | combat.js:170-177; data/lawless.js:7-8; world.js:773-789; tuning.js:152 | both with different numbers |
| fall damage | jump lab/game: true damage as fraction of maxHp (0.25 / 0.5 lab, 0.25 / 1.0 game), `noInv`, `pierce` | world.js:344-352; tuning.js:177-178 | both (jump mode) |

### 2.6 Guard, reflect, catch, graze, RIPOSTE

| mechanic | file:line | constants | gate |
|---|---|---|---|
| guard raise | RMB held, only when free (not mid-swing, cast, or buffered attack), stamina `>= minRaise` 10; sets `guardT = 0`; `guardP = 1` if the re-arm timer has run out | combat.js:675-688 | both (sabre only) |
| guard numbers | arc 130 deg, `perfect` window 0.13 s after raising, `rearm` 0.45 s before another perfect-capable raise, move multiplier 0.45, stamina 60 (+ gear), regen 30 per s after 0.7 s idle | tuning.js:148-151; stats.js:107; combat.js:616-620 | both |
| block (PvP) | inside the arc and not `above`: stamina `-= raw * cost 1` (heavy 1.5); damage through `blockMult 0.25` (heavy 0.4); knock 2 (heavy 7); `noInv`; riposte +2; event `guard st:block` | combat.js:180-187; tuning.js:149-151 | both |
| guard break | stamina `<= 0`: `guardSt = 0`, guard dropped, stagger `breakStagger` 0.9 s, swing cleared, event `guard st:break`. Observers see only act STAGGER; the owner gets a callout, sound, shake and screen tint | combat.js:339-345, 185; FB:253-258 | both |
| perfect guard (PvP) | within 0.13 s of the raise: zero damage, riposte +12, attacker (if within 3.2 u) staggered 0.5 s and cancelled. No hitstop, no catch of a pirate bullet | combat.js:168-179 | PvP |
| perfect guard (hazards) | catch up to `catchMax` 3 bullets for `catchLife` 6 s; next LMB throws them back in a 7 deg fan (`releaseCaught`); hitstop 0.09, slowmo 0.5; also `guardShock` | combat.js:349-371, 312-327; tuning.js:152-154 | PvE |
| unstoppable (UNSTOP) pierces guard | punish: 0.3 s stagger | combat.js:468-473; tuning.js:112 | PvE |
| sword reflect tiers | by time-to-contact of a hostile bullet: EXCELENTE `tc <= 0.07` (x3, aimed at cursor, hitstop 0.11, slowmo 0.35, only tier that returns heavy orbs), BUENO `<= 0.15` (x2, spread +-10 deg), POBRE `<= 0.26` (x1, spread +-35); beyond that the bullet is destroyed. slack 0.15 u | combat.js:269-273, 386-408; tuning.js:139-144 | PvE only (hazards) |
| catch / graze windows | graze: a bullet passing within `graze` 0.35 u of the hurtbox earns +4 riposte, +2 XP (ROCE); ghost: dashing through an unstoppable earns +8 (FANTASMA); dodge: dashing through a bullet that would have hit +3 (ESQUIVA) | combat.js:432-448, 475-485; tuning.js:109, 133-134 | PvE only |
| coyote | a parryable that touches you deals damage 60 ms later; LMB in the gap is a POBRE reflect, RMB a block | combat.js:461-465, 651-673; tuning.js:120 | PvE only |
| RIPOSTE meter | gains: destroy 4, graze 4, ghost 8, dodge 3, perfect 12, block 2, reflect tier 18/10/5; max 100; multiplier `ripMul`; spent by R | tuning.js:133, 141-143, 152; combat.js:88-90 | both |
| chain | tier 2+ reflects within `chainGap` 1.2 s stack to 5: damage x(1 + 0.1(n-1)) | combat.js:71, 301; tuning.js:129-132 | PvE |

### 2.7 Dash, death, water

| mechanic | file:line | constants | gate |
|---|---|---|---|
| dash | buffered DASH press (`inputBuffer` 0.13 s); distance 5.5 u over 0.22 s on `1-(1-u)^2`; direction = stick or facing; sub-stepped 0.3 u; exit carries run speed | movement.js:142, 159-198; tuning.js:39-50 | both |
| dash i-frames | `iframes = dash.duration` 0.22 s, the whole dash (not a sub-window) | movement.js:167 | both |
| dash charges | `dashCharges` 1 (2 from level 2), `recharge` 0.9 s each, sequential; a heavy pack forbids dashing | movement.js:141, 144-152; tuning.js:43-45; combat.js:49-51 | both |
| dash cancels | swing, guard and (in recovery only) a cast; a dash cannot interrupt a cast's windup or active frames (`castLock`) | combat.js:642-647; movement.js:159 | both |
| ENT.DASHES | `dashCount`: a lifetime counter incremented on each dash start, NOT the charges | movement.js:169; protocol.js:76 | both |
| death | `killPlayer`: hp 0, `dead = 1`, clears swing, guard, chain, dash, state; respawn timer `respawnTime` 3 s; XP loss 10 percent; Cala spill via `onDeath` | combat.js:112-141; tuning.js:83-85 | both |
| death ACT | `ACT.DEAD` while `dead > 0`; respawn at checkpoint with 2 s i-frames | combat.js:601-612, 197-208 | both |
| knocked into water | `moveWithCollision` lets a pirate (not a mob) step into deep water (`waterAllowed = canSwim`); `refreshSwimming` then sets `swim`, `state SWIM`, snaps y, clears `dashT`, `iframes`; combat inputs are masked (only AIM/INTERACT/POTION), swing, guard, cast cancelled; swim stamina 30, drowning pulses `damageFraction` 0.1 of maxHp every 1 s after grace 5 s | movement.js:72-85, 111; swimming.js:6-27; combat.js:572-577, 597-599; tuning.js:33-37 | both |
| jump (lab/game) | in a jump or fall `btn=0, prs=0` (no attack, guard, skill); landing cancels nothing special; MN_JUMP lab ON in prod | combat.js:569-571; tuning.js:167-179; systems/jump.js:218 | both |

### 2.8 Mob telegraphs (for contrast)

| item | file:line | constants |
|---|---|---|
| mob wind-up | `windup` per attack: 0.4 to 0.8 s (volley 0.45, cleave 0.8, spikes 0.6, orb 0.8, bite 0.42, ring 0.6, mortar 0.5) | data/enemies.js:14-67 |
| projectile arm time | hostile bullets are harmless for 0.15 s after emission | tuning.js:107 |
| player wind-ups | 0.06 / 0.06 / 0.10 sabre, 0.08 lunge, 0.12 crescent, 0.05 blast, 0 pistols | tuning.js:97-99; weapons.js:24, 26, 33, 30-31 |
| mob history | mobs record position each tick (HIST 32) for lag comp | systems/enemies.js:18-40 |

---

## 3. Action model

| question | answer | file:line |
|---|---|---|
| how is the current action stored | `ecs.act` (an `ACT` code) + `ecs.actT` (seconds in that act). They are derived each command, not authoritative: the real state is the separate columns `atkStage`/`atkT`, `guardT`, `castK`/`castT`, `shotCd`, `stagger`, `dashT` | combat.js:762-779; ECS:22-29 |
| ACT codes | IDLE 0, SWING1-3 1-3, GUARD 4 (=PARRY), STAGGER 5, DEAD 6, DORMANT 7, WAKE 8, WINDUP 9, FIRE 10, RECOVER 11, HIT 12, RIPOSTE 13, ENRAGE 14, LUNGE 15, THROW 16, SHOOT 17, BLAST 18, CAST 19, CHARGE 20, LEAP 21. `RECOVER` 11 and `HIT` 12 exist but are mob-only: no player code path sets them | ECS:22-29; combat.js:771-779 |
| act priority per command | dead > stagger > cast pose > guard > shoot > cast (first 0.4 s) > swing > riposte (first 0.45 s) > idle | combat.js:771-779 |
| `actT` | `setAct` resets it to 0 when the act changes; `stepPlayerCombat` adds `dt` each command. Seconds, float64 | combat.js:583, 796-798 |
| frame-indexed or seconds | everything is seconds (`atkT`, `castT`, `guardT`, `stagger`, `hurtInv`, cooldowns); only projectile and hazard timelines are tick-indexed (`pt`, `tAct`, `waveT0`) and the jump (PT06) runs on a 30 Hz SM64 frame phase | combat.js:567-590; skills.js:258-262; tuning.js:167-170 |
| phase machine of a swing | `atkStage` 0-3, `atkT += dt`; windup, active, recover are compared against `atkT` thresholds; no explicit phase variable | combat.js:711-727 |
| phase machine of a cast | `castK`/`castT`; `phases(id,S)` returns `[windup, active, recover]`; `stepCast` fires the effect on crossing `windup` (`t0 <= w && t1 > w`) and ends at the sum | skills.js:89-100, 168-189 |
| one-shot hit bookkeeping | `swingId` incremented per swing and per cast; server maps `hitBy[attacker] = e*65536 + swingId` | combat.js:375; skills.js:162; world.js:577 |
| what ENT sends about it | only `ACT` (byte-like) and `ACTT` (q3 seconds) plus hp, weapon, element, jump stage, dash count. No `atkStage`, `castK`, `guardT`, stamina, riposte, cooldowns, hurtInv or stagger time. Observers therefore know "stage n is swinging for actT seconds" but not the blow's declared timeline | protocol.js:67, 74-81 |
| what the owner gets | `you` = PLAYER_FIELDS at full precision at the acked command | world.js:916-924; LS:891 |
| inputs that start actions | `prs` bits are edges, `btn` are held; LMB/Q/E/G go into 0.13 s buffers (`atkBuf`, `qBuf`, `eBuf`, `gBuf`, `rBuf`) | combat.js:629-640; skills.js:125-134 |
| who may act | `canAct = !swim && !dashing && stagger <= 0` (dashing includes airborne) | combat.js:642-649 |
| order inside one command | `stepMover` (dash, steer, knock) then `stepPlayerCombat`: timers, in-flight effects (wave, rain, tromba, wheel), drowning, death/respawn, stagger decay, regen, equip, potion, buffers, coyote, guard, cast, pistol triggers, melee combo, R, `contacts`, pending coyote damage, guard timer, `moveMul` and `act` | world.js:188-211; combat.js:566-780 |

---

## 4. Animation pipeline

| question | answer | file:line |
|---|---|---|
| how a character is drawn | a procedural 15-bone rig ("gameplay rig") posed by code in `CharacterView`; per frame `combat(dt, s)` turns `s.act` and `s.actT` into limb targets (`set('armR', pitch, yaw)`, torso `T.cx/cy/sx/sy`) blended with weight `w` | CV:434-571; render/assets/rebind.js:5 |
| native clips | glTF clips through `THREE.AnimationMixer` exist only for (a) the character sheet idle `figureAnimation`, (b) the in-place swim clip `swimAnimation`, (c) the hit `reactionAnimation`. No attack, guard, dash or stagger clip | render/assets/characterFigure.js:9-19, 42-46; render/assets/manifest.js:39-40, 105-107 |
| swing pose source | pure code: stage 1 and 2 are a sine/cubic sweep of the right arm (windup, `easeOutCubic` over `active`, ease out over `recover`) using the SAME `tuning.melee.stages` numbers; stage 3 adds a full `TAU` spin. So changing the timeline in tuning automatically changes the drawn pose | CV:442-459 |
| other poses | RIPOSTE (0.45 s), LUNGE (windup/time/recover from SKILLS), THROW, BLAST, CAST, CHARGE, LEAP, STAGGER (`w = 1 - t/0.35`), GUARD (damped weight), SHOOT (recoil springs) | CV:460-521, 552-571 |
| sync to cast time | by sharing the clock: `s.actT` is the server's time in the act (owner: predicted `actT + alpha*DT`; remote: interpolated `actT` continuing across the 50 ms snapshot gap). The pose reads `actT` directly, so the drawn pose cannot drift from the sim for the owner | GC:882, 853-855; CV:435 |
| remote timing | remote players are drawn 100 ms (+ snapshot jitter) behind; their `swing` event slash effect is delayed by `windup + INTERP_DELAY` to match | GC:767; FB:98-105 |
| act change granularity | a remote swing that starts and ends between two snapshots (stage 1 is 0.34 s, a lunge 0.46 s; snapshots every 50 ms) is seen; a blow shorter than 50 ms could be missed (none today) | tuning.js:97; derived |
| hit reaction (flinch) | `CharacterView.hit(k, dir)` sets a procedural flinch `hitK`; on skins with `reactionAnimation` (Bucanero) it also restarts an additive layer sampled from the clip `hit_to_body_01` by a private mixer | CV:236-244; render/assets/characterReaction.js:28-95; docs/briefs/buccaneer-combat-reaction.md:7-14 |
| reaction rules | eligible only when act is IDLE, SHOOT or STAGGER and not dead/dashing/swimming; envelope in 80 ms, out 160 ms; deltas relative to frame 0, on spine/chest/head and, when still, arms; a new confirmed hit restarts it; never queued | characterReaction.js:18-26, 66-91 |
| clip stats | 1.292 s, 195 tracks, 65 bones in the source; idle + swim + hit baked into the derivative; no draw-call increase | docs/briefs/buccaneer-combat-reaction.md:22-26 |
| who triggers the flinch | `hurt` event: not-me pirate -> `v.hit(0.8)` + red flash; me -> `v.hit(1)`; `damage` for mobs `flinch(v, ...)` with 1.4 for heavy; `stun` -> `v.hit(1.2)`; `mhit` (predicted) flinches the target on the attacker's screen at the predicted frame | FB:461-486, 126-147, 269-274, 113-125 |
| flinch does not affect gameplay | purely visual; there is no hit-stun animation tied to `stagger` other than act STAGGER pose | CV:515-518 |
| hit flash / numbers / shake / comic | fully in FB; client hitstop via Loop; slow-mo via `Loop.slowmo` | FB:86-97, 113-125; core/loop.js |
| guard-break and block visuals | block: callout, shake, sparks (FB:224-252); break: callout + screen tint for the owner (FB:253-258); observer sees act STAGGER only | FB:224-259 |

Facts the port must respect: the sim, not the animation, owns timing; the renderer reads `act`/`actT` from ENT; there is no animation-event channel from clip to sim; swings carry no per-frame data on the wire.

---

## 5. Input and protocol

| item | value | file:line |
|---|---|---|
| BTN bits (held `btn` and edge `prs`) | DASH 1, ATTACK 2, PARRY/GUARD 4 (alias), Q 8, E 16, R 32, INTERACT 64, AIM 128, POTION 256, G 512, JUMP 1024 | systems/movement.js:13 |
| mask on the wire | `btn` and `prs` are `& 0x7ff` (11 bits: bits 0 to 10), all 11 are used | net/protocol.js:103-104 |
| FREE BTN bits | none inside the current mask. Bit 2048 (0x800) and above are free as values, but three places hard-reject above 0x7ff: `sanitizeCmd` (protocol.js:103-104), `pearlInputBoundary.js:13, 33`, `deathInputBoundary.js:10, 30`. A grab input needs a mask widening in those three and a protocol bump; alternatively a chord (ATTACK + GUARD) with no new bit | as cited |
| `w` (weapon) | 4 bits, `w = weapon + 1` | protocol.js:106 |
| command fields | `seq, mx, mz, ax, az, btn, prs, pt, w` (+ `control` for managed agents) | protocol.js:10, 94-108; GC:699-703 |
| ENT tuple | `[ID, KIND, X, Y, Z, F, VX, VZ, ST, MAG, WADE, DASHES, HP, MAXHP, ACT, ACTT, LVL, WPN, ELEM, LANTERN, JMP]` = indices 0 to 20 | protocol.js:67; encode 74-81 |
| ENT rounding | positions and facing to 1/1000, velocities and blends to 1/100, `ACTT` to 1/1000 | protocol.js:72-81 |
| free ENT slots | the tuple is an open array: appending index 21+ costs bytes for every entity at 20 Hz; no reserved slot | protocol.js:67 |
| protocol number | `PROTOCOL_VERSION = 71` (hello rejects a mismatch); WELCOME carries `v` | net/protocol.js:4; LS:211, 246 |
| next free | alpha.102, protocol 72, SQL044 (re-check after every fetch) | context/NOW.md (workspace) |
| events | server -> client `EVENT {ev}` carry combat feedback: swing, mhit, hurt, damage, guard, parry, stun, time, dodge, duel, death, ... | protocol.js:34; combat.js; FB:82+ |
| private state | stamina, riposte, cooldowns, hurtInv, stagger remain private to the owner (`you`) | ECS:206-225 |
| client-only caches | `meleeSeen` for predicted `mhit`; `predicted` set of feedback keys already shown, to dedupe the server copy | GC:65, 736-760 |
| transport | local worker or WebSocket; inputs flushed once per frame | net/transport.js:31; net/wsTransport.js:57 |
| gate list | the updater runs a fixed list of test files (TESTS in deploy/vps-update.py:44; 61 files per NOW.md); duel telemetry test in the gate | workspace PROJECT.md; context/NOW.md:8 |

---

## 6. Plug points for each Melee system

One row per Melee system. "Lands" is the most direct file:line today; "conflicts" names what the port will hit. Not a design.

| Melee system | where it would land | conflicts |
|---|---|---|
| Hitlag on both fighters | Server decision point is `world.meleeHits` / `strike` (world.js:555-591), where both attacker and victim are known; the attacker's request goes through `world.feel` (world.js:214-226). Today `duelBlow` and `hurtByPlayer` never request any freeze for the victim (combat.js:156-195). Victim-side lag would need a per-entity timer decremented in `stepPlayerCombat` (combat.js:583-590) | The only freeze mechanism is a global `Loop.hitstop` on the client and `LS.freeze` on the server (LS:639, 839-847; loop.js:42-46), which stops the whole world and all command production; with 2+ humans the server deliberately does not freeze (LS:842) and the client caps the striker at 60 ms (tuning.js:91). Per-entity hitlag therefore needs a sim-owned timer in PLAYER_FIELDS (ECS:206-225) so prediction can reproduce it, plus the renderer reading it to freeze the pose and the figure's `advance` (the actT clock). PvE feel: gate with `world.canHit`/lawless pattern (world.js:537-544) to keep mobs unchanged. Predicted client sim must pause the same entity or it diverges (GC:699-732) |
| Knockback scaled by damage taken plus directional influence | The velocity add is combat.js:101-102 (`kbx += dir * k`, cap 8 at combat.js:188); decay is `knockStep` (movement.js:115-123). Scaling needs a per-pirate accumulator (damage percent) read at combat.js:101; DI needs the victim's current `mx,mz` which is a command input (`cmd` is not in scope inside `hurtPlayer`; the victim's last command is `c.last`, LS:763) | Knock is additive, direction = blow origin to victim, not attacker facing or angle table (combat.js:101). PvP victims are not locked unless heavy (combat.js:189), so a DI-less shove coexists with free steering. The server hits "between the victim's own commands" (combat.js:143-145 comment), so the victim's predicted state reconciles; large launch speeds raise `errLen` (GC:627-635; teleport smoothing threshold 4 u). Wall/water outcome: moveWithCollision slides along walls (movement.js:82-100) and enters water (movement.js:77), so a launch into water means swim, not a bounce. Protocol: the percent accumulator is private state (PLAYER_FIELDS, no ENT bump) unless a damage-percent HUD for observers is wanted (ENT + protocol bump) |
| Hitstun | `ecs.stagger` already is a hitstun: set at combat.js:189-193 (heavy only), guard break (339-345), shock (170-177), decays at combat.js:613, cancels cast at 648, locks steering at movement.js:134-136, act STAGGER at 773 | Today only the third hit, lunge, storm and the right gun stagger (0.3 s); a Melee-like "every hit stuns for a time that depends on damage and knock" replaces the existing mercy-window logic (combat.js:164, 100) and changes the duel rhythm CMB01 measured. Observers see STAGGER with no length (ENT lacks stagger time), so the 0.35 s pose is a fixed formula (CV:516). PvP gating via the `strike` branch (world.js:561) keeps PvE |
| Shield and powershield | Guard already exists: raise combat.js:675-688, perfect window `guardPerfect` (combat.js:331, `guard.perfect` 0.13 s, `rearm` 0.45 s), stamina 60 with cost x1, regen 30/s (tuning.js:148-155), break 0.9 s stagger (combat.js:339). PvP block and perfect are combat.js:167-187 | Pistols have no guard (combat.js:634), the guard has a 130 deg front arc (tuning.js:149) not a bubble, shield has no shrink/ coverage model, RMB is also the right gun trigger in the pistol kit (combat.js:632). Powershield today does not reflect a pirate bullet (no catch path, combat.js:168-179). Stamina and riposte are private, so observers cannot read shield health (a "shield bubble" visual would need an ENT field or event). The 0.13 s perfect window is shorter than the 0.0 to 0.2 s of interp + snapshot (section 1) |
| Clank and rebound between two attacks | A new check in the melee path where two overlapping active swings are both known server-side: `meleeHits` loop over `o` (world.js:578) could compare `atkStage[o] > 0 && atkT[o]` in active window, before `strike`. Both attackers' states are in `ecs` (ECS:208-209) | There is no attacker-vs-attacker test today; hits are one-directional and resolved in the order commands arrive within a tick (LS:727-765), so two simultaneous trades are decided by iteration order unless handled. Lag compensation rewinds victim position but not the victim's `atkT` (history stores x,z only, enemies.js:34-40), so a clank decision at `pt` needs the opponent's cast state at that rewound tick, which is not stored. Sabre-vs-bullet clank is blocked by the hazards/shots split (combat.js:389). `projectileClash.js` exists for bullet-vs-bullet clashes (src/sim/projectileClash.js) and is the pattern for a clank: UNCONFIRMED (not read in detail). Both clients must predict it or it shows as a late snap |
| Grab, pummel, throw, mash escape | New action: input needs a bit or chord (section 5: no free bit, mask 0x7ff). New state: add an `ACT` code (ECS:22-29, 22 is next) and a cast-like machine; the cast machine (skills.js:137-209) with `castK` 3 reserved for G is the nearest template. Hold-and-throw needs the victim's position/velocity driven by the attacker, see movement.js:63-112 for collision-safe moves and combat.js:101 for a throw impulse | Both entities need a shared state while held (`heldBy`, `holding`), mutating two entities in one command: today a command mutates only its own entity (world.js:188-211) except through `strike`, so the victim is changed between its own commands and then reconciled. Mash escape reads the victim's presses (prs) which arrive on the victim's own command stream, so the sim must allow cross-entity reads. The current guard absolutely beats a swing (combat.js:167-187), so grab beating guard is a new rule. Needs protocol bump (new ACT values are within the byte, but new BTN needs mask widening, and a new ENT field if observers need to see who holds whom); animation: no clip, procedural pose only (CV:434-571) |
| Dodge intangibility frames | The dash sets `iframes = 0.22 s` for the whole dash at movement.js:167, checked in `hurtByPlayer` (combat.js:161) and `contacts` (combat.js:433). A Melee-style window would split `iframes` into start and end (e.g. active only in a sub-range of `dashT`) at movement.js:175-198. Spot dodge/roll variants would be new states | One charge pool with a 0.9 s recharge (tuning.js:43-45) and a lifetime counter in ENT.DASHES (movement.js:169). `iframes` is a single float: no vulnerability tail after the dash. Dash cancel rules (combat.js:642-647) interact with any new startup/endlag. The dash pays no ESQUIVA against pirate bullets (combat.js:161). Prediction and server share `stepMover` (movement.js:126) so a change there is deterministic on both sides; observers see only STATE.DASH via `ST` |
| Attack strings with link windows | The combo is already a string: `tuning.melee.stages` + `comboGap` 0.3 + `inputBuffer` 0.13 (tuning.js:95-104, 30) and `swingStage` (combat.js:373-382, 707-709, 724). A window table per stage replaces `comboGap`/`inputBuffer` | The link is "buffered press at active end chains at once, skipping the recovery" (combat.js:724), which is more permissive than a Melee jab-to-jab window; the third hit always breaks the string. Strings across moves (sabre to Q or E) go through `castBusy` and `swingBusy` guards (combat.js:677-679, 691). Visuals read the same tuning numbers (CV:442-459), so retuning is free for the owner. Changing the number of stages needs `ACT.SWINGn` codes (ECS:23) and the `stage` field of `swing` events; observers' `actT` resets when act changes, so a longer string has more `ACT` values or reuses SWING3 |
| Smash charge | Q/E already have a charge pattern: `stepCharge` (skills.js:576-589) with `chg`, `castT` counting while the key is held, release throws; the wheel and mastbolt use it. A held-ATTACK charge would add a branch at combat.js:635-640 and 706-710 | `btn` carries ATTACK held (bit 2) but the basic attack buffers an edge (combat.js:635) and pistols already treat held LMB as "keep firing" (combat.js:631). Charge level needs to reach the damage formula (world.js:588 `ATK * st.mult`) and the `duel` instrument (combat.js:147). Observers see CHARGE act only for the wheel (CV:496-502) with no charge amount in ENT |
| Frame-scripted action states driving animation | Today the direction is code-driven: `tuning.melee.stages` numbers feed both sim (combat.js:711-727) and the pose (CV:442-459). A data-driven state table would replace the three places that read `st.windup/active/recover`: `swingStage` (combat.js:379), `swingActive` caller (combat.js:717-723) and the renderer (CV:443) | Everything is seconds, not frames (section 3). The wire carries only `ACT` + `ACTT`; a frame-scripted move would reconstruct the frame from `ACTT * 60` on observers, which is fine at 20 Hz interpolation but cannot carry per-move events (hitbox changes, cancel windows) without a server-side table mirrored on the client. The Bucanero additive reaction layer samples a source clip and is eligible only in IDLE/SHOOT/STAGGER (characterReaction.js:18-21): attack clips would need a second mixer layer or a switch of that layer's eligibility. The sim must not depend on animation (no animation event channel exists), so scripts live in data shared by `src/sim` and `src/render` (already the case for tuning.js) |

---

## 7. Open questions

1. **Bullets and lag compensation.** The brief says "bullets fly in real time". The code rewinds the victim for each shot by `lag = clamp(tick - pt, 0, 24) + 6` (world.js:313-318, 416-424). Confirm with a measurement whether this makes pistol hits feel rewound for the victim (CMB01 shows pistols favoured on LAN, sabre in lag).
2. **Hitlag channel.** Should hitlag be sim state (predicted, in PLAYER_FIELDS) or presentation (a `Loop` freeze)? The current system is presentation plus a server freeze that is disabled for 2+ humans (LS:842).
3. **Free BTN bit for grab.** All 11 bits are used and three validators hard-code 0x7ff (protocol.js:103-104; pearlInputBoundary.js:13, 33; deathInputBoundary.js:10, 30). Chord on ATTACK + GUARD or widen the mask?
4. **`ACT.RECOVER` and `ACT.HIT` are mob-only.** There is no player RECOVER act, so the victim of guard break and the attacker in recovery are indistinguishable from idle for observers (combat.js:771-779).
5. **Dash pays nothing against pirate bullets and the reflect kit cannot touch them** (combat.js:161, 389). Is this in CMB02's scope (it is, per context/NOW.md:13) or left for the Melee port?
6. **`projectileClash.js`** (64 lines) was not read: UNCONFIRMED whether it is a ready pattern for a clank between two attacks.
7. **Remote hurt feedback detail.** Whether an observer sees a guard-break reaction other than the generic STAGGER pose: the code shows only the owner's callout (FB:253-258); a remote-view effect is UNCONFIRMED.
8. **Victim-side attack history.** Lag history stores only x,z (systems/enemies.js:34-40). Clank, counter-hit and "hit during the victim's startup" checks need the victim's `atkStage`/`atkT`/`guardT` at the rewound tick: not recorded today.
9. **Snapshot rate.** 20 Hz (tuning.js:6) with a 100 ms buffer cannot show sub-50 ms events (a 3-frame jab); is an increase planned? UNCONFIRMED.
10. **Per-stage hit data.** There is one hit shape per stage; no per-frame hitbox list. Multi-hit moves (Melee drag-down, rapid jabs) would call `meleeHits` once per swing key, so a second hit needs a new key (world.js:577).
11. **Tool support.** `tools/lawless.mjs` (RTT env, usable window = win - RTT - 100 ms, tools/lawless.mjs:23, 90) and `tools/botbrain.mjs` (reaction 0.2 + (1 - SKILL) * 0.25 s) are the only harness; they do not see pirate bullets (context/NOW.md:19). Any port needs a way to measure frame advantage.

Not covered (budget/time): `src/sim/projectileClash.js` and `src/sim/projectiles.js` internals (hazard slot structure, `H.live`), `server/` bots and companion code, `render/assets/characterSwim.js` internals, `systems/jump.js` beyond its gating, the full `tools/botbrain.mjs` decision tree, and the skill-studio/editor path (`src/editor/skillDocument.js`) which may become the home for data-driven moves.
