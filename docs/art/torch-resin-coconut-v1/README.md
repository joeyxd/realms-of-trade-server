# Torch, resin, and coconut art references

Generated with the built-in `image_gen` tool. The five source PNGs below are retained at full resolution; all five were visually inspected. Each has a real transparent alpha channel (alpha range 0–255).

| File | Role | Source dimensions |
|---|---|---:|
| `resin-icon-original.png` | Amber resin inventory icon, painted outline | 1254×1254 |
| `coconut-icon-original.png` | Whole coconut inventory icon, painted outline | 1375×1144 |
| `torch-tripo-reference.png` | Clean unlit hand torch reference | 1254×1254 |
| `resin-tripo-reference.png` | Clean resin mesh reference | 1374×1145 |
| `coconut-tripo-reference.png` | Clean whole coconut mesh reference | 1321×1191 |

The game-ready icon derivatives are `assets/ui/kit/resina-v1.webp` and `assets/ui/kit/coco-v1.webp` (128×128), plus their `-mobile.webp` variants (64×64). Both preserve transparency and use WebP quality 90. Coconut resizing preserves its original aspect ratio and centers it in the transparent square. The item UI loads these standalone icons through the shared kit; desktop and mobile load one size each. Source PNGs stay outside the runtime bundle. The existing painted torch icon remains in use.

## Tripo brief

Use the clean reference PNGs, one at a time. Request triangle topology, Smart Low Poly, no quad mode, and export GLB. Starting limits: torch about 1,000 triangles; resin and coconut 500–800 triangles each. Use a 512px desktop texture and a 256px mobile texture; retain the full-resolution generated references outside the runtime. Torch geometry stays unlit—the flame is a separate game effect. These are visual references, not approved or integrated meshes.

## Exact generation prompts

### Resin icon

```text
Use case: stylized-concept
Asset type: game UI inventory item icon, matching the attached Marea Negra painted item atlas; use it only as a style reference.
Scene/backdrop: genuinely transparent alpha, no backdrop.
Subject: one single irregular lump of sticky amber tree resin, a rounded golden-orange drop/blob with one short trailing drip and a few glossy highlights; icon-readable silhouette.
Style/medium: hand-painted comic game icon with chunky color planes, saturated amber and ochre, thick dark ink contour and crisp edge highlights, consistent with the atlas palette.
Composition/framing: centered, full object visible, large, 3/4 view, generous transparent margin.
Constraints: exactly one resin lump, no container, no wood, no torch, no extra drops, no frame, no text or labels, no watermark, transparent background.
```

### Coconut icon

```text
Use case: stylized-concept
Asset type: game UI inventory item icon, matching the attached Marea Negra painted item atlas; use it only as a style reference.
Scene/backdrop: genuinely transparent alpha, no backdrop.
Subject: one whole brown coconut with a small patch of rough fibrous husk, a few short fibers, recognizable oval coconut silhouette; not cut open.
Style/medium: hand-painted comic game icon with chunky warm brown color planes, cream and golden edge highlights, deep shadow shapes and thick dark ink contour, consistent with the atlas palette.
Composition/framing: centered, full object visible, large, slight 3/4 view, generous transparent margin.
Constraints: exactly one coconut, no leaves, no basket, no other fruit, no frame, no text or label, no watermark, transparent background.
```

### Unlit torch Tripo reference

```text
Use case: stylized-concept
Asset type: clean single-object 3D modeling reference for Tripo.
Scene/backdrop: genuinely transparent alpha.
Subject: one primitive unlit wooden hand torch, a short sturdy branch handle with an oily dark cloth wrap bound around the top, slightly tarred and ready to light.
Style/medium: stylized hand-painted pirate survival game prop, chunky readable shape, matte wood and cloth, warm natural colors, soft painted color transitions; no ink outline and no baked lighting.
Composition/framing: centered three-quarter view from slightly above, full object visible with generous transparent margin, isolated.
Lighting/mood: soft even neutral studio illumination; no cast shadow.
Constraints: completely unlit, no flame, no sparks, no smoke, no hand, no stand, no other objects, no ground plane, no frame, no text, no watermark, transparent background.
```

### Resin Tripo reference

```text
Use case: stylized-concept
Asset type: clean single-object 3D modeling reference for Tripo.
Scene/backdrop: genuinely transparent alpha.
Subject: one irregular rounded lump of sticky amber tree resin, honey-gold and burnt-orange translucent edges, a single short natural drip, a few small glossy highlights; compact solid collectible silhouette.
Style/medium: stylized hand-painted pirate survival game prop, chunky readable shape, matte painted color planes with restrained resin gloss; no ink outline and no baked lighting.
Composition/framing: centered three-quarter view from slightly above, full object visible with generous transparent margin, isolated.
Lighting/mood: soft even neutral studio illumination; no cast shadow.
Constraints: exactly one resin lump, no container, no wood, no torch, no extra drops, no scenery, no ground plane, no frame, no text, no watermark, transparent background.
```

### Coconut Tripo reference

```text
Use case: stylized-concept
Asset type: clean single-object 3D modeling reference for Tripo.
Scene/backdrop: genuinely transparent alpha.
Subject: one whole mature brown coconut, natural slightly oblong oval shape, coarse fibrous brown husk with a few subtle strands and a small dry stem nub; keep it fully closed and intact.
Style/medium: stylized hand-painted pirate survival game prop, chunky readable form, matte painted shades of cocoa brown, umber and warm tan; no ink outline and no baked lighting.
Composition/framing: centered three-quarter view from slightly above, full object visible with generous transparent margin, isolated.
Lighting/mood: soft even neutral studio illumination; no cast shadow.
Constraints: exactly one coconut, no cut half, no exposed white flesh, no leaves, no basket, no other objects, no ground plane, no frame, no text, no watermark, transparent background.
```

