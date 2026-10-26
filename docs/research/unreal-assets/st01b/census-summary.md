# ST01b Niagara source census

Generated 2026-10-12T16:55:38Z. Exact primary asset class comes from UE 5.8 AssetRegistry metadata for isolated copies of each project Content folder. The commandlet used `-nullrhi`; it did not load NiagaraSystem objects or render effects.

## Verified counts

- AssetRegistry class rows: 993 NiagaraSystem source assets.
- Unique SHA-256 identities: 916; identical-byte source aliases: 77.
- Exact source-to-copy SHA-256 mismatches: 0.
- Per project: ActionRPGMultiplayerStart 7, MyProject 756, SimpleMultiplayerSurvival 230.
- Family/category counts: fire 23, ice 8, impact 71, lightning 9, magic 112, other 547, smoke 10, trail 83, water 22, weather 31.

The category is inferred from CamelCase-tokenized source asset names first, then folder tokens; the label is not visual truth. Family preserves the source top-level Content folder. Class is registry-confirmed; runtime appearance, dependencies, playability, portability, and conversion are not implied. Nine MyProject systems have non-`NS_` names and are included from registry class results. Texture candidates are recorded in each per-project AssetRegistry report, not treated as confirmed Niagara render dependencies.

## Non-NS system sample

- `MyProject` `/Game/Cursor/FX_Cursor` (441413 bytes, SHA-256 `ebf03ad281def0782f0afaab95950ae3ad8bdcc64e89768c6a89fc18b1366035`).
- `MyProject` `/Game/Kobo_Dungeon/FX/FX-AmbientDust` (1336960 bytes, SHA-256 `a9588a3eafca277fd2a0b935cd2d58fbc83fc2b2d77f5626ba57e618ababa4f6`).
- `MyProject` `/Game/Kobo_Dungeon/FX/FX-BrazierEmbers-01` (862229 bytes, SHA-256 `58bf6ce4a53b59513ec27899c48cb8e0608f57b302cc5a30c384cb0c1683710f`).
- `MyProject` `/Game/Kobo_Dungeon/FX/FX-BrazierEmbers-02` (821855 bytes, SHA-256 `cc737b801ca25482b9e3433f575f0267bb3adb7779ad971548dd72c234c991fa`).
- `MyProject` `/Game/Kobo_Dungeon/FX/FX-PotionWhisps-01` (2208401 bytes, SHA-256 `ea5e84f6df0b4e1a40f577509f5370b14bb6a771d391fcec406affeb71fab973`).
- `MyProject` `/Game/Kobo_Dungeon/FX/FX-PotionWhisps-02` (2208714 bytes, SHA-256 `b44b946bade96a9be991a46f97086513a2e7d9d5f16a383949d5bf1ccc6d706c`).
- `MyProject` `/Game/Orasot_Bundle/Stylized_Landscape_5_Bioms/Global/FXS/FXS_Fog` (1140624 bytes, SHA-256 `25c49b403b7b6b8e1a8044136ac74a89e213f4c4d5f632f4f15ae4b1446a029e`).
- `MyProject` `/Game/TopDown/Cursor/FX_Cursor_Failure` (191594 bytes, SHA-256 `f7769fce32ce21f64da0f6987c36f2fcaaaa5ed8a827d807bd0f702dc3a73052`).
- `MyProject` `/Game/TopDown/Cursor/FX_Cursor_Success` (190461 bytes, SHA-256 `9e8e3c98c52b8fd9ff8f15e8650ed26e105b200eb5fd709f26d24bcf6a0486d7`).

## Evidence reports

- Per-project raw registry outputs: `.scratch/st01b-census/projects/{actionrpg,myproject,survival}/asset-registry-niagara.json`.
- Isolated source Content copies and copied registry caches: `.scratch/st01b-census/projects/`; every listed system hash was checked against its corresponding copy.
- Source inventories bounded the copy and were used for earlier candidate comparison; the existing project summaries remain unchanged.
## SubUV and renderer-grid evidence (2026-10-12)

Joined the existing UE 5.8 MyProject AssetRegistry dependency report (756 class-verified NiagaraSystem roots) to reachable MaterialInstanceConstant-to-Texture2D hard-reference edges. The discovery shortlist includes 194 systems: 105 directly reference Niagara's `SubUVAnimation` module and 161 have name-matched material/texture edges. It records 147 distinct source Texture2D packages and 578 edge rows. Name matching is only a discovery aid.

A bounded UE 5.8 NullRHI query loaded all 105 direct-SubUV roots as `NiagaraSystem`; their closures include 72 `MaterialInstanceConstant` and 101 `Texture2D` assets. A renderer pass enumerated 449 `NiagaraSpriteRendererProperties`, reading exact `SubImageSize` (X columns, Y rows), material assignments, and material texture parameter values. It found 184 renderers configured above a 1x1 grid across 79 systems and 25 distinct Texture2D references on those grid renderers. This proves serialized renderer settings and parameter links, not Niagara module execution, runtime playback, or visible appearance.

The safe automatic exporter selected PNG or EXR for 24 of those 25 exact references; one (`/Game/ArrowTrail/Texture/T_FireBall`) had no supported PNG/EXR exporter and was left unexported. Exact root-to-renderer-to-material-to-texture paths, source SHA-256 values, grids, exports, and errors are in `renderer-grid-evidence.json` and `texture-export-attempt.json`. `grid-texture-preview-analysis.json` includes channel ranges and per-grid pixel-hash uniqueness; `grid-textures-all-contact-sheet.png` labels normal-map-only inputs, and `grid-textures-visible-input-candidates.png` excludes them. These are source-asset previews, not runtime renders or conversion outputs. The joined system/material/texture evidence is in `subuv-parameter-evidence.json`; candidate dependencies and raw registries remain in the adjacent reports.
