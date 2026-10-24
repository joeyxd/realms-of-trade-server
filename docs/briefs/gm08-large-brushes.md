# GM08 large-scale terrain brushes

Status: GM08a BUILT (T-1023-13, 2026-10-23, not pushed). GM08b BUILT (T-1024-03, 2026-10-24, not pushed). GM08c and d
are designed here, not built yet.
Joi's bar (2026-10-21): every row of the census limits table gets fixed. For brushes that means: 24 m maximum, no
fill, no region select, no noise or erosion, no heightmap import or export.
Inputs: [GM07](gm07-terrain-tiles.md) (tiles, the session, GM07c region rendering) and the
[census](../../context/gm-editor-census-2026-10-21.md) (git-ignored area context).

## Why: the measured baseline (2026-10-23, Node, generated map, shared and loaded machine)

- **Editable ground is small and broken up.** 34,547 vertices are editable: 11.0 % of the map and 46.9 % of the dry
  ground (23.4 % of the map is at 0.75 m or higher). Of the editable vertices, 25 / 39 / 54 / 77 / 97 % lie within
  2 / 4 / 8 / 16 / 32 m of a vertex an edit may not touch. The deepest editable vertex is 42 m from protection.
- **Today every large stroke is refused.** A stroke fails as a whole when any vertex it touches is forbidden. A dab
  centred on editable ground is wholly editable in 52 % of 349 centres at 6 m, 8 % at 24 m and 0 % at 64 m and
  128 m. A 64 m or larger brush could never commit.
- **The influence loop does not scale.** A 128 m brush dragged 100 m with dabs every 0.5 m costs 170 ms per
  evaluation, and the drag preview runs it again every 120 ms.
- **GM07c never ran on a drag.** The drag preview rendered without a region, so it rewrote the whole 561 x 561 mesh
  (185 ms) on every preview tick. The commit after a preview rewrote it again: its region was measured against the
  map before the stroke, while the scene showed the last preview. Only strokes without a preview, which the editor
  never makes, took the region path.
- The commit itself is cheap. A synthetic 128 m disk (1,124 editable vertices, 3 tiles) commits in 19 ms (validate
  2.2, compile 6.6, encode 2.7, hash 3.1), and its region render takes 4.9 ms.

## Decisions (GM08a)

D1 **Radius from 2 to 128 m for sculpt and paint** (`TERRAIN_BRUSH_MAX_RADIUS`, terrainBrush.js; panel slider
2..128 in steps of 0.5). Scatter keeps 24 m, because its caps count objects per gesture. The sparse v3/v4 document
path keeps 24 m and its 20,000 samples. Brush parameters are not persisted (the document stores tiles), so no
protocol, SQL or server change. 128 m and no more: the map is 560 m, and a 128 m brush covers 256 m. GM06b (a
1,120 m domain) may raise it, with a measurement.

D2 **Clip, do not refuse.** Every vertex takes its `terrainEditWeights` share: 0 off `terrainEditableMask`, rising
with a smoothstep to 1 at 4 m (chamfer distance) from the nearest forbidden vertex, cached per base map. Why 4 m: 54 %
of the editable vertices lie within 8 m of protection, so a feather that grows with the radius would weaken most of
the island. The cost: a large raise beside a path leaves the path as a trench with 4 m walls. Paths that follow the
terrain are later work (GM06b or a route slice). The validator does not change and stays the authority: a forged
patch is still refused, by the server too.

D3 **Limits clamp.** A grid stroke never moves a vertex below 0.752 m or above 199.998 m (2 mm inside the floor and
the ceiling, for millimetre rounding). A vertex already beyond a limit never moves further past it. Lowering into the
sea is GM06b.

D4 **Dab spacing of max(0.5, r / 12).** Strokes up to 6 m keep their dabs exactly, so the legacy semantics and the
v3/v4 equivalence test hold. The max-of-dabs edge error is r / 1152. The pointer adds points at the same spacing,
so 256 points cover a 2.7 km drag at 128 m.

D5 **Airbrush flow** (`flow: 'stroke' | 'airbrush'`). `stroke` is today's rule: per vertex, the strongest dab
counts, and a second pass in the same stroke adds nothing. `airbrush` sums each dab's weight times its flow per
vertex. A dab's flow is the distance it moved over the radius, or 0.1 for a dab laid on the spot (the first one, and
one per 100 ms while the pointer is held still, up to 255 points). Raise and lower move by strength x sum. The blends
(flatten, smooth, paint, erase) take a share of 1 - exp(-strength x sum): they approach the target and never pass it.
One pass through the centre is about one single-pass stroke, and one second held is about one pass. The ramp has no
airbrush.

D6 **Kernel.** Each canonical parameter set gets one weight function with the rotation computed once, using sqrt
instead of `Math.hypot` (about 7 times faster in V8). The influence of 36 dabs at 128 m dropped from 100 ms to 35 ms.
The grid and the v3/v4 path share this kernel.

D7 **Region rendering through the gesture.**
- `session.preview` returns its patch region. The gesture keeps the union of its regions and the map it showed last.
- `terrainPreview` narrows any region to the vertices whose height or paint changed (`changedBounds`) and skips a map
  that is already on screen. The commit after its preview therefore uploads nothing.
- Undo and redo pass the bounds of the tiles the session rewrote (`tileKeysRegion`).
- Cancel and refusals go back through the same region.
- Compiled maps now carry `terrainPaint`, the four weights per vertex they draw.

### Measured after GM08a (same machine, about twice as loaded: the whole rewrite took 384-410 ms instead of 185)

A 128 m raise dragged 300 m (29 points) changes 21,554 vertices in 22 tiles:

| step | time |
|---|---|
| preview | 116 ms |
| commit | 110 ms (stroke 57, validate 7, compile 7, encode 18, hash 12) |
| region render (343 x 227 vertices) | 60 ms, against 410 ms for a whole rewrite |
| undo (sync and compile) | 7 to 22 ms |

`tests/gm-terrain-large-brush.test.mjs` prints this line on every run.

## Caps after GM08a (census table)

| cap | before | after | where |
|---|---|---|---|
| terrain brush radius | 2..24 m | 2..128 m | terrainBrush.js `TERRAIN_BRUSH_MAX_RADIUS`, terrainPanel.js |
| stroke at forbidden ground | whole stroke refused | clipped, 4 m feather | terrainData.js `terrainEditWeights`, `TERRAIN_EDIT_FEATHER` |
| 0.75 m floor, +200 m ceiling | stroke refused | clamped 2 mm inside | terrainSculpt.js `GRID_FLOOR`, `GRID_CEILING` |
| dab and pointer spacing | 0.5 m | max(0.5, r / 12) | terrainBrush.js `strokeSpacing`, terrainInteraction.js |
| stroke points / path samples | 256 / 8192 | unchanged | terrainInteraction.js, terrainBrush.js |
| scatter radius, v3/v4 path radius | 24 m | unchanged | brushParameters default |
| region select (GM08b) | none | rectangle, or a lasso of up to 256 points | terrainRegion.js `REGION_MAX_POINTS` |
| region feather, raise/lower amount, smooth passes (GM08b) | none | 0..32 m, 0.1..50 m, 1..16 | terrainRegion.js, terrainPanel.js |

## Slices

GM08a **built** (T-1023-13): D1 to D7. Client only: no protocol, no SQL, no server change.

GM08b **built** (T-1024-03), decisions R1 to R6 below. Client only: no protocol, no SQL, no server change.
- R1 **Drawing is applying.** In the panel, Area: Brush, Rectangle or Lasso. A rectangle is dragged corner to corner
  (axis-aligned in world X/Z); a lasso is dragged around the area, a point every metre, and closes on release. Near
  256 points every other point goes and the spacing doubles, so a long lasso is never refused. Releasing applies the
  tool once: one commit, one undo entry. Escape cancels. The region then stays selected (R7).
- R2 **Field** (`regionInfluence`, the strokeInfluence format): even-odd inside by row crossings; the feather grows
  inwards as a smoothstep over the chamfer distance to the nearest vertex outside, so nothing outside the outline
  changes. Each vertex then takes its `terrainEditWeights` share (the D2 clip).
- R3 **Operations** (`regionTerrainGrid`): flatten levels to the level (full; the feather blends); raise and lower move
  by an amount of 0.1 to 50 m; smooth runs 1 to 16 full 3x3 passes; paint and erase blend by the strength (1 fills).
  The D3 clamps apply, to every smooth pass too. Ramps stay brush only; the airbrush does not apply to regions.
- R4 **Eyedropper**: the button "Pick level from the ground" under the level; the next ground click sets the level to
  the centimetre (0.75..200 m). It works for the flatten brush too. Escape ends picking.
- R5 **Rendering**: the drag previews every 120 ms through the gesture region path (D7); the outline lies on the ground
  (a vertex every 2 m or less); before the drag a 2 m ring marks the cursor.
- R6 **Cost** (shared, loaded machine): the whole map as a rectangle with a 32 m feather, smoothed 16 times, commits in
  115 to 245 ms (operation 96 to 203 ms); levelling the whole map in 25 to 100 ms. A phone is not measured.
- R7 **The region stays selected** (Joi, 2026-10-24, T-1024-12). After the gesture applies, the region stays held with an
  amber outline on the ground and a panel block "Selected region: N m2" with Apply to the region (Enter) and Drop the
  region (Escape). Apply runs the current tool and values on it again (level, then smooth, then paint): one commit and
  one undo entry each. A change of tool keeps it; drawing a new region replaces it, but a click without a drag (under
  1 m2) never does; the Brush area, leaving the terrain tools or Escape (after the gesture and the picking) drops it.
  Apply does not preview first: undo is the way back.
- Tests: `tests/gm-terrain-region-ops.test.mjs` (4, pure, in the deploy gate: 61 files), `tests/gm-terrain-region-
  gesture.test.mjs` (4 with R7, TerrainInteraction against a stub editor; imports three, out of the gate), the panel
  test (+2 with R7).

The design as it stood before the build:
- Draw a rectangle or a lasso (a polygon of up to 256 points) on the ground, with a feather width of 0 to 32 m.
- Operations:
  - level to a height, with an eyedropper (pick the level from the ground under the cursor)
  - raise or lower by an amount
  - smooth (n passes)
  - noise (GM08c)
  - paint fill and erase
- A region operation is one commit over a field like the stroke influence (inside the polygon x feather x edit share),
  with the same clip and clamps. Undo reverts it whole.
- The preview shows the region outline and the result through the same gesture region path.
- About 250 lines across 4 files, plus tests.

GM08c **procedural.**
- A noise brush and region operation: seeded value-noise fBm (1 to 6 octaves, scale 4 to 256 m, amplitude 0.1 to
  20 m). It is deterministic, and its seed is a stroke parameter (results are stored as tiles).
- Erosion over a region:
  - thermal: talus angle 25 to 45 degrees, 10 to 200 iterations
  - simple hydraulic: 1,000 to 50,000 seeded droplets
- A cost bound (iterations x area within about 200 ms). It runs on the session grid and commits like a stroke.

GM08d **heightmap import and export.**
- Export the compiled 561 x 561 heights as a 16-bit grayscale PNG, with a JSON sidecar: min, max, base revision and
  metres per unit. The PNG is deflated with `CompressionStream`.
- Import a 16-bit PNG or an Unreal Landscape `.r16` file (raw little-endian 16-bit, Unreal's Landscape export
  format), mapped to a [min, max] range the GM chooses and resampled to 561. It applies as a flatten-to-target field
  with the edit clip and clamps, in one commit.
- Unreal: Joi to confirm whether the author's projects hold a Landscape. The research census lists Landscape
  materials, not heightmaps.

## Acceptance (GM08a)

- `tests/gm-terrain-large-brush.test.mjs` (7 tests):
  - caps and spacing
  - the influence (max and airbrush) against `brushWeight`
  - the edit weights
  - the 128 m drag clipped to the mask, with the measurement and the undo region
  - the floor clamp
  - the airbrush build-up
  - the gesture preview, commit and undo equal to a whole rewrite byte for byte
- `tests/gm-editor-tiles.test.mjs`: the protected-place and +200 m tests now check the clip and the clamp, and still
  check that a forged patch is refused with the grid byte-identical.
- `tests/gm-terrain-panel.test.mjs`: the panel's parameters carry `flow`.
- Pending, on screen (Joi): a 128 m stroke and the airbrush in the browser, desktop and phone.

## Open for Joi

1. The clip replaces the rule "protected places block the whole stroke". The chef decided it, because no large brush
   can work otherwise. Joi can veto it.
2. The 4 m feather.
3. A 128 m brush on a phone (cursor, preview cost) is not measured.
4. Not built yet:
   - an incremental influence across previews (today each preview recomputes every dab: about 35 ms at 128 m over
     300 m)
   - per-row circle bounds
   - a Web Worker for the stroke
5. GM08b: decided by Joi on 2026-10-24: yes, the region stays selected (R7).
