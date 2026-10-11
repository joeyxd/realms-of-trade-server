# Mallas de objetos con Tripo e imágenes con GPT Image (tripo-items-v1)

Fecha: 2026-10-10. Guía para el autor: de dónde salen los iconos, cuántos triángulos pedir en Tripo para cada
tipo de pieza y qué prompts usar en GPT Image ahora que Higgsfield no tiene créditos. Los prompts van en inglés
porque los modelos de imagen los siguen con más precisión. Ruta general de modelos: [ASSETS.md](../ASSETS.md).

## 1. Dónde están los iconos

| Qué | Dónde | Para qué |
|---|---|---|
| **Iconos sueltos para Tripo** (62 PNG transparentes, 440–806 px) | `.scratch/tripo-icons/<id>.png` | Subirlos a Tripo tal cual. Carpeta ignorada por git; se regenera con `python tools/crafting-ui/icons.py . --singles .scratch/tripo-icons` |
| Hojas originales | `docs/art/crafting-ui-v1/source/sheet-a.png`, `sheet-b.png`, `sheet-c.png`; `docs/art/ui-kit-v1/source/sheet-d.png`, `sheet-e.png` | Fuente de todo; no cambian |
| Atlas del juego | `assets/ui/kit/items.webp`, `gear.webp`, `misc.webp` (+ `-mobile`) | Celdas de 128 px: demasiado pequeñas para Tripo |
| Ilustraciones grandes | `assets/ui/crafting/hero-hacha_piedra.webp`, `hero-pico_piedra.webp`, `hero-madera.webp` | En `.scratch/tripo-icons/hero-*.png` están a 806 px: las mejores entradas de hoy |

Ids de los iconos (el nombre del archivo):

- **Herramientas y recetas:** `hacha_piedra`, `pico_piedra`, `antorcha`, `lanza`, `arpon`, `cuerda`, `arco`,
  `flechas`, `fogata`, `potion`.
- **Armas:** `sable`, `daga`, `ancla`, `chispa`, `duelo`, `trabuco`.
- **Ropa y abalorios:** `panuelo`, `tricornio`, `sombrero`, `chaleco`, `casaca`, `coraza`, `botas`, `altas`,
  `viento`, `anillo`, `diente`, `brujula`, `amuleto`, `moneda`.
- **Mercancías:** `madera`, `tronco`, `piedra`, `mineral_hierro`, `hierro`, `pescado`, `fruta`, `harina`,
  `galleta`, `ron`, `agua`, `cana`, `azufre`, `lona`, `polvora`, `balas`, `tabaco`, `especias`, `seda`, `coral`,
  `perlas`.
- **Interfaz:** `crate`, `crate2`, `crate3` (cofres), `mochila`, `cinturon`, `oro`, `mapa`, `diario`.

**Cuidado al usarlos como entrada de Tripo.** Todos tienen contorno negro de tinta, y Tripo lo pinta en la
textura (se ve raro desde otros ángulos). Además, algunos muestran **varios objetos**:

- dos pistolas cruzadas: `chispa`, `duelo` y `trabuco`;
- un par de botas: `botas`, `altas` y `viento`;
- montones: `fruta` (cesta), `balas`, `piedra`, `oro`, `galleta` y `cana`.

Para esos, o para cualquier pieza importante, genera primero una referencia limpia con los prompts de la sección 4.

## 2. Triángulos y quads

- La tarjeta gráfica **solo dibuja triángulos**. Un quad (cara de 4 lados) son 2 triángulos. Un GLB siempre
  guarda triángulos: aunque modeles en quads, el juego recibe triángulos.
- En Tripo, "caras" (faces) significa triángulos en modo triángulo, y quads en modo quad. **10.000 caras quad ≈
  20.000 triángulos.**
- **Quads** solo sirven si vas a abrir el modelo en Blender para retocarlo, retopologizarlo o riggearlo (la ropa
  de un personaje deforma mejor). Tripo exporta los quads en FBX. Para objetos, herramientas y armas: **triángulos**.
- **Si no fijas el límite de caras, Tripo decide solo** y salen 100.000–2.000.000 triángulos. De ahí vienen los
  objetos pequeños con cientos de miles. **Fija siempre el límite.**
- En el móvil importa **triángulos × copias en pantalla**. 150 palmeras de 1.000 triángulos son 150.000; si cada una
  tuviera 50.000, serían 7,5 millones y el móvil no puede. Cuanto más se repite y más pequeño se ve, menos triángulos.
- **La textura pesa tanto como la malla.** En memoria de vídeo, sin comprimir, una de 2048 px ocupa unos 16 MB,
  una de 1024 px unos 4 MB, una de 512 px 1 MB y una de 256 px 0,25 MB. Tripo exporta en 2K/4K: el original se
  guarda, y el juego usa una copia reducida.

## 3. Cuánto pedir

Medido en el juego actual:

- palmeras: 1.016–1.112 triángulos;
- arbustos: 424–512;
- cofre de almacén: 204;
- conchas: 48–96;
- roca de costa: 64;
- bases de personaje procedurales: 7.080.

Los modelos del editor GM (`assets/editor`) muestran el otro extremo: coral de 200.000 y 50.000 y roca de 19.469.
El objetivo del repo para un personaje vestido es **12.000–20.000** ([piloto 3D](../delivery/character-3d-pilot-v1.md)).

| Tipo | Ejemplos | Triángulos en el juego | Qué poner en Tripo | Textura PC / móvil |
|---|---|---:|---|---|
| Mercancía o recogible (muchas copias) | tronco, piedra, fruta, pescado, agua, galleta, ron | 300–800 | Smart Low Poly, triángulos, límite 500–800 | 512 / 256 |
| Herramienta en la mano | hacha, pico, antorcha, arpón, lanza | 500–1.500 | Smart Low Poly, límite 1.000 | 512 / 256 |
| Arma | sable, daga, una pistola, trabuco, arco, ancla | 1.000–3.000 | Smart Low Poly, límite 2.000 (3.000 si tiene detalle) | 512 / 256 |
| Sombrero o accesorio rígido | tricornio, sombrero, pañuelo, mochila a la espalda, cinturón | 1.000–2.500 | límite 1.500–2.500 | 512 / 256 |
| Joya pequeña (solo si se ve en 3D) | anillo, diente, amuleto, brújula, moneda | 200–600 | Smart Low Poly, límite 500 | 256 / 128 |
| Cofre, barril, fogata, mueble | cofres, barril de pólvora, fogata, banco | 500–2.000 | límite 1.000–2.000 | 512 / 256 |
| **Personaje completo vestido** | jugador, NPC | **12.000–20.000** | triángulos, límite 15.000; quads 6.000–10.000 solo si lo retocas en Blender | 1024 / 512 |
| Ropa por piezas | casaca, chaleco, coraza, botas | 2.000–5.000 por pieza, dentro del personaje | **Todavía no**: tiene que deformarse con el esqueleto (equipo modular, W05) | — |
| Hierba o planta pequeña (cientos de copias) | — | 50–300 | Mejor procedural o en Blender (el mínimo de Smart Low Poly es 500) | atlas compartido |
| Arbusto | — | 400–1.000 | límite 500–1.000 | atlas compartido |
| Palmera o árbol | — | 1.000–2.500 | límite 1.500–2.500 | 1024 / 512 |
| Roca | — | pequeña 100–500, grande 1.000–3.000 | límite según tamaño | 512 / 256 |
| Edificio | — | 3.000–10.000 | límite 5.000–10.000 | 1024 / 512 |
| Barco | — | 8.000–20.000 | límite 15.000 | 1024 / 512 |

Son objetivos de partida, no límites medidos en móvil: cada pieza se mide y se revisa dentro del juego.

### Ajustes de Tripo

Nombres de la API; en Studio las etiquetas pueden variar un poco.

- **Modelo v3.1** o el más nuevo.
- **Límite de caras** (`face_limit`): siempre, según la tabla.
- **Smart Low Poly** (`smart_low_poly`): para objetos simples, porque da topología limpia. Acepta 500–20.000
  triángulos (500–10.000 en quads). Puede fallar en objetos complejos; entonces apágalo y deja solo el límite.
- **Quad** (`quad`): apagado, salvo personajes que vayas a riggear o retocar en Blender.
- **Textura estándar.** La detallada solo para personajes; nunca 8K.
- **PBR** (`pbr`): opcional. El sombreado toon del juego usa sobre todo el color, y los mapas de normales vienen
  apagados por defecto.
- **Tamaño real** (`auto_size`, en metros): hacha y pico ≈ 0,55 m (el mango del juego mide 0,52), lanza o arpón
  ≈ 1,6 m, personaje ≈ 1,8 m.
- **Exportar GLB** y guardar el original sin comprimir. La copia reducida para el juego se hace al importar
  (`node tools/import-asset.mjs --dry`).
- **Fuego y brillos son efectos, no malla:** antorcha y fogata se piden **apagadas**.

Las herramientas que hoy salen en la mano al talar o picar son procedurales, de unas pocas decenas de
triángulos ([harvestPose.js](../../src/render/harvestPose.js)). Para usar una malla de Tripo hace falta un
gancho `assets.model(...)` con respaldo procedural: es un corte aparte, una vez exista la malla aceptada.

## 4. Prompts para GPT Image 2.5

### 4.1 Referencia limpia de un objeto, para Tripo

Una imagen, un objeto. Sustituye `[OBJETO]` por una línea de la lista de abajo:

```text
A single [OBJETO], isolated game prop for 3D modeling reference. Three-quarter view from slightly above,
the entire object visible and centered with empty margin around it, nothing cropped. Plain flat light grey
background (#D9D9D9). Soft, even, neutral studio lighting, no cast shadows, no strong highlights.
Stylized hand-painted semi-realistic pirate survival game style (like Sea of Thieves), clean readable
shapes, chunky proportions, matte painted materials. No black ink outline, no text, no logo, no hands,
no other objects, no ground plane. Square 1:1, high resolution.
```

Si GPT Image lo ofrece, también vale fondo transparente en lugar del gris. Tripo recorta el fondo igualmente.

| Id | `[OBJETO]` |
|---|---|
| `pico_piedra` | primitive stone pickaxe: a straight wooden branch handle about 55 cm long with a pointed knapped grey flint head lashed across the top with brown twine |
| `hacha_piedra` | primitive stone hatchet: a straight wooden branch handle about 55 cm long with a knapped grey flint blade lashed to the top with brown twine |
| `antorcha` | unlit wooden torch with an oily cloth wrap at the top, no flame |
| `lanza` | crude wooden spear about 1.6 m long with a knapped grey stone tip lashed with twine |
| `arpon` | wooden fishing spear about 1.6 m long with a three-pronged iron tip |
| `arco` | simple curved wooden bow with a taut string and a wrapped leather grip |
| `flechas` | one wooden arrow with a grey stone tip and white feather fletching |
| `cuerda` | neat coil of brown hemp rope |
| `sable` | pirate cutlass with a curved steel blade and a brass basket hilt |
| `daga` | short boarding dagger with a straight steel blade and a leather-wrapped grip |
| `ancla` | small iron ship anchor used as a hand weapon, with a rope-wrapped grip |
| `chispa` | one wooden flintlock pistol with brass fittings, side view |
| `duelo` | one elegant dueling flintlock pistol with silver inlays, side view |
| `trabuco` | one blunderbuss with a flared brass muzzle and a wooden stock, side view |
| `tricornio` | black felt tricorn pirate hat with thin gold trim, hollow inside as if worn |
| `sombrero` | large captain's hat with gold trim and a white feather, hollow inside as if worn |
| `panuelo` | knotted red pirate bandana headscarf shaped as if worn, hollow inside |
| `mochila` | brown leather adventurer backpack with straps and buckles |
| `cinturon` | leather tool belt with small pouches and a brass buckle, closed in a loop |
| `crate` | small wooden treasure chest with iron bands, lid closed |
| `fogata` | small campfire of crossed logs ringed with stones, unlit, no flames |
| `polvora` | small wooden gunpowder keg with iron hoops |
| `agua` | round leather-wrapped water canteen with a cork stopper |
| `tronco` | one short cut palm log with bark and a pale cut end |
| `piedra` | one fist-sized rough grey stone |
| `pescado` | one salted dried fish |
| `fruta` | one ripe tropical mango |
| `madera` | neat stack of four sawn wooden planks tied with rope |

### 4.2 Personaje para Tripo (vistas múltiples)

Pide cada vista en una imagen distinta, con el mismo texto y cambiando solo la vista:
primero `front view`, luego `left side view` y `back view`. Ruta completa en el
[piloto de personajes](../../tools/character-3d-pilot/README.md).

```text
Full-body character reference of [PERSONAJE], [front view]. Stylized semi-realistic pirate adventure game
style. Neutral A-pose: arms 45 degrees down and away from the body, legs slightly apart, open relaxed hands,
neutral face. Orthographic camera at chest height, whole body visible head to toe with margin, plain flat
light grey background, soft even lighting, no shadows, nothing in the hands, no text.
```

### 4.3 Hoja de iconos nueva para la interfaz

Mismo estilo que las hojas D/E, para que `tools/crafting-ui/icons.py` las recorte. Mantener el fondo magenta;
añadir la hoja y sus ids a `SHEETS`/`ATLASES` en `icons.py` y a `ICON_ATLASES` en `src/ui/kit.js`.

```text
A 4x4 grid sprite sheet of 16 separate pirate survival video game item icons on a perfectly flat, uniform,
solid magenta (#FF00FF) background. Hand-painted stylized semi-realistic style with bold dark ink outlines
around every object and visible painterly brush texture, warm tropical sunlight from the top left, rich
saturated colors, consistent three-quarter view, like premium survival-adventure game UI icons (Sea of
Thieves, Raft). Each object is centered in its own equal cell with generous magenta padding; nothing touches
or overlaps; no frames, no grid lines, no text, no labels, no numbers, no cast shadows, no glow, no magenta
inside the objects. Items in reading order, row 1: (1) ...; (2) ...; (3) ...; (4) .... Row 2: (5) ... Row 4: (16) ....
```

Los prompts exactos de las hojas D y E están en `tools/crafting-ui/gen-kit-sheets.ps1` y sirven igual en GPT Image.

## 5. API de Tripo

- La llave `TRIPO_API_key` de `.env` es válida en `https://api.tripo3d.ai/v2/openapi`. El servidor v3
  (`openapi.tripo3d.com`) la rechaza.
- **La cuenta de API tiene 0 créditos** (consultado el 2026-10-10). Puede que ese saldo sea distinto de los
  créditos de la suscripción de Studio.
- La API también genera imágenes (`text-to-image`, con modelos `chat_image_2.5_*` de la familia GPT Image y
  fondo transparente). Con saldo en la API, se podrían generar desde aquí las referencias de la sección 4 y las mallas.
- El MCP de Tripo no está conectado en esta sesión de Claude Code.

Fuentes: [image-to-model](https://developers.tripo3d.com/en/docs/generation-image-to-model/standard.md),
[text-to-image](https://developers.tripo3d.com/en/docs/generation-text-to-image.md).
