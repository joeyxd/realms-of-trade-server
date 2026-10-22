# GM07b2 server: tiles in drafts, publication and player load

Status: chef design T-1022-21 (2026-10-22), inside the approved GM07 design ([gm07-terrain-tiles.md](gm07-terrain-tiles.md),
D8-D11). Input: the server map context/gm07b2-server-map.md (T-1022-18, git-ignored area context).
No product decision changes. S5 (a draft tile read route) and S9 (the refusal code reused as "SQL not applied") add to D8.

## Decisions

S1 Draft tiles in Postgres, migration 042 (re-check the number after every fetch). Table as D8. RPCs, service role only;
bytes travel as base64 text (supabase-js sends JSON; base64 is 4/3 of the raw size, hex would be 2x):
- `mn_put_gm_terrain_tiles(p_world text, p_tiles jsonb) -> {ok: true, stored: n}`; `p_tiles = [{sha256, b64}]`, at most
  16 tiles per call (Node splits larger batches). Insert `ON CONFLICT (world, sha256) DO UPDATE SET created_at = now()`:
  a re-upload refreshes the tile, so the collector never races a save that follows an upload.
- `mn_get_gm_terrain_tiles(p_world text, p_hashes text[]) -> [{sha256, b64}]` for the present ones, at most 64 hashes.
- `mn_gm_terrain_tiles_ready() -> {version: 1}`.
- Collector, inside `mn_put_gm_terrain_tiles` after the insert: delete at most 256 rows of that world older than 24 h
  that no head in `mn_gm_drafts` of that world references (`document->terrain->tiles[*][2]`). No timer, no cron.

S2 SQL validation of v5: a wrapper in the 031/033 style (the current validator renamed under a guard, the new one
handles document version 5 and delegates the rest): terrain `{version: 3, tileSize: 70, tiles}` as D7 (sorted by tz
then tx, unique, keys inside the tile range of the base revision, sha256 lowercase hex, bytes 13..65536, at most 256),
object `y` in [-64, 256], everything else as v4. `mn_save_gm_draft` is replaced: for a v5 request every referenced
`(world, sha256)` must exist with `octet_length = bytes`; otherwise it returns
`{ok: false, why: 'tiles_missing', missing: [sha256, ...]}` before writing a receipt, so the client retries with the
same operation id after uploading. The rest of the function is unchanged.

S3 Node validates every tile before it is stored: canonical `decodeTile` plus re-encode to the same bytes
(src/editor/terrainTiles.js), sha256 of the bytes equal to the claimed hash, at most 65,536 bytes, key inside the
domain. One bad tile refuses the whole batch (`tile_invalid`). The memory store and the Supabase store run the same check.

S4 Upload: `POST /api/gm/terrain-tiles?world=<world>`, body = repeated (u32 little-endian length + bytes), at most 64
tiles and 4 MiB, with its own binary reader (readBody is JSON-only), the same auth and rate limiter as the draft
routes. The client uploads only the tiles not known to be on the server (a per-world set filled by its uploads and by
the heads it loads), then saves; on `tiles_missing` it uploads the listed tiles and retries once with the same
operation id. A whole-map first save is 64 tiles, about 3.8 MB: one or two upload requests.

S5 Draft tile read (added to D8): `POST /api/gm/terrain-tiles/read?world=<world>` with JSON `{hashes: [...]}` (at most
64) answers the same length-prefixed format in request order; any missing hash answers 404 `tiles_missing` with the
list. remotePanel.load needs it: a remote v5 head is useless without its tiles. Same auth and limiter.

S6 Prepare keeps its contract (`{expectedRevision}`): the server loads the head, then its tiles from the store once
into a Map (at most 256 x 64 KiB), verifies each hash, and passes the Map to the build (compile) and to the registry
(retain). No second read.

S7 Prepared content (D9). For v5, `content.terrain = {format: 'marea.gm.terrain-tiles', version: 1, tileSize: 70,
tiles, heightsSha256, materialsSha256}`, a fixed key set, `materialsSha256` always present. `heightsSha256` is the
sha256 of the compiled Float32Array (561 x 561) bytes, little-endian; `materialsSha256` is the sha256 of the compiled
weight bytes exactly as `compileTerrainTiles` returns them (the build names that layout in a comment). v3/v4 revisions
keep `{gridSize, sha256, materialsSha256?}` and their hash rule; the client checks by document version.

S8 Registry: tiles join the existing `blobs/<sha256>` store (one deduplication, one 1 GiB budget), listed in the
revision files with kind `terrain-tile`. Register takes the tile Map of S6 as a second byte source beside the release
root; load and validateRevision verify every tile blob by hash and by canonical decode. No blob GC in GM07 (none
exists today; a full budget refuses new revisions).

S9 Readiness: a separate gate. `checkGmTerrainTiles` (store) is probed on every v5 save, read and upload (the pattern
of the v4 probe, gmDraftStore.mjs:128-131) and at boot for a /status readiness flag `gmTerrainTiles` (the SQL040
pattern). Without the migration only v5 operations fail, with the existing code `terrain_tiles_not_ready`; v2-v4
drafts keep working.

S10 Player load (D11): `GET /api/world/terrain-tiles/<sha256>`, only hashes of the active revision (else 404), bytes
from the registry blobs, `Cache-Control: public, max-age=31536000, immutable`, `ETag: "<sha256>"`, gzip with node:zlib
when Accept-Encoding allows it (gzipped bytes cached in memory for the active revision). The client fetches every tile
before the scene builds (6 at a time), checks each sha256, compiles with `compileTerrainTiles`, then checks
`heightsSha256` and `materialsSha256`.

S11 Updater check (D10): gmContentCheck reads tile bytes from the registry directory (mounted read-only) and rebuilds;
it stays inside the checker budget (120 s, 1 CPU, 1 GB), measured with the whole-map fixture.

S12 Numbers and gate: one version and protocol bump, in b2d, taken at push time; b1 and b2 ship in one push. The fast
pure gm-* tests join the deploy gate in b2d (each one measured, at most 30 s added in total); SQL tests stay out.

## Slices (one ticket each, in order; b1 and b2 ship together)

- b2a SQL and stores (S1, S2, S3 and S9 store side): server/migrations/042_gm_terrain_tiles.sql, server/gmDraftStore.mjs
  (memory and Supabase: putTerrainTiles, getTerrainTiles, checkGmTerrainTiles, v5 save with `tiles_missing`), tests.
  The HTTP and validator refusals stay: no visible change.
- b2b drafts end to end (S3, S4, S5, S9 host side): upload and read routes, async v5 validation, v5 save and load over
  HTTP, remoteDraft upload and retry, remotePanel load with tiles, the /status flag. Lifts `terrain_tiles_not_ready`
  for drafts.
- b2c publication (S6, S7, S8, S11): prepare v5, content.terrain v5, registry retain and load, activation with the
  burial check, server install, gmContentCheck. Acceptance: converter fixtures, whole-map prepare under 2 MiB and 10 s,
  deploy check with a v5 revision active.
- b2d player and ship (S10, S12): tile route, activeContent fetch and verify, the install sites in main.js, qa-gm05a/b
  on v5, gate additions, version and protocol, fresh-client whole-map QA with bytes (raw, gzip) and load ms.

## Not in GM07b2

Blob GC in the content registry; per-zone loading (GM06b); retention of mn_gm_draft_operations (open since SQL020).
