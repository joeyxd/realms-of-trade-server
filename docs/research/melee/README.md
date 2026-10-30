# Melee port: fichas and plan (CMB, 2026-10-24)

Joi (2026-10-24): copy Super Smash Bros. Melee's fighting, with exact timings first and tuning later
(rule: replicate exactly, test, then make it ours). The source is the doldecomp/melee PC port
`999sian/melee-pc` at commit 0fb0af3, sparse read-only checkout in `C:/DEV/_refs/melee-pc`. It is outside
this repo and never enters it.

**Legal rule.** It is a Nintendo decompilation. We copy mechanics, state machines, numbers and formulas,
and write our own JS from the fichas. Never paste its code.

**Nintendo assets as a local reference (Joi, 2026-10-24).** Melee's animations (and other assets) may be used
as a reference, for practice, or as a starting point, as long as each one is marked `nintendo` and replaced
before anything is published. Here "published" means every push to loving-lovelace, because the VPS deploys it
for players within minutes. So the mark is enforced, not only written:
- A Nintendo-derived file has `nintendo` in its name (`marth-jab1.nintendo.json`) and lives outside the repo, in
  `C:/DEV/_refs/` next to melee-pc. The repo ignores `*nintendo*` as a second fence.
- Code that can use one loads it only in local dev, and falls back to our own pose or effect when the file is
  missing. The live game never depends on one.
- The disc's animation files are not on this machine yet (2026-10-24). The repo still never holds them.
- Mechanics, timings and numbers are not assets: those we copy freely, as before.

**Melee as the base, the game as ours (Joi, 2026-10-24).** We take Melee's style and feel as the base and build
something new on it: we have shots, dashes, HP, and a 3D world. Every ported rule goes in exactly first and
then gets adapted; the adaptations are listed under "Ours" below.

## The fichas

| file | ticket | what it holds |
|---|---|---|
| [01-hit-pipeline.md](01-hit-pipeline.md) | T-1024-01 | swept hitboxes, hit groups, the per-frame process order, staling, hitlag, SDI and ASDI, knockback, DI, hitstun, tumble |
| [02-defense-parry.md](02-defense-parry.md) | T-1024-02 | shield, powershield (the parry), shieldstun and pushback, shield break and dizzy, clank and rebound (cross of blades), reflect, Marth's Counter, dodges, tech |
| [03-grab-throw.md](03-grab-throw.md) | T-1024-03 | grab boxes, grab beats shield, catch and capture states, pummel, throws, hold timer and mash, release |
| [04-our-combat.md](04-our-combat.md) | T-1024-04 | our duel today: timing base, every constant, the action model, the 15-bone procedural rig, the protocol, and where each Melee system plugs in |
| [05-animation-attacks.md](05-animation-attacks.md) | T-1024-05 | action states, animation playback, the subaction script commands, hitboxes on bones, IASA, the jab latch, rapid jab, smash charge, L-cancel, Marth's kit, ground movement |
| [06-data-values.md](06-data-values.md) | T-1024-06 | the numbers Melee keeps in data rather than code (PlCo.dat, Marth's attributes and frame data), one source per row |
| [07-cpu-ai.md](07-cpu-ai.md) | T-1024-22 | how the CPU fighters think (levels 0-9 change only reaction, attention and stick precision, never stats), weighted attack choice by predicted reach, defend before attack, Master Hand's category draw, our habit memory proposal and the AI level knob |
| [08-hit-feel.md](08-hit-feel.md) | T-1024-23 | the feel of a hit: the victim's shake during hitlag, camera quake on strong airborne hits, rumble on both pads, sparks and sounds by element and tier, ColAnim flashes, our client inventory and the juice slices J1..J8 |
| [09-ssbu-reference.md](09-ssbu-reference.md) | T-1024-36 | Smash Ultimate as a local reference (Joi's own dump, `C:/DEV/_refs/ssbu-nintendo`): Marth's frame data next to Melee's, shield and parry and grab numbers from the game's bytes, the decompiled grab state machine, 340 animations and rendered poses |
| [10-terry.md](10-terry.md) | T-1030-09 | Terry Bogard (Ultimate `dolly`) as the unarmed brawler reference: params, ground normals, grab, specials, Power Wave, super specials and the GO rule, with NO ENCONTRADO where the dump tool could not decompile |

Citations in 01, 02, 03 and 05 resolve inside `C:/DEV/_refs/melee-pc`. `DATA` marks a value that lives in game
data; 06 fills most of them from community sources (SmashWiki, libmelee). It does not read raw bytes, so it is medium
confidence unless the row says H.

## The key fact: one Melee frame is one sim tick

Our sim runs at 60 Hz (src/data/tuning.js:4), the same as Melee. A Melee frame count becomes a tick count 1:1,
with no rescaling. Our current tuning is in seconds and not frame-aligned: the sabre's first hit has windup
0.06 s = 3.6 ticks, active 0.12 = 7.2 and recover 0.16 = 9.6 (tuning.js:97). A port converts tuning to integer frames.

Proposed unit mapping, to confirm in the first BUILD ticket:
- Melee percent maps to the percent of max HP already lost, from 0 to 100. Knockback then grows as HP drops, which is the CMB07 ask.
- Melee damage d maps to a hit's damage as a percent of max HP.
- Distances use one factor k: the Bucanero rig height divided by Melee's character height. The first BUILD ticket measures k.

## Numbers to copy first (Melee value, then frames and seconds)

| system | Melee rule | source |
|---|---|---|
| process order per frame | hitlag, animation and script, input, grab collision (12), attack collision (13), resolve (14) | 01; fighter.c:905-916 |
| hitlag, both fighters | floor(d/3 + 3) frames, cap 20 (crouch 0.667x victim) | 06 A1; 01 |
| hitstun | floor(0.4 * KB) frames; 100 KB = 40 f = 0.67 s | 06 A1 |
| knockback | ((((p/10 + p*d/20) * 200/(w+100) * 1.4) + 18) * g/100 + b) * r | 06 A1; ftcoll.c:2071-2122 |
| launch | speed KB * 0.03, decays 0.051 per frame; DI rotates up to about 18 degrees | 06 A1, A2 |
| shield | HP 60, -0.28/f held, +0.07/f regen, takes 0.7x damage, breaks below 0 and returns at 30 | 06 A3; 02 |
| shieldstun | (d * 0.45 + 2) * 200/201 frames | 06 A3 |
| powershield (parry) | hit inside the first 4 frames of shield (2 for projectiles): no shield damage, reflect at 0.5x damage | 06 A4; 02; ftCo_Guard.c:73-93 |
| clank | cancelled if own - 9 < other's damage; both grounded only; rebound ceil(0.559 * (d + 10)) frames, uncancellable | 02; ftcoll.c:236-253, 1495-1498; 06 A6 |
| dizzy | (400 - p) + 90 frames, mash -3 per input | 06 A5 |
| grab | beats shield (grab collision ignores it); Marth standing grab active 7-8 of 30, dash grab 10-11 of 40 | 03; ftcoll.c:1311-1375; 06 C1 |
| hold and mash | floor(76 + 1.6p) frames, -6 per mash input; pummel 3% at f7 of 24; release 29 f both, no advantage | 06 A5; 03 |
| roll / spot dodge | roll 31 f, intangible 4-19; spot dodge 22 f, intangible 2-15 (Marth fwd roll 35 f) | 06 A7 |
| jab string | Marth jab 1 active 4-7 of 27, next input from frame 20; jab latch plus script combo gate | 06 C1; 05; ftCo_Attack1.c:211-225 |
| smash charge | pose freezes at the charge frame, up to 60 frames, linear damage multiplier (1.3671 unconfirmed) | 05; ft_0DF0.c:16-134 |
| forward smash | Marth: active 10-13 of 49, 14% (tip 20%), BKB 60, KBG 70 | 06 C1 |
| staling | last 9 hits, -0.09 ... -0.01 by position | 06 A7; plstale.c:51-64 |

Check on the knockback mapping: Marth's forward smash at 14% gives KB 84 against a fresh opponent (p = 14) and
146 at p = 94. That is 1.75 times, close to the CMB07 acceptance (the knock at 20 percent HP is about twice the
one at full HP).

## Port plan (proposal, the area takes it slice by slice)

Every slice is gated with the lawless.js pattern (PvP first, PvE feel unchanged), is measured with the CMB01
harness before and after, and gets formula tests written from the fichas.

1. **P1 frame core and hit pipeline (feeds CMB03 and CMB05).** Each fighter gets sim-owned state in
   PLAYER_FIELDS: state id, frame, rate and hitlag (ecs.js:206-225). Moves become frame descriptors with events:
   hitbox on and off, combo gate, IASA and intangible. Hitlag applies to both fighters (the victim gets it too)
   and replaces the global freeze, which is off with 2 or more humans. Then hitstun at 0.4 times KB, knockback
   on lost-HP percent, and DI of ±18 degrees. The procedural rig keys poses to the frame. Conflict to solve
   (04): lag history stores only x and z, and must also store state and frame.
2. **P2 defense (CMB06, absorbs part of CMB02).** The guard becomes the Melee shield, and our stamina is already 60.
   The powershield is the first 4 frames of guard, judged at the defender's input tick: commands carry `pt`,
   clamped to [tick-24, tick+2]. Clank uses the 9 rule plus rebound; it is the cross of blades as a paired pose.
   Projectile reflect on powershield.
3. **P3 grab triangle (CMB07).** Grab is guard held plus an attack press: that is Melee's own input (Z is
   normalized to shield plus A, fighter.c:1904-1922), and it needs no new BTN bit (all 11 are in use, protocol.js:103).
   Grab collision runs before attack collision and ignores the guard. Then the hold timer and mash, pummel,
   throws as hits (ring-out into the water), and the 29-frame release.
4. **P4 strings and charge.** The jab latch and combo gate replace inputBuffer and comboGap. Dancing Blade
   (4 hits with up and down branches) is the template for short strings with an escape. The heavy gets smash
   charge with a frozen pose, which is also the CMB03 telegraph.
5. **P5 honest dash (CMB04), built (T-1025-53).** MN_MELEE dash: 31 frames, intangible 4-19,
   vulnerable 1-3 and 20-31; our 5.5 u ease-out movement finishes on 19, then stationary endlag.
   Exit standing without carry; landed damage, launch or capture interrupts. P3c shield rolls stay unchanged.
6. **P6 Counter (RIPOSTE rework).** Marth's Counter state machine: a script-opened window, then a collision
   callback that starts the counterattack.

Animation: the client draws a procedural 15-bone rig from `act` and `actT` (04; characters.js:434-459). Each
ported move gets a pose sheet keyed to its frames: rest, first active, last active, IASA and end. The poses are
ours, and the timing is Melee's (06 C). The server owns the state, the frame and the hitbox windows; the client
owns blending and cosmetic poses (05 section 6).

Test effects: `C:/DEV/real of trade/asset-staging/combat-vfx-v1/alpha/` holds 9 original 512x512 RGBA sprites
(T-1024-07, outside the repo). They map one to one to the ported events:

| sprite | event |
|---|---|
| hit-spark | hit |
| slash-arc | active frames |
| steel-clash | clank |
| parry-flash | powershield |
| guard-break | shield break |
| stun-swirl | dizzy |
| grab-grip | grab |
| launch-smoke | KB over the tumble threshold |
| telegraph-glint | heavy windup or charge |

## Ours: 3D, shots, dashes, HP (decided 2026-10-24)

| Melee | ours | why |
|---|---|---|
| percent, stocks | HP. Melee has an HP mode of its own: Stamina mode keeps adding percent and shows HP = stamina - percent (pl/player.c:1106-1120). We port that with stamina 100: p = percent of max HP lost, d = a hit's damage as a percent of max HP | exact, not an invention |
| launch in the 2D stage plane (x, y) | launch on the ground plane. The whole launch speed `KB * 0.03` goes horizontal, so how far a blow carries matches Melee; the Melee angle only draws a visual arc. The sim stays on the deck, so collision and falling into the water work as today | ring-out is the deck edge, not a blast line in the sky |
| horizontal direction from the attacker's facing | melee: the attacker's facing; shots: the bullet's travel direction | the 3D version of left or right |
| DI rotates the launch up to 18 degrees with the stick | the same formula on the ground plane: `cross = vx*sz - vz*sx`, `q = sign(cross) * cross^2 / v^2`, rotate around the vertical axis by 18 degrees times q (01 section 4) | same rule, other plane |
| projectiles: hitlag on the victim only | our bullets the same: the shooter never freezes | Melee rule |
| Marth's kit | sabre hit 1 = jab 1, hit 2 = jab 2, hit 3 = forward tilt (35 frames, close to our 0.64 s), lunge = dash attack. Shots and skills Marth lacks get our own numbers (P1a brief) | his timings are the closest to ours |
| generic roll timeline (P5, T-1025-53) | MN_MELEE dash owns 31 commands, i-frames 4-19; startup 1-3 and endlag 20-31 vulnerable. Our 5.5 u follow the existing ease-out curve on 1-19, then no movement. Command 32 retires the completed dash before combat or a buffered dash, with zero velocity and no exit carry; damage, launch and a successful grab end it immediately. Skill i-frames are preserved | 31 / 4-19 from 06 A7; standing exit from 02 section 2.4. Distance, curve, charges, recharge and input buffer stay ours. Reuses the existing mover and body; no new assets or render changes. Flag off keeps the 0.22 s fully invulnerable dash and exit carry; P3c shield rolls unchanged |
| weight | 87, Marth's, for every pirate (a Marth ditto) | until we have more characters |
| percent of a small body (T-1024-27, Joi's playtest) | a body counts at least 100 HP (LAWLESS.meleeStamina): p and d are HP points per max(maxHp, 100). The Sandbag counts as a 100-HP pirate (meleeHp: 100) | a 24-HP grunt reached 92 percent in two jabs and flew 61 u; hitlag hit 317 ms |
| unit scale | LAWLESS.meleeUnit 0.06 u per Melee unit (was 0.12): half the distance, same timing | Joi: the knockback was too much |
| tumble, DownBound, DownWait, DownStand | KB at or over 80 (LAWLESS.meleeTumble): the victim slides the whole launch and stays down meleeDown 0.5 s (ours), locked; the view (src/render/launchPose.js) hops it off its feet, lays it on its back and stands it up | Melee animations are not in the decomp (they live in the disc's data files), so the poses are ours on Melee's timing |
| the victim's hitlag shake | view only, along the launch, every 2 frames; a body drawn late (INTERP_DELAY) has its launch led by that delay, so it flies on the frame its attacker thaws | Joi: the knockback came half a second after the hit |
| Marth's frame timing (P1b, T-1024-31) | under MN_MELEE the sabre combo runs on integer frames (src/data/meleeFrames.js): hit 1 = jab 1, active 4-7 of 27; hit 2 = jab 2, 5-9 of 28; hit 3 = forward tilt, 7-10 of 35. Jab 2 runs its frame 1 on jab 1's frame 20 (SmashWiki's earliest continuable point; its quickest jab hits on 24-28); the tilt on jab 2's first actable frame 25. Before the first actable frame (26, 25, 35) the stick, the guard, the skills, the dash and the jump wait, and the stick has no control (move 0) | exact frames; Melee takes a tilt at IASA (ftCo_Attack11_IASA) |
| the jab latch (checkAttack12) | an attack press during a blow is remembered (atkLatch, also when pressed in hitlag) and links the next blow on its link frame. Melee's `jab_2_input_window` is DATA, not in the checkout: ours latches for the whole blow | the value lives in the disc's data files |
| Marth's third jab restarts jab 1 | ours goes on to the forward tilt; from rest a press is always jab 1 (no comboGap continuation under the flag) | three hits are ours |
| Melee's shield (P2, T-1024-38) | under MN_MELEE the sabre guard is Melee's shield on our stamina (60 + gear, MELEE_GUARD in src/data/lawless.js): drain 0.28 per frame held (not in shieldstun), regen 0.07 per frame while down with no delay (needs and meals still scale it), shield damage 0.7 d and no HP through, shieldstun floor((0.45 d + 2) * 200/201), hitlag on both (a shot freezes only the shield), defender and attacker slides from 06 A3 through lvx/lvz; held at least 8 frames, then 15 frames of drop lag in which only the dash and the jump work; no walking in shield; an attack press in shield does nothing (P3 makes it the grab) | the bubble covers every side (our 130 degree arc is off under the flag); no light shield, shield poke or tilt (the input is digital); the coyote RMB is a plain block |
| powershield (P2) | the shield is at most 4 frames old when the blow resolves (2 for a projectile): no shield damage and a 1-frame drop lag; a projectile goes back at 0.5x its damage (a mob bullet as the pirate's own shot, a pirate's shot with its owner flipped) | PvP reads the defender's shield age on the server when the attacker's blow arrives (the guard is not rewound): a timing read as in Melee, shifted by the latency; to measure with CMB01's RTT mode. No catch and no shock under the flag |
| shield break and dizzy (P2, P2b) | shield back to 30, then the dizzy of (400 - p) + 90 frames with mash 3 frames per input (Melee); a launching hit ends it. P2b puts a sequence of 136 frames in front of the dizzy (MELEE_GUARD.break*): 60 in the air, 26 down, 50 standing up; no mash counts in it, and the pirate cannot be hit at all (any blow, shot, circle or beam; lava still burns) for its first 117 frames, the last 19 are hittable and a launching hit ends sequence and dizzy. The view lifts the body 38 units x meleeUnit and lays it on its back (render only) | Melee's own flight, fall and get-up are game data, not in the checkout: the 26 down, the 50 stand-up and the 31 intangible frames of the stand are Ultimate's (down_bound_u, furafura_start_u, furafura_stand_whole_hit_xlu_frame); the 60 frames of flight and the 38 height are ours, inferred from shield_break_y 38, air_accel_y 0.096 and the fall cap 1.58 (28 up, 32 down; the launch speed is native code). Ultimate's recovery after the dizzy (furafura_end 34) is not ported |
| clank, the cross of blades (P2, P2b) | two pirates' sabre blows, both active, both on the ground, each inside the other's reach: a side is cancelled when own - 9 < other (integer percent); hitlag on its own damage, then ceil(0.559 * (floor d + 10)) frames of rebound that nothing cancels; the survivor lands. P2b: the cancelled fighter slides away at 0.55 Melee units per frame (after its hitlag, through the shield-slide channel). A mob's melee circle (bite, cleave, slam) clanks the same way with a pirate's active jab when the mob stands in its reach and arc (PvE damage, no pvpDmg): a cancelled circle hits nobody, a cancelled blow ends and the circle still lands, resolved before the blow lands | the 0.55 push is Ultimate's (attack_100 and attack_lw3 rebound_speed; Melee's is disc data). Bosses do not clank, nor do shells and meteors; no airborne clank; no duel event for a mob clank |
| poses keyed to frames | the rig's swing pose reads the same descriptor (windup = start - 1 frames, active, recover = total - end); the client learns the rule from WELCOME (setMeleeView) | one timeline for the sim, the prediction, the slash and the pose |
| grab and pummel (P3a, T-1025-30) | MN_MELEE sabre only: guard held + attack press; Catch 30 frames, active 7-8; grab beats shield and same-tick jab, lower entity id wins simultaneous grabs; Cala pirates and Sandbag only. Hold floor(76 + 1.6 p), mash 6 per new input; pummel 3 percent before normal damage scaling on frame 7 of 24, no launch. Timeout releases both for 29 frames with symmetric 1.2 x meleeUnit per-frame slides and 60-frame victim immunity; external damage halves and frees at 6 percent accumulated, with 20-frame no-mash flinch | body geometry uses meleeBody 0.12: circle radius 0.46872 u, midpoint offset 0.702 u, top 1.42872 u above feet (Ultimate Marth game_catch height 8, forward 4..7.7); pull 0 (motion-list cancel frame is not verified motion length). Release speed Ultimate capture_cut_speed_x, immunity invalid_capture_frame. Server-only connect; act and PLAYER_FIELDS reconcile; no throws or pistol grab |
| forward/back throws (P3b, T-1025-31) | MN_MELEE Cala pirates and Sandbag: stick magnitude >= 0.5 in CatchWait, including a held stick; pummel press wins. Ground-plane stick direction selects forward within 90 degrees, back otherwise; no up/down throws (vertical in Melee). Forward releases on 14/31 (Melee); back on 16/44 (Ultimate release, Melee total), facing flips at release. Rate 1: weight coefficient is DATA, every pirate weighs 87. Throw damage 4 through normal scaling, BKB 70, KBG 45/60, common victim weight 100; existing ground launch, tumble and release-command DI, no release hitlag. Pair stays attached until release, no timer or mash after commitment; external hits halve and flinch but never break a committed throw; hit on grabber cancels. Victim receives Ultimate 60-frame regrab immunity | threshold 0.5 is ours (Melee x98 is unnamed DATA); back script has no explicit reverse, so flip at release (ours). No bystander +3 release hitbox; poses are ours on the existing rig (Unreal actionrpg sword/skill candidates offer no paired procedural animation). No new assets/sounds. ACT 29/30 throws, 31 held Thrown; no tuple change |
| defense hub (P3c, T-1025-43) | MN_MELEE: dash button held raises the body shield at stick magnitude <0.5 on every kit; press at >=0.5 keeps the existing dash. Holding while running waits until neutral. Sabre GUARD remains an alias; pistol GUARD remains right fire when the body shield is down. Shield + attack grabs on all kits; shield + jump (jump mode on) jumps immediately without drop lag | ours: shared dash/shield input, 0.5 threshold (P3b); existing P2 shield and P3a grab gates |
| shield roll (P3c) | crossing <0.5 to >=0.5 while shielding: forward within 90 degrees of facing, back otherwise; 35 frames, intangible 4-19 forward / 4-23 back (Melee SmashWiki via 06 C2). Ground direction from stick, facing kept; no attack or shield, re-raise if still held on completion, no drop lag. ACT 32/33, shared sim prediction | ours: crossing edge (no recency timer; Ultimate escape_fb_flick_x is 4), uniform 30 Melee units x meleeUnit (Marth params have no ground-roll distance/speed; root motion lives in animation), tuck and one-turn procedural pose. Reuse existing rig; no new asset (prior Unreal sword/skill candidates do not provide this procedural body pose) |
| strings (P4, T-1025-46) | MN_MELEE sabre has no rest buffer or comboGap. Dancing Blade rejection latch: new press before open ends linking for that blow; [open, close] links at max(link, press + 1); after close drops. Jab 1 open 10, close 25, link 20; jab 2 open 6, close 24, link 25 | jab 1 open: Ultimate Marth game_attack11, src/marth_acmd/game.cpp:17-19 flag at 10 (09:25); jab 2 game_attack12:23-34 has no combo flag, so 6 = Melee hitbox start + 1, ours following Dancing Blade's pattern. Closes = IASA - 1, ours. Pistols and flag-off buffering unchanged |
| forward smash and charge (P4) | attack held at the heavy link selects smash, released selects existing tilt. Melee smash active 10-13, total 49, IASA 48, non-tip BKB 60 / KBG 70 (06:154); 3-4 charge window (06:157), holds frame 4, one extra command per charge, resumes on 5 on release or on the command reaching charge 60. Linear 1 + 0.4 * charge / 60 damage; no movement, shield, roll, dash, jump, skill or armor while charging. ACT 34 and frozen actT; CMB01 tele = (9 + charge) / 60 | cap 60 from Ultimate fighter_param.prc.txt:180 attack_s4_hold_frame; max 1.4 from :304 attack_s4_smash_hold_attack_up (Melee 1.3671 unconfirmed). :247 hold_keep_frame 120 is not used. Arc, reach, damage, step and stage-3 procedural pose are ours; same rig, no glow/sound or new assets. Reuse check: Unreal actionrpg/FINDINGS.md SK_ShortSword is a mesh, and BasicEnemy_Attack/Spinattack require a different rig; neither replaces this frame-controlled procedural pose. Snapshot fields appended; protocol bump belongs to push session |

## Decided by Joi (2026-10-24)

- The grab input: guard plus attack, as in Melee. The pistol kit has no guard (RMB fires the steel gun), so P3 must solve grab for pistols.
- The order: P1 before CMB02. P1 is split in three slices: P1a hit pipeline (hitlag on both fighters, hitstun, knockback on HP lost, DI, launch) behind MN_MELEE; P1c a training dummy (Melee's Sandbag) in solo mode to feel it; P1b frame descriptors, Marth's frame timing and poses keyed to frames. P1a, P1c and P1b are built (T-1024-09, -21, -27, -31); the lunge (Melee's dash attack, active 12-15 of 49, IASA 40) still runs on our seconds.
- The unit mapping: Melee percent is the percent of HP lost (Stamina mode, above).
- Nintendo assets: a local reference only, marked `nintendo`, never in a push (legal rule above).

Decided 2026-10-24 (T-1024-38):
- The parry is on press, as in Melee: the powershield is the first 4 frames of raising the shield (2 for projectiles). Ultimate's parry on release is not used.
- Where Melee has no number (UNKNOWN, or DATA the checkout lacks), we take Smash Ultimate's from the local dump (ficha 09) and say so in the row. Standing rule: Joi is not asked again.
- The local-dev pose loader is approved (ficha 09 section 6.1): `*.nintendo.json` poses from `C:/DEV/_refs/ssbu-nintendo`, retargeted onto our 15-bone rig, loaded only in local dev, our own pose when the file is missing.
- A second reference fighter for the unarmed kit: a brawler like Terry Bogard (Ultimate's `dolly`; his script module `lua2cpp_dolly.nro` is in the dump). With nothing equipped a pirate fights with punches: first an almost exact copy of Terry on our mesh, specials included, then we change the effects. Marth stays the sabre reference.

Still open: the venue (Cala chaos or a duel instance), from CMB01.
