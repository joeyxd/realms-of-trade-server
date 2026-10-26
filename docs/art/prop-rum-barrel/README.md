# prop-rum-barrel-v1

Rum barrel prop for the port (catalog row `barril`, manifest id `prop:barrel`).

- Origin: Tripo web studio, 2026-10-18, image-to-3D from the Codex concept, Malla Smart + Textura.
  Original: `rum-barrel-v1-original.glb` (9348 tris, 1.5 MB). Concept: `rum-barrel-v1-concept.png` (RGBA).
- LOD source: `rum-barrel-v1-lod.glb` = `gltf-transform simplify rum-barrel.glb rum-barrel-lod.glb --ratio 0.18 --error 0.05`
  (1867 tris, 2048 JPEG texture). Bounds x -0.457..0.449, y 0..0.862, z -0.495..0.499.
- Game derivatives (assets/models): `prop-rum-barrel-v1-desktop.glb` (1867 tris, 512 WebP, 164184 B) and
  `prop-rum-barrel-v1-mobile.glb` (256 WebP, 121304 B).
- Budget (docs/art/tripo-items-v1.md): barrel 500-2000 tris, texture 512 PC / 256 mobile. Met.
- Runtime: prop fitted to the procedural barrel size (fit "proc"); toon/outline come from the registry.
