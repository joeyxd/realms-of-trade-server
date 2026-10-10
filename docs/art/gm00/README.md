# GM00: reproducible asset candidates

These are editor-only optimization candidates for visual A/B review. The originals remain under `materials/imported models/`; no candidate is accepted for gameplay or runtime-manifest use until it is reviewed through the game loader. The click-to-place catalog exposes exactly four entries: two unchanged-geometry tropical rock texture variants and coral geometry variants at about 200K and 50K triangles. Texture-only coral baselines are generated into local `.scratch/gm-assets/benchmarks/` for diagnostics and excluded from the editor catalog because their 2M-triangle geometry keeps them around 60 MB each. The receipt keeps their metrics, so those large diagnostic files need not enter the release tree.

Run from the repository root:

```powershell
npm test
npm --prefix tools/gm-assets run check-assets
npm --prefix tools/gm-assets run prepare-assets   # explicit asset generation
npm --prefix tools/gm-assets run reproduce        # opt-in; regenerates twice to prove determinism
```

The tool pins its own dependencies in `tools/gm-assets/package.json` and `package-lock.json`; the actual versions are copied into `receipts.json`. The regular root `npm test` is read-only and checks only the four public outputs; it never regenerates assets. `prepare-assets` writes generated binaries and metadata. `reproduce` is an explicit, heavier opt-in which prepares twice and checks output hashes. The tool reads each original directly for every variant, resizes source maps to at most 2K or 1K, encodes WebP at quality 95, and writes the four public candidates under `assets/editor/` with a 12-character SHA-256 suffix in each filename. Coral texture-only diagnostic GLBs go under local `.scratch/gm-assets/benchmarks/`, never in the catalog. Coral geometry candidates are simplified directly from the untouched source with meshoptimizer; normals and UVs stay as attributes and the existing normal map stays attached. No normal-map bake is attempted. Each source and output SHA-256, byte count, triangle count, texture dimensions/bytes, bounds, and recipe are recorded in `receipts.json`. `catalog.json` is the small version-1 editor catalog; `src` is relative to the `assets/` root and each entry uses `fit: "size", size: 4` for the same preview normalization.

| Candidate | Catalog | GLB bytes | Change vs. source | Triangles | Texture bytes |
| --- | :---: | ---: | ---: | ---: | ---: |
| Tropical rock, WebP 2K | yes | 3,271,288 | −63.0% | 19,469 | 2,516,944 |
| Tropical rock, WebP 1K | yes | 1,546,948 | −82.5% | 19,469 | 792,602 |
| Coral, WebP 2K | no, diagnostic | 60,661,284 | −1.8% | 2,000,696 | 1,809,388 |
| Coral, WebP 1K | no, diagnostic | 59,564,232 | −3.5% | 2,000,696 | 712,344 |
| Coral, 200K target + WebP 2K | yes | 8,596,920 | −86.1% | 199,999 | 1,809,388 |
| Coral, 50K target + WebP 2K | yes | 3,482,648 | −94.4% | 49,999 | 1,809,388 |

Both rock candidates retain all 19,469 source triangles and its three 2K maps. Coral's source has 2,000,696 triangles and three 4K JPEG maps; texture-only candidates barely affect total weight, so geometry is the dominant cost. Coral's source and texture-only candidates share these local bounds: `[-0.4578247, 0, -0.3105927]` to `[0.4578247, 0.9999695, 0.3105927]`. The 200K candidate changes extents by at most 0.00028 local units; the 50K candidate requires silhouette and shading review at the same `size: 4` preview scale. Triangle/byte budgets are preparation gates, never visual acceptance.

The source coral GLB declares `KHR_materials_volume` and `FB_ngon_encoding`; the latter is an optional extension with no primitive-level payload in this file and is not understood by the pinned GLB tooling. The tool emits a warning and omits that declaration on write. Review the output extension/material metadata before any acceptance. `KHR_materials_volume` remains outside the current toon material contract, and existing runtime toon behavior does not guarantee PBR roughness/volume fidelity. Compare original and candidate through the same current loader and lighting. The loader path is `src/render/assets/registry.js`: `ensureModel(raw, { base: 'assets/' })`, `GLTFLoader`, and the registered Meshopt decoder. WebP is decoded by Three.js `GLTFLoader` through `EXT_texture_webp`; these GLBs do not require meshopt decoding.

The actual game loader visual review uses [`docs/delivery/gm00/visual-evidence.json`](../../delivery/gm00/visual-evidence.json) and is summarized in [`visual-review.md`](visual-review.md), with 14 captures across two fixed camera angles. Source assets remain intact. The 1K rock is nearly indistinguishable from the source under the current toon loader; the 200K coral retains its silhouette and color while losing fine detail, and the 50K coral is visibly more faceted. These are reviewed visual candidates only: physical-mobile performance was not measured, and no candidate is accepted for gameplay. Keep `visualReview: pending` in the deterministic receipt; review conclusions live in the separate evidence document so asset reproduction does not alter receipt hashes.
