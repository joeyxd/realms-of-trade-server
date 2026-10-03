# PLAN M4.5 — «Sin ley»: los detalles de M4 y la Cala Calavera (PvP con mobs, fuego amigo y botín completo)

> Documento de traspaso. Si la sesión se corta, cualquier modelo puede seguir desde la primera casilla `[ ]`
> sin leer el historial. Cada paso termina con tests en verde + commit + push. Marca `[x]` al terminar.
> Base: M4 terminado (`PLAN-M4.md`, 129 tests en verde, versión `0.4.0-m4`).

## 0. Contexto mínimo (leer primero)

- Repo `joeyxd/realms-of-trade-server`, rama **`claude/loving-lovelace-ptbif7`** (PR #1 abierto: no abrir otro).
- Juego «MAREA NEGRA»: ARPG isométrico toon (bullet hell), Three.js 0.160 (CDN), sim determinista (`src/sim/`,
  sin `Math.random`) y servidor autoritativo `LocalServer` (`src/net/localServer.js`): en un Web Worker en solo y
  dentro de `server/host.mjs` (Node, WebSocket) en línea. El cliente predice al jugador local con `PLAYER_FIELDS`
  y reconcilia con `you` + `ack`; los golpes de los jugadores a los enemigos son solo del servidor, con lag
  compensation (historial de posiciones, `historyAt`). M4 añadió perfiles, loot personal, guardado firmado,
  misiones, Mareas y paneles (`PLAN-M4.md`, `DESIGN.md` §9 / §10).
- Petición del autor (tras M4): «arreglar los detalles y una zonita de PvP con mobs para que sea un caos, con
  fuego amigo y botín completo».
- Tests: `npm test`. **Nunca** empujar en rojo. Capturas: `node tools/shot.mjs <dir>` (en el contenedor:
  `MN_LIBS=<scratchpad>/libs`). Balance: `tools/playtest.mjs`, `tools/progress.mjs`; red: `tools/nettest.mjs`.
- Artefacto (solo): `node tools/build-artifact.mjs dist/index.html` → republicar en la MISMA URL
  https://claude.ai/artifact/MpCdPMbgw41nJKcf8NvSrD (antes `Artifact list scope:"files"`).
- Commits terminan con:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Md1KNYppmXci5NXt42VucC
  ```
  Sin IDs de modelo en commits/código. Push: `git push -u origin claude/loving-lovelace-ptbif7`.
- Respuesta final al usuario **en español**, con enlaces al PR #1 y al artefacto.

### Reglas (las de M4 siguen valiendo, salvo dentro de la Cala)
1. El servidor decide todo lo que vale algo. El cliente solo pide y dibuja.
2. **Dentro de la Cala Calavera se suspende el loot personal**: lo que cae allí es de quien lo pise primero.
   Fuera de ella nada cambia (los tests de M4 siguen igual).
3. El fuego amigo solo existe si atacante **y** víctima están dentro del círculo de la Cala.
4. La isla fuera de la Cala no se mueve: las palmeras, arbustos y rocas que la Cala quita se descartan **después**
   de sus tiradas y dejan un «fantasma» en la rejilla de separación (mismo RNG, mismas posiciones fuera).
5. Comentarios en inglés, UI en español, números en `src/data/*`.

## 1. Objetivo

**Detalles**: la etiqueta del cofre ya no tapa el aviso de `F`, las palmeras se disuelven también entre la cámara
y tu cofre, y el oro tiene en qué gastarse (cofres de Marea en el puesto de Tía Perla).

**La Cala Calavera**: un fuerte pirata en ruinas junto a la costa este, a un desvío del Sendero del Humo. Un
círculo de tótems con calaveras marca la frontera: dentro **no hay ley**. Todos los ataques de los piratas dañan
a los demás piratas que estén dentro (también a tu tripulación), los mobs se hieren entre ellos y se vuelven
contra quien les dio, y unos piratas renegados (los **Desalmados**) cazan todo lo que se mueve. Los mobs de la Cala
son más duros y sueltan mejor botín, pero ese botín es público. Si caes dentro, **pierdes todo lo que llevas
puesto y en la bolsa** (salvo el arma inicial) y las pociones: se esparce por el suelo durante 3 minutos para
quien lo pise primero, tú también si vuelves a tiempo. El oro no se pierde.

## 2. Especificación

### 2.1 Detalles (P1)
- **Aviso y etiqueta**: si el aviso de `F` es para un cofre, la etiqueta de ese cofre se oculta y el aviso dice
  «F Abrir · Cofre de HELLFIRE» en el color de su rareza. Además, las etiquetas de botín que caen bajo el aviso
  se atenúan.
- **Palmeras**: el disolvente de oclusión (`toon.js`, `MN_OCCLUDER`) tiene un segundo cilindro hacia un punto
  de interés (`mnOcc2`): tu cofre más cercano a ≤ 10 u (y en P4 tu botín perdido).
- **Oro**: `CONSUMABLES.crate2` «Cofre de la Marea II» (450 oro, nivel + 3, rareza + 0.5, necesita la Marea II
  abierta) y `crate3` «Cofre de la Marea III» (1100 oro, nivel + 6, rareza + 1.0, al menos Poco común, necesita
  la Marea III). El puesto los enseña (bloqueados con su requisito si aún no).

### 2.2 El lugar (`worldgen.js`, P2)
- Centro (u, v) = (−35, 66), radio **R = 21** (`L.cala`, `L.calaR`). Terreno: tras colocar la vegetación se
  aplana con suavidad hacia 3.6 (70 %) dentro de R + 6, y se corrigen las alturas de los props cercanos.
- **Desvío**: de (−37, 5) en el Sendero a (−36, 45) (borde de la Cala): tierra en la máscara `path`, sin
  vegetación, rampa suave. Cartel «CALA CALAVERA ☠» al empezar el desvío.
- **Decorado** fijo (sin RNG): tótems con calavera cada ~9 u en el borde (`skullPost`, con collider), restos de
  empalizada (`palisade`), cajas y barriles como cobertura (bloquean balas), banderas negras (`blackFlag`).
- `zoneAt` → `'calavera'` dentro de R + 1. `map.lawlessAt(x, z)` = dentro de R. Punto de control `calavera` en
  (−36, 41), fuera del círculo: si caes en la Cala despiertas a la entrada.
- `ZONES.calavera = { name: 'Cala Calavera', sub: 'Sin ley: fuego amigo y botín completo', lawless: true }`.

### 2.3 Fuego amigo (sim, P2)
- `World.canHit(e, o)`: `o` es enemigo, o es otro pirata humano (sin `C.BOT`) vivo y **los dos** dentro de la
  Cala. Todos los golpes de jugador lo usan: `meleeHits`, `lungeHits`, `crescentHits`, `rainHits`, `waveHits`,
  `stepShots` (balas, perdigones, reflejos, liberaciones) y `bounceShot`. El rastreo de los disparos sigue
  buscando solo enemigos.
- Lag compensation también para jugadores: `world.phist` (historial de posiciones de los piratas, servidor) y
  `historyAt` lo usa cuando la entidad no tiene cerebro.
- `hurtByPlayer(world, v, raw, o)` (`combat.js`, servidor): con iframes de dash → `dodge` (sin XP); con
  invulnerabilidad tras golpe → nada; guardia en el arco y el golpe no viene de arriba → perfecta: no entra nada
  (sin atrapar ni XP), bloqueo: × `blockMult` y aguante (puede romperse); si no, `hurtPlayer(raw × pvpDmg × crít
  del atacante)`. El 3.er golpe, la estocada y la tormenta (`heavy`) aturden 0.3 s y cortan lo que lances.
  Eventos: `hurt {e, dmg, kind: 'pvp', by, crit, seq: 0}`; si muere, `death {id, by}`.
- `LAWLESS.pvpDmg` = 0.6 (se ajusta en P5 con el tiempo de muerte con equipo).

### 2.4 Botín completo y botín público (servidor, P2)
- `world.onDeath(e, by)` (gancho de `killPlayer`, lo pone `installInventory`): si `lawlessAt` y tiene perfil, se
  esparcen **todos** los huecos del equipo (el arma solo si no es la inicial; sin arma, recibe la inicial de su
  kit), toda la bolsa y las pociones (`ecs.potions = 0`), como caídas **públicas** (`to: 0`, `from: e`,
  `life` 180 s, radio 0.8–2.6 u). Evento privado `spill {n, x, z}` y `refreshStats`. El oro se queda.
  `p.stats.deaths++`; el que lo mató, `p.stats.pk++`.
- Caídas públicas: `loot {pub: 1, drops}` sin `to` (para todos), `unloot {pub: 1, ids, by?}` cuando alguien las
  recoge o caducan; `pickup` privado para quien recoge. `stepDrops` las da al primer pirata vivo con perfil a
  ≤ `pickR` (con bolsa llena se queda en el suelo). Al entrar un pirata nuevo recibe las públicas que haya.
- Mobs muertos dentro de la Cala: el loot se tira **una vez** (con el bonus de la Cala) y cae público. Los objetos
  de misión siguen siendo personales.

### 2.5 Mobs, peleas entre ellos y Desalmados (P3)
- `LAWLESS.tier` = «Sin ley» (vida × 1.6, daño × 1.4, nivel + 3, rareza + 0.6, XP × 1.5, oro × 1.5) en los
  generadores de la Cala: 4 grumetes, 2 arqueros, 2 diablillos, 1 chamán, 1 cangrejo (posiciones fijas).
- **Peleas entre mobs** (servidor, `stepInfighting`): las balas y círculos de un enemigo dentro de la Cala dañan a
  los demás enemigos de la Cala (no a sí mismo); el herido se vuelve contra quien le dio (`b.foe`, 6 s:
  `pickTarget` lo prefiere mientras viva y esté en su correa). La bala que acierta desaparece (evento `phit` con
  `e` = el mob).
- **Desalmados** (`renegado`: sable, tajo en círculo que se puede bloquear + abanico de 3 medias lunas;
  `pistolera`: ráfaga de 4 + descarga de 6 perdigones a corta distancia). Vida 260, DEF 6, nivel 7, rápidos.
  Atacan a lo más cercano dentro de su vista: piratas (preferidos) **y** mobs (y entre ellos). Nombres propios
  («Cuervo Malasangre»…), título «Desalmado», reaparecen a los 75 s. Al morir sueltan su «equipo»: 2 objetos (nivel
  7 + 3, rareza + 0.8, uno al menos Poco común), 25–50 oro y poción al 40 %, públicos. Se dibujan con los looks
  de jugador (Bucanero con sable, Tormenta con pistolas).

### 2.6 Cliente (P4)
- Frontera: anillo rojo en el suelo a R (shader como las runas) + tótems y banderas. Entrar: cartel de zona con
  aviso («Sin ley: fuego amigo · si caes, pierdes lo que llevas») y la primera vez un aviso largo; salir: «A
  salvo». Chip «☠ SIN LEY» en el HUD mientras estás dentro, viñeta roja suave.
- Placas: los piratas dentro de la Cala en rojo con ☠; los Desalmados con su título.
- Daño PvP: número sobre la víctima para quien golpea; destellos de golpe también sobre piratas (predicción
  visual del melee). Avisos de muerte: «Fulano hundió a Mengano» / «Te hundió Fulano» / «Hundiste a Fulano».
- Botín público: haces y etiquetas para todos; lo derramado lleva «☠ de Fulano»; cuando otro lo recoge vuela hacia
  él. Muerte en la Cala: «Lo perdiste todo en la Cala · tu botín sigue en el suelo 3 min»; marca 💀 en el mapa y
  el disolvente de palmeras apunta a tu botín.
- Mapa: la Cala en rojo con su calavera y el desvío. Tía Perla y Brea avisan de la Cala en sus líneas.

### 2.7 Protocolo v5
- `PROTOCOL_VERSION` 5 (los clientes de M4 no entenderían el botín público). Eventos: `loot` / `unloot` con
  `pub`, `spill` (privado), `hurt` con `kind: 'pvp'` y `by`, `death` con `by`. Perfil: `stats.pk`,
  `stats.deaths` (los guardados de M4 se cargan igual).

## 3. Pasos

- [x] **P0** Este plan.
- [ ] **P1 Detalles**: aviso / etiqueta del cofre, segundo cilindro de oclusión, cofres de Marea (datos, `buy`,
  puesto). Tests de compra (requisito de Marea, precio, nivel / rareza).
- [ ] **P2 La Cala (sim)**: lugar y desvío en `worldgen` (con la isla de fuera intacta), `ZONES`, punto de
  control, `src/data/lawless.js`, `canHit` + historial de piratas + `hurtByPlayer`, botín completo y caídas
  públicas, protocolo v5. Tests `tests/lawless.test.mjs` (la isla de fuera no cambia; fuera no hay fuego amigo;
  dentro el sable, las pistolas y los reflejos dañan; la guardia bloquea; morir dentro lo derrama todo y otro lo
  recoge; fuera no se pierde nada; el recién llegado ve las caídas públicas).
- [ ] **P3 Mobs y Desalmados**: generadores con «Sin ley», peleas entre mobs, Desalmados (datos, IA, botín). Tests
  (una bala de arquero hiere a un grumete de la Cala y este se vuelve; fuera no; un Desalmado ataca a un mob;
  su botín es público).
- [ ] **P4 Cliente**: frontera, carteles, chip, placas, números y avisos de muerte, botín público, pantalla de
  muerte, mapa, líneas de los PNJ. Capturas y prueba en el navegador (solo y en línea con dos clientes).
- [ ] **P5 Cierre**: playtest (`tools/lawless.mjs`: dos bots con equipo se pelean en la Cala → tiempo hasta
  morir; los mobs se pelean), ajuste de `pvpDmg`, README («Qué incluye M4.5»), DESIGN §9 / §10 / §16, versión
  `0.4.5-m4.5`, artefacto, informe final.

## 4. Notas de implementación (rellenar al cerrar cada paso)

- **P0:** plan escrito tras leer `world.js`, `combat.js`, `skills.js`, `enemies.js`, `projectiles.js`,
  `inventory.js`, `quests.js`, `worldgen.js`, `localServer.js`, `gameClient.js`, `feedback.js` y el render de
  personajes y props.
