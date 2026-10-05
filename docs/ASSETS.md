# Modelos y texturas externos (Meshy, Sketchfab, Blender…)

El juego parte de geometría procedural; las cajas estáticas ya usan un [primer modelo FAB](delivery/a02-crate.md)
con fallback. Cualquier pieza compatible puede cambiarse por un **modelo real** (`.glb`) sin
tocar código: se copia a `assets/`, se escribe su línea en `assets/manifest.json` y el juego la usa al cargar.
Si falta, está rota o tarda demasiado, esa pieza sigue procedural; el motivo aparece en la consola y en
`__mn.assets.errors`.

| Qué | Cómo entra | Qué conserva |
|---|---|---|
| **Personaje** con rig humanoide (Meshy Auto-Rig, Mixamo, Blender, Unreal, VRM) | Se coloca en la pose de reposo del rig del juego (brazos y piernas abajo), se hornea y se re-skinnea sobre los **15 huesos procedurales** | **Todas** las animaciones procedurales (carrera, dash, combo, guardia, artes, golpes, muerte), estelas del dash, retratos del HUD, despiece al morir, contorno de tinta, destello de golpe, arma procedural en la mano |
| **Prop del mundo** (barril, choza, farol…) | Instanciado y ajustado al tamaño del prop procedural | Colisiones del servidor (mismo tamaño), sombras, tinta, transparencia cerca del jugador |
| **Modelo** por id (barco del muelle, futuros barcos, edificios, mercancías) | `assets.model(id)` lo da ajustado o `null` | Material toon, sombras, tinta |
| **Textura** por id | `assets.texture(id)` | sRGB, repetición, filtro |

Todos los materiales pasan al toon del juego (bandas de luz, sombras de nubes, luces locales, borde, trama de
cómic, bloom de lo que emite), así que un modelo de Meshy no desentona.

## Flujo rápido

Pruebas incrementales de la colección FAB/Unreal junto a gameplay: [PLAN-DELIVERY.md](../PLAN-DELIVERY.md).
El primer brief es [A01, textura en un efecto aislado](briefs/assets-a01-texture-canary.md). El inventario no
demuestra exportabilidad; las fuentes permanecen intactas y el principal integra el manifiesto compartido.

```bash
# 1. Importar (copia a assets/, revisa huesos, tamaño y triángulos, escribe el manifiesto)
node tools/import-asset.mjs ~/Descargas/corsaria.glb --id=char:corsaria --looks=Exploradora
node tools/import-asset.mjs ~/Descargas/barril.glb --id=prop:barrel --props=barrel
node tools/import-asset.mjs ~/Descargas/balandra.glb --id=ship:dock --kind=model
# 2. Revisar todo el manifiesto (sale con error si algo falla: úsalo antes de cada commit)
node tools/import-asset.mjs --check
# 3. Verlo: npm start, abrir http://localhost:5173/?debug y en la consola
__mn.lineup([0, 1, 6], { run: 0.8 })   # esos aspectos en fila, de cerca, corriendo (0 = quietos)
__mn.assets.list()                      # estado de cada asset
# o capturas sin navegador: OUT=shots/assets SCEN=lineup,lineup-run LOOKS=0,1,6 node tools/look.mjs
# ?noassets compara contra lo procedural
```

`--dry` revisa sin escribir. `--remove=<id>` quita la entrada. Otras opciones en la cabecera de
`tools/import-asset.mjs`.

## Meshy (o la herramienta MCP de Meshy)

1. **Generar** (texto o imagen a 3D). Estilo: «stylized, hand-painted, low poly, flat colors, no baked lighting»
   encaja con el arte del juego. Para personajes, pose **T o A** y de frente.
2. **Remallar** (Remesh): personajes **≤ 20 000 triángulos** (mejor 8–15 k), props **≤ 6 000**, barcos y
   edificios **≤ 40 000**. Texturas de **1024** (2048 solo para piezas grandes).
3. **Rig** (solo personajes): Auto-Rigging humanoide de Meshy. Las animaciones que traiga **no hacen falta** (el
   rig del juego anima); se pueden dejar.
4. **Exportar GLB** y pasar por `tools/import-asset.mjs`. Si un archivo pasa de **15 MB** (el límite del
   artefacto y una descarga razonable en móvil), comprimir:
   `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 1024`
   (el juego lee meshopt y Draco).

Un agente con el MCP de Meshy puede hacerlo solo: generar, remallar, riggear, descargar el GLB a una carpeta
temporal, `import-asset` con `--dry` y luego sin él, `--check`, una captura con `tools/look.mjs` (escenario
`lineup`), mirarla y ajustar (`--rotY`, `--height`, `toon`) hasta que se vea bien.

## El manifiesto

```json
{ "version": 1, "assets": [
  { "id": "char:corsaria", "src": "models/char-corsaria.glb", "looks": ["Exploradora"], "height": 1.8,
    "toon": { "posterize": 5, "sat": 1.1 } },
  { "id": "prop:barrel", "src": "models/prop-barrel.glb", "props": ["barrel"] },
  { "id": "ship:dock", "kind": "model", "src": "models/ship-dock.glb" },
  { "id": "tex:planks", "src": "textures/planks.webp", "repeat": [2, 2] }
] }
```

| Campo | Para | Qué hace |
|---|---|---|
| `id` | todos | Único, `tipo:nombre`. El tipo sale del prefijo (`char`, `prop`, `tex`); cualquier otro prefijo necesita `"kind": "model"` |
| `src` | todos | Ruta dentro de `assets/` |
| `rotY` | modelos | Grados sobre +Y antes de todo (glTF mira a +Z, igual que el juego). Un personaje con los lados al revés se gira solo |
| `scale`, `yOffset` | modelos | × extra después de ajustar; subir o bajar (u) |
| `toon.posterize` | modelos | 0 = no; si no, niveles de color (4–6 vuelve «pintada» una textura fotográfica) |
| `toon.sat`, `toon.bright` | modelos | × saturación, × valor del color |
| `toon.flat`, `toon.rim`, `toon.comic`, `toon.normal`, `toon.alphaTest` | modelos | Sombreado plano; borde de luz (personajes sí); trama de cómic (mundo sí, personajes no); usar su mapa de normales (no por defecto: el toon queda más limpio); corte de alfa |
| `looks` | char | Nombres de los aspectos que reemplaza (`LOOKS[].name` en `src/render/charlooks.js`: Corsario, Exploradora, Bucanero, Tormenta, Brasa, Capitana, Vendedora, Grumete ahogado, Desalmado, Desalmada…) |
| `height` | char | Altura en u (por defecto, la del aspecto) |
| `bones` | char | Si un hueso no se reconoce: `{ "head": "Craneo", "armL": "Brazo_I" }` (nuestros: hips, spine, chest, head, thighL, shinL, thighR, shinR, armL, foreL, armR, foreR) |
| `weapon` | char | `"proc"` (el arma procedural del aspecto en su mano derecha; pistolas en las dos) o `"none"` (si el modelo trae la suya) |
| `armsDown` | char | `false` si el modelo ya está con los brazos abajo y no quieres que se toque |
| `props` | prop | Tipos que reemplaza: hut, crate, barrel, stall, lantern, dockPost, brazier, pillar, gatePost, sign, campfire, rack, skullPost, palisade, blackFlag |
| `fit`, `size`, `height` | prop / model | `proc` (tamaño de la pieza procedural: lo normal), `height` (u), `size` (mayor medida horizontal, u), `none` |
| `repeat`, `data`, `filter` | tex | Repetición; `true` para mapas que no son color; `nearest` para pixel art |

## Ganchos que ya existen en el código

- Personajes: cualquier aspecto de `LOOKS` (jugadores, NPC y enemigos humanoides). `CharacterView` lo resuelve.
- Props: los 15 tipos de arriba (`createProps`).
- `ship:dock`: el barco del muelle (`createProps`).

**Añadir uno nuevo** (barcos de M6, edificios de M8, mercancías de M7…): donde el código construye la pieza,

```js
import { assets } from './assets/registry.js';
const obj = assets.model('build:taberna', { w: 8, h: 6 }) || construirTabernaProcedural();
```

y documentar el id en esta lista. Para muchas copias, `assets.instanced(id, matrices, target)`.

## Límites conocidos

- Humanoides solamente para personajes animados. Un monstruo sin rig humanoide entra como rígido (`bone`: el
  hueso que monta, `body` por defecto) o se queda procedural. Cuadrúpedos y cangrejos: procedurales por ahora.
- Los dedos, la cara y los huesos de ropa del modelo siguen a su hueso padre (sin animación propia).
- El arma procedural se lleva en las manos del modelo para los aspectos humanos con espada o pistolas. El arco del
  Arquero y la espada del Centinela no se trasladan: usa `weapon: "none"` y un modelo que traiga la suya.
- El despiece al morir usa el color de la textura muestreado por vértice.

## Licencias

Solo modelos con licencia para el juego (los de Meshy, según tu plan; CC0 / CC-BY citando en `notes`). No subas
al repo modelos de ejemplo de terceros sin licencia de redistribución.
