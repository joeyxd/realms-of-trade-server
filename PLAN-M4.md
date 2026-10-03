# PLAN M4 — «El botín»: equipo, loot, maestría de armas, misiones, guardado y Mareas

> Documento de traspaso. Si la sesión se corta, cualquier modelo puede seguir desde la primera casilla `[ ]`
> sin leer el historial. Cada paso termina con tests en verde + commit + push. Marca `[x]` al terminar.
> Base: M3.6 terminado (`PLAN-M3.6.md`, 95 tests en verde, versión `0.3.6-m3.6`).

## 0. Contexto mínimo (leer primero)

- Repo `joeyxd/realms-of-trade-server`, rama **`claude/loving-lovelace-ptbif7`** (PR #1 abierto: no abrir otro).
- Juego «MAREA NEGRA»: ARPG isométrico toon (bullet hell), Three.js 0.160 (CDN), sim determinista (`src/sim/`,
  sin `Math.random`) y servidor autoritativo `LocalServer` (`src/net/localServer.js`): en un Web Worker en solo y
  dentro de `server/host.mjs` (Node, WebSocket) en línea. El cliente predice al jugador local con `PLAYER_FIELDS`
  (`src/sim/ecs.js`) y reconcilia con `you` (precisión completa) + `ack`. Diseño: `DESIGN.md` (§9 progresión,
  §10 red).
- Decisión del autor (tras M3.6): **M4 = progresión, inventario y loot, con la maestría de cada arma
  desbloqueando su kit** (estilo Albion), más misiones, guardado y HUD completo (`DESIGN.md` §16).
- Tests: `npm test`. **Nunca** empujar en rojo. Capturas: `node tools/shot.mjs <dir>` (en el contenedor:
  `MN_LIBS=<scratchpad>/libs`). Balance: `LV=5 SKILL=0.8 node tools/playtest.mjs`; red: `node tools/nettest.mjs`.
- Artefacto (solo un jugador): `node tools/build-artifact.mjs dist/index.html` → republicar en la MISMA URL
  https://claude.ai/artifact/MpCdPMbgw41nJKcf8NvSrD (antes `Artifact list scope:"files"`).
- Commits terminan con:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Md1KNYppmXci5NXt42VucC
  ```
  Sin IDs de modelo en commits/código. Push: `git push -u origin claude/loving-lovelace-ptbif7`.
- Respuesta final al usuario **en español**, con enlaces al PR #1 y al artefacto.

### Reglas (las de M3.5 / M3.6 siguen valiendo)
1. **El servidor decide todo lo que vale algo**: tiradas de loot, oro, XP, misiones, equipo. El cliente solo pide
   (`cmd`) y dibuja. Nada de esto vive en `server/` (solo transporte y firma de partidas).
2. Lo que cambia el combate predicho (velocidad, enfriamientos, ventanas, pociones, kit desbloqueado) va en
   columnas del ECS dentro de `PLAYER_FIELDS`: el cliente lo recibe en `you` y predice exacto.
3. **Loot personal**: cada jugador ve y recoge solo lo suyo (eventos privados `to`). Nadie roba a nadie.
4. Las tiradas usan su propio RNG (`world.lootRng`): el combate (críticos, IA) sigue dando los mismos números.
5. Un `World.spawnPlayer` sin perfil se comporta como en M3.6 (kit entero, sin equipo): los tests viejos no cambian.
6. Comentarios en inglés, UI en español, números en `src/data/*`.

## 1. Objetivo

Matar da **botín** que cae al suelo con su haz de luz por rareza; lo recoges al pasar, lo equipas en 6 huecos
(arma, cabeza, pecho, botas, 2 abalorios) y tus números cambian. **El arma equipada decide el kit** y cada arma
tiene su **maestría** (1–10): la E se abre en maestría 2, la R en maestría 3, y más arriba da daño y una pasiva
propia. Las **misiones** (la Capitana Brea, Tía Perla) guían de la playa a HELLFIRE y dan XP, oro, pociones y
equipo; Tía Perla compra y vende. Vencer a HELLFIRE suelta un **cofre personal** y abre la **Marea II** (y luego
la III): La Caldera más dura, con mejor botín. **Todo se guarda**: en solo en el navegador; en línea el servidor
firma tu partida (HMAC) y la guardas tú, así sobrevive a reinicios y despliegues sin base de datos.

## 2. Especificación

### 2.1 Objetos (`src/data/items.js`, `src/sim/items.js`)
- **Rarezas** (DESIGN §9): Común `#9AA3AD` peso 55 ×1.0 0 afijos · Poco común `#4CD964` 28 ×1.3 1 · Raro
  `#3FA9FF` 12 ×1.7 2 · Épico `#B36BFF` 4.2 ×2.2 3 · Legendario `#FFC23D` 0.8 ×3.0 4. Bonificación de rareza `b`
  (Mareas): el peso de la rareza `i ≥ 1` × `(1 + b·i)`.
- **Presupuesto** de un objeto: `P = (2 + 0.8·nivel) × mul(rareza)` puntos. La base reparte `P` entero en su
  implícito; cada afijo vale `P × [0.3, 0.5]`. Un punto compra: ATK 1 · DEF 1 · VIDA 5 · CRÍT 0.5 % · DAÑO CRÍT 3 %
  · VELOCIDAD 1 % · ENFRIAMIENTO 1 % · RIPOSTE 3 % · REFLEJOS 2.5 % · AGUANTE 3 · RECARGA DE DASH 2 % · XP 2 % ·
  ORO 4 % · POCIÓN 4 % · VIDA AL MATAR 1. Topes: CRÍT 50 %, VELOCIDAD −10…+25 %, ENFRIAMIENTO 30 %, DASH 30 %.
- **Bases** (`ilvl ≥` = nivel mínimo para caer):
  - Arma, sable: Sable de cubierta (ATK) · Daga de abordaje (≥ 2, ATK × 0.85, ventanas de reflejo +20 ms) ·
    Ancla de mano (≥ 4, ATK × 1.35, ventanas −20 ms). Pistolas: Pistolas de chispa (ATK) · Pistolas de duelo
    (≥ 2, ATK × 0.9, CRÍT +4 %) · Trabucos gemelos (≥ 4, ATK × 1.3, cadencia × 1.2 más lenta).
  - Cabeza: Pañuelo rojo (VIDA) · Tricornio (DEF 0.6 + VIDA 0.4) · Sombrero de capitán (≥ 5, DEF 0.5 + CRÍT 0.5).
  - Pecho: Chaleco de lona (VIDA) · Casaca de oficial (DEF) · Coraza de coral (≥ 4, DEF 1.4, VELOCIDAD −3 %).
  - Botas: Botas de cubierta (VELOCIDAD 0.6 + DEF 0.4) · Botas altas (DEF 0.6 + VIDA 0.4) · Botas de viento
    (≥ 5, VELOCIDAD 0.6 + DASH 0.4).
  - Abalorio: Anillo de coral (CRÍT) · Diente de tiburón (ATK 0.7) · Brújula rota (ENFRIAMIENTO) · Amuleto de ron
    (POCIÓN 0.6 + VIDA 0.4) · Moneda maldita (ORO 0.7 + XP 0.3).
- **Afijos** por hueco (sin repetir en un objeto): arma {atk, crit, critD, cdr, rip, refl, kill}, cabeza {def, hp,
  crit, cdr, guard, xp}, pecho {def, hp, rip, refl, guard, pot, kill}, botas {def, hp, spd, dash, gold}, abalorio
  {atk, def, hp, crit, critD, spd, cdr, rip, xp, gold, pot}. El nombre lleva el sufijo de su afijo mayor
  («Sable de cubierta del Tiburón»).
- **Valor** (oro): `round((3 + 2·nivel) × mul^1.4 × (1 + 0.15·afijos))`. Tía Perla paga el 100 %; desguazar en
  cualquier parte, el 25 %.
- Formato compacto (también el del guardado): `{u, b, r, l, a: [[afijo, puntos], …]}`. `itemStats(item)`,
  `itemName(item)`, `itemValue(item)` son puras (las usa también la UI).

### 2.2 Estadísticas y maestría (`src/sim/systems/stats.js`)
- `refreshStats(world, e)`: base por nivel (DESIGN §9) + equipo + maestría → columnas del ECS (la vida conserva su
  fracción). ATK final = `(base + equipo) × (1 + 0.02·(maestría − 1))`.
- Columnas nuevas en `PLAYER_FIELDS` (predichas): `speed`, `cdr`, `ripMul`, `reflMul`, `guardMax`, `dashRec`,
  `winBonus`, `fireMul`, `potHeal`, `xpMul`, `potions`, `potCd`, `mastery` (maestrías empaquetadas, 4 bits por
  arma). Solo servidor: `crit`, `critD`, `goldMul`, `onKill`.
- **Maestría por arma** 1–10, XP por nivel `[60, 140, 260, 400, 560, 740, 940, 1160, 1400]`: toda la XP que
  ganas va también a la maestría del arma equipada (sigue al tope de nivel). **Kit: LMB + Q desde maestría 1,
  E en maestría 2, R en maestría 3.** Pasivas: +2 % de daño por nivel; Sable 5 «Filo templado» (+15 ms a
  EXCELENTE y BUENO), Sable 10 «Ojo del huracán» (Tormenta r 6 → 8 u); Pistolas 5 «Gatillo fácil» (cadencia
  × 0.85), Pistolas 10 «Diluvio» (Lluvia de plomo 1.5 → 2.25 s, r + 0.8).
- **Pociones de ron-coco**: `BTN.POTION` (256, tecla `1`, cruceta ↑, botón táctil): cura el 40 % × `potHeal` al
  instante, 2 s de enfriamiento, máx. 5. Predicha. Empiezas con 2. Regeneración de M2 rebajada (se decide en P1 con
  los tests: objetivo 5 s sin daño y 5 %/s).

### 2.3 Loot e inventario (servidor: `src/sim/systems/inventory.js`, `src/data/loot.js`)
- **Perfiles** en el servidor: `world.profiles: Map<entidad, perfil>` (solo jugadores humanos). Perfil =
  `{v, lvl, xp, gold, pot, uid, bag[24], eq{weapon, head, chest, boots, ring1, ring2}, mast[[nivel, xp]…],
  quests{}, flags{tut, tier, tierSel}, items{coral}, cp, stats{}}`. Perfil nuevo: Sable de cubierta común
  (o Pistolas de chispa si el título pidió pistolas), 2 pociones, 0 oro, maestría 1.
- **Tablas** por enemigo (oro % y rango, objeto %, poción %, objeto de misión %): grumete 40 % 1–3 · 3 % · 2 %;
  arquero 60 % 2–5 · 8 % · 4 %; diablillo 50 % 2–4 · 5 % · 3 %; chamán 70 % 4–8 · 12 % · 6 %; cangrejo 80 % 5–10 ·
  15 % · 6 %; centinela 100 % 8–14 · 35 % · 15 %; muñeco y cañón nada. Nivel del objeto = nivel del enemigo
  + Marea. ~6 objetos por vuelta a La Caldera contando el cofre.
- **Caída personal**: al morir un enemigo, cada jugador con derecho a XP (≤ 25 u o quien lo mató) tira su loot
  (`lootRng`); las caídas (`world.drops`, `{id, to, x, z, kind: item|gold|potion|quest|chest, …}`) salen alrededor
  del cadáver y viven 120 s. Evento privado `loot` / `unloot`. **Se recogen solas** a ≤ 1.5 u (si la bolsa está
  llena, el objeto se queda y avisa); el cofre se abre con `F` y derrama su contenido.
- **Cofre del jefe** (uno por participante al vencer): 1 objeto mínimo Raro con 2 tiradas de subir rareza al 35 %
  + 2 objetos normales + 60–100 oro + 1 poción. M5 lo convierte en la secuencia Highlight.
- **Comandos** (`cmd`): `equip {uid}` (anillos al primer hueco libre), `unequip {slot}`, `salvage {uid}`,
  `open {drop}` (cofre a ≤ 3 u). El armero (`cmd.w`, predicho) equipa en el servidor tu mejor arma de ese tipo o te
  da una común si no tienes ninguna. Cambiar de arma desde la bolsa cambia el kit (el evento `equip` de M3.5).
- `LocalServer.flushEvents`: un evento con `to` va solo al cliente de esa entidad. `MSG.PROFILE {p}` (privado) cada
  vez que el perfil cambia (agrupado por tick).

### 2.4 Guardado (`src/net/saves.js`, `server/saves.mjs`)
- `LocalServer({saves})`: `load(blob) → perfil | null` y `store(perfil) → blob`. Worker / en proceso: confía
  (`blob` = JSON del perfil). Node: **HMAC-SHA256** con `SAVE_SECRET` (`blob = base64url(json) + '.' + firma`);
  sin secreto se genera uno al arrancar y se avisa (las partidas no sobreviven a un reinicio). `render.yaml`:
  `SAVE_SECRET` con `generateValue: true`.
- `hello {v: 4, name, skin, weapon, save}` (≤ 32 KB). Si la firma no vale o la versión no se entiende: perfil nuevo
  + evento privado `note {code: 'save'}` (el cliente avisa y guarda la copia vieja aparte). Perfil cargado → se
  sanea igual (bases y afijos conocidos, rangos).
- `MSG.SAVE {blob}` privado: a los 5 s de un cambio, al momento en lo importante (nivel, objeto, misión), y al
  desconectar si se puede. El cliente lo guarda en `localStorage`: `mareanegra.v1.save.solo` o
  `mareanegra.v1.save.<host del servidor>`. «Nueva partida» (Pausa) lo borra. Se guarda el último punto de control
  (`cp`): vuelves ahí.

### 2.5 Misiones, diálogo y vendedora (`src/data/quests.js`, `src/sim/systems/quests.js`)
- Objetivos: `zone` (entrar en una zona), `talk` (PNJ), `kill` (tipos, n), `win` (encuentro, Marea mínima),
  `collect` (objeto de misión, n). Crédito de muertes como la XP (cooperativo). Recompensas: XP, oro, pociones,
  objeto (rareza mínima, nivel = el tuyo).
- Cadena (automática, sin volver a hablar): «Tierra firme» (llega a la Aldea Coralina, 40 XP) → «La capitana del
  puerto» (habla con Brea, 100 XP + 20 oro) → «Limpia el camino» (3 arqueros, 200 XP + 2 pociones) → «Los
  guardianes» (2 centinelas, 150 XP + 40 oro) → «Sobrevive a La Caldera» (vence a HELLFIRE, 300 XP + 100 oro;
  abre la Marea II). Secundaria de Tía Perla (se acepta y entrega hablando): «Coral para la tía» (6 fragmentos de
  coral de chamanes, cangrejos y grumetes, 2 pociones + 60 oro + abalorio Poco común). Repetible de Brea tras la
  Prueba: «Caza en La Caldera» (40 enemigos de la Prueba, 120 oro + 1 poción).
- El tutorial de la playa (mover, dash, golpear, reflejar, guardia) sigue en el cliente, pero su progreso se guarda
  (`cmd tut {i}` → `flags.tut`); «aldea / capitana / sendero / caldera» pasan a ser las misiones de arriba.
- `cmd talk {npc}` (≤ 3.5 u) → evento privado `talk {npc, offer, turnin}`; `cmd quest {op: accept|turnin, id}`.
- **Tía Perla**: `cmd buy {what: 'potion' | 'crate'}` (poción 25 oro, máx. 5; «Cofre misterioso» 120 oro: objeto de
  tu nivel), `cmd sell {uid}` (≤ 4 u de ella).

### 2.6 Mareas (dificultad de La Caldera)
- `ENCOUNTERS.caldera.tiers`: I (vida × 1, daño × 1, +0 niveles, rareza b 0, XP × 1, oro × 1) · II (× 1.7,
  × 1.35, +3, 0.5, × 1.6, × 1.5) · III (× 2.6, × 1.7, +6, 1.0, × 2.4, × 2.2). Vencer la Marea n abre la n + 1.
- Eliges la Marea en el círculo de runas (`F`, hasta la más alta que tengas: `cmd tier {t}` → `flags.tierSel`).
  En cooperativo manda la más baja de los que la empiezan. El daño enemigo se multiplica en un solo sitio (lo que
  disparan: patrones, círculos, rayos, lava, por su dueño). `encounterState()[11]` = Marea; el HUD dice «Marea II».

### 2.7 Cliente
- **HUD**: oro bajo la XP; hueco de poción `1` con su número en la barra; candados en E / R con «Maestría n»;
  barrita de maestría bajo el nombre del arma; seguimiento «Primeros pasos» y luego «Misiones» (del servidor);
  botones Bolsa y Mapa arriba a la derecha (táctil también).
- **En el suelo** (`src/render/loot.js`): saco / monedas / botella / coral / cofre que saltan del cadáver en arco,
  flotan y giran, con **haz de luz** por rareza (Común corto y tenue → Legendario alto, dorado, con chispas) y
  nombre en su color (`worldui`); al recogerlos vuelan hacia ti. Sonidos por rareza, monedas, poción, equipar,
  misión cumplida, maestría.
- **Paneles** (no pausan el mundo; ESC cierra primero el panel): *Personaje* con pestañas **Equipo** (muñeco con
  6 huecos + bolsa 6 × 4, oro, pociones), **Atributos** (todas las estadísticas, maestría de cada arma con la
  siguiente recompensa) y **Misiones** (diario). Atajos `I` / `B` Equipo, `C` Atributos, `L` Misiones, `M`
  Mapa. Ficha de objeto al pasar el ratón o tocar: rareza, base, nivel, líneas, **comparación** con lo equipado
  (▲ verde / ▼ rojo), valor, botones Equipar / Desguazar / Vender. **Diálogo** con PNJ (línea + opciones: misión,
  Comerciar, Adiós). **Vendedora**: el panel de Equipo con la tienda en lugar del muñeco. **Mapa** de la isla
  dibujado del mapa de alturas en el marco (u, v) (como lo ve la cámara), zonas, PNJ, objetivo, tú y la tripulación.
- Mando: poción en la cruceta ↑, Equipo con Select. Táctil: botones de poción, Bolsa y Mapa.

### 2.8 Protocolo v4
- `PROTOCOL_VERSION` 4: `hello.save`; `prs` admite `BTN.POTION` (máscara 0x1ff); `cmd` equip / unequip /
  salvage / sell / buy / talk / quest / open / tier / tut; `MSG.PROFILE`, `MSG.SAVE`; eventos privados con `to`
  (`loot`, `unloot`, `talk`, `quest`, `mastery`, `note`); `encounterState()[11]` Marea.
- F4 (`dev`): `mastery {level}`, `gold {n}`, `item {rarity, slot}`, `tier {t}` para pruebas y capturas; los
  bots de `playtest` / `nettest` abren su kit con `mastery`.

## 3. Pasos

- [x] **P0** Este plan.
- [x] **P1 Núcleo de estadísticas** (sim): `data/items.js`, `sim/items.js` (generar, estadísticas, nombre, valor),
  `systems/stats.js` (`refreshStats`), columnas nuevas y `PLAYER_FIELDS`, maestría (empaquetado, desbloqueo de
  E / R en `tryCast` / riposte, pasivas), pociones (`BTN.POTION`), críticos por jugador, protocolo v4 (máscara).
  Tests `tests/items.test.mjs` y `tests/mastery.test.mjs` (distribución de rarezas, rangos, la predicción y el
  servidor dan lo mismo con equipo de velocidad / enfriamiento / ventanas, kit bloqueado).
- [x] **P2 Loot e inventario** (servidor): perfiles, tablas, caídas personales, recogida, expiración, equipar /
  quitar / desguazar / armero, eventos privados, `MSG.PROFILE`, cofre del jefe. Tests `tests/loot.test.mjs`
  (dos jugadores: cada uno lo suyo, el otro no lo ve; bolsa llena; el equipo cambia los números; cofre).
- [x] **P3 Guardado**: perfil ↔ blob, saneado y migración, adaptadores (confianza / HMAC), `hello.save`,
  `MSG.SAVE`, persistencia en el cliente, `SAVE_SECRET` y `render.yaml`. Tests `tests/save.test.mjs` (ida y
  vuelta, manipulado → rechazado, el servidor Node reiniciado reconoce la partida, punto de control).
- [x] **P4 Misiones y vendedora**: datos, sistema, `talk` / `quest` / `buy` / `sell` / `tut`, objetos de misión,
  recompensas. Tests `tests/quests.test.mjs` (cadena entera con eventos, distancia, cooperativo, repetible,
  compras sin oro).
- [ ] **P5 Mareas**: niveles del encuentro, multiplicador de daño enemigo, bonus de loot / XP / oro, desbloqueo,
  elección en las runas, estado 11. Tests en `tests/quests.test.mjs` o `tests/tiers.test.mjs`.
- [ ] **P6 Cliente I**: HUD (oro, poción, maestría, candados, avisos de desbloqueo), loot en el suelo (malla, haz,
  nombre, arco, recogida), sonidos, seguimiento de misiones, guardado local, aviso de partida rechazada.
- [ ] **P7 Cliente II**: panel de Personaje (Equipo / Atributos / Misiones), fichas y comparación, diálogo,
  vendedora, mapa, atajos, táctil y mando. Capturas.
- [ ] **P8 Cierre**: balance (playtest de varias vueltas con equipo: nivel, poder, tiempos por Marea), README
  («Qué incluye M4»), DESIGN §9/§10/§16, versión `0.4.0-m4`, artefacto, informe final.

## 4. Notas de implementación (rellenar al cerrar cada paso)

- **P0:** plan escrito tras leer `world.js`, `combat.js`, `skills.js`, `localServer.js`, `gameClient.js`,
  `main.js` y `hud.js`. Ideas que quedan fuera de M4: gráficos del equipo sobre el personaje (salvo quizá el brillo
  del arma por rareza), comercio entre jugadores, habilidades alternativas por maestría (Albion), la secuencia
  Highlight del cofre (M5).
- **P1:** `src/data/items.js` (rarezas, `STATS` con lo que compra un punto, bases, afijos por hueco, pociones) y
  `src/sim/items.js` (`rollItem`, `itemStats`, `itemName`, `itemValue`, `itemScore`, `sanitizeItem`). La base de
  pistolas se llama `chispa` (el id `pistolas` es el kit). `systems/stats.js`: `statsFor` (se mudó de combat.js,
  que lo reexporta), `refreshStats` (lee `world.profiles`; sin perfil = M3.6), `masteryOf` / `packMastery`,
  `kitUnlocked`, `passive`. Columnas: `cdr, ripMul, reflMul, guardAdd, dashRec, winBonus, fireMul, potHeal, xpMul,
  mastery, potions, potCd` (+ `speed`) en `PLAYER_FIELDS`; `critAdd, critDAdd, goldMul, onKill` solo servidor. El
  aguante máximo es `tuning.guard.stamina + guardAdd` (F4 sigue editándolo en vivo). Una pulsación bloqueada emite
  `locked {slot}` (predicho) y no gasta nada. `gainXp` multiplica por `xpMul` y llama `world.onXp` (la maestría,
  P2) también al tope. Poción: `BTN.POTION` 256 (`1`, cruceta ↑), `usePotion` → evento `potion {heal | denied}`.
  `PROTOCOL_VERSION` 4, `prs` & 0x1ff. Regeneración rebajada a 5 s / 5 %/s. 106 tests.
- **P2:** `src/data/loot.js` (tablas, `DROPS`) y `src/sim/systems/inventory.js` (perfiles, caídas, recogida,
  bolsa, armero, cofre, maestría). `installInventory(world)` (lo llama `LocalServer`) crea `profiles`, `drops`,
  `profileDirty`, `lootRng` y los ganchos `onXp` (maestría) y `onRack` (el armero predicho llama
  `world.onRack` tras `setWeapon`: el servidor cambia también el objeto). `killEnemy` reparte XP y luego
  `lootOnKill` a los mismos jugadores; `victory()` llama `bossChests` con toda la tripulación dentro (caídos
  incluidos), cofres en anillo alrededor de las runas. Las armas iniciales llevan `s: 1` y valen 0 (el armero
  no es una mina de oro). Eventos privados: `loot {drops}`, `unloot {ids, why}`, `pickup`, `full {what}`,
  `gear`, `sold`, `mastery {kit, level, opens, passive}`, `chest`. `MSG.PROFILE {p}` como mucho cada 15 ticks.
  `cmd`: `equip {uid, slot?}`, `unequip {slot}`, `salvage {uid}`, `open {drop}`; F4: `mastery`, `gold`,
  `potions`, `item {rarity, slot, lvl}`. El cliente guarda `client.profile` y una copia en
  `pred.profiles`. Los tests que juegan con el kit entero piden maestría 3 (`helpers.clientAndServer`,
  `nettest`). 114 tests.
- **P3:** `sanitizeProfile` vive en `inventory.js` (sabe la forma del perfil; versión 1, `null` si no es nuestra).
  `src/net/saves.js`: `trustSaves` (JSON), `MAX_SAVE` 32 KB, `SAVE_TIMING {after: 3, every: 10}`, `SAVE_NOW`
  (eventos privados que guardan al momento). `server/saves.mjs`: `hmacSaves(secret)` (`base64url(json).firma`,
  `timingSafeEqual`) y `saveSecret()` (`SAVE_SECRET` o uno aleatorio con aviso); `createGameServer({saveSecret})`.
  `LocalServer({saves})`: el `hello.save` se carga (o perfil nuevo + `note {code: 'save'}`), `MSG.SAVE {blob}` al
  entrar, al momento tras `pickup` / `mastery` / `chest` / `gear` / `sold` / `level`, 3 s tras otro cambio y un
  vistazo cada 10 s (solo si el blob cambió). El cliente guarda en `mareanegra.v1.save.solo` o
  `…save.online.<host>` (`settings.js`: `loadSave`, `storeSave`, `setSaveAside`); en solo también al cerrar la
  página (`pagehide`, con nivel / XP / pociones predichos). Vuelves a tu último punto de control. 119 tests.
- **P4:** `src/data/quests.js` (`QUESTS`, `QST` 0 ninguna · 1 activa · 2 hecha · 3 lista para entregar, `NPC_TALK`
  con las líneas de Brea y Perla y lo que dicen de sus misiones) y `src/sim/systems/quests.js` (`startQuests`,
  `questEvent`, `talkTo`, `acceptQuest`, `turnInQuest`, `questWants`, `questKill` / `questWin` / `zoneSweep`,
  `buy` / `sell`, `setTutorial`). `world.npcs` (id → entidad) sale de `spawnNpc`. Las recompensas usan
  `stashItem` y `givePotions` de `inventory.js` (bolsa llena o pociones al tope → al suelo, nada se pierde).
  Hablar y aceptar exigen ≤ 3.5 u del PNJ; comprar / vender ≤ 4.5 u de Perla. Eventos privados `quest {id, st:
  start | progress | ready | done, n, of, reward}`, `talk {npc, ent, offer, ready, shop}`, `bought {what, fail?}`.
  `cmd`: `talk {npc: entidad}`, `quest {op: accept | turnin, id}`, `buy {what}`, `sell {uid}`, `tut {i}`. 125 tests.
