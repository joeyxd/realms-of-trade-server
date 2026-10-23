# prop-flower-bush-v5

flower-bush (manifest id `prop:flower-bush`, replaces the procedural `flowerbush`).

- Origin: Tripo web studio, 2026-10-19, image-to-3D from the concept image. Original: `flower-bush-v5-original.glb` (5430 tris, 1.2 MB). Concept: `flower-bush-v5-concept.png`.
- LOD source: `flower-bush-v5-lod.glb` = gltf-transform simplify --ratio 0.5948 --error 0.02 (3348 tris). Bounds x -0.500..0.437, y -0.435..0.232, z -0.500..0.494.
- Game derivatives (assets/models): `prop-flower-bush-v5-desktop.glb` (3348 tris, 512 WebP, 299124 B) and `prop-flower-bush-v5-mobile.glb` (256 WebP, 261476 B).
- Budget: 3400 (3400 tris), texture 512 PC / 256 mobile.
- Runtime: toon material and ink outline come from the game renderer (registry/toonmat), not from the GLB.
