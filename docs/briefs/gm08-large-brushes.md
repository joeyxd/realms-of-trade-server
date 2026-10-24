# GM08 large-scale terrain brushes

Status: GM08a BUILT (T-1023-13, 2026-10-23) and GM08b BUILT (T-1024-03, 2026-10-24), live in alpha.104. GM08c BUILT
(T-1024-24, 2026-10-24) and GM08d BUILT (T-1024-28, 2026-10-24). GM08 is complete.
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

GM08c **built** (T-1024-24), decisions P1 to P6 below. Client only: no protocol, no SQL, no server change (results are
tiles, so the validator stays the authority). Module `src/editor/terrainNoise.js` (pure).
- P1 **Noise** (tool Noise/Ruido, brush and region): seeded value-noise fBm, 1 to 6 octaves, scale 4 to 256 m (the
  lattice cell of the first octave; each next octave halves the cell and the weight), amplitude 0.1 to 20 m, seed 1 to
  9,999 in the panel with a "New seed" button (the module takes any 32-bit seed). Signed: it raises and lowers. It is
  world-anchored, so two strokes with one seed meet without a seam. Brush: strength x amplitude x noise per unit of
  influence, additive like raise (the airbrush adds, it does not blend). Region: amplitude x noise x the field. The
  sparse v3/v4 document path has no noise.
- P2 **Thermal erosion** (region only): each iteration a vertex whose drop to one of its 8 neighbours exceeds tan(talus)
  per metre moves half its largest excess to its lower neighbours, in proportion, scaled by the smaller edit share of
  the pair; all vertices move together, so the volume is kept exactly. Talus 25 to 45 degrees, 10 to 200 iterations.
- P3 **Hydraulic erosion** (region only): Beyer's droplet model in metres. A drop starts on a random editable vertex
  (seeded), rolls downhill with inertia 0.05 for up to 30 steps of 1 m, erodes from the 3 x 3 vertices around it while
  under capacity (never more than the step's drop), deposits when overloaded or climbing, and lays its load where it
  ends; a drop that leaves the window takes its load (into the sea). Capacity 1 and erosion 0.05 instead of his 4 and
  0.3, measured: 1,000 drops on a 40 m square move 90 % of its vertices by under 0.25 m (at most 1.2 m); 50,000 over
  the whole island cut channels up to 3.8 m (90 % under 0.48 m). 1,000 to 50,000 drops.
- P4 **Cost bound**: thermal work = editable vertices x iterations, at most 4,000,000 (the whole island, 34,547
  vertices, takes up to about 115 iterations); above it the operation fails with the code `cost` and the status says
  "Erosion refused: the area is too large for that many iterations". Hydraulic is bounded by its parameters (50,000 x
  30 steps). Measured on the shared machine, whole island: thermal x100 172 ms CPU, 50,000 drops 203 ms CPU, noise
  about 35 ms.
- P5 **No drag preview for the erosions**: the drag shows the outline only and the erosion runs once on release (it
  would cost up to 200 ms every 120 ms). Noise previews like any brush or region. Choosing an erosion switches Brush to
  Rectangle; Brush cannot be chosen while an erosion is the tool.
- P6 **Clip and clamps as everywhere**: every change is scaled by the D2 edit share (protected places, the shore and the
  outer ring never move) and takes the floor and ceiling clamps of D3. One commit and one undo entry per operation; the
  held region (R7) takes noise and erosions too.
- Tests: `tests/gm-terrain-procedural.test.mjs` (5, pure, in the deploy gate: 64 files), the gesture test (+1: no
  preview, one commit, the cost message), the panel test (+1).
- Open for Joi: the erosion strength on screen (P3 constants), and whether the seed slider should be a number field.

GM08d **built** (T-1024-28), decisions H1 to H5 below. Client only: no protocol, no SQL, no server change (the import
is a region commit of tiles, so the validator stays the authority). Module `src/editor/terrainHeightmap.js` (pure).
- H1 **Export** (panel block "Heightmap", shown with any tool or none): the compiled 561 x 561 heights as a 16-bit
  grayscale PNG, one pixel per metre, column i at x = i - 280 and row j at z = j - 280 (world axes, not the NW-up
  chart), from the map's own lowest (0) to highest (65535) height: about 0.7 mm per unit on the generated island. Up
  filter, deflated with `CompressionStream` (146 KB, 32 to 47 ms CPU). The JSON sidecar (format, version, size, min,
  max, metres per unit and per pixel, origin, row order, seed, base revision) downloads beside it and also rides in
  the PNG as a tEXt chunk `marea-negra:heightmap`, so the PNG alone imports back.
- H2 **Import formats**: a PNG by its signature (grey, RGB, grey + alpha or RGBA at 8 or 16 bits, any of the five
  filters, not interlaced; a colour image gives its first channel; the CRC of every chunk is checked), or by name an
  Unreal `.r16` / `.raw` (little-endian 16-bit, square: its side is the square root of half its bytes). At most 8,192
  pixels a side and 4,097 x 4,097 in all. A JSON chosen with the file supplies the range when the PNG carries none.
- H3 **Range**: our sidecar's min and max when present (they also fill the panel); otherwise the panel's "Black is"
  and "White is" heights (default 0 and 40 m, each -40 to +200 m, black below white). The panel keeps the last range
  used. Unreal's own convention (32768 is zero, Z scale / 128 cm per unit) is the GM's to enter.
- H4 **Resample**: bilinear, the image's corners on the map's corners; a non-square image stretches.
- H5 **Apply**: tool `heightmap` in regionTerrainGrid, a flatten towards each vertex's own target, over the held region
  (with the panel feather) or else the whole map, with the D2 clip and the D3 clamps: protected places, the shore and
  the sea keep their height, and only the 34,547 editable vertices move. One commit, one undo entry; the whole map
  imports in 78 ms CPU. Export and import back move no vertex by more than 1 mm.
- Unreal: whether the author's projects hold a Landscape is still Joi's to confirm (the research census lists
  Landscape materials, not heightmaps); the .r16 path does not depend on it.
- Tests: `tests/gm-terrain-heightmap.test.mjs` (5, pure, in the deploy gate: 65 files), the panel test (+1), the
  gesture test (+1).

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
