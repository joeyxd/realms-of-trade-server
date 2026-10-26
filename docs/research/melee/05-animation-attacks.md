# Melee animation and attack scripting (T-1024-05)

## 1. Summary

1. A move is a motion-state entry plus animation data and a subaction script; the state installs separate animation, input, physics, collision, and camera callbacks. `F/types.h:1010-1042`; `F/fighter.c:1385-1389`.
2. Animation and scripts share animation-frame time: changing playback speed changes script timing too; hitlag skips their normal update. `F/ftaction.c:1358-1382`; `F/fighter.c:1675-1711`.
3. Hitboxes attach to animated bones with local offsets; their world positions retain the previous sample as well as the current sample. `F/ftaction.c:327-341`; `F/ftcoll.c:2500-2532`.
4. IASA is permission checked by the current state's input callback, separate from animation completion; it does not automatically return the fighter to idle. `F/ftaction.c:523-527`; `C/ftCo_Attack1.c:131-158`.
5. Jab links combine a remembered A press with a script-opened combo gate; Marth's attempted third jab restarts jab 1. `C/ftCo_Attack1.c:211-225`; `C/ftCo_Attack1.c:258-289`.
6. Rapid jab has Start, Loop, and End states; script boundaries decide whether recent A press/release activity sustains another cycle. `C/ftCo_Attack100.c:157-232`.
7. Smash charging freezes playback at a script-selected pose, counts charge ticks separately, then restores speed and applies a linear damage multiplier. `F/ft_0DF0.c:16-41`; `F/ft_0DF0.c:56-134`.
8. Aerial scripts select auto-cancel versus move-specific landing lag; L-cancel reads a recent LR-input timer and a DATA divisor. `C/ftCo_LandingAir.c:14-65`; `F/fighter.c:2125-2128`.
9. Dancing Blade links four attacks through script gates and vertical-stick branches; an early A/B press can disqualify the next link. `M/ftmarsspecials.c:97-110`; `M/ftmarsspecials.c:285-307`.
10. Counter's script opens/closes its detection state; a registered collision callback enters the counterattack. Its numeric parry frames are DATA. `M/ftmarsspeciallw.c:68-110`; `M/ftmarsspeciallw.c:306-339`.

Citation prefixes below resolve inside `C:/DEV/_refs/melee-pc/src/melee/`:
`F/` = `ft/`; `C/` = `ft/kinds/ftCommon/`; `M/` = `ft/kinds/ftMars/`; `L/` = `lb/`.

Timing basis supplied by the ticket: 60 simulation frames per second.
Every duration of **n frames means n/60 seconds**; animation-frame durations assume rate 1 unless stated.
`DATA` means the value must be obtained from the referenced game-data field or move script.
Port notes are deductions/options for the supplied Marea Negra architecture, not claims about Melee networking.

## 2. State machine

**State entry and ownership**

The common table is `ftData_MotionStateList`; Marth supplies `ftMs_Init_MotionStateTable`.
A fighter selects the common table below `fp->x18`, otherwise the character table at `msid - fp->x18`. `F/ftmotionstates.c:133`; `M/ftmars.c:22`; `F/fighter.c:1185-1189`.

| Entry field | Role | Evidence |
|---|---|---|
| `anim_id` | Submotion/animation-data index; distinct from the motion-state ID. | `F/types.h:1010-1011`; `F/fighter.c:1228-1271` |
| `x4_flags` | State metadata passed to `ft_800895E0`. | `F/types.h:1013`; `F/fighter.c:1206-1208` |
| `x8` | Packed move ID and additional state flags. | `F/types.h:1017-1035` |
| `anim_cb` | Per-frame move progression and animation-end transitions. | `F/types.h:1037`; `F/fighter.c:1708-1709` |
| `input_cb` | Per-frame input/interrupt decisions, commonly named `_IASA`. | `F/types.h:1038`; `F/fighter.c:2159-2160` |
| `phys_cb` | State-specific movement calculation. | `F/types.h:1039`; `F/fighter.c:2198-2199` |
| `coll_cb`, `cam_cb` | Environment collision/state transitions and camera behavior. | `F/types.h:1040-1041`; `F/fighter.c:1388-1389` |

Example: Attack11 is state 44, using `ftCo_SM_Attack11`, its metadata/move ID, and the five callbacks.
Attack12/13 reuse Attack11's physics and collision callbacks. `F/ftmotionstates.c:619-649`.

`Fighter_ChangeMotionState(gobj, msid, flags, anim_start, anim_speed, anim_blend, arg3)` selects the new state.
`arg3`, when non-null, supplies the other fighter's animation resources/script metadata. `F/fighter.c:941-944`; `F/fighter.c:1254-1271`.

The `flags` argument controls transition cleanup; it is a separate input from the state table's `x4_flags`.
The new state sets `anim_id`, playback speed, initial frame, and callback pointers. `F/fighter.c:1206-1233`; `F/fighter.c:1385-1389`.

| Transition control | What survives or changes | Evidence |
|---|---|---|
| `Ft_MF_SkipHit`, bit 3 | Skips clearing ordinary hitboxes and the associated alternate hit setup. | `F/forward.h:187`; `F/fighter.c:961-968` |
| `Ft_MF_KeepColAnimHitStatus`, bit 2 | Avoids restoring whole-body hit status and hurt capsules to normal. | `F/forward.h:184`; `F/fighter.c:974-980` |
| `Ft_MF_SkipModel`, bit 4 | Avoids restoring changed model-part selection. | `F/forward.h:190`; `F/fighter.c:987-989` |
| `Ft_MF_SkipAnimVel`, bit 5 | Avoids replacing grounded velocity with the newly sampled animation translation on a nonzero-frame entry. | `F/forward.h:192`; `F/fighter.c:1332-1353` |
| `Ft_MF_KeepFastFall`, bit 0 | Preserves fast-fall status. | `F/forward.h:179`; `F/fighter.c:1109-1111` |
| `Ft_MF_KeepGfx`, bit 1 | Avoids ordinary effect cleanup. | `F/forward.h:181`; `F/fighter.c:1117-1119` |
| `Ft_MF_KeepColAnimPartHitStatus`, bit 16 | Preserves the separately managed part-hit-status path. | `F/forward.h:221`; `F/fighter.c:1015-1020` |
| `Ft_MF_KeepSwordTrail`, bit 17 | Preserves sword-trail state. | `F/forward.h:223`; `F/fighter.c:1160-1162` |
| `Ft_MF_SkipModelPartVis`, bit 22 | Avoids resetting model-part visibility control. | `F/forward.h:236`; `F/fighter.c:1101-1103` |
| `Ft_MF_SkipModelFlags`, bit 26 | Avoids resetting `x2225_b2`. | `F/forward.h:244`; `F/fighter.c:1105-1107` |
| `Ft_MF_UpdateCmd`, bit 14 | Advances the new script using a command-skipping path. It is not a generic “keep old script pointer” flag. | `F/forward.h:216`; `F/fighter.c:1356-1362`; `F/ftaction.c:1426-1456` |
| `Ft_MF_SkipAnim`, bit 29 | Skips ordinary animation/script loading, then sets `anim_id = -1`; it does not simply preserve playback. | `F/forward.h:251`; `F/fighter.c:1264-1271`; `F/fighter.c:1364-1375` |

There is no automatic “preserve current animation frame” transition flag in this interface:
callers pass `fp->cur_anim_frame` as `anim_start`.
Ground/air counterpart helpers do exactly that, with playback rate 1. `C/inlines.h:82-99`.

There is likewise no single general velocity-preservation switch:
entry functions can modify velocity themselves, and `SkipAnimVel` controls a specific animation-derived overwrite. `F/fighter.c:1332-1353`; `M/ftmarsspecialn.c:30-53`.

**Per-tick sequence and playback**

Registered process priorities are: hitlag 0, animation 1, CPU 2, input 3, physics/update 4,
map collision 6, IK 7, accessories 8, hitbox positions 9, grabs 12, attacks 13, collision resolution 14.
These are process priorities, not durations. `F/fighter.c:905-916`.

`ftAnim_8006EBA4` evaluates animation, executes subactions, then runs additional animation-related updates.
The state's `anim_cb` follows later in the fighter animation process. `F/ftanim.c:385-391`; `F/fighter.c:1699-1709`.

Playback runs through HSD joint animation evaluation and reads the resulting AObj frame back into `cur_anim_frame`.
The sparse tree exposes these callers/readers, but not the underlying HSD frame-step implementation. `F/ftanim.c:173-179`; `F/ftanim.c:382`; `F/ftanim.c:561-582`.

A state starts with `cur_anim_frame = anim_start - anim_speed`; nonzero starts also request that preceding frame
before evaluation. Many entry functions immediately call the animation/script updater. `F/fighter.c:1228-1233`; `F/fighter.c:1274-1282`; `C/ftCo_Attack1.c:120-123`.

`ftAnim_SetAnimRate` updates both the visible and auxiliary skeleton rates and `frame_speed_mul`.
Its special `x2223_b0` path stores the requested rate in `x8A0_unk` instead. `F/ftanim.c:496-518`.

`lbanim.c` constructs AObjs from FigaTree tracks, sets data-provided flags, rewind frame 0, and the tree's end frame.
Its `frames` parameter here counts tracks to initialize; it is not the fighter's blend duration. `L/lbanim.c:9-25`; `L/lbanim.c:100-139`.

| Playback condition | Behavior | Evidence |
|---|---|---|
| Blend argument `-1` | Force zero blend frames. | `F/fighter.c:1278-1280` |
| Blend argument `0` | Use the animation-data blend byte at `fp->x28[anim_id][0]`. | `F/fighter.c:1254-1260`; `F/fighter.c:1298-1301` |
| Other blend argument | Use that many animation-frame units; seconds depend on playback rate. | `F/fighter.c:1298-1301`; `F/ftanim.c:345-356` |
| Zero blend | Load/evaluate the visible skeleton directly. | `F/ftanim.c:406-415` |
| Nonzero blend | Use the auxiliary animation skeleton and interpolate into the displayed skeleton. | `F/ftanim.c:417-433`; `F/ftanim.c:941-955` |
| Blend complete | Copy incoming transforms; some flagged parts copy directly even during blending. | `F/ftanim.c:348-372`; `F/ftanim.c:948-965` |
| Animation loop flag | `x594_b1_loop` sets `AOBJ_LOOP` on the relevant animation objects. | `F/ftanim.c:410-425` |
| Animation ended | `ftAnim_IsFramesRemaining` finds no eligible part with an active AObj; it is not merely a scalar frame comparison. | `F/ftanim.c:521-546`; `L/lb_00B0.c:28-36` |

TransN translation is sampled, scaled, differenced from the previous sample, then removed from the bone pose.
Movement helpers convert that delta into fighter movement; the mesh does not independently walk away from its fighter origin. `F/ftanim.c:174-194`; `F/ft_084E.c:80-89`; `F/ft_084E.c:121-136`.

During hitlag, `x2219_b5` prevents normal animation/script progression, state animation callbacks,
state input callbacks, and ordinary state physics. Map collision and collision-position processing have their own gates. `F/fighter.c:1675-1711`; `F/fighter.c:2151-2161`; `F/fighter.c:2182-2199`; `F/fighter.c:2500-2514`; `F/fighter.c:2576-2586`.

**Subaction interpreter: complete dispatch inventory**

Fighter subactions execute through `ftaction.c` plus generic commands in `lbcommand.c`.
`ftcmdscript.c` is a separate CPU controller-input interpreter, described afterward. `F/ftaction.c:1375-1380`; `L/lbcommand.c:94-100`; `F/ftcmdscript.c:128-174`.

The following IDs are decoded opcodes, not the packed command word.
IDs 10–58 map in order through `ftAction_803C06E8`. `F/ftaction.c:187-201`.

| ID | Operation and effect | Evidence |
|---|---|---|
| 0 | End/reset script: null the instruction pointer. | `L/lbcommand.c:13-17` |
| 1 | Synchronous timer: add a relative duration to the current timer. | `L/lbcommand.c:19-24` |
| 2 | Asynchronous timer: wait until an absolute script animation frame. | `L/lbcommand.c:26-31` |
| 3 | Begin counted loop: push return address and iteration count. | `L/lbcommand.c:33-40` |
| 4 | End loop: decrement count, repeat or pop the loop frame. | `L/lbcommand.c:42-57` |
| 5 | Call subroutine: save return address and jump to its data pointer. | `L/lbcommand.c:59-65` |
| 6 | Return from subroutine. | `L/lbcommand.c:67-71` |
| 7 | Unconditional goto. | `L/lbcommand.c:73-78` |
| 8 | Set animation-loop wait sentinel `F32_MAX`; resume near animation-frame reset. | `L/lbcommand.c:80-85`; `F/ftaction.c:1367-1371` |
| 9 | Background flash parameters. | `L/lbcommand.c:87-92` |
| 10 | Spawn GFX with bone and effect parameters. | `F/ftaction.c:225-292` |
| 11 | Create/update a hitbox: ID/group, bone, damage, radius, offsets, knockback, element, collision and sound flags. | `F/ftaction.c:300-378` |
| 12 | Change one hitbox's damage through the common damage setter. | `F/ftaction.c:396-402` |
| 13 | Change one hitbox's radius/scale. | `F/ftaction.c:413-419` |
| 14 | Set one hitbox's `x42_b5` or `x42_b7` flag; higher-level names remain unresolved. | `F/ftaction.c:427-440` |
| 15 | Remove one hitbox. | `F/ftaction.c:448-451`; `F/ftcoll.c:2584-2586` |
| 16 | Remove all ordinary hitboxes. | `F/ftaction.c:459-462`; `F/ftcoll.c:2589-2596` |
| 17 | Play/control action sound using sound behavior, ID, volume and panning. | `F/ftaction.c:592-687` |
| 18 | Play from the fighter's smash-sound table, if present. | `F/ftaction.c:695-705` |
| 19 | Assign `cmd_vars[0..3]`; move callbacks give these variables their meaning. | `F/ftaction.c:470-490` |
| 20 | Set throw/event flag b3 and record script timer, or set b4. | `F/ftaction.c:493-505` |
| 21 | Set throw/event flag b1. | `F/ftaction.c:508-512` |
| 22 | Set throw/event flag b2. | `F/ftaction.c:515-519` |
| 23 | Set `allow_interrupt = true`, the script IASA permission. | `F/ftaction.c:522-527` |
| 24 | Set throw/event flag b0. | `F/ftaction.c:530-534` |
| 25 | Select ground/air state-conversion helper using encoded state 0, 1, or 2. | `F/ftaction.c:537-551` |
| 26 | Set whole-body hit status `x1988` and its color-animation response. | `F/ftaction.c:554-557`; `F/ftcoll.c:2764-2777` |
| 27 | Set all hurt-capsule states. | `F/ftaction.c:560-563`; `F/ftcoll.c:2609-2620` |
| 28 | Set the hurt capsule matching a bone index. | `F/ftaction.c:566-571`; `F/ftcoll.c:2624-2643` |
| 29 | Enable jab linking when the encoded condition permits, or `x197C` is non-null. | `F/ftaction.c:574-582` |
| 30 | Set rapid-jab gate `x2218_b2`. | `F/ftaction.c:585-589` |
| 31 | Select a model-part display variant. | `F/ftaction.c:713-717`; `F/ftparts.c:595-602` |
| 32 | Restore previous/default model-part selections. | `F/ftaction.c:720-723`; `F/ftparts.c:573-581` |
| 33 | Set model-part selections to `-1`. | `F/ftaction.c:726-729`; `F/ftparts.c:584-592` |
| 34 | Define throw hitbox damage, angle, knockback, element and hit sound in `xDF4`. | `F/ftaction.c:732-748` |
| 35 | Set held-item visibility. | `F/ftaction.c:756-760`; `F/ftcommon.c:1410-1426` |
| 36 | Set model/article visibility-control field `x221E_b4`. | `F/ftaction.c:763-767` |
| 37 | Set fighter visibility-control field `x221E_b5`. | `F/ftaction.c:770-774` |
| 38 | Choose a pseudo-random sound and route it through the requested sound behavior. | `F/ftaction.c:777-867` |
| 39 | Play parameterized stage/positional sound. | `F/ftaction.c:875-999` |
| 40 | Set texture-animation frame for one or two indices. | `F/ftaction.c:1007-1015` |
| 41 | Apply a part animation with encoded parameters. | `F/ftaction.c:1018-1022` |
| 42 | Configure parasol state through `ftCommon_8007E83C`; not fighter playback speed. | `F/ftaction.c:1032-1035`; `F/ftcommon.c:1083` |
| 43 | Start rumble through global or fighter-specific routing. | `F/ftaction.c:1038-1047` |
| 44 | Stop the selected rumble. | `F/ftaction.c:1055-1059` |
| 45 | Control a held beam-sword item's effect; its parameter uses fixed-point scaling. | `F/ftaction.c:1067-1080`; `F/ftcommon.c:1233-1251` |
| 46 | Start color animation through `ftCo_800BFFD0`. | `F/ftaction.c:1088-1092` |
| 47 | Stop selected color animation through `ftCo_800C0200`. | `F/ftaction.c:1100-1103` |
| 48 | Set fighter field `x221E_b1`; semantic label UNCONFIRMED. | `F/ftaction.c:1111-1115` |
| 49 | Set sword-trail control fields `x2100` and `x2101_bits_8`. | `F/ftaction.c:1118-1123`; `F/forward.h:223` |
| 50 | Invoke dynamics operation `ftCo_8009E318` for a part at the current animation frame. | `F/ftaction.c:1131-1135`; `F/ftdynamics.c:499` |
| 51 | Apply encoded self-damage. | `F/ftaction.c:1143-1147` |
| 52 | Set `x221C_u16_y` flags; reset root X rotation when bit 2 is absent. | `F/ftaction.c:1155-1158`; `F/ft_0899.c:241-247` |
| 53 | Set model-control field `x2225_b2`; further semantics UNCONFIRMED. | `F/ftaction.c:1161-1165` |
| 54 | Spawn surface-dependent footstep sound/effect at the selected foot bone. | `F/ftaction.c:1168-1218` |
| 55 | Spawn surface-dependent effect/sound at TopN, with a fallback effect ID. | `F/ftaction.c:1226-1276` |
| 56 | Arm smash charging with charge duration, maximum damage multiplier, and color animation. | `F/ftaction.c:1284-1297` |
| 57 | Set `x2226_b5` and smash vibration-frame field. | `F/ftaction.c:1305-1309`; `F/ft_0C88.c:105-108` |
| 58 | Configure bone-related wind/dynamics effect parameters. | `F/ftaction.c:1317-1342`; `F/ftdynamics.c:602` |

**Requested script operations that need qualification**

Auto-cancel is not a separate opcode here: opcode 19 writes `cmd_vars[0]`;
landing checks that variable to choose normal landing or aerial-specific lag. `F/ftaction.c:472-490`; `C/ftCo_LandingAir.c:20-55`.

Throw definition and throw execution are separate:
opcode 34 defines throw attack data, while event flags communicate timed actions to move callbacks.
Do not treat every `throw_flags` use as a grab throw; rapid jab also consumes b3. `F/ftaction.c:493-534`; `F/ftaction.c:732-748`; `C/ftCo_Attack100.c:202-211`.

No dedicated “reset hit-once list” opcode is present in this dispatch.
Creating a disabled hitbox or changing its group invokes list initialization; another active hitbox in the same group supplies its existing lists. `F/ftaction.c:317-325`; `F/ftcoll.c:187-200`.

`ftColl_8007B064` explicitly re-enables one hitbox and clears its lists, but the subaction table does not point to it.
Deleting and recreating an isolated hitbox therefore differs from merely changing its damage. `F/ftcoll.c:2599-2606`; `F/ftaction.c:187-201`; `F/ftaction.c:397-402`.

No dedicated fighter playback-speed opcode was confirmed in IDs 0–58.
Confirmed speed controls are `ftAnim_SetAnimRate`, state-entry arguments, and state-specific code such as smash charging. `F/ftaction.c:187-201`; `F/ftanim.c:502-518`; `F/ft_0DF0.c:106-128`.

The script sets `frame_count = cur_anim_frame + x898_unk`, subtracts playback speed from its timer,
then executes consecutive due commands until a positive timer, sentinel, or end stops it. `F/ftaction.c:1353-1382`.

Thus several events can execute during one simulation tick after a large animation-frame advance.
The interpreter carries timer overshoot into relative waits instead of rounding every wait to a fresh tick. `F/ftaction.c:1360-1382`; `L/lbcommand.c:20-29`.

**`ftcmdscript.c`: separate CPU input bytecode**

Its wait counter decreases once per interpreter invocation, independently of the fighter subaction timer.
It synthesizes controller state, which subsequently goes through ordinary fighter input checks. `F/ftcmdscript.c:144-174`; `F/fighter.c:907-908`.

| CPU command family | Effect | Evidence |
|---|---|---|
| `Press/Release A, B, X, Y` | Set/clear each button bit. | `F/ftcmdscript.c:173-195` |
| `Press/Release Start` | Set/clear Start. | `F/ftcmdscript.c:197-201` |
| `Press/Release R` | Set/clear R and set its analog trigger to 255/0. | `F/ftcmdscript.c:203-209` |
| `Press/Release L, Z` | Set/clear the corresponding digital bits. | `F/ftcmdscript.c:211-221` |
| `Press/Release Up, Down, Right, Left` | Set/clear D-pad bits. | `F/ftcmdscript.c:223-245` |
| `Press/Release AFor, BFor, XFor, YFor` | Set/clear the named button, then wait the encoded duration n frames, n/60 s. | `F/ftcmdscript.c:247-277` |
| `SetLstickX/Y`, `SetCstickX/Y` | Set the named stick component. | `F/ftcmdscript.c:279-289` |
| `SetRtrigger`, `SetLtrigger` | Set analog trigger value. | `F/ftcmdscript.c:291-295` |
| `ReleaseAll` | Clear digital buttons; this command does not clear sticks/triggers. | `F/ftcmdscript.c:297-299` |
| `WaitFor` | Wait n invocations, nominally n frames = n/60 s. | `F/ftcmdscript.c:155-169`; `F/ftcmdscript.c:300-302` |
| `LstickTowardDestination` | Aim stick at stored destination with encoded magnitude. | `F/ftcmdscript.c:303-310` |
| `LstickXTowardDestination` | Set horizontal stick toward destination. | `F/ftcmdscript.c:311-318` |
| `LstickTowardFighter`, `LstickXTowardFighter` | Aim at stored target, if it exists. | `F/ftcmdscript.c:319-342` |
| `LstickXForward` | Set horizontal input relative to facing. | `F/ftcmdscript.c:344-351` |
| `WaitIfMotionId` | While the specified motion ID matches, wait one invocation: 1 frame, 0.0167 s. | `F/ftcmdscript.c:353-359` |
| `Unk0x93` | Write `cpu.x18`; “scenario ID” is only a tentative header annotation. | `F/ftcmdscript.c:361-363`; `F/ftcmdscript.h:65` |
| `LstickTowardDestinationClamped`, `LstickXTowardDestinationClamped`, `LstickForwardClamped` | Increment stick components toward encoded limits. | `F/ftcmdscript.c:364-429` |
| `Done` | Zero duration, null script pointer, return. | `F/ftcmdscript.c:431-434` |

**Bone-bound attack and hurt geometry**

A script may identify a common semantic bone or a character joint index.
`ftParts_GetBoneIndex` maps common parts through the character's `part_to_joint` table. `F/ftaction.c:327-334`; `F/ftparts.c:723-738`.

The script's labeled offsets map into internal coordinates as Z→`b_offset.x`, Y→`.y`, X→`.z`.
The literal decode multiplier is `0.003906f`; do not silently replace it with a different literal when reproducing this port. `F/ftaction.c:337-341`.

World placement uses the bone matrix through `lb_8000B1CC`.
New hitboxes initialize previous=current; subsequent updates move old current into previous before sampling the new pose. `F/ftcoll.c:2505-2531`; `L/lb_00B0.c:113-120`.

The fighter has four ordinary hitboxes and up to fifteen hurt capsules.
Hurt-capsule DATA specifies bone, two local endpoints, radius, height class, and grabbability. `F/types.h:1507-1514`; `F/ftcoll.c:2695-2710`.

Hurt endpoints are transformed lazily and cached for the collision pass.
The update process invalidates those caches; script commands can change whole-body or per-bone vulnerability. `L/lbcollision.c:1783-1791`; `F/fighter.c:2448`; `F/ftcoll.c:2564-2570`; `F/ftcoll.c:2609-2643`.

**Common attack families**

| State(s) | Entry and per-frame behavior | Exit / accepted input |
|---|---|---|
| `Attack11` 44 | A starts jab after item handling; clear IASA/link flags, start at frame 0/rate 1, load jab-2 timer. `C/ftCo_Attack1.c:41-75`; `C/ftCo_Attack1.c:113-127` | Animation end→neutral; A can latch during DATA window, then script combo gate→Attack12. `C/ftCo_Attack1.c:131-158`; `C/ftCo_Attack1.c:211-225` |
| `Attack12` 45 | Enter through link; clear gates, frame 0/rate 1, load jab-3 timer. `C/ftCo_Attack1.c:184-195` | End→neutral; remembered A plus script gate→Attack13, except character overrides. `C/ftCo_Attack1.c:228-255`; `C/ftCo_Attack1.c:258-289` |
| `Attack13` 46 | Generic third jab clears IASA/link flags and starts frame 0/rate 1. `C/ftCo_Attack1.c:265-270` | End→neutral; rapid-jab test runs first, then normal Wait input checks if IASA is set. `C/ftCo_Attack1.c:292-304` |
| Marth jab branch | `doAttack13` instead calls the jab-1 restart path. `C/ftCo_Attack1.c:258-264`; `C/ftCo_Attack1.c:171-180` | This is not a distinct Marth Attack13 animation chain. `C/ftCo_Attack1.c:258-264` |
| `Attack100Start` 47 | Enter when A press/release count reaches DATA `rapid_jab_window` and the script rapid-jab gate is enabled. `C/ftCo_Attack100.c:108-154` | Animation end→Loop; no input callback installed. `C/ftCo_Attack100.c:157-163`; `F/ftmotionstates.c:652-659` |
| `Attack100Loop` 48 | Mark cycle start near frame 0; A press or release sets the continuation latch. `C/ftCo_Attack100.c:196-213`; `C/ftCo_Attack100.c:225-232` | At script b3 boundary, cycle-start with no continuation→End; otherwise clear continuation for another test. `C/ftCo_Attack100.c:202-214` |
| `Attack100End` 49 | Play finishing animation with ordinary ground attack physics/collision. `C/ftCo_Attack100.c:218-262` | Animation end→neutral; no input callback installed. `C/ftCo_Attack100.c:218-222`; `F/ftmotionstates.c:674-681` |
| `AttackDash` 50 | A from dash/run, subject to earlier checks and item routing; clear IASA, frame 0/rate 1. `C/ftCo_AttackDash.c:26-67`; `C/ftCo_Run.c:105-113` | Dash-grab/item helper first, then Wait checks if IASA; end→neutral. `C/ftCo_AttackDash.c:71-101`; `C/ftCo_Catch.c:60-80` |

The jab input timer named `hitlag_mul` in this source is loaded from jab input-window attributes.
It is decremented by jab checks; it must not be interpreted as the actual hitlag freeze flag. `C/ftCo_Attack1.c:123`; `C/ftCo_Attack1.c:192`; `C/ftCo_Attack1.c:215-218`; `F/fighter.c:2772-2776`.

Attack11/12 priority is: with IASA, forward/up/down smash then forward/up/down tilt;
then rapid-jab entry, then the jab link; with IASA, jump, dash, crouch helper, turn, walk.
First successful check returns. `C/ftCo_Attack1.c:139-158`; `C/ftCo_Attack1.c:236-255`.

Normal Wait priority begins side special, up special, neutral special, down special, grab,
smashes, tilts, jab, then the remaining defensive/movement checks in source order. `C/ftCo_Wait.c:44-66`.
Despite its name, `ftCo_Attack100_CheckInput` dispatches **up special**, not rapid jab. `C/ftCo_Attack100.c:82-90`.

| Smash state(s) | Entry / activity | Exit / input |
|---|---|---|
| `AttackS4Hi`, `AttackS4HiS`, `AttackS4S`, `AttackS4LwS`, `AttackS4Lw`, IDs 58–62 | Select angle variant only when its animation exists; clear IASA and start frame 0/rate 1. `C/ftCo_AttackS4.c:170-197`; `F/ftmotionstates.c:773-817` | End→neutral. IASA checks ordered specials/grab, special combo helper, then attacks and movement. `C/ftCo_AttackS4.c:200-233` |
| `AttackHi4` 63 | Up-smash input, clear IASA, frame 0/rate 1; ground physics. `C/ftCo_AttackHi4.c:37-48`; `C/ftCo_AttackHi4.c:89-119`; `F/ftmotionstates.c:828` | End→neutral; IASA permits Wait checks. `C/ftCo_AttackHi4.c:98-108` |
| `AttackLw4` 64 | Down-smash input, clear IASA, frame 0/rate 1; ground physics. `C/ftCo_AttackLw4.c:33-60`; `C/ftCo_AttackLw4.c:76-84`; `F/ftmotionstates.c:839` | End→neutral; IASA permits Wait checks. `C/ftCo_AttackLw4.c:63-73` |
| Smash `PreCharge` | Script opcode 56 arms charge at its own DATA frame; stores maximum charge duration and multiplier. `F/ftaction.c:1284-1297`; `F/ft_0DF0.c:16-25` | Holding A→Charging; otherwise disable charge. `F/ft_0DF0.c:106-121` |
| Smash `Charging` | Save original speed; set playback rate 0; increment charge counter per unfrozen animation process. `F/ft_0DF0.c:60-68`; `F/ft_0DF0.c:108-118`; `F/fighter.c:1675-1706` | Release A or reach charge cap→Release; restore speed. `F/ft_0DF0.c:66-77`; `F/ft_0DF0.c:123-128` |
| Smash `Release` | Continue the same motion animation; damage setter uses charge interpolation. `F/ft_0DF0.c:33-41`; `F/ftcoll.c:2471-2474` | Ordinary state IASA/end rules still apply. `C/ftCo_AttackS4.c:200-233`; `C/ftCo_AttackHi4.c:98-108`; `C/ftCo_AttackLw4.c:63-73` |

The held pose begins where the script arms charging; its numeric animation frame is DATA.
The misleading field `x211C_holdFrame` stores the **maximum charge count**, not that pose's animation-frame index. `F/ftaction.c:1291-1297`; `F/ft_0DF0.c:21-24`; `F/ft_0DF0.c:66-68`.

| Aerial / landing state | Entry / activity | Exit / input |
|---|---|---|
| `AttackAirN/F/B/Hi/Lw`, IDs 65–69 | Select aerial, clear IASA and `cmd_vars[0]`, preserve fast fall; scripts create attacks and toggle landing-lag gate. `C/ftCo_AttackAir.c:125-132`; `F/ftmotionstates.c:850-894`; `F/ftaction.c:472-490` | End→Fall; environment collision→landing decision. IASA uses the ordered helper chain at lines 148–154. `C/ftCo_AttackAir.c:135-154`; `C/ftCo_AttackAir.c:189-191` |
| `LandingAirN` 70 | Neutral aerial with landing-lag gate set; use `landingairn_lag`. `C/ftCo_LandingAir.c:20-24`; `F/ftmotionstates.c:905` | No IASA; animation end→neutral. `C/ftCo_LandingAir.c:68-73`; `C/ftCo_Landing.c:115-119` |
| `LandingAirF` 71 | Forward aerial; use `landingairf_lag`. `C/ftCo_LandingAir.c:26-28`; `F/ftmotionstates.c:916` | Same landing callbacks/end rule. `C/ftCo_LandingAir.c:68-82` |
| `LandingAirB` 72 | Back aerial; use `landingairb_lag`. `C/ftCo_LandingAir.c:30-32`; `F/ftmotionstates.c:927` | Same landing callbacks/end rule. `C/ftCo_LandingAir.c:68-82` |
| `LandingAirHi` 73 | Up aerial; use `landingairhi_lag`. `C/ftCo_LandingAir.c:34-36`; `F/ftmotionstates.c:938` | Same landing callbacks/end rule. `C/ftCo_LandingAir.c:68-82` |
| `LandingAirLw` 74 | Down aerial; use `landingairlw_lag`. `C/ftCo_LandingAir.c:38-40`; `F/ftmotionstates.c:949` | Same landing callbacks/end rule. `C/ftCo_LandingAir.c:68-82` |
| Normal `Landing` destination | Chosen when aerial `cmd_vars[0]` is zero or no landing-air state was selected. `C/ftCo_LandingAir.c:20-55` | Uses the separate basic-landing path, rather than aerial move lag. `C/ftCo_LandingAir.c:54-55` |

L-cancel eligibility is `x67F < ftCommonData.xE4`; `x67F` tracks frames since an LR press.
Eligible landing lag is divided by DATA `xE8`, truncated to an integer, with a minimum of 1 frame = 0.0167 s. `F/fighter.c:2125-2128`; `C/ftCo_LandingAir.c:43-49`.

“Halved lag” requires `xE8 = 2`; that numeric DATA value is **UNCONFIRMED in these files**.
Neither a 7-frame window nor divisor 2 is hard-coded here. `F/types.h:217-218`; `C/ftCo_LandingAir.c:43-49`.

**Marth: Shield Breaker**

| State pair | Entry and per-frame action | Exit / accepted input |
|---|---|---|
| `SpecialNStart` 341 / `SpecialAirNStart` 345 | Neutral-special entry; reduce horizontal momentum by DATA friction divisor; air entry stops nonpositive vertical velocity. `M/ftmarsspecialn.c:30-54`; `M/ftmars.c:24-75` | Animation end→matching Loop; IASA empty. Ground/air changes preserve current frame through counterpart helpers. `M/ftmarsspecialn.c:57-84`; `M/ftmarsspecialn.c:104-135` |
| `SpecialNLoop` 342 / `SpecialAirNLoop` 346 | Increment charge counter; periodic effect every 30 frames = 0.5 s. `M/ftmarsspecialn.c:138-169`; `M/ftmars.c:35-86` | B release→End0; counter `> x0×30`→End1. Ground/air counterpart keeps charge state. `M/ftmarsspecialn.c:153-177`; `M/ftmarsspecialn.c:216-249` |
| `SpecialNEnd0` 343 / `SpecialAirNEnd0` 347 | Partial-charge release starts at animation frame 1 = 0.0167 s; newly enabled hitboxes receive stepped charge damage. `M/ftmarsspecialn.c:252-270`; `M/ftmarsspecialn.c:360-383`; `M/ftmars.c:46-97` | End→neutral on ground / Fall in air; no IASA. `M/ftmarsspecialn.c:277-294` |
| `SpecialNEnd1` 344 / `SpecialAirNEnd1` 348 | Full-charge branch uses its own animation/script and retains script-defined damage. `M/ftmarsspecialn.c:257-270`; `M/ftmarsspecialn.c:364-382`; `M/ftmars.c:57-108` | Same end and empty-IASA rules; ground/air conversion preserves End0/End1 selection and hitboxes. `M/ftmarsspecialn.c:282-294`; `M/ftmarsspecialn.c:320-354` |

Charge initialization is an entry-transition callback that zeros `cmd_vars[0]` and the charge counter.
Release has a hard-coded effect at animation frame 9 = 0.15 s; this is **not proof of hitbox startup**. `M/ftmarsspecialn.c:35`; `M/ftmars.c:528-532`; `M/ftmarsspecialn.c:271-275`.

Start has DATA friction; Loop and End use common ground/air physics helpers.
End's hitbox on/off frames, bone choices, and full-charge damage remain move-script DATA. `M/ftmarsspecialn.c:86-101`; `M/ftmarsspecialn.c:192-199`; `M/ftmarsspecialn.c:296-303`; `F/fighter.c:1271`.

**Marth: Dancing Blade**

All listed ground states have matching air states.
Shared callbacks inspect `ground_or_air`, while the table selects the correct animation/script. `M/ftmars.c:112-306`; `M/ftmarsspecials.c:84-110`.

| Ground / air state | Link behavior and destination | Evidence |
|---|---|---|
| `SpecialS1` 349 / `SpecialAirS1` 358 | Side-special entry clears both input gates; valid next press→S2Hi or S2Lw. | `M/ftmarsspecials.c:20-81`; `M/ftmarsspecials.c:97-110`; `M/ftmarsspecials.c:285-307` |
| `SpecialS2Hi` 350 / `SpecialAirS2Hi` 359 | Chosen if stick Y `> x21C`; valid next press→one of three S3 branches. | `M/ftmarsspecials.c:187-200`; `M/ftmarsspecials.c:294-298`; `M/ftmarsspecials.c:425-456` |
| `SpecialS2Lw` 351 / `SpecialAirS2Lw` 360 | Chosen for all other second-hit directions; same third-hit gate. | `M/ftmarsspecials.c:187-200`; `M/ftmarsspecials.c:300-307` |
| `SpecialS3Hi` 352 / `SpecialAirS3Hi` 361 | Third-hit choice when Y `> x21C`; valid next press→S4 branch. | `M/ftmarsspecials.c:326-339`; `M/ftmarsspecials.c:434-438` |
| `SpecialS3S` 353 / `SpecialAirS3S` 362 | Third-hit choice between the two strict vertical thresholds. | `M/ftmarsspecials.c:434-452` |
| `SpecialS3Lw` 354 / `SpecialAirS3Lw` 363 | Third-hit choice when Y `< -x21C`. | `M/ftmarsspecials.c:441-445` |
| `SpecialS4Hi` 355 / `SpecialAirS4Hi` 364 | Final choice when Y `> x21C`; no further link callback. | `M/ftmarsspecials.c:569-573`; `M/ftmarsspecials.c:474` |
| `SpecialS4S` 356 / `SpecialAirS4S` 365 | Final middle-direction choice. | `M/ftmarsspecials.c:582-586` |
| `SpecialS4Lw` 357 / `SpecialAirS4Lw` 366 | Final choice when Y `< -x21C`. | `M/ftmarsspecials.c:576-580` |

For hits 1–3, acceptance requires `cmd_vars[0] != 0`, `cmd_vars[1] == 0`, and a new A **or** B press.
When the gate is closed, an A/B press sets `cmd_vars[1] = 1`; it is a rejection latch, not a future-link buffer. `M/ftmarsspecials.c:97-110`; `M/ftmarsspecials.c:187-200`; `M/ftmarsspecials.c:326-339`.

Each successful link resets both variables, starts the selected state at frame 0/rate 1,
and uses `Ft_MF_SkipAttackCount`. Numeric open/close frames are the corresponding script's opcode-19 DATA. `M/ftmarsspecials.c:290-307`; `M/ftmarsspecials.c:430-456`; `M/ftmarsspecials.c:565-590`; `F/ftaction.c:472-490`.

Without another accepted link, each stage ends at animation completion→neutral or Fall.
Stage 4's IASA is empty. `M/ftmarsspecials.c:84-94`; `M/ftmarsspecials.c:172-183`; `M/ftmarsspecials.c:310-321`; `M/ftmarsspecials.c:459-474`.

Ground/air transitions preserve branch, current animation frame, hitboxes, hit status, and sword trail through their masks.
These transitions force rate 1 and advance past earlier script commands. `M/ftmarsspecials.c:149-169`; `M/ftmarsspecials.c:238-276`; `M/ftmarsspecials.c:377-422`; `M/ftmarsspecials.c:510-557`.

Air entry divides horizontal velocity by DATA `x14`; only its first eligible use supplies DATA upward velocity `x1C`.
Hits 1–2 use DATA air fall/friction; later hits use their common movement helpers. `M/ftmarsspecials.c:50-60`; `M/ftmarsspecials.c:114-127`; `M/ftmarsspecials.c:204-217`; `M/ftmarsspecials.c:343-356`.

**Marth: Dolphin Slash**

| State | Entry and per-frame action | Exit / input |
|---|---|---|
| `SpecialHi` 367 | Clear command variables 0–2 and event flags; start frame 0/rate 1. Script controls airborne/movement phases. `M/ftmarsspecialhi.c:20-31`; `M/ftmars.c:310-317` | Completion→FallSpecial with DATA drift/landing parameters; IASA steers launch angle and a script event permits facing adjustment. `M/ftmarsspecialhi.c:55-105` |
| `SpecialAirHi` 368 | Same flag initialization; zero vertical speed and scale horizontal speed by DATA `x3C`. `M/ftmarsspecialhi.c:35-51`; `M/ftmars.c:321-328` | Same FallSpecial completion; airborne root-motion phase is scaled by DATA `x40`. `M/ftmarsspecialhi.c:68-78`; `M/ftmarsspecialhi.c:185-210` |

Before `cmd_vars[0]` closes angle selection, stick magnitude beyond DATA `x34` can increase the stored launch tilt.
The code retains the greatest absolute tilt seen; it does not continually reduce tilt when the stick returns inward. `M/ftmarsspecialhi.c:90-99`; `M/ftmarsspecialhi.c:114-124`.

During ascent, animation-derived TransN movement drives velocity.
When the TransN vertical delta becomes negative, `cmd_vars[2]` switches to DATA gravity/terminal velocity and drift. `M/ftmarsspecialhi.c:148-168`; `M/ftmarsspecialhi.c:185-206`.

Descending collision handling has a one-pass latch before using landing/ledge callbacks.
LandingFallSpecial receives DATA `x2C`; launch, hitbox, and vulnerability frame endpoints remain script DATA. `M/ftmarsspecialhi.c:215-233`; `M/ftmarsspecialhi.c:241-251`; `F/fighter.c:1271`.

**Marth: Counter state machine only**

| State | Entry and per-frame action | Exit / input |
|---|---|---|
| `SpecialLw` 369 | Zero vertical speed; initialize parry variable and stored counter damage; ground friction. `M/ftmarsspeciallw.c:31-42`; `M/ftmarsspeciallw.c:118-121` | Script value 1 arms detection; value 0 disables it; completion→neutral. IASA empty. `M/ftmarsspeciallw.c:68-87`; `M/ftmarsspeciallw.c:114` |
| `SpecialAirLw` 371 | Divide horizontal speed by DATA `x4C`, zero vertical speed; DATA air fall/friction. `M/ftmarsspeciallw.c:46-64`; `M/ftmarsspeciallw.c:124-132` | Same script-controlled parry; completion→Fall. IASA empty. `M/ftmarsspeciallw.c:91-116` |
| `SpecialLwHit` 370 | Detection callback selects grounded counterattack, frame 0/rate 1. `M/ftmarsspeciallw.c:306-339` | End→neutral; IASA empty. `M/ftmarsspeciallw.c:208-215`; `M/ftmarsspeciallw.c:231` |
| `SpecialAirLwHit` 372 | Detection callback selects airborne counterattack. `M/ftmarsspeciallw.c:333-339` | End→Fall; IASA empty. `M/ftmarsspeciallw.c:219-234` |

At script value 1, the animation callback changes it to 2, installs detection geometry from `MarsAttributes.x64`,
and registers `ftMs_SpecialLw_80139140`; value 0 clears detection enablement. `M/ftmarsspeciallw.c:75-83`; `F/ftcoll.c:2647-2658`.

The collision resolver invokes that registered callback when the corresponding hit event is present.
It faces the incoming direction and enters Hit state; ground/air changes re-register detection if variable 1 remains 2. `F/fighter.c:2930-2936`; `M/ftmarsspeciallw.c:151-189`; `M/ftmarsspeciallw.c:319-339`.

Parry start/end and counterattack hitbox frames are DATA in the move scripts.
The shared code's damage-scaled hitbox replacement explicitly requires Roy/`Ft_Kind_Emblem`; do not assign that replacement to Marth. `F/ftaction.c:472-490`; `M/ftmarsspeciallw.c:194-204`.

**Ground movement: short reference table**

| State | Frames / activity | Interrupts and exit |
|---|---|---|
| Initial `Dash` 20 | Frame 0/rate 1; DATA initial velocity. Phases compare frame to common `x44`, `x48`, `x4C`; each DATA duration is n/60 s. `C/ftCo_Dash.c:48-85`; `F/ftmotionstates.c:355` | Early phase allows specific specials/grab/smash checks; later phase permits dash attack and reverse dash; script `cmd_vars[0]` permits Run. End→neutral. `C/ftCo_Dash.c:73-130` |
| Dash-dance `Turn` 18, smash-turn entry | Turn countdown 0 frames = 0 s; reverse-facing target; immediate animation update. `C/ftCo_Turn.c:214-229`; `F/ftmotionstates.c:333` | Opposite dash flick enters this path; after turning, sufficient stick→Dash. Attack/special checks precede movement checks. `C/ftCo_Dash.c:35-41`; `C/ftCo_Turn.c:149-174` |
| `Run` 21 | Ongoing while input sustains it; rate follows speed. Optional brake/turn lockout DATA `x430` frames = DATA/60 s. `C/ftCo_Run.c:35-42`; `C/ftCo_Run.c:76-98`; `F/ftmotionstates.c:366` | Specials, grab, dash attack, defensive helpers and jump precede turn/brake; release stick→RunBrake after lockout. `C/ftCo_Run.c:101-127` |
| `RunBrake` 23 | DATA `max_run_brake_frames` frames = DATA/60 s; friction; script can pause animation until speed falls below DATA threshold. `C/ftCo_RunBrake.c:33-75`; `F/ftmotionstates.c:388` | Jump, script-enabled TurnRun, crouch helper; end→neutral when animation ends **or** countdown reaches zero. `C/ftCo_RunBrake.c:75-95` |
| Standing `Turn` 18 | DATA `standing_turn_frames` countdown = DATA/60 s; flip facing on the callback after countdown ceases being positive. `C/ftCo_Turn.c:93-113` | Ordered specials/attacks, defensive helpers, jump and dashback; end→neutral. A/B may be remembered for the turn frame. `C/ftCo_Turn.c:117-187` |
| `TurnRun` 19 | DATA script phase; may freeze playback while reversing velocity, then resume rate 1 and flip facing. `C/ftCo_TurnRun.c:44-75`; `F/ftmotionstates.c:344` | Jump is its explicit IASA check; completion→Run if input qualifies, otherwise neutral. `C/ftCo_TurnRun.c:74-81` |
| `KneeBend` 24 | DATA `jump_startup_time` animation frames = DATA/60 s, or animation end if earlier. `C/ftCo_KneeBend.c:19-39`; `F/ftmotionstates.c:399` | Up special, grab, up smash, then short-hop release test; completion→Jump or screw-item jump. `C/ftCo_KneeBend.c:33-65` |

## 3. Constants

Offsets are relative to the named on-disc struct, not the runtime Fighter.
For DATA frame counts, seconds remain DATA/60; no community defaults are inferred.

| Name | Value / units | Source | Meaning |
|---|---|---|---|
| Ordinary hitbox slots | 4 | `F/types.h:1507` | Simultaneously stored fighter attack hitboxes. |
| Hurt-capsule capacity | 15 | `F/types.h:1514`; `F/ftcoll.c:2695` | Maximum body capsules. |
| Hitbox parameter decode scale | `0.003906f` | `F/ftaction.c:337-341` | Radius and local-offset conversion. |
| Hitbox victim lists | Two lists of 12 entries | `L/types.h:82-83` | Remembered collision victims. |
| Default attack entry speed | 1 animation frame/tick | `C/ftCo_Attack1.c:120-121`; `C/ftCo_AttackDash.c:65-66` | Nominal frame timing. |
| Default blend duration | DATA animation frames; DATA/60 s at rate 1 | `F/fighter.c:1298-1301`, `fp->x28[anim_id][0]` | Per-animation transition smoothing. |
| Move-script pointer | DATA `Fighter_WaitAnimData +0x0C`, `xC` | `F/types.h:1044-1049`; `F/fighter.c:1271` | Script containing move-event timings. |
| Animation flags | DATA `Fighter_WaitAnimData +0x10`, `x10_animCurrFlags` | `F/types.h:1049`; `F/fighter.c:1262` | Includes loop/root-motion configuration. |
| Jab-2 input window | DATA frames; DATA/60 s | `ftCo_DatAttrs +0x07C`, `jab_2_input_window`; `F/types.h:854` | A-press latch window after jab 1 entry. |
| Jab-3 input window | DATA frames; DATA/60 s | `ftCo_DatAttrs +0x080`, `jab_3_input_window`; `F/types.h:855` | A-press latch window after jab 2 entry. |
| Rapid-jab threshold | DATA **input-edge count** | `ftCo_DatAttrs +0x098`, `rapid_jab_window`; `F/types.h:861`; `C/ftCo_Attack100.c:113-118` | Name says “window,” but this comparison counts press/release events. |
| Smash hold pose | DATA animation frame; DATA/60 s at rate 1 | Move-script time of opcode 56; `F/ftaction.c:1284-1297` | Point where holding A can freeze playback. |
| Smash maximum charge | DATA frames; DATA/60 s | Opcode-56 `charge_frames`→`x211C_holdFrame`; `F/ftaction.c:1291-1297`; `F/ft_0DF0.c:23` | Maximum counted hold duration. |
| Smash maximum multiplier | DATA dimensionless | Opcode-56 `charge_rate × 0.003906f`; `F/ftaction.c:1291-1297` | Damage multiplier at full charge. |
| Charge sound threshold | DATA frames; DATA/60 s | `ftCommonData +0x7C8`, `x7C8`; `F/types.h:645`; `F/ft_0DF0.c:80-83` | Delayed charge sound. |
| L-cancel eligibility window | DATA frames; DATA/60 s | `ftCommonData +0x0E4`, `xE4`; `F/types.h:217`; `C/ftCo_LandingAir.c:43` | Strict upper bound on LR-input age. |
| L-cancel lag divisor | DATA dimensionless | `ftCommonData +0x0E8`, `xE8`; `F/types.h:218` | Divides aerial landing lag; 2 would halve it. |
| Minimum reduced landing lag | 1 frame = 0.0167 s | `C/ftCo_LandingAir.c:44-49` | Prevents zero-length reduced lag. |
| Landing animation bias | 0.1 animation frame = 0.00167 animation seconds | `C/ftCo_LandingAir.c:65` | Numerator bias when fitting clip to lag. |
| Aerial N/F/B/Hi/Lw landing lag | DATA frames; DATA/60 s | `ftCo_DatAttrs +0x0E8/+0x0EC/+0x0F0/+0x0F4/+0x0F8`; `F/types.h:886-890` | Per-character landing recovery. |
| Shield Breaker charge unit | 30 frames = 0.5 s | `M/ftmarsspecialn.c:147-154`; `M/ftmarsspecialn.c:264-265` | Effect cadence, charge cap scale, partial-damage step. |
| Shield Breaker cap factor | DATA | `MarsAttributes +0x00`, `x0`; `M/types.h:34-37` | Auto-release when counter exceeds `30×x0`. |
| Shield Breaker damage parameters | DATA damage units | `MarsAttributes +0x04/+0x08`, `x4/x8`; `M/types.h:36-37` | Base partial damage and damage per charge unit. |
| Shield Breaker entry friction divisor | DATA | `MarsAttributes +0x0C`, `specialn_friction`; `M/types.h:38`; `M/ftmarsspecialn.c:36-48` | Horizontal entry slowdown. |
| Shield Breaker startup friction | DATA | `MarsAttributes +0x10`, `specialn_start_friction`; `M/types.h:39`; `M/ftmarsspecialn.c:91-101` | Startup movement deceleration. |
| Shield Breaker release start / effect | 1 frame = 0.0167 s / frame 9 = 0.15 s | `M/ftmarsspecialn.c:369-382`; `M/ftmarsspecialn.c:271-275` | Start offset / cosmetic trigger. |
| Dancing Blade vertical branch threshold | DATA stick units | `ftCommonData +0x21C`, `x21C`; `F/types.h:296`; `M/ftmarsspecials.c:294` | Up/down branch selection. |
| Dancing Blade air entry divisor / boost | DATA | `MarsAttributes +0x14/+0x1C`, `x14/x1C`; `M/types.h:40-42`; `M/ftmarsspecials.c:55-60` | Air momentum adjustment. |
| Dancing Blade air friction / gravity / terminal | DATA | `MarsAttributes +0x18/+0x20/+0x24`; `M/types.h:41-44`; `M/ftmarsspecials.c:126-127` | Air movement during early stages. |
| Dolphin drift factor / landing lag | DATA / DATA frames, DATA/60 s | `MarsAttributes +0x28/+0x2C`; `M/types.h:45-46`; `M/ftmarsspecialhi.c:63`; `M/ftmarsspecialhi.c:219` | Recovery movement and landing. |
| Dolphin facing / tilt threshold / tilt limit | DATA stick, stick, degrees | `MarsAttributes +0x30/+0x34/+0x38`; `M/types.h:47-49`; `M/ftmarsspecialhi.c:90-104` | Launch steering. |
| Dolphin horizontal retention / air root scale | DATA | `MarsAttributes +0x3C/+0x40`; `M/types.h:50-51`; `M/ftmarsspecialhi.c:47`; `M/ftmarsspecialhi.c:188-190` | Air entry/ascent scaling. |
| Dolphin post-ascent gravity / terminal | DATA | `MarsAttributes +0x44/+0x48`; `M/types.h:52-53`; `M/ftmarsspecialhi.c:165` | Descent movement. |
| Counter air divisor / friction / gravity / terminal | DATA | `MarsAttributes +0x4C/+0x50/+0x54/+0x58`; `M/types.h:54-57`; `M/ftmarsspeciallw.c:53`; `M/ftmarsspeciallw.c:130-131` | Air Counter movement. |
| Counter detection descriptor | DATA bone/position/radius | `MarsAttributes +0x64`, `x64`; `M/types.h:60`; `M/ftmarsspeciallw.c:77-78` | Parry detection geometry. |
| Dash/smash stick threshold | DATA; source comment states 0.8 | `ftCommonData +0x3C`; `F/types.h:139`; `C/ftCo_Turn.c:35-39` | Fast horizontal input qualification. |
| Dash/smash input age | DATA frames; comment states 2 frames = 0.0333 s | `ftCommonData +0x40`; `F/types.h:145`; `C/ftCo_Turn.c:39` | Strict input-age comparison. |
| Dash phase thresholds | DATA frames; DATA/60 s | `ftCommonData +0x44/+0x48/+0x4C`; `F/types.h:147-149` | Initial-dash interrupt phases. |
| Dash-attack friction multiplier | DATA | `ftCommonData +0x50`, `x50`; `F/types.h:150`; `C/ftCo_AttackDash.c:95` | Ground-friction scaling. |
| Dash-attack grab conversion timer | DATA frames; DATA/60 s | `ftCommonData +0x68`, `x68`; `F/types.h:164`; `C/ftCo_AttackDash.c:81` | Dash-grab conversion opportunity. |
| Initial dash speed / run clip scale | DATA | `ftCo_DatAttrs +0x01C/+0x02C`; `F/types.h:830-834` | Locomotion and playback scaling. |
| Brake / standing turn / jump squat | DATA frames; DATA/60 s | `ftCo_DatAttrs +0x030/+0x084/+0x038`; `F/types.h:835-837`; `F/types.h:856` | Character movement timings. |

## 4. Formulas

All equations below describe the traced branch; DATA parameters remain symbolic.

| Formula | Exact rule in plain math / own-words pseudocode | Evidence |
|---|---|---|
| Initial animation-frame bookkeeping | `cur_anim_frame = anim_start − anim_speed`. | `F/fighter.c:1228-1233` |
| Playback frame source | After joint evaluation, assign `cur_anim_frame = ftAnim_8006F3DC(gobj)`; read eligible AObj current frame or auxiliary skeleton current frame. | `F/ftanim.c:382`; `F/ftanim.c:561-582` |
| Nominal frame advance | `next frame ≈ frame + rate` is the intended playback abstraction; exact HSD endpoint/wrap arithmetic is UNCONFIRMED because its implementation is absent here. | Rate assignment: `F/ftanim.c:496-508`; evaluation/readback: `F/ftanim.c:173-179`; `F/ftanim.c:382` |
| Script clock | `scriptFrame = cur_anim_frame + x898_unk`; finite `timer = timer − frame_speed_mul`. | `F/ftaction.c:1358-1362` |
| Relative wait | `timer = timer + encodedDuration`. | `L/lbcommand.c:20-23` |
| Absolute wait | `timer = encodedTargetFrame − scriptFrame`. | `L/lbcommand.c:27-30` |
| Script wait readiness | Execute while timer≤0; `F32_MAX` resumes only when `scriptFrame < frame_speed_mul`, then timer becomes `−scriptFrame`. | `F/ftaction.c:1363-1382` |
| Loop-aware frame accumulator | If flag b2 is set and newly read frame<old `cur_anim_frame`, add `oldFrame + frame_speed_mul` to `x898_unk`. | `F/ftanim.c:376-382` |
| Blend progress | `elapsed += auxiliaryRate`; clamp elapsed to B. Before completion, `t = rate / (rate + B − elapsed)` and `oldWeight = 1−t`; at completion `t=1`. | `F/ftanim.c:345-356` |
| Blend application | Interpolate incoming skeleton against displayed transforms with those weights; flagged parts copy incoming transforms directly. | `F/ftanim.c:941-955` |
| Root-motion sample | `scaledTransN = sampledTranslation × modelScale`; `delta = scaledTransN − previousScaledTransN`; zero the bone translation afterward. | `F/ftanim.c:174-194` |
| Ground root-motion acceleration | With root-motion flag b0: `groundAccel1 = delta.z × facing − groundVelocity`; otherwise apply friction. | `F/ft_084E.c:80-89` |
| Tilted air root motion | Let `h=delta.z×facing`, `v=delta.y`, `θ=lstick_angle`; `velocity.x=h cosθ−v sinθ`, `velocity.y=h sinθ+v cosθ`. | `F/ft_084E.c:128-136` |
| Hitbox location | `worldPoint = boneWorldMatrix × localOffset`; if ignore-scale flag is set, first divide the offset by fighter Y scale. | `F/ftcoll.c:2505-2531`; `L/lb_00B0.c:113-120` |
| Hurt-capsule endpoints | Transform each local endpoint through the capsule's bone; cache both results for the pass. | `L/lbcollision.c:1783-1791` |
| Smash charge count | During Charging: increment by 1; clamp to maximum H; at `count≥H`, release and restore saved playback speed. | `F/ft_0DF0.c:60-77` |
| Smash damage | During Release only: `damageOut = damageIn × [1 + (maxMultiplier−1)×chargeCount/H]`; otherwise unchanged. | `F/ft_0DF0.c:33-41` |
| L-cancel lag | If LR age<E4: `lag = max(1, trunc(originalLag/E8))`; otherwise use original lag. For positive lag and E8=2, this is floor-half with minimum 1. | `C/ftCo_LandingAir.c:43-49` |
| Landing playback rate | `rate = (landingClipEndFrame + 0.1) / selectedLag`. | `C/ftCo_LandingAir.c:59-65`; `F/ftanim.c:585-592` |
| Shield Breaker auto-release | Increment integer charge counter q; full release when `q > 30×MarsAttributes.x0`, not `≥`. | `M/ftmarsspecialn.c:153-156` |
| Shield Breaker partial damage | For newly Enabled hitboxes while partial branch: `damage = x4 + trunc(q/30)×x8`; q/30 is integer division. | `M/types.h:35-37`; `M/types.h:70-72`; `M/ftmarsspecialn.c:257-266` |
| Dolphin launch tilt | For `abs(stickX)>x34`: magnitude in degrees=`x38×(abs(stickX)−x34)/(1−x34)`; sign opposes stick X, convert to radians; retain only larger absolute tilt. | `M/ftmarsspecialhi.c:90-99` |
| Run animation rate | If selected velocity points backward/zero relative to facing: 0; else `abs(velocity)/run_animation_scaling`. | `C/ftCo_Run.c:83-95` |

For a constant positive playback rate r, B animation frames represent nominally `B/(60r)` seconds.
This is a timing conversion from the ticket's 60 Hz basis; pauses and rate changes require integrating progress over ticks.
The blend itself accumulates animation rate, rather than an independent wall-clock timer. `F/ftanim.c:345-356`.

## 5. Interactions and edge cases

- **IASA and animation end differ:** a script grants permission; the state chooses which checks use it. Animation-end callbacks can change state earlier in the tick than input processing. `F/ftaction.c:523-527`; `F/fighter.c:905-909`; `C/ftCo_Attack1.c:131-158`.
- **Priority is state-specific:** jab links can be tested without general IASA, while ordinary movement remains gated. Replacing this with one universal cancel list changes the mechanics. `C/ftCo_Attack1.c:139-158`.
- **Input storage is selective:** jab remembers an A press, Turn remembers A/B, and Dancing Blade remembers disqualifying early presses. No universal future-action queue was confirmed in these paths. `C/ftCo_Attack1.c:215-223`; `C/ftCo_Turn.c:130-131`; `C/ftCo_Turn.c:178-183`; `M/ftmarsspecials.c:101-109`.
- **Hitlag input differs:** press/release edges are OR-accumulated while frozen; ordinary input processing replaces them with the current sample's edges. This is evidence of hitlag accumulation, not proof of an arbitrary post-hitlag buffer duration. `F/fighter.c:1777-1787`.
- **Hitlag freezes script windows too:** normal animation/scripts and state input callbacks skip, so their animation-time windows do not elapse like wall-clock deadlines. Charge counters in the skipped animation process also stop. `F/fighter.c:1675-1711`; `F/fighter.c:2151-2161`; `F/ft_0DF0.c:60-61`.
- **Frozen fighters still have other processing:** map collision callbacks and hitbox-position updates are not under the same normal-animation gate; the code must not be reduced to “skip the entire fighter.” `F/fighter.c:2500-2514`; `F/fighter.c:2576-2586`.
- **Being hit bypasses player-cancel permission:** collision resolution calculates knockback and selects damage handling independently of the attack's `allow_interrupt`. `F/fighter.c:2872-2908`.
- **State changes clean attack state:** ordinary transitions clear hitboxes unless `SkipHit` is specified, reset smash charging, and replace callbacks. Active sword geometry must not accidentally survive damage/neutral entry. `F/fighter.c:961-968`; `F/fighter.c:1090-1093`; `F/fighter.c:1385-1403`.
- **Move initialization is explicit:** many attack entries clear IASA themselves. A port should reproduce each entry contract rather than assuming `ChangeMotionState` resets every move-local variable. `C/ftCo_Attack1.c:118-126`; `C/ftCo_AttackAir.c:128-131`; `M/ftmarsspecials.c:31-33`.
- **One swing can have several hitboxes sharing victims:** same-group creation can copy existing victim lists. A sword tip and blade segment need not independently damage the same opponent. `F/ftcoll.c:187-200`; `L/lbcollision.c:1817-1829`.
- **Changing damage does not inherently rehit:** the damage-adjustment opcode does not clear remembered victims. Reset/recreate semantics must be deliberate. `F/ftaction.c:397-402`; `L/lbcollision.c:1804-1814`.
- **High playback rates can cross several script events in one tick:** processing only the event nearest the rendered pose loses commands. `F/ftaction.c:1360-1382`.
- **Ground/air changes need script reconciliation:** the helpers preserve current animation frame; `UpdateCmd` skips past earlier commands rather than replaying every effect/hitbox creation. `C/inlines.h:82-99`; `F/fighter.c:1356-1362`; `F/ftaction.c:1426-1456`.
- **Smash charging uses two clocks:** animation and script wait at rate 0, but the unfrozen charge counter continues. The cap releases automatically. `F/ft_0DF0.c:60-77`; `F/ft_0DF0.c:108-126`; `F/ftaction.c:1360-1362`.
- **L-cancel boundaries are strict:** LR age equal to E4 fails eligibility; positive reduced lag is truncated before the minimum clamp. Auto-cancel avoids this move-lag branch entirely. `C/ftCo_LandingAir.c:20-55`.
- **Dancing Blade is timing-sensitive rather than hold-to-chain:** links require fresh A/B edges, and early edges can poison the stage's next link. `M/ftmarsspecials.c:97-110`; `M/ftmarsspecials.c:187-200`.
- **Counter is not damage scaling copied blindly from Roy:** Marth shares the implementation, but its hitbox replacement branch is explicitly character-gated to Emblem. `M/ftmarsspeciallw.c:198-202`.
- **Port-specific dashback exists:** optional UCF permits a tilt-turn cancellation at animation frame 2 = 0.0333 s, subject to stick-history conditions. It is guarded by `pc_is_ucf_enabled`, so it must be labeled separately from retail mechanics. `C/ftCo_Turn.c:34-54`; `C/ftCo_Turn.c:133-145`.

## 6. Port notes for Marea Negra

These are implementation implications and options, not selected design decisions.
Melee provides local tick/state behavior; the latency and interpolation values below come from the ticket.

| Responsibility | Server-authoritative simulation | three.js/glTF client |
|---|---|---|
| State | Own state ID, entry tick, branch, transition eligibility, and interruption priority. Basis: `F/fighter.c:1185-1189`; `F/fighter.c:1385-1389`. | Select the corresponding glTF clip from the authoritative state. |
| Frame | Own authoritative move frame, rate, freeze time, loop count and script progress. Basis: `F/ftaction.c:1358-1382`; `F/ftanim.c:376-382`. | Sample an `AnimationMixer` presentation at the appropriate local/presentation timeline. |
| Hitbox windows | Own create/remove events, bone/offset definitions, vulnerability windows and victim lists. Basis: `F/ftaction.c:301-378`; `F/ftcoll.c:187-200`. | Render matching sword trails, effects, and debugging geometry. |
| Pose geometry | Own a reproducible collision pose or baked bone trajectories at the authoritative frame. Basis: `F/ftcoll.c:2500-2531`. | May blend visual poses, provided those cosmetic blends do not determine hit results. |
| Root movement | Own movement resulting from animation translation and collision. Basis: `F/ftanim.c:174-194`; `F/ft_084E.c:80-89`. | Remove/compensate clip root translation so it does not add movement a second time. |
| Input windows | Own timestamped input acceptance, jab latches, early-input rejection and charge release. Basis: `C/ftCo_Attack1.c:211-225`; `M/ftmarsspecials.c:97-110`. | May predict the local player's accepted branch and reconcile to server results. |
| Cosmetic blending | Preserve gameplay frame/state even if presentation smoothing differs. Basis: separate frame/script and blend state in `F/types.h:1499-1505`. | May own blend duration, cosmetic poses, camera response, trails and sound presentation. |

An `AnimationMixer` completion event cannot be the authoritative attack-end signal:
the source's end test and script processing belong to fighter simulation.
A server move descriptor can carry duration and event data while the client plays an independently authored glTF clip. `F/ftanim.c:521-546`; `F/ftaction.c:1353-1382`.

Matching collision geometry requires more than matching clip names.
An option is exporting per-frame sword/body transforms for the server; another is evaluating a shared simplified skeleton.
Either must preserve the bone-offset and previous/current sampling contract being copied. `F/ftaction.c:327-341`; `F/ftcoll.c:2505-2531`.

The supplied 50 ms snapshot interval equals 3 frames; the 100 ms remote interpolation delay equals 6 frames.
RTT 100–250 ms equals 6–15 frames; a symmetric one-way estimate would be 3–7.5 frames, but symmetry is not guaranteed.
These conversions describe the proposed network setting, not constants found in Melee.

The comment-documented dash/smash age of 2 frames = 33.3 ms is shorter than those snapshot and latency spans.
Whether jab links, Counter, L-cancel, and Dancing Blade windows are shorter cannot be established until their DATA values are filled. `C/ftCo_Turn.c:39`; `F/types.h:217-218`; `F/types.h:854-855`; `M/ftmarsspecials.c:101-109`.

Judging a short window solely at packet-arrival time would change its meaning.
Possible approaches include judging a timestamped input against the relevant historical state, predicting local actions,
or delaying final acceptance while retaining immediate cosmetic feedback; the choice remains open.
The copied basis is frame-relative input gating, not network-arrival gating. `C/ftCo_Attack1.c:215-223`; `C/ftCo_LandingAir.c:43-49`.

For the supplied attacker-view hit rewind, history would need state, move frame, root transform, relevant bone geometry,
vulnerability and hitbox enablement—not only player positions.
Otherwise the rewound target may show the wrong recovery pose or parry state. `F/ftcoll.c:2500-2531`; `F/ftcoll.c:2699-2710`; `M/ftmarsspeciallw.c:75-83`.

A defender-time Counter option could judge whether the defender entered the parry window on their own input timeline.
That introduces a reconciliation question when an attacker-view hit has already been accepted; Melee's local state machine supplies no resolution policy.
Its confirmed boundary is script enablement followed by the collision callback. `M/ftmarsspeciallw.c:75-83`; `F/fighter.c:2930-2936`.

Local prediction could preserve tight jab and Dancing Blade feel without expanding their actual acceptance windows.
Reconciliation would need stage identity and the early-input latch, because replaying only “attack button held” loses the distinction. `C/ftCo_Attack1.c:215-223`; `M/ftmarsspecials.c:101-109`.

Hitlag would need an authoritative freeze interval shared with animation-frame reconstruction.
Clients may present impact immediately, but server windows must use the same paused move clock if copying Melee timing. `F/fighter.c:1675-1711`; `F/ftaction.c:1360-1362`.

The portable mechanics are state-owned timing, bone-bound sword volumes, explicit cancel permissions,
charge substates, scripted branching and separate cosmetic playback.
The source's 2D facing sign and TransN-Z-to-world-X mapping require reinterpretation for deck-plane yaw and 3D locomotion. `F/ft_084E.c:124-136`; `M/ftmarsspecials.c:294-307`.

Aerial landing lag, jump squat, fast fall, and ledge-specific Dolphin behavior are platformer mechanics.
Their recovery-state pattern can transfer, while copying their exact movement assumptions to ship-deck sword combat remains a product choice. `C/ftCo_LandingAir.c:14-65`; `C/ftCo_KneeBend.c:28-65`; `M/ftmarsspecialhi.c:223-251`.

## 7. Open questions

- **DATA outstanding:** exact active-hitbox, IASA, auto-cancel, Dancing Blade link, Counter parry and vulnerability frames require the move scripts referenced by `Fighter_WaitAnimData.xC`. `F/types.h:1044-1049`; `F/fighter.c:1271`.
- **DATA outstanding:** numeric jab windows, smash maximum charge/multiplier, character movement durations and aerial landing lag remain symbolic; their struct fields and offsets are listed in section 3.
- **UNCONFIRMED:** L-cancel's numeric input window and divisor, including the commonly expected “half lag,” are not stated by comments in the inspected definitions. The confirmed operation is division by DATA `xE8`. `F/types.h:217-218`; `C/ftCo_LandingAir.c:43-49`.
- **UNCONFIRMED:** exact low-level HSD frame advance, wrap endpoints and track interpolation arithmetic cannot be proved from the available sparse tree. The fighter's evaluation, rate-setting and frame-readback contract is confirmed. `F/ftanim.c:173-179`; `F/ftanim.c:496-518`; `F/ftanim.c:561-592`.
- **UNCONFIRMED:** no dedicated playback-speed or hit-list-reset subaction opcode was found. The full exposed dispatch and the confirmed alternative mechanisms are documented above. `F/ftaction.c:187-201`; `F/ftcoll.c:2599-2606`.
- **UNCONFIRMED labels:** several commands still manipulate address-named fields/helpers; section 2 records their concrete effects without assigning unsupported gameplay names. Examples: `F/ftaction.c:1111-1115`; `F/ftaction.c:1161-1165`.
- **UNCONFIRMED:** the exact first controllable-frame convention after every entry/animation-end boundary needs runtime or lower-level engine verification; do not add one frame to DATA windows by assumption. Entry bookkeeping is explicit. `F/fighter.c:1232`; `F/fighter.c:1274-1282`.
- **UNCONFIRMED:** the complete survival of accumulated hitlag input edges through the first resumed input sample was not established as a general buffer guarantee. Only the OR-versus-replace behavior is confirmed here. `F/fighter.c:1777-1787`.
- **Not covered:** staling formulas; the requested attack-family files do not implement that system. The shared hitbox-damage setter delegates additional damage adjustment elsewhere. `F/ftcoll.c:2459-2474`.
- **Not covered:** shield mechanics beyond Counter's detection registration, parry gating and transition to counterattack, as required by the ticket. `M/ftmarsspeciallw.c:68-110`; `M/ftmarsspeciallw.c:306-339`.
- **Port question:** which UCF/PC-specific behavior should the mechanics baseline include? This checkout contains an optional dashback patch, so “present in this port” and “retail NTSC-U behavior” require separate labels. `C/ftCo_Turn.c:34-54`; `C/ftCo_Turn.c:133-145`.
- **Port question:** the server's historical input/pose authority, rewind clock, defender-time parry treatment and prediction reconciliation remain design choices; Melee's local code does not answer them.