# A01: Noise00 texture canary

## Mission

Run one isolated experiment to determine whether the Unreal `Noise00.png` texture improves one existing VFX in Marea Negra. The target is one VFX consumer only; all unrelated shaders and the generated world noise stay unchanged. This brief is a future mission, not evidence that the asset was exported, imported, or tested.

Source (read-only): `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\sA_Megapack_v1\sA_Projectilevfx\Vfx\Materials\Textures\Noise00.png`.

## Phase A: isolated worker preparation

1. Use a reserved clean worktree or isolated workspace with the approved M4.8 baseline. Do not edit the shared dirty checkout. Record the source file's SHA-256 and verify by decoding the PNG that it is 1024×1024 RGBA. Do not modify, export into, or write anywhere under `C:\Unreal`.
2. Copy the PNG into a task-local scratch directory. Record its hash and confirm it matches the source. Do not put it in the shared `assets/` directory in this phase.
3. Run the existing importer dry-run against that scratch copy:

   ```powershell
   node tools/import-asset.mjs "<scratch-path>\Noise00.png" --id=tex:a01-noise00 --dry
   ```

   This reports file size and validates the proposed manifest entry; for raster input it does not decode-check dimensions or channels. The importer has no `--data` flag. A later prepared manifest entry must set `"data": true` because this is a sampled noise/data map, not sRGB color. Do not claim the dry-run proves the texture loads in the renderer.
4. Prepare a narrow implementation proposal for one existing VFX shader/particle consumer, with a named procedural-noise fallback. Keep `U.mnNoiseTex` as the world-wide generated texture; do not replace it globally. The proposal must identify the exact leaf renderer file(s), uniforms/texture channel usage, UV/repeat treatment, and fallback behavior. Do not edit simulation, protocol, economy, or unrelated VFX files.
5. Return the proposal and source/scratch hashes to the parent integrator. Stop before importing or changing shared manifest/wiring.

## Phase B: parent integration and runtime acceptance

Proceed only after the parent confirms the mechanics owner has cleared the specific leaf renderer files from concurrent work. The parent owns `assets/manifest.json` and shared loader/wiring. Assign a worker explicit leaf files only; parent reviews the patch and the complete evidence. Add a manifest entry with `data: true` and connect it only to the selected VFX consumer. The existing generic `assets.texture(id)` registry can load PNG textures, but a manifest entry alone has no visual effect unless runtime code consumes it.

Before integration, capture a procedural baseline. After integration, run the identical map, camera, character/action, VFX trigger, render quality, and capture framing with the texture enabled, then with `?noassets` (or the selected texture deliberately unavailable) as the procedural comparison. Also exercise a 404/bad-texture path and confirm the selected effect falls back without breaking the scene. Inspect screenshots at day and night, high and low quality, and a mobile viewport. Record load state/errors, compressed file size, decoded dimensions/estimated bytes, draw-call count, and any measurable frame-time change using the same setup. State the device and renderer; SwiftShader/software output is not real-GPU performance evidence.

The current asset registry records per-asset load errors and allows consumers to fall back (`src/render/assets/registry.js`); the existing `--check` command checks manifest entries/files and model summaries, not visual use:

```powershell
node tools/import-asset.mjs --check
```

Runtime acceptance requires a screenshot-reviewed consumer comparison and confirmed fallback, not just a successful `--dry` or `--check`. If Noise00 does not clearly improve the selected effect without unacceptable cost or readability loss, document the evidence and defer it in favor of procedural noise; do not produce a chain of texture variants.

## Deliverable

Return a result of at most 20 lines. Phase A reports prepared/unavailable, source/scratch hashes, decode/dry results and the hook proposal; mark runtime comparison and final decision pending. Phase B reports keep/defer, exact consumer and files changed, importer/check outcomes, baseline/comparison capture paths, fallback, size/load/draw-call/performance observations, device/renderer and remaining limitations. Store a durable text result with exact evidence paths; large local captures may remain under ignored `shots/`. Do not commit or push as part of this mission.
