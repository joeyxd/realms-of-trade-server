# Melee defense and parry (T-1024-02)

Source: C:/DEV/_refs/melee-pc (doldecomp/melee 0fb0af3 plus PC port). All paths below are relative to `src/melee/` unless they start with `lb/` or `it/` (also under `src/melee/`). Melee runs at 60 fps: seconds = frames / 60.

Reading guide. "DATA" means the number is not in code. It lives in PlCo.dat (struct `ftCommonData`, `p_ftCommonData->field`, offsets in `ft/types.h`) or in a character file (`co_attrs`, per-character anim scripts). Almost every ftCommonData field used here is still named by offset only (`x2A4`...), so I give offset plus my inferred meaning. Where the repo states a value in a comment I give it; otherwise no number. Function names in this tree are often addresses (`ftCo_800925A4`); I add a readable label in brackets, marked (inferred) when the name is mine.

Convention for "hit flags" on a hitbox (`HitCapsule`, `lb/types.h:34-88`): the bits are unnamed in the decomp. From usage: `x40_b0` = may clank, `x40_b1` = rebounds after clank, `x40_b2` = hits airborne targets, `x40_b3` = hits grounded targets, `x42_b5` = hitbox active, `x43_b2` = hits only via hurtbox (skips shield and clank), `x34` = signed shield-damage bonus. All inferred from conditions in `ft/ftcoll.c:1437-1503` and `ft/ftcoll.c:202-223`, not from comments.

## 1. Summary

- Powershield is a two-part condition: a digital L/R press AND the analog trigger having crossed `shield_press_threshold` (0.25, `ft/types.h:113`) fewer than `powershield_input_window` frames ago (DATA, `ftCommonData+2A0`, `ft/types.h:334`). Check: `ft/kinds/ftCommon/ftCo_Guard.c:73-78` (from neutral) and `:852-858` (also allowed during the GuardOn startup, while the shield-up counter is below the same window).
- A powershield is the same shield with two timers: a reflect hitbox for `x2A4` frames (DATA, `ftCo_Guard.c:912`, countdown `:961-967`) and a "no shield damage" flag for `x2B4` frames (DATA, `:913`, `:969-973`, consumed in `ft/ftcoll.c:297-310`). Both count from the powershield state entry, not from the hit.
- Shield HP: starts and caps at `x260` (DATA, `ft/fighter.c:426`, `:2838-2843`); regen per frame while the shield is not up is `x27C` (DATA, `fighter.c:2839`); drain while held is `x278 * lerp(x2EC, x2F0, lightshield)` per frame (DATA, `ftCo_Guard.c:417-420`); after a break HP is reset to `x280` (DATA, `fighter.c:2857`, `ftCo_Furafura.c:21`).
- Shield damage from a hit = `x284 * (hit damage + hitbox shield bonus) * (1 - lerp(x2DC, x2E0, lightshield)) + x288` (DATA constants, `fighter.c:2847-2854`; the damage sum `ftcoll.c:299-300`). Break when HP falls below 0 (`fighter.c:2855-2861`, break dispatch `:2930-2933`).
- Shieldstun of the defender is "stun frames f = x28C * (strongest damage * (1 - lerp(x2E4, x2E8, lightshield))) + x290" (DATA, `ftCo_Guard.c:653-660`, applied as animation rate `:686-687`). The attacker's pushback and the defender's slide both come from data multipliers (`fighter.c:3029-3034`, `ftCo_Guard.c:688-700`).
- Clank rule: of two touching hitboxes, one is cancelled when `(int)own_damage - x3CC < (int)other_damage` (`x3CC` is an int, DATA, `ft/ftcoll.c:237`, `:247`). Equal or near-equal moves cancel each other; a move beating the other by at least `x3CC` survives. Fighter-vs-fighter clank runs only when BOTH fighters are grounded (`ftcoll.c:1495-1503`).
- Rebound: the cancelled fighter enters ReboundStop then Rebound for `x191C = own_damage * x3D0 + x3D4` frames (DATA constants, `ftcoll.c:208-210`, `ftCo_Rebound.c:23-28`), pushed once away from the opponent with speed `x191C * x3D8 + x3DC` (DATA, `ftCo_Rebound.c:26-30`). No action can cancel Rebound (`ftCo_Rebound_IASA` is empty, `:52`). Only moves with the rebound flag (`x40_b1`) rebound (`ftcoll.c:207`).
- Priority in the per-frame resolver: being damaged beats shield-hit beats clank/rebound beats dealing damage (`ft/fighter.c:2872-2976`).
- Dodges (roll, spot dodge, air dodge): the code only dispatches states and sets flags; durations and intangible windows live in per-state animation scripts (DATA): intangibility is set by an anim command that writes hit status 2 (`ft/ftaction.c:554-558`, `ft/ftcoll.c:2764-2779`) and cleared on state change unless the state keeps it (`ft/fighter.c:974-981`).
- Tech: a ground tech needs an L/R press less than `x250` frames ago (DATA) and the previous press gap at least `x1C` (int, DATA), i.e. an anti-mash lockout (`ft/kinds/ftCommon/ftCo_DownAttack.c:90-99`, counters `ft/fighter.c:2131-2136`).
- Marth Counter is a directional shield-type hitbox (`ftMars` `ftmarsspeciallw.c:75-81`) whose hit callback flips Marth toward the attacker, enters the hit state, and gives both fighters minimum hitlag `da->x60` (`:306-321`, `ftcoll.c:313-319`). The active window is an anim-script flag `cmd_vars[1]` (DATA).
- Shield break launches the fighter upward with `co_attrs.shield_break_initial_velocity` (DATA, `ftCo_ShieldBreakFly.c:28`), then Fall, Down, Stand, then Furafura (dizzy) with a mashable timer (`ftCo_Furafura.c:15-43`).

## 2. State machine

State ids are `ftCo_MS_*` (`ft/kinds/ftCommon/forward.h:468-528`). Each state has Anim (per-frame logic and exit), IASA (input cancels), Phys, Coll callbacks. Durations that depend on the animation length are DATA (character animation files).

### 2.1 Shield family

Entry from a standing state: `ftCo_80091A4C` [GuardEnterCheck] (`ftCo_Guard.c:70-84`). Order matters:
1. If L or R was pressed this frame AND `active_timer.trigger < powershield_input_window` -> `ftCo_800939B4` [GuardEnter as powershield] -> state id 182 (GuardReflect, hard-coded literal, `:938-953`). The trigger timer is the frames since the analog trigger crossed 0.25 (`ft/fighter.c:2063-2092`; held at 254 when below threshold or when the previous trigger frame was already above it; reset to 0 on the crossing frame).
2. Else if L/R is held AND `shield_health != 0` -> `ftCo_800923B4` -> `ftCo_800924C0` [GuardOn enter] (`:336-352`, `:384-398`).
3. Marth only: extra `ftParts_80074B0C` and sound 190115 (`:343-347`, `:925-929`).
A variant `ftCo_80091AD8` (`:87-116`) is the same check plus a stored value `guard.x20` (used by callers that remember the previous action). `ftCo_80091B9C` (`:124-128`) stores `guard.x24 = x68` (DATA), the shield-grab-from-run window consumed in `ftCo_800D8B9C` (`ftCo_Catch.c:83-95`).

#### GuardOn (`ftCo_MS_GuardOn`, startup of the bubble)
- Init (`ftCo_800921DC`, `:306-334`): `guard.x0` (frames in state) = 0; `guard.x10 = x268` (DATA, minimum hold frames before release is honoured, `:315`); `guard.xC = false` (release seen); lightshield amount from the trigger: `(trigger - analog_shoulder_deadzone) / (1 - analog_shoulder_deadzone)`, analog_shoulder_deadzone = 0.3 (`ft/types.h:107`, `:320-328`); shield bubble effect 1047 and sound 110. Shield becomes active via `ftColl_8007B1B8` (sets `x221B_b0 = true`, callback `ftCo_80092E50`, `ftcoll.c:2647-2659`, `:2650`). `x221A_b7` (shield "up" flag for HP logic) is set at `ftCo_Guard.c:268`.
- Per frame (`ftCo_GuardOn_Anim`, `:440-451`): `guard.x0 += 1`; run depletion (below); if `x0 >= fp->x2E8` go to Guard, else grow the bubble (`ftCo_80091E78`). `fp->x2E8` is NOT the common-data field: it is the end frame of an animation looked up at fighter creation (`ft/fighter.c:849`, `lbAnim_8001E8F8(ftData_80085E50(fp, 0x25))`), i.e. DATA per character (GuardOn animation length). Which state index 0x25 maps to is UNCONFIRMED.
- IASA (`:469-480`) in order: release (`inlineC0`, below), `ftCo_80093694` [powershield during startup] (`:849-860`), item throw, spot dodge (`ftCo_8009980C`), roll (`ftCo_8009917C`), shield-grab-from-run (`ftCo_800D8B9C`), grab (`ftCo_Catch_CheckInput`), jump (`ftCo_800CB024`), platform drop (`ftCo_8009A080`).
- Release test `inlineC0` (`:453-467`): the shield ends when (a) L/R has been released (`ftCo_80092BCC` sets `guard.xC`, `:563-569`) AND `guard.x10 == 0` (min hold elapsed), or (b) the shield flag and the reflect flag are both off. It then calls `ftCo_80092BE8` -> GuardOff. Otherwise `guard.x1C` (see 2.1 GuardOff) is decremented.

#### Guard (`ftCo_MS_Guard`, bubble held)
- Entry from GuardOn end (`ftCo_80092908`, `:507-528`): shield effect 1048, shield hitbox re-armed. Anim: `x0 += 1`, depletion, bubble drawn at full scale (`:530-538`). IASA same list minus the powershield and run-grab entries (`:540-549`).
- Shield angle follows the stick with smoothing `x44C` (DATA) (`ftCo_80091BC4`, `:130-175`), the bubble can be tilted by stick direction (a cosmetic/shape effect; the shield hit test is a sphere at the bone, `lb/lbcollision.c:1585-1633`).
- Depletion each frame while the bubble flag is up (`ftCo_800925A4`, `:400-438`): lightshield amount refreshed from the trigger (kept if the new value is below 0); `shield_health -= x278 * (lightshield * (x2F0 - x2EC) + x2EC)`; if HP < 0: HP = 0, shield off, play break sound 129, enter ShieldBreakFly (`:421-428`). `guard.x10` is decremented toward 0 (`:430-435`).
- Bubble size (`inlineB0`, `:177-191`): `size = [(1 - x264) * (HP / x260) * (light * (x2D8 - x2D4) + x2D4) + x264] * co_attrs.initial_shield_size` (DATA). Yoshi uses the fixed `initial_shield_size` (a different shield, `ftyoshiguard.c`, out of scope).

#### GuardOff (`ftCo_MS_GuardOff`, release)
- Enter `ftCo_80092C54` (`:585-591`): sound 127; saves HP to the player stats call `pl_8003E114`. Anim: `x0 += 1`; at animation end go to Wait (`ft_8008A2BC`, `:593-601`). Length is character DATA.
- IASA (`:603-619`): if `guard.x1C != 0` it first tries attack inputs (special-S, rapid jab, forward/up/down smash, forward/up/down tilt, jab) -- these are only allowed while the window `x1C` is still running (see Powershield below); then (always) spot dodge `ftCo_8009980C` and jump `ftCo_800CB024`. `x1C` is 0 in normal shield (set to 0 at `ftCo_800924C0:393`), so a normal release can dodge or jump but not attack directly.
- Phys: ground friction only (`:621-624`): no movement.

#### GuardSetOff (`ftCo_MS_GuardSetOff`, shield hit, shieldstun)
- Triggered by the shield callback `ftCo_80092E50` (`:631-651`), run from the resolver when a hit landed on the shield and the shield did not break (`ft/fighter.c:2930-2939`). `b = (strongest hit element == 10)`; element 10 is `HitElement_Cape` by enum order (`lb/forward.h:56-85`), which skips the slide and calls `ftCo_800C36DC` (cape-specific, not examined).
- Enter `ftCo_80092F2C` (`:662-715`): sets hitlag callback `ftCo_80093240` (shield-DI during hitlag, `:717-733`) and post-hitlag callback `ftCo_800932DC` (`:735-752`); plays effect 1049 unless in powershield window; sets animation rate so the state lasts exactly f frames (formula 4.3); sets ground velocity (4.4); re-arms the shield sphere; bubble scaled by 4.1.
- Anim (`ftCo_GuardSetOff_Anim`, `:812-829`): per frame `ftCo_80093BC0` ticks the powershield timers; at animation end: if release already seen (`guard.xC`) -> GuardOff, else -> Guard (re-entering the shield without GuardOn).
- IASA: empty (`:831`). The fighter cannot act at all during shieldstun, neither dodge nor jump nor release. Phys: friction + shield sphere refresh. Coll: SDI capable while hitlag (`:839-847`).

#### GuardReflect (state 182, the powershield)
- Entered from `ftCo_8009388C` (`:886-915`, from within GuardOn/Guard) or `ftCo_80093A50` (`:938-953`, from neutral). Sets: `active_timer.trigger = 0xFE` (consumes the press), `x221C_b3/b1/b2 = true`, `guard.x1C = 0`, `guard.x14 = x2A4`, `guard.x18 = x2B4`; creates the reflector hitbox with max damage = current shield HP, size `x2A8`, damage multiplier `x2AC`, speed multiplier `x2B0`, behaviour flag 1 (`ftCo_8009370C`, `:862-874`, `ftcoll.c:2661-2675`); effect 1050 and sound 128 are played by the reflect callback `ftCo_80093790` (`:876-884`).
- Per frame (`ftCo_GuardReflect_Anim`, `:1045-1051`): `ftCo_80093BC0` (`:955-975`): clears `x221C_b3`; `guard.x14 -= 1`, when it passes below 0 the reflector is removed and the plain shield sphere is re-armed (`reflecting = false`); `guard.x18 -= 1`, when it passes below 0 the "no shield damage" flag `x221C_b2` ends. Then the normal GuardOn animation logic runs (reaches Guard at `x0 >= fp->x2E8`).
- IASA (`:1053-1064`): same as GuardOn (release, dodge, roll, run-grab, grab, jump, platform drop).
- The window values `x2A4` (reflect, frames) and `x2B4` (no-damage, frames) are DATA. Community values are not stated in code comments, so none are given here.

### 2.2 Shield break

- Trigger: HP < 0 from depletion (`ftCo_Guard.c:421-429`) or from a hit (`ft/fighter.c:2855-2861`, dispatch `:2930-2933`), or a reflect/powershield hit whose damage exceeds the reflector max damage (= shield HP at the time of entering GuardReflect) (`ft/ftcoll.c:585-613`, resolver `fighter.c:2961-2962` -> `ftCo_80098C9C` -> `ftCo_80098B20`, `ftCo_ShieldBreakFly.c:57-61`).
- ShieldBreakFly (`ftCo_80098B20`, `ftCo_ShieldBreakFly.c:21-36`): `self_vel = (0, shield_break_initial_velocity)` (character DATA, `ft/types.h:860`), air state, sound 130, hit status set to 2 (intangible) via `ftColl_8007B62C(gobj, 2)` (`ftcoll.c:2764-2779`). Anim end -> ShieldBreakFall. Phys: air physics; Coll: on landing -> ShieldBreakDown (`ftCo_80098E3C`).
- ShieldBreakFall (`ftCo_ShieldBreakFall.c:13-37`): keeps hit status (`Ft_MF_KeepColAnimHitStatus`), air physics, no exit except landing.
- ShieldBreakDownU/D (`ftCo_ShieldBreakDown.c:17-33`): picks U or D by body orientation (`ftCo_80097570`, `ftCo_DownBound.c:37-49`); anim end -> ShieldBreakStandU/D (`ftCo_ShieldBreakStand.c:13-30`).
- ShieldBreakStand end -> Furafura (`ftCo_80099010`, `ftCo_Furafura.c:15-31`): HP = `x280`; dizzy timer = `max(0, x2F8 - fp->dmg.x1830_percent) + x2FC` (DATA, percent is the fighter damage percent); per frame the timer drops by `x300`, plus `x304` for every mash event; the state ends at timer <= 0 (`:33-43`, `ftcommon.c:688-738`). Mash events: a pressed A/B/X/Y/L/R button, or the stick crossing past `x308` on an axis in a new direction (a flip of the sign latch) (`ftcommon.c:703-725`). IASA is empty: no actions while dizzy (`:45`).
- Intangibility: hit status 2 is set at Fly entry and preserved by the Keep flag through Fall, Down and Stand; Furafura omits the Keep flag, so the generic reset to 0 happens on entering it (`ft/fighter.c:974-977`). Any script command in the break animations that changes it again is UNCONFIRMED (anim scripts are DATA). Real vulnerability window to a follow-up is therefore UNCONFIRMED from code.

### 2.3 Clank and Rebound

- Detection: `ft/ftcoll.c:1378-1727` (`ftColl_80078C70`, per-fighter hitbox-versus-victim pass). For the pair (this fighter, victim fighter), the clank test runs only if all of: this loop is on the second fighter of the pair in list order (`is_same_gobj`, so each pair is handled once, `:1406-1429`); the pair is not in a grab (`x221B_b5`, victim_gobj checks); both fighters are grounded (`ground_or_air == GA_Ground` for both, `:1495-1498`); the victim hitbox is not hurtbox-only (`x43_b2`) and has `x40_b0` set (`:1502`); this fighter has at least one active clank-able hitbox (`count`, `:1430-1461`). Each candidate pair is tested for capsule overlap with `lbColl_80007AFC` (`lb/lbcollision.c:1558-1576`, capsule-vs-capsule using radii scaled by each fighter's model scale) and then `ftColl_8007699C` (`ftcoll.c:225-258`).
- Aerial-versus-aerial: per the code above there is no fighter-versus-fighter clank when either fighter is airborne; the airborne pair goes straight to the shield / hurtbox tests and both can hit (trade). This differs from the common description that aerials clank without rebound; UNCONFIRMED against the original binary, but the repo code is explicit. Item/projectile versus fighter clank has no ground requirement (`ftcoll.c:836-862`, called from `:1932`).
- Resolution (`ftColl_8007699C`): `midpoint` of the two contact points; effect 1052 at the midpoint. For each side: if `(int)own_dmg - x3CC < (int)other_dmg` the side's hitbox is cancelled against that victim (`ftColl_80076808(..., 3, victim, ...)`, victim record type 3 = clank, `lb/lbcollision.c:1832-1885`; it marks the whole hitbox group `x4` so the cancelled attack cannot connect later this move) and the side's `dmg.int_value` is set to its own damage (`ftcoll.c:202-223`). If the victim-side (hit0) hitbox is the cancelled one the function returns true and the damage pass for that pair is skipped; if only this-side (hit1) is cancelled, hit0 continues to the shield/hurtbox pass (`ftcoll.c:1520-1534`).
- Rebound trigger (resolver, `ft/fighter.c:2940-2947`): `dmg.int_value != 0`, `dmg.x191C != 0` (set only when the hitbox has `x40_b1` and the fighter is grounded, `ftcoll.c:207-221`), and the fighter is not holding anyone (`victim_gobj`, `target_item_gobj` null). Then `ftCo_80099D9C` -> ReboundStop. The hitlag of the clank is the generic formula with `int_value` (`fighter.c:2985-2996`).
- ReboundStop (`ftCo_80099D9C`, `ftCo_Rebound.c:16-31`): animation rate `(co_attrs.clank_animation_length + 0.1) / x191C` stored for the next state (`co_attrs.clank_animation_length` is character DATA, `ft/types.h:862`); sets an impulse `rebound.x0 = -facing * (x191C * x3D8 + x3DC)`; `ftCommon_800804A0` applies it. Anim callback goes straight to Rebound (`:33-43`), so ReboundStop is one animation update long.
- Rebound (`:41-67`): plays the animation at the stored rate, so total length is `x191C` frames; at animation end -> Wait (`ft_8008A2BC`). Phys: first frame uses the impulse and zeroes it, later frames normal ground friction. IASA empty: nothing can cancel it. Coll: grounded collision (`ft_80083F88`).
- Sound: slash-vs-slash random pick of 3 sounds (`ftColl_803C0C4C`), else sound 0x6A (`ftcoll.c:1131-1139`).

### 2.4 Dodges

- Spot dodge (`ftCo_MS_EscapeN`): entry `ftCo_8009980C` [spot dodge check] (`ftCo_Escape.c:252-260`) from shield or other states: left stick y `<= x314` (DATA, the repo comment gives -0.7 at `:216`) AND the stick-y active timer `< x318` frames (DATA, `:202-210`), or the C-stick down (`ftCo_800DF8E8`, `ft/ft_0DF1.c:211-216`), and not blocked by the UCF shield-drop rule (`pc_is_ucf_enabled`, `ftCo_UcfBlocksSpotDodge`, `:212-238`: standing on a platform with the stick pressed against the rim and `active_timer.lstick.x >= x320`). Variant `ftCo_80099794` (`:240-250`) requires L/R held. State enter `:276-283`, flag `x221D_b5 = true`. Anim end -> Wait; Phys ground friction, Coll `ft_80084104`, IASA empty (`:295-312`). Duration, intangible frames: anim script, DATA.
- Roll (`ftCo_MS_EscapeF` / `EscapeB`): entry `ftCo_8009917C` [roll check] (`:52-69`): left stick |x| `>= x31C` and the stick-x active timer `< x320` (DATA, `:42-50`) or C-stick left/right (`ftCo_800DF8B0`, `ft/ft_0DF1.c:203-208`); forward/back by sign of stick times facing. Stores `mv.escape.x0 = x324` (DATA). State enter `ftCo_80099314` (`:98-106`). Per frame: flips facing for the "throw B3" flag, ends -> Wait with `gr_vel = 0` (`ftCo_Escape_Anim`, `:129-139`). IASA: only item-throw out of roll while a timer runs (`ftCo_8009563C`, `ftCo_ItemThrow.c:238-251`; `:174-177`). Movement comes from the animation (root translation), intangibility from script.
- Both dodges accept entry from Guard / GuardOn / GuardReflect IASA (spot dodge and roll in the lists above) and from Wait; also from GuardOff IASA (spot dodge only).
- Air dodge (`ftCo_MS_EscapeAir`): entry `ftCo_80099A58` (`ftCo_EscapeAir.c:26-34`) on any L/R press, with `timer = x334` (DATA). Enter `ftCo_80099A9C` (`:54-66`): saves current velocity; if both stick axes are below `escapeair_deadzone` (DATA 2 floats) velocity = 0, else velocity = `escapeair_force * (cos, sin)` of the stick angle (`:36-52`). Per frame: unless the script sets `cmd_vars[0]` (skip decay), velocity is multiplied by `escapeair_decay` (DATA, `:98-107`); once the script sets it, normal air physics resume (`ft_80084DB0`). At animation end -> special fall with mobility `x340` and landing lag `x344` (DATA, `:68-75`, `ftCo_FallSpecial.c:55-59`). Landing during the air dodge -> `ftCo_LandingFallSpecial_Enter(false, x344)` (`:114-117`). IASA (`:77-96`): item-throw during the timer, and `ftCo_800C3B10` which, when true, scales x velocity by 0.1 (landed-on-platform edge behaviour, not examined).
- Intangible frames, total length, move distance: all in anim scripts / DATA; this tree only has the mechanism (hit status 0/1/2 via `ftaction.c:554-558`, values at `ftcoll.c:2764-2779`; in the collision pass status 2 skips hurtboxes at `ftcoll.c:1992`, status 1 plays the hit sound but deals no damage at `ftcoll.c:2019-2031`).

### 2.5 Tech and get-up

- Gate `ftCo_800986B0` [CanTech] (`ftCo_DownAttack.c:90-99`): not in `ftCo_800C5240` (a status check, UNCONFIRMED meaning), `fp->x680 < x250` and `fp->x684 >= x1C`. `x680` counts frames since the last L/R press (0 on press, +1 per frame, saturating at 255), `x684` keeps the previous value of `x680` at the press, i.e. the gap between the last two presses (`ft/fighter.c:2131-2136`). So a press of L/R within `x250` frames before landing counts, but only if the previous press was at least `x1C` frames earlier; mashing blocks it.
- On a floor hit during knockback states (`ftCo_Damage.c:1153-1158`, `:1205-1209`): first `ftCo_80098928` [tech roll] (`ftCo_PassiveStand.c:22-35`): needs the gate and left stick |x| `>= x254` -> PassiveStandF or PassiveStandB by stick direction (`:25-31`); else `ftCo_8009872C` [tech in place] -> `ftCo_Passive` (state 199, `ftCo_Passive.c:19-31`); else `ftCo_80097D40` -> DownBound (`ftCo_DownBound.c:120-146`, `:222-227`).
- Passive and PassiveStand: effects 1053, sounds; end of animation -> Wait; no IASA; roll uses `ft_80084FA8` physics (`ftCo_PassiveStand.c:49-66`). Intangibility: script DATA.
- DownBound (`ftCo_DownBound.c:235-241`): at animation end checks, in order, down-attack (`ftCo_80098400`, A/B or C-stick `x67C/x67D < x24C`, `ftCo_Down.c:82-101`), roll (`ftCo_Down_CheckInput`, stick |x| `>= x248` with a mostly horizontal angle `< x20_radians`, or C-stick, `ftCo_Down.c:18-52`), then DownWait.
- DownWait (`ftCo_DownBound.c:260-319`): timer `downwait.x0 = x424` frames (DATA); decrement per frame (not if `stamina_dead`); at <= 0 auto get-up (DownStand). IASA order: down attack (`ftCo_800984D4`, A/B press, `ftCo_DownAttack.c:25-46`), roll (`ftCo_Down_CheckInput`), stand-up (`ftCo_800980BC`, `ftCo_DownStand.c:17-34`: stick y `>= x244` with a vertical angle, or any L/R press).
- Missed tech "jab reset" is a function of the opponent's attack hitting a grounded `DownBound`/`DownWait` target and entering `DownDamage` (not in these files; UNCONFIRMED here).

### 2.6 Marth Counter (down special, `ftMars`)

- States 369 (ground) and 371 (air), hit states 370 (ground) and 372 (air) (`ftmarsspeciallw.c:36`, `:57`, `:334-339`, `:268`, `:275`). Enter sets `cmd_vars[1] = 0`, `mv.ms.speciallw.x0 = 0`, y velocity 0 (`:31-66`).
- Anim (`:68-89`, `:91-112`): the animation script writes `cmd_vars[1]`. When it becomes 1 the counter shield is created (`ftColl_8007B1B8` with the attribute shield descriptor `da->x64`, callback `ftMs_SpecialLw_80139140`), flag `x221B_b1 = true` (this flag marks "counter shield"), and `shield_unk0 = shield_unk1 = da->x60` (counter hitlag frames); `cmd_vars[1]` becomes 2 (counter active). When `cmd_vars[1]` is 0 the shield flag is cleared (`x221B_b0 = false`). The frame numbers of 1 and 0 are in the animation script (DATA).
- Trigger: an attack that passes the generic shield test against the counter shield (same code as shields, `ftcoll.c:1537-1578`) accumulates `x19A4` (strongest damage) and sets the flip direction. The counter shield does not use `x221A_b7`, so it takes no shield damage; the resolver calls `shield_hit_cb` (`fighter.c:2930-2939`). `x221B_b3` (front-only) and `x221B_b4` (blockable-hits-only) can restrict which attacks are caught (`ftcoll.c:1539-1560`); whether Marth's descriptor sets them is DATA (UNCONFIRMED).
- Callback `ftMs_SpecialLw_80139140` (`:306-344`): `facing_dir = specialn_facing_dir` (toward the attacker, `ftcoll.c:285-291`), `mv.ms.speciallw.x0 = (int)(x19A4 * da->x5C)` when `x19A4 > 0` (`da->x5C` is a counter damage multiplier, DATA), effect 1265 for Marth, camera/shake call `lb_800119DC`, then enter the hit state (370 grounded, 372 airborne). Callbacks are cleared (`:301-303`).
- Counterattack damage: `ftMars_SpecialLwHit_ApplyDamage` (`:194-206`) writes `speciallw.x0` into the active hitboxes via `ftColl_8007ABD0` only when the character is `Ft_Kind_Emblem` (Roy) -- the check at `:198` excludes Marth in this tree. How Marth's counter hitbox gets its damage is UNCONFIRMED here (probably the script hitbox); do not assume the formula applies to Marth.
- Hitlag: both fighters get minimum hitlag `shield_unk0` (`ftcoll.c:313-319`, `fighter.c:2988-2990`).
- Intangibility: during the counter window the shield hitbox replaces the hurtbox pass for incoming hits (`ftcoll.c:1537-1588` shield pass first, hurtbox pass only if not shielded); the motion flags `Ft_MF_KeepColAnimHitStatus | Ft_MF_SkipHit` (`ftmarsspeciallw.c:26-29`) apply to ground/air transitions. A separate script hit status is UNCONFIRMED.

## 3. Constants

DATA names use the offset in `ftCommonData` (`ft/types.h`). "(inferred)" = my reading of use, no comment in the repo. Frames/seconds given only where a value is known.

| name | value | source | meaning |
|---|---|---|---|
| shield_press_threshold | 0.25 | `ft/types.h:113` (datvalue comment) | analog trigger value that starts the powershield timer |
| analog_shoulder_deadzone | 0.3 | `ft/types.h:107` | trigger deadzone for the light-shield amount |
| z_press_analog_value | 0.35 | `ft/types.h:110` | analog value a digital Z press maps to (not used here) |
| powershield_input_window | DATA (frames) | `ftCommonData+2A0`, `ft/types.h:334` | max frames since the trigger crossed 0.25 for a press to powershield |
| x260 (startShieldHealth) | DATA | `ft/types.h:313` | max and initial shield HP |
| x264 | DATA | `ftCo_Guard.c:187` | minimum bubble size fraction |
| x268 | DATA (frames) | `ftCo_Guard.c:315` | minimum hold frames before release is honoured (`guard.x10`) |
| x278 | DATA | `ftCo_Guard.c:417` | per-frame shield HP drain while held, scaled by x2EC/x2F0 |
| x27C | DATA | `fighter.c:2839` | per-frame shield HP regeneration while not shielding |
| x280 (unkShieldHealth) | DATA | `fighter.c:2857`, `ftCo_Furafura.c:21` | shield HP after a break |
| x284, x288 | DATA | `fighter.c:2848-2854` | hit damage -> shield damage multiplier and flat per-frame add |
| x28C, x290 | DATA | `ftCo_Guard.c:653-660` | shieldstun slope and base |
| x294, x298, x2BC | DATA | `ftCo_Guard.c:689-699` | defender slide speed factor, cap, and non-powershield factor |
| x2A4 | DATA (frames) | `ftCo_Guard.c:912` | reflect hitbox duration of a powershield |
| x2A8 | DATA (units) | `ftCo_Guard.c:869` | reflect hitbox size |
| x2AC | DATA | `ftCo_Guard.c:870` | reflected projectile damage multiplier |
| x2B0 | DATA | `ftCo_Guard.c:871` | reflected projectile speed multiplier |
| x2B4 | DATA (frames) | `ftCo_Guard.c:913` | "no shield damage" duration of a powershield |
| x2B8 | DATA (frames, int) | `ftCo_Guard.c:1087` | window after a powershielded hit during which GuardOff can attack |
| x2D4, x2D8 | DATA | `ftCo_Guard.c:185` | bubble size at light/full press |
| x2DC, x2E0 | DATA | `fighter.c:2851-2853` | shield damage reduction at light/full press |
| x2E4, x2E8 (common) | DATA | `ftCo_Guard.c:657`, `:683` | shieldstun reduction at light/full press |
| x2EC, x2F0 | DATA | `ftCo_Guard.c:419` | drain multiplier at light/full press |
| x2F4 | DATA | `ftCo_Guard.c:204` | minimum bubble alpha (cosmetic) |
| fp+2E8 (not common) | DATA per character | `fighter.c:849` | GuardOn animation length in frames |
| x44C | DATA | `ftCo_Guard.c:156` | shield tilt smoothing (cosmetic) |
| x3CC | DATA (int) | `ftcoll.c:237` | clank damage threshold |
| x3D0, x3D4 | DATA | `ftcoll.c:209` | rebound frames = dmg * x3D0 + x3D4 |
| x3D8, x3DC | DATA | `ftCo_Rebound.c:28` | rebound push speed = frames * x3D8 + x3DC |
| co_attrs.clank_animation_length | DATA | `ft/types.h:862` | rebound animation end frame (rate normalisation) |
| x3E0, x3E4 | DATA | `fighter.c:3031` | attacker pushback on shield |
| x7A8 | DATA | `ftcoll.c:353` | phantom-hit overlap distance (unused branch commented out, `:1693`) |
| x194 (unkHitLagFrames) | DATA | `fighter.c:2992-2997` | hitlag cap |
| x198, x19C | DATA | `ftcommon.c:660` | hitlag = dmg * x198 + x19C |
| x1A0 | DATA | `ftcommon.c:663` | crouching victim hitlag factor |
| x1A4 | DATA | `ftcoll.c:2441` | electric hitlag factor (not applied to shield hits) |
| co_attrs.initial_shield_size | DATA | `ft/types.h:859` | bubble base size |
| co_attrs.shield_break_initial_velocity | DATA | `ft/types.h:860` | upward launch speed on break |
| x2F8, x2FC, x300, x304, x308 | DATA | `ftCo_Furafura.c:23-39`, `ftcommon.c:710` | dizzy base, add, per-frame decay, per-mash decay, stick latch threshold |
| x314 | -0.7 (comment) | `ftCo_Escape.c:216` | spot dodge stick y threshold |
| x318 (int) | DATA (frames) | `ftCo_Escape.c:205` | spot dodge stick window |
| x31C | DATA | `ftCo_Escape.c:44` | roll stick x threshold |
| x320 (int) | DATA (frames) | `ftCo_Escape.c:45` | roll stick window |
| x324 | DATA | `ftCo_Escape.c:66` | stored with roll state |
| x334 (int) | DATA (frames) | `ftCo_EscapeAir.c:30` | air dodge timer |
| escapeair_deadzone | DATA (2 floats) | `ft/types.h:370` | air dodge neutral deadzone |
| escapeair_force | DATA | `ft/types.h:372` | air dodge initial speed |
| escapeair_decay | DATA | `ft/types.h:373` | per-frame velocity factor while decaying |
| x340, x344 | DATA | `ftCo_EscapeAir.c:72-73` | special-fall mobility and landing lag after air dodge |
| x250 | DATA (frames) | `ftCo_DownAttack.c:93` | tech press window |
| x1C (int) | DATA | `ftCo_DownAttack.c:94` | tech anti-mash lockout gap |
| x254 | DATA | `ftCo_PassiveStand.c:26` | tech roll stick x threshold |
| x244, x248, x24C | DATA | `ftCo_DownStand.c:20`, `ftCo_Down.c:20`, `:84` | get-up stick y, roll stick x, attack C-stick recency |
| x424 (int) | DATA (frames) | `ftCo_DownBound.c:271` | DownWait length before auto get-up |
| MarsAttributes x5C, x60, x64 | DATA | `ftMars/types.h:58-60`, `ftmarsspeciallw.c:80-81`, `:323` | counter damage multiplier, counter hitlag frames, counter shield descriptor |
| animation lengths: GuardOff, Escape*, Passive*, Down*, ShieldBreak*, SpecialLw | DATA (Pl*.dat anim) | `ftAnim_IsFramesRemaining` end checks | all state durations not listed above |

## 4. Formulas

4.1 Bubble scale: `scale = ((1 - x264) * (HP / x260) * (light * (x2D8 - x2D4) + x2D4) + x264) * initial_shield_size` (`ftCo_Guard.c:177-191`). `light = (trigger - 0.3) / 0.7`, kept at its old value if negative (`:320-328`, `:405-415`).

4.2 Shield damage per frame in the resolver (`ft/fighter.c:2847-2854`): `HP -= x284 * (D_sum * (1 - (light * (x2E0 - x2DC) + x2DC))) + x288`, where `D_sum` is the sum over hits this frame of `max(0, int_damage + hitbox_shield_bonus)` (`ftcoll.c:299-300`, items `:759-766`). With a powershield hit (the no-damage flag `x221C_b2` active) nothing is added to `D_sum` (`ftcoll.c:297-310`). `int_damage = getEnvDmg(hit.damage)` = truncated damage, at least 1 if the float damage is nonzero (`ftcoll.c:101-107`). Break if HP < 0 after subtraction, then HP := x280 and the break state replaces the shield-hit state (`fighter.c:2855-2861`, `:2930-2933`).

4.3 Shieldstun of the defender: `f = x28C * (D_max * (1 - (light * (x2E8 - x2E4) + x2E4))) + x290` frames, with `D_max = x19A4` = strongest single hit damage this frame (`ftCo_Guard.c:653-660`, `:680-685`). The animation rate is set to `(anim_end_frame + 0.1) / f` (`:686-687`), so the state lasts about `f` frames. `f` is a float; the real duration depends on the engine rounding of animation frames. Powershield does not change this formula (the powershield flag only alters effect and slide, `:674-678`, `:690-692`).

4.4 Defender slide on shield: unless the hit element is Cape: `v = f * x294`; if the powershield no-damage window is NOT running, `v *= x2BC`; `v = min(v, x298)`; `ground_velocity = (attacker is behind us ? -v : +v)` away from the attacker (`ftCo_Guard.c:688-700`, direction from `specialn_facing_dir`, `ftcoll.c:282-292`).

4.5 Attacker pushback: `x1928 = light_of_defender * int_damage` (`ftcoll.c:268-269`); then `v = x1928 * x3E0 + x3E4` pushing the attacker away from the defender (`ft/fighter.c:3029-3034`). If the defender's light amount is 0 then `x1928 = 0`, the check at `:3029` is false and the attacker is not pushed. Only applied when the attacker is grounded (`ftcoll.c:268`).

4.6 Hitlag: `H = floor( floor(dmg * x198 + x19C) * mult )`, doubled by `x1A0` if the victim is in a squat state, then `H = max(H, x1964)` (minimum from counter/special shield data), `H = min(H, x194)` (`ftcommon.c:658-666`, `fighter.c:2985-2997`). The shield-hitting defender uses `dmg = x19A4` (`fighter.c:2939`); the attacker whose hit connected (including on a shield) uses `dmg = x1924` (`fighter.c:2959-2960`); a clanked fighter uses `dmg.int_value` (`:2947`). Hitlag for shield hits is therefore the same formula as for damage; no extra shield term in code.

4.7 Clank decision: for hitboxes A (damage a, int) and B (damage b, int): A is cancelled iff `a - x3CC < b`; B is cancelled iff `b - x3CC < a` (`ftcoll.c:236-253`). Both cancelled iff `|a - b| < x3CC`; the higher one survives iff `a >= b + x3CC` (integer arithmetic). The cancelled fighter records `int_value = a` only if `a` exceeds the current `int_value` (`ftcoll.c:205-206`).

4.8 Rebound: `rebound_frames = a * x3D0 + x3D4` where `a` is the cancelled fighter's own hitbox damage; push speed `= rebound_frames * x3D8 + x3DC`, sign away from the other fighter, applied once (`ftcoll.c:208-220`, `ftCo_Rebound.c:23-30`). The side comparison uses the fighters' x positions (`ftcoll.c:211-218`).

4.9 Reflect (projectile hits the powershield reflector): if `int_damage > reflect.max_damage` (= shield HP at powershield start) the reflect fails: item takes its damage, `damageOver` is set, the fighter's shield breaks (`ftcoll.c:585-621`, `fighter.c:2961-2962`). Else: the item records the reflector as `reflectGObj` with `damage_mul = x2AC`, `speed_mul = x2B0`; reflected item thinks (`it/item.c:1621-1672`): the owner becomes the reflector (and team) unless the item flags forbid it (`reflect.x20_behavior = 1` sets flag `xDCC.b2` which only matters for `It_Kind_M_Ball`) (`it/item.c:1631-1641`, `ftcoll.c:644-648`); each active hitbox damage becomes `trunc(damage * damage_mul + 0.99)` capped at `it_804D6D28->xD8` (DATA) (`it/item.c:1655-1669`); velocity is reversed times speed_mul for the items that implement it (`it/it_2725.c:368-369`, `it/it_279C.c:1469`). Direction for facing is by x position (`ftcoll.c:598-603`, `:634-639`).

4.10 Tech gate: `(frames_since_last_press < x250) and (gap_between_last_two_presses >= x1C)` with both counters saturating at 255 (`ft/fighter.c:2131-2136`, `ftCo_DownAttack.c:93-94`).

4.11 Dizzy time: `T0 = max(0, x2F8 - percent) + x2FC`; per frame `T -= x300`; per mash event `T -= x304` (button press of A B X Y L R, or a stick latch change past `x308` on either axis; each axis event counts once per change); end at `T <= 0` (`ftCo_Furafura.c:23-43`, `ftcommon.c:700-738`).

4.12 Air dodge velocity: neutral: zero; else `(escapeair_force * cos(theta), escapeair_force * sin(theta))`, theta = stick angle from `ftCommon_8007D9D4` (`ftCo_EscapeAir.c:36-52`); each frame multiply by `escapeair_decay` until the animation sets the skip flag (`:98-107`).

4.13 Marth Counter damage input: `speciallw.x0 = (int)(x19A4 * x5C)` (`ftmarsspeciallw.c:322-324`); consumed only for Emblem (see 2.6).

## 5. Interactions and edge cases

- Shield versus hurtbox order: in both the fighter pass (`ftcoll.c:1537-1588`) and the item pass (`ftcoll.c:1943-1977`) the shield sphere test comes before the hurtbox test; a hitbox touching both the bubble and a hurtbox hits the shield. "Shield poke" is a hitbox that overlaps a hurtbox without overlapping the bubble sphere (the sphere radius is `shield_hit.size`, set to the scaled bubble size every frame, `ftCo_Guard.c:195`, `lb/lbcollision.c:1585-1633`). A shrunken shield (low HP, or light press) therefore exposes hurtboxes; the test is hitbox capsule versus sphere in 3D with a z lock (`cur_pos.z` argument), so it is already 3D math but the z of the fighters is forced equal for 2D play.
- Shield side: the shield catches hits from any direction by default; `x221B_b3` limits to the facing side and `x221B_b4` to hitboxes with `x42_b4` (blockable) (`ftcoll.c:1539-1560`); Marth's counter descriptor flags are DATA.
- Grabs and hitboxes with `x42_b4 == 0` (not blockable) skip the reflect/absorb tests (`ftcoll.c:1844-1845`); grabs use `HitElement_Catch` and are not covered here (see ficha 03).
- Resolver priority chain (`ft/fighter.c:2872-2976`): (1) took knockback damage; (2) `dmg.x18a0` (a special hit); (3) shield-hit or break (`x19A4`); (4) clank/rebound (`int_value`); (5) dealt a hit (`x1914`); (6) attacker-side shield hit (`x1924`) / reflect damage-over / reflect / absorb. So if a clank and a damaging hit land on the same frame, damage wins and no rebound happens; shield-hit also beats rebound.
- Shield regeneration only runs while `x221A_b7` (bubble up) is false (`fighter.c:2837-2845`). So shield HP regenerates during GuardOff, spot dodge, any non-shield state, but not during Guard, GuardSetOff, GuardOn.
- GuardOn uses `shield_health != 0` as the entry condition (`ftCo_Guard.c:79`, `:104`): with HP exactly 0 the shield cannot be raised.
- Hitlag during shield hits: the defender can shield-DI the slide during hitlag (`ftCo_80093240`, `:717-733`, using the common SDI thresholds `sdi_min_stick_mag`, `sdi_stick_window`, `sdi_pos_scale`) and again post-hitlag (`:735-752`). The attacker gets hitlag from `x1924`.
- Powershield side effects: `ftCo_80094138` (`:1085-1089`), called on a powershielded hit (`ftcoll.c:304-309`) sets `guard.x1C = x2B8` and `guard.x10 = 0` (so release is immediately honoured) plus rumble, sound 104 and effect 27. While `guard.x1C > 0` GuardOff allows attacks (2.1). Both `x1C` and `x10` are cleared at shield entry and counted per frame (`:393`, `:430-435`, `:463-465`).
- Powershield is impossible against a Cape-element hit's slide only (no slide) and against hits stronger than the shield HP (reflector `max_damage`; `ftcoll.c:585`). A projectile whose damage equals the HP passes (`>` test), one above it breaks the shield.
- Physical hits on a powershield do not get reflected; reflection is only in the item pass (`ftcoll.c:1847-1855`), the fighter pass has no reflector test (only `x221C_b2`). Hit-by-fighter reflect via `reflect_hit` is not in `ftColl_80078C70`.
- Clank vs shield: the clank block precedes the shield test in `ftColl_80078C70` (`:1492-1535`, shield from `:1537`). A survived move continues to the shield/hurtbox test.
- Multi-hit moves: when a hitbox is cancelled the whole group (`hitbox->x4`, e.g. all hitboxes of a swing) is registered against that victim with type 3 (`ftcoll.c:177-185`, `lb/lbcollision.c:1832-1885`), so the swing cannot connect afterwards. A higher-damage hitbox of the same attack that wins keeps going.
- Items and projectiles vs sword (clank): `ftColl_80077970` (`ftcoll.c:836-862`) uses the same threshold; a clanked projectile records `xC48` (clank damage) and flips direction; the fighter gets the same `int_value` path (rebound possible if grounded and flagged, no both-grounded rule).
- Hit status: status 1 (invincible) plays the hit sound but no damage; status 2 (intangible) skips the hurtbox pass entirely (`ftcoll.c:1992-1993`, `:2019-2031`). Status resets to 0 on state change unless `Ft_MF_KeepColAnimHitStatus` (`fighter.c:974-977`). Timed invincibility (`x1990`, `x1994`) is a separate system (`ftcoll.c:2795-2832`).
- Air dodge: another air dodge is not blocked by this code; the "one air dodge" rule is outside these files (UNCONFIRMED).
- Spot dodge / shield drop on platforms: the PC port adds UCF (`ftCo_Escape.c:212-238`), so spot dodge input differs from vanilla near platform edges; only active when `pc_is_ucf_enabled()`.

## 6. Port notes for Marea Negra (notes only)

What transfers directly (state machine plus formulas, no 2D dependence):
- Whole shield model: HP, drain, regen, size, shield damage formula, shieldstun formula, break and dizzy. It is a pure scalar state machine; any numbers come from DATA.
- Clank rule and rebound duration formula: two integers compared, a threshold, a rebound state with no cancels. Server-friendly: one deterministic function on (damage A, damage B, grounded flags, hit flags).
- Powershield as a timed flag set at state entry (reflect window and no-damage window), not at the hit. This is the property that makes it judgeable on the server: the windows start at the defender's input, not at the attacker's contact.
- Resolver priority chain (damage beats shield beats clank) is a clean per-tick ordering for a server sim.

What is 2D only or must be redesigned:
- Both-grounded condition for clank, `facing_dir` and x-only comparisons for pushback and rebound direction, z locked to a plane (`cur_pos.z` argument in `ftcoll.c:1570`, `:2010`). In 3D the push direction is a vector away from the opponent, and the shield sphere test (capsule versus sphere) already works in 3D; there is no front-only shield in vanilla except the counter.
- Rolls/spot dodges are 2D rolls along the stage; a 3D duel would need circle-strafe dodges in 8 directions; the code gives only the entry thresholds (two stick windows) and the mechanism (hit status 2 from an anim command), not the numbers.
- The stick-window detection (`active_timer.lstick` frames since the stick left the deadzone) uses the sampling rate of a controller at 60 fps; mouse/keyboard input needs a defined equivalent.

Latency (Melee is zero-latency, the duel is 0 to 250 ms round-trip, snapshots 50 ms, remote players drawn about 100 ms back):
- Windows shorter than the latency (a 4-frame window is about 67 ms; one frame is 16.7 ms; 250 ms is 15 frames): the powershield window `powershield_input_window` and the tech window `x250`, plus any clank/rebound timing that depends on swing frames. Since the actual DATA values are not in code, the exact frame counts are unknown here; the community knows them but another ticket fills them. Anything below about 6 frames cannot be judged on arrival time at the server.
- Feasible ways to keep the feel, as options: (a) judge the defender's input at the defender's local time stamp (the shield press time), in the same way the melee hit is lag-compensated; the server rewinds to the defender's input frame and checks the window against the attacker's hit frame; (b) keep the powershield effect timers (reflect and no-damage windows) on the server clock from the input frame, as in the code (they start at state entry, `ftCo_Guard.c:910-914`), so a late-arriving press still opens a window that overlaps the hit; (c) buffering: the code already has a buffer-like counter for the trigger (`active_timer.trigger`) and for dodge sticks, which hints the engine wants "pressed within N frames before" semantics; keep them as server-side counters fed from timestamped inputs rather than arrival time; (d) the clank test is symmetric, so with lag compensation the server can evaluate both attackers at the same rewound frame; the rebound motion is then replayed for both clients from that frame.
- Hitlag (frozen fighters for `H` frames, `ftcommon.c:658-666`) with remote players about 100 ms in the past means the freeze plays visibly late on the remote side; the server can still apply it on the sim clock.
- Rebound/shieldstun are long enough (many frames) to be shown from state ids and a start tick without rewinding.
- Dodge intangibility frames (script DATA) are short; judging them at the defender's time stamp is the same lag-compensation trade-off as for the powershield.
- Server authoritative, client prediction: the shield-up state, GuardOn/Guard/GuardOff, and the dodge states are cheap to predict locally (they depend only on the player's own input); shield HP and break need the server because they depend on hits. The rebound and shieldstun states should be driven by the server and shown without prediction.

## 7. Open questions

1. All numeric DATA (ftCommonData fields listed in section 3, MarsAttributes, character anim lengths) are not in code. Needs a community-source ticket. Highest value for a duel: `powershield_input_window`, `x2A4`, `x2B4`, `x3CC`, `x3D0`-`x3DC`, `x28C/x290`, `x260/x278/x27C/x280`, `x250`, `x1C`, Marth's anim-script counter frames.
2. Which animation table index `0x25` is for `fp->x2E8` (`ft/fighter.c:849`) and what index 9 (`fp->x2E4`), 7, 8 and `0x23` are: no name mapping in this tree.
3. Whether aerial attacks clank in the original game: this code only clanks fighter-versus-fighter when both are grounded (`ftcoll.c:1495-1498`). Verify against the original binary or captured behaviour before relying on aerial clank.
4. Marth Counter damage: this tree applies the counter multiplier only for `Ft_Kind_Emblem` (`ftmarsspeciallw.c:198`). Where Marth's own counter hitbox damage comes from is not shown. Also whether Marth's counter shield sets `x221B_b3/b4` (front only, blockable only).
5. Meaning of `ftCo_800C5240` (negative tech gate), `ftCo_800C3B10` (air dodge IASA), `guard.x20` users (`ftCo_80091AD8`), and how `EscapeAir.timer = x334` is used besides decrementing (`ftCo_EscapeAir.c:77-96`).
6. Intangible and invincible frame ranges of roll, spot dodge, air dodge, tech, get-up and the break states: in animation scripts, not in code. The mechanism is shown (`ftaction.c:554-558`).
7. Down-damage and jab-reset states (`ftCo_DownDamage.c`) were not read; the jab reset claim in 2.5 is UNCONFIRMED.
8. The unused phantom-hit branch (`ftcoll.c:353`, `:1693`) and the `x7A8` constant: dead code in this port.
9. Shield-DI constants (`sdi_min_stick_mag`, `sdi_stick_window`, `sdi_pos_scale`, `x4BC`, `x4C0`) and the Yoshi shield (`ftYs_Shield_*`) were not examined; Yoshi's shield is different code.
10. Not covered in depth: shield tilt animation blend, Yoshi's double-jump shield, item catch from shield, UCF behaviour outside the spot-dodge drop, Cape and absorb (only the item absorb gate at `ftcoll.c:1857-1892` was read).
