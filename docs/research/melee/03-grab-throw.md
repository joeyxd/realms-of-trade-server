# Melee grab and throw (T-1024-03)

## 1. Summary

- **1. Grab beats ordinary shield by bypassing shield collision:** an active catch capsule tests the opponent’s grabbable hurt capsules directly. Shield size, shield health, and powershield flags are not rejection conditions in that search. (`FT/ftcoll.c:1311–1375`)
- **2. There are two ordinary grab animations:** standing `Catch` and moving `CatchDash`; successful versions become `CatchPull` and `CatchDashPull`. Startup, active frames, and whiff recovery are **DATA**, not universal constants. (`FT/ftmotionstates.c:2467–2507`; `FT/ftaction.c:301–377`)
- **3. Holding is a paired state machine:** grabber `CatchWait`, victim `CaptureWaitHi/Lw`; the grabber can pummel or choose one of four throws. (`Co/ftCo_CatchWait.c:14–61`; `Co/ftCo_Throw.c:104–129`)
- **4. Hold duration depends on victim percent, handicap, and match standings:** the code does not support reducing it to a percent-only numeric formula without extracting common data. (`Co/ftCo_CapturePulled.c:19–36`; `src/melee/gm/gmvs.c:977–990`)
- **5. Mash events are discrete:** a qualifying button press and a qualifying stick-direction change can each subtract one DATA amount in one helper call. Multiple buttons do not multiply that subtraction. (`FT/ftcommon.c:700–725`)
- **6. Important source discrepancy:** this tree’s `CaptureWait` callback does not call the mash helper; `CaptureDamage` does. Retail-equivalent normal-hold mashing is therefore **UNCONFIRMED** here. (`Co/ftCo_CaptureWait.c:105–146`; `Co/ftCo_0DC2.c:20–25`)
- **7. Pummels do not visibly replenish or recompute the cached timer:** capture damage continues decrementing it, but expiration is checked in capture wait. (`Co/ftCo_CaptureWait.c:105–128`; `Co/ftCo_0DC2.c:20–25,67–72`)
- **8. Throw animation speed can depend on victim weight; throw knockback substitutes a common-data weight:** these are separate mechanisms. (`Co/ftCo_Throw.c:162–174,542–545`)
- **9. Throws apply directional influence:** release explicitly calls the ordinary trajectory-rotation helper after entering damage. (`Co/ftCo_Thrown.c:175–190`; `Co/ftCo_Damage.c:530–560`)
- **10. Ground and air release have separate victim states:** numerical frame advantage requires animation/script DATA; no dedicated post-release grab-immunity timer is installed by these entry functions. (`Co/ftCo_CaptureCut.c:24–45`; `Co/ftCo_CaptureJump.c:15–50`; `Co/ftCo_CatchCut.c:8–31`)

Citation prefixes resolve inside `C:/DEV/_refs/melee-pc/`:

- `FT/` = `src/melee/ft/`.
- `Co/` = `src/melee/ft/kinds/ftCommon/`.
- `Ys/` = `src/melee/ft/kinds/ftYoshi/`.
- `LB/` = `src/melee/lb/`.
- `DATA` means the value must be extracted from the indicated game-data field, animation, or action script.
- Timing convention: **N simulation frames = N/60 seconds**; animation frames can advance at a weight-dependent rate.
- “Source discrepancy” identifies a limitation of this checkout; it is not silently promoted to verified NTSC-U 1.02 behavior.

## 2. State machine

### 2.1 Grab entry and attempted grabs

| State or entry route | Entry, processing, inputs, and exit | Timing / evidence |
|---|---|---|
| `Catch`, ID 212 | Ordinary entry requires held normalized shield input and newly pressed A, after item-related checks. Entry clears self acceleration, starts animation at 0 with rate 1, and registers grab callbacks. | Startup/active/end = DATA; `Co/ftCo_Catch.c:16–35,106–115`; `FT/ftmotionstates.c:2467–2474` |
| `CatchDash`, ID 214 | The moving-grab checker uses the same shield+A condition but selects `CatchDash`. Dash and Run call this checker. | Startup/active/end = DATA; `Co/ftCo_Catch.c:38–57`; `Co/ftCo_Dash.c:90–121`; `Co/ftCo_Run.c:109` |
| Buffered moving-grab route | `ftCo_800D8AE0` accepts held shield while `common.x0` is nonzero, otherwise decrements that counter. | Counter initialization/meaning requires caller context; `Co/ftCo_Catch.c:60–79` |
| Dash-shield grab route | Newly pressed A while `guard.x24` is nonzero selects `CatchDash`; otherwise the counter decrements. | Window = DATA/caller initialization; `Co/ftCo_Catch.c:83–93`; `Co/ftCo_Guard.c:469–477` |
| Turnaround/pivot route | `Turn_IASA` calls the ordinary standing-grab checker; facing can be temporarily reversed before that call. The common state list has no separate `CatchTurn`. | Turn timing = DATA; `Co/ftCo_Turn.c:93–113,126–163`; `Co/forward.h:502–508` |

- Z is normalized into shield+A before pressed-button edges are calculated; it is not a separate catch-state condition. (`FT/fighter.c:1904–1922,1772–1787`)
- Holding A continuously is different from pressing A: ordinary grab entry tests `pressed_buttons`, while shield is tested in `held_buttons`. (`Co/ftCo_Catch.c:29–32`)
- Link/Young Link cannot begin this ordinary grab when their hookshot already exists; Samus has an equivalent existing-grapple check. (`Co/ftCo_Catch.c:181–190`; `Co/ftCo_0D8E.c:190–196`)
- `Catch_IASA` and `CatchDash_IASA` are empty: there is no ordinary input-cancel frame within either callback. (`Co/ftCo_Catch.c:143–145`)
- A missed ordinary standing grab returns through `ft_8008A2BC` when its animation finishes, after character-specific hookshot/grapple handling. (`Co/ftCo_Catch.c:118–130`)
- A missed dash grab follows the equivalent animation-completion rule. (`Co/ftCo_Catch.c:133–140`)
- Thus whiff recovery is the remaining animation after the final active catch frame; neither a universal recovery number nor a universal active interval appears here. (`Co/ftCo_Catch.c:118–145`; `FT/ftaction.c:301–377`)
- Standing-grab physics applies common multiplier `x64` to ground friction; dash-grab physics uses the corresponding moving-ground helper. (`Co/ftCo_Catch.c:147–160`)
- Leaving the floor cleans up character grapple articles and enters `Fall`. (`Co/ftCo_Catch.c:163–178`)

### 2.2 Successful grab and hold

| State | Entry and per-frame behavior | Inputs and exit |
|---|---|---|
| `CatchPull`, ID 213 | Successful `Catch` selects this state, preserving the current animation position with command updating; ground velocity becomes zero. | IASA empty; ordinary exit to `CatchWait` when animation ends or throw flag b3 is consumed. `Co/ftCo_CatchPull.c:26–42,63–65,102–124`; `FT/ftmotionstates.c:2478–2485` |
| `CatchDashPull`, ID 215 | Successful `CatchDash` selects this counterpart, sharing `CatchPull` callbacks and the dash-grab animation. | Same input restriction and exit logic. `Co/ftCo_CatchPull.c:29–42,70–124`; `FT/ftmotionstates.c:2500–2507` |
| `CatchWait`, ID 216 | Entry starts the hold animation at 0/rate 1, installs attachment checking, applies grab-exclusion mask `0x1FF`, and moves the victim into capture wait. | Every scheduled IASA call checks pummel first, throws second; no animation-frame threshold is present. `Co/ftCo_CatchWait.c:14–61` |
| `CatchAttack`, ID 217 | Newly pressed A in `CatchWait` starts pummel at 0/rate 1; attachment and grab exclusion remain installed. | IASA empty; animation completion returns to `CatchWait`. Hit frame, damage, and total duration = DATA. `Co/ftCo_CatchWait.c:97–103`; `Co/ftCo_CatchAttack.c:11–29` |
| `CatchCut`, ID 218 | Grabber release state; applies backward ground speed, or backward/upward air speed, then starts at 0/rate 1. | IASA empty; animation completion selects grounded wait or aerial fall. Duration = DATA. `Co/ftCo_CatchCut.c:8–31`; `FT/ftcommon.c:614–620` |

- Pull normally continues from the successful grab’s current animation frame; it does not restart the grab from frame 0. (`Co/ftCo_CatchPull.c:26–42,63–65`)
- Yoshi has a DATA-driven frame-remapping exception when a standing grab connects within his attribute interval. (`Co/ftCo_CatchPull.c:29–38`)
- Link/Young Link and Samus leave pull according to article existence/completion flags rather than only ordinary animation completion. (`Co/ftCo_CatchPull.c:76–100`)
- `CatchWait_Anim` is empty: the victim’s timer controls ordinary timeout, not a grabber-side countdown. (`Co/ftCo_CatchWait.c:43`; `Co/ftCo_CaptureWait.c:113–128`)
- Pummel has priority over throw selection when both conditions are recognized in the same `CatchWait_IASA` call. (`Co/ftCo_CatchWait.c:45–61`)
- Pummel and throw commands are not checked by `CatchPull_IASA` or `CatchAttack_IASA`. (`Co/ftCo_CatchPull.c:124`; `Co/ftCo_CatchAttack.c:29`)
- Losing floor support during pull, hold, or pummel explicitly unlinks the pair and sends both fighters to `Fall`. (`Co/ftCo_CatchPull.c:140–146`; `Co/ftCo_CatchWait.c:78–84`; `Co/ftCo_CatchAttack.c:44–51`)
- Excessive attachment separation can force `CatchCut` plus victim release; thresholds are common DATA `x34C` and `x350`. (`Co/ftCo_CatchPull.c:172–187`)
- If the victim attachment lies behind the grabber, the grabber can move toward it, capped by walking maximum velocity. (`Co/ftCo_CatchPull.c:189–196`)

### 2.3 Victim capture states

| State | Entry and per-frame behavior | Inputs, duration, and exit |
|---|---|---|
| `CapturePulledHi`, ID 223 | Selected when the victim was airborne; initializes reciprocal grab links and timer, faces opposite the grabber, clears movement, and follows the grab attachment. | Anim/IASA empty; grabber’s pull completion selects `CaptureWaitHi`. Pull duration = DATA/event. `Co/ftCo_CapturePulled.c:39–75,113–151,187–215`; `Co/ftCo_CaptureWait.c:41–49` |
| `CapturePulledLw`, ID 226 | Selected when the victim was grounded; aligns the victim’s root bone to the grabber attachment. | Anim/IASA empty; sufficiently high attachment or loss of support switches to Hi, preserving animation frame. `Co/ftCo_CapturePulled.c:121–126,264–282,301–330` |
| `CaptureWaitHi`, ID 224 | Entered from airborne pull; each active animation callback increments elapsed hold time and decrements the cached grab timer. | X/Y can mark air release during an early DATA interval; timer expiry chooses `CaptureJump` or `CaptureCut`. `Co/ftCo_CaptureWait.c:74–150,306–322` |
| `CaptureWaitLw`, ID 227 | Grounded counterpart; its animation callback delegates to the Hi callback and follows the same attachment logic. | Same timeout and jump-release input rules; support/attachment changes can select Hi. `Co/ftCo_CaptureWait.c:171–199,240–280,306–322` |
| `CaptureDamageHi`, ID 225 | Damage while held can enter this state at frame 0/rate 1; animation callback runs timer decrement plus mash helper. | IASA empty; returns to `CaptureWaitHi` when damage animation ends. Duration = DATA. `Co/ftCo_0DC2.c:11–32` |
| `CaptureDamageLw`, ID 228 | Grounded held-damage counterpart with the same timer/mash processing. | IASA empty; returns to `CaptureWaitLw`; floor/attachment changes can select Hi. Duration = DATA. `Co/ftCo_0DC2.c:49–102` |
| `CaptureCut`, ID 229 | Unlinks both fighters and starts ordinary release at frame 0/rate 1; applies backward horizontal speed. | IASA empty; end selects wait/fall. Duration = DATA. `Co/ftCo_CaptureCut.c:24–59`; `FT/ftcommon.c:614–620` |
| `CaptureJump`, ID 230 | Unlinks the pair, forces air state, applies backward/upward release velocity, and starts a frame counter. | Air-action checks begin when counter reaches DATA `x3B8`; animation end enters Fall. `Co/ftCo_CaptureJump.c:15–63` |

- “Hi/Lw” capture selection initially follows the victim’s airborne/grounded status; it is not chosen by the grabber pressing up/down. (`Co/ftCo_CapturePulled.c:113–126`)
- Capture initialization stores the grabber in the victim’s field named `victim_gobj`; the field name therefore cannot be interpreted literally on both sides. (`Co/ftCo_CapturePulled.c:39–60`)
- During ordinary pull, capture callbacks contain neither mash processing nor timer decrement. (`Co/ftCo_CapturePulled.c:132–134,187–208,264–266,285–324`)
- In `CaptureDamage`, a nonpositive timer does not itself trigger release in that callback; the callback first waits for damage-animation completion. (`Co/ftCo_0DC2.c:20–25,67–72`)
- Ground/air capture changes preserve current animation frame and update the attachment offset. (`Co/ftCo_CapturePulled.c:239–260,273–279`; `Co/ftCo_CaptureWait.c:255–264`)
- Special captures, list only: Koopa `CaptureKoopa/…Air` (`Co/ftCo_CaptureKoopa.c:84–105`); Kirby `CaptureKirby` (`Co/ftCo_CaptureKirby.c:40–50`); Yoshi `CaptureYoshi` (`Co/ftCo_CaptureYoshi.c:12–29`); Captain `CaptureCaptain` (`Co/ftCo_CaptureCaptain.c:13–35`).

### 2.4 Throw selection and paired throw states

| Grabber state | Victim state | Input accepted in `CatchWait` | Completion / evidence |
|---|---|---|---|
| `ThrowF`, ID 219 | `ThrownF`, ID 239 | Horizontal left-stick threshold crossing toward facing, or qualifying C-stick horizontal input toward facing. | Scripted release; grabber normally returns to wait/fall at animation end. `Co/ftCo_Throw.c:75–126,162–174,298–315` |
| `ThrowB`, ID 220 | `ThrownB`, ID 240 | Equivalent horizontal input opposite facing. | Scripted release; empty IASA; end selects wait/fall. `Co/ftCo_Throw.c:104–126,348–359` |
| `ThrowHi`, ID 221 | `ThrownHi`, ID 241 | Upward left-stick crossing or C-stick up condition, after horizontal tests fail. | Scripted release; empty IASA; end selects wait/fall. `Co/ftCo_Throw.c:84–90,120–123,394–405` |
| `ThrowLw`, ID 222 | `ThrownLw`, ID 242 | Downward left-stick crossing or C-stick down condition, after earlier tests fail. | Scripted release; empty IASA; end selects wait/fall. `Co/ftCo_Throw.c:94–100,120–123,450–461` |
| Koopa/GKoops down-throw variant | `ThrownlwWomen`, ID 243 | Same down-throw selection when victim is Peach or Zelda. | Uses ordinary ThrownLw callbacks; animation = DATA. `Co/ftCo_Throw.c:175–183`; `FT/ftmotionstates.c:2808–2815` |

- Throw selection needs no additional A press after the direction condition; A is checked separately for pummel. (`Co/ftCo_CatchWait.c:45–61`; `Co/ftCo_Throw.c:104–129`)
- Left-stick horizontal input has priority over C-stick horizontal, then up, then down. (`Co/ftCo_Throw.c:108–123`)
- Left-stick horizontal/up/down tests compare previous and current samples; a direction already held before `CatchWait` may not create the required crossing. (`Co/ftCo_Throw.c:75–100`)
- C-stick horizontal/up also use crossings; **this source’s C-stick down helper requires both previous and current Y ≤ threshold**, not a crossing. Retail equivalence of that asymmetry is UNCONFIRMED. (`FT/ft_0DF1.c:172–200`)
- Throw entry clears command/throw flags, starts the grabber and victim at the same animation speed, and masks the grabber against grabs. (`Co/ftCo_Throw.c:132–159`)
- Thrown entry attaches the victim, sets matching facing, starts its paired animation, and masks grabs. (`Co/ftCo_Thrown.c:21–44`)
- Ordinary Thrown states have empty IASA, physics, and collision callbacks; attachment and release are managed separately. (`Co/ftCo_Thrown.c:88–119,134–143`)
- Ordinary throw entry sets the victim’s timer to zero; Kirby forward/back throws preserve it and retain escape processing. (`Co/ftCo_Thrown.c:36–39,61–84`)
- Every throw’s release frame and total duration are DATA script/animation values, in animation frames; simulated duration also depends on animation speed and pauses. (`Co/ftCo_Throw.c:162–174,246–295`)

## 3. Constants

`C[offset]` below means `p_ftCommonData` at the stated original game-data offset; offsets do not describe the native PC object layout.

| Name | Value | Where it comes from | Meaning |
|---|---|---|---|
| State entry frame | 0 animation frames = 0 s | `Co/ftCo_Catch.c:114`; `Co/ftCo_CatchAttack.c:15–16` | Ordinary fresh grab/pummel entry |
| Ordinary entry animation rate | 1 animation frame per simulation frame | `Co/ftCo_Catch.c:114` | Baseline rate before special handling |
| Catch capsule slots searched | 4 slots | `FT/ftcoll.c:1336–1339` | Ordinary fighter catch search |
| Ordinary grab class | `0x001` mask | `Co/ftCo_Catch.c:115`; `FT/ftcommon.c:915–923` | Compared against victim exclusion mask |
| Held/throw grab exclusion | `0x1FF` mask | `Co/ftCo_CatchWait.c:29`; `Co/ftCo_Thrown.c:42` | Blocks intersecting grab classes |
| Grab ground-friction multiplier | DATA, multiplier | `ftCommonData +064 x64`; `FT/types.h:163` | Grabber deceleration |
| Mash directional threshold | DATA, stick units | `ftCommonData +308 x308`; `FT/types.h:361` | Strict positive/negative threshold |
| Throw-start protection | DATA frames; DATA/60 s | `ftCommonData +348 x348`; `FT/types.h:376` | Passed to timed hit-status helper |
| Attachment horizontal limit | DATA, world units | `ftCommonData +34C x34C`; `FT/types.h:377` | Separation-forced release |
| Attachment vertical limit | DATA, world units | `ftCommonData +350 x350`; `FT/types.h:378` | Separation-forced release |
| Hold base | DATA, timer units | `ftCommonData +354 x354`; `FT/types.h:379` | Timer initialization |
| Handicap coefficient | DATA, timer units per handicap unit | `ftCommonData +358 x358`; `FT/types.h:380` | Timer initialization |
| Handicap reference | DATA, handicap units | `ftCommonData +35C x35C`; `FT/types.h:381` | Timer initialization |
| Standings coefficient | DATA, timer units | `ftCommonData +360 x360`; `FT/types.h:382` | Timer initialization |
| Standings reference | DATA, standings units | `ftCommonData +364 x364`; `FT/types.h:383` | Timer initialization |
| Percent coefficient | DATA, timer units per percent | `ftCommonData +368 x368`; `FT/types.h:384` | Timer initialization |
| Victim release friction | DATA, multiplier | `ftCommonData +36C x36C`; `FT/types.h:385` | CaptureCut grounded friction |
| Ground release horizontal speed | DATA, units/frame | `ftCommonData +370 x370`; `FT/types.h:386` | Backward release movement |
| Air release horizontal speed | DATA, units/frame | `ftCommonData +374 x374`; `FT/types.h:387` | CaptureJump and aerial CatchCut |
| Air release vertical speed | DATA, units/frame | `ftCommonData +378 x378`; `FT/types.h:388` | Upward release movement |
| Weight-to-animation-rate coefficient | DATA, inverse-weight units | `ftCommonData +37C x37C`; `FT/types.h:389` | Weight-dependent throw speed |
| Interrupted-grab fallback attack | DATA, collision descriptor | `ftCommonData +380 x380`; `FT/types.h:390`; `Co/ftCo_Throw.c:595–616` | Used by damage interruption logic |
| Automatic timer decrement | DATA, timer units per active callback | `ftCommonData +3A4 grab_timer_decrement`; `FT/types.h:391` | Hold/damage timer decay |
| Ordinary capture mash decrement | DATA, timer units/event | `ftCommonData +3A8 x3A8`; `FT/types.h:392` | Helper argument in CaptureDamage |
| Early jump-release registration interval | DATA frames; DATA/60 s | `ftCommonData +3AC x3AC`; `FT/types.h:393` | Elapsed hold-time comparison |
| Mash animation interval | DATA frames; DATA/60 s | `ftCommonData +3B0 x3B0`; `FT/types.h:394` | Victim animation-rate bookkeeping |
| Mash animation rate | DATA, animation frames/frame | `ftCommonData +3B4 shouldered_anim_rate`; `FT/types.h:395` | Victim shake animation rate |
| Air-release action threshold | DATA frames; DATA/60 s | `ftCommonData +3B8 x3B8`; `FT/types.h:396` | CaptureJump IASA gate |
| Release floor-placement threshold | DATA, world units | `ftCommonData +3BC x3BC`; `FT/types.h:397` | Unlink placement test |
| Held-damage retention threshold | DATA, damage units | `ftCommonData +3C0 x3C0`; `FT/types.h:398` | Helps decide retained capture versus break |
| Ground-to-air attachment threshold | DATA, scaled world units | `ftCommonData +3C4 x3C4`; `FT/types.h:399` | Capture Hi/Lw switching |
| Retained throw mash decrement | DATA, timer units/event | `ftCommonData +3C8 x3C8`; `FT/types.h:400` | Kirby F/B retained-timer branch |
| Horizontal throw threshold | DATA, stick units | `ftCommonData +098 x98`; `FT/types.h:198` | Left/C-stick horizontal selection |
| Up-throw threshold | DATA, stick units | `ftCommonData +0AC attackhi3_stick_threshold_y`; `FT/types.h:203` | Left/C-stick up selection |
| Down-throw threshold | DATA, stick units | `ftCommonData +0B0 xB0`; `FT/types.h:204` | Left/C-stick down selection |
| Tap-jump release threshold | DATA; repository comment states 0.6625 | `ftCommonData +070 tap_jump_threshold`; `FT/types.h:173–174` | Up-stick air-release condition |
| Throw knockback weight | DATA, weight units | `ftCommonData +10C x10C`; `FT/types.h:227`; `Co/ftCo_Throw.c:542–545` | Replaces victim weight for throw knockback |
| DI angular coefficient | DATA, degrees | `ftCommonData +1A8 x1A8`; `FT/types.h:266` | Launch trajectory rotation |
| Fighter weight | DATA, weight units | `ftCo_DatAttrs +088 weight`; `FT/types.h:857` | Throw animation-rate input |
| Weight-independent throw mask | DATA, four direction bits | `ftCo_DatAttrs +180 weight_independent_throws_mask`; `FT/types.h:922` | Disables weight-dependent speed per throw |
| Holding attachment bone | DATA, bone index | `ftData_x8 +011 x11`; `FT/types.h:752–756`; `Co/ftCo_CatchPull.c:59` | Ordinary grab attachment |
| Grab/pummel/release lengths | DATA L frames; L/60 s at rate 1 | `FT/ftanim.c:521–546`; respective state completion callbacks | Animation-defined durations |
| Catch geometry and active interval | DATA, units and animation frames; frames/60 s at rate 1 | `FT/ftaction.c:317–357` | Character action-script hitboxes |
| Throw release frame | DATA R animation frames | `FT/ftaction.c:493–504`; `Co/ftCo_Throw.c:255–278` | Script raises release flag |
| Ground/air release advantage | DATA-derived Δ frames; Δ/60 s | `Co/ftCo_CatchCut.c:24–31`; `Co/ftCo_CaptureCut.c:38–45`; `Co/ftCo_CaptureJump.c:28–50` | No universal numeric value established |

## 4. Formulas

### 4.1 Initial hold timer

Let P be victim percent and H be victim handicap at capture initialization.

Let S = `Player_80033BB8(victim.player_idx) + 1`.

The exact timer expression is:

**T₀ = P·C[368] + C[354] + C[358]·(C[35C] − H) + C[360]·(C[364] − S).**

Source: `Co/ftCo_CapturePulled.c:19–36,53–60`.

- All six coefficients/references are DATA; the result is stored as a floating-point grab timer. (`FT/types.h:379–384,1642`)
- `Player_80033BB8` forwards to `gm_8016C5C0`; that returns the player/team standings field named `is_big_loser`. It is not a player-count query. (`src/melee/pl/player.c:912–915`; `src/melee/gm/gmvs.c:977–990`)
- No minimum/maximum clamp appears in the initialization expression. (`Co/ftCo_CapturePulled.c:53–60`)
- Percent changes after initialization do not automatically rerun this formula in the inspected hold/pummel callbacks. (`Co/ftCo_CaptureWait.c:105–146`; `Co/ftCo_CatchAttack.c:11–27`)

### 4.2 Timer decrement and mash events

Let D = `C[3A4]`, M = the mash-helper argument, B = qualifying button event, and Q = qualifying stick event.

| Operation | Exact rule | Evidence |
|---|---|---|
| CaptureWait tick | `T ← T − D`; release if `T ≤ 0` | `Co/ftCo_CaptureWait.c:118–128` |
| CaptureDamage tick | `T ← T − D − M·B − M·Q`, with `M=C[3A8]` | `Co/ftCo_CaptureWait.c:105–110`; `FT/ftcommon.c:700–725` |
| Retained Thrown timer | If timer is nonzero: subtract D, process mash with `M=C[3C8]`, then test expiration | `Co/ftCo_Thrown.c:75–83` |
| Button event B | 1 if any newly pressed A/B/X/Y/normalized shield bit exists; otherwise 0 | `FT/ftcommon.c:703–705` |
| Stick event Q | 1 if either remembered axis sign changes after strict threshold tests; otherwise 0 | `FT/ftcommon.c:708–724` |

- Stick memory starts `(0,0)`; X and Y memories independently become −1 below `−C[308]` or +1 above `C[308]`. (`FT/ftcommon.c:688–692,708–720`)
- Entering the neutral band does not reset either memory to zero. (`FT/ftcommon.c:710–721`)
- Changing both axes during one helper call still gives one stick subtraction, because the final condition ORs the two comparisons. (`FT/ftcommon.c:722–724`)
- A simultaneous button event and stick event can subtract **2M** during one helper call. (`FT/ftcommon.c:703–724`)
- A simultaneous press of multiple qualifying buttons subtracts **M**, not M per button. (`FT/ftcommon.c:703–705`)
- If uninterrupted CaptureWait receives positive T₀ and D, its countdown portion lasts `ceil(T₀/D)` active animation callbacks, or that count/60 seconds excluding pauses. This is a derivation of its decrement-before-test ordering. (`Co/ftCo_CaptureWait.c:118–128`)
- **UNCONFIRMED retail connection:** this tree does not call `ftCommon_GrabMash` inside `CaptureWaitHi_Anim`; do not assume the CaptureDamage recurrence is already executed during ordinary CaptureWait. (`Co/ftCo_CaptureWait.c:113–146`)

### 4.3 Pummels and expiration

- Pummel entry and completion do not add a timer bonus or reset T. (`Co/ftCo_CatchAttack.c:11–27`)
- Victim capture damage decrements T and processes mash each active animation callback. (`Co/ftCo_0DC2.c:20–25,67–72`; `Co/ftCo_CaptureWait.c:105–110`)
- CaptureDamage does not release immediately when T crosses zero: it returns to CaptureWait after its DATA animation finishes; CaptureWait performs the expiration test. (`Co/ftCo_0DC2.c:20–25,67–72`; `Co/ftCo_CaptureWait.c:118–128`)
- Thus pummel can postpone the **release check** through capture-damage duration without mathematically replenishing the timer. (`Co/ftCo_0DC2.c:20–25`; `Co/ftCo_CaptureWait.c:105–128`)

### 4.4 Release selection, movement, and advantage

| Formula / rule | Exact behavior | Evidence |
|---|---|---|
| Early jump flag | Set when elapsed capture time `< C[3AC]` and X/Y is newly pressed | `Co/ftCo_CaptureWait.c:306–313` |
| Up-stick release request | Current stick Y `≥ tap_jump_threshold` | `Co/ftCo_CaptureWait.c:316–322` |
| Timeout release branch | Enter grabber CatchCut; victim uses CaptureJump if jump flag or up-stick request, otherwise CaptureCut | `Co/ftCo_CaptureWait.c:120–128` |
| Ground release horizontal speed | `−facing·C[370]` | `Co/ftCo_CatchCut.c:11–15`; `Co/ftCo_CaptureCut.c:29–32` |
| CaptureJump velocity | `vx=−facing·C[374]`, `vy=C[378]` | `Co/ftCo_CaptureJump.c:19–21` |
| Ground-release advantage | `Aground = firstVictimActionTick − firstGrabberActionTick`; positive means grabber acts first | Derived from `Co/ftCo_CaptureCut.c:38–45` and `Co/ftCo_CatchCut.c:24–31` |
| Air-release advantage | Same difference, but victim’s first action can come from threshold `C[3B8]`, animation completion, or landing behavior | `Co/ftCo_CaptureJump.c:28–63` |

Both advantage results are **DATA-derived frames**, with seconds equal to result/60; this tree does not establish a universal numeric advantage.

### 4.5 Throw speed and release scheduling

Let i = throw state ID − 219, W = victim’s data weight, and K = `C[37C]`.

**Animation rate a = 1 if the thrower’s weight-independent mask has bit i; otherwise a = 1/(W·K).**

Source: `Co/ftCo_Throw.c:162–174`.

- The same a is passed to grabber Throw and victim Thrown entry. (`Co/ftCo_Throw.c:141–145`)
- A script release event at animation frame R occurs when animation advancement executes that event; its nominal animation budget is R/a simulation frames, or R/(60a) seconds, before pauses/special transitions. (`Co/ftCo_Throw.c:162–174,255–278`; `FT/ftaction.c:493–499`)
- Exact integer tick assignment requires script-command scheduling and entry-frame evaluation; R/a alone is not an independently verified first-action-frame table. (`FT/fighter.c:1356–1362,1699–1709`)
- Script flag b4 flips grabber facing; flag b3 applies the throw and releases the victim. (`Co/ftCo_Throw.c:246–278`)
- Script command variable 0 can freeze both animations; landing callbacks restore rate 1 and resume paired motion. (`Co/ftCo_Throw.c:193–224,281–295`; `Co/ftCo_Thrown.c:212–229`)

### 4.6 Throw damage and knockback

The throw descriptor is `grabber.xDF4[0]`; descriptor `[1]` is also used by interrupted-capture damage paths. (`Co/ftCo_Throw.c:510,530–550`; `Co/ftCo_Thrown.c:193–209`)

| Descriptor field | Meaning / population | Evidence |
|---|---|---|
| `damage`, `unk_count` | Processed damage and integer damage input used by knockback | `FT/ftcoll.c:2459–2474` |
| `kb_angle` | Throw angle, decoded by angle helper | `FT/ftaction.c:739`; `FT/ftcoll.c:2487` |
| `x24` | Knockback-growth field | `FT/ftaction.c:344,740` |
| `x28` | Weight-set/fixed-knockback branch parameter | `FT/ftaction.c:345,741`; `FT/ftcoll.c:2090–2097` |
| `x2C` | Base knockback | `FT/ftaction.c:351,744` |
| `element`, sound fields | Element and hit sound metadata | `FT/ftaction.c:744–747` |

For the shared knockback helper, define:

- `w = suppliedWeight·C[0F4]`; `G=hit.x24`; `F=hit.x28`; `B=hit.x2C`. (`FT/ftcoll.c:2071–2090`)
- `p = integer victim percent` in ordinary percent play; `q = victim.dmg.x1838_percentTemp`; `d = supplied unk_count`. (`FT/ftcoll.c:2057–2065,2101–2106`)
- `I = C[118]·C[110] + C[114]·C[118]·F` when F is nonzero. (`FT/ftcoll.c:2090–2097`)
- Otherwise `I = C[110]·(p+q) + C[114]·d·(p+q)`. (`FT/ftcoll.c:2098–2106`)
- Let `R` be the match knockback parameter, `Atk` attacker ratio, and `Def` defender ratio. (`Co/ftCo_Throw.c:542–545`)

**KBraw = Def·Atk·R·[0.01·G·(C[11C]·(C[0F8] − w·C[0F8]/(1+w))·I + C[120]) + B].**

**KB = min(KBraw, C[108]).**

Evidence: `FT/ftcoll.c:2071–2113`; all C coefficients are DATA (`FT/types.h:221–232`).

- Ordinary fighter-hit wrapper supplies victim character weight; ordinary throw release supplies `C[10C]` instead. The shared formula itself is reused. (`FT/ftcoll.c:2116–2122`; `Co/ftCo_Throw.c:542–545`)
- Throw release then invokes common knockback postprocessing, including applicable scale/armor/minimum handling. (`Co/ftCo_Throw.c:553`; `Co/ftCo_Damage.c:124–151`)
- Damage setup passes through the shared damage/staling path; throw damage and the integer knockback input are not necessarily identical. (`FT/ftaction.c:735–736`; `FT/ftcoll.c:2459–2474,1258–1268`)

### 4.7 Throw directional influence

For pre-DI launch vector `(vx,vy)` and current left stick `(sx,sy)`:

**m² = vx²+vy²; c = vx·sy−vy·sx; u = c²/m², negated when c<0.**

**θ′ = atan2(vy,vx) + radians(C[1A8])·u.**

**v′ = √m²·(cos θ′, sin θ′).**

Evidence: `Co/ftCo_Damage.c:532–557`.

- Rotation is skipped for zero stick or `m² < 0.00001`; magnitude is preserved by this helper. (`Co/ftCo_Damage.c:532–557`)
- Throw release calls this helper directly after damage entry, using the stick value available at that release. (`Co/ftCo_Thrown.c:175–190`)
- The Boolean named `is_upward` is passed true for **down throw**, causing forced damage-state argument 90; it does not overwrite the throw descriptor’s launch angle with 90 degrees. (`Co/ftCo_Throw.c:278`; `Co/ftCo_Thrown.c:151–159,189`; `Co/ftCo_Damage.c:316–326`)

## 5. Interactions and edge cases

### 5.1 Detection and priority

- The ordinary grab path is `Fighter_procGrabColl → ftColl_80078A2C → grab_cb → grabbed_cb`; successful capture immediately changes both motion states. (`FT/fighter.c:2609–2624`)
- A catch box is a `HitCapsule` carrying `HitElement_Catch`, with enabled state and appropriate aerial/ground target bits. (`FT/ftcoll.c:1336–1343`)
- Candidate hurt capsules must have `is_grabbable=true` and capsule state exactly `HurtCapsule_Enabled`. (`FT/ftcoll.c:1348–1356`; `LB/lbcollision.c:1667–1695`)
- Catch geometry uses the common capsule-intersection routine with swept hit positions, hurt endpoints, transforms, and scale inputs. (`LB/lbcollision.c:1668–1693`)
- Radius is hitbox scale, multiplied by fighter Y scale unless the ignore-scale flag is set. (`LB/lbcollision.c:1685–1693`)
- The path rejects global nonzero `x1988/x198C` hit status, star-protection flag `x221D_b6`, grab-mask overlap, excluded teams, and stamina death. (`FT/ftcoll.c:1325–1334`)
- Consequently both global invincibility/intangibility status and non-enabled individual hurt capsules can prevent grabs; ordinary damage immunity is not permission to grab through them. (`FT/ftcoll.c:1331–1333`; `LB/lbcollision.c:1667`)
- Already-recorded victims of a catch capsule are skipped through its victim history. (`FT/ftcoll.c:1345`; `LB/lbcollision.c:2673–2685`)
- A stage-wall test between fighter centers can reject an otherwise overlapping grab. (`FT/ftcoll.c:1358–1362`; `FT/ft_081B.c:1334–1368`)
- With multiple eligible opponents, the search retains the smallest absolute horizontal center distance; equal distances do not replace the existing choice. (`FT/ftcoll.c:1292–1306`)

### 5.2 Hitbox versus grab; grab versus grab

- Catch elements are excluded from the ordinary fighter hitbox-clank loops: overlapping a sword hitbox and catch box does not itself produce a normal clank. (`FT/ftcoll.c:1437–1443,1474–1476`)
- Registered processing order puts grab collision at phase 12, attack collision at 13, and collision resolution at 14. (`FT/fighter.c:914–916`)
- Successful normal capture enters the victim state with `Ft_MF_None`; motion-state entry clears active hitboxes when hit preservation is absent. (`Co/ftCo_CapturePulled.c:66`; `FT/fighter.c:961–967`)
- **Source-derived same-frame result:** a successful ordinary grab can remove the grabbed fighter’s ordinary hitbox before phase-13 attack checks; there is no universal “attack wins a same-frame grab” rule in this path. (`FT/fighter.c:914–916,961–967,2622–2623`)
- An attack that connects before grab startup becomes active can interrupt the attempted grab through normal damage processing; hitbox/catch reach and timing still matter. (`Co/ftCo_Catch.c:143–145`; `Co/ftCo_Damage.c:871–877`; `FT/ftcoll.c:1338–1343`)
- For simultaneous ordinary grabs, the first successful capture disables the other fighter’s grab registration and clears its catch hitboxes. This makes processing order relevant rather than causing a universal mutual grab break. (`FT/fighter.c:961–967,1076,2615–2623`)
- **UNCONFIRMED:** the exact controller-port winner/order guarantee requires scheduler ordering evidence outside the inspected implementation; no numerical port-priority rule is asserted.

### 5.3 Shield and guard

- Ordinary shield collision uses separate shield flags/geometry; the catch search does not consult those fields. (`FT/ftcoll.c:2647–2658,1311–1375`)
- Therefore the catch must reach a valid hurt capsule: touching only the larger shield bubble does not establish a successful grab. (`FT/ftcoll.c:1348–1356`)
- Normal `GuardOn`, `Guard`, `GuardOff`, `GuardSetOff`, and `GuardReflect` are not state-name exclusions in the catch search. Existing invulnerability or grab-exclusion status can still reject them. (`FT/ftcoll.c:1325–1356`)
- Powershield reflector flags do not add an exception to that search. (`Co/ftCo_Guard.c:862–873`; `FT/ftcoll.c:1325–1356`)
- Shieldstun’s IASA callback is empty, limiting the defender’s actions; it does not itself provide a grab-immunity branch. (`Co/ftCo_Guard.c:831`; `FT/ftcoll.c:1325–1334`)
- **Yoshi exception:** custom GuardOn initialization sets all hurt capsules to `HurtCapsule_Disabled`; the catch intersection helper requires Enabled, so those intervals cannot be grabbed through the disabled capsules. (`Ys/ftyoshiguard.c:76–101,340–372`; `LB/lbcollision.c:1667–1695`)
- Yoshi’s held shield instead creates one enabled, explicitly grabbable replacement capsule while making the others intangible. (`Ys/ftyoshiguard.c:162–187`; `FT/ftcoll.c:2750–2760`)
- Exact Yoshi startup protection intervals remain DATA/script-dependent; the code does not justify claiming every frame of every shield state is grabbable. (`Ys/ftyoshiguard.c:126–139,377–392`)

### 5.4 Damage, hitlag, and interruption

- Held damage can remain capture damage when the pending damage is below DATA `x3C0` or `x221C_b0` allows retention; larger/interacting damage takes release branches. (`Co/ftCo_Damage.c:674–682,771–829`)
- Damage received by the grabber can break the pair and apply its secondary descriptor to the victim before normal damage continues. (`Co/ftCo_Damage.c:831–864`; `Co/ftCo_CaptureCut.c:210–235`)
- Pummel/held-damage handling can apply calculated hitlag to the grabber as well as handling the victim’s damage. (`Co/ftCo_Damage.c:791–807`)
- Animation callbacks are skipped while hitlag flag `x2219_b5` is set, so countdowns implemented inside those callbacks pause with that scheduling gate. (`FT/fighter.c:1675–1710`)
- Ordinary action input callbacks are also skipped during hitlag; pressed/released button edges accumulate in the input structure while that flag is set. (`FT/fighter.c:1777–1787,2151–2161`)
- Capture-damage processing explicitly clears victim pressed/released inputs in relevant branches; accumulated input is not an unrestricted mash buffer. (`Co/ftCo_Damage.c:805–813`)
- Throw-start protection uses DATA `x348` through `ftColl_8007B7A4`; that helper extends a timed hit-status counter and makes `x198C` nonzero. (`Co/ftCo_Throw.c:159`; `FT/ftcoll.c:2824–2831`)
- That timed status counts down independently in `Fighter_procAnim`; its exact duration is DATA frames, DATA/60 seconds. (`FT/fighter.c:1490–1497`)
- The throw’s absolute damage is applied directly to its linked victim at the script event, without performing a fresh spatial catch/hurtbox intersection. (`Co/ftCo_Throw.c:271–278,506–553`)
- Release unlinks both reciprocal references and removes the skeletal constraint, with collision-aware position correction. (`Co/ftCo_Throw.c:526–529,554–582`; `Co/ftCo_CaptureCut.c:110–195`)

### 5.5 Attachment and regrabs

- During ordinary holding, the grabber attachment is the DATA bone index `ftData_x8.x11`; tether characters can temporarily use an article joint instead. (`Co/ftCo_CatchPull.c:44–59`)
- The victim’s `XRotN` world position is aligned to that attachment during pull/wait. (`Co/ftCo_CapturePulled.c:144–151,197–207`; `Co/ftCo_CaptureWait.c:153–155`)
- For throws, the victim’s `XRotN` joint is constrained to the thrower’s `TransN2`; original local translation is saved for restoration. (`Co/ftCo_CapturePulled.c:340–359`; `Co/ftCo_Thrown.c:28`)
- The throw accessory callback derives victim position from that constrained joint plus facing/scale offsets, explicitly setting world Z to zero. (`Co/ftCo_Thrown.c:48–58`)
- Captured/held/throw states commonly install exclusion mask `0x1FF`; normal grab uses class `1`, so those masks intersect and prevent another ordinary grab. (`Co/ftCo_CapturePulled.c:69`; `Co/ftCo_CatchWait.c:29`; `FT/ftcoll.c:1333`)
- Motion-state changes reset the exclusion mask; CaptureCut and CaptureJump entry do not install a separate post-release immunity timer. (`FT/fighter.c:1022,1068`; `Co/ftCo_CaptureCut.c:24–35`; `Co/ftCo_CaptureJump.c:15–25`)
- Thus no universal “wait N frames after release before regrab” constant is established here; a later catch still needs valid overlap, enabled/grabbable hurtboxes, and all ordinary eligibility checks. (`FT/ftcoll.c:1325–1359`)
- A fresh catch capsule’s victim history and any DATA-script hurt-status changes remain relevant; absence of a dedicated release timer does not prove every immediate regrab geometry succeeds. (`LB/lbcollision.c:2673–2685`; `FT/ftcoll.c:1345–1356`)
- PC-only anti-wobbling can break an Ice Climber’s capture after the fourth distinct counted hit without leaving capture damage; it is gated by deterministic-PC mode and singles conditions. This is not an unqualified retail rule. (`FT/ftwobble.c:18–35,68–114`)

## 6. Port notes for Marea Negra

These are transfer considerations, not implementation decisions; networking numbers below come from the authoritative ticket context.

- The attack/guard/grab triangle can retain separate strike and catch queries: Melee’s shield bypass is a distinct collision path, not excessive shield damage. (`FT/ftcoll.c:1311–1375,2647–2658`)
- Catch startup, active interval, and recovery should remain separate concepts when transferring DATA timelines; the attempted-grab IASA callbacks offer no general early cancel. (`Co/ftCo_Catch.c:118–145`)
- The paired grabber/victim relationship transfers directly as server-owned state: both references, timer, exclusion masks, and interruption outcomes must agree. (`Co/ftCo_CapturePulled.c:39–69`; `Co/ftCo_CaptureCut.c:110–195`)
- Attachment can transfer as a simulation anchor plus rendered animation anchor; Melee itself uses bone constraints and explicit position updates rather than free victim locomotion. (`Co/ftCo_CapturePulled.c:340–359`; `Co/ftCo_Thrown.c:48–58`)
- Melee’s facing sign, absolute-X nearest-target choice, and forced Z=0 are 2D assumptions requiring interpretation for third-person ship-deck combat. (`FT/ftcoll.c:1297–1306`; `Co/ftCo_Thrown.c:55–58`)
- Ground/air release, support loss, and floor correction have platformer-specific consequences; falling overboard could share the state distinction without inheriting every platform animation. (`Co/ftCo_CaptureJump.c:15–63`; `Co/ftCo_CaptureCut.c:137–188`)
- Weight-dependent throw animation and weight-independent throw knockback are independently transferable rules; combining them into one weight multiplier would change the observed mechanics. (`Co/ftCo_Throw.c:169–174,542–545`)
- Percent/handicap/standings timer terms can be preserved symbolically until DATA extraction; dropping a term would be a tuning change rather than an exact copy. (`Co/ftCo_CapturePulled.c:19–36`)
- The server would need ordered button edges and stick samples to reproduce mash counting; transmitting only the latest held buttons can lose or merge events. This follows from the edge/sign-memory algorithm. (`FT/fighter.c:1777–1787`; `FT/ftcommon.c:703–724`)
- A 50 ms snapshot interval equals 3 Melee frames; 100 ms interpolation equals 6 frames; 100–250 ms RTT equals 6–15 frames. These are arithmetic conversions of ticket context.
- Any extracted input window shorter than 6–15 frames, or 0.100–0.250 s, is shorter than that full RTT range; exact affected grab/throw windows cannot be named numerically before DATA extraction.
- One simulation tick is 1 frame, approximately 0.01667 s; same-frame grab/attack arbitration is much shorter than either the snapshot interval or stated latency.
- Preserving local prediction and authoritative reconciliation is one possible way to show immediate grab startup while the server validates the historical collision; this is a port option, not a Melee networking rule.
- If strikes rewind to the attacker’s view, grab overlap, defender invulnerability, and shield state also need a coherent time reference for a comparable triangle; otherwise the collision categories would be judged at different times. (`FT/ftcoll.c:1325–1359`)
- A defender-time input check or delayed finalization could preserve short release/DI choices under latency; the relevant Melee behavior samples release requests and DI at specific processing events. (`Co/ftCo_CaptureWait.c:120–128`; `Co/ftCo_Thrown.c:189–190`)
- Server arrival order is not a demonstrated substitute for Melee’s same-frame process order; simultaneous events would need a defined authoritative ordering to reproduce the source-derived outcome. (`FT/fighter.c:914–916,2615–2623`)
- Fixed-tick simulation can preserve fractional grab timers and animation rates even when snapshots are less frequent; snapshot cadence need not become the timer cadence. (`FT/types.h:1642`; `Co/ftCo_Throw.c:169–174`)
- The normal-hold mash discrepancy and C-stick-down asymmetry should be resolved before claiming an exact retail clone; reproducing this checkout literally may reproduce source defects. (`Co/ftCo_CaptureWait.c:113–146`; `FT/ft_0DF1.c:194–200`)

## 7. Open questions

- **DATA pending:** character standing/dash grab startup, active intervals, geometry, total animation length, and resulting whiff recovery. (`Co/ftCo_Catch.c:118–145`; `FT/ftaction.c:317–357`)
- **DATA pending:** all timer coefficients, normal decrement, mash decrement, jump-release registration interval, and release-action threshold. (`FT/types.h:379–400`)
- **DATA pending:** pummel damage, hit frame, grabber duration, and victim CaptureDamage duration for each character pairing. (`Co/ftCo_CatchAttack.c:11–27`; `Co/ftCo_0DC2.c:11–25,49–72`)
- **DATA pending:** four throw descriptors, release events, weight-independent masks, and animation lengths. (`FT/ftaction.c:732–748`; `Co/ftCo_Throw.c:162–174,271–278`)
- **DATA pending:** numeric grounded release advantage and air-release advantage, including character exceptions and landing transitions. (`Co/ftCo_CatchCut.c:24–31`; `Co/ftCo_CaptureCut.c:38–69`; `Co/ftCo_CaptureJump.c:28–63`)
- **UNCONFIRMED:** retail normal-hold mash execution; the inspected CaptureWait callback lacks the helper call present in CaptureDamage. (`Co/ftCo_CaptureWait.c:105–146`)
- **UNCONFIRMED:** retail correctness of the C-stick-down previous/current comparison. (`FT/ft_0DF1.c:194–200`)
- **UNCONFIRMED:** exact controller-port arbitration for simultaneous grabs; registered phase numbers and immediate state mutation establish ordering sensitivity, not a verified port-number winner. (`FT/fighter.c:914–916,2615–2623`)
- **UNCONFIRMED:** a universal post-release immunity duration; no dedicated timer is installed by the inspected release entries, while script-driven hurt status remains DATA. (`Co/ftCo_CaptureCut.c:24–35`; `Co/ftCo_CaptureJump.c:15–25`)
- **DATA pending:** exact Yoshi guard-startup ungrabbable frames and any script-driven hurtbox replacements within them. (`Ys/ftyoshiguard.c:76–101,126–139,340–392`)
- **Source limitation:** address-named functions remain throughout the path; names such as `x3C0`, `x348`, and `is_big_loser` are preserved rather than assigned unsupported retail meanings. (`Co/ftCo_Damage.c:674–682`; `FT/types.h:376,398`; `src/melee/gm/gmvs.c:977–990`)
- **Not covered:** full tether-article collision/retraction mechanics, every character’s throw projectile behavior, and special-command-capture internals; ordinary fighter grabs and the requested special-capture list are covered.
- **Not covered:** runtime/GameCube comparison establishing that this PC checkout’s anomalous branches match NTSC-U 1.02; this ficha is a read-only source trace, with those equivalence gaps explicitly identified.