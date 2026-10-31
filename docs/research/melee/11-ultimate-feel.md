# 11 - Ultimate's feel: the vibration of a hit and the drama of a super (T-1030-14, 2026-10-30)

Joi asked for "the feeling, the vibration of the hits, the bright at the start of the ultimate, all the drama of the
ulti or of the powers". Ficha 08 read Melee's hit cues; Melee keeps its numbers on the disc (`DATA`). Ultimate's dump
(`C:/DEV/_refs/ssbu-nintendo`, ficha 09) has them in readable form. This ficha lists what Ultimate does, cites it, and
says what we ported and how.

Conventions:
- `bo:N` = `C:/DEV/_refs/ssbu-nintendo/battle_object.prc.txt` line N; `cm:N` = `common.prc.txt`; `ef:N`, `ex:N`,
  `ga:N` = `src/dolly_acmd/{effect,expression,game}.cpp` (Terry). Frames are Ultimate frames = our ticks.
- **inferred** = my reading of a name or a shape, not stated by a line. Legal rule unchanged: numbers and rules only.

## 1. The vibration of a hit (hitlag shake)

Ultimate shakes **both** fighters through the hitlag, each by a fixed table (`shake_data_param`, bo:111):

| table | entries (x, y in Ultimate units) | shaker_rate | rolling | source |
|---|---|---|---|---|
| damage_air (victim, airborne) | (2,0) (0,0) (-2,0) | 2 | no | bo:114 |
| damage_ground (victim, grounded) | (2,0) (0,0) (-2,0) | 2 | yes | bo:132 |
| damage_elec (victim, electric) | (0,0) (2,1) (-1,0) (0,5) (0.2,0) | 1 | no | bo:150 |
| attack_air (attacker, airborne) | (0,0.8) (0,0.8) (0,-0.8) (0,-0.8) | 1 | no | bo:207 |
| attack_ground (attacker, grounded) | (1,0) (1,0) (-1,0) (-1,0) | 1 | yes | bo:228 |
| damage_air_finish (the KO blow) | (2,0) (0,0) (-2,0) | 0 | yes | bo:456 |

- Amplitude is **fixed**: the damage only sets how long it plays (the hitlag). Hitlag: `dmg * 0.65 + 6`, max 30, x1.5
  electric (bo:873-877, bo:859). We keep Melee's hitlag (P1a); only the table is Ultimate's.
- `shaker_rate` read as entries per frame (inferred: the attack tables, at rate 1, repeat each entry twice; the finish
  table, at 0, holds still while the KO zoom plays). `damage_shake_add_value` 4 and `damage_shake_mul_value` 0.75
  (bo:1218-1220) are likely the length formula of the shake; not used.
- Before T-1030-14 our victim shook `0.06 * kb/80` u: a jab (kb 32) moved 0.024 u, invisible. Ultimate's table times
  `LAWLESS.meleeUnit` gives 0.12 u, five times more, for every blow. The attacker did not shake at all.

## 2. Rumble and camera quake

- Ultimate names a pattern per moment (`rbkind_*`); the patterns' curves are game data we do not have. Melee's rule
  (ficha 08 section 3) gives the shape for hits: the victim's duration grows linearly with the blow, the attacker's too,
  shorter.
- Camera quake: three sizes `CAMERA_QUAKE_KIND_S / M / L`; the sizes live in the camera params (not pulled). A hit quakes
  only when it launches (Melee ftCo_Damage.c:453-467, ficha 08 section 2): small hits stay calm.

## 3. The drama of a super and of a final (Terry)

| frame | final (finalstart) | super: Power Geyser | super: Buster Wolf |
|---|---|---|---|
| 0 | background replaced (`req_screen bg_dolly_final`) and the screen behind the fighters filled **warm white** `(1, 0.95, 0.9)` (ef:589-590); `sys_final_aura` on 8 bones (ef:591-598); eye flash `START_INFO_FLASH_EYE` (ex:1210) | `sys_smash_flash` glint at the body, scale 0.7, rate 1.3 (ef:1039); aura on the hand | `sys_smash_flash` scale 0.9, rate 1.1 (ef:1097) |
| mid | aura off at 28 (ef:604-606); rumble cut `rbkind_erase_sp` at 26 (ex:1214-1216): a beat of stillness | `rbkind_nohitll` at 16 (ex:2730-2732) | `rbkind_rush` + QUAKE S at 18 (ex:2770-2773) |
| impact | 40: `rbkind_explosion` + `rbkind_attack_critical` + QUAKE L (ex:1226-1230) | 20: `rbkind_explosionm` + QUAKE M (ex:2742-2745) | hit 5: `rbkind_attack_critical` + QUAKE M (ex:2758-2761); body burns orange in 4 frames, fades in 12 (ef:1070-1080) |
| end | screen filled **dark** `(0.18, 0.16, 0.14)` (ef:575), both fills cleared over **30 frames** (ef:582-583) | | layer-1 fill cleared over 20 frames at 25 (ef:1078) |

So the drama is: freeze, the world goes bright behind the fighter, a glint on the eye, the body glows, the rumble
gathers, stops, and explodes with the largest quake; then the screen is dark for a moment and clears in half a second.

## 4. What we built (T-1030-14, client only, no protocol change)

| cue | where | numbers |
|---|---|---|
| Victim shake by Ultimate's damage table (electric for element 3) | src/render/launchPose.js `SHAKE`, `stepLaunch` | entries x `LAWLESS.meleeUnit` (0.12 u peak) |
| Attacker shake by attack_ground along its facing, for its hitlag | launchPose.js `startAtkShake`/`stepAtkShake`; characters.js `atkShake` | 0.06 u peak |
| Rumble: gamepad dual-rumble and phone vibrate, behind the Vibración switch (now "mando y móvil") | src/ui/rumble.js | tuning.feel.rumble (ours) |
| Hit: rumble for the pirate you play (victim or attacker), quake S/M/L from the tumble KB | feedback.js `hitFeel` on `damage` and `hurt` | quakeKb 120 / 160 (ours); MN_MELEE drops the flat shake of `mhit` |
| Q / E (every `cast`): the glint at the head, a small camera push, a rumble tick | feedback.js `powerCue` | tuning.feel.power |
| R, the ultimate (Tormenta `riposte`, Lluvia de plomo `rain`): freeze 0.1 s, warm-white flash (1, 0.95, 0.9), dark fill (0.18, 0.16, 0.14) held then cleared in 30 frames, glint, aura 28 frames, camera pushed in, light; rumble that gathers until 4 frames before it lands, then explosion 30 frames + quake L. Another pirate's R in sight: glint, aura, soft flash, quake M by distance | feedback.js `ultCue`; the dark fill is a new grading uniform `uDim` (src/render/pipeline.js) | tuning.feel.ult |

The Lluvia lands `SKILLS.rain.delay` (0.35 s) after the cast; the Tormenta lands at once (the server's 0.14 s freeze
holds that frame). Tests: tests/hit-feel.test.mjs.

## 5. Next (not built)

1. Smash charge: `sys_smash_flash` when the heavy starts charging and Melee's charge shake (ficha 08 section 7).
2. The KO blow (Ultimate's finishing zoom): pull the camera params from the dump (`ssbu_pull.py`) for the zoom and
   slow-motion numbers; `damage_*_finish` holds the victim (bo:456).
3. Terry's supers for Puños (P-T2): BURN_COLOR on the body, the layer-1 fill.
4. Element sparks and KB-tiered colour (ficha 08 J2, J5), severity sounds (J3).
