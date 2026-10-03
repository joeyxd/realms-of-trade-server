# PLAN M4.6 — «Tinta»: el móvil en horizontal con botones nuevos, y un pase gráfico de cómic

> Documento de traspaso. Si la sesión se corta, cualquier modelo puede seguir desde la primera casilla `[ ]`
> sin leer el historial. Cada paso termina con tests en verde + commit + push. Marca `[x]` al terminar.
> Base: M4.5 terminado (`PLAN-M4.5.md`, 143 tests en verde, versión `0.4.5-m4.5`).

## 0. Contexto mínimo (leer primero)

- Repo `joeyxd/realms-of-trade-server`, rama **`claude/loving-lovelace-ptbif7`** (PR #1 abierto: no abrir otro).
- Juego «MAREA NEGRA»: ARPG isométrico toon (bullet hell), Three.js 0.160 (CDN), sim determinista y servidor
  autoritativo (`src/net/localServer.js`). Este hito **no toca la simulación**: todo es cliente (render, CSS, UI).
- Petición del autor (tras probar M4.5 en el teléfono): «forzar horizontal; organizar y mejorar los botones,
  transparentes, con colores, bien organizados por tamaño y utilidad» y «un pase gráfico: texturas más
  complejas, estilo cómic / Borderlands, caricaturesco pero muy chulo, con contornos y sombras de cómic»,
  con capturas de **Hades** como referencia.
- Tests: `npm test`. **Nunca** empujar en rojo. Capturas: `tools/shot.mjs` (en el contenedor:
  `MN_LIBS=<scratchpad>/libs`).
- Artefacto (solo): `node tools/build-artifact.mjs dist/index.html` → republicar en la MISMA URL
  https://claude.ai/artifact/MpCdPMbgw41nJKcf8NvSrD (antes `Artifact list scope:"files"`).
- Commits terminan con:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Md1KNYppmXci5NXt42VucC
  ```
  Sin IDs de modelo en commits/código. Push: `git push -u origin claude/loving-lovelace-ptbif7`.
- Respuesta final al usuario **en español**, con enlaces al PR #1 y al artefacto.

### Reglas
1. Nada de esto cambia la sim ni el protocolo (los 143 tests siguen igual; se añaden los del cliente).
2. Rendimiento: el móvil arranca en `medium`. Lo nuevo en los shaders son pocas operaciones y lecturas de la
   textura de ruido que ya existe (`mnNoiseTex`); nada de texturas de imagen nuevas ni pasadas nuevas a
   pantalla completa. `low` sigue sin contornos de post-proceso.
3. Comentarios en inglés, UI en español, números en `src/data/*` o en las constantes de cada módulo.

## 1. Objetivo

**Móvil**: el juego se ve siempre en horizontal. Si el teléfono está en vertical (o con el giro bloqueado), el
juego entero se dibuja girado 90° para jugar con el teléfono de lado; al tocar «Jugar» se pide pantalla completa
y bloqueo horizontal donde el navegador lo permite. Los botones táctiles se rehacen: cristal translúcido con
color por función, iconos, tamaños por importancia y un arco ordenado alrededor del pulgar.

**Tinta**: el mundo pasa de «toon plano» a «cómic pintado»: contornos de tinta con grosor (siluetas gruesas,
pliegues finos, personajes más marcados), sombras duras y teñidas con **trama** (hatching) en lo oscuro y una
línea de tinta en el borde de las sombras proyectadas, y superficies con detalle pintado (arena con ondas y
punteado, hierba a pinceladas, losas entintadas, grietas en la roca, vetas en la madera, baldosas de la
Caldera con junta de tinta y greca), con un etalonaje más contrastado y saturado como Hades.

## 2. Especificación

### 2.1 El escenario girado (P1)
- `index.html`: `#game`, `#ui` y `#fade` dentro de un `<div id="stage">` (`position: fixed`, contenedor de
  consultas `container-type: size; container-name: stage`).
- `src/ui/stage.js` (nuevo): `stage.w / stage.h` (tamaño lógico, ya girado), `stage.rotated`,
  `stage.toLocal(clientX, clientY)` y `stage.vec(dx, dy)` (deltas de puntero en el marco del escenario),
  `stage.update()` en `resize` / `orientationchange`. Mapeo puro y testeable (`rotPoint`, `rotDelta`):
  girado 90° en sentido horario, `local = (clientY, W − clientX)`, delta `(dy, −dx)`.
- Se gira cuando: dispositivo táctil, `settings.landscape` (por defecto sí) y la ventana es vertical.
  `body.rotated` → `#stage { width: 100vh; height: 100vw; transform: translateX(100vw) rotate(90deg) }`
  (`transform-origin: 0 0`) y las variables `--safe-*` se rotan con él.
- Todo lo que medía la ventana mide el escenario: `scene.onResize`, `worldUI.resize`, `input.mouse`, la
  proyección del ratón en `main.js`, el joystick y el arrastre de habilidades (`touch.js`).
- CSS: `@media (max-width|max-height …)` → `@container stage (…)`; `vw / vh` → `cqw / cqh`.
- Al tocar «Jugar» en táctil: `requestFullscreen()` + `screen.orientation.lock('landscape')`, ambos con
  `catch` (iOS e iframes los rechazan: entonces manda el giro por CSS).
- Ajustes → Controles: «Forzar horizontal (móvil)».

### 2.2 Botones táctiles v2 (P2)
- Cristal: fondo `rgba(color, 0.18–0.28)` + `backdrop-filter: blur(3px)` donde exista, borde de 2.5 px del
  color al 85 %, icono SVG blanco con contorno de tinta y etiqueta corta debajo; pulsado = más opaco y
  `scale(0.92)`. Colores por función: **ataque** rojo-naranja, **defensa** azul, **movilidad** turquesa,
  **habilidades** violeta, **definitiva (R)** dorado, **poción** rosa-rojo, **acción** ámbar.
- Tamaños (escala `--tb`, 1 = mediano): ATK 92 px · DASH 70 · GUARDIA 62 · Q / E 58 · R 54 · poción 48 ·
  acción 64 (solo cuando hay algo con que interactuar, con su verbo: «Abrir», «Hablar», «Coger»…).
- Disposición (abajo a la derecha, arco alrededor de ATK): ATK en la esquina; DASH a su izquierda abajo;
  GUARDIA encima; Q, E, R en arco por la parte superior izquierda; poción aparte, a la izquierda del arco;
  la acción por encima del arco. Joystick a la izquierda con un aro de reposo tenue donde aparecerá.
- Ajustes → Controles: «Tamaño de los botones» (pequeño 0.85, mediano 1, grande 1.18).
- HUD en horizontal bajo (altura de escenario ≤ 480): el seguidor de misiones se pliega a una línea, las
  barras y el retrato se compactan, los toasts no tapan el arco.

### 2.3 Tinta: contornos (P3)
- La pasada de normales escribe en alfa el **peso de línea** del material: mundo 0.5, personajes 1.
- `COMPOSITE_FRAG`: siluetas (saltos de profundidad) con radio doble donde el peso del vecindario es 1
  (personajes, enemigos, PNJ), radio 1.5× en las siluetas del mundo; pliegues de normales con radio 1.
  Tinta más oscura (`outlineColor` 0x120a24) y algo más opaca a media distancia.

### 2.4 Tinta: sombras de cómic (P4)
- `mnBand`: dos tonos más duros (menos bandas intermedias), sombra más profunda y teñida (`mnShadowTint`).
- **Trama**: en las superficies del mundo, donde la luz del sol no llega (banda oscura o sombra proyectada),
  líneas de tinta diagonales en espacio de mundo (triplanar por la normal), cruzadas en lo más oscuro;
  antialias con `fwidth`, se desvanecen con la distancia y no se dibujan en el agua ni en la lava.
- **Borde de sombra**: una línea fina de tinta donde la sombra proyectada empieza (`fwidth` del factor de
  sombra).
- Personajes: banda menos suave (más «dos tonos»), rim más fuerte; sin trama (son pequeños en pantalla).
- `opts.comic` (por defecto activado en el mundo) para poder apagarlo por material.

### 2.5 Tinta: superficies pintadas (P5)
- Terreno: arena con ondas de viento entintadas y punteado, hierba en manchas con pinceladas y pequeñas marcas,
  losas del sendero con junta de tinta, grietas en la roca de las laderas, baldosas de la Caldera con junta
  de tinta y una greca en el anillo exterior del suelo de la arena.
- Props: vetas en la madera (tonos marrones), bloques en la piedra (grises), según el color del vértice.
- Rocas: grietas entintadas. Palmeras: anillos del tronco. Arbustos: pinceladas.

### 2.6 Etalonaje y cierre (P6)
- Presets (`lighting.js`): más contraste, saturación y viñeta (día, dorado, noche, volcánico).
- Medir FPS antes / después en `medium` y `low` (swiftshader solo compara), capturas de antes y después.
- README / DESIGN (§ arte, § móvil), versión `0.4.6-m4.6`, artefacto, informe.

## 3. Pasos

- [x] **P0** Este plan.
- [x] **P1** El escenario girado (2.1) + test del mapeo.
- [x] **P2** Botones táctiles v2 y HUD horizontal (2.2).
- [ ] **P3** Contornos de tinta (2.3).
- [ ] **P4** Sombras de cómic (2.4).
- [ ] **P5** Superficies pintadas (2.5).
- [ ] **P6** Etalonaje, rendimiento, capturas, docs, versión, artefacto, informe (2.6).

## 4. Notas de ejecución

(se rellenan al terminar cada paso)

- **Método (desde P1)**: cada paso lo construye un asistente con un encargo cerrado (archivos, valores, criterios,
  sin commit); el autor principal revisa el diff y las capturas, corrige, mejora y hace el commit.
- **P1**: `src/ui/stage.js` (`rotPoint`, `rotDelta`, `stage.w/h/rotated/toLocal/vec/onChange/update`), `#stage`
  con `container-type: size` (contención de layout: es el bloque contenedor de los `fixed` en los dos modos),
  `body.rotated` rota las `--safe-*`. Todo `@media` de tamaño → `@container stage`, `vw/vh` → `cqw/cqh`.
  Renderer, cámara, `worldUI`, ratón, joystick y arrastre de Q/E/R miden el escenario; el velo de «conexión
  perdida» se cuelga del escenario; `charpanel.reveal` usa `stage.w`. Ajustes: «Forzar horizontal (móvil)».
  Al «Jugar» en táctil: pantalla completa + bloqueo horizontal (si el navegador deja, el escenario se des-gira
  solo). Comprobado en 390×844 (girado: lienzo 844×390, un deslizamiento físico hacia arriba mueve a la
  izquierda del escenario) y 844×390. 149 tests.
- **P2**: `touch.js` reescrito sobre el joystick y el arrastre de P1: 17 iconos SVG de línea (trazo blanco sobre
  trazo de tinta), kits por arma (sable ATK / ESTOC / HOJA / TORM; pistolas FUEGO / DESC / HUMO / LLUVIA), cristal
  con `--c` por función, `.on` al pulsar, `.ready-flash` al acabar un enfriamiento, R con pulso dorado, candado
  en lo bloqueado, botón de acción contextual con su verbo (Hablar, Abrir, Marea, Cambiar, Zarpar) y la «F» fuera
  del aviso en táctil. `--tb` = ajuste × auto (`stage.h / 420`, entre 0.78 y 1.15), con tope `(stage.h − 72) / 310`
  para que «Grande» no suba la acción hasta los botones de arriba. HUD con escenario ≤ 480 de alto: seguidor en
  una línea bajo el retrato, toasts debajo (máx. 3). Extra: vibración corta (dash, guardia, poción, acción; más
  fuerte al lanzar Q / E / R) con «Vibración (móvil)» en Ajustes. 149 tests.
