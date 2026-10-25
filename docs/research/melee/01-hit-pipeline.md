# Melee hit pipeline (T-1024-01)

## 1. Summary

- **1. Contact uses a swept attack volume:** the hitbox travels from its previous bone-attached position to its current position; the body supplies a capsule at its current pose. `src/melee/ft/ftcoll.c:2500-2531`; `src/melee/lb/lbcollision.c:1738-1741`.
- **2. Slot priority is ascending:** attack slots are tested 0–3; a successful contact records the victim across active hitboxes sharing the same hit group. Separate groups can produce separate hits. `src/melee/ft/ftcoll.c:1463-1487`; `src/melee/ft/ftcoll.c:465-469`.
- **3. Trades are supported:** attack detection is registered at process priority 13, before damage/state resolution at 14. A detected hit does not immediately replace the victim’s state. `src/melee/ft/fighter.c:914-916`; `src/melee/ft/ftcoll.c:498-526`.
- **4. Damage and launch selection differ:** valid damage accumulates, while the greatest computed knockback chooses the launch result; equal knockback retains the first logged result. `src/melee/ft/ftcoll.c:361-370`; `src/melee/ft/ftcoll.c:2240-2304`.
- **5. Staling examines nine previous entries:** storage is a ten-entry ring; matching move IDs subtract DATA weights from a multiplier initially equal to 1. `src/melee/pl/plstale.c:51-64`; `src/melee/ft/ft_0881.c:335-354`.
- **6. Hitlag and hitstun are separate clocks:** hitlag freezes normal animation and physics; hitstun decrements through damage animation callbacks after thawing. `src/melee/ft/fighter.c:1675-1710`; `src/melee/ft/fighter.c:2182-2200`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:887-901`.
- **7. SDI is repeated positional movement during hitlag; ASDI is one exit displacement:** their distances and qualifying thresholds are DATA. DI subsequently rotates launch velocity. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:508-604`.
- **8. Knockback uses percent, pre-stale integer damage, weight, growth, base, and match/player ratios:** weight-set knockback substitutes a different inner expression. `src/melee/ft/ftcoll.c:2071-2122`; `src/melee/ft/ftcoll.c:2459-2474`.
- **9. Crouch, armor, and shield-input reductions are distinct:** crouch scales knockback; armor subtracts from it; an airborne shield-input condition scales launch speed. ASDI itself does not multiply knockback. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:124-151`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:329-336`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:480-604`.
- **10. Tumble depends on a DATA severity threshold:** ordinary attacks cannot bypass active hitstun; DamageFall allows attacks but has no direct airdodge check. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:295-315`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:1088-1094`; `src/melee/ft/kinds/ftCommon/ftCo_DamageFall.c:114-133`.
- **11. Feedback has separate timing:** collision sparks occur during detection/result selection; stronger launch sounds can be deferred until hitlag expires. `src/melee/ft/ftcoll.c:2249-2255`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:444-465`; `src/melee/ft/fighter.c:1432-1437`.

## 2. State machine

All citations are relative to `C:/DEV/_refs/melee-pc`.
The supplied timebase is 60 simulation frames/s: every duration `n` frames means `n/60` seconds.
Process priorities below are ordering labels, not elapsed frame counts.
`DATA` means the numeric value must be recovered from game data; no community values are substituted.

**Per-frame execution and contact processing**

| Order | Work | Evidence |
|---|---|---|
| Priority 0 | `Fighter_procHitlag` decrements freeze counters and can run the exit callback before animation/input processing. | `src/melee/ft/fighter.c:905`; `src/melee/ft/fighter.c:1408-1442` |
| Priority 1 | Advance animation/scripts and execute the state’s animation callback when the freeze flag is clear. | `src/melee/ft/fighter.c:906`; `src/melee/ft/fighter.c:1675-1710`; `src/melee/ft/ftanim.c:386-391` |
| Priority 3 | Sample/process inputs; invoke state input handling outside ordinary hitlag. | `src/melee/ft/fighter.c:908`; `src/melee/ft/fighter.c:1791-1804`; `src/melee/ft/fighter.c:2151-2161` |
| Priority 4 | Execute state physics, decay knockback, integrate movement; the hitlag callback runs outside the normal-physics gate. | `src/melee/ft/fighter.c:909`; `src/melee/ft/fighter.c:2182-2227`; `src/melee/ft/fighter.c:2378-2397` |
| Priority 6 | Execute stage collision through the current state’s collision callback, including while hitlag is active. | `src/melee/ft/fighter.c:910`; `src/melee/ft/fighter.c:2496-2515` |
| Priority 9 | Update attack positions and preserve previous positions; this routine is not wholly suppressed by hitlag. | `src/melee/ft/fighter.c:913`; `src/melee/ft/fighter.c:2572-2588` |
| Priority 12 | Process grab collision separately from ordinary attack collision. | `src/melee/ft/fighter.c:914`; `src/melee/ft/fighter.c:2609-2637` |
| Priority 13 | Reset temporary contact logs; test fighter/item/environment contacts; compute the selected launch result. | `src/melee/ft/fighter.c:915`; `src/melee/ft/fighter.c:2641-2655`; `src/melee/ft/ftcoll.c:82-87` |
| Priority 14 | Apply percent, modify knockback, enter reaction states, establish hitlag, then clear per-frame damage accumulators. | `src/melee/ft/fighter.c:916`; `src/melee/ft/fighter.c:2872-2911`; `src/melee/ft/fighter.c:2985-3060` |

Each fighter’s attack-collision callback treats that fighter as the prospective **recipient** and scans the fighter linked list for attackers; misleading local variable names do not reverse this data flow. `src/melee/ft/ftcoll.c:1399-1409`; `src/melee/ft/ftcoll.c:1472-1487`; `src/melee/ft/ftcoll.c:1619-1624`.

The scan skips self, ordinarily skips fighters belonging to the same player, and applies team/friendly-fire and thrown-fighter ownership gates. `src/melee/ft/ftcoll.c:1403-1427`.

Clank processing uses whether the scan has passed the recipient’s own list entry, avoiding an unrestricted duplicate clank test in both directions. `src/melee/ft/ftcoll.c:1402-1407`; `src/melee/ft/ftcoll.c:1429-1461`; `src/melee/ft/ftcoll.c:1492-1526`.

For each eligible attacker, its attack slots are visited in ascending index; body capsules are also visited in ascending index. `src/melee/ft/ftcoll.c:1463-1472`; `src/melee/ft/ftcoll.c:1593-1613`.

Shield testing precedes body testing for an applicable attack. `src/melee/ft/ftcoll.c:1537-1589`.

**Attack-volume lifecycle**

| State | Entry and per-frame behavior | Exit/input |
|---|---|---|
| `HitCapsule_Disabled` | Inactive slot; an explicit clear writes this state. | Script creation or explicit reset enables it; no direct player input. `src/melee/lb/forward.h:87-94`; `src/melee/ft/ftcoll.c:2584-2605` |
| `HitCapsule_Enabled` | Newly enabled: transform bone offset into current position, copy current into previous, avoiding a sweep from an old attack location. | Becomes `HitCapsule_Unk2` in the position update. `src/melee/ft/ftcoll.c:2505-2517` |
| `HitCapsule_Unk2` | Next update advances lifecycle state, then performs the ordinary position update. | Becomes `HitCapsule_Unk3`. `src/melee/ft/ftcoll.c:2519-2531` |
| `HitCapsule_Unk3` | Copy current position to previous; recompute current from bone and offset each update. | Persists until script/state logic disables or resets it. `src/melee/ft/ftcoll.c:2521-2534`; `src/melee/ft/ftcoll.c:2584-2605` |
| `HitCapsule_Unk4` | Enum exists, but the normal fighter position-update switch has no dedicated behavior for it. | UNCONFIRMED normal-fighter use. `src/melee/lb/forward.h:87-95`; `src/melee/ft/ftcoll.c:2533-2536` |

Creating into an already active slot with the same hit group changes its properties without automatically clearing victim history.
Creating a disabled slot or changing group initializes its lifecycle and copies history from another active member of that group, if one exists. `src/melee/ft/ftaction.c:317-335`; `src/melee/ft/ftcoll.c:187-199`.

**Body states**

| State | Contact behavior | Entry/exit and accepted input |
|---|---|---|
| Normal: `HurtCapsule_Enabled = 0` | Geometry can connect and ordinary damage can be logged when global protection gates are also clear. | Script/system setters change state; no intrinsic duration or direct input. `src/melee/lb/forward.h:50-54`; `src/melee/ft/ftcoll.c:477-499`; `src/melee/ft/ftcoll.c:2609-2638` |
| Invincible: `HurtCapsule_Disabled = 1` | Despite the name, ordinary fighter body testing still detects it; damage logging fails, but attacker hitlag/bookkeeping and protected-contact feedback can occur. | System/script state, duration owned by its caller. `src/melee/lb/lbcollision.c:1707-1743`; `src/melee/ft/ftcoll.c:465-478`; `src/melee/ft/ftcoll.c:533-537` |
| Intangible: `HurtCapsule_Intangible = 2` | Ordinary body geometry is skipped; global protection value 2 can skip the entire body-capsule loop. | System/script state, duration owned by its caller. `src/melee/lb/lbcollision.c:1707-1743`; `src/melee/ft/ftcoll.c:1590-1597` |

Global protection combines `x1988`, `x198C`, and `x221D_b6`; it is additional to individual capsule state. `src/melee/ft/ftcoll.c:477-478`; `src/melee/ft/ftcoll.c:2844-2854`.

**Damage and recovery states**

`x221C_b6` is the active-hitstun flag; `mv.co.damage.x0` is its countdown.
Each unfrozen damage animation update subtracts one frame (`1/60 s`), then clears the flag at zero. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:887-901`.

| State/family | Entry | Per-frame behavior and exit/input |
|---|---|---|
| `DamageHi1/2/3` | Grounded, high body capsule, severity bucket 0/1/2. | Shared Damage callbacks; normal input handling unlocks when hitstun clears; natural exit also waits for animation completion. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:65-77`; `src/melee/ft/ftmotionstates.c:960-992`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:916-997` |
| `DamageN1/2/3` | Grounded, middle capsule, bucket 0/1/2. | Same shared callbacks and hitstun gate. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:65-77`; `src/melee/ft/ftmotionstates.c:993-1025`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:960-997` |
| `DamageLw1/2/3` | Grounded, low capsule, bucket 0/1/2. | Same shared callbacks and hitstun gate. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:65-77`; `src/melee/ft/ftmotionstates.c:1026-1058`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:960-997` |
| `DamageAir1/2/3` | Airborne, bucket 0/1/2; body height does not alter this family. | Gravity plus friction while stunned; normal aerial handling after the flag clears; natural exit to Fall after animation completion. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:72-76`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:916-997` |
| `DamageFlyHi/N/Lw` | Bucket 3, selected by high/middle/low hurtbox. | During hitstun, gravity/friction and restricted input handling; after hitstun, DamageFall input checks; natural transition to DamageFall after animation completion. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:65-77`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:1076-1130` |
| `DamageFlyTop` | Bucket 3 with launch angle strictly between DATA angle bounds; also an ice-related override. | Same callbacks as the other non-roll DamageFly states. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:381-402`; `src/melee/ft/ftmotionstates.c:1125-1133` |
| `DamageFlyRoll` | Bucket 3; outside the top-angle selection, percent/chance conditions can choose roll. | Rotate model along total movement; transition to DamageFall as soon as hitstun clears, without waiting for animation completion. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:381-392`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:1160-1197` |
| `DamageFall` | Finished tumble reaction; entry forces airborne status if necessary and clamps air drift. | No animation countdown; accepts its IASA checks immediately; gravity/drift continue; horizontal stick flick can exit to Fall. `src/melee/ft/kinds/ftCommon/ftCo_DamageFall.c:96-143` |
| `ItemParasolDamageFall` | DamageFall entry detects a deployed parasol. | Alternate entry branch; full item-specific recovery is outside this ordinary-body-hit trace. `src/melee/ft/kinds/ftCommon/ftCo_DamageFall.c:102-108` |

Grounded reaction selection also checks the launch vector against the floor normal.
A launch pointing away from the surface becomes airborne; non-tumble movement into the floor is projected along its tangent.
A sufficiently downward tumble launch uses a DATA vertical bounce multiplier. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:338-375`.

A hit installs damage hitlag callbacks, resets SDI input timers to a sentinel, stores previous launch strength, and sets hitstun active. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:424-432`.

**Inputs and the first actionable frame**

- While ordinary hitstun remains active, Damage and DamageFly call `doIasa`, rather than their normal action checks. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:960-984`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:1088-1094`.
- A jump input can store the remaining hitstun count for a later buffered-jump check; the acceptable remaining count is DATA `x1D0` frames (`x1D0/60 s`). `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:905-913`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:953-955`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:971-975`.
- Special encoded knockback angles enable an exception: after DATA `x7F0` frames (`x7F0/60 s`), an airborne descending victim can attempt the specified up-special or aerial-jump escape checks. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:85-88`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:934-949`.
- That exception is angle-gated, not a universal fixed-frame attack/airdodge cancellation rule. Its angle range excludes 361. `src/melee/ft/ftcoll.c:2477-2483`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:934-949`.
- Once the hitstun flag clears, ordinary Damage dispatches to Wait or Fall input handling according to grounded status. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:960-980`.
- Normal Fall handling includes airdodge before aerial attack; airdodge requires a pressed L or R button. `src/melee/ft/kinds/ftCommon/ftCo_Fall.c:114-143`; `src/melee/ft/kinds/ftCommon/ftCo_EscapeAir.c:26-33`.
- DamageFly instead dispatches to DamageFall input handling after hitstun. That list accepts specials, item actions, aerial attacks and jumps, but contains no direct airdodge call. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:1088-1094`; `src/melee/ft/kinds/ftCommon/ftCo_DamageFall.c:114-133`.
- DamageFall’s horizontal flick requires `abs(stick.x) ≥ DATA x210` and horizontal active timer `< DATA x214` frames (`x214/60 s`); success enters Fall. `src/melee/ft/kinds/ftCommon/ftCo_DamageFall.c:125-129`.
- Aerial attack checks accept a pressed A or the qualifying C-stick input; attack animation startup is a subsequent move-specific DATA duration. `src/melee/ft/kinds/ftCommon/ftCo_AttackAir.c:53-85`; `src/melee/ft/kinds/ftCommon/ftCo_AttackAir.c:125-132`.
- The hitstun countdown runs in animation processing before input processing, so the flag can clear and an eligible action can begin within the same simulation frame. This is source-order inference. `src/melee/ft/fighter.c:906-908`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:887-901`.

**Special-element branches adjoining the ordinary pipeline**

| State | Entry, per-frame work, exit/input |
|---|---|
| `DamageSong` | Nap/Sleep routes here for non-sandbags; initialize a DATA-based percent/handicap timer, decrement/mash it, then enter SongWait when its entry animation finishes or SongRv when the timer expires. IASA is empty. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:613-618`; `src/melee/ft/kinds/ftCommon/ftCo_DamageSong.c:19-72` |
| `DamageSongWait` | Continue the same decrement/mash timer; expiry enters SongRv. No ordinary IASA actions. `src/melee/ft/kinds/ftCommon/ftCo_DamageSong.c:75-102` |
| `DamageSongRv` | Recovery animation; completion returns through grounded idle entry. No ordinary IASA actions. Duration is animation DATA `A` frames (`A/60 s`). `src/melee/ft/kinds/ftCommon/ftCo_DamageSong.c:99-121` |
| `DamageBind` | Eligible grounded Disable hit enters this state; timer decreases and mash subtracts additional time; expiry returns to idle. Airborne entry goes to DamageFall instead. `src/melee/ft/kinds/ftCommon/ftCo_DamageBind.c:16-79` |
| `DamageScrew` / `DamageScrewAir` | Eligible Scball hit selects grounded/air variant, then supplies character-DATA upward velocity; ordinary IASA is empty; animation completion enters special-fall handling. `src/melee/ft/kinds/ftCommon/ftCo_DamageScrew.c:18-76` |
| `DamageIce` | Sufficient ice severity enters a separate frozen state; timer starts from received damage × DATA factor; decrement/mash expires into DamageIceJump; IASA is empty. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:472-476`; `src/melee/ft/kinds/ftCommon/ftCo_DamageIce.c:139-144`; `src/melee/ft/kinds/ftCommon/ftCo_DamageIce.c:306-334` |
| `DamageIceJump` | Ice expiry enters this state with character-DATA velocity and DATA escape timer; decrement one frame (`1/60 s`) per update, then enter Fall; IASA is empty. `src/melee/ft/kinds/ftCommon/ftCo_DamageIce.c:463-509` |

These special timers are not the ordinary knockback-derived hitstun formula; their detailed tuning remains DATA. `src/melee/ft/kinds/ftCommon/ftCo_DamageSong.c:19-47`; `src/melee/ft/kinds/ftCommon/ftCo_DamageBind.c:34-64`; `src/melee/ft/kinds/ftCommon/ftCo_DamageIce.c:142-144`.

## 3. Constants

`Cxxx` below means `ftCommonData` field at hexadecimal offset `+xxx`.
A DATA duration `N` always means `N` frames and `N/60` seconds.

| Name | Value / units | Source | Meaning |
|---|---|---|---|
| Fighter attack slots | 4 slots | `src/melee/ft/types.h:1507` | Normal fighter hitbox array. |
| Hitbox group | `HitCapsule +04 x4` | `src/melee/lb/types.h:34-38`; `src/melee/ft/ftaction.c:317-325` | Shares victim bookkeeping. |
| Pre-stale integer damage | `+08 unk_count` | `src/melee/lb/types.h:37`; `src/melee/ft/ftcoll.c:2471-2474` | Damage term used by knockback. |
| Effective hitbox damage | `+0C damage` | `src/melee/lb/types.h:38`; `src/melee/ft/ftcoll.c:2473-2474` | Staled floating-point damage. |
| Bone-local offset | `+10 b_offset`, DATA position units | `src/melee/lb/types.h:39`; `src/melee/ft/ftaction.c:337-341` | Offset transformed with attached bone. |
| Hit radius | `+1C scale`, DATA units | `src/melee/lb/types.h:40`; `src/melee/lb/lbcollision.c:1732-1741` | Radius, with optional fighter scale. |
| Launch angle | `+20 kb_angle`, DATA degrees/encoded angle | `src/melee/lb/types.h:41`; `src/melee/ft/ftaction.c:343` | Ordinary angle or special encoding. |
| Growth | `+24 x24`, DATA | `src/melee/ft/ftaction.c:344` | Knockback growth input. |
| Weight-set knockback | `+28 x28`, DATA | `src/melee/ft/ftaction.c:345` | Selects alternate formula if nonzero. |
| Base knockback | `+2C x2C`, DATA knockback units | `src/melee/ft/ftaction.c:351` | Additive knockback term. |
| Element | `+30 element`, DATA enum | `src/melee/lb/types.h:45`; `src/melee/ft/ftaction.c:352` | Element/reaction routing. |
| Shield damage / sound | `+34 x34`; `+38 sfx_severity`; `+3C sfx_kind` | `src/melee/lb/types.h:46-48`; `src/melee/ft/ftaction.c:353-355` | Scripted contact properties. |
| Clank / rebound flags | `x40_b0`, `x40_b1`, DATA booleans | `src/melee/ft/ftaction.c:348-349` | Hitbox interaction eligibility. |
| Air / ground victim flags | `x40_b2`, `x40_b3`, DATA booleans | `src/melee/ft/ftaction.c:356-357` | Which grounded status can be hit. |
| Fighter-hit eligibility | `x42_b5`, default 1 on creation | `src/melee/ft/ftaction.c:359`; `src/melee/ft/ftcoll.c:1474-1481` | Gate for fighter collision. |
| Ignore fighter scale | `x43_b1`, DATA boolean | `src/melee/ft/ftaction.c:347`; `src/melee/lb/lbcollision.c:1732-1735` | Radius and offset scale behavior. |
| Attached joint / positions | `+48 jobj`; `+4C x4C` current; `+58 x58` previous | `src/melee/lb/types.h:77-79`; `src/melee/ft/ftcoll.c:2515-2531` | Bone attachment and attack sweep. |
| Contact outputs | `+64 hurt_coll_pos`; `+70 coll_distance` | `src/melee/lb/types.h:80-81`; `src/melee/lb/lbcollision.c:1738-1741` | Contact position and overlap. |
| Victim lists | 12 entries each at `+74`, `+D4` | `src/melee/lb/types.h:82-83` | Ordinary and phantom-contact histories. |
| Rehit interval field | `x40_b4`, 8 bits; DATA `N` frames (`N/60 s`) | `src/melee/lb/types.h:53`; `src/melee/lb/lbcollision.c:1865-1875` | Used for timed victim entries on applicable collision types. |
| Hurt capsule | State, two local offsets, radius/scale, bone, cached endpoints, bone index | `src/melee/lb/types.h:91-107` | Body-volume definition. |
| Fighter hurt additions | Height: low 0 / middle 1 / high 2; grabbable flag | `src/melee/lb/types.h:110-114` | Reaction height and grab eligibility. |
| Script size/offset conversion | `0.003906 × encoded value` | `src/melee/ft/ftaction.c:337-341` | Literal conversion used by this checkout. |
| Stale history | 10 stored entries; 9 examined | `src/melee/pl/types.h:144-149`; `src/melee/ft/ft_0881.c:339-352` | Ring storage versus multiplier calculation. |
| Stale penalties | DATA `Fighter_804D6548[i].v`, `i=0..8` | `src/melee/ft/fighter.c:185-197`; `src/melee/ft/ft_0881.c:345-350` | PlCo `ftLoadCommonData[3]`, not an `ftCommonData` field. |
| Maximum percent | 999 percent | `src/melee/ft/fighter.c:2680-2684` | Damage display/state cap. |
| Weight normalization | DATA `C0F4`, `C0F8` | `src/melee/ft/types.h:221-222` | Weight coefficient and numerator. |
| Knockback cap | DATA `C108`, knockback units | `src/melee/ft/types.h:226`; `src/melee/ft/ftcoll.c:2109-2111` | Formula output clamp. |
| Knockback coefficients | DATA `C110`, `C114`, `C118`, `C11C`, `C120` | `src/melee/ft/types.h:228-232` | Percent, damage, fixed-variant and shell coefficients. |
| Launch speed coefficient | DATA `C100`, units/frame per knockback unit | `src/melee/ft/types.h:224` | Converts knockback to launch speed. |
| Crouch knockback multiplier | DATA `+124 kb_squat_mul` | `src/melee/ft/types.h:233` | Squat/SquatWait reduction. |
| Minimum post-armor knockback | DATA `+104 kb_min` | `src/melee/ft/types.h:225` | Floor after armor subtraction. |
| Metal armor | DATA `+6F0 metal_armor`, knockback units | `src/melee/ft/types.h:586` | Added armor subtraction. |
| Ice / charging-smash KB multipliers | DATA `+718 kb_ice_mul`; `+7C4 kb_smashcharge_mul` | `src/melee/ft/types.h:596`; `src/melee/ft/types.h:644` | Victim-state modifiers. |
| Sakurai aerial angle | DATA `+144 x144_radians`, radians | `src/melee/ft/types.h:241` | Airborne angle for 361. |
| Sakurai grounded ramp | DATA `C148` degrees; `C14C`, `C150` knockback units | `src/melee/ft/types.h:242-244` | Grounded interpolation parameters. |
| Hitstun multiplier | DATA `C154`, frames/knockback unit | `src/melee/ft/types.h:245` | Ordinary hitstun duration. |
| Reaction thresholds | DATA `C158`, `C15C`, `C160`, hitstun-scale units | `src/melee/ft/types.h:246-248` | Severity buckets; bucket 3 selects tumble. |
| Hitlag coefficients | DATA `C198` frames/damage; `C19C` frames (`C19C/60 s`) | `src/melee/ft/types.h:262-263` | Freeze-duration calculation. |
| Hitlag crouch multiplier | DATA `C1A0` | `src/melee/ft/types.h:264` | Separate from crouch knockback. |
| Electric victim hitlag multiplier | DATA `C1A4` | `src/melee/ft/types.h:265`; `src/melee/ft/ftcoll.c:2440-2442` | Applied from selected electric launch result. |
| Hitlag cap | DATA `+194 x194_unkHitLagFrames`: `N` frames (`N/60 s`) | `src/melee/ft/types.h:261` | Maximum calculated freeze. |
| DI angle coefficient | DATA `C1A8`, degrees | `src/melee/ft/types.h:266` | Nominal maximum rotation for unit stick input. |
| Held L/R speed multiplier | DATA `C1AC` | `src/melee/ft/types.h:267` | Exit-hitlag launch-speed scaling. |
| Airborne shield-input speed multiplier | DATA `C190` | `src/melee/ft/types.h:260` | Conditional launch-speed reduction. |
| Its input windows | DATA `C18C` and `C01C` frames (`/60 s` each) | `src/melee/ft/types.h:259`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:498-499` | Recent press and preceding press spacing. |
| SDI threshold/window/distance | DATA `+4B0 sdi_min_stick_mag`; `+4B4 sdi_stick_window`: `N` frames (`N/60 s`); `+4B8 sdi_pos_scale` units/input | `src/melee/ft/types.h:461-463` | Repeated hitlag displacement. |
| ASDI distance | DATA `+4BC x4BC`, units × stick component | `src/melee/ft/types.h:464` | One exit displacement. |
| Stick crossing thresholds | DATA `+008 horizontal_stick_smash_deadzone`; `+00C vertical_stick_smash_deadzone` | `src/melee/ft/types.h:101-104` | Input-timer reset thresholds. |
| Airborne KB decay | DATA `+204 x204_knockbackFrameDecay`, speed units/frame | `src/melee/ft/types.h:290` | Constant vector-magnitude decay. |
| Ground KB friction multiplier | DATA `C200` | `src/melee/ft/types.h:289`; `src/melee/ft/fighter.c:2240-2247` | Scales surface/character friction. |
| Landed KB cap | DATA `+164 max_grounded_kb_on_landing`, speed units | `src/melee/ft/types.h:249` | Clamp when converting airborne KB to grounded KB. |
| Character movement data | DATA `ftCo_DatAttrs +05C gravity`, `+060 terminal_velocity`, `+070 aerial_friction`, `+088 weight` | `src/melee/ft/types.h:846-857` | Character-specific launch integration. |
| Ground friction | DATA `ftCo_DatAttrs +018 ground_friction` | `src/melee/ft/types.h:829` | Character-specific grounded decay. |
| Recent-hit velocity window | DATA `C0FC`: `N` frames (`N/60 s`) | `src/melee/ft/types.h:223`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:219` | Replace versus combine existing KB velocity. |
| Special-angle escape | DATA `+7E8 unk_kb_angle_min`, `+7EC unk_kb_angle_max`; `+7F0 x7F0`: `N` frames (`N/60 s`) | `src/melee/ft/types.h:653-654`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:85-88` | Restricted escape branch. |
| Downward floor bounce | DATA `+1E8 x1E8_radians`; `+1EC x1EC` multiplier | `src/melee/ft/types.h:282-283` | Downward tumble launch adjustment. |
| Phantom overlap threshold | DATA `+7A8 x7A8`, distance units | `src/melee/ft/types.h:637`; `src/melee/ft/ftcoll.c:350-357` | Separates shallow contact from a normal hit. |

Bone indices, capsule sizes/offsets, move angles/damage/flags, and animation lengths are character/move DATA.
The creation and initialization paths read these values rather than supplying universal constants. `src/melee/ft/ftaction.c:317-368`; `src/melee/ft/ftcoll.c:2750-2760`.

## 4. Formulas

`trunc(x)` means C-style conversion toward zero; for ordinary nonnegative damage this equals floor.
`Cxxx` follows section 3; unknown coefficients remain DATA.

**Geometry**

Let `Hprev`, `Hnow` be previous/current attack centers, and `A`, `B` the body capsule endpoints.
The attack sweep is segment `Hprev→Hnow`, with the hitbox radius; the body is segment `A→B` with its bone-scaled radius. `src/melee/lb/lbcollision.c:1732-1741`.

The broadphase expansion is `hitRadius + hurtRadius × broadphaseScale`.
The fighter wrapper supplies `broadphaseScale = 3 × victimScaleY`. `src/melee/lb/lbcollision.c:1172-1174`; `src/melee/lb/lbcollision.c:1738-1741`.

After finding closest axis points, let their world-space separation be `d`.
The narrowphase transforms those points into hurt-bone local space and computes `effectiveHurtRadius = hurtRadius × d / localSeparation`. `src/melee/lb/lbcollision.c:1404-1436`.

Contact succeeds when `d ≤ hitRadius + effectiveHurtRadius`.
The recorded overlap is `hitRadius + effectiveHurtRadius − d`; approximately coincident axes have an explicit success branch. `src/melee/lb/lbcollision.c:1416-1420`; `src/melee/lb/lbcollision.c:1434-1450`.

Only the attack center’s motion is swept here; the hurt capsule arguments contain its current endpoints, not previous/current endpoint pairs. `src/melee/lb/lbcollision.c:1698-1741`.

**Staling and received damage**

For the nine visited historical positions, `staleMultiplier = 1 − Σ penalty[i]` over entries whose move ID matches.
Scanning stops early at an empty move ID; move ID 1 always receives multiplier 1. `src/melee/ft/ft_0881.c:335-354`.

The stale penalties are DATA from `Fighter_804D6548`, loaded through PlCo’s common-data pointer table.
This calculation contains no explicit fresh-move bonus above 1. `src/melee/ft/fighter.c:185-197`; `src/melee/ft/ft_0881.c:337-354`.

For a released charged smash, `chargedDamage = inputDamage × [1 + (maximumDamageMultiplier−1) × chargedFrames/holdFrames]`.
Charge durations are DATA frames (`/60 s`). Other smash states return input damage unchanged. `src/melee/ft/ft_0DF0.c:33-41`.

Hitbox setup stores `d = trunc(scaledChargedDamage)` into `unk_count`.
It stores `scaledChargedDamage × staleMultiplier` into floating-point `damage`; DebugRom-level behavior bypasses staling. `src/melee/ft/ftcoll.c:2465-2474`; `src/melee/ft/ft_0881.c:363-375`.

For ordinary body contact, `receivedDamage = hit.damage × victimBehaviorMultiplier`.
Additional branches multiply by DATA `C128` for the specified third-party grab relationship and DATA `C714` when the victim is frozen. `src/melee/ft/ftcoll.c:376-390`.

For reaction/hitlag damage, `integerDamage = 0` if damage is zero; otherwise `max(1, trunc(receivedDamage))`.
The victim retains the largest such integer among applicable hits; the attacker retains its largest dealt integer. `src/melee/ft/ftcoll.c:451-488`; `src/melee/ft/ftcoll.c:367-369`.

The victim’s temporary percent increment is the **sum of floating-point received damage**, not that maximum integer. `src/melee/ft/ftcoll.c:361-370`.

On resolution, `percentNew = min(999, percentOld + temporaryDamage)`, subject to the special protection gate in the damage routine.
The resulting floating-point percent is written to player state. `src/melee/ft/fighter.c:2668-2687`.

**Ordinary knockback**

Definitions: `p = trunc(victim percent before application)`, `Dsum = temporary received damage`, `d = hit.unk_count`, `G = growth`, `B = base`, `W = victim weight`.
The stamina branch substitutes DATA `C6D4` or `C6D8` for `p`. `src/melee/ft/ftcoll.c:2055-2065`; `src/melee/ft/ftcoll.c:2081-2106`.

Define `w = W × C0F4`. `src/melee/ft/ftcoll.c:2087-2088`.

Define `weightFactor = C0F8 − (w × C0F8)/(1+w)`.
Algebraically this equals `C0F8/(1+w)`, but the source evaluates the subtractive form. `src/melee/ft/ftcoll.c:2075-2077`.

Define `innerNormal = C110 × (p+Dsum) + C114 × d × (p+Dsum)`. `src/melee/ft/ftcoll.c:2103-2106`.

Then `Kraw = defenseRatio × attackRatio × matchRatio × [0.01 × G × (C11C × weightFactor × innerNormal + C120) + B]`. `src/melee/ft/ftcoll.c:2071-2079`; `src/melee/ft/ftcoll.c:2103-2106`.

Finally `Kformula = min(Kraw, C108)`.
Player attack/defense ratios and the match ratio enter through the normal fighter wrapper. `src/melee/ft/ftcoll.c:2109-2122`.

This uses pre-stale integer damage `d` in one term, but includes staled received damage in `Dsum`.
Replacing both with one “damage” variable changes the mechanics. `src/melee/ft/ftcoll.c:507-519`; `src/melee/ft/ftcoll.c:2103-2106`; `src/melee/ft/ftcoll.c:2471-2474`.

**Weight-set variant**

If `WSK = hit.x28 ≠ 0`, replace the normal inner expression with `innerFixed = C118 × C110 + C114 × C118 × WSK`.
The same weight factor, growth, base, ratios, and cap remain. `src/melee/ft/ftcoll.c:2090-2111`.

Thus this branch removes the ordinary percent/damage inner expression but does **not** remove victim weight from the formula. `src/melee/ft/ftcoll.c:2087-2097`.

**Post-formula modifiers and armor**

Starting from nonzero knockback, apply crouch multiplier for `Squat` or `SquatWait`, ice multiplier for `DamageIce`, and charging-smash multiplier while charging. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:124-136`.

Model-scale adjustment follows those multipliers, using `ftCo_CalcYScaledKnockback` and a DATA coefficient from `Fighter_804D6524`.
Then `armor = max(armor0, armor1) + (metal ? DATA metal_armor : 0)`. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:138-147`.

The final ordinary armor adjustment is `K = max(kb_min, scaledKnockback − armor)`.
It subtracts knockback rather than using a single universal “ignore hits below damage X” rule. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:143-151`.

For scale function `F(value,s,a)`: return `value` when `a=0`; for negative `a`, return `value/F(1,s,−a)`; otherwise use `value×[1+(s−1)a]` when `s≥1` or `a≤1`, and `value×s/a` otherwise. `src/melee/ft/ftchangeparam.c:9-21`.

A separate damage-budget protection subtracts damage from `x1834`; if the budget becomes negative, only the overflow becomes effective damage.
This is distinct from knockback armor. `src/melee/ft/ftcoll.c:490-499`.

**Launch angle**

For an ordinary angle other than 361, `θ = degreesToRadians(hitAngle)`.
Angles in the DATA special range also arm the restricted escape state. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:83-90`.

For 361 while airborne, `θ = DATA C144_radians`. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:92-93`.

For grounded 361 with `K < C14C`, `θ = 0`.
Otherwise `θ = radians(min(C148, 1 + C148 × (K−C14C)/(C150−C14C)))`.
The literal `+1` degree is present in this checkout. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:94-105`.

Encoded angle 362 uses the contacted hurt capsule midpoint relative to the contact position to derive a direction/angle, with an almost-zero horizontal-separation branch.
It is not the Sakurai-angle branch. `src/melee/ft/ftcoll.c:2357-2379`.

For sufficiently strong ice, the initial angle is adjusted toward vertical using the angle of the sum of its unit direction and the upward unit direction. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:238-250`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:323-325`.

**Launch speed, DI, and reductions**

Initial launch speed magnitude is `v = K × C100`.
Before floor adjustments, `vx = −facing × v × cosθ`, `vy = v × sinθ`; the reaction facing is chosen from the hit result. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:319-336`.

The airborne shield-input branch multiplies `v` by DATA `C190`.
It requires an eligible airborne movement state, `x680 ≤ C18C`, and `x684 ≥ C01C`. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:329-336`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:480-505`.

`x680` is the age of an L/R press; `x684` preserves the preceding interval on a new press.
This is a shield-input condition, not a downward-ASDI condition. `src/melee/ft/fighter.c:2131-2135`.

For DI, let `v=(vx,vy)`, `s=(sx,sy)`, and `cross = vx×sy−vy×sx`.
For non-negligible speed, `q = sign(cross) × cross² / |v|²`, then `θnew = atan2(vy,vx) + radians(C1A8)×q`. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:530-555`.

DI reconstructs velocity with its previous magnitude and the new angle.
For unit-magnitude stick input, perpendicular input reaches rotation magnitude DATA `C1A8` degrees; parallel input gives zero rotation.
The routine itself does not explicitly clamp `q`. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:538-557`.

After DI, held L/R multiplies launch speed magnitude by DATA `C1AC`, retaining the angle. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:593-603`.

**Hitlag**

For integer damage `dH`, first `t0 = trunc(dH×C198 + C19C)`.
Next `t1 = trunc(t0×elementMultiplier)`.
For pre-hit `Squat` or `SquatWait`, take `t2 = trunc(t1×C1A0)`; otherwise `t2=t1`. `src/melee/ft/ftcommon.c:658-665`.

Resolution then raises this to any `x1964` minimum and, for positive duration, caps it at DATA `C194`.
The resulting `H` frames last `H/60 s`. `src/melee/ft/fighter.c:2985-3007`.

The attacker’s ordinary dealt-hit path uses its maximum dealt integer damage.
The victim’s launched-hit path uses its maximum received integer damage and the saved pre-hit motion state. `src/melee/ft/ftcoll.c:473-488`; `src/melee/ft/fighter.c:2829-2830`; `src/melee/ft/fighter.c:2905-2911`; `src/melee/ft/fighter.c:2948-2952`.

Default hitlag multiplier is 1; the selected electric launch result writes DATA `C1A4` to the victim.
This ordinary path does not also write that electric multiplier to the attacker. `src/melee/ft/fighter.c:3059`; `src/melee/ft/ftcoll.c:2440-2442`.

**SDI and ASDI**

An SDI step qualifies when hitlag permits SDI, `sx²+sy² ≥ C4B0²`, and either axis’s active timer is `< C4B4`.
It adds `(sx,sy)×C4B8` to position and resets both timers to 254, a sentinel rather than a playable duration. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:508-525`.

Horizontal active timers reset to zero on a qualifying signed threshold crossing; sustained direction increments them, and neutral sets the sentinel.
The vertical path follows its corresponding threshold logic. `src/melee/ft/fighter.c:1930-1983`; `src/melee/ft/fighter.c:1991-2045`.

ASDI occurs once in the exit-hitlag callback: use qualifying C-stick input preferentially, otherwise qualifying left-stick input, and add `stick×C4BC` to position. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:563-587`; `src/melee/ft/ft_0DF1.c:109-116`.

The exit callback performs ASDI, any specified post-hit protection, DI, then held-L/R speed scaling, in that order. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:574-603`.

There is no direct “ASDI down multiplies knockback by X” operation in this callback.
Downward ASDI changes position and therefore subsequent ground/collision handling. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:574-603`; `src/melee/ft/fighter.c:2496-2515`.

**Hitstun and movement after hitlag**

Let `hFloat = K×C154`.
The stored hitstun count is `S = max(1, trunc(hFloat))` frames, nominally `S/60 s` of unfrozen damage updates. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:290-299`.

Severity is bucket 0 if `hFloat<C158`, 1 if `<C15C`, 2 if `<C160`, otherwise 3.
Selection compares the untruncated value; bucket 3 ordinarily selects a DamageFly state. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:300-330`.

At hitlag expiry, priority 0 thaws the fighter; priority 1 can decrement hitstun immediately; priority 3 can accept a newly eligible action.
Consequently, contact-to-action timing must preserve this phase order rather than blindly append two exclusive countdowns. `src/melee/ft/fighter.c:905-908`; `src/melee/ft/fighter.c:1428-1439`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:887-901`.

For airborne knockback velocity, `|vKB|` decreases by DATA `C204` per unfrozen update, preserving direction until it reaches zero.
The source zeros it when its magnitude is below that decrement. `src/melee/ft/fighter.c:2214-2227`.

Gravity acts on **self velocity**: `selfVy = max(selfVy−gravity, −terminalVelocity)`.
Position subsequently receives self velocity plus decayed knockback velocity. `src/melee/ft/ftcommon.c:480-485`; `src/melee/ft/fighter.c:2378-2383`.

During hitstun the ordinary airborne damage physics supplies gravity and horizontal deacceleration, without normal stick drift.
After hitstun, normal airborne physics restores drift and fast-fall checks. `src/melee/ft/ft_084E.c:34-40`; `src/melee/ft/ft_081B.c:1371-1382`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:987-995`.

Grounded knockback speed approaches zero by `surfaceFrictionMultiplier × characterGroundFriction × C200`.
Its vector is reconstructed along the floor tangent. `src/melee/ft/fighter.c:2231-2251`; `src/melee/ft/ftcommon.c:184-196`.

On landing conversion, grounded knockback is clamped to `±max_grounded_kb_on_landing`.
This is a clamp and tangent projection, not a universal ASDI-down scalar. `src/melee/ft/ftcommon.c:199-217`.

## 5. Interactions and edge cases

**Hit-once history and priorities**

- A normal contact records the victim in every active hitbox with the same group `x4`; subsequent membership tests skip that victim. `src/melee/ft/ftcoll.c:465-469`; `src/melee/lb/lbcollision.c:2673-2685`.
- Therefore “one move hits once until IDs reset” is only an approximation: the relevant identity is the hit group and its shared victim history, not just the animation or slot number. `src/melee/ft/ftaction.c:317-325`; `src/melee/ft/ftcoll.c:187-199`.
- Explicit `ftColl_8007B064` enables the selected slot and clears its two victim lists; disabling alone only changes lifecycle state. `src/melee/ft/ftcoll.c:2584-2605`; `src/melee/lb/lbcollision.c:1794-1814`.
- Lowest slot wins among otherwise eligible same-group contacts because it is tested first and records the victim; a lower slot that misses does not prevent a higher slot from connecting. `src/melee/ft/ftcoll.c:1463-1487`; `src/melee/ft/ftcoll.c:465-469`.
- Different groups can register separately; the victim accumulates damage and selects the strongest launch result afterward. `src/melee/ft/ftcoll.c:329-330`; `src/melee/ft/ftcoll.c:367-369`; `src/melee/ft/ftcoll.c:2294-2304`.
- The shared rehit field is not proof of universal fighter rehit behavior: ordinary fighter contacts insert victim entries with collision type 0, which stores no timeout. `src/melee/ft/ftcoll.c:467-468`; `src/melee/lb/lbcollision.c:1865-1875`.
- Timed entries on supported collision types decrement and clear at zero; item update code explicitly calls this routine. Ordinary fighter creation does not expose the item-style rehit assignment. `src/melee/lb/lbcollision.c:1950-1975`; `src/melee/it/itcoll.c:930`; `src/melee/it/itanimlist.c:137`; `src/melee/ft/ftaction.c:343-371`.

**Trades, clanks, and multiple contacts**

- Mutual eligible body contacts can be collected before either fighter’s damage-state resolution, supporting trades; clank/shield/protection gates can prevent one or both body hits. `src/melee/ft/fighter.c:914-916`; `src/melee/ft/ftcoll.c:1492-1613`.
- The ordinary fighter clank test requires both fighters grounded, applicable clank flags, and other eligibility gates; airborne body trades do not automatically become sword clanks. `src/melee/ft/ftcoll.c:1492-1503`.
- Clank suppression compares integer hitbox damage against the other hitbox damage minus DATA `C3CC`; both sides can be suppressed. `src/melee/ft/ftcoll.c:235-253`.
- The strongest-knockback selection uses strict `>`; equal values retain the earlier contact log’s launch data. `src/melee/ft/ftcoll.c:2294-2304`.
- A move instance enters the stale ring once: repeated contacts with the same move ID and attack-instance pair do not insert duplicates. `src/melee/pl/plstale.c:51-64`.
- Staling is evaluated when hitbox damage is created/adjusted, while successful contact updates the stale queue afterward. An already stored hitbox damage value is not recalculated by that insertion itself. `src/melee/ft/ftcoll.c:2459-2474`; `src/melee/ft/ftcoll.c:1258-1264`.

**Freeze is selective**

- The normal animation/script path, damage countdown, time-since-hit counter, physics callback, capture timer, and ledge cooldown stop under the ordinary freeze gate. `src/melee/ft/fighter.c:1675-1710`; `src/melee/ft/fighter.c:2182-2200`.
- Input sampling/timers continue, and pressed/released buttons accumulate during hitlag rather than being replaced each frame. `src/melee/ft/fighter.c:1772-1787`; `src/melee/ft/fighter.c:1922-1952`.
- Stage collision, hitbox position updates, and the damage hitlag callback still run; SDI can therefore change position during freeze. `src/melee/ft/fighter.c:2394-2397`; `src/melee/ft/fighter.c:2496-2515`; `src/melee/ft/fighter.c:2586-2588`.
- Some other timers continue too: global protection timers are updated outside the normal animation-freeze gate. A blanket “pause every timer” implementation would differ. `src/melee/ft/fighter.c:1479-1505`; `src/melee/ft/fighter.c:1675`.
- Exit-hitlag ASDI/DI runs at priority 0, before that frame’s priority-3 input processing; it uses the input already cached at that point. This is source-order inference. `src/melee/ft/fighter.c:905-908`; `src/melee/ft/fighter.c:1436-1439`; `src/melee/ft/fighter.c:2811-2819`.
- Hitlag does not globally make a victim intangible: the attack-collision callback has separate sleeping/collision-disable gates, and hurt/protection state still determines contact eligibility. `src/melee/ft/fighter.c:2641-2648`; `src/melee/ft/ftcoll.c:1590-1641`.

**Being hit again and meeting the floor**

- A later valid hit can enter a fresh damage reaction; the old launch velocity may be replaced or combined according to the recent-hit DATA window. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:217-235`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:871-877`.
- Within that recent-hit window, new launch velocity replaces the previous components.
Outside it, opposite-signed components add; same-signed components retain the greater absolute magnitude. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:219-234`.
- Tumble ground contact tries the two tech handlers before falling back to the down-bound handler; wall/ceiling contact similarly offers specialized handlers. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:1134-1157`.
- DamageFall ground contact uses the same tech-then-down-bound sequence through its collision callback. `src/melee/ft/kinds/ftCommon/ftCo_DamageFall.c:141-143`; `src/melee/ft/kinds/ftCommon/ftCo_DamageIce.c:54-58`.
- Down-bound entry selects face-up/down states and converts knockback to grounded movement; subsequent knockdown recovery is a separate state family. `src/melee/ft/kinds/ftCommon/ftCo_DownBound.c:169-196`.
- Ice has explicit being-hit behavior: incoming damage reduces the frozen timer by a DATA multiplier, and fire sets that timer to zero. `src/melee/ft/kinds/ftCommon/ftCo_DamageIce.c:296-303`.

**Reaction cosmetics tied to the hit**

| Decision | Rule and timing | Evidence |
|---|---|---|
| Normal hit spark | Selected normal effect uses ordinary spark below DATA `C3F0` knockback, effect `0x3F3` otherwise; occurs during hit-result processing. | `src/melee/ft/ftcoll.c:1142-1151`; `src/melee/ft/ftcoll.c:2165-2173`; `src/melee/ft/ftcoll.c:2249-2255` |
| Element effect | Element indexes a hit-effect table: normal/fire/electric/slash/ice have distinct entries; several special elements have no ordinary spark. | `src/melee/ft/ftcoll.c:542-560`; `src/melee/ft/ftcoll.c:2174-2186` |
| Camera quake | Airborne bucket-3 reaction requests small/medium/large quake according to `hFloat` versus DATA `C170`, `C174`; requested during reaction entry. | `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:453-465` |
| Background flash | Nonzero damage plus element-specific knockback threshold DATA `C178..C188` selects flash IDs 2–6. | `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:183-212` |
| Launch sound | `hFloat ≥ C20C` selects sound `0x4F` and character voice table `x20`; otherwise `≥C208` selects `0x50` and table `x1C`; playback is deferred to hitlag expiry, or immediate when no hitlag is created. | `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:444-450`; `src/melee/ft/kinds/ftCommon/ftCo_DamageFall.c:84-92`; `src/melee/ft/fighter.c:1432-1434`; `src/melee/ft/fighter.c:3009-3010` |
| Contact hit sound | Selection is scripted `sfx_kind×3+sfx_severity`, not dynamically calculated from percent or knockback here; protected hits use their severity-indexed alternative. | `src/melee/lb/lbcollision.c:239-255`; `src/melee/ft/ftcoll.c:1106-1122` |

DATA feedback thresholds are fields `ftCommonData +170..188`, `+208/+20C`, and `+3F0`; their numeric values are not embedded in these decisions. `src/melee/ft/types.h:252-258`; `src/melee/ft/types.h:291-292`; `src/melee/ft/ftcoll.c:1148`.

## 6. Port notes for Marea Negra

These are implementation considerations, not adopted design decisions.
Network timings below are supplied project context or arithmetic from that context, not Melee network behavior.

- **Preserve simulation phases.** Detect contacts before resolving reaction states if reproducing trades; immediate per-contact state mutation would change the order demonstrated by priorities 13 and 14. `src/melee/ft/fighter.c:914-916`.
- **Preserve group identity.** A server hit receipt would need attack instance, hit group, target, and reset generation to represent the shared history faithfully; slot ID alone does not identify the hit-once contract. `src/melee/ft/ftaction.c:317-325`; `src/melee/ft/ftcoll.c:465-469`.
- **Preserve authoritative bone trajectories.** The transferable collision primitive is a previous-to-current attack sweep against body capsules; matching the feel also requires matching attack timing and bone-local placement. `src/melee/ft/ftcoll.c:2500-2531`; `src/melee/ft/ftaction.c:327-341`.
- **Keep numeric damage channels separate.** Staled floating damage, pre-stale integer damage, maximum integer hitlag damage, and accumulated percent each have different consumers. `src/melee/ft/ftcoll.c:361-390`; `src/melee/ft/ftcoll.c:473-519`; `src/melee/ft/ftcoll.c:2471-2474`.
- **A hitlag implementation needs selective clocks.** Animation/normal physics stop, while defender input and collision corrections remain active; freezing the entire entity would remove SDI and alter timer behavior. `src/melee/ft/fighter.c:1675-1710`; `src/melee/ft/fighter.c:1772-1787`; `src/melee/ft/fighter.c:2394-2397`.
- **The supplied 50 ms snapshot interval equals 3 simulation frames (`0.05 s`).** A presentation snapshot alone cannot communicate every intermediate input/contact phase of the demonstrated per-frame pipeline. Supplied network context; simulation dependency: `src/melee/ft/fighter.c:905-916`.
- **The supplied 100 ms interpolation delay equals 6 frames (`0.1 s`).** Rewinding a body hit to the attacker’s displayed time raises a separate question about which defender-time protection and reaction inputs accompany that historical pose. Supplied network context; protection gates: `src/melee/ft/ftcoll.c:1590-1641`.
- **RTT 100–250 ms equals 6–15 frames (`0.1–0.25 s`).** Assuming symmetric transport only for illustration, one-way delay would be 3–7.5 frames (`0.05–0.125 s`); actual asymmetry remains unknown. Supplied network context and arithmetic.
- **Short-window comparisons remain conditional on DATA.** An SDI input window `C4B4` frames is shorter than that RTT whenever `C4B4<6..15`; exact comparison awaits extraction. `src/melee/ft/types.h:462`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:514-515`.
- **The same applies to hitlag and recovery.** Any hitlag `H`, special escape window, or first-action opportunity shorter than packet transit can finish before a remote confirmation arrives. Durations are governed by the traced countdowns, not network delay. `src/melee/ft/fighter.c:1428-1439`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:887-901`.
- **Possible feel-preserving note:** timestamped defender inputs could be judged on a defined defender timeline for SDI/DI/recovery; the server would need bounded historical state and explicit reconciliation rules. This is a port possibility, not an existing Melee feature. Mechanical inputs: `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:508-604`.
- **Possible presentation note:** predict local attack motion and provisional impact feedback, then reconcile confirmed contacts; duplicate effects would need stable contact identity. This is a port possibility; Melee’s contact/effect source is `src/melee/ft/ftcoll.c:2249-2255`.
- **Moving decks require explicit historical transforms.** World-space bone sweeps and floor normals are inputs to collision/launch handling; rewinding fighters without the relevant ship transform could produce mismatched geometry. Port inference from `src/melee/ft/ftcoll.c:2515-2531`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:339-375`.
- **The collision math is three-dimensional, but launch control is mostly planar.** DI uses XY velocity; launch position integration adds no knockback Z component. Choosing an analogous third-person launch plane remains a design question. `src/melee/lb/lbcollision.c:1404-1415`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:530-557`; `src/melee/ft/fighter.c:2381-2383`.
- **Platformer-specific behavior needs separate judgment:** vertical gravity, airborne tumble, floor bounce, wall/ceiling tech destinations, and Sakurai ground/air angle selection do not automatically map to a deck-bound sword duel. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:92-105`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:338-375`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:1134-1157`.
- **The transferable timing distinction is loss of control versus animation completion.** An action may become legal after hitstun clears while its reaction animation remains; a port that always waits for the clip end would add recovery. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:916-929`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:960-980`.

## 7. Open questions

- **DATA: numeric common coefficients.** Hitlag slope/base/cap, knockback coefficients, hitstun multiplier, tumble thresholds, Sakurai parameters, DI limit, decay, crouch factors, and SDI/ASDI distances remain symbolic. Field definitions: `src/melee/ft/types.h:221-294`; `src/melee/ft/types.h:461-464`.
- **DATA: nine stale penalties.** Their table is loaded through `ftLoadCommonData[3]`; numeric penalty values were not established from this source trace. `src/melee/ft/fighter.c:185-197`; `src/melee/ft/ft_0881.c:345-350`.
- **DATA: per-character/move content.** Actual damage, bone paths, active frames, group/reset events, capsule dimensions, animation lengths, weight and gravity require the applicable character archives/scripts. Consumption paths: `src/melee/ft/ftaction.c:317-368`; `src/melee/ft/ftcoll.c:2750-2760`; `src/melee/ft/types.h:846-857`.
- **UNCONFIRMED: fixed controller-port tie priority.** The traced code proves linked-list iteration and ascending hitbox slots, not a universal “port 1 always wins” rule; exact list construction/scheduler ordering was not independently established. `src/melee/ft/ftcoll.c:1403-1407`; `src/melee/ft/ftcoll.c:1463-1472`.
- **UNCONFIRMED: rendered-frame naming at boundaries.** Countdown and callback order are established, but no frame-stepped runtime capture was performed to reconcile community “frame 1” terminology with contact-frame/thaw-frame labeling. `src/melee/ft/fighter.c:1408-1439`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:887-901`.
- **UNCONFIRMED: universal fighter rehit-rate support.** The timed field and item update are confirmed; ordinary fighter hits use non-expiring type-0 history. No universal timed fighter rehit path was found in the reviewed creation/contact code. `src/melee/ft/ftaction.c:343-371`; `src/melee/ft/ftcoll.c:465-469`; `src/melee/it/itcoll.c:930`.
- **UNCONFIRMED: a separate ASDI-down knockback multiplier.** None appears in the exit callback; confirmed alternatives are displacement, floor handling, crouch scaling, and shield-input speed scaling. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:124-130`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:329-336`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:563-603`.
- **UNCONFIRMED: exact retail equivalence of all PC paths.** This checkout contains explicit PC behavior changes, including a Slippi wobbling hook branch; source agreement alone is not runtime proof of untouched NTSC-U 1.02 behavior. `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:704-726`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:810-814`.
- **Phantom-contact limitation:** shallow overlap takes a separate half-damage-style log path; nearby comments describe an intended hurtbox-priority fix, but the active loop still contains an unconditional break. Treat the comments as commentary, not proof that the fix runs. `src/melee/ft/ftcoll.c:410-442`; `src/melee/ft/ftcoll.c:1693-1713`.
- **Address-named functions remain semantically partial.** This ficha reports their observed conditions and calls rather than assigning unsupported universal meanings to every flag. Examples: `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:623-664`; `src/melee/ft/ftcoll.c:2844-2854`.
- **Not covered in full:** knockdown/tech recovery windows, shield-specific damage rules, throws/grabs, projectile ownership/reflection, and every character-specific armor callback. Their boundaries are visible in `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:754-877`; `src/melee/ft/kinds/ftCommon/ftCo_Damage.c:1134-1157`; `src/melee/ft/fighter.c:2930-2974`.
- **Not covered in full:** special-element mash formulas, ice wall-bounce behavior, and item-specific recovery beyond their entry/exit overview. These use separate timers and collision logic: `src/melee/ft/kinds/ftCommon/ftCo_DamageSong.c:19-47`; `src/melee/ft/kinds/ftCommon/ftCo_DamageBind.c:34-64`; `src/melee/ft/kinds/ftCommon/ftCo_DamageIce.c:340-461`.