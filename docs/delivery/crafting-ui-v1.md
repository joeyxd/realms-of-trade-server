# Menú de fabricación AAA (crafting-ui-v1)

Fecha: 2026-10-10. Estado: **candidato local, sin commit ni push**. Pendiente de revisión del autor.

**Actualización 2026-10-10:** el autor respondió las preguntas de abajo; ver [ui-kit-v1](ui-kit-v1.md). Hacha y pico
a mano con 3 troncos + 2 piedras, "Por descubrir" con nombres de la referencia, inventario conmutable en móvil y
`PACK_CAP` 20. Texturas y atlas se movieron a `assets/ui/kit/`. Lo que sigue describe el primer corte.

Rediseño del banco de materiales siguiendo la imagen de referencia del autor: panel azul marino desgastado, pestañas
por categoría, lista de recetas, detalle con ilustración grande, materiales → resultado, estadísticas base, botón
de pincelada naranja `[E] FABRICAR OBJETO` e inventario lateral. Textos en **español e inglés**.

## Qué cambia para el jugador

- **TAB** abre/cierra el menú en cualquier lugar a pie (también el botón de martillo del HUD en táctil).
  **E** fabrica la receta seleccionada mientras el menú está abierto. F en el banco lo abre en la receta Madera.
- **Hacha de piedra a mano** (sugerencia del autor: "chance no necesita mesa de trabajo"): flag `hand: true` en
  `CRAFT_RECIPES.hacha_piedra`; el servidor omite solo la comprobación de banco para esa receta y conserva vida,
  calma, tierra firme, inmovilidad, revisión y materiales. Pico y Madera siguen requiriendo el banco.
- Costes **sin cambios** (hacha 1 madera + 1 piedra). La referencia muestra 3 + 2; no se tocó el balance.
- Categorías Armas / Supervivencia / Comida sin recetas muestran filas "Por descubrir" y un estado vacío; no se
  inventaron recetas nuevas. Madera vive en Construcción.
- Estadísticas con datos reales de `RESOURCE_KINDS`/`GOODS` (troncos y golpes por palmera, ritmo de tala, etc.).
- Inventario real de la mochila (volumen usado/capacidad), resalta los materiales de la receta, y cinturón
  (hacha/pico) en el pie del panel.

## Archivos

| Archivo | Cambio |
|---|---|
| `src/ui/workbench.js` | Panel reescrito; conserva `workbenchPreview`, `craftAcknowledgementMatches`, reintento y selectores usados por tests |
| `src/ui/craftingCatalog.js` | Nuevo: textos ES/EN por clave, categorías, copy y estadísticas por receta, iconos de línea, atlas |
| `styles/workbench.css` | Nuevo estilo; unidad `--u` = 1 px de la referencia escalado al escenario; móvil horizontal con botón fijo |
| `src/data/resources.js`, `src/sim/systems/resources.js` | Flag `hand` y omisión del banco solo para recetas a mano |
| `src/main.js` | TAB, F→Madera, botón HUD (líneas puntuales; archivo compartido) |
| `src/ui/hud.js` | Botón `#hud-craft` |
| `index.html` | Barlow Condensed / Barlow Semi Condensed añadidas a la línea existente de Google Fonts |
| `tests/harvest-tools.test.mjs` | Prueba: hacha a mano lejos del banco, pico sigue `far`, calma exigida, sesión sin banco |
| `tools/qa-crafting.mjs` | QA Playwright (4 viewports, ES/EN, fabricación real en servidor efímero) |
| `tools/crafting-ui/textures.py`, `icons.py` | Generadores reproducibles de marco/pincelada y recorte del atlas |

No cambian perfil, snapshot, `you` ni protocolo (`PROTOCOL_VERSION` intacto).

## Arte y presupuesto móvil

Runtime en `assets/ui/crafting/` (WebP, variante `-mobile` elegida con `(pointer: coarse), (max-width: 760px)`):

| Recurso | Escritorio | Móvil | Origen |
|---|---:|---:|---|
| `frame` 9-slice | 7 KB | 5 KB | Procedural (`textures.py`) |
| `brush`, `brush-clean` | 20 KB c/u | 13 KB c/u | Procedural |
| `items` atlas 6×4 (23 iconos) | 142 KB | 48 KB | Higgsfield Nano Banana Pro |
| `hero-hacha_piedra/pico_piedra/madera` | 34–55 KB | 12–18 KB | Higgsfield Nano Banana Pro |

Originales PNG (fuera del bundle) en `docs/art/crafting-ui-v1/source/` (`sheet-a/b/c.png`). Fondo magenta plano,
recortado con despill en `icons.py`. Jobs Higgsfield 2026-10-10: `0f4d6b35…` (hoja A; prompt truncado por el
envoltorio `.cmd`, se aprovecharon hacha, tablas, fruta, pescado, cantimplora), `b7fec896…` (hoja B, 16 mercancías),
`49696247…` (hoja C, 3 ilustraciones + coral + perlas). Estilo: pintado semirrealista con contorno de tinta.

## Inventario Unreal/FAB (cruce obligatorio)

- `survival/…/Textures/Icons/Items/T_*.uasset` (T_Log, T_Hammer, T_Bread…): **descartado** en este corte; requiere
  exportar desde Unreal, cubre 2–3 mercancías y no coincide con el estilo pintado de la referencia.
- `ActionRPGStarterSystem/InventorySystem/Crafting/*` (BP_CraftingWidget, CraftingItems…): UMG/Blueprint, no
  ejecutable en navegador; solo referencia de UX. **Descartado.**

## Evidencia

- `node --test tests/harvest-tools.test.mjs tests/workbench-batch.test.mjs tests/tools-ui.test.mjs`: 22/22.
- Suite completa: 3535/3545; los 4 fallos (agent-goals-network, agent-lifecycle, agent-memory-recovery,
  agent-network/agent-pilot) pasan 42/42 al ejecutarse solos: carga/tiempo de la suite paralela en archivos con
  cambios ajenos, no relacionados con este corte.
- `node tools/qa-crafting.mjs`: aprobado en 1280×720, 1920×1080, 844×390 y 390×844 (escenario rotado).
  Capturas en `docs/delivery/crafting-ui-v1/`: hacha ES/EN, pico bloqueado lejos del banco, pestaña vacía,
  hacha fabricada (servidor: `tools.axe = 1`, revisión +1, materiales consumidos) y Madera por tandas en el banco.
- `tools/qa-workbench.mjs` (d08c7b) ya consultaba selectores inexistentes (`[data-owned]`); queda sustituido por
  `qa-crafting.mjs`.

## Abierto para el autor

1. Aceptar o revertir el hacha a mano (una línea: `hand: true`).
2. ¿Coste del hacha como la referencia (3 madera + 2 piedra) o con troncos en vez de madera? Hoy necesita madera,
   que solo sale del banco.
3. ¿Nombres de recetas futuras (antorcha, lanza, cuerda, arco…) visibles como "próximamente" en vez de "Por descubrir"?
4. Móvil horizontal oculta el inventario lateral por espacio.
