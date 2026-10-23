# GM05a terrain asset check

The existing Unreal/FAB inventory was checked before implementation. It contains no ready heightfield,
Landscape sculpt brush, ground atlas or Landscape material that can replace this renderer's deterministic
561×561 sampler and matching Three.js grid. The terrain path already blends the game's procedural sand,
grass, road and volcanic families from `src/render/terrain.js`; those remain the visual source for this cut.

Concrete reviewed candidates do not fit the preview requirement: `Dreamrise_SMSK/Assets/Meshes/SM_SmallWoodeHut.uasset`
is a complete hut for later M8 housing, `SM_RepairBench.uasset` is a workshop prop, and `SM_StoragePart_03.uasset`
is the accepted crate prop. They do not provide terrain tools, height samples or reusable ground materials.
The Survival `Noise00.png` and `Noise10.png` entries are VFX noise textures, not surface-family art; importing
them here would add weight without improving sculpt feedback. No source assets were exported or modified.

Decision: reuse the current procedural terrain families and canonical grid. No Unreal-derived art is needed
for GM05a's render preview.
