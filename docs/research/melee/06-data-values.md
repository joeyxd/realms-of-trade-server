# Melee data values (T-1024-06)

Scope: numbers Melee keeps in data (PlCo.dat as `struct ftCommonData`, Pl<Char>.dat) or derives by formula, gathered from community pages. All timing is NTSC at 60 fps (1 frame = 16.67 ms). Only numbers and formulas are copied. Any value with no source is UNKNOWN. Confidence: H = stated plainly on a page that also agrees with the decomp or a second source; M = one wiki page; L = inferred (for example from an icon file name) or ambiguous.

Method note: values were read through a page summarizer (WebFetch), so a few table cells (angles shown as icons) are marked L. The decomp `types.h` names only a handful of ftCommonData fields; most are `xNNN`. I mapped a value to an offset only where the decomp code proves what the field does (checked in `src/melee/ft/*.c`). Everything else says "offset unknown".

URL shorthand: SW = https://www.ssbwiki.com/ ; Marth moves are SW + `Marth_(SSBM)/<Move_name>`.

## A. Common mechanics

### A1. Knockback, hitlag, hitstun, launch

| name | value | ftCommonData field / offset | source URL | conf |
|---|---|---|---|---|
| Knockback formula | `((((p/10 + p*d/20) * 200/(w+100) * 1.4) + 18) * s + b) * r`; p = victim percent after the hit, d = damage, w = weight (100 if weight-independent), s = KBG/100, b = BKB, r = ratio modifiers | constants 1.4 and 18 not mapped (offset unknown) | SW Knockback | M |
| Launch speed | knockback * 0.03 | offset unknown | SW Knockback | M |
| Launch speed decay per frame | 0.051 | `x204_knockbackFrameDecay` at +204 (decomp use: fighter.c:2217-2225) | SW Knockback (value); field name from C:/DEV/_refs/melee-pc/src/melee/ft/types.h | H |
| Hitstun frames | floor(knockback * 0.4); 100 KB = 40 frames | offset unknown | SW Hitstun | H |
| Landing out of hitstun | if launch speed > 0.5 (= 16.67 KB) on touching ground, the character enters landing animation (about 4 frames) instead of carrying hitstun | `max_grounded_kb_on_landing` at +164 (name only; value UNKNOWN) | SW Hitstun | L |
| Tumble threshold | 80 KB (the page says crouch cancel raised it from 60 to 80; I read this as the Melee tumble threshold, not fully clear) | offset unknown | SW Crouch_cancel | L |
| Hitlag (frames) | floor(floor(floor(d/3 + 3) * e) * c); d = damage, e = electric multiplier, c = crouch multiplier | `x194_unkHitLagFrames` at +194 exists, meaning not proven | SW Hitlag | M |
| Hitlag cap | 20 frames | offset unknown | SW Hitlag | M |
| Electric hitlag multiplier | 1.5, rounded down, victim only | offset unknown | SW Hitlag | M |
| Crouch cancel hitlag multiplier | 0.666667 (victim only) | offset unknown | SW Hitlag (0.666667); SW Crouch_cancel says "0.67x" (same value, rounded) | M |
| Crouch cancel knockback multiplier | 0.666667 (about 0.67) | `kb_squat_mul` at +124 (decomp ftCo_Damage.c:130; numeric value not read) | SW Knockback; SW Crouch_cancel | M |
| Sakurai-angle lift threshold | ground hit lifts only above 32 KB | offset unknown | SW Crouch_cancel | L |
| Frozen KB penalty / bounce loss | 0.25x / 20% | offset unknown | SW Knockback | M |
| Smash charge interruption bonus | 1.2x | offset unknown | SW Knockback | L |
| Hitstun cancel (air dodge or aerial before hitstun ends) | None in Melee: full 0.4*KB hitstun applies. Cancel at 13 frames (air dodge) and 25 frames (aerial) exists from Brawl on only | n/a | SW Hitstun | M |

### A2. DI, SDI, ASDI

| name | value | field / offset | source URL | conf |
|---|---|---|---|---|
| DI max angle | about 18 degrees of trajectory change | offset unknown | SW Directional_influence | M |
| SDI distance per input | 6 units per pulse | `sdi_pos_scale` at +4B8 is multiplied by the stick (decomp ftCo_Damage.c:518); value UNKNOWN, the 6 is the wiki figure | SW Smash_directional_influence | M |
| SDI window | applies from the 2nd hitlag frame onward; a move with under 2 hitlag frames cannot be SDI'd | `sdi_stick_window` at +4B4 (int, decomp ftCo_Damage.c:514; value UNKNOWN) | SW Smash_directional_influence | M |
| SDI stick threshold | "sufficient length", number not given | `sdi_min_stick_mag` at +4B0 (value UNKNOWN) | SW Smash_directional_influence | M |
| ASDI distance | 3 units per pulse, in the stick direction after hitlag ends; frame count not given | offset unknown | SW Smash_directional_influence | M |
| Shield SDI | 0.66x of regular SDI distance (about 3.96 units) | `sdi_pos_scale` also used in ftCo_Guard.c:727 | SW Smash_directional_influence | L |

### A3. Shield

| name | value | field / offset | source URL | conf |
|---|---|---|---|---|
| Shield max HP | 60 (effective about 85.71 given the 0.7 damage multiplier) | `x260_startShieldHealth` at +260 (decomp fighter.c:426, 2838, ftCo_Guard.c:183) | SW Shield | H (value from wiki, field from decomp) |
| Depletion per frame held (full shield) | 0.28 HP (16.8 HP/s) | offset unknown | SW Shield | M |
| Regeneration per frame | 0.07 HP (4.2 HP/s) | offset unknown | SW Shield | M |
| Time to break from full if held | about 3.58 s | derived | SW Shield_break | M |
| Break threshold | 0 HP (the page gives no separate threshold) | n/a | SW Shield | M |
| HP after a break | 30 (50% of max) | `x280_unkShieldHealth` at +280 (decomp ftCo_Furafura.c:21,37 sets shield_health to it; fighter.c:2857) | SW Shield, SW Shield_break | H |
| Shield damage taken | damage * 0.7 (full shield). Light shield: multiplier = a + 0.7, a = 1 - 0.5*(s-0.3)/0.7 | offset unknown | SW Shield | M |
| Light shield analog factor | s = n/140, n from 43 to 140 (s about 0.307 lightest); Z-button shield s = 0.35 | offset unknown | SW Shield | M |
| Shield size | size = (HP * a / 60) * 0.85 + 0.15 | offset unknown | SW Shield | M |
| Light shield depletion per frame | (a + 0.1) * 0.14; lightest about 0.0167/frame (about 1 HP/s) | offset unknown | SW Shield | M |
| Shieldstun (frames, full shield) | (d * 0.45 + 2) * 200/201 | offset unknown | SW Shield | M |
| Shieldstun (light shield) | (d * (a + 0.3) * 1.5 + 2) * 200/201 | offset unknown | SW Shield | M |
| Defender shield pushback | (floor(d) * 0.09 + 0.4) * shield, capped at 2; shield = 0.6 normal, 1 for perfect shield | `x3E8_shieldKnockbackFrameDecay` +3E8 and `x3EC_shieldGroundFrictionMultiplier` +3EC relate to shield pushback decay (names only) | SW Shield | M |
| Attacker pushback on shield hit | floor(d) * 0.07 + 0.02 | offset unknown | SW Shield | M |
| Light shield pushback | defender (d*(a+0.09)+0.4)*shield; attacker d*a + 0.02 | offset unknown | SW Shield | M |
| Shield raise to drop | shield cannot be dropped for 8 frames, then 15 frames of drop lag | offset unknown | SW Shield (8 + 15); SW Perfect_shield (15) | M |
| Shield drop after powershield | attack possible after 1 frame instead of 15 | offset unknown | SW Perfect_shield | M |

### A4. Powershield

| name | value | field / offset | source URL | conf |
|---|---|---|---|---|
| Powershield window, physical | first 4 frames of shield (hit within frames 1-4) | `powershield_input_window` at +2A0, int, compared against the trigger timer (decomp ftCo_Guard.c:74, 93). Doc comment: frames after the trigger becomes non-zero in which a full press gives a powershield. Value UNKNOWN (not in code) | SW Perfect_shield | M |
| Powershield window, projectile | 2 frames | offset unknown | SW Perfect_shield | M |
| Reflect damage | reflected projectile deals half damage (0.5x) | offset unknown | SW Perfect_shield | M |
| Reflect speed multiplier | UNKNOWN (page gives none) | UNKNOWN | - | - |
| Powershield hitlag and shieldstun | same as a regular shield for physical attacks; no shieldstun for projectiles | n/a | SW Perfect_shield | M |
| Powershield pushback | defender factor 1.0 instead of 0.6 | n/a | SW Shield | M |

### A5. Shield break, dizzy, grabs

| name | value | field / offset | source URL | conf |
|---|---|---|---|---|
| Shield-break stun (dizzy) | (400 - p) + 90 frames, p = percent at the break; 490 at 0%, minimum 90 at 400%+. No recovery animation after it ends | offset unknown | SW Dizzy | M |
| Mash reduction while dizzy | 3 frames per input | offset unknown | SW Dizzy | M |
| Grab hold duration | floor(76 + 1.6*p - 15*h) frames; p = victim percent, h = victim rank disadvantage (0 in a duel) | timer is set in ftcommon.c:690; step per frame is `grab_timer_decrement` at +3A4 (value UNKNOWN); mash threshold `x3A8` +3A8 (field named only in code) | SW Grab | M. Note: I did not verify 76/1.6 against the decomp |
| Mash reduction while grabbed | 6 frames per mash input | `x3A8` at +3A8 passed as mash threshold (ftCo_CaptureWait.c:110) | SW Grab | M |
| Pummel and grab timer | the page gives no formula; "accumulated damage increases the period an opponent is grabbed for" (percent from pummels raises the formula above) | n/a | SW Pummel | L |
| Pummel damage and length | 3% for every character; 24 frames for most (Marth: 3%, hitbox on frame 7, 24 frames total) | n/a | SW Pummel; SW Marth_(SSBM)/Pummel | M |
| External hit on a grabbed victim | damage halved; victim breaks free if the reduced damage totals at least 6%; 20-frame grab flinch during which no escape | n/a | SW Grab | M |
| Grab release advantage | ground: both stuck 29 frames, no advantage. Air: both 29 frames, no advantage (Bowser excepted) | n/a | SW Grab_release | M |
| Regrab rule | UNKNOWN (page states none) | UNKNOWN | - | - |

### A6. Clank, rebound

| name | value | field / offset | source URL | conf |
|---|---|---|---|---|
| Priority range | 9% (damage difference above 9% means the stronger move wins) | offset unknown | SW Priority; SW Rebound | M |
| Both within 9% | both moves end and both characters rebound | n/a | SW Priority | M |
| Rebound duration | R = ceil(0.559 * (floor(d) + 10)), d = damage dealt; Dr. Mario 0.615. Frozen for the stronger attack's hitlag while hitboxes are disabled | offset unknown | SW Priority; SW Rebound | M |
| Grab vs hitbox | grab has full priority over a standard hitbox | n/a | SW Priority | M |

### A7. Tech, dodges, L-cancel, staling

| name | value | field / offset | source URL | conf |
|---|---|---|---|---|
| Tech window | 20 frames after a digital L/R press | offset unknown | SW Teching | M |
| Early-press penalty | another digital press in the preceding 40 frames closes the window (no tech) | n/a | SW Teching | M |
| Tech in hitlag | press on any hitlag frame except the last: 1-frame window; last hitlag frame: full 20 | n/a | SW Teching | M |
| Tech lockout | 40 frames after hitlag ends; end lag after tech about 6 frames (Pikachu/Pichu 2) | n/a | SW Teching | M |
| Generic roll | total 31 frames, intangible 4-19, 12 vulnerable at the end | n/a | SW Rolling | M |
| Generic spot dodge | total 22 frames, intangible 2-15 (14), 7 vulnerable at the end | n/a | SW Spot_dodge | M |
| Generic air dodge | 49 frames, intangible 4-29 (26); landing lag not listed | `escapeair_force` +338, `escapeair_decay` +33C, `escapeair_deadzone` +32C (names only; values UNKNOWN) | SW Air_dodge | M |
| L-cancel window | L, R or Z pressed up to 7 frames before landing; pressing during hitlag still works if you land up to 6 frames after hitlag ends | offset unknown | SW L-canceling | M |
| L-cancel lag reduction | landing animation at double speed: lag halved, rounded down | n/a | SW L-canceling | M |
| Stale-move queue | last 9 moves that hit a character or object (shield hits do not enter) | n/a | SW Stale-move_negation | M |
| Stale reductions | position 1..9 reduce by 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01 (multiplier 0.91 ... 0.99). A move in several slots sums its reductions. No freshness bonus in Melee. KO resets the queue | n/a | SW Stale-move_negation | M |

## B. Marth attributes (NTSC)

| name | value | source URL | conf |
|---|---|---|---|
| Weight | 87 (PAL 85) | SW Marth_(SSBM) | M |
| Walk speed | 1.6 (libmelee MaxWalkSpeed 1.6, agrees) | SW Marth_(SSBM); libmelee characterdata.csv | H |
| Initial dash | 1.5 | SW Marth_(SSBM) | M |
| Dash / run speed | 1.8 | SW Marth_(SSBM) | M |
| Traction | 0.06 (libmelee Friction 0.06, agrees) | SW Marth_(SSBM); libmelee characterdata.csv | H |
| Jump squat | 4 frames | SW Marth_(SSBM) | M |
| Gravity | 0.085 (libmelee agrees) | SW Marth_(SSBM); libmelee characterdata.csv | H |
| Fall speed (terminal) | 2.2 (libmelee TerminalVelocity 2.2, agrees) | SW Marth_(SSBM); libmelee | H |
| Fast fall speed | 2.5 (libmelee agrees) | SW Marth_(SSBM); libmelee | H |
| Air speed | 0.9 (PAL 0.85); libmelee: AirSpeed 0.9, AirFriction 0.005, AirMobility 0.05 | SW Marth_(SSBM); libmelee | H |
| Jumps | 1 extra jump (libmelee Jumps 1); initial double-jump speed 2.027, horizontal 0.995 | libmelee characterdata.csv | M |
| Full hop / short hop / double jump height | 35.09 / 13.995 / 25.188 | SW Marth_(SSBM) | M |
| Size (libmelee "size") | 14 | libmelee characterdata.csv | L (unit unclear) |
| Roll, forward | total 35, intangible 4-19, 16 vulnerable at end | SW Rolling | M |
| Roll, back | total 35, intangible 4-23, 12 vulnerable at end | SW Rolling | M |
| Spot dodge | total 27, intangible 2-18 (17), 9 vulnerable at end | SW Spot_dodge | M |
| Air dodge | generic 49 frames, intangible 4-29 | SW Air_dodge | M |
| Shield size | UNKNOWN | - | - |
| Grab range | UNKNOWN; grab hitbox radius 3.906 (standing and dash) | SW Marth_(SSBM)/Grab | L |

Source URLs: https://www.ssbwiki.com/Marth_(SSBM) ; https://raw.githubusercontent.com/altf4/libmelee/master/melee/characterdata.csv

## C. Marth moves

Columns: start = first active frame; active = hitbox frames; total = animation length; FAF = interruptible from; dmg = percent per hitbox (non-tip first, tip last); BKB/KBG/angle per hitbox in the same order. "Sakurai" = angle 361. Source for each row is the SW page named in the move column. Angles read from icons are marked "(i)". Landing lag columns apply to aerials only.

### C1. Ground moves

| move (source page) | start | active | total / FAF | dmg | BKB | KBG | angle | conf |
|---|---|---|---|---|---|---|---|---|
| Jab 1 (SW Marth_(SSBM)/Neutral_attack) | 4 | 4-7 | 27 / 26; next hit can be input from 20 | 4,4,4,6 | 20,20,20,30 | 50,50,50,60 | Sakurai | M |
| Jab 2 (same page) | 5 | 5-9 (libmelee: 5-8) | 28 / 25 | 4,4,4,6 | 20,20,20,30 | 50,50,50,60 | Sakurai | M |
| Forward tilt (SW .../Forward_tilt) | 7 | 7-10 | 35 / not stated | 9,9,9,13 | 30,30,30,60 | 70 | Sakurai | M |
| Up tilt, early (SW .../Up_tilt) | 6 | 6-8 | 39 / 32 | 9,9,8,12 | 40,40,40,50 | 120,118,116,100 | 110(i), Sakurai, Sakurai, 110(i) | L |
| Up tilt, clean (same page) | 9 | 9-12 | same | 10,9,9,13 | 40,30,30,50 | 120,118,116,100 | 85(i), Sakurai, Sakurai, 85(i) | L |
| Down tilt (SW .../Down_tilt) | 7 | 7-9 | 49 / 20 | 9,8,8,10 | 40,25,20,50 | 40 | 30(i) | L |
| Forward smash (SW .../Forward_smash) | 10 | 10-13 | 49 / 48 | 14 (tip 20) | 60 (tip 80) | 70 | Sakurai | M |
| Up smash (SW .../Up_smash) | 13 | 13-16 | 54 / 46 | 8,8,15,18 | 0,0,30,60 | 100,100,80,80 | 70,70,90,90 | M |
| Down smash (SW .../Down_smash) | 5 first set, 20 second set | 5-7 and 20-22 | 64 / 62 | 11 (tip 16) per set | set 1: 70,20,16,70; set 2: 70,30,15,70 | set 1: 72,100,100,100; set 2 same | set 1: 75,Sakurai,Sakurai,70; set 2: 75,Sakurai,Sakurai,75 | M (tip assignment inferred) |
| Smash charge window (all three smashes) | forward 3-4, up 7-8, down 3-4 | - | - | - | - | - | - | M |
| Dash attack (SW .../Dash_attack) | 12 | 12-15 | 49 / 40 | 11,9,9,12 | 70,35,35,70 | 55,60,60,55 | 110(i), Sakurai, Sakurai, 110(i) | M |
| Standing grab (SW .../Grab) | 7 | 7-8 | 30 | grab | - | - | - | M |
| Dash grab (same page) | 10 | 10-11 | 40 | grab | - | - | - | M |
| Pivot grab | UNKNOWN | UNKNOWN | UNKNOWN | - | - | - | - | - |
| Pummel (SW .../Pummel) | 7 | 7 | 24 | 3 | UNKNOWN | UNKNOWN | UNKNOWN | M |

Smash charge rule: the wiki pages give only the charge-window frames above. The charge damage multiplier (1.3671 at full charge) is NOT on the fetched pages: UNKNOWN. Max charge length (60 frames) is likewise not on them: UNKNOWN.

Cross-check with libmelee framedata.csv (https://raw.githubusercontent.com/altf4/libmelee/master/melee/framedata.csv, character index 18, hitbox status per frame): jab1 4-7, jab2 4-8 vs wiki 5-9 (one-frame disagreement), dash attack 12-15, ftilt 7-10, utilt 6-12, dtilt 7-9, fsmash 10-13 (IASA 48), usmash 13-16 (IASA 46), dsmash 5-7 and 20-22 (IASA 62), nair 6-7 and 15-21, fair 4-7, bair 7-11, uair 5-8, dair 6-9. All other values match the wiki. I trust the wiki for jab 2 only as a tie; the first active frame of jab 2 is 4 or 5 depending on whether the count is 0 or 1 indexed.

### C2. Aerials

| move (source page) | active | total / FAF | autocancel | landing lag | L-canceled | dmg | BKB | KBG | angle | conf |
|---|---|---|---|---|---|---|---|---|---|---|
| Nair (SW .../Neutral_aerial) | 6-7 and 15-21 | 49 / 50 | 1-5 and 25+ | 15 | 7 | hit 1: 4,4,4,4; hit 2: 10 | 30 and 50 | 40 and 80 | hit 1 100,100,100,90 (i); hit 2 Sakurai | M/L |
| Fair (SW .../Forward_aerial) | 4-7 | 33 / 30 | 27+ | 15 | 7 | 10,9,9,13 (tip 13) | 30,20,20,42 | 70 | Sakurai x3, 67 for the tip (i) | M |
| Bair (SW .../Back_aerial) | 7-11 | 39 / 35 | 32-39 | 24 | 12 | 10,9,9,13 | 30,25,10,30 | 70 | Sakurai | M |
| Uair (SW .../Up_aerial) | 5-8 | 45 / not stated | 1-4 and 27+ | 15 | 7 | 10,9,9,13 | 30,20,18,40 | 70 | 80,80,80,90 (i) | M/L |
| Dair (SW .../Down_aerial) | 6-9 | 59 / 80 listed (page inconsistent) | 1-5 and 48+ | 32 | 16 | tip 13, 10, 9, 9 | 40,40,30,30 | 70 | tip 290 (NTSC), 80, Sakurai, Sakurai | M |

Conflict: SW lists the dair FAF as 80 while animation length is 59. I trust 59 (libmelee also has 59 frames for that action) and treat 80 as a page error or a different reference point.

### C3. Throws

| move (source page) | throw point | total | dmg | BKB | KBG | angle | conf |
|---|---|---|---|---|---|---|---|
| Forward throw (SW .../Forward_throw) | 14 | 31 | 4 (+3 release) | 70 (release 40) | 45 (release 100) | 50(i); release Sakurai | L |
| Back throw (SW .../Back_throw) | UNKNOWN (marker only) | 44 | 4 (+3) | 70 (40) | 60 (100) | 117(i) | L |
| Up throw (SW .../Up_throw) | 12 | 44 | 4 (+3) | 60 (40) | 130 (100) | 93(i); release Sakurai | L |
| Down throw (SW .../Down_throw) | 14 | 42 | 5 (+3) | 65 (40) | 50 (100) | 135(i) | L |

Total frames shown on those pages vary by victim weight (for example 17-37 for the forward throw); the bold value is a baseline whose weight the page does not state.

### C4. Specials

| move (source page) | numbers | conf |
|---|---|---|
| Shield Breaker uncharged (SW .../Neutral_special) | hitbox 16-21, 44 frames total, 7%, BKB 30-40, KBG 100, Sakurai; shield damage listed 30-38 | M |
| Shield Breaker charge (same page) | charge loop 12-41 frames; levels by frames held: 0-29 7%, 30-59 12%, 60-89 17%, 90-119 22%, 120 27%, 121 (full) 28% | M |
| Shield Breaker full charge (same page) | 28%, BKB 30-40, KBG 100, Sakurai, shield damage 60; hitbox release+5 to release+10, total release+33 | M |
| Dancing Blade part 1 (SW .../Side_special) | hitbox 6-8, continuable 7-25, 29 total; 4% x4 hitboxes, angles 85,96,80,76, BKB 55, KBG 25 | M |
| Part 2 up | hitbox 12-15, continuable 16-31, 40 total; 5%, angles 90,90,85,79, BKB 30,60,70,85, KBG 40 | M |
| Part 2 side | hitbox 14-16, continuable 16-32, 40 total; 5%, angles 105,80,70,50, BKB 16, KBG 100 | M |
| Part 3 up | hitbox 13-17, continuable 17-37, 40 total; 6%, angle 80, BKB 60, KBG 60 | M |
| Part 3 side | hitbox 11-14, continuable 15-36, 46 total; 10%, Sakurai, BKB 0, KBG 160 | M |
| Part 3 down | hitbox 15-18, continuable 18-34, 46 total; 12%, angle 270, BKB 50, KBG 100 | M |
| Part 4 up | 10%, angle 80, BKB 40, KBG 130; frames UNKNOWN (page text cut off) | M |
| Part 4 side | 14%, Sakurai, BKB 15, KBG 120; frames UNKNOWN | M |
| Part 4 down | hits 1-4: 3%, angle 80, BKB 2, KBG 40; hit 5: 5%, Sakurai, BKB 20, KBG 130; frames UNKNOWN | M |
| Dolphin Slash (SW .../Up_special) | intangible and clean hit on frame 5; late hit 6-10; 39 frames; landing lag 34; clean 13% Sakurai BKB 80 KBG 70; slash 10% angle 74(i) BKB 60 KBG 70; late 7/7/6% BKB 20 KBG 90 | M |
| Counter (SW .../Down_special) | counter window frames 5-29 (page number, not cross-checked), 59 frames total; counterattack hitbox on its frames 3-9; damage 7% flat; angle 90 (page also calls it Sakurai), BKB 35, KBG 0 | L |
| Counter (SW Counter_(Marth)) | Marth's Melee counter: flat 7%, low knockback, faster to start and twice as long as Roy's. Roy: 1.5x the countered damage | M |

Dancing Blade input windows: "continuable" ranges above are the frames in which the next press continues the chain (the closest the source gives). Part 4 timing was not read.

Conflict (Counter): the Down_special page says "angle 90 (Sakurai angle)", which is contradictory, and the move page gives a 7% flat damage; the Counter_(Marth) page agrees on 7%. I trust 7% (two pages agree) and treat the angle as UNKNOWN.

## UNKNOWN list

- Powershield reflect speed multiplier; regrab rule; powershield_input_window numeric value; sdi_pos_scale, sdi_stick_window, sdi_min_stick_mag numeric values; grab_timer_decrement numeric value; hitlag field offset; tumble threshold confirmation.
- Smash charge multiplier (1.3671) and max charge frames.
- Marth shield size; grab range; pivot grab; pummel knockback; back throw release frame; Dancing Blade part 4 frames; Counter angle.
- Roy rows were not needed (Marth entries found).

## Sources and licenses

- SmashWiki (https://www.ssbwiki.com), pages: Hitlag, Knockback, Hitstun, Shield, Shield_break, Perfect_shield, Dizzy, Grab, Pummel, Grab_release, Priority, Rebound, Teching, Directional_influence, Smash_directional_influence, Stale-move_negation, L-canceling, Crouch_cancel, Rolling, Spot_dodge, Air_dodge, Marth_(SSBM), Marth_(SSBM)/{Neutral_attack, Forward_tilt, Up_tilt, Down_tilt, Dash_attack, Forward_smash, Up_smash, Down_smash, Neutral_aerial, Forward_aerial, Back_aerial, Up_aerial, Down_aerial, Grab, Pummel, Forward_throw, Back_throw, Up_throw, Down_throw, Neutral_special, Side_special, Up_special, Down_special}, Counter_(Marth). Content is CC BY-SA; only numbers and formulas were copied, no prose.
- libmelee by altf4 (https://github.com/altf4/libmelee), files melee/characterdata.csv and melee/framedata.csv, LGPL; numbers only.
- Decomp field names and offsets: C:/DEV/_refs/melee-pc/src/melee/ft/types.h (struct ftCommonData) and call sites in src/melee/ft/fighter.c, ftcommon.c, kinds/ftCommon/ftCo_Guard.c, ftCo_Damage.c, ftCo_Furafura.c, ftCo_CaptureWait.c (derived from doldecomp/melee).
- Not reached: meleeframedata.com (certificate expired), ikneedata, UnclePunch Training Mode data, 20XX sheets. No value here is confirmed against raw PlCo.dat bytes; most "offset unknown" cells need that read.
