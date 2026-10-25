# 08 - Hit feel: every cue that makes a Melee hit land (T-1024-23, 2026-10-24)

Joi asked for "all the effects that make combat delicious: the sounds, the micro animations, the glows, the camera pauses, the vibration of the blow". This ficha reads them out of the decomp, lists what our client does today, and orders small slices that port the missing ones.

Conventions as in 01 to 07:
- Melee citations are `path:line` relative to `C:/DEV/_refs/melee-pc` (commit 0fb0af3, sparse: ft, gm, it, lb, pl only).
- Our citations are `path:line` in this worktree.
- **DATA** = the number lives in game data (PlCo.dat `p_ftCommonData` fields, LbRb.dat, effect and sound tables), not in code. Field names such as `x168` are the decomp's own placeholders. **UNKNOWN** = not found in this checkout.
- **inferred** = my reading, not stated by a line of code.
- Legal rule (README): mechanics and numbers only. No code is copied, no assets are copied.

## 0. The one-paragraph answer

A Melee hit is a stack of cues that all start on the same frame and ride on the victim's hitlag:
1. Both fighters freeze (hitlag, see 01).
2. During the freeze only the victim's **model** is jittered by a table-driven offset (visual only, no collision).
3. A **spark** spawns at the hit position, chosen by element, with a bigger one above a KB threshold.
4. A **hit sound** is chosen by (sfx_kind, severity) set per hitbox in the move script, with a separate muted tier when the target is intangible.
5. The victim gets a **colour animation** (ColAnim) chosen by element and KB level, and a stage **background flash** above a per-element KB threshold.
6. The **controller rumbles** on the victim (damage-scaled) and on the attacker (dealt damage).
7. The camera **quakes** only for strong airborne hits (and hard bounces), in three sizes.
8. After hitlag the **damage animation** (4 KB tiers) and launch start, and a damage voice plays for strong hits.

The "vibration of the blow" is items 2, 6 and 3 together. Items 4 and 5 give the colour and the crack.

### 0b. Timeline of one strong hit (Melee frames = our ticks)

| tick | cue | section |
|---|---|---|
| 0 (collision resolved) | Spark at contact, hit sound, ColAnim starts, rumble starts on both pads, stage flash if KB is over the gate | 3, 4, 5, 6 |
| 0 | Hitlag set on both fighters (cap 20); victim shake table starts, length from the hitlag | 1 |
| 0 to hl-1 | Victim jitters in place; stick nudges the victim's real position (SDI); attacker is frozen | 1 |
| hl (hitlag ends) | Damage animation chosen by KB tier, launch velocity applied, ASDI nudge, damage voice if KB is high | 5, 6 |
| hl and after | Camera quake once, only if tier 3 and airborne; a hard bounce later adds a Large quake and rumble 9 | 2 |

Ordering inferred from `fighter.c:2985-3011` (hitlag set after the damage branch) and `ftCo_Damage.c:426-429` (callbacks for the hitlag and its exit).

## 1. Hitlag shake (who shakes, how much, how it ends)

| fact | value | source |
|---|---|---|
| Who shakes | The **victim only**. The shake setup runs inside the damage branch, which only exists for the fighter that took damage | `src/melee/ft/fighter.c:2905-2910` (inferred: the attacker's hitlag branch at `fighter.c:2948-2957` never calls it) |
| What moves | The **drawn model** is offset in x and y, not the collision position. The offset is stored in `dmg.x18B8` and `dmg.x18BC` and read back by the draw code for the fighter body and for its held item | `src/melee/ft/ftlib.c:809-819`, `src/melee/ft/ftdrawcommon.c:46,68`, `src/melee/it/itdraw.c:224` |
| Offset sources, summed each frame | (a) damage hitlag shake, (b) grab-mash shake while held, (c) smash-charge shake | `src/melee/ft/ftcommon.c:1723-1753` |
| Length in frames | `x168 * hitlag_frames + x16C`, truncated to a u16. The hitlag used is the one recomputed from the damage taken and the electric multiplier | `src/melee/ft/kinds/ftCommon/ftCo_DamageFall.c:31-35,50` |
| `x168`, `x16C` | DATA (not in code) | - |
| Amplitude and direction | Read from a **fixed offset table**, indexed by the frame counter (`x18FC`, reset to 0 at the start). It is **not random** (no random call on this path) and not a function of damage or KB: the damage only sets how long the table plays | `ftCo_DamageFall.c:51,65-82` |
| Which table | 3 tables chosen once at hit time: 0 = airborne, 1 = grounded, 2 = electric (element wins over air or ground) | `ftCo_DamageFall.c:53-61` |
| Grounded table | The x offset is multiplied by facing and rotated by the floor normal, so the shake slides along the slope | `ftCo_DamageFall.c:71-75` |
| Air and electric table | x offset is `table.x * facing`, y is `table.y` | `ftCo_DamageFall.c:76-78` |
| Table contents and frame counts | DATA (`Fighter_804D6530[...]` in the fighter common file) | `ftCo_DamageFall.c:62` |
| Who gets no shake | Hits with element Cape, Disable, Nap, Sleep; and a victim already in ice-block damage | `ftCo_DamageFall.c:41-48` |
| Electric hitlag multiplier | The attacker's `vibrateMult` is set to `x1A4` (DATA) when an electric hit connects; it multiplies the hitlag of both sides and so also the shake length. Reset to 1 each frame after use | `src/melee/ft/ftcoll.c:2440-2442`, `fighter.c:3059`, `ftCo_Damage.c:781-796,838-839` |
| Crouch | Crouching victims get hitlag times `x1A0` (README: 0.667) | `src/melee/ft/ftcommon.c:658-666` |
| How it ends | The shift frame counter runs out and the offset is zeroed by the same function each frame; the damage animation starts when hitlag ends (post-hitlag callback) | `ftcommon.c:1731-1732`, `ftCo_Damage.c:426-429` |
| SDI and ASDI (the stick moves the **real** position during hitlag) | See 01 section 4. Per hitlag frame, the stick times `sdi_pos_scale` is added to position once per stick flick (window `sdi_stick_window`); on exit the stick times `x4BC` (ASDI) | `ftCo_Damage.c:508-528, 563-588` |

Consequences for us (inferred):
- The shake is a **decorative offset applied to the view**, so the sim and the hit boxes never see it.
- Its direction is not tied to the launch. Only the table (and floor slope) decides it, so a 3D port can use a small two-axis table plus a "facing" sign.
- The amplitude numbers are DATA. We tune them by eye; the structure to copy is "table, victim only, view only, length grows with hitlag".

## 2. Camera: shake and zoom

| fact | value | source |
|---|---|---|
| Request | `Camera_RequestQuake(kind, pos)` with kind Small, Medium or Large. The camera code itself (amplitude, duration, falloff) is **not in this checkout** (no `cm` directory): UNKNOWN | calls below |
| Trigger on a damaging hit | Only when KB level is 3 (strongest tier) **and the victim is airborne**. Size by scaled KB: below `x170` Small, from `x170` Medium, from `x174` Large (both DATA) | `ftCo_Damage.c:453-467` |
| Grounded victims | No quake from the hit itself, even at level 3 | `ftCo_Damage.c:453-467` (inferred from the air-only guard) |
| Hard ground bounce (down bound) | Large quake plus rumble 9, at the bounce | `src/melee/ft/kinds/ftCommon/ftCo_DownBound.c:99-100,200` |
| Wall or ceiling reflect of a flying victim | Small quake plus rumble 7 | `src/melee/ft/kinds/ftCommon/ftCo_FlyReflect.c:173,200` |
| Large quakes in `ft_0D31.c` | Three Large quake calls; the surrounding state was not read, so the trigger is UNKNOWN | `src/melee/ft/ft_0D31.c:208,600,666` |
| Item and special moves | Small or Medium quakes exist for a few specials (Bowser, Yoshi, Pikachu, Jigglypuff stomp-like moves, metal box pickup). They are character specific, not hit feel | `ftlib.c:863`, `kinds/ftKoopa/ftkoopaspecialn.c:191`, `kinds/ftYoshi/ftyoshispecials.c:77`, `kinds/ftPurin/ftpurinspecialn.c:1112` |
| Match-level quakes | `gm` has three calls with a NULL position: a Large one in versus code, Medium ones in event and another game mode. The conditions were not read: UNKNOWN whether any is the final-KO hit | `src/melee/gm/gmvs.c:1061`, `gm/gmevent.c:2140`, `gm/gm_17C0.c:226` |
| Zoom, pause on a KO, "final hit" slow-motion | **Not found** in `ft`, `gm`, `it`, `lb`, `pl` by the searches run (quake, shake, camera): UNKNOWN. The camera system that zooms is outside the sparse checkout | - |
| Camera follow of the victim in a throw | The throw state updates the camera box for the thrown fighter | `kinds/ftCommon/ftCo_Throw.c:444-446` |

So in Melee the camera does **not** shake on ordinary hits. It shakes on the strong ones that send someone flying, and on hard bounces. This is a design rule worth copying (small hits stay calm).

## 3. Rumble

All rumble goes through one function: pad port, channel id, pattern index, duration. Patterns are in `LbRb.dat`: pattern contents, priorities and strengths are DATA.

| item | value | source |
|---|---|---|
| Entry point | `lb_80014574(port, channel, pattern, duration)`; duration 0 means "use the pattern's own length" (passed as -2) | `src/melee/lb/lb_013B.c:246-251` |
| Guards | Only for a human-controlled player slot, and not when the fighter is asleep or stamina-dead | `src/melee/ft/ftcommon.c:1178-1185` |
| Victim, on damage | Pattern 5, duration = `damage * x138 + x13C` truncated, skipped when below 1. So **duration grows linearly with damage taken** (both factors DATA) | `ftcommon.c:1213-1221`, called at `fighter.c:2910` |
| Attacker, on damage dealt | Pattern 10, duration = `dealt * xEC + xF0`, skipped when below 1 | `ftcommon.c:1223-1231`, called at `fighter.c:2948-2957` (inferred: the branch with the deal-damage callback is the attacker's) |
| Throw start | The same attacker rumble with the throw hitbox damage | `kinds/ftCommon/ftCo_Throw.c:552` |
| Hold a grab | Pattern 3 while holding and while held | `kinds/ftCommon/ftCo_CatchWait.c:28`, `ftCo_CaptureWait.c:71` |
| Shield break | Pattern 24 at the break (with sfx 130) | `kinds/ftCommon/ftCo_ShieldBreakFly.c:33-34` |
| Shield break, falling | Pattern 8 | `ftCo_ShieldBreakFall.c:22` |
| Dizzy (Furafura) | Pattern 25 | `kinds/ftCommon/ftCo_Furafura.c:29` |
| Down bound | Pattern 9 (with the Large quake) | `ftCo_DownBound.c:100` |
| Fly reflect | Pattern 7 (with the Small quake) | `ftCo_FlyReflect.c:200` |
| Stop | `lb_800145C0` clears and re-enables the motor (used on respawn state changes) | `lb_013B.c:253-257`, `ftcommon.c:1208-1211` |
| Skip flag | Many special-move state changes pass a "skip rumble" flag so a looping move keeps its own rumble | e.g. `kinds/ftFox/ftfoxspecials.c:446`, `kinds/ftMars/ftmarsspecialn.c:220` |

Intensity by damage or KB: **by damage** (duration). The pattern strength is DATA. Strong KB is not read for rumble.

## 4. Hit sparks and GFX

| fact | value | source |
|---|---|---|
| Choice | By the hitbox **element**, from one table. Missing entries are -1 (no spark) | `src/melee/ft/ftcoll.c:543-566` |
| Normal, Ground, Cape | effect 1000 (the white-flash spark) | `ftcoll.c:544,553,554` |
| Fire | 1002 | `ftcoll.c:545` |
| Electric | 1001 | `ftcoll.c:546` |
| Slash | 1004 | `ftcoll.c:547` |
| Coin | 1145 | `ftcoll.c:548` |
| Ice | 1005, spawned with the victim's facing as an extra argument (the shatter points the right way) | `ftcoll.c:549,2182-2184` |
| Dark | 1046 | `ftcoll.c:557` |
| No spark | Nap, Sleep, Catch (grab), Inert, Disable, Scball, Lipstick | `ftcoll.c:550-552,555-556,558-559` |
| Spawn position | The hit position stored in the damage log entry (where the hitbox touched the hurtbox); for the single-collision path, `dmg.x1880` | `ftcoll.c:2251-2256,3107` |
| Which spark function | Only the Normal id goes through the sizing function; the other elements spawn their effect directly at the position | `ftcoll.c:2165-2188` |
| Size or strength by damage | For Normal: a **KB threshold** (`x3F0`, DATA) picks the small spark (1000) below it and a different, bigger effect (0x3F3 = 1011) at or above it | `ftcoll.c:1142-1152` |
| Extra flare | If the hitbox severity is 1 or more, a character-specific variant may add a bonus spark (id 0x3EF = 1007) with a **random chance of 1 in `x3F4`** (DATA); variant 1 does the roll and spawns nothing | `ftcoll.c:1154-1165` |
| Clank / trade of blades | A separate effect path in the shield and clank code, not the hit table. Audio side in section 5 | UNKNOWN for the sprite id |
| Electric | Besides the spark, the electric shake table and the hitlag multiplier (section 1) and a background flash id 4 | `ftCo_DamageFall.c:53-54`, `ftCo_Damage.c:194-198` |
| Hit with no damage taken (blocked by invincibility) | `efSync_Spawn(1052)`, a different small effect, when no log entry was valid | `ftcoll.c:533-535` |

Stage flash (a background glow, not a screen flash): `lbBgFlash` fires only when damage is taken (percent temp nonzero) and the **final KB is above a per-element threshold** (all DATA): Normal id 2 (`x178`), Fire 3 (`x17C`), Electric 4 (`x180`), Ice 5 (`x184`), Dark 6 (`x188`). Source: `ftCo_Damage.c:183-215`. In our game this maps to a brief tint or bloom pulse on the sea and sky, not the UI.

## 5. Hit sounds

| fact | value | source |
|---|---|---|
| Per-hitbox fields | Each hitbox carries `sfx_kind` and `sfx_severity` (0, 1 or 2), set by the move script command that creates the hitbox | `src/melee/ft/ftaction.c:354,746` |
| Normal playback | `lbColl_80005BB0`: the sound id is `table[sfx_kind * 3 + severity]` at full volume. So 3 loudness or weight tiers per kind (punch, kick, slash, fire, electric and so on). The table contents are DATA | `src/melee/lb/lbcollision.c:239-255` |
| Special case | Kind 0xD severity 2 plays on a per-player voice channel (`0x72 + 2*player + subfighter`) so it can be cut off | `lbcollision.c:245-250`, `ftcoll.c:1118-1123` |
| Is the tier tied to damage? | **No.** The tier is authored per hitbox (severity), not computed from damage or KB. The damage and KB only influence the spark size and the damage voice | `ftaction.c:354` (inferred from the data flow) |
| Hit on an intangible or invincible target | A flat 3-sound set `{141, 142, 143}` indexed by severity plays on the victim instead (the "ding" of hitting something that cannot be hurt) | `ftcoll.c:70,1109-1113,1643-1648` |
| Clank of two hitboxes | If both are Slash: a random pick of `{107, 108, 109}` (three blade clashes); otherwise sound 106 | `ftcoll.c:71,1131-1139` |
| Another fixed hit sound | Id 85 on a specific helper | `ftcoll.c:1126-1129` (the caller was not read: UNKNOWN) |
| Damage voice (victim cry) | After the move into the damage state: if scaled KB is at least `x20C` voice id 0x4F (79), else if at least `x208` voice 0x50 (80); they are two voice tiers per character, on top of the hit sound. Played after hitlag, or at once if no hitlag | `ftCo_Damage.c:444-452`, `kinds/ftCommon/ftCo_DamageFall.c:84-94`, `fighter.c:3009-3011` (post-hitlag timing inferred) |
| Shield raise | sfx 110 (and the shield bubble effect 1047 tinted with the player colour). Marth also plays 190115 | `kinds/ftCommon/ftCo_Guard.c:251-258,311,333,343-346` |
| Shield release | sfx 127 on release, 128 in the set-off path | `ftCo_Guard.c:590,765,883` |
| Shield hit | The shield callback runs and hitlag is set from the shield damage; sound is the hit table above (shield hits use the hitbox severity) | `fighter.c:2930-2939` |
| Shield break | sfx 129 when health reaches 0, then sfx 130 (0x82) at the break launch, plus rumble 24 | `ftCo_Guard.c:421-428`, `fighter.c:2932-2933`, `ftCo_ShieldBreakFly.c:33-34` |
| Powershield | The reflecting flag gates the same shield code; the dedicated sound or flash is **not located**: UNKNOWN | `ftCo_Guard.c:219,458` |
| KO sounds | Not in `ft/kinds/ftCommon` by the searches run: UNKNOWN | - |
| Fighter metal armor, metal box | Pickup plays 0x121 (289) with a Small quake | `ftlib.c:863-864` |

## 6. Damage animations and micro animations

KB tiers (all on `scaled_kb = kb * x154`, DATA):

| step | rule | source |
|---|---|---|
| Level 0 | below `x158` | `ftCo_Damage.c:116-122,302-314` |
| Level 1 | `x158` to below `x15C` | same |
| Level 2 | `x15C` to below `x160` | same |
| Level 3 | at or above `x160`. Forced to 3 whenever an explicit motion id is supplied | `ftCo_Damage.c:315-318` |
| Motion chosen | Table indexed by (ground or air, level, which hurtbox region was hit), so a head hit and a leg hit play different animations | `ftCo_Damage.c:330,346,353,370` |
| Tumble | Level 3 in the air. If the launch angle lies between `x234` and `x238` (DATA) the motion becomes 0x5A (90). Otherwise, when percent is at least `x23C` and a random roll is below `x240`, motion 0x5B (91) (a spin variant, inferred) | `ftCo_Damage.c:381-395` |
| Ice | A hit with Ice and level 2 or more freezes the victim into the ice-damage state | `ftCo_Damage.c:399-402,475-477` |
| Bounce flag | KB above `x12C` marks the fall as able to bounce off the floor, then the down-bound state plays (with Large quake and rumble 9) | `ftCo_Damage.c:419-424`, `ftCo_DownBound.c:99-100` |
| Ground hit angle | If no explicit angle: grounded hits below a KB gate (`x14C`) go flat, above it they lift gradually up to `x148` degrees | `ftCo_Damage.c:84-107` |

Colour overlays (ColAnim):

| step | rule | source |
|---|---|---|
| When | Only when percent is added this frame (damage was taken) | `ftCo_Damage.c:155-181` |
| Id | Normal and others: fixed id 4. Fire: `11 + level`. Electric: `15 + level`. Ice: `31 + level`. Dark: `35 + level`. So the **colour pulse grows with the KB tier** and is tinted by element | `ftCo_Damage.c:162-178` |
| Content | The animation itself (colours, duration) is in the colour animation data file: DATA | `src/melee/ft/ftcolanim.c:113-125` |
| Layers | Three independent colour layers exist (hurt, extra, special-item); the damage one skips if the state sets a skip flag | `ftcolanim.c:113-125`, `ftdevice.c:18-35` |
| Invincibility flicker, powershield flash | Not located in this checkout: UNKNOWN (inferred to be ColAnim ids, since all body tints go through the layer system) | - |
| Shield look as it shrinks | Shield bubble scale is a function of remaining shield health and the lightshield amount, using DATA factors; the formula shape is `x28C * (health * (1 - (analog * (x2E8 - x2E4) + x2E4))) + x290` | `ftCo_Guard.c:653-660` |

## 7. Grab, throw, clank, shield break, dizzy cues

| cue | what Melee does | source |
|---|---|---|
| Grab connects | Catch hand effect 0x41D (1053) on the hand joint, rumble 3 | `ftCo_CatchWait.c:27-28` |
| Held victim | Rumble 3 on the victim too; the **mash shake**: every mash input moves the held fighter's model by an entry of a mash shake table (index `x1A52`, count `x4`) | `ftCo_CaptureWait.c:71`, `ftcommon.c:696,1737-1742` |
| Pummel and throw | The same hit pipeline: spark by element, sound by severity, attacker rumble | `ftCo_Throw.c:552` |
| Smash charge | Models shake during the charge with its own table; fed into the same offset | `src/melee/ft/ft_0DF0.c:48,112` |
| Clank | Slash on slash: random one of 3 blade sounds; otherwise one sound; the hit is ignored and both rebound (02) | `ftcoll.c:71,1131-1139` |
| Shield break | sfx 129, then 130, rumble 24, then rumble 8 on the fall | section 5 |
| Dizzy | Rumble 25 when it starts. The swirl effect id is UNKNOWN (outside the files read) | `ftCo_Furafura.c:29` |
| Reflecting a projectile with the shield | Reflect hitbox with damage and speed multipliers (DATA) | `ftCo_Guard.c:862-873` |

## 8. Inventory of ours

All values are from this worktree.

| our event | what it does | path:line | Melee cue it matches | Melee cue it misses |
|---|---|---|---|---|
| melee hit (`mhit`) | Spark burst (14 stage 3, else 9), expanding ring, white flash on the victim, torso flinch, material hit sound, "ZAS" word at stage 3, hitstop 45 ms unless MN_MELEE, trauma 0.22 or 0.12, camera punch-in 0.4 or 0.2 | `src/ui/feedback.js:113-125` | Spark (4), hit sound (5), colour flash (6), hitstop (1) | Victim shake, element spark, KB-tiered spark, rumble |
| hit spark | One palette, count only (no element choice, sprites are particles) | `src/ui/feedback.js:80,116`, `src/render/vfx/effects.js:106` | Spark | Element table, big spark above a KB threshold |
| damage (`damage`) | Floating number, elemental flash on the view, flinch, material hit sound, ink hit sound, spark for non-melee | `src/ui/feedback.js:126-155` | Colour flash by element (6), numbers | ColAnim tiers by KB |
| immune hit | "CLANK" call, hit pose, clunk | `src/ui/feedback.js:130-134` | Hit on intangible (5) | Severity tier sounds |
| kill (`kill`) | Debris burst, sparks, ring, bones sound, shake 0.25 for the killer, comic word for bosses | `src/ui/feedback.js:156-185` | KO is not found in Melee's hit code | Slow-motion or zoom (not found in Melee either) |
| parry | Sound by tier, shockwave, screen flash, shake 0.35, punch-in 0.6, body flash | `src/ui/feedback.js:186-224` | Powershield (UNKNOWN in Melee) | - |
| guard break | Sound, tutorial hint | `src/ui/feedback.js:255-259`, `src/audio/sfx.js:346` | Shield break sfx (5) | Rumble 24, quake, body knock-up |
| clank | `sfx.clunk` | `src/ui/feedback.js:454`, `src/audio/sfx.js:305` | Clank (5) | 3 random blade sounds, steel-clash spark |
| stun | Case exists | `src/ui/feedback.js:270` | Dizzy | Rumble 25, swirl |
| fall hurt | Camera punch-in 0.5 on hard landing | `src/main.js:957` | Down bound (2) | Large quake |
| hitstop | Real-time pause of the whole sim, max of requests, 45 ms for melee, server merges by command | `src/core/loop.js:23,42-44`, `src/sim/world.js:224-237`, `src/data/tuning.js:157` | Hitlag (1) | Per-fighter, victim-only; now off under P1a (feedback.js:121) |
| screen shake (trauma) | Trauma 0..1, squared offset, decay 1.6/s, max 0.6 units, roll 2.5, freq 22 Hz | `src/render/camera.js:66,113-114`, `src/data/tuning.js:64` | Quake (2) | Three fixed sizes; air-only and strong-only rule |
| camera punch | Short zoom kick | `src/render/camera.js:67` | None found in Melee | - |
| screen flash | Full-screen flash decay 3.2/s, halved with reduced motion | `src/ui/feedback.js:56,734-735` | Stage flash (4) approx | Per-element, KB-gated |
| haptics | Phone vibrate for touch only, as a general `buzz(ms)`; no gamepad rumble | `src/ui/touch.js:257` | Rumble (3) | Gamepad rumble, damage-scaled duration |
| shake of the victim in hitlag | **None** | - | - | Section 1 |
| hit event payload | `mhit` carries `x, z, stage, seq`; the P1a server fields `kb, hl, hs` live on the duel state | `src/client/gameClient.js:759`, `src/sim/systems/combat.js:219` | - | The client cue needs `kb, hl, p, elem` on the hit event |

Observations:
- Our feel today is **one global pause plus a small camera shake**. Melee's feel is **per-fighter** and **ordered over time** (freeze, jitter, then launch).
- Our sparks, sounds and flash scale with the combo stage (1 to 3), not with damage or KB. Melee scales sparks by KB and picks sounds per hitbox.

## 9. Proposal: juice slices (small, ordered, one change each)

Common rules:
- Everything that depends on hitlag reads `hl` from the hit event and runs for exactly `hl` ticks.
- Behind MN_MELEE where it depends on hitlag; element, sound and rumble slices are independent.
- Pure client work; no protocol change except slice J2 may add `elem` and `kb` to the event (check if present).

| # | slice (one change) | Melee rule ported | our files to touch | art or sound | acceptance (what a player sees or hears) |
|---|---|---|---|---|---|
| J1 | **Victim shake during hitlag.** Offset the victim's drawn root by a small 2-axis table for `hl` ticks, scaled by facing (and rotated by the ground normal when grounded), then zero. View only; never touches `ecs`. The hit event carries `hl`, so the view runs a counter | Section 1: victim only, table-driven, length from hitlag | `src/ui/feedback.js` (start in `mhit`/`damage`), the character view update (`src/render/characters.js`, root offset) | none (motion only) | Hit someone with a jab: for about 5 frames the victim vibrates in place while both freeze, then flies off. The attacker does not vibrate |
| J2 | **Element and KB-tiered spark.** Choose the sprite by element (Normal, Fire, Electric, Slash, Ice, Dark) and a bigger variant above a KB threshold; spawn at the contact point; 1 in N chance of a bonus flare on severity 1 or more | Section 4 | `src/ui/feedback.js:113-125`, `src/render/combatFx.js`, `src/render/vfx/effects.js` | `hit-spark` (one sprite tinted per element for now; big variant uses `launch-smoke` plus a scaled `hit-spark`) | A weak jab shows a small white spark; a smash shows a large starburst. A fire hit shows an orange one |
| J3 | **Severity-tiered hit sound.** Three tiers (0 to 2) per weapon kind, authored on each move, not computed; a flat 3-sound "dink" for hits on intangible targets (we already have `clunk`); blade-on-blade picks one of 3 clash sounds at random | Section 5 | `src/audio/sfx.js:145,305` (new tier arg), `src/data/` move table (add `sfxTier`), `src/ui/feedback.js:119,133,454` | existing `sfx.hit`, `sfx.clunk`; **new sound** for 2 extra tiers and 2 extra clashes | Jab, tilt and smash sound clearly different in weight; two cutlasses meeting never play the same clash twice in a row |
| J4 | **Strong-airborne-hit camera quake and gamepad rumble.** Quake only when KB tier is 3 and the victim airborne (3 sizes); gamepad vibration (Gamepad API `vibrationActuator`) for victim with duration `a*dmg+b`, attacker with `c*dmg+d`; keep `navigator.vibrate` for touch | Sections 2 and 3 | `src/ui/feedback.js:122` (replace the flat `shake(0.12/0.22)` under MN_MELEE), `src/render/camera.js:66`, new small `src/ui/rumble.js`, `src/ui/touch.js:257` | none | A smash that launches makes the screen thump; a jab does not. A controller buzzes on the victim for longer on bigger hits, shorter on the attacker |
| J5 | **ColAnim by KB tier.** On the victim, a colour overlay whose strength is the KB tier (0 to 3), tinted by element (white, orange, yellow, blue, violet); fade over the hitlag then a short tail | Section 6, ids by `level + base` | `src/ui/feedback.js:118,147`, `v.flash` in the character view | none | A light hit gives a faint white pulse; a launching hit glows strongly for about 10 frames, in the element colour |
| J6 | **Damage-voice and stage flash gates.** Two voice tiers when KB is over two thresholds (a pirate shout), and a short sea or sky bloom pulse when KB is over a per-element threshold | Sections 4 and 5 | `src/audio/sfx.js` (voice), `src/ui/feedback.js:56,734` | **new sound** (2 shouts) | A hard hit makes the victim shout once, and the backdrop flashes only on big hits |
| J7 | **Defense feel: shield break and clank.** On guard break: sound 129 then 130 pair, rumble 24 (long), `guard-break` sprite, and the dizzy swirl with rumble 25; on clank: `steel-clash` at the contact point | Sections 5 and 7 | `src/ui/feedback.js:225-270,454` | `guard-break`, `steel-clash`, `stun-swirl`; new sound for the break pair | Breaking a guard feels heavy (long buzz, burst), clashing blades leaves a spark between them |
| J8 | **Grab and mash cues.** Grip spark and rumble 3 on grab; mash shake while held (small offset each mash input) | Section 7 | `src/ui/feedback.js`, character view root offset (reuse the J1 offset layer) | `grab-grip` | Pressing the mash button visibly rattles the held pirate; grabbing shows a grip glint |

Dependencies: J8 reuses J1's offset layer; J4's rumble reads damage from the event (`p`, `kb`). J2 and J5 need `elem` on the hit event (`ev.elem` exists on `damage`, `src/ui/feedback.js:104`; `mhit` lacks it).

## 10. The three cues that matter most

Written under OPEN in the report. In short:
1. The victim's table-driven model jitter during the shared freeze (J1).
2. The damage-scaled rumble on both fighters (J4).
3. The KB-tiered element spark with a severity-tiered hit sound (J2 with J3).

## 11. Not found (UNKNOWN) and why

| gap | why |
|---|---|
| Quake amplitude, duration | The camera module is outside the sparse checkout (`cm` missing) |
| Zoom or pause on the final KO | No call found in `ft`, `gm`, `it`, `lb`, `pl` by quake and shake searches |
| KO sounds and blast-zone effects | Dead state files not in `ft/kinds/ftCommon` results |
| Powershield flash, invincibility flicker | No grep hit; likely ColAnim ids in DATA |
| All numeric table contents (shake offsets, ColAnim colours, hit sound ids, spark thresholds) | `PlCo.dat`, `LbRb.dat`, effect and audio tables |
| Rumble strength values | `LbRb.dat` |

A DATA pass over community sources (SmashWiki hitlag and screen-shake notes) is the next research step, as 06 did for frame data. Until then, tune J1 to J8 by eye with Melee's **structure**.
