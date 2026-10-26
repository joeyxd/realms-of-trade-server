# 07 - Melee CPU AI and Master Hand (T-1024-22)

How Melee's CPU fighters think, how Master Hand picks attacks, and how we port that onto our enemies. It feeds
CMB09 (Desalmado with habit and memory), CMB10 (small nemesis) and CMB11 (the enemy that is scary alone).

Conventions:
- Melee citations are `path:line` inside `C:/DEV/_refs/melee-pc/` (commit 0fb0af3). `ft/` means `src/melee/ft/`.
  `0A01` means `ft/kinds/ftCommon/ftCo_0A01.c`; `atk` means `ft/ftcpuattack.c`.
- Our citations are `path:line` in this repo.
- **Fact** = read in the decomp. **inferred** = my reading of unnamed code. **DATA** = lives in game data, not in
  code. **UNKNOWN** = not resolved here.
- Legal rule: mechanics, numbers and formulas only, in my own words. No code is copied. The decomp names almost
  everything by address (`ftCo_800B4AB0`, `x18`); the role names below are mine unless noted.
- The code level runs 0 to 9 (`types.h:1166`, "CPU level, 0-9"). The menu shows 1 to 9. I assume the menu number
  equals the code value, so there is no lv0 on the menu (inferred). Tables show lv0 for completeness.

---

## 1. Where the CPU runs and how it acts

**It writes the same input a human writes, then the normal pipeline reads it.**

| point | fact | source |
|---|---|---|
| per-fighter proc | a CPU proc runs for each fighter at priority 2 (set up with the fighter's other procs) | fighter.c:907 |
| the proc | skips sleeping fighters and non-CPU fighters, else runs the brain | fighter.c:1718-1724 |
| the brain, in order | perception and housekeeping (33B0), choose the behaviour kind (2AFC), run the behaviour (2790), step the command script (3E04), Nana mirror (0AF4), then the CPU frame counter `x7C` += 1 | 0A01:8576-8586 |
| the output | a pad struct: buttons, left stick xy, c-stick xy, L and R triggers, all signed bytes | types.h:1158-1170 |
| how it is consumed | in the same place the human pad is read: if CPU-controlled, stick, c-stick, triggers and buttons come from the CPU struct instead of the controller | fighter.c:1816-1830, 1889-1890 |
| a bot never skips an input rule | it goes through the same normalisation as a human (e.g. Z becomes shield plus A, README port plan) | fighter.c:1904-1922 |

**It does not decide every frame. It decides when its current command script is empty.**

- Behaviour dispatch only runs when the script pointer is null and the script duration is 0 (0A01:7896-7905). A
  decision counter `x80` goes up each time that happens (inferred: 0A01:7905-7909).
- A decision pushes a short script into a 256-byte buffer (types.h:1180-1183 region, `buffer[0x100]`). The script is
  a list of timed pad commands: press or release a button, set a stick axis, wait N frames, end
  (ftcmdscript.h:8-60). The executor counts the wait down one per frame and applies commands until the next wait
  (ft/ftcmdscript.c:128-215).
- So the unit of thought is a **script of 1 to about 30 frames**, and inside it the CPU is blind. Hits that land
  during a script are only seen at the next decision (inferred; the DI and shield behaviours below re-decide every
  frame because their script is a single 1-frame wait, 0A01:5660-5668).
- Two clocks exist: `x7C` counts frames and gates things by `x7C % N` (alertness, DI, mash); `x80` counts
  decisions and gates attack permission.
- Randomness: the global RNG `HSD_Randf` (a replay-affecting source, not part of our sim). Our port replaces it with
  the seeded sim RNG (section 8).

**Behaviour layers, top to bottom** (this is the structure we port):

| layer | role | source |
|---|---|---|
| CPU kind (`cpu.kind`) | the per-CPU mode that Adventure and Event set: picks which handler runs this frame (section 5) | 0A01:8034-8400; forward.h:455-490 |
| behaviour id (`cpu.x18`) | what the CPU is doing now (attack, defend, recover, DI, grab...); switched by an arbiter (section 4.3) | 0A01:6056-6422, 7896-8030 |
| command script | the timed pad presses that carry out one behaviour step | ft/ftcmdscript.c:128 |

---

## 2. CPU levels: every knob that changes with level

Rows are the knobs I found. Cells are exact values where the code gives a table; `-` means the level has no entry.
`r` is a uniform random number in [0,1). Frames are 60 Hz, the same as our tick.

### 2.1 Reaction and timing

| knob | lv0 | lv1 | lv2 | lv3 | lv4 | lv5 | lv6 | lv7 | lv8 | lv9 | source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| wait before launching an attack, frames | 5..44 | 5..39 | 5..34 | 5..29 | 0..24 | 0..19 | 0..14 | 0..9 | 0..4 | 0 | atk:857-889 |
| shield or reflector hold delay after the trigger, frames (9 - lv) * (4..7) | 36..63 | 32..56 | 28..49 | 24..42 | 20..35 | 16..28 | 12..21 | 8..14 | 4..7 | 0 | atk:2362-2370, 2536-2548 |
| down-stick tap wait (inferred: drop through a platform), frames | 45 | 30 | 30 | 15 | 15 | 10 | 10 | 5 | 5 | 1 | 0A01:455-485 |
| incoming-hit alertness: fraction of time the defend check is on (frame `x7C` mod 120 above a limit) | never | never | >100 = 16% | >80 = 33% | >60 = 49% | >40 = 66% | >30 = 74% | >20 = 83% | >10 = 91% | always | 0A01:2877-2925 |
| attack permission: fraction of decisions allowed (`x80` mod M above a limit) | M=300, >240: 20% | M=300, >180: 40% | M=300, >120: 60% | M=240, >120: 50% | M=240, >60: 75% | always | always | always | always | always | atk:1670-1700 |
| predicted frames ahead when judging a projectile | 10..29 | 10..29 | 10..29 | 5..14 | 5..14 | 5..14 | 3..7 | 3..7 | 3..7 | 1 | atk:2711-2727 |

Notes. The attack wait is applied right before every melee attack is launched (atk:940-975), so it is the CPU's
reaction time: a lv9 CPU launches the frame the choice is made, a lv0 CPU can stand 5 to 44 frames first. The
alertness gate decides whether the defend check runs at all; at lv0 and lv1 the CPU never reacts to an incoming
blow (0A01:2877-2890).

### 2.2 Stick, movement and skill

| knob | lv0 | lv1 | lv2 | lv3 | lv4 | lv5 | lv6 | lv7 | lv8 | lv9 | source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| stick step per frame | 1 | 2 | 2 | 2 | 2 | 2 | 4 | 4 | 8 | 8 | 0A01:4759-4812 |
| stick clamp (127 = full) | 67 | 72 | 77 | 82 | 87 | 92 | 97 | 107 | 117 | 127 | 0A01:4759-4812 |
| recovery stick strength 4.7 * (lv + 1) + 80 | 85 | 89 | 94 | 99 | 103 | 108 | 113 | 118 | 122 | 127 | 0A01:4553-4556 |
| skill scale `x570` = 0.05 (lv + 1) + 0.05 r, redrawn every 30 frames | .05-.10 | .10-.15 | .15-.20 | .20-.25 | .25-.30 | .30-.35 | .35-.40 | .40-.45 | .45-.50 | .50-.55 | 0A01:8390-8400 |
| attack-box scale used in attack choice 0.5 + 0.5 * skill | .525-.55 | .55-.575 | .575-.60 | .60-.625 | .625-.65 | .65-.675 | .675-.70 | .70-.725 | .725-.75 | .75-.775 | atk:162-376 (the `halfRange` step) |
| flag redrawn every 300 frames with chance 0.04 lv + 0.3 | 30% | 34% | 38% | 42% | 46% | 50% | 54% | 58% | 62% | 66% | 0A01:8434-8440 (purpose UNKNOWN) |

The skill scale shrinks the box in which the CPU thinks a move will connect. A low-level CPU judges its reach as
about half the real box, so it swings late and short; a lv9 CPU uses about three quarters (inferred: the scale
multiplies the move's window half-extents).

### 2.3 Defence, escape and recovery

| knob | rule | lv0 | lv5 | lv9 | source |
|---|---|---|---|---|---|
| DI active window: `x7C` mod 120 above 120 - 12 lv | share of time DI is steered | 0% | 50% | 89% | 0A01:5635-5641 |
| DI direction | stick set from the knockback vector, mirrored by its x sign. Retail has an x and y swap bug here; the PC port notes it | - | - | - | 0A01:5645-5667 |
| tech/air-dodge press chance on entering the hit behaviour | pressed when 0.1 lv > r | 0% | 50% | 90% | 0A01:6185-6195 |
| mash out of a grab or capture: every 3rd frame, stick flips with chance 0.1 lv | per 3 frames | 0% | 50% | 90% | 0A01:5560-5568 |
| mash out of a barrel: every (10 - lv) * 5 frames, 50% | A tap | every 50 | every 25 | every 5 | 0A01:5583-5590 |
| roll away when flagged, per decision, 0.05 lv | chance (the flag is UNKNOWN) | 0% | 25% | 45% | 0A01:5206-5210 |
| close in, retap A instead of stepping away, 0.1 lv | chance (context UNKNOWN) | 0% | 50% | 90% | 0A01:5703-5712 |
| retap R instead of A when near, 0.1 lv | chance (context UNKNOWN) | 0% | 50% | 90% | 0A01:5750-5760 (test at 5756) |
| Nana (Ice Climbers partner) level | percent of the leader / 20, capped at 9 | - | - | - | 0A01:7557-7563 |

### 2.4 Hard level gates (a feature exists or not)

| gate | value | source |
|---|---|---|
| each entry in a character's attack list has a minimum level; a move is skipped if its min level is above the CPU's | min level is DATA per entry | atk:238, 454, 648 |
| a separate attack list against a shielding target is used only above lv5 | lv6 and up | atk:1877 |
| climbing to platforms by a jump needs lv4 or more | lv4 and up | atk:1273 and 1724 (the `level < 4` tests) |
| the behaviour at motion 0x26 (a state I could not name) turns on only at lv5 | lv5 and up | 0A01:5377-5380, 6293-6296 |
| Ness's PK Thunder recovery (the aimed one) | lv9 only | 0A01:4249-4252 |
| the fast-fall and stick-based recovery tweak | lv9 clamp | 0A01:5398 |
| character specials in grab follow-ups: Ice Climbers, Fox, Captain Falcon above lv4 at 0.05 lv; Mario below lv5 | per fighter | atk:1090-1120 |
| Ness absorbs projectiles only above lv3 | lv4 and up | atk:2715-2724 |

Not found: any level knob that scales speed, damage or HP. The CPU plays the same fighter as a human; only the
input quality changes (stick, delay, attention, chance gates). That is a design lesson for us (section 9).

---

## 3. Attack choice (ftcpuattack.c)

### 3.1 The decision steps, in order (the function that finds the move: atk:1730-1931)

| # | step | what it does | source |
|---|---|---|---|
| 1 | flag gate | no attack thinking unless the "may attack" flag `xF9_b2` is set | atk:1748 |
| 2 | reset queues | clears the white list (defend queue) and the black list (attack queue) for this decision | atk:1752-1753 |
| 3 | hard rejects | no target; own state is a pass-through; target is untargetable (A1C44, role UNKNOWN); the level attack-permission gate (section 2.1); another reject (A1CA8, UNKNOWN) | atk:1754-1756 |
| 4 | target-state black list | if the target is grabbing or escaping (Catch to EscapeAir motions), or is bigger than us, two moves (ids 0x28, 0x29) go on the black list (inferred: the grab and the throw-type moves are pointless then). Kirby also drops id 0x11 | atk:1758-1798 |
| 5 | extra queue edits | a call that adds more entries (B77E8, not read: UNKNOWN) | atk:1800 |
| 6 | airborne | if we are in the air and an air-approach test passes, pick from the **air list** (table x8) and stop | atk:1801-1813 |
| 7 | target hanging or on the ledge | white-list moves 0x0A and 0x0E (ledge attacks), pick from the **ground list** (x4), stop | atk:1815-1836 (test at 1815) |
| 8 | holding a weapon item | pick from the **item list** (x18) with the weapon's reach (a per-item reach number, DATA) | atk:1837-1876 (reach switch at 1842-1864) |
| 9 | target shielding (above lv5) | pick from the **shield-breaker list** (x10) | atk:1877-1888 |
| 10 | target on solid ground, we hold nothing | pick from the **approach list** (x1C), mark the choice as an approach | atk:1889-1916 (test at 1901) |
| 11 | default | pick from the **ground list** (x4) | atk:1910-1917 |
| 12 | thrown-item list | if an item target exists, pick from list x14 | atk:1918-1927 |

The lists are per fighter kind and are indexed through a table (`Fighter_804D64FC`, atk:1873, 1893). Their
contents (windows, weights, minimum levels) are **DATA**: UNKNOWN here. A later step may use a different list
for ranged attacks (3.3).

### 3.2 How one list is searched (atk:162-376)

For each entry in the list (an entry has: command id, lead time, a front/back horizontal window, a lower/upper
vertical window, a weight, a period, a minimum level; struct in ft/ftcpuattack.h:13-23):

1. Skip if the entry's minimum level is above the CPU level (atk:236-241).
2. Skip if the command is on the black list (atk:242-255).
3. Predict both fighters after the entry's lead time `t` (frames): positions by current velocity, and for airborne
   fighters by gravity capped at terminal velocity. Take the relative x and y (atk:257-318).
4. Build the move's reach window in our facing, scaled by our model scale and by the skill scale of 2.2.
5. The move qualifies only if the target's predicted body box overlaps that window (the target's own front, back
   and height numbers are used) (atk:319-327).
6. If a white list is active, the entry must be on it (atk:329-335). Otherwise it must pass the period test:
   the decision counter `x80` is a multiple of the entry's period (atk:336-343). This is how rare moves are rare.
7. Collect the survivors, add their weights, draw one by weighted random. If all weights are about 0 the choice
   fails (atk:347-376).
8. A selected move is launched through the attack executor, which first waits the level reaction delay
   (section 2.1, atk:940-975).

Properties worth copying:
- **Range is a predicted overlap, not a distance threshold.** Fast and moving targets are handled by the lead
  time.
- **Weights plus period gates** give variety and keep strong moves rare.
- **The black list reacts to the target's state** (grabbing, escaping): fixed rules, not learning.

### 3.3 Other offence

| piece | rule | source |
|---|---|---|
| ranged attack (behaviour 3) | 25% of the time skip; skip if closer than 30 units; only fire if the line to the target is within about 5 degrees of horizontal; characters like Ness, Yoshi, Samus have custom branches; otherwise a generic ranged list (table xC) | atk:2266-2347 |
| platform approach (behaviour 8) | when the target is above on a platform, jump toward it; needs lv4 | atk:1179-1316 |
| grab follow-up (behaviour 9) | after a grab: pummel with chance 0.5 / (1 + n) for the n-th pummel, else throw, with per-character exceptions | atk:1003-1180 |
| edgeguard, recovery, punish | no separate "edgeguard" module in the files I read. Recovery is its own behaviour (4) in 0A01:4249-4830 (UNKNOWN beyond stick strength). "Punish" is the generic list search with short lead times (inferred) | 0A01:7896-8030 |

---

## 4. Defence

### 4.1 Detecting an incoming hit (atk:2895-2963 and helpers)

Defend mode asks "will anything hit me next frames":

| source of threat | test | result code | source |
|---|---|---|---|
| an opponent's active hitbox (up to 4) | the hitbox's motion over the last frame is extended 3 frames forward; if that line hits the CPU's body capsule, threat. Ignores grab hitboxes and inert ones | 1 | atk:2632-2662 |
| an opponent's special moves that act like a hit (Bowser's and Yoshi's down specials, Samus up special) | position and motion tests | 1 | atk:2812-2893 |
| an item or projectile hitbox | the hitbox is extended `count` frames forward (count by level, 2.1) and tested against the body; ignores own or allied items | 2 (3 for Ness's absorb case) | atk:2680-2810 |

Only the first threat found is used. It is stored with the threatening fighter or item.

### 4.2 Choosing the reaction (atk:2560-2632)

| situation | reaction | source |
|---|---|---|
| already in a roll, spot dodge or air dodge | finish it | atk:2574-2578 |
| already shielding (motion 0xB2) | hold R for (9 - lv) * (4..7) frames (2.1) | atk:2579-2582, 2356-2376 |
| no threat | release R and B, go back to the previous behaviour | atk:2583-2591 |
| airborne, Fox or Falco, code 2 | use the down-B move (Fox and Falco's down special is their reflector, the decomp calls it a blaster: inferred) | atk:2592-2597, 2534-2548 |
| airborne, other, code 3 | Ness-style absorb (down-B) | atk:2598-2600, 2377-2392 |
| airborne, other | tap R (air dodge) | atk:2600-2602 |
| grounded, code 2 (a projectile) | bouncer items and cannons use shield or dodge, Fox or Falco 50% reflect (down-B) else shield; others shield | atk:2603-2625 |
| grounded, code 1 (a blow) | for code 3 the absorb; if the attacker is not known, shield; otherwise an escape pick between a roll to either side and a spot-dodge style move based on the room and the attacker side | atk:2626-2632, 2426-2492 |
| shield-hold after the threat | released when the threat flag clears (next decision) | atk:2583-2591 |

Findings:
- **There is no powershield timing code.** The CPU holds R (the trigger value goes to full on the press) when the
  threat is detected; the powershield window is the normal game rule on the first frames of the shield
  (README, 02-defense-parry.md). A CPU whose threat check fires on the frame before contact gets a powershield by
  accident. With the 3-frame look-ahead (4.1) and the reaction delay of 0 at lv9, a lv9 CPU powershields often;
  low levels never do. This is **inferred** from the structure, not read as a rule.
- The reflector exists only as the Fox and Falco down-special branch (and Ness's absorb). The rest only shield or
  dodge.
- The roll away uses two scripts: tap R with a full stick to one side, wait 2 frames, release, wait 5 (atk:2398-2425).

### 4.3 Behaviour arbiter (0A01:6056-6422)

The priority list that picks `x18` each time the previous behaviour is not mid-script. First match wins. Role
names are inferred from the handler and the motion ids; the ids come from the source.

| order | behaviour id | role | trigger | source |
|---|---|---|---|---|
| 1 | 0x12 | hit reaction: DI and tech | the hurt state flag `x221A_b3`; the tech roll is `0.1 lv > r` (2.3) | 0A01:6179-6200, 5618-5675 |
| 2 | 0x11 | barrel mash | in a barrel | 0A01:6204-6212, 5593-5616 |
| 3 | 0x13 | state with motion ids 0x131/0x132 (UNKNOWN) | those motions | 0A01:6215-6229 |
| 4 | 5 | state tied to A3134 (UNKNOWN; used when the target is ledge-hanging too) | A3134 true | 0A01:6231-6250, 5676-5700 |
| 5 | 6 | ledge hang and getup | cliff states | 0A01:6253-6270, 5700-5750 |
| 6 | 9 | grab follow-up | we hold someone | 0A01:6273-6281; atk:1003 |
| 7 | 4 | recovery | A2C80 (off stage), UNKNOWN details | 0A01:6282-6290, 4249-4830 |
| 8 | 15 | shield hold at motion 0x26, needs lv5 | lv5 and up | 0A01:6292-6306, 5341-5420 |
| 9 | 16 | grab mash-out | capture motions | 0A01:6308-6326, 5550-5575 |
| 10 | 7 | defend | the alertness gate (2.1) and a threat found | 0A01:6327-6339; atk:2560 |
| 11 | 3 | ranged attack | B9CBC | 0A01:6340-6347; atk:2266 |
| 12 | 2 | melee attack | B8A9C | 0A01:6349-6356; atk:1730, 899-975 |
| 13 | 8 | platform approach | B732C | 0A01:6358-6364; atk:1228 |
| 14 | 13, 14 | hold or pick up an item | item states | 0A01:6366-6412 |
| 15 | 10 | forced queued behaviour | `x20` set by a mode | 0A01:6414-6420 |
| 16 | 0, 1 | default / approach and idle walking | nothing else | 0A01:7960-8030, 5293-5326 |

The order is the lesson: **survive first (DI, tech), then escape (ledge, grab), then defend, then attack, then
approach.** Defend is above attack, so a CPU that sees a hit coming does not start its own move.

---

## 5. CPU behaviour types (`cpu.kind`)

The per-CPU mode field (`CpuKind`, forward.h:455-490, 27 entries 0 to 26 at least) is only numbered in this
decomp, and the handler dispatch is 0A01:8034-8400. The names the user remembers (stay, escape, jump, normal) are
**not in the source here**; the numbers come from the game's CPU-type setting. Adventure and Event setup is not in
the sparse checkout (section 7), so the meaning of each id is **UNKNOWN**; the table lists what each handler does.

| kind | handler | what the handler does (read) | source |
|---|---|---|---|
| 0, 1, 3 | inline | find the floor below, snap the "ground point" there, then the arbiter. Used as the normal fighting CPU (inferred) | 0A01:8039-8150 |
| 2 | 04DC | seek and use items (uses an item target) with the arbiter | 0A01:7186-7260 |
| 4, 11, 12 | 24B8 | stage hazard check, then nearest enemy, then the arbiter | 0A01:7869-7895 |
| 6 (Nana) | 101C | follows the leader; level from the leader's percent (2.3) | 0A01:7533-7583, 7557 |
| 7, 8, 9, 10, 17, 18, 19-22, 24 | AF290, AECF0, B00F8, AFC40, B17D0, AF78C, AFE3C(n), 1DA0 | same shape: hazard check then react (E7AC), nearest enemy (A5CE0), arbiter; kinds 19 to 22 pass a variant number 0 to 3 | 0A01:6640-7075, 7665-7795 |
| 13 | 126C (case at 8241) | stands, once a second with 50% chance does a small action (A866C or A8940) | 0A01:7584-7612 |
| 14 | 1478 | nearest-enemy style, with the 400-frame coin flip handled in the arbiter | 0A01:7614-7664, 6161-6175 |
| 15 | direct | sets behaviour 0 and does nothing (a CPU that stands) | 0A01:8247-8249 |
| 16 | - | no case: falls through to the end (inferred: no brain) | 0A01:8034-8400 |
| 23, 25, 26 | inline | target the enemy then the arbiter, 26 also snaps to the floor | 0A01:8315-8400 (kind 26 at 8315; 23 and 25 just before) |
| 27 and up | - | not read | UNKNOWN |

The arbiter has a kind test: kind 14 flips a 50% coin every 120 frames, other kinds every 400 frames
(0A01:6161-6175; purpose UNKNOWN).

---

## 6. Master Hand

Master Hand is a **boss CPU**: a fighter in the boss slot type, run through his own state machine, not the CPU
arbiter. The CPU level is fixed to 1 on spawn (`ft/kinds/ftMasterHand/ftmasterhand.c:643`). Difficulty acts on
the HP and the data, not on the level (6.4).

### 6.1 The idle step and the timer

| piece | fact | source |
|---|---|---|
| waiting state | in the waiting state a counter `x223C` counts down each frame; at < 0 the attack is chosen | ftmasterhandwait10.c:222-224 |
| the counter reset | `(x18 / level + Rand(x20 - x1C) + x1C) / x2238` frames, where x18, x1C, x20 are DATA (the hand's ext attributes), `level` = 1, `x2238` = 1 | ft/ftbosslib.c:36-47; ftmasterhand.c:639-648 |
| `x2238` never changes in the Master Hand or Crazy Hand files (grep) | the divisor is a constant 1 here | ftmasterhand.c:639, ftcrazyhand.c:641 |
| human-player mode for debugging | with the player slot type 0, L or R plus a d-pad direction starts a chosen attack | ftmasterhandwait10.c:366-420 |
| the hand drifts toward the nearest fighter | a velocity step clamped by a per-attack number; the chase target is the nearest opponent | ftbosslib.c:88-121, 152-162 |

### 6.2 Choosing the attack (ftmasterhandwait10.c:165-285)

Two draws: a **category**, then an attack inside it.

Categories and their attacks (the table at 165-180; the labels are the comments in the switch at 285-340):

| cat | attacks (the decomp state names with the comment label) | count |
|---|---|---|
| 0 | Slap ("Sweep"), SweepLoop ("Stage-Wide Slap"), WalkLoop ("Walk") | 3 |
| 1 | RockCrushUp ("Punch"), PaperCrush ("Ground Slap"), Poke1 ("Poke"), Drill | 4 |
| 2 | BackPunch ("Ram"), BackCrush ("Crush"), BackAirplane1 ("Jet") | 3 |
| 3 | FingerBeamLoop ("Lasers"), FingerGun2 ("Gun") | 2 |
| 4 | Throw ("Grab"), Slam ("Grab") | 2 |

Category draw (rows are the previous category, 5 slots each, one drawn uniformly):

| previous | slots | meaning |
|---|---|---|
| 0 | 1, 2, 3, 4, 0 | each category 20%, repeat of 0 allowed |
| 1 | 0, 2, 3, 4, 0 | cat 0 has 40%, no repeat of 1 |
| 2 | 0, 1, 3, 4, 0 | cat 0 has 40%, no repeat of 2 |
| 3 | 0, 1, 2, 4, 0 | cat 0 has 40%, no repeat of 3 |
| 4 | 0, 1, 2, 3, 0 | cat 0 has 40%, no repeat of 4 |

Source: the 30-entry table at ftmasterhandwait10.c:165-180 and its use at 261-272.

A guard counter `x2254` counts draws since the last category 2. When it reaches `da->x24` (DATA) the next category
is forced to 2 and the counter resets (261-264); a natural category 2 also resets it (267-269). The attack inside
the category is `Randi(count)` from the category's slice (275-279). Master Hand starts as "previous = category 0"
and with the counter 0 (ftmasterhand.c:639-642).

Combos: the hand has no multi-attack combo logic in this file. The Crazy Hand tag attack is the only chained
case: when Crazy Hand is in its rock-paper state, Master Hand follows with a matching move chosen from Crazy
Hand's state (228-258). Both hands read each other (`ftBossLib_8015C4C4`, ftbosslib.c:254-262).

Not an AI input: HP, distance or timers are **not** used to choose. The only conditions are the previous category,
the forced-category counter, the input-disabled flag (a disabled hand waits instead, 281), and stage 251 which
enters directly (ftmasterhandwait10.c:128-163). HP-based change is UNKNOWN in these files (no read of
`dmg`/stamina in the chooser).

### 6.3 Telegraph and timing

| attack | what drives the timing | frames |
|---|---|---|
| all of them | the animation: the telegraph is the wind-up pose; hit timing is in the animation's script (DATA) | UNKNOWN (DATA) |
| Poke | the hand repeats the poke loop a random number of times: `x94 + Rand(x90 - x94)`, then ends with a final poke | count is DATA; ftmasterhandpoke.c:29, 36-48 |
| Lasers (finger beam) | the aim point is randomised in a box (`xC4` plus or minus `xCC` on x and y, DATA) | ftmasterhandwait10.c:309-316 |
| Gun (finger gun) | a random count between two DATA numbers | ftmasterhandfingergun.c:55 |
| Walk, Drill, Punch, Ground Slap, Ram, Jet, Crush | entry at a DATA start position, then a velocity-clamped chase of the target | wait10.c:293-332; ftbosslib.c:88-121 |

The real frame data (wind-up, active, recovery) sits in the animation scripts, which are **not** in this
checkout. The telegraph is always a body pose and the move's own sound/effect; there is no HUD telegraph.

### 6.4 Difficulty

| lever | fact | source |
|---|---|---|
| boss HP | by difficulty index (0 to 4, else the default) a value from the hand's ext attributes (x0, x4, x8, xC, x10, x14, DATA) is set as the boss stamina | ftbosslib.c:267-293; gm/gm_17C0.c:242-243 |
| attack gap, forced-2 interval, poke count, laser box | per-hand DATA, not per difficulty in code | ftmasterhandwait10.c, ftbosslib.c:36 |
| AI level | fixed at 1 | ftmasterhand.c:643 |

So Master Hand gets harder through **HP and data**, not through smarter or faster decisions (inferred).

---

## 7. Gaps

| gap | detail |
|---|---|
| Adventure and Event enemies | Goombas, ReDeads, Fire-Flowers and the like live under `src/melee/it` (and `gm` setup), which this sparse checkout does not hold. Only their CPU-type ids (section 5) are seen from the fighter side |
| `Fighter_804D64FC` tables | per-fighter attack lists (windows, weights, minimum levels, reach, ranged table xC), DATA, not in code: UNKNOWN |
| `CpuKind` meanings | which kind id means stay, escape, jump, normal in the menu or in Adventure: UNKNOWN |
| behaviour ids 5, 0x13, 15 | their trigger motions (0x26, 0x131/0x132) have no name here: UNKNOWN |
| `B77E8`, `A1C44`, `A1CA8`, `A2C80`, `A3134`, `xF8_b6` | roles inferred only |
| powershield by the CPU | no explicit rule. Frame-perfect response is inferred from the look-ahead and delay (4.2) |
| tech and ledge-getup choice | partial. The air-dodge and R press at the hit state is seen (2.3); the ground tech choice (in/left/right) is not isolated |
| Master Hand attack frames | wind-up, active and recovery are in animation scripts, not in code: DATA |
| Master Hand HP changes | no HP-based branch seen in the chooser or the states I read: UNKNOWN |
| gm setup of CPU level/kind | `Player_GetCpuType` and `Player_GetCpuLevel` come from `pl/player.c:804` and the match setup (not read) |

---

## 8. What Melee does not do, and our proposal

**Melee does not learn.** The CPU has no memory of the opponent beyond the current frame: target selection is
"nearest" (0A01:2438, 5CE0), the black list is a fixed function of the target's current state (3.1), and the only
random numbers are fresh draws. There is no per-opponent record. Learning-and-copying fighters are a later
series' idea (amiibo); we do not port it, we design our own.

### 8.1 Habit memory (proposal)

Every enemy that has it (flag `def.habit`) keeps a small record per pirate it fights. Sim-side, plain arrays.

| field | what it counts | how it is read |
|---|---|---|
| `fav[k]` | counts of which attack the pirate uses first against this enemy: sabre string stage, dash attack, shot, heavy (k = 0..5) | the enemy expects the favourite, so it guards or steps back before the first hit of the string lands |
| `dashDir` | after the pirate's guard-block, the dash direction (4 buckets: toward, away, left, right) | the enemy's counter-pick aims the follow-up at the most common bucket |
| `parryRate` | an exponential average of "this pirate raised a perfect guard against my shot", over the last 8 shots | the enemy switches shot type: more `unstop` when the pirate parries a lot, more `parry`-typed bait when they do not |
| `keepDist` | an average of the pirate's distance when the enemy attacks | the enemy chooses range bands, closer to that distance if the pirate stays far, to punish kiting |
| `lastChain` | the last 3 inputs the pirate used in a string | the enemy answers the most recent repeated string with the matching guard window |

**How a counter-pick uses it (a bias, not a mind-read):**
1. `chooseAttack` (enemies.js:145) builds the legal list as today.
2. Each entry gets a **habit score** from the record (for example: an attack that beats the favourite gets +w).
3. The final pick is a weighted draw, with habit as one multiplicative term (a clamp of 0.5 to 2.0), so the enemy
   is never certain, just warier.

**Decay.** Every number is an exponential average with a half-life of about 600 ticks (10 s) of that fight; on a
fresh fight (no hit exchanged for 20 s) the record multiplies by 0.5; after 5 minutes it is deleted. This keeps a
small nemesis (CMB10) from being permanent and avoids punishing a changed style forever.

**Determinism and cost.**
- Only integer counters and exponential averages updated by tick; all draws use the world's seeded RNG
  (`world.rng`, src/sim/world.js:43) and the hash used for shots, never `Math.random`.
- Updates happen on events the sim already has (a pirate's hit, guard, dash). No scanning.
- Storage: per enemy, per pirate in the fight, about 20 numbers; a cap of 4 pirates per enemy (the nearest ones),
  evicting the oldest. At 40 enemies that is a few thousand numbers.
- The record is **server-only** and not in the snapshot; the client sees only the enemy's choices.

---

## 9. Port to ours

### 9.1 Rule to code map

| Melee rule | ours today | change | files |
|---|---|---|---|
| input from a pad struct, same pipeline as a human | enemies steer and fire directly (steer, fire); pirate bots produce commands (bots.js:15-47) but only wander waypoints; the Desalmado is a normal enemy (data/enemies.js:130-150), there is no bot that answers melee in src/sim/systems/bots.js | none now. A later slice may let Desalmados emit pirate commands so they use guard, dash and parry for real | enemies.js:158; bots.js:15; data/enemies.js:130 |
| decide on script ends, with a level delay | one timer `b.gcd` and fixed wind-ups (enemies.js:257-296) | add a level reaction delay `rt` before a windup starts or a guard opens | enemies.js:257-280 |
| weighted choice among legal moves, with a period | `chooseAttack` takes the first entry that fits, by order, with a timer for `every` (enemies.js:145-156) | weights and a habit term: a weighted pick among fitting entries | enemies.js:145-156; data/enemies.js attack entries |
| predicted overlap, not a distance threshold | `minD/maxD` ring on the current distance | use the target's velocity times the windup to predict the distance at fire time | enemies.js:145-156, 257-280 |
| defend above attack | no defend branch; the sentinel and boss never react to a swing | add a threat check (hit capsule or shot ahead) with level alertness | enemies.js new; combat.js:285-393 for the player rules |
| shield or reflect on a projectile | the player has parry, perfect guard and reflect (combat.js:315-393, 377); no enemy does | enemy guard opens on a shot aimed at it; reflect only for kinds that carry a shield | combat.js:315-393 (reused rules); boss.js:46-60 (boss shield flag) |
| DI and tech | no knockback steering by the victim | not now. Enemies get no DI at lv<=6 (README lets players DI) | - |
| mash out of a grab | no grab yet (P3) | when P3 lands: `mashChance` per 3 ticks | CMB later |
| black list by the target's state | none | a few rules: no heavy while the pirate is in guard-break, no shot while he is mid-dash | enemies.js:145 |
| Master Hand: category then attack, no repeat, forced special | boss is a fixed cycle per phase plus a heavy on its own timer (boss.js:100-123) | give each phase 3 categories (melee zone, shot, space-control) and draw by the Master Hand table; forced "back" category every N draws | boss.js:100-123; data/enemies.js:88-90 |
| boss gap timer `(base/level + Rand(range))` | `P.gap` fixed (boss.js:96) | `gap + rng` by AI level | boss.js:96 |
| no learning | none | habit memory (section 8) | enemies.js; world.js |

### 9.2 What stays

- Our telegraphed bullet-hell attacks are the enemy's attack language: patterns typed `parry`, `unstop`, `heavy`,
  aoe circles, mortar, lasers (data/enemies.js:14, 25, 27, 93-108). They are not replaced by Melee moves.
- The wind-up as the telegraph (enemies.js:281-289, "tracks 60% of the wind-up then commits") stays: it is our
  equivalent of Melee's wind-up pose.
- The boss phase thresholds and the enrage stay (boss.js:46-60).
- The enemy count and HP stay as data.

### 9.3 Proposed AI level knob

One field `ai` per enemy def, or per spawn, 0 to 9. Defaults are proposals (no tuning beyond them).

| field | lv1 | lv3 | lv5 | lv7 | lv9 | note |
|---|---|---|---|---|---|---|
| `reactTicks`: delay before a windup or guard, ticks | 40 | 24 | 14 | 6 | 0 | the atk:857 curve, rounded |
| `alert`: fraction of time the threat check runs | 0 | 0.33 | 0.66 | 0.83 | 1 | 0A01:2877 shape |
| `parryChance`: chance to guard a detected melee blow or shot | 0 | 0.2 | 0.5 | 0.75 | 0.9 | new; Melee has no number |
| `reflectChance`: chance to send a reflected shot back, once guarding | 0 | 0 | 0.15 | 0.35 | 0.6 | kinds with a shield only |
| `aimErr`: error on aimed shots, degrees | 14 | 9 | 5 | 2 | 0 | from the stick step idea (stick clamp 67 to 127) |
| `habit`: memory on or off | off | off | off | on | on | section 8 |
| `weightBias`: how strongly the weighted draw prefers the counter | 0 | 0 | 0.5 | 1 | 1.5 | clamped as in 8.1 |

Design rule from Melee: **do not raise speed, damage or HP with the level.** Only reaction, attention and choice
quality change (2.4).

### 9.4 Slices (small, in order)

| # | slice | acceptance test |
|---|---|---|
| 1 | AI level field and reaction delay: `ai` on the def, `reactTicks` before the windup of every enemy attack; default keeps today's behaviour at lv5 | a sim test: the same enemy at ai 1 and ai 9 starts its first windup at least 30 ticks apart; ai 5 equals the current ticks |
| 2 | Weighted attack choice with the period rule: `chooseAttack` draws among fitting entries by weight, keeps the `every` timers | a sim test with a seeded RNG: 10,000 draws on the archer entries give the weights within 3%; same seed gives the same sequence |
| 3 | Threat check and enemy guard: detect a shot or swing aimed at the enemy, open a guard by `alert` and `parryChance`, using the player's guard numbers | a test: a perfect-timed player shot is guarded by an ai-9 enemy in at least 85% of 200 seeded trials and by an ai-1 enemy in 0% |
| 4 | Enemy reflect on projectile for shielded kinds (boss, Desalmado), by `reflectChance` | a test: a parry-typed shot at a shielded enemy returns as an enemy-owned shot in the share set by `reflectChance` (within 5%); heavy shots still follow the heavy rule |
| 5 | Master Hand style boss draw: three categories, no repeat, forced category, gap by ai | a test: 1,000 draws never repeat a category except the zero case; the forced category appears at the set interval; same seed, same sequence |
| 6 | Habit memory (CMB09): the record, decay, the bias in the draw | a test: a scripted pirate who always opens with the sabre string makes the enemy guard that string in at least 70% of trials after 10 fights, and the record is gone 5 minutes after the last hit; a replay with the same seed is identical |

---

## Appendix: Melee cheat sheet for the port

| need | Melee answer | section |
|---|---|---|
| how fast does a good CPU react | 0 frames at lv9; 5 to 44 at lv0 | 2.1 |
| how does it pick a move | a weighted draw among moves whose predicted reach overlaps the target | 3.2 |
| what does it do first | survive, then escape, then defend, then attack | 4.3 |
| how does Master Hand choose | previous category sets the next; never the same twice; forced "back" attack every N | 6.2 |
| does it learn | no | 8 |
