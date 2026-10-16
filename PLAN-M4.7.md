# PLAN M4.7 — «Tatuajes»: habilidades equipables (Tromba, Abordaje, Timón) y el cómic Ultra

> Documento de traspaso. Si la sesión se corta, cualquier modelo puede seguir desde la primera casilla `[ ]`
> sin leer el historial. Cada paso termina con tests en verde + commit + push. Marca `[x]` al terminar.
> Base: M4.6 terminado (`PLAN-M4.6.md`, 149 tests en verde, versión `0.4.6-m4.6`).

## 0. Contexto mínimo (leer primero)

- Repo `joeyxd/realms-of-trade-server`, rama **`claude/loving-lovelace-ptbif7`** (PR #1 abierto: no abrir otro).
- Juego «MAREA NEGRA»: ARPG isométrico toon (bullet hell), Three.js 0.160 (CDN), sim determinista compartida
  por el servidor autoritativo (`src/net/localServer.js`, Worker en solo, Node en línea) y la predicción del cliente.
- Petición del autor: (1) «si tenemos GPU, la opción de que el efecto cómic sea ultra dramático»; (2) tres
  habilidades: un **área en el suelo tipo MOBA** con marca tipo RTS que se lanza como un mago a distancia, un
  **salto o blink** que cae más adelante golpeando, y un **proyectil que regresa**, rápido o lento según cuánto
  mantengas; (3) que las habilidades **se equipen** (no fijas al personaje ni como Albion), que suban de nivel y
  que cambiar de estilo sea fácil; (4) más adelante, zonas con partidas tipo MOBA (§2.7, aparcado).
- Método: el autor principal escribe este plan y los encargos; asistentes construyen la base de cada paso; el
  autor revisa, corrige y pule. Tests: `npm test`. **Nunca** empujar en rojo.
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
1. Sin cambiar nada en la carga por defecto: un pirata sin tatuajes juega el kit de M4.6 (sable Q Estocada,
   E Hoja de viento; pistolas Q Descarga, E Paso de humo; R del arma). Los tests de M3.5/M4 siguen igual.
2. Todo lo que toca balas hostiles va en `stepPlayerCombat` (compartido, predicho); los golpes a enemigos solo
   en el servidor (`world.*Hits`), como las habilidades de M3.5. Estado nuevo que se predice → `PLAYER_FIELDS`.
3. El Ultra solo se paga en `ultra`: `low`/`medium`/`high` cuestan lo mismo que en M4.6.
4. Comentarios en inglés, UI en español, números en `src/data/*`.

## 1. Diseño: dónde viven las habilidades (la decisión)

| Opción | A favor | En contra |
|---|---|---|
| En el arma (hoy, Albion) | identidad clara por arma | cambiar de estilo = otra arma y otra maestría desde cero; pocas combinaciones |
| Árbol de talentos | progresión profunda | te ata al personaje (respec caro), mucha UI, mal en móvil |
| **Tatuajes equipables** (elegida) | eliges 2 de un repertorio; el progreso es de cada tatuaje (cambiar no pierde nada); botín y oro con sentido; encaja con las zonas MOBA | más combinaciones que equilibrar |

- **Huecos**: Q y E son libres. El arma da LMB, la R (definitiva, con el RIPOSTE lleno) y sus **artes**
  (Estocada, Hoja de viento / Descarga, Paso de humo), que se equipan en Q/E solo con esa arma. Los
  **tatuajes** valen con cualquier arma. Una carga por arma: al cambiar de arma en el armero vuelve la suya.
- **Aprender**: Doña Sepia, la tatuadora de la aldea (nueva PNJ): el primer tatuaje gratis, los demás 150 oro.
- **Rangos I–V** por tatuaje («tinta»): toda la XP que ganas con él equipado, como la maestría. Cada rango
  +6 % de daño. **Formas** (variantes): A en el rango II, B en el IV; se elige gratis en cualquier momento.
  Recuperación: si su rango es menor que (tu mejor tatuaje − 1), XP × 2 (probar un estilo nuevo no es grind).
- **Cambiar** la carga o la forma: en cualquier sitio fuera de combate (sin daño recibido en 3 s, sin estar
  lanzando, nunca dentro de la Cala sin ley); el hueco cambiado queda con enfriamiento ≥ 4 s.

## 2. Especificación

### 2.1 Cómic Ultra (P1, solo cliente)
- `src/render/gpu.js` (nuevo): `classifyGpu(name, mobile)` puro (`weak` | `mid` | `strong`) y `gpuInfo(renderer)`
  con `WEBGL_debug_renderer_info`. `weak`: swiftshader, llvmpipe, software, Basic Render, Mali-4xx/T, Adreno
  ≤ 5xx, PowerVR, Intel HD. `strong`: NVIDIA GeForce/RTX/GTX/Quadro, AMD Radeon RX/Pro, Intel Arc, Apple M (o
  «Apple GPU» en escritorio), Adreno ≥ 730. Resto `mid`.
- `quality.js`: `TIERS = ['low', 'medium', 'high', 'ultra']`; `ultra` = `high` + `ink: 2`, `comic: 1`,
  `outlineMul: 1.3`. AUTO arranca en `ultra` con GPU `strong` y sin táctil; si baja de 45 fps, baja a `high`.
- Ajustes: «Ultra · cómic dramático» en Calidad gráfica, debajo «GPU: <nombre> · potente / media / básica».
  Ajuste nuevo `comicFx` «Efectos de cómic (impactos, onomatopeyas)», por defecto sí (solo actúa en Ultra).
- Sombras (`toon.js`, `mnInk` = 2): banda profunda 0.36 → 0.20, media 0.70 → 0.62 (personajes 0.26); trama más
  densa (período 0.40 → 0.30 u, trazo × 1.35, cruzada desde 0.55 en vez de 0.8, tinta 0.42 → 0.30, se apaga a
  60 → 100 u); **semitono** (puntos Ben-Day) en espacio de mundo en la transición luz → sombra (`mnDark`
  0.05–0.6), celda 0.22 u a 45°, radio ∝ √tono, color de la superficie × 0.55 hacia `mnShadowTint`.
  Rim de personajes 1.1 → 1.5.
- Contornos (`pipeline.js`): `uThick` × 1.3, pliegues 0.5 → 0.7, el mundo se desvanece a 140 → 320.
- Pasada final: +0.08 contraste y saturación; viñeta hacia la tinta (no a negro); grano de papel 2.5 %;
  **viñeta de impacto** (`uImpact`: 2 fotogramas en tinta y papel con el color del golpe, como mucho una cada
  0.4 s) y **líneas de velocidad** radiales (`uLines`, 0.3 s) desde el punto del golpe.
- **Onomatopeyas** (DOM, `worldui`): «¡ZAS!» (3.er tajo), «¡CRAC!» (crítico), «¡CLANG!» (guardia perfecta),
  «¡PING!» (EXCELENTE), «¡CHOF!» (Tromba), «¡BUM!» (Abordaje), «¡ZUM!» (Timón cargado), «¡FUAAA!» (Tormenta),
  «¡RA-TA-TA!» (Lluvia), «¡KABUM!» (jefe o élite caído). Tinta gruesa, giro ± 8°, estallido de cómic detrás en
  las grandes, ≤ 3 a la vez, ≤ 1 cada 0.25 s. Solo lo tuyo y lo del jefe. `reducedMotion`: ni viñetas de impacto
  ni líneas.

### 2.2 Huecos y cargas (P2, sim)
- `src/data/tattoos.js` (nuevo): `SKILL_IDS` (orden fijo: `lunge, wave, blast, blink, tromba, leap, wheel`),
  `ARTS` (arte → arma y maestría mínima: lunge/sable 1, wave/sable 2, blast/pistolas 1, blink/pistolas 2),
  `TATTOOS` (tromba, leap, wheel: nombre, pista, tipo de lanzamiento `ground` | `dir` | `charge`, precio, formas),
  `TATTOO` (rangos: XP `[120, 360, 900, 2000]` hasta II…V, `dmg` 0.06, `catchUp` 2, `swapCd` 4, `calm` 3,
  `firstFree` true, `price` 150), `DEFAULT_LOADOUT` (sable `['lunge', 'wave']`, pistolas `['blast', 'blink']`).
- Perfil: `p.sk = { has: { id: [rango, xp, forma] }, lo: [[q, e] por arma] }` (sin subir `PROFILE_VERSION`:
  `sanitizeProfile` rellena lo que falte).
- ECS: `skQ`, `skE` (índice en `SKILL_IDS`), `fmQ`, `fmE` (forma 0–2), `rkQ`, `rkE` (rango 1–5; artes 1),
  `chQ`, `chE` (cargas para «Gemelas»). `refreshStats` los rellena desde el perfil; sin perfil → la carga por
  defecto. `skillOf(ecs, e, 'q' | 'e')` lee el hueco, no el arma (`basic` y `r` siguen del arma).
- Desbloqueo: un arte se usa con su maestría (el aviso `locked` de M4); un tatuaje siempre; R a maestría 3.
- `MSG.CMD`: `{type: 'loadout', slot: 'q' | 'e', id}` (la carga del arma que llevas), `{type: 'form', id, form}`,
  `{type: 'learn', id}` (a ≤ 3.5 u de Doña Sepia; paga oro). Reglas de §1, rechazos con `{type: 'skillDenied',
  why: 'combat' | 'lawless' | 'weapon' | 'unknown' | 'gold' | 'far' | 'rank'}` (evento privado).
- XP: `grantXp` también da tinta a los tatuajes equipados (los dos enteros), con la recuperación; al subir:
  evento privado `{type: 'tattooRank', id, rank}`.
- **Preparación para las Perlas negras (M4.8, `PLAN-M4.8.md`)**: columna `elem` (0 = ninguno, en
  `PLAYER_FIELDS`) que cada golpe del pirata pasa a `strike(..., { elem })` y que viaja en los eventos de golpe y
  de habilidad; sin efecto todavía. El código de huecos va sobre una lista `SLOTS = ['q', 'e']` para que la perla
  añada `g`. La tecla G queda libre para ella.

### 2.3 Las tres habilidades (P3, sim)
Números en `SKILLS` (`src/data/weapons.js`, afinables desde F4), las formas como sobrescrituras.

**Tromba** (`tromba`, `ground`). Apuntas un punto (≤ 10 u, se recorta al alcance). Carga 0.22 s (moverse × 0.35),
recuperación 0.12 s. Al terminar la carga: evento `tromba` `{x, z, tick (impacto), r}` y la marca del
suelo visible para todos; **impacto a 0.55 s**: radio 2.4, ATK × 2.4, aturde 0.7 s (jefes no), borra las
balas parreables dentro (RIPOSTE +1, máx 8). CD 9 s.
- A «Ojo de tormenta» (r 3.0, × 1.4 al impacto, después **remolino 2 s**: atrae 3.2 u/s hacia el centro, × 0.3 cada
  0.25 s, borra balas dentro). B «Gemelas» (2 cargas, recarga 6 s cada una, r 1.9, × 1.7).

**Abordaje** (`leap`, `ground`). Apuntas un punto (1.5–7 u). Arranque 0.06 s, **vuelo 0.42 s** en parábola de 2.2 u
(sin colisión en el aire; el aterrizaje se recorta al último punto transitable de la línea), i-frames en el aire;
al caer: radio 2.2, ATK × 1.8, empuje 6, borra balas parreables a ≤ 2.6 u (RIPOSTE +1, máx 8). Recuperación
0.16 s. CD 10 s. `ACT.LEAP` (el render saca la altura de `actT`).
- A «Parpadeo» (blink al punto, ≤ 6 u, paso a paso con colisión, i-frames 0.3 s; el siguiente ataque básico en
  1.5 s hace × 1.6 y es crítico; CD 7). B «Ancla de abordaje» (vuelo 0.6 s a 3 u, radio 3.2, × 2.6, aturde 0.5 s,
  CD 13).

**Timón** (`wheel`, `charge`). Mantener carga (moverse × 0.6, como mucho 3 s; carga llena a 0.9 s); al soltar
lo lanzas hacia el cursor. `k` = carga / 0.9: velocidad 26 → 13 u/s, alcance 7 → 12 u, radio 0.45 → 0.8,
ATK × 1.0 → 2.2. Ida analítica que frena hasta el ápice (`s(t) = v0·t − v0²·t²/(4R)`, dura `2R/v0`); vuelta paso
a paso hacia ti (acelera a 1.1 × máx(v0, 14) en 0.3 s). Golpea a cada enemigo una vez a la ida y otra a la vuelta;
borra las balas parreables que cruza (RIPOSTE +1, máx 6). **Atraparlo** (≤ 0.9 u) devuelve el 40 % del
enfriamiento que queda; si mueres o pasan 4 s, cae. CD 8 s.
- A «Remolino» (se queda 1 s en el ápice girando: borra balas a ≤ 1.3 u y golpea × 0.5 cada 0.3 s). B «Timón de
  guerra» (radio + 0.35, daño × 1.35, velocidad × 0.8, empuja 5, atraviesa; sin devolución al atraparlo).

Bits: el comando lleva Q/E **mantenidos** en `btn` (`BTN.Q`, `BTN.E`; `sanitizeCmd` pasa a `& 0x3ff`). Lo demás no
cambia (`ax/az` ya es el punto apuntado).

### 2.4 Apuntar (P4, cliente): la marca tipo RTS
- `src/render/vfx/indicators.js` (nuevo): **aro de alcance** alrededor del pirata (discontinuo, 35 %),
  **marca de área** (disco translúcido del color del hueco + borde nítido + aro interior girando + cruz)
  pegada al suelo, **flecha** (`dir`: rectángulo con punta del ancho del golpe) y **carga** (la flecha crece y un
  aro se llena; destello al llenarse). Solo tú ves tu apuntado; la marca de la Tromba lanzada la ven todos
  (morada la tuya, ámbar la de otros piratas; las de enemigos siguen en rojo).
- Ratón: ajuste «Lanzamiento» = **Con indicador** (por defecto: mantener la tecla muestra la marca, soltar
  lanza; RMB o ESC cancelan) o **Rápido** (pulsar lanza en el cursor). La carga siempre es mantener y soltar.
  La R de las pistolas (Lluvia) también usa la marca.
- Táctil: arrastrar Q/E/R ya apunta; con `ground` la distancia del arrastre lleva la marca (0 → alcance) y se
  ve la marca; `charge`: pulsar empieza a cargar, arrastrar apunta, soltar lanza; tocar sin arrastrar =
  auto-apuntado al enemigo más cercano (punto a su pie para `ground`).
- Mando: mantener RB/LB muestra la marca, el stick derecho la mueve (`ground`: inclinación × alcance), soltar lanza.

### 2.5 Ver y oír (P4, cliente)
- Tromba: anillo de aviso que se cierra (0.55 s) → columna de agua en espiral (cilindro con UV que gira, espuma,
  gotas) + onda en el suelo; Ojo de tormenta: remolino en el suelo. Abordaje: estela + sombra en el suelo que
  crece, polvo y anillo de choque al caer, `ACT.LEAP` (encogido → estirado → aterrizaje). Parpadeo: humo.
  Timón: un timón de barco de 8 radios girando, con estela; destello y «¡Atrapado!» al cogerlo.
- Iconos SVG en `touch.js` y HUD: `tromba`, `leap`, `wheel` (y los de las formas reutilizan el del tatuaje).
- Sonidos (`sfx.js`, sintetizados como los demás): carga, impacto de agua, salto/caída, giro del timón, atrapar.

### 2.6 Panel y PNJ (P5, cliente + servidor)
- Pestaña **«Tatuajes»** en el panel del personaje (tecla **T**): los dos huecos Q / E de tu arma, el
  repertorio (artes de tu arma + tatuajes aprendidos + los que faltan en gris con su precio), rango, barra de
  tinta, formas (A / B con su pista; bloqueadas en gris con el rango que piden). Tocar → poner en Q o E.
- **Doña Sepia** en la aldea (puesto con tintero y pieles colgadas): diálogo corto; «Tatuar» abre la pestaña con
  «Aprender (gratis / 150 oro)».
- Mensajes: «Fuera de combate para cambiar», «En la Cala no se cambia de tatuaje», «Te falta oro»…

### 2.7 Zonas de marea tipo MOBA (aparcado)
> Aparcado por el autor: primero la base divertida, luego la estructura (economía, construcción, barcos,
> comercio entre pueblos). Se queda como idea.

- Instancias con partida: **Arena 3c3** (rondas al mejor de 5, estilo Battlerite), **Asalto al fuerte** (un
  carril con torres y esbirros en la Cala) y **Rey del islote**.
- Dentro todos empiezan iguales: estadísticas normalizadas (el equipo no cuenta), los tatuajes empiezan en
  rango I **de la partida** y suben con la XP de la partida (como un MOBA); tu rango permanente solo decide
  **qué formas** puedes elegir (opciones, no poder). La carga se elige antes de empezar y en la base.
- Recompensas: tinta, oro y bocetos (tatuajes nuevos) — el botín que se comercia (realms of *trade*).

## 3. Pasos

- [x] **P0** Este plan.
- [x] **P1** Cómic Ultra (2.1): gpu.js + test, tier `ultra`, ajustes, sombras, contornos, pasada final,
      viñetas de impacto, líneas, onomatopeyas.
- [x] **P2** Huecos y cargas (2.2): datos, perfil, ECS, CMD, reglas, tinta y rangos + tests.
- [x] **P3** Tromba, Abordaje, Timón y sus formas (2.3) en la sim + tests (predicción incluida).
- [x] **P4** Apuntar, VFX, animación, iconos, sonido (2.4, 2.5).
- [x] **P5** Pestaña Tatuajes, Doña Sepia, mensajes (2.6).
- [x] **P6** Equilibrio (bots / medidas), rendimiento Ultra, README / DESIGN, versión `0.4.7-m4.7`, artefacto,
      informe.

## 4. Notas de ejecución

- Pausa de diseño antes de P1/P2: el autor propuso habilidades raras tipo frutas del diablo. Decidido: las
  **Perlas negras** van en M4.8 (`PLAN-M4.8.md`) sobre la base de los tatuajes; M4.7 solo deja el gancho `elem` y
  los huecos sobre `SLOTS`. Las zonas MOBA quedan aparcadas.
- P6: los números son los de 2.3 (primera pasada, se afinan en vivo desde F4 → raíz `skills`); por cuenta, el Timón
  cargado es el que más daño hace por segundo de enfriamiento (≈ 2 golpes de ATK × 2,2 con el 40 % devuelto), pero
  pide 0,9 s de carga quieto a medias y atraparlo; la Tromba y el Abordaje pagan con área, aturdimiento y balas
  borradas. Rendimiento: todo lo nuevo va en pools hechos al arrancar (marcas, columnas, remolinos, sombras, seis
  timones) y una marca solo se vuelve a tender sobre el suelo cuando se mueve. `PROTOCOL_VERSION` 7 (el estado de los
  tatuajes en `you`), versión `0.4.7-m4.7`, README y DESIGN al día. 214 tests.
- P5: pestaña «Tatuajes» (tecla T) en `ui/charpanel.js`: los dos huecos del arma que llevas, las artes del arma (las
  que pide maestría, en gris), tus tatuajes (rango, barra de tinta, formas con su pista o el rango que piden) y los que
  faltan; la ficha de la elegida con sus números y «Poner en Q / E», «Aprender · gratis / 150 oro» cuando te atiende
  Doña Sepia. Mensajes en `ui/rewards.js` (rechazos con su motivo y la ficha que tiembla, aprendido, sube de rango y
  forma nueva). Doña Sepia: aspecto propio al final de `LOOKS` (moño gris, gafas, chal morado, antebrazos tatuados,
  delantal con manchas de tinta; `skin: 15` en `worldgen.js`), su puesto solo de render detrás de ella en `props.js`
  (toldo, pieles con un ancla, una calavera y olas, mesa con tinteros, taburete), cuatro frases y el botón «Tatuar»
  en el diálogo, y el aviso la primera vez que te acercas. `tools/look.mjs` escenario `sepia`.
- P4: `client/aimcast.js` (controlador de apuntado puro + `tests/aimcast.test.mjs`), Q / E / R como bordes de hueco en
  `input.js` (teclado, mando RB / LB / Y, táctil; RMB, ESC o B del mando cancelan un área y el RMB no sube la guardia),
  `main.js` calcula el punto (cursor, stick por inclinación, arrastre táctil por longitud, auto-apuntado) recortado a
  `[min, alcance]` y el aterrizaje real del salto con `canStand`. `render/vfx/indicators.js` (aro de alcance, marca,
  arco del salto, flecha y aro de carga, aviso de Tromba para todos: morado tuyo, ámbar de otros) y
  `render/vfx/skillfx.js` (tromba de agua, remolino, sombra y golpe del salto, timón de 8 radios con tinta y latón que
  va, se queda en el ápice, vuelve y cae; al hombro mientras cargas). `ACT.CHARGE` / `ACT.LEAP` en `characters.js`
  (el cuerpo sube por la parábola). HUD y táctil siguen la carga (icono, rango en romano, letra de forma, el
  enfriamiento de la forma; solo las artes se bloquean por maestría). Sonidos nuevos en `sfx.js`, palabras de cómic
  (¡CHOF!, ¡PATAPÚM!, ¡ZUUUM!) y el ajuste «Lanzamiento de áreas». `tools/look.mjs` escenario `tattoo` (cuenta el
  flujo real y congela los efectos para la captura). Pendiente de P5: la carga en táctil ya funciona (pulsar carga,
  soltar lanza).
- P3: todo en `src/sim/systems/skills.js` (`castTromba` / `stepTromba`, `planLeap` / `leapAir` / `leapBlink`,
  `stepCharge` / `throwWheel` / `stepWheel`, `clearParry` compartido) y los pasos en vuelo junto a `stepRain` en
  `combat.js`. Cambios sobre 2.3: «Gemelas» es una segunda columna 0.4 s después en el punto al que apuntas cuando
  cae la primera (no dos cargas); `empK` guarda el multiplicador del golpe potenciado (× empMult × rango), no un 1.
  Un salto cortado en el aire (algo que ignore los i-frames) aterriza igual donde iba. Q / E mantenidos ya van en
  `btn` desde teclado y mando (`input.js`); en táctil el botón lanza al soltar, así que el Timón sale sin carga
  hasta P4. 210 tests (12 nuevos en `tests/tattoos2.test.mjs`).
- P2: `src/data/tattoos.js` (`SLOTS` + `SLOT_COLS`: columnas de habilidad, forma, rango, enfriamiento y búfer por
  hueco), carga por arma en `p.sk`, comandos `loadout` / `form` / `learn` con sus rechazos, tinta con
  recuperación, Doña Sepia en la aldea (uv −102, 3; aún con el aspecto de Tía Perla), `elem` en cada golpe (se
  copia al evento `damage` / `hurt`). `PROTOCOL_VERSION` 6 (el `you` creció). Un tatuaje sin lanzamiento en Q/E no
  hace nada hasta P3. 166 tests.
- P1: `src/render/gpu.js` clasifica la GPU (`WEBGL_debug_renderer_info`; sin él, `high`); en AUTO una GPU fuerte
  arranca en Ultra. `tierConfig('ultra')`: `mnInk` 2 (tramas Ben-Day de celda 0.30, rayado más denso, contornos
  × 1.3, banda honda de personajes 0.30 para que no se ennegrezcan en La Caldera). `pipeline.impact()` (viñeta,
  líneas de velocidad con semilla) y `ui/comic.js` (onomatopeyas 42 / 66 px con trazo de 6 px, pop en un span
  interno), solo en Ultra y con el ajuste «Efectos de cómic». En swiftshader rinde como Alto. **El autor revisa
  el aspecto** y manda los ajustes.
