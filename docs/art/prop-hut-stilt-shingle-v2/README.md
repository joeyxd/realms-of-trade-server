# prop-hut-stilt-shingle-v2

hut-stilt-shingle (manifest id `prop:hut-stilt-shingle`, replaces the procedural `hut`).

- Origin: Tripo web studio, 2026-10-18, image-to-3D from the concept image. Original: `hut-stilt-shingle-v2-original.glb` (13180 tris, 1.6 MB). Concept: `hut-stilt-shingle-v2-concept.png`.
- LOD source: `hut-stilt-shingle-v2-lod.glb` = gltf-transform simplify --ratio 0.7208 --error 0.02 (9500 tris). Bounds x -0.496..0.500, y -0.379..0.381, z -0.396..0.396.
- Game derivatives (assets/models): `prop-hut-stilt-shingle-v2-desktop.glb` (9500 tris, 1024 WebP, 625412 B) and `prop-hut-stilt-shingle-v2-mobile.glb` (512 WebP, 531464 B).
- Budget: building (10000 tris), texture 1024 PC / 512 mobile.
- Runtime: toon material and ink outline come from the game renderer (registry/toonmat), not from the GLB.
- Provenance: Tripo AI, task eba01e66-cabf-4915-ad42-643a8e284c9d, 2026-10-18; source GLB sha256 802a41eb7b60991f3f49ae315be5f569ee85ffab59b0c95554eaf7aa456f2c19 (catalog row `hut-stilt-shingle`).
- Orientation: door, porch and steps face +x in the GLB; the manifest rotY -90 turns them to the game's +z (the procedural hut's door side).
- Variants: `prop:hut-stilt-shingle` and `prop:hut-stilt-thatch` both replace `hut`; src/render/props.js splits the huts between them by a hash of each hut's position (propVariants) and lights the measured windows (HUT_WINDOWS) at dusk and night.
