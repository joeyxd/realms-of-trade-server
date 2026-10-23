# GM07 terrain tiles and the domain contract

Status: APPROVED by Joi on 2026-10-21 (T-1021-25), all five open points as recommended. GM07b0 first.
Inputs: [census](../../context/gm-editor-census-2026-10-21.md) (git-ignored area context), client map T-1021-18, server map T-1021-19.
GM07 absorbs GM06a (bounds, coast contract, chunks, legacy documents). GM06b (coast, new land) builds on it.

## Why

Terrain today is a sparse JSON list `[index, deltaMm]` over the fixed procedural base `terrain-s21-v1`
(`src/editor/terrainData.js:8-13,19-50`). The index `j*561+i` is the persisted address (also in SQL031/033:
index 0..314720). Caps: 20,000 samples (about 6 % of the map), +/-12 m, floor 0.75 m. A full-map edit in this
format is 4-5 MB of JSON, over the 2 MiB prepared-document cap (`server/gmPublicationAssets.mjs:9`).
Every active revision also hashes every `src/` file (`gmPublicationAssets.mjs:141-148`), so any deploy makes it
incompatible and the updater refuses to deploy while it is active (`deploy/vps-update.py:302-316`).

## Decisions

D1 Tiles are world-anchored. Tile size T = 70 m, 1 m cells. Tile `(tx, tz)` owns the vertices with integer world
coordinates `x in [70*tx, 70*tx+69]`, `z in [70*tz, 70*tz+69]`: 70 x 70 = 4,900 vertices, no shared edges, no
duplication. Keys never change when the domain grows: the GM06b western proposal X -840..280 is tiles tx -12..3,
today's square is tx, tz -4..3 (64 tiles).

D2 The domain belongs to the base revision, not to the document. A shared table maps a base revision to its
domain: `terrain-s21-v1 -> X [-280, 280], Z [-280, 280], cell 1 m`. The outermost vertex ring of the domain is not
editable (the world edge stays the base ocean, -7.5 m), and the far ring (x = 280 or z = 280) belongs to no tile.
GM06b adds a new base revision with a larger domain plus an explicit rebase; tile keys survive it.

D3 Heights are a signed delta in millimetres over the base, per vertex. 0 means untouched and is not a change
(it marks no changed cell). The compiled height is the same formula as today: Float32Array copy of the base,
`heights[k] += deltaMm / 1000` (`terrainData.js:160`); outside changed cells the samplers keep falling back to the
base sampler, as today. Converted documents therefore compile to bit-identical heights.

D4 Height range: the compiled height of an edited vertex must lie in [-40, +200] m. The +/-12 m delta cap goes
away. The GM05 edit rules stay unchanged in GM07 (floor 0.75 m before and after, docks, lawless zone, paths,
arena, lava, volcanic masks, protected discs; `terrainData.js:66-98,140-147`): GM06b relaxes the floor and adds
sea level and seabed. Object `y` range goes from [-64, 100] to [-64, 256] (`document.js:13-15`).

D5 Paint: up to 8 channels per tile. Each channel names a global terrain material id (u8, 1..255) and holds a u8
weight per vertex; the per-vertex sum is at most 255 and the remainder is the automatic base material, the same
meaning as today. Ids 1..4 are today's families in today's order (grass, dirt, sand, rock), so v4 converts exactly.
The renderer supports ids 1..4 until GM10 (texture array, 8+ materials); validation refuses unknown ids.

D6 Tile blob `MNT1`, little-endian, canonical (same content, same bytes, same hash):

| offset | field |
|---|---|
| 0 | magic `MNT1` (4 bytes) |
| 4 | format version u8 = 1 |
| 5 | tile size u8 = 70 |
| 6, 8 | tx i16, tz i16 |
| 10 | height encoding u8: 0 none, 1 int16 mm, 2 int32 mm |
| 11 | paint channel count u8 (0..8) |
| 12 | material id u8 per channel, ascending |
| then | heights plane, 4,900 values, z outer, x inner (absent with encoding 0) |
| then | one 4,900-byte weight plane per channel |

Canonical rules: the smallest encoding that fits (int16 when every |delta| <= 32,767 mm); only channels with a
non-zero weight; a tile with no heights and no channels is not stored (absent means base); non-editable vertices
hold 0. Maximum blob 58,820 bytes; cap 64 KiB. Identity: sha256 hex of the bytes.

D7 Document v5: `terrain: { version: 3, tileSize: 70, tiles: [[tx, tz, sha256, bytes], ...] }`, sorted by tz then
tx, unique, inside the domain, at most 256 entries. The tile bytes live beside the document, never inside it.
The document stays JSON and small (64 tiles are about 6 KB), so the 5 MiB draft and 2 MiB prepared caps stay.
v1..v4 keep loading. A pure, deterministic converter `v3/v4 -> v5` runs in the editor on load and on the server
when it validates or prepares; tests prove bit-identical compiled heights and identical weights on fixtures.

D8 Drafts. Local: IndexedDB `marea-gm-drafts-v1` version 2 adds a `tiles` store (sha256 -> bytes); records keep the
document; unreferenced tiles are dropped after a save. Undo keeps whole-document snapshots (references only) plus
an in-memory tile map: 100 entries and at most 64 MiB of unique tile bytes, oldest dropped first.
Remote: Postgres, new migration (042 on origin today; re-check after every fetch):
`mn_gm_terrain_tiles(world, sha256, bytes bytea, created_at, PK(world, sha256))` with CHECK `octet_length <= 65536`
and `sha256(bytes) = decode(sha256, 'hex')`; `mn_put_gm_terrain_tiles` (service role, idempotent);
`mn_save_gm_draft` accepts v5 only when every referenced tile exists for that world; a bounded collector drops
tiles that no draft head references after 24 h; readiness `mn_gm_terrain_tiles_ready() -> {version: 1}` with a host
`checkGmTerrainTiles` gate (pattern of SQL040, `server/store.mjs:766-769`). Node decodes and validates every tile
before it is stored. Upload route `POST /api/gm/terrain-tiles`: length-prefixed blobs (u32 + bytes), at most 64
tiles and 4 MiB per request, one request per save (the 30 requests/60 s limit holds). A save with missing tiles
answers `tiles_missing` with the list.

D9 Publication. Prepare copies the referenced tiles into the content registry blob store (`blobs/<sha256>`,
deduplicated across revisions, inside the 1 GiB budget, `server/gmContentRegistry.mjs:7-8`).
`content.terrain = { format: 'marea.gm.terrain-tiles', version: 1, tileSize: 70, tiles, heightsSha256,
materialsSha256 }`, where the hashes cover the compiled Float32Array bytes and the compiled weight bytes,
not `canonicalJson(Array.from(...))` as today (`server/gmPublication.mjs:42`), which is slow at this size.
Retained v3/v4 revisions keep their old hash rule.

D10 Content identity independent of the runtime (preparation schema v2). `revisionId` hashes the content without
the runtime file list; the list stays in the revision for audit. The updater check rebuilds the active revision
with the candidate release and requires the same id and the same derived hashes (terrain, materials, collision,
resources); when they match, the deploy goes ahead and the revision stays active. The client stops requiring an
equal `gameVersion` and keeps verifying the derived hashes it recomputes; the protocol check at HELLO stays.
A schema v1 revision still blocks a deploy, as today. This closes PLAN section 13 "migración explícita entre
runtimes" and is the precondition for a sculpted world that survives pushes.

D11 Player loading. `/api/world/content` keeps its shape (now with tile references). New
`GET /api/world/terrain-tiles/<sha256>`: only hashes of the active revision, else 404; `Cache-Control: public,
max-age=31536000, immutable`, ETag = hash, gzip when accepted. The client fetches every referenced tile before
the scene builds (6 at a time), checks each sha256, compiles, then checks `heightsSha256`. Loading by zone is
GM06b; tiles are independent, so the format already allows it. The server loads all tiles: the sim needs the
whole map.

D12 Runtime map shape is unchanged in GM07: one Float32Array 561 x 561 compiled from base plus tiles, installed by
`installGmContent` (`src/editor/contentProjection.js:68-92`); the sim, validation and the activation burial check
(`server/gmContentObstacles.mjs:178-203`) read it as today. Rectangular domains, non-square samplers,
`coastGeometry` (N x N, `src/sim/naval/coastGeometry.js:40-45`), the water height texture, the minimap and the
twelve hard-coded extent sites are GM06b.

No realtime protocol message carries terrain. The protocol and version numbers are taken at build time,
re-checked after every fetch.

## Caps after GM07 (census table)

| limit | today | after GM07 | later |
|---|---|---|---|
| map | 560 m square | same; the format already holds X -840..280 | GM06b |
| edited samples | 20,000 | every editable vertex (64 tiles, 313,600 owned) | |
| height | +/-12 m delta, floor 0.75 m | [-40, +200] m absolute; floor stays | GM06b floor, sea level |
| paint | 4 families | 8 channels per tile, ids 1..255 in the format | GM10 renderer |
| brush | 24 m | same; GM07c gives the dirty-tile rendering it needs | GM08 |
| objects | 120 / 1,000 / 5,000 | same | GM09 |
| draft / prepared doc | 5 MiB / 2 MiB | same, references only; tile 64 KiB, 256 per document | |

## Slices (each one ticket family, Joi approves this design first)

- GM07b0 content identity (D10). Small, independent, first: deploys stop requiring a rollback to base.
- GM07b1 format and editor (D1-D8 client side): shared `src/editor/terrainTiles.js` (encode, decode, canonical
  check, hash, compile, validate, convert), document v5, sculpt and paint write tiles, whole map editable,
  undo by bytes, IndexedDB v2, object y range. Remote save of v5 answers "not yet" until b2; local works.
- GM07b2 server (D8-D11): migration plus readiness and host gate, upload route, draft save v5, prepare and
  retain tiles, tile route, player load, server install. The fast gm-* tests join the deploy gate.
- GM07c rendering: one mesh per tile with dirty-tile rebuild (today every stroke rewrites 314,721 vertices,
  `src/render/terrain.js:268-300`), a water height texture at 1 texel/m or tiled (today 256 x 256 over 560 m),
  minimap atlas invalidated by dirty tiles. Precondition for GM08's 128 m brushes.

## Acceptance (for the builds)

- Round trip: encode, decode, re-encode gives the same bytes; non-canonical blobs are refused.
- Converter: fixtures v3 and v4 (including the GM05a delivery export) compile to bit-identical heights and the
  same weights as before; activation of a converted revision passes the burial check.
- Whole map: a document that raises every editable dry vertex by 30 m validates, prepares under 2 MiB and within
  the 10 s prepare timeout, activates, and loads in a fresh client; record bytes (raw and gzip) and load ms.
- SQL in PGlite: put is idempotent, hash mismatch and oversize refused, save v5 with a missing tile refused,
  readiness `{version: 1}`.
- Deploy: with a schema v2 revision active, a release that changes `src/` passes the content check and keeps it.

## Decided by Joi (2026-10-21)

1. Tile size 70 m.
2. Height range [-40, +200] m. Joi wants snow by altitude when terrain paint gets rules (GM10); 200 m is a
   validation constant, not a format limit (int32 deltas hold any height), so it can grow later.
3. Floor 0.75 m and protected zones stay until GM06b.
4. GM07b0 first, so a published world survives pushes.
5. Draft tiles in Postgres.
