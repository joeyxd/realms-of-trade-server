# 09: Smash Ultimate as a local reference (T-1024-36, 2026-10-24)

Joi owns Super Smash Bros. Ultimate and ran it as a native PC port (the OpenSmash-Ultimate recompilation, built from
Joi's own 13.0.4 dump). That port ships tools that read the game's archive and turn its move scripts into readable
source. This ficha says what we took, where it is, and what it adds to the Melee plan.

**It is Ultimate, not Melee.** It does not fill the `DATA` holes of fichas 01-06: those are Melee values, from a
different game. What it gives:
- Ultimate's own numbers, read from the game's bytes (confidence H for Ultimate), as a second opinion where Melee
  has only a wiki figure or nothing.
- What the Melee checkout lacked: the real animations, skeleton and model, so a pose can be looked at frame by frame.
- Readable move scripts (hitboxes, effects and sounds per frame) and the shared state machine of grab, shield and throw.

**Legal rule, unchanged** (README above): everything Nintendo-derived lives in `C:/DEV/_refs/ssbu-nintendo/` and never
enters the repo (`*nintendo*` is ignored). We copy numbers, timings and rules into our own JS; never code, models or
animations. Citations below resolve inside that folder. How to regenerate or pull another fighter: its README.md.

## 1. Marth's frame data, Melee next to Ultimate

Frames are 1:1 with our ticks. Ultimate rows: hit or grab window from `src/marth_acmd/game.cpp`, total from the
motion list cancel frame (`marth_motion_list.txt`, third `extra` byte). Melee rows: ficha 06 section B.

| move | Melee active / total | Ultimate active / total | Ultimate strongest hitbox (dmg, angle, KBG, BKB) |
|---|---|---|---|
| jab 1 | 4-7 / 27 | 5-6 / 26, combo flag on 10 | 5, 180 (sword tip, fighters only) and 361, 12, 30 |
| jab 2 | 5-9 / 28 | 4-5 / 29 | 6, 45, 75, 62 |
| forward tilt | 7-10 / 35 | 8-11 / 34 | 12 (tip), 361, 85, 55 |
| forward smash | 10-13 / 49 | 10-13 / 52, charge from 3 | 18 (tip), 361, 80, 80 |
| dash attack | 12-15 / 49 | 13-16 / 50 | 13, 45, 58, 93 |
| standing grab | 7-8 / 30 | 6-7 / 35 | grab boxes at height 8, reach 4 to 7.7 |
| dash grab | 10-11 / 40 | 9-10 / 43 | reach 4 to 9.4 |
| pivot grab | UNKNOWN | 10-11 / 38 | |
| pummel | hit 7 / 24, 3% | hit 1 / 7, 1.3% | 361, 100, fixed 30 |
| forward throw | release 14 / 31 | release 15 / 32 | 4, 50, 50, 100 |
| back throw | UNKNOWN / 44 | release 16 / 45 | 4, 140, 60, 80 |
| up throw | | release 13 / 45 | 5, 93, 102, 70 |
| down throw | | release 16 / 43 | 4, 100, 57, 95 |

Read: the two games agree within one or two frames on every shared move. P1b keeps Melee; where Melee is UNKNOWN
(pivot grab, back throw release) Ultimate is the best number we have. Whole table, every move:
`marth_frames.nintendo.txt`.

## 2. Marth's attributes (fighter_param.prc.txt from line 7795)

| attribute | Melee | Ultimate |
|---|---|---|
| weight | 87 | 88 |
| walk speed | 1.6 | 1.575 |
| run speed / initial dash | - | 1.964 / 2.09 |
| jump squat | 4 | 3 |
| `jump_y` / `mini_jump_y` / `jump_initial_y` | - | 33.66 / 16.26 / 18.51 |
| gravity / fall speed / fast fall | - | 0.096 / 1.58 / 2.528 |
| height (camera and boxes) | - | 13 |

## 3. Defense, for P2 (common.prc.txt)

| rule | Melee (06 A3, A4) | Ultimate |
|---|---|---|
| shield HP | 60 | `shield_max` 50; regen `shield_recovery1` 0.08 per frame; `shield_reset` 37.5 (read in native code, not in the scripts: meaning to confirm) |
| shield damage | d x 0.7 | `shield_damage_mul` 1.19 |
| shieldstun | (d x 0.45 + 2) x 200/201 | `shield_setoff_mul` 0.8 and `shield_setoff_add` 3, `shield_stiff_frame_max` 60 |
| parry window | powershield: hit within the first 4 frames of raising the shield | `shield_just_frame` 5 counted from **dropping** the shield: the window is set in `status_GuardOff_Common` (`src/common_status/status_Guard.cpp:82-91`), scaled per fighter by `just_shield_check_frame` |
| shield drop | 8 frames held, then 15 of drop lag | `guard_off_cancel_frame` 11: the drop animation is stretched to 11 frames (status_Guard.cpp:92-99) |
| input buffer | none worth porting | `precede` 7 frames, plus `precede_extension` 2 while held (9 in all) |

Ultimate's parry is on release, Melee's on press. Both are cheap to build on our guard. Joi picks; Melee stays the
default (P2 as planned).

## 4. Grab, for P3 (common.prc.txt and src/common_status)

| rule | Melee (06 A5, 03) | Ultimate |
|---|---|---|
| hold time | floor(76 + 1.6 x percent) | `capture_cut_frame` 90 + percent x `capture_cut_frame_damage` 1.7; handed to a mash counter that each input lowers; at 0 the victim breaks out (the same shape is readable for the beetle grab in status_Capture.cpp:869-874) |
| mash | 6 frames per input | `clatter_cont_value` 0.5, `capture_recovery` 1.0, `capture_clatter_frame` 8 |
| regrab | UNKNOWN | `invalid_capture_frame` 60 frames of grab immunity: `FighterStatusCapture_set_invalid_capture` sets the timer, turns the catch check off and plays its own effect (src/common_status/misc.cpp:186-189) |
| grab clash | | `catch_rebound_frame` 15, `catch_rebound_stop_frame` 10, push 1.5 |
| dash and pivot grab entry | | `catch_dash_frame` 3, `catch_turn_frame` 4 (entry windows by their names, not traced) |
| release | ground and air both 29 frames | `capture_cut_speed_x` 1.2, ground 1.9, `catch_cut` and `capture_cut` both 30 frames |
| P3a box supplement | Melee radius 3.906; body scale 0.12 u/unit | `src/marth_acmd/game.cpp:355` grounded capsule: forward 4..7.7, height 8. P3a uses midpoint 5.85; radius 0.46872 u, offset 0.702 u, top 1.42872 u. `marth_motion_list.txt:138` catch_pull extra byte 02 is a cancel frame, not a verified motion length; P3a uses the permitted 0-frame fallback |
| hold point | not in the checkout | bone `Throw` during the hold: 5.5 in front, 11.5 up, in Marth units (height 13): 0.42 and 0.88 body heights. At the forward throw release it is 17.6 in front |
| P3b throw supplement | Melee forward 14/31, back total 44; common throw weight 100 | `src/marth_acmd/game.cpp:2288-2303` game_throwb: frame 16 at line 2298, absolute hit line 2302; no reverse command, so P3b flips at release. `marth_motion_list.txt:142-143` lists forward/back cancel bytes 20/2d (32/45), not used instead of Melee totals. `src/common_status/status_Thrown.cpp:26-27` calls invalid_capture on ordinary Thrown exit; `misc.cpp:186-189` supplies the common 60-frame immunity |

The decompiled state machine for the whole grab (Catch, CatchPull, CatchWait, CatchAttack, CatchCut, Capture*,
Throw, Thrown) is in `src/common_status/status_{Catch,Capture,Throw,Thrown}.cpp`: P3 reads it next to ficha 03.
Item throws exist too (`game_itemlightthrow*`, `game_itemheavythrow*` in Marth's game.cpp; `status_Item.cpp`).

## 5. Animations and poses

- 340 of Marth's animations with their names (`raw/fighter/marth/motion/body/c00/named/`), plus skeleton and mesh.
- `poses/*.png`: Marth's real mesh at the key frames (jab 1 frames 1 and 5, jab 2, tilt 4, 8, 12 and 34, grab,
  grab wait, pummel, forward and back throw, guard, dash grab). Cyan cross = sword bone, yellow = the Throw bone.
- `src/marth_acmd/effect.cpp` and `sound.cpp`: which effect and which sound starts on which frame of each move (sword
  flare, trail, swing sound). A timing reference for the juice slices J2..J8 of ficha 08.

## 5b. P2b numbers (shield break sequence and rebound push)

Read from `src/common_status/status_Shield.cpp` and `status_Rebound_FuraFura.cpp`, and the fighters' param files:
- `shield_break_y`: Marth 38, Mario 44.1, Fox 58, Kirby 34, Ganon 40, Jigglypuff 936.84. Used: Marth's 38 as a height (`jump_y` Marth 33.66 reads the same way), `air_accel_y` 0.096, `air_speed_y_stable` 1.58 (fall cap): 28 frames up and 32 down, 60 in all (ours, inferred: the launch speed is native code).
- `down_bound_u` 26 (frames lying down), `furafura_start_u` 50 (cancel frame into the dizzy), `furafura_stand_whole_hit_xlu_frame` 31 (intangible through the first 31 frames of the stand: the 117 first frames of our 136).
- Not used: `furafura_end` 34 (Melee has no recovery after the dizzy), `shield_reset` 37.5 of `shield_max` 50 (Melee's 30 of 60 stays), `shield_break_xlu_frame` 300 (a cap, not needed).
- Rebound: `attack_100_rebound_speed` and `attack_lw3_rebound_speed` 0.55 (MELEE_GUARD.reboundPush, Melee units per frame); `rebound_speed_no_cliff_stop` 0.48 (not used).

## 6. What it can feed next (proposals, nothing built)

1. P1b poses: sample the bone rotations of jab 1, jab 2 and tilt at their active frames into a local
   `marth-*.nintendo.json` and let `?melee=1` load it in local dev only, falling back to our own pose; then author
   our own poses against it. Needs a small retarget (Ultimate bone names onto our 15-bone rig).
2. P2: Joi chooses the parry: Melee's on press (planned) or Ultimate's on release with a 9-frame buffer.
3. P3: port the grab from ficha 03 with Ultimate's numbers where Melee has none (regrab immunity, hold point, pivot
   grab, back throw release).
4. Lucina, Roy and Ike come out of the same tools by changing one name (the 99 script modules are already extracted).
