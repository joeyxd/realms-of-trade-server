# Balsa cómic — textura original v1

Solicitada por el autor, 2026-10-05: material usable en la balsa actual, inspirado en su referencia dramática
y en el acabado de tinta/pintura de Borderlands. Generada con la herramienta integrada `image_gen`.
La referencia aportada guía la dirección artística; no es un asset fuente de FAB ni sustituye su inventario.

Fuente final: `docs/art/source/raft-comic-v1.png`. Se conserva el PNG generado sin edición ni recorte.
El juego sirve derivados WebP 1024/512; [compresión reproducible](raft-comic-optimization.json).
Cuadrantes: madera/metal arriba; cuerda/lona abajo. El renderer remapea UVs y usa el toon/ink del juego.

## Prompt final y procedencia

Modo **edit**, herramienta integrada `image_gen`, referencia: la primera generación propia de abajo.
La segunda pasada reduce la microtrama y amplía grietas/pinceladas para la cámara isométrica.
PNG final sin edición posterior: 1254 × 1254, 3.032.353 bytes.
SHA-256: `fd06e39b63e3a96b23e33d335facb6ed1d2d197b0552af74145b66ae7be8753e`.
Salida original conservada: `C:\Users\xxajx\.codex\generated_images\01a107d8-4bfd-7083-9cbd-6aa2cbeea4f9\exec-6460050f-1997-4a9e-b801-e76140fa9a2c.png`.

```text
Edit this existing four-quadrant game albedo atlas into a premium modern graphic cel-painted pirate raft material. Preserve EXACT quadrant layout and boundaries, no border, no gutters, no labels, no text: top-left weathered amber timber with chipped turquoise paint; top-right dark forged iron with orange rust; bottom-left golden braided rope; bottom-right ivory sailcloth with a faded brick-red repaired right-third panel and oversized cross stitches. This is a texture to map onto actual 3D geometry, NOT a scene, NOT a presentation board.

CRITICAL art change: simplify and enlarge the marks substantially. Remove 75 percent of microscopic scratch, grain, speckling and thread noise. The current texture is too busy from a small isometric camera. Make this read like superb hand-painted Borderlands-style comic game art, with modern clean graphic shape design and confident selectively varied dark ink edges. Large areas of calm painted midtone balanced with a few bold jagged cracks and sweeping grain. Strong warm honey and burnt sienna wood, generous but irregular turquoise chipped paint islands. Beautiful angular cream edge chips and brush highlights, about 5-8 large readable defects in the wood quadrant, NOT hundreds of fine hairline marks. Broad horizontal timber grain, no vertical plank seams. Keep marks flat and unlit: no baked shadows, gradients, bevel shadows or ambient occlusion.

Iron: broad charcoal blue grey painted planes, several large orange rust blooms, a handful of sharp silver scratches and chipped edges, no dirt noise. Rope: a few big diagonally woven golden braid shapes with stylized curved ink boundaries, each fiber bundle indicated by just 2-3 tapered brush strokes, NOT many hair fibers. Cloth: warm parchment plain painted canvas with barely suggested broad brush weave, large black tapered tear lines, 5-6 bold tan stitches on the burgundy patch boundary, low grain. High craft and striking graphic art direction, consistent saturated palette, irregular organic wear, easy-to-read at thumbnail size. Four MATERIAL swatches only, whole square image edge-to-edge. Preserve usable continuous wood grain and material identity. No photorealism, no realistic lighting, no shiny CGI, no typography, no objects, no logos, no watermark.
```

## Primera generación

Modo `generation`. Primera pasada descartada visualmente por exceso de microtrama a distancia de juego.
Se conserva fuera del runtime en `.scratch/raft-art/first-draft.png` y en la salida original de image_gen.

```text
Use case: stylized-concept. Asset type: production game texture atlas / base-color material sheet, NOT a presentation or concept-art board. Create an exceptional, polished modern Borderlands-inspired hand-inked pirate raft material texture. Square image, high resolution. Exact layout: four equally sized square material swatches filling a 2 by 2 grid, no spacing, no border, no headings, no lettering, no perspective. Top-left: warm honey amber weathered timber, long horizontal organic wood grain, angular black ink cracks, sharp cream edge-wear strokes, a few knots and scratches, beautiful irregular chipped desaturated turquoise paint covering about 15 percent, dimensional graphic marks but NO directional cast light. Top-right: dark charcoal forged iron surface, scratched gunmetal, crisp pale chipped edges, scattered orange rust islands, coarse punchy comic texture, no bolts or objects. Bottom-left: golden hemp rope strand / tight braided fiber surface, diagonal twisting repeating fibers, bold dark ink grooves and finely frayed golden threads, full frame filled by texture, no background or rope coil object. Bottom-right: aged ivory sail canvas with a broad irregular muted brick-red repaired panel occupying the right third, dark ink seam lines, tan large cross stitches between panels, fine woven fabric, worn scuffs and frayed-looking graphic fibers, no actual transparent holes. All four swatches are flat front-on orthographic material scans, no shadows from external objects, no vignette, no 3D objects, no text, no logos, no labels, no border or black divider. Dramatic AAA comic game art, expressive angular strokes and restrained halftone, rich controlled amber/cream/turquoise/charcoal/brick-red palette. Use broad readable details for an isometric 3D raft, with a second layer of elegant fine texture. Wood, iron and rope should repeat pleasantly within their swatch. Equal quadrant boundaries at exactly image center. This is the usable albedo atlas we will map onto actual meshes in a browser game, so do not render a raft, a room, samples in perspective or a framed study.
```
