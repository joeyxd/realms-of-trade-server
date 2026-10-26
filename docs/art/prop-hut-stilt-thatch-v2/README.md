# prop-hut-stilt-thatch-v2

hut-stilt-thatch (manifest id `prop:hut-stilt-thatch`, replaces the procedural `hut`).

- Origin: Tripo web studio, 2026-10-18, image-to-3D from the concept image. Original: `hut-stilt-thatch-v2-original.glb` (14265 tris, 2.0 MB). Concept: `hut-stilt-thatch-v2-concept.png`.
- LOD source: `hut-stilt-thatch-v2-lod.glb` = gltf-transform simplify --ratio 0.666 --error 0.02 (9500 tris). Bounds x -0.500..0.500, y -0.416..0.414, z -0.396..0.396.
- Game derivatives (assets/models): `prop-hut-stilt-thatch-v2-desktop.glb` (9500 tris, 1024 WebP, 801188 B) and `prop-hut-stilt-thatch-v2-mobile.glb` (512 WebP, 663384 B).
- Budget: building (10000 tris), texture 1024 PC / 512 mobile.
- Runtime: toon material and ink outline come from the game renderer (registry/toonmat), not from the GLB.
- Provenance: Tripo AI, task e3c786c5-6224-4adf-950e-f1d62a6280cc, 2026-10-18; source GLB sha256 d9fa83314ab31184540cd2d149c6afee0bed8f2c31430865d8377c10cd04ad57 (catalog row `hut-stilt-thatch`).
- Orientation: door, porch and steps face +x in the GLB; the manifest rotY -90 turns them to the game's +z (the procedural hut's door side).
- Variants: `prop:hut-stilt-shingle` and `prop:hut-stilt-thatch` both replace `hut`; src/render/props.js splits the huts between them by a hash of each hut's position (propVariants) and lights the measured windows (HUT_WINDOWS) at dusk and night.
