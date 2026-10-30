# 10: Terry Bogard (Ultimate `dolly`) as the unarmed brawler reference (T-1030-09, 2026-10-30)

Joi asked for Terry "como referencia para los golpes y poderes" of the unarmed kit (README, Decided 2026-10-24: a second
reference fighter, a brawler). Pulled with the same seven steps as Marth (ficha 09, README of `C:/DEV/_refs/ssbu-nintendo`).
This ficha extracts and documents; it designs nothing. Mapping to our controls is the chef's.

**Legal rule, unchanged.** Everything Nintendo-derived stays in `C:/DEV/_refs/ssbu-nintendo/` (`*nintendo*` is ignored by
the repo). Here: numbers, frame timings, rules and pointers only; no code, model or animation. Every pointer below resolves
inside that folder: `acmd` = `src/dolly_acmd/game.cpp`, `vl` = `dolly_vl.prc.txt`, `fp` = `fighter_param.prc.txt`,
`cm` = `common.prc.txt`, `ml` = `dolly_motion_list.txt`, `ft` = `dolly_frames.nintendo.txt`.

## 0. Read this first: what is solid and what is missing

- Frames are 1:1 with our 60 Hz ticks. Script frame N is animation frame N-1 (README gotcha). A script that sets a motion
  rate (`FT_MOTION_RATE`) runs faster: "rate 2 until 5" means the hit appears at about tick 3, not 5. Totals below are the
  motion-list cancel byte (third `extra` byte, hex) and are in animation frames.
- **Decompiled and solid** (acmd): jab 1-3, f/u/d tilt, dash attack, the three smashes, the five aerials, grab/pummel,
  Power Wave projectile hitboxes, Power Dunk rise, both super specials (hitboxes), cliff/get-up attacks.
- **Not decompiled by the tool, so NO ENCONTRADO**: the hitboxes of Burn Knuckle, Crack Shoot, Rising Tackle, the Power
  Dunk landing hit, and all four throws. Reason from `build/work/fighters/tools_out/dolly_acmd.json`: `game_specialn`,
  `specialsfattack`, `specialsbattack(w)`, `specialhi1/hicommand` (+air), `specialairlw` fail with "jump" (a compiler tail
  merge the tool cannot structure; a lenient copy tried in the scratchpad hit other reasons and was dropped);
  `game_throwf/b/hi/lw` fail on `FighterCutInManager::set_throw_finish_zoom_rate` (unsupported call). The status
  decompiler only supports `common` (`status_decomp.py dolly --stats` prints "0 named functions match"). For these moves
  this ficha holds what the param files and the motion list give (speeds, totals, command multipliers), nothing invented.
- Naming: scripts say `s` = side special (`sf` forward = Burn Knuckle, `sb` back = Crack Shoot), `hi` = Rising Tackle,
  `lw` = Power Dunk, `superspecial` = Power Geyser (generates the `burst` article), `superspecial2` = Buster Wolf (generates
  the `fire` article, then a grab-like blow). These four mappings are my reading of the names plus the param groups
  (`param_burst` / `param_fire`), not a label from the game.

## 1. Fighter parameters

Terry is entry `[71]` of `fp` (fighter_kind_dolly at `fp:26295`; entry runs from `fp:26273`). Marth is `fp:7795`.

| attribute | Terry | pointer | Marth (09) |
|---|---|---|---|
| weight | 108 | fp:26276 | 88 |
| walk speed max | 0.85 | fp:26332 | 1.575 |
| walk accel add / mul | 0.029 / 0.10 | fp (walk_accel_add, walk_accel_mul) | - |
| dash speed (initial) | 1.65 | fp:26283 | 2.09 |
| run speed max | 1.72 | fp:26312 | 1.964 |
| run accel add / mul | 0.04 / 0.12 | fp:26308, 26311 | - |
| ground brake | 0.111 | fp:26298 | - |
| jump squat | 3 frames | fp:26355 | 3 |
| `jump_y` / `mini_jump_y` / `jump_initial_y` | 27.0 / 15.2 / 14.85 | fp:26277, 26285, 26331 | 33.66 / 16.26 / 18.51 |
| `jump_aerial_y` (2nd jump), jumps | 29.0, 2 | fp:26313, 26324 | - |
| gravity `air_accel_y` / fall speed / fast fall | 0.09 / 1.48 / 2.368 (`dive_speed_y`) | fp:26289, 26399, 26302 | 0.096 / 1.58 / 2.528 |
| air speed stable x / air accel x add, mul | 0.95 / 0.01, 0.05 | fp:26381, 26338, 26341 | - |
| height | 17 | fp:26278 | 13 |
| shield radius | 11.8 | fp:26314 | - |
| landing lag light / heavy | 1 / 4 (`landing_frame_light`, `landing_heavy_frame`) | fp:26405, 26419 | - |
| smash hold max (f, u, d) | 60, 60, 60 | fp (attack_s4/hi4/lw4_hold_frame) | 60 (09) |
| jab chain | 3 hits, `attack_combo_max` 3, `attack100_type` 0, `attack_100_enable_cnt` 0 (no rapid jab) | fp:26356 | - |
| jab cancel ends | `combo_attack_12_end` 22, `combo_attack_13_end` 34 | fp:26415, 26413 | - |
| air-ground speed brake | 0.035 | fp (air_ground_speed_brake) | - |
| `special_s_brake` | 0.20 | fp:26343 | - |
| `shoot_dash_speed_f` / `_b` | 1.32 / 1.056 | fp:26385, 26384 | - |

Shield, roll, spot dodge, parry window, grab break and regrab immunity: no Terry-specific value found; they are the common
numbers of ficha 09 sections 3 and 4 (`cm`). Dash: motion list `dash` total 20 (0x14), `turn_dash` 22, `run_brake` 20 (ml:20, 23, 25).
Roll / spot dodge: `escape_f/b/n` have no cancel byte in the motion list (ml:69-71); frames are not in this dump's tables: NO ENCONTRADO per fighter, use common.

Dolly-only parameters (all in `vl`, structure line numbers in section 8): `param_private` super_special_damage 100,
super_special_hp_min 5, super_special_hp_max 100, super_special_hp_rate 30, special_pad_release_w 5,
wall_stop_cancel_frame 8, attack_start_cancel_frame 3, pass_cancel_command_frame 8 (+ extend 4),
final_cancel_hit_stop_frame 25 (vl:372-385). No `wall fly` parameter found by that name; `param_final` holds the Final
Smash (Climax Max) scene numbers (ready_frame 30, vl:271), out of scope.

## 2. Ground normals

Source: `ft` (windows, strongest box, cancel) and `acmd` (per box). "Active" = script frames. "Total" = cancel frame.
Hitbox size is the radius in Ultimate units (Marth's height 13, Terry's 17). BKB/KBG/angle as in the script; angle 361 = Sakurai angle.
All boxes are `normal` attribute, ground and air situation unless stated.

| move | acmd | active | total | dmg (per box) | angle | BKB | KBG | size | notes |
|---|---|---|---|---|---|---|---|---|---|
| jab 1 | :5 | 5-6 (motion rate 2.0 until 5, so about tick 3) | 16 | 3.0 / 3.0 | 361 / 180 | 10 / 30 | 10 / 10 | 3.2 | box 2 is the far box (z 10) angle 180 (pulls to the fist). Next-jab window opens at 7 (ENABLE_COMBO), restart flag 12, hit-cancel flag on |
| jab 2 | :35 | 3-7 | 25 | frames 3: 1.0 (3 boxes); 4-7: 2.0 | 361, 170 air, 180 ground | 25 / 35 / 38 | 15 | 4.0-4.5 | the first frame hits for 1, the rest for 2; combo window 8; hit-cancel from 6 |
| jab 3 | :70 | 7-10 | 34 | 7.0 | 47 | 70 | 60 | 4.0 | the finisher; the chain ends here. Whole chain 3 + 2 + 7 |
| rapid jab | - | none | - | - | - | - | - | - | `attack_100_enable_cnt` 0 (fp). NO ENCONTRADO in the scripts |
| forward tilt | :375 | 10-15 | 30 | 12.0 (two boxes), 13.0 (tip) | 37 | 53 | 40 / 36 (tip) | 3.5-4.0 | motion rate 1.3 until 10; right leg and knee hurtboxes intangible from 9 to 16; one variant only (no angled ftilts in the motion list: ml:79 `attack_s3_s`) |
| up tilt | :256 | 7-11 | 31 | 11.0 (all boxes) | 78 | 72 / 78 | 18 | 3.0 | left shoulder and arm intangible 7-12; boxes rise from y 8 to 23 over 7-9 |
| down tilt | :321 | 6-8 | 20 | 3.0 (three boxes) | 80 / 80 / 86 | 25 | 30 | 3.5 | low-height hit, hits to z 12 (reach), rate 0.7 from 10 |
| dash attack | :238 | 10-22 | 41 | 13.0 (10-14), then 10.0 (15-22) | 55, then 50 | 65, then 60 | 78, then 83 | 5.0, 4.0 | two-stage hit, the late hit is weaker |
| forward smash | :413 | 13-16 | 46 | 18.0 (two boxes) | 361 | 60 | 73 | 4.0 | rate 2.0 until 6, charge flag at 6, hold max 60 frames; one hit |
| up smash | :291 | 8-12 | 40 | 16.0 at 8, 18.0 from 9 | 83 at 8, 90 after | 32 | 89 / 83 | 5.0 | rate 3.0 until 2, charge flag at 7; second hit stage reaches y 21 |
| down smash | :347 | 6-9 | 39 | 12.0 | 32 | 36 / 31 (tip) | 82 / 87 (tip) | 3.0-4.0 | rate 2.0 from 4 to 6, charge flag at 3; low height; box reach to z 16 |
| get-up attack (from shield, uses up tilt anim) | :812 | 7-11 | 31 | 11.0 | 88 | 62 / 68 | 60 | 3.0 | whole body intangible 1-11 (rate 0.5 until 5); shield setoff x0.5 |

Hitlag per box is 1.0-1.7 (jab 1.5, jab 2 1.5-1.7, tilts 1.0-1.6, smashes 1.0): the figures are the script's `hitlag`
argument; sdi 1.0 everywhere. Hit-cancel and FINAL_HIT_CANCEL flags (set at frame 0 of every normal) are, by their names, the windows where a connected normal may cancel into a special (meaning not traced): the
exact special-cancel frames are native code: NO ENCONTRADO in acmd.
Edge/cliff attack (`acmd:545`): 24-26, 10.0, angle 45, BKB 90, KBG 20, total 56. Trip attack (`acmd:1932`): 19-20 and 24-25, 5.0, 361, BKB 60, KBG 50, total 50. Get-up attacks (`downattack` u/d, `acmd:697`, :716): 16-17 and 21-22 (u: 19-20, 24-25), 7.0, angle 48, BKB 80, KBG 48, total 46.

## 3. Grab, pummel, throws

| item | active / release | total | detail | pointer |
|---|---|---|---|---|
| standing grab | 6-7 | 35 | two grab boxes: size 4.0 from z 5 to 9.7 at y 9, size 2.0 from z 3 to 11.7 | acmd:476; ml:139 (0x23) |
| dash grab | 9-10 | 43 | size 3.6 from z 5 to 9.7; size 1.8 from z 3.2 to 11.5 | acmd:507; ml:140 (0x2b) |
| pivot grab | 10-11 | 38 | size 3.3 from z -5 to -13.5; size 1.65 from z -3.35 to -15.1 | acmd:526; ml:141 (0x26) |
| pummel | hit at 1 | 7 | 1.5 %, fixed KB 30, hitlag 2.2, catch-only | acmd:495; ml:144 (0x07) |
| forward throw | NO ENCONTRADO | 50 | script not decompiled | ml:146 (0x32) |
| back throw | NO ENCONTRADO | 54 | script not decompiled | ml:147 (0x36) |
| up throw | NO ENCONTRADO | 34 | script not decompiled | ml:148 (0x22) |
| down throw | NO ENCONTRADO | 48 | script not decompiled | ml:149 (0x30) |
| catch cut (release) | - | 30 | common | ml:145 (0x1e) |

Throw damage, angle, BKB/KBG and release frame: NO ENCONTRADO. Looked in `acmd` (no `game_throw*` function), in `dolly_acmd.json` (listed as failed, reason above) and in `vl`/`fp` (no throw entry). Next step if needed: patch the tool for that import, or read the throw anim's frame count (`raw/fighter/dolly/motion/body/c00/named/e01throw*.nuanmb`).

Grab rules (hold time, mash, regrab immunity, clash) are the common ones of ficha 09 section 4; no Terry-specific value found in `fp:26273-26643`.

## 4. Specials

Input rules (`cm`): `special_command_life_max` 10 frames to finish a motion input (cm:348), `super_special_command_life_max` 20 (cm:612),
`special_command_ab_button_life` 3 (cm:608), `special_command_neutral_threshold` 0.2 (cm:662), stick sectors `special_command_stick_range`
(7 angle sectors, e.g. -32.5..32.5 = forward, 32.5..57.5 = down-forward diagonal; cm:471). The command version of a move is a
separate motion (`special_hi_command`, ml:113; `special_air_hi_command`, ml:117) and multiplies the move by `command_power_mul`
(vl): Burn Knuckle 1.0 (no change), Power Dunk 1.2, Rising Tackle 1.2. Per-param lists in `vl` have four entries; entries [2] and [3]
are zero. Entry [1] differs slightly from [0] (e.g. Rising Tackle `speed_y_mul` 0.5 vs 0.649, `landing_frame` 14 vs 22); I did not trace which selects which: both are given.

| move | motion list | total (anim frames) | what the files give | NO ENCONTRADO |
|---|---|---|---|---|
| **Power Wave** (neutral B), ground and air | ml:99-100, `special_n` | 50 (0x32) | decide-strength flag at script frame 6, projectile generated at 18 (acmd:2036, :2047); `pad_release_w` 3 (hold at most 3 frames to be the weak one); gravity/hop params for air (`hop_speed_y` 0.5, `gravity_accel` 0.06, `pos_offset` x 11 y 3) | startup of ground variant (script is not decompiled; the air script gives 6/18) |
| **Burn Knuckle** (side B forward) | ml:101-105 | start ?, attack ?, end 30 ground (0x1e), 20 air (0x14) | attack speed x 2.5 ground (brake 0.09, `attack_accel_y` 0.029), 2.0 air (`air_attack_brake_x` 0.07), `attack_no_landing_frame` 18, `turn_to_b_frame` 5, `attack_stop_cliff_frame` 7, `command_power_mul` 1.0 (vl:469) | hitboxes, damage, KB, startup and active frames; the command version's damage |
| **Crack Shoot** (side B back) | ml:106-111 | end 20 ground (0x14), 15 air (0x0f); `attack_w` is the weak version (ml:108) | `air_reverse_stick_back_frame` 7 (vl:469); same param group as Burn Knuckle | hitboxes, damage, KB, travel |
| **Rising Tackle** (up B), ground and air | ml:112-118, command ml:113, 117 | landing 14 (`landing_frame`, vl:723), command landing x0.66 (9.2 frames) | `speed_y_mul` 0.5, `speed_y_mul_command` 0.55, `control_frame` 4, `stick_down_hold_frame` 24, `stick_x_speed_mul_max` 5.0, `fall_frame` 1; no charge (no charge motion in the list) | hitboxes (hit count, damage), the startup, the total |
| **Power Dunk** (down B), rise | ml:119-124, rise `special_lw` ml:123 | landing on hit 28, on whiff 20, heavy 9 (vl:598) | rise strong hits (acmd:1957): 1 % at script frame 1 (angle 85, fixed KB 40, BKB 50, size 5), then 2 % at 5-8 (air: angle 65 / ground: angle 40, fixed KB 50 / 30, size 7), whole body intangible 1-9, then speed set at 28; weak rise (acmd:1999): 1 % angle 90 fixed KB 50, 2 % at 4-7, intangible 1-8, speed at 22 | the landing (dunk) hit, the ground variant's rise hit count |

Power Wave detail, `vl:215` (`param_wave[0]`; entries [1]-[3] are zero):

| | speed | life (frames) | reach (speed x life) | damage | angle / BKB / KBG | hitbox |
|---|---|---|---|---|---|---|
| ground strong (`_s`) | 2.0 | 45 | 90 | 9.0 (acmd:1459) | 55 / 50 / 20 | radius 2.4 and 1.8, article-local coordinates |
| ground weak (`_w`) | 1.2 | 68 | 81.6 | 8.0 (acmd:1565) | 55 / 50 / 20 | same |
| air strong | 2.4 | 6 | 14.4 | 11.0 (acmd:1476) | 45 / 85 / 30 | radius 3.0, 7 steps (frames 0-6), hitbox moves down-forward |
| air weak | 1.6 | 9 | 14.4 | 10.0 (acmd:1513) | 45 / 85 / 30 | radius 3.0, 10 steps (frames 0-9) |

Others of `param_wave`: `time_to_adjust_angle` 5 (the wave follows the ground slope for 5 frames, then keeps the angle), unnamed `0x1d5e336640` 80.0
(unknown meaning). Wave map collision: `map_collision_wave` rhombus up 10, down 0, half width 2 (vl:813).
"What destroys it": NO ENCONTRADO (article collision rules are native code; `hit_target` in vl:260 lists 1, 0, 3 and is not decoded).
Ground-only behaviour: the wave exists in both situations; the air version is a short diagonal ball (6 / 9 frames of life), the ground version runs along the floor.

## 5. Super specials and the GO rule

| move | motion list | total | what the files give |
|---|---|---|---|
| **Power Geyser** (`superspecial`) | ml:136 `super_special` (0x4d = 77) | 77 | armor with a 5 damage threshold from frame 0 until 15 (damage-power mode 5, acmd:2166); burst article generated at 20 (rate 1.5 over 25-40); burst hit (acmd:2220): 26 % / 23 % / 20 % (three boxes, angle 70, KBG 41 / 42 / 44, BKB 100, radius 11 / 11 / 8), then 19 % / 17 % / 15 % with BKB 120 / 110 / 100 from article frame 5; `param_burst[0]` life 10, hit slow 5 frames x mag 5 (vl:316), `[1]` life 30 hit slow 5 x 2 |
| **Buster Wolf** (`superspecial2`) | ml:137-138: start 72 (0x48), blow 65 (0x41) | 72 + 65 | start (acmd:2293): armor 8 until frame 22, rate 2.0 / 0.5 / 2.0 in the first 5 frames, arm intangible from 12, **5 % punch at 20-29** (angle 45, fixed KB 100, BKB 30, radius 6, no death on this hit) and the `fire` article (life 16 frames, speed 4.0, 10 more frames after a hit, `param_fire` vl:264); if it connects the blow runs (acmd:2239): hits at 10-14: 15 % (angle 45, KBG 63, BKB 90, radius 8) + four 12 % boxes (KBG 48, BKB 90), plus a throw-kind hit that releases the grabbed fighter. Params `param_super_special2` (vl:848): `catch_fail_dist` 4 x 4, `hit_stop_frame_fighter` 18, `hit_speed_mul` 0.1, `hit_move_frame` 10; `dolly_super_special2_capture_cut_dist` 25 x 25 (cm:759, 766) |
| Critical zoom (both) | - | - | `param_super_special2_critical[0]` (vl:994): `critical_frame` 30, `critical_1_on_1` 1, zoom 3.0, slow 4; stage-slow params in cm:226-665 (`dolly_stage_*`, not needed) |

### The GO! rule

| question | answer | source |
|---|---|---|
| when do supers become available | the numeric trigger found is `super_special_damage` = 100.0 (percent of damage), in the dolly-only block; `super_special_hp_min` 5, `hp_max` 100, `hp_rate` 30 sit beside it. My reading of the names: unlock at 100 % damage, and for HP-based modes below 30 % of the HP bar; **not verified** (the check itself is native status code the tool cannot decompile) | vl:372-385 |
| input window | 20 frames for a super command; 10 for a normal special command | cm:612, cm:348 |
| what GO changes (power-up of the specials) | NO ENCONTRADO: no multiplier named GO or power-up in `vl`, `fp` or `cm` (searched dolly and super_special); the only damage multipliers are `command_power_mul` (1.0 / 1.2) | vl, cm |
| how long GO lasts | NO ENCONTRADO | - |
| meter | none found: no meter parameter in the dolly blocks; the unlock reads the damage value above | vl |

## 6. Projectile parameters (Power Wave, Buster Wolf fire, Power Geyser burst)

Power Wave: section 4. Fire article (Buster Wolf): life 16, speed 4.0, `life_after_hit` 10, `time_to_adjust_angle` 1, unnamed
`0x1d5e336640` 80.0 (vl:264); map collision rhombus up 10, half width 2 (vl:818). Burst article (Power Geyser): life 10 or 30,
`check_floor_down` 16 (vl:316); map collision up 5, half width 2 (vl:843).

## 7. Aerials (low priority: our game is mostly grounded)

| move | acmd | active | total | dmg | angle | BKB | KBG | auto-cancel flag at |
|---|---|---|---|---|---|---|---|---|
| neutral air | :212 | 4-19 (multi) | 34 | 7.0 | 62 | 20 | 100 | landing-enable 4 |
| forward air | :118 | 5-15 | 38 | 11.0 | 48 | 45 | 60 | 3 |
| back air | :81 | 11-15 | 40 | 15.0 | 38 | 30 | 83 | 11 |
| up air | :155 | 7-9 | 36 | 9.0 | 75 | 25 | 100 | 2 |
| down air | :181 | 12-15 | 33 | 17.0 | 310 | 15 | 85 | 12 |

Landing lag: the motion list gives every `landing_air_*` the same cancel byte 20 (ml:94-98, 0x14), and `fp` has `landing_frame_light` 1 /
`landing_heavy_frame` 4; the per-aerial landing lag is not a separate table here: NO ENCONTRADO (looked in `fp:26273-26643` and `ml`).
Windows from `ft` (merge of all boxes).

## 8. What replaces Marth's values in `combate/src/data/lawless.js`

Only a pointer list. Which numbers have a Terry-specific value, and where it is in this ficha:

| lawless.js constant | Marth value today | Terry's value | section |
|---|---|---|---|
| `MELEE.melee1/2/3`, `melee3s` (BKB/KBG of jab, tilt, smash) | Melee Marth (20/50, 30/70, 60/70) | jab1 10/10, jab2 25/15, jab3 70/60, ftilt 53/40, fsmash 60/73 | 2 |
| `MELEE.fthrow`, `bthrow` (bkb, kbg, weight) | Melee Marth 70/45, 70/60 | NO ENCONTRADO | 3 |
| `MELEE.wave` / projectile defaults | 30/70 projectile | Power Wave 50/20 (ground), 85/30 (air) | 4 |
| `MELEE_GRAB.fthrow` / `bthrow` release, total | 14/31, 16/44 | totals 50 / 54 (release NO ENCONTRADO) | 3 |
| `MELEE_GRAB.total`, `start`, `end` | 30, 7, 8 | 35, 6, 7 | 3 |
| `MELEE_GRAB.forward`, `height`, `radius` (box) | Marth 5.85 / 8 / 3.906 | z 5-9.7 / y 9 / size 4.0 (second box 2.0) | 3 |
| `MELEE_GRAB.pummel`, `hit`, `damage` | 24, 7, 3 | total 7, hit 1, 1.5 % | 3 |
| `MELEE_GRAB.throwDamage` | 4 | NO ENCONTRADO | 3 |
| `MELEE_SMASH.cap`, `maxMul` | 60, 1.4 | cap 60 (same); maxMul is common (1.4) | 1 |
| `MELEE_ROLL`, `MELEE_DASH`, `MELEE_GUARD` | Marth/generic | no Terry-specific value found | 1 |
| body/grab units | Marth height 13 | Terry height 17 (scale x1.31) | 1 |

## 9. Poses (key frames, Terry's real mesh; crosses mark skeleton bones as in ficha 09)

Rendered with `pose_check.py native` at the animation frame (script frame minus 1), saved in `C:/DEV/_refs/ssbu-nintendo/poses/`:

| file | animation:frame | what |
|---|---|---|
| `dolly_jab1_f5_nintendo.png` | c00attack11:4 | jab 1 hit frame (script 5) |
| `dolly_ftilt_f10_nintendo.png` | c01attacks3:9 | forward tilt hit frame (script 10) |
| `dolly_fsmash_f13_nintendo.png` | c03attacks4s:12 | forward smash hit frame (script 13) |
| `dolly_powerwave_f18_nintendo.png` | d00specialn:17 | Power Wave generate frame (script 18) |
| `dolly_burnknuckle_f10_nintendo.png` | d01specialsf:10 | Burn Knuckle, **frame chosen by eye, not the active frame** (hit frames unknown) |
| `dolly_risingtackle_f8_nintendo.png` | d02specialhi1:8 | Rising Tackle, **frame chosen by eye** (hit frames unknown) |
| `dolly_busterwolf_f20_nintendo.png` | d04superspecial2start:19 | Buster Wolf punch (script 20) |
| `dolly_powergeyser_f20_nintendo.png` | d04superspecial1:19 | Power Geyser burst frame (script 20) |

## 10. Files and how this was pulled

`C:/DEV/_refs/ssbu-nintendo/`: `raw/fighter/dolly/` (param/vl.prc, motion_list.bin, 349 named animations in `named/`, model),
`dolly_motion_list.txt` (742 lines), `dolly_vl.prc.txt` (1030 lines), `dolly_frames.nintendo.txt` (38 rows; the tool lists only
scripts that decompiled), `src/dolly_acmd/{game,effect,sound,expression}.cpp`. Steps 1, 2, 3, 4, 6 and 7 of the README ran clean;
step 5 (status decompiler) has no dolly support; `vl.prc` was dumped with `brawl/prc.py dump` and the public ParamLabels.csv.
A few `vl` keys show as hashes (`0x1d5e336640`, `0x151ed44336`): labels the public list does not have.
`acmd` also holds item swings (bat, club, starrod...), scopes and other agents' scripts that the module registers: ignore them.
Anim names for specials: `d00specialn`, `d01specialsf/sb`, `d02specialhi1/2`, `d03speciallw*`, `d04superspecial*`.
