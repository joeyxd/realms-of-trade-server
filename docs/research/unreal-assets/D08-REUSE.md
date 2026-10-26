# D08 asset reuse review — isolated handling lab

Bounded read-only review, 2026-10-05. Scope: reuse that can save work in the D08 safe handling prototype (acceleration, steering, wake/water readability, wind/audio/control cues). Used `SUMMARY.md`, `CANDIDATES.csv`, `PORTABILITY.md`, project findings, and only the exact candidate source paths below. No full `C:\Unreal` rescan, Unreal launch, export, browser work, or source edits. This is not an asset/license audit.

## Decision

The handling cut is a standalone pure aggregate body in the isolated lab; it does not reuse live naval authority or prediction, because those do not yet exist. Reuse the existing raft renderer, water shader, atlas/fallback and input plumbing as reference points where the lab page can call them safely. The existing raft silhouettes already follow supplied pose and reuse shared GPU geometry; water already has a game-owned animated shader and SSR/low-detail variants. Do not extend the production game path as part of this lab.

No Unreal asset is currently portable as a drop-in D08 feature. Unreal input/Blueprint, Niagara, SoundCue and `.uasset` materials do not run in the browser or server. At most, selected source assets can inform a later, isolated visual/audio canary after conversion and review. Do not make the first handling comparison wait on exports.

## Candidate checks

| Exact source path | Present / bytes | What the evidence supports | D08 call |
|---|---:|---|---|
| `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Blueprints\BP_Holdable_BuildHammer.uasset` | Yes / 221,114 | Existing inventory records strings for local ghost, rotation, requirements and a server build request. Graph behavior and validation were not verified. | Design reference only; construction interaction is outside this handling slice. |
| `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Blueprints\Interfaces\BPI_PlayerMovement.uasset` | Yes / 12,258 | Package named as a player movement interface; no graph or naval semantics established by inventory. | Defer; no evidence it describes ship control. |
| `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Input\Actions\IA_Move.uasset` | Yes / 1,590 | Enhanced Input action package, from project inventory. | Do not port. D08 should use existing game keyboard/touch/gamepad routing and add an explicit helm context only if implementation requires it. |
| `C:\Unreal\MyProject\Content\_SplineVFX\NS\NS_Spline_WaterSplash.uasset` | Yes / 5,381,446 | Water-splash system by path/name; report lists thumbnail evidence, not a live simulation. Dependencies and spline setup unresolved. | Possible wake/splash visual reference; defer export. Niagara cannot execute here and the package is large relative to the lab’s need. |
| `C:\Unreal\MyProject\Content\_SplineVFX\_GenericSource\BP\BP_SplineVFX_WaterSplash.uasset` | Yes / 68,664 | Related Blueprint path; no full graph/dependencies verified. | Reference only; recreate a small effect in the existing Three.js VFX layer if motion testing shows it helps. |
| `C:\Unreal\MyProject\Content\_SplineVFX\NS\NS_Spline_Wind.uasset` | Yes / 1,611,320 | Wind-named Niagara system; no live behavior, gameplay force, or visual parameters verified. | Do not use as wind simulation. Server-owned seeded wind is a D08 design requirement; any visual is downstream of that state. |
| `C:\Unreal\MyProject\Content\BigNiagaraBundle\NiagaraWeather\Effects\NS_Rain_Windy.uasset` and `C:\Unreal\MyProject\Content\BigNiagaraBundle\NiagaraWeather\Effects\NS_Rain.uasset` | Yes / 549,627 and 425,052 | Weather names and reviewed rain thumbnail support a weather-VFX lead, not a running system or wind indicator. | Defer; rain is not required for first handling lab. |
| `C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\Assets\SmallPlane\Audio\WAV_PlaneAudio.uasset` and `C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\Assets\SmallPlane\Audio\Cue_PlaneAudio_Cue.uasset` | Yes / 1,192,129 and 4,339 | Plane audio package names only; neither was auditioned or decoded. No evidence it is a sail/helm/water sound. | Discard for D08. Aircraft audio is a poor match and needs extraction plus new audio loading/event routing. |
| `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Audio\CUE__Footsteps.uasset` and `WAV_FootstepSolid_01.uasset` | Yes / 11,173 and 54,423 | Footstep-named Unreal audio packages; no sound was auditioned. | Not a boat-handling cue; defer. Current lab can retain synthesized audio or be silent until handling is tuned. |
| `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Materials\M_Water.uasset` | Yes / 10,512 | Water material package exists; inventory says behavior was not inspected. | No material logic portability. Keep the already implemented water shader. |

The inventories report no named hull, sail, mast, rudder, helm, anchor, wake-ready mesh, or boat-control system across the three projects. This means no such candidate was identified by path/name in the bounded inventory; it does not prove none is hidden inside an unrelated package or map.

## Portable evidence versus hypotheses

Confirmed here: source files at the exact paths above exist with the listed byte lengths; the candidate register reports the splash thumbnail and water-system names; the current repo has `src/render/water.js`, `src/render/rafts.js`, `src/render/raftMaterials.js`, `src/audio/engine.js`, and procedural VFX modules. The runtime’s audio engine synthesizes audio through Web Audio and has no external clip loader. D08’s wind and handling values therefore need to come from deterministic game state, not from an Unreal effect.

Hypotheses only: spline splash could inspire a wake silhouette; wind/rain systems could inspire weather readability; footsteps could contain a useful timber creak if separately identified. None has been auditioned or run, and package size/name/thumbnail does not establish dependencies, style fit, quality, performance, or exportability. No behavior should be inferred from Blueprint names.

## Reuse already in the game

- `src/render/rafts.js` builds raft geometry procedurally and follows each raft’s world pose. Extend its visual cues only after D08 produces authoritative speed/turn/wind inputs.
- `src/render/water.js` already scrolls wave layers using `mnWind` and contains depth-derived foam around hulls and posts, with an SSR path and a simpler low-detail path. First verify whether the moving hull already yields a readable wake before adding geometry or textures.
- `src/render/raftMaterials.js` maps wood/iron/rope/cloth to the existing shared atlas and exposes semantic color fallback. Existing atlas variants are `assets/textures/raft/comic-materials-v1.webp` (308,536 B desktop) and `comic-materials-v1-mobile.webp` (82,878 B mobile); D06b evidence says one device-specific variant is selected. Do not add an Unreal texture just to prototype wake behavior.
- The D06b review records that geometry/materials already fall back procedurally. Preserve that fallback for any new rope/sail/wake cue; avoid making the lab depend on a new model.
- Current render/audio code is implementation evidence; the water shader’s `mnWind` is visual wave drift and does not prove that playable wind already affects propulsion.

## Recommendation

For the isolated lab, keep the existing water shader and atlas/fallback. No new wake art is required in this cut; a trajectory overlay may help interpret measured paths, but it is an optional measurement aid rather than proof the water effect is insufficient. The lab should use an independent input adapter, with existing game input routes serving only as reference, so it cannot dispatch combat or profile commands. Defer Unreal exports and audio. Reopen the splash candidate only if a later concrete readability need exists. This recommendation does not decide final controls, wind tuning, art style, or accept D08.
