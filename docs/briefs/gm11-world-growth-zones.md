# GM11 World growth, load budget and zones (design, 2026-10-24, T-1024-13)

Status: DESIGN. Joi decided on 2026-10-24: (1) a world over the single-load budget is blocked from publication, with a
meter that warns before it; (2) a large map is split into named zones with a loading screen, and the next zone starts
loading in the background when the player is within about 15 % of the map from that edge, so the screen is short and
barely noticed. Joi approved the chef's proposals below and the four open points on the same day (see the end).

## Why: what is fixed today (explorer T-1024-13, paths in the worktree)

- The extent has two sources. The generator builds `tuning.world.size` 400 (src/data/tuning.js:12, worldgen.js:62-64,
  898) and `revampTerrain` pads it to the literal 560 (src/sim/terrainRevamp.js:10,23-24,149) with an open sea floor of
  -7.5 m outside the island (terrainRevamp.js:28). `mapSpan` is the literal 255 (terrainRevamp.js:149).
- Gameplay already follows `map.half`: movement clamps (src/sim/systems/movement.js:24,49,80), rafts (rafts.js:66,
  raftEditor.js:90), naval route and recovery (naval/route.js:11, recovery.js:26), pearl loot (pearls.js:119), the coast
  geometry (naval/coastGeometry.js:41-44, requires N == 2*half*res+1), publication object bounds
  (src/editor/publicationValidation.js:163). Server authority runs the same src/sim.
- The editor, publication and SQL use literals: the 561 grid and +/-280 in about twelve editor files (T-1021-18 list,
  GM07 brief D12), `gridSize: 561` and the weights length in server/gmPublication.mjs:27,37,106, the tile domain table
  with one entry (src/editor/terrainTiles.js:38), SQL042 tx/tz -4..3 for 'terrain-s21-v1'
  (server/migrations/042_gm_terrain_tiles.sql:61-63), index <= 314720 in SQL031:57 and SQL033:61,83 (v3/v4 documents).
  The base revision id 'terrain-s21-v1' is a literal in about thirteen places (src/main.js:730,745,775,
  activeContent.js:78,93,131, editor.js:47, contentProjection.js:60,85, baseDecoration.js:42, render/gmContent.js:39,
  server/index.mjs:72, gmDraftHttp.mjs:105, gmContentCheck.mjs:24).
- Rendering: one terrain mesh (src/render/terrain.js:12, 560 segments for GM terrain), sea and horizon planes of
  2400 x 2400 (terrain.js:340, water.js:328), the water height texture one texel per vertex (scene.js:96, water.js:123,307).
  Grass, shrub and beach placement cap at 190-200 m (grassPlacement.js:141, shrubPlacement.js:75, beachDetails.js:114,
  beachDebrisPlacement.js:47).
- Loading is one whole world: one GET /api/world/content, then every terrain tile (6 in flight, sha256 checked), then
  the whole grid compiles, all before HELLO (src/editor/activeContent.js:20-42,60-109, src/main.js:147). The server
  sends every live entity, every resource and every raft to every client (src/net/localServer.js:878-891); SPAWN,
  DESPAWN and EVENT go to everyone. No interest management, no terrain streaming, no zones exist. The named ZONES in
  worldgen.js:15-24 are labels, not load units.

## The single-load cost (measured from the code, 1 m cells)

A terrain vertex costs 44 B of attributes (position 12, normal 12, aMask 16, aPaint 4: src/render/terrain.js:16-19,
52-55) plus 24 B of Uint32 index per cell (terrain.js:41-56): about 68 B of GPU memory per vertex. The CPU keeps the
same arrays plus the compiled map (heights, masks, weights) and, in the editor, the session grid (deltas Int32, weights
4 x u8); building the mesh also creates a temporary JS index array of 6 numbers per cell.

| zone (70 m tiles) | side | vertices | terrain GPU | triangles | budget |
|---|---|---|---|---|---|
| 8 x 8 (today) | 560 m | 314,721 | 21 MB | 0.63 M | 31 % |
| 16 x 8 (the GM06b west proposal) | 1120 x 560 m | 628,881 | 43 MB | 1.26 M | 63 % |
| 12 x 12 | 840 m | 707,281 | 48 MB | 1.41 M | 71 % amber |
| 14 x 14 | 980 m | 962,361 | 65 MB | 1.92 M | 96 % amber |
| 15 x 15 | 1050 m | 1,104,601 | 75 MB | 2.21 M | 110 % red |
| 16 x 16 | 1120 m | 1,256,641 | 85 MB | 2.51 M | 126 % red |
| 32 x 32 | 2240 m | 5,022,081 | 341 MB | 10 M | 502 % red |

Download is not the limit: a fully edited tile is at most 24.5 KB raw (heights plus paint, MNT1), so even 196 tiles
are under 5 MB raw and compress well. The limit is one mesh and its memory on a phone.

## Decisions (proposed; Z1 and Z5 are Joi's)

Z1 **Budget and gate (Joi).** One pure function `worldLoadBudget(domain, document)` in src/editor/ (no DOM, shared by
the editor, publicationValidation.js and server/gmPublication.mjs) returns `{ tiles, vertices, gpuBytes, tileBytes,
objects, share, level }` with `share` the largest of its ratios against the budget: 1,000,000 terrain vertices (the
phone floor), 8 MB of raw tile bytes, and the document object cap. Levels: ok under 70 %, near from 70 %, over from
100 %. The terrain panel always shows a meter ("Carga única: 31 %"), the status warns once on entering near and on
entering over, and publication refuses an over world in the client and again on the server
(`world_over_load_budget`: "Este mundo ya no cabe en una sola carga: divídelo en zonas"). Drafts over budget still
save: only publication and activation refuse.

Z2 **The extent is data.** A world zone carries its domain in whole 70 m tiles, `{ minTx, maxTx, minTz, maxTz }`,
which must contain the base revision's domain (today tx, tz -4..3). Tile keys are world-anchored (GM07 D1), so growing
never renames a tile. The base heights outside the generated island are the open sea floor (-7.5 m, as
terrainRevamp.js:28 already pads), so any domain is deterministic from the seed. Every literal site above reads the
domain: grid size N = 70 * tiles + 1 per axis (rectangles allowed: the GM06b west proposal is 16 x 8), `map.half`
becomes `minX/maxX/minZ/maxZ`, the sea and horizon planes and `mapSpan` follow it, SQL042's range becomes a domain
check against the document's own domain (new migration with a readiness RPC and a host check). The v3/v4 index caps of
SQL031/033 stay: those documents are always the old square.

Z3 **Growing in the editor.** A "World size" block in the terrain panel grows or shrinks the domain by whole tile rows
or columns per side (N, S, E, W), shows the new size and the budget it would reach before applying, and never cuts a
tile that holds edits. Growing is one undo entry. The new ground is sea, so growth ships together with the part of
GM06b that lets a GM raise land from the sea in the grown area (the 0.75 m floor and the dry-ground rule stay on the
original island until GM06b proper).

Z4 **Zones.** A world is a list of named zones. Each zone has a name (ES and EN), its own domain within the budget, its
own document and tiles, and up to one link per side: `{ side, zone, offset }`, so the shared edge lines up. The
outermost ring of every zone is sea, so crossings happen on the water (rafts, swimming), never through a cliff.

Z5 **Crossing (Joi): background preload plus a short loading screen.** When the player (or the raft they pilot) is
within 15 % of the zone's extent from a linked edge, the client starts loading that neighbour in the background: the
content document, its tiles (sha256 checked, HTTP cached), and the compiled heights and masks, in a Web Worker or idle
slices so the frame never stalls. Only the closest neighbour is held; leaving the band keeps it cached but drops it
first under memory pressure. Crossing the edge shows a loading screen with the zone name ("Entrando en Costa Oeste"),
the server moves the player (and their raft, crew and carried goods) to the arrival point mirrored on the shared edge,
the client swaps the scene (old terrain and props disposed, new mesh uploaded) and the screen fades. With the preload
done, the screen is only the GPU upload and the server handoff: target under 1 s on desktop, about 2 s on a phone.
Without it (a fast raft, a cold cache), it waits for the download, as today's first load does. The 15 % band is a
tuning value: on a 980 m zone it is about 150 m, 11 to 15 s at the raft's top speed (10 m/s, 13 with the boost:
src/data/navalHandling.js:16, navalNavigation.js:11). A cold preload of a whole zone (up to about 5 MB of tiles plus the
compile) may need more on a slow phone connection: GM11e measures it and widens the band if needed.

Z6 **Network: interest by zone.** The server keeps one simulation per zone in the same process and sends a client only
its own zone's entities, resources, rafts and events (today every client gets everything:
src/net/localServer.js:878-891). Snapshots then scale with the players and objects of one zone, not of the world, which
is what keeps lag low as the world grows. A zone change is one server message (leave, enter, the arrival snapshot);
the background preload covers the terrain and the models, so the handoff carries no world data. A process per zone
(for many players) stays possible later because zones share nothing but the crossing.

Z7 **Persistence.** The player's zone is saved with the position (absent means the original zone, so every existing
profile stays valid: absent-preserving, as the profile rules require). The GM publishes zones one at a time; a link to
a zone that is not active yet stays closed (the edge behaves like today's world edge).

## Slices (each its own session, its own push)

- **GM11a budget meter and gate** (client plus publication; no protocol, no SQL): `worldLoadBudget`, the panel meter,
  the warnings, the refusal in publicationValidation.js and server/gmPublication.mjs. Today's world reads 31 %. Cheapest
  slice and independent of the rest, so it lands first.
- **GM11b extent as data** (Z2): the domain in the document (v6, v5 converted with today's square), the literal sites,
  the generator pad, the planes and the minimap, the new SQL domain check with readiness. Protocol bump (content shape).
- **GM11c grow the zone** (Z3) plus the GM06b part for raising land from the sea in the grown area.
- **GM11d zones on the server** (Z4, Z6, Z7): zone list in the content registry, one sim per zone, interest by zone,
  the crossing handoff, the profile zone field. Protocol bump; SQL if the profile check needs it.
- **GM11e crossing on the client** (Z5): the 15 % preload (Worker), the loading screen with the zone name, the swap,
  the measured times on desktop and phone.
- **GM11f zones in the editor**: create, name and link zones, edit one zone at a time, publish per zone.

## Acceptance (for the whole of GM11)

- Today's world opens unchanged and reads 31 % on the meter; a world at 110 % cannot be published (client and server
  refuse with the same code) but its draft saves.
- A grown 16 x 8 zone plays on desktop and on a phone: walking, sailing, the coast, the minimap and the water edge
  follow the new domain; tile keys of the original island are unchanged.
- Two linked zones: the preload starts inside the 15 % band, the crossing screen lasts under 1 s on desktop with a warm
  preload, the raft and its cargo arrive on the mirrored point, and a client in zone A receives no entity of zone B.

## Decided by Joi (2026-10-24)

1. The budget numbers: 1,000,000 terrain vertices (about 980 m square) with amber from 70 %. Yes.
2. The 15 % band and holding only the closest neighbour. Yes.
3. Zone names: both. The editor suggests names from a list of pirate names and the GM can type their own (ES and EN).
4. Order: GM11a now, before GM08c. Built in T-1024-17 (src/editor/worldLoad.js; tests/gm-world-load.test.mjs).

GM11a notes (T-1024-17): over means above 100 %, so exactly 100 % still fits and a 1,000-edit document (the
edit_limit maximum) stays publishable. The object budget is publicationValidation.js MAX_PUBLICATION_EDITS (1,000)
until GM09 measures more. Under the budget the publication report is unchanged, so retained revisions keep their
identity; over it the report gains one error, `world_over_load_budget`. A base without a tile domain (test maps)
loads its own generated square. Today's world reads 31 %: with the fixed 560 m square only objects (or, in a test,
smaller limits) can move it until GM11b.

## GM11b design (chef, T-1024-35)

GM11b is three sessions, each its own commit, so every step keeps today's world bit-identical:

- **GM11b1 runtime extent** (no protocol, no SQL, no document change): the map carries its bounds, the generator
  builds any tile-aligned bounds, and every runtime reader (sim, server, render, minimap) reads them.
- **GM11b2 editor grid**: the editor's grid, brushes, regions, previews, heightmap, tiles and clamps read the base
  map's bounds; no 561 or +/-280 literal left in src/editor or server/gmPublication.mjs. Documents stay the square.
- **GM11b3 domain as data**: document v6 `terrain.domain { minTx, maxTx, minTz, maxTz }` (v5 converted with
  today's square), the base map generated for the document's domain on the client and the server, publication content
  carrying the domain instead of `gridSize: 561`, SQL044 domain check with a readiness RPC and a host check, protocol
  bump.

B1 **Map bounds.** Every terrain map carries `bounds`, a frozen `{ minX, maxX, minZ, maxZ }` in metres, plus `res`
(vertices per metre), `Nx` and `Nz` (vertices per axis, `(maxX - minX) * res + 1`); `heights[j * Nx + i]` is the vertex
at `x = minX + i / res`, `z = minZ + j / res`. `size`, `half` and `N` stay only on a centered square (today's world,
the test maps); after GM11b1 no runtime reader uses them. src/sim/mapBounds.js (pure) is where readers go.

B2 **Generator.** `revampTerrain(source, { bounds })`, default the centered square of `max(560, source.size)`. A base
height is a function of (x, z) and the seed, so a grown map equals today's map on today's square, vertex for vertex.
Bounds are whole metres and contain the default square.

B3 **Gameplay limits** keep today's margins against each side: movement 2 m, rafts and the raft editor 0.5 m, the
naval route and recovery 2 m, pearl loot 3 m, the coast boundary walls 2 m.

B4 **Render.** Terrain segments per axis keep today's cell (GM terrain 1 m, the revamped island 560/320 m); the water
height texture keeps one texel per vertex (GM) or 256 texels per 560 m, per axis; the water shader takes the bounds'
min and size instead of `uWorldHalf`; seabed and horizon planes center on the bounds with side
`max(2400, longest side + 1840)` (2400 today). Grass, shrub and beach caps stay on the island: the smaller of their cap
and the nearest edge.

B5 **Minimap.** `mapSpan` 255 frames today's square; any other bounds frame `map.bounds`.

B6 **Server pearl guards.** The geometry identity arrays and the drop snapshot carry `map.bounds` where they carried
`map.half`.
