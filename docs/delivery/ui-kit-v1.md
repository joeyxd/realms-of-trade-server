# Kit de interfaz AAA y pantalla de personaje (ui-kit-v1)

Fecha: 2026-10-10. Estado: **candidato local, sin commit ni push**. Pendiente de revisión del autor.

Continúa [crafting-ui-v1](crafting-ui-v1.md). El estilo pintado del menú de fabricación (placas navy desgastadas,
pincelada naranja, Barlow condensada en itálica mayúscula) pasa a ser un **kit compartido** y se aplica al resto
de la interfaz. La pantalla de personaje se rehace sobre la segunda referencia del autor (Character / Inventory /
Skills / Journal). Textos nuevos en **español e inglés**.

## Decisiones del autor (2026-10-10)

- **Hacha y pico de piedra a mano con troncos, 3 + 2:** `tronco: 3, piedra: 2`, `hand: true` en las dos recetas;
  ya no hace falta el banco para empezar. Madera sigue en el banco. **Confirmado por el autor:** el pico es la
  herramienta más básica, a mano y con el mismo coste.
- **"Por descubrir" con nombres de la referencia:** Antorcha, Arpón de pesca, Cuerda (herramientas), Lanza tosca,
  Arco de madera, Flechas ×5 (armas) y Fogata (supervivencia) aparecen como filas bloqueadas con icono atenuado.
  Son visuales: no existen sus recetas ni sus efectos.
- **Móvil:** el inventario del menú de fabricación pasa a ser un cajón que se abre/cierra desde la cabecera.
- **Mochila:** 10 es demasiado poco. `PACK_CAP` sube a **20** como puente; la dirección completa (15–20 huecos
  con pilas, bolsas/cinturones, peso tipo ARK, comida/agua, comidas especiales) queda escrita en
  [PLAN-PROGRESSION §15](../../PLAN-PROGRESSION.md#15-mochila-por-huecos-peso-y-necesidades) con cortes INV01–03 y
  SRV01–02 y sus decisiones abiertas. No se implementó nada de §15 más allá del puente.

## Qué cambia para el jugador

- **Pantalla de personaje** (C; I abre Inventario; T/L/P las demás pestañas; en táctil el botón de mochila):
  pestañas Personaje / Inventario / Habilidades / Diario / Perlas con pincelada en la activa; detalles del
  personaje (nombre, nivel y XP, clase con descripción, Salud / Aguante / Carga en vivo, atributos con barras y
  "Ver todos"); figura 3D a cuerpo completo que se gira arrastrando, con zoom de rueda, restablecer y tres vistas;
  equipo (cabeza, pecho, botas, mochila, arma, 2 abalorios, pociones), cinturón de herramientas y oro;
  detalles del objeto con rareza, icono pintado, estadísticas en dos columnas con comparación ▲/▼, valor y
  Equipar / Desguazar / Quitar; al tocar un hueco salen los objetos de la bolsa que encajan; acceso rápido de 8
  y atajos ESC / doble clic. Inventario: bolsa de equipo (24) y mochila de mercancías con su cupo y cinturón.
  Habilidades, Diario, Perlas y "Ver todos" reutilizan los cuerpos de `CharPanel` en una placa ancha retintada.
  El HUD se oculta detrás de la hoja.
- **Retema global:** tokens de `vars.css` (navy, naranja, cielo; Barlow), botones de pincelada, placas 9-slice
  del kit en `.frame`. Retintados a navy los morados fijos de HUD, paneles, cuenta, wallet y título. Mercado y
  producción (`commerce.css`), menú de pausa y diálogo con NPC pasan al kit.
- La lista de misiones del HUD empieza bajo el minimapa (antes lo tapaba) en pantallas de más de 480 px de alto.

## Archivos

| Archivo | Cambio |
|---|---|
| `styles/kit.css`, `src/ui/kit.js` | Nuevos: tokens, placa/pincelada/teclas/huecos/barras, atlas de iconos, iconos de línea, utilidades ES/EN |
| `styles/character.css`, `src/ui/characterScreen.js` | Nuevos: `CharacterScreen extends CharPanel`; unidad `--u` = 1 px de la referencia 1672×941; móvil en 3 columnas |
| `src/render/characters.js` | `PortraitStudio.renderFigure` (cuerpo completo con giro/zoom); `render()` sin cambio de resultado |
| `src/main.js` | Construye `CharacterScreen` con `vitals`, `figure`, `slots` (líneas puntuales; archivo compartido) |
| `index.html` | Pesos Barlow 900/800, enlaces `kit.css` y `character.css` |
| `styles/vars.css` | Tokens y componentes base al kit |
| `styles/hud.css`, `panels.css`, `account.css`, `wallet.css`, `title.css`, `commerce.css` | Retintado navy, pausa/diálogo/mercado al kit, lista de misiones bajo el minimapa |
| `src/ui/workbench.js`, `craftingCatalog.js`, `styles/workbench.css` | Recetas "Por descubrir" con nombre, cajón de inventario móvil, recursos del kit |
| `src/data/resources.js`, `src/sim/economy/cargo.js` | Hacha y pico a mano 3 troncos + 2 piedras; `PACK_CAP` 20 |
| `tests/harvest-tools`, `tools-ui`, `economy`, `commerce`, `raft-editor`, `raft-capacity-server` | Recetas nuevas y fixtures de capacidad relativas a `PACK_CAP` |
| `tools/qa-character.mjs`, `tools/qa-ui-tour.mjs`, `tools/qa-crafting.mjs` | QA Playwright de personaje, recorrido de pantallas y crafteo actualizado |
| `tools/crafting-ui/textures.py`, `icons.py`, `gen-kit-sheets.ps1` | Kit en `assets/ui/kit`, recorte por color de fondo de cada celda, prompts de las hojas D/E; `--singles` exporta cada icono en PNG |
| `PLAN-PROGRESSION.md` (§15 y aviso en cabecera), `PLAN-ALFA-MUNDO.md` | Dirección de inventario/peso/necesidades; nota del puente `PACK_CAP` |

No cambian snapshot, `you` ni protocolo (`PROTOCOL_VERSION` intacto). El perfil solo cambia por `PACK_CAP`, que
`sanitizeHold` ya migra.

## Arte y presupuesto móvil

Runtime en `assets/ui/kit/` (WebP; variante `-mobile` con `(pointer: coarse), (max-width: 760px)`); los héroes
de recetas siguen en `assets/ui/crafting/`.

| Recurso | Escritorio | Móvil | Origen |
|---|---:|---:|---|
| `frame` 9-slice, `brush`, `brush-clean` | 8 / 20 / 12 KB | 8 / 16 / 12 KB | Procedural (`textures.py`) |
| `items` 6×4 | 140 KB | 48 KB | Higgsfield Nano Banana Pro, hojas A–C (crafting-ui-v1) |
| `gear` 5×4 (sable, daga, ancla, chispa, duelo, trabuco, pañuelo, tricornio, sombrero, chaleco, casaca, coraza, botas, altas, viento, anillo, diente, brújula, amuleto, moneda) | 132 KB | 48 KB | Higgsfield, hoja D |
| `misc` 4×4 (antorcha, lanza, arpón, cuerda, arco, flechas, fogata, poción, cajas, mochila, cinturón, oro, mapa, diario) | 104 KB | 36 KB | Higgsfield, hoja E |

Originales en `docs/art/ui-kit-v1/source/sheet-d.png` y `sheet-e.png`; prompts en
`tools/crafting-ui/gen-kit-sheets.ps1` (los ID de job no se conservaron). **La cuenta de Higgsfield quedó con 0
créditos**: más iconos o retratos requieren recarga.

## Inventario Unreal/FAB (cruce obligatorio)

- `SimpleMultiplayerSurvival/Content/Dreamrise_SMSK`: `W_InventoryScreen`, `W_SimpleInventorySystem_InventoryItem`,
  `W_SimpleInventorySystem_UIWeaponSlot` (UMG) y `T_WaterBottle`/`T_Food_UI`. **Descartados** para el runtime:
  widgets no ejecutables en navegador y texturas que exigen exportación y no siguen el estilo pintado. Su flujo
  de comida/salud/aguante se registró como referencia en PLAN-PROGRESSION §15.8.
- `ActionRPGMultiplayerStart`: `Skills/S_PlayerStats`, `BP_MainSkill` e `InventorySystem` siguen siendo referencia de
  UX para atributos e inventario; nada importable. Fuentes intactas, sin assets nuevos desde Unreal.

## Evidencia

- `node tools/qa-character.mjs`: aprobado en 1280×720, 1920×1080, 844×390 y 390×844 (escenario rotado). Abre la
  hoja, comprueba que la figura 3D pinta píxeles, gira y hace zoom, muestra el hueco de cabeza con candidatos,
  equipa un objeto (confirmado en el servidor), cambia a inglés, recorre las 5 pestañas y "Ver todos", y verifica
  que todo queda en pantalla. Capturas `docs/delivery/ui-kit-v1/<viewport>-NN-*.png`.
- `node tools/qa-ui-tour.mjs`: título, HUD, mapa, diálogo con NPC, mercado, chat y pausa en 1280×720 y 844×390,
  sin errores de consola. Capturas en `docs/delivery/ui-kit-v1/tour/`.
- `node tools/qa-crafting.mjs`: aprobado en los 4 viewports con las recetas nuevas: hacha y pico a mano lejos del
  banco, Madera bloqueada lejos del banco y fabricación real (3 troncos y 2 piedras consumidos en el servidor).
  En móvil abre y cierra el cajón de inventario (`01b-inventory-drawer`).
- `npm test` (final): 3623 de 3641 pasan, 13 fallan. Los 5 fallos que causó `PACK_CAP` (commerce,
  raft-editor, raft-capacity-server) se corrigieron con fixtures relativas a `PACK_CAP`. De los 13 que quedan,
  11 son de red y tiempo (WS real, agentes, CLI, lanzador PC, recuperación de procesos, red a 100 ms): pasan
  55/56 solos y el restante, `agent-pilot`, pasa 9/9 por separado. Los otros 2 (`pearl-no-sale`,
  `pearl-command-access`) esperan el HTML de toast anterior al cambio en curso de i18n (`data-l10n-html`) de otro
  agente; no tocan archivos de este corte.

## Trabajo concurrente

Otro agente trabaja en la localización (`src/core/i18n.js`, `src/i18n/*`, `charpanel.js`, `rewards.js`,
`styles/i18n.css`). Para no pisarlo, la hoja nueva hereda de `CharPanel` sin editarlo. Ese agente también editó
`characterScreen.js` (nombres de objeto con `translateData`); se conservó. Durante la QA, `charpanel.js` tuvo un
`skillId` sin importar que vaciaba Habilidades; lo resolvió su autor y la QA final pasa. Los agentes GPT-6 Luna
no están disponibles en este entorno; todo el trabajo se hizo en esta sesión.

## Abierto para el autor

1. ~~Confirmar el pico a mano con el mismo coste del hacha.~~ Confirmado el 2026-10-10.
2. Habilidades, Diario y Perlas usan todavía la maqueta anterior dentro de la placa nueva. **El autor quiere
   rediseñarlas** (más gráficas y dinámicas) y preparará imágenes de referencia; el corte espera a esas imágenes.
3. La barra de acceso rápido es informativa (refleja las teclas); asignar objetos a 1–8 llega con INV01.
4. Las decisiones de PLAN-PROGRESSION §15.7 (huecos exactos, peso, sobrecarga, ritmos de hambre/sed, muerte).

**Arte desde 2026-10-10:** sin créditos en Higgsfield ni en la API de Tripo. Las imágenes nuevas se generan con
GPT Image 2.5 desde la cuenta del autor y las mallas en Tripo Studio. La guía
[tripo-items-v1](../art/tripo-items-v1.md) recoge dónde están los iconos sueltos (`.scratch/tripo-icons`, con
`icons.py --singles`), los triángulos por tipo de pieza, los ajustes de Tripo y los prompts.
