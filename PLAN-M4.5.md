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
  Atacan a lo más cercano dentro de su vista: piratas (preferidos) **y** mobs (nunca a otro Desalmado). Nombres propios
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
- [x] **P1 Detalles**: aviso / etiqueta del cofre, segundo cilindro de oclusión, cofres de Marea (datos, `buy`,
  puesto). Tests de compra (requisito de Marea, precio, nivel / rareza).
- [x] **P2 La Cala (sim)**: lugar y desvío en `worldgen` (con la isla de fuera intacta), `ZONES`, punto de
  control, `src/data/lawless.js`, `canHit` + historial de piratas + `hurtByPlayer`, botín completo y caídas
  públicas, protocolo v5. Tests `tests/lawless.test.mjs` (la isla de fuera no cambia; fuera no hay fuego amigo;
  dentro el sable, las pistolas y los reflejos dañan; la guardia bloquea; morir dentro lo derrama todo y otro lo
  recoge; fuera no se pierde nada; el recién llegado ve las caídas públicas).
- [x] **P3 Mobs y Desalmados**: generadores con «Sin ley», peleas entre mobs, Desalmados (datos, IA, botín). Tests
  (una bala de arquero hiere a un grumete de la Cala y este se vuelve; fuera no; un Desalmado ataca a un mob;
  su botín es público).
- [x] **P4 Cliente**: frontera, carteles, chip, placas, números y avisos de muerte, botín público, pantalla de
  muerte, mapa, líneas de los PNJ. Capturas y prueba en el navegador (solo y en línea con dos clientes).
- [ ] **P5 Cierre**: playtest (`tools/lawless.mjs`: dos bots con equipo se pelean en la Cala → tiempo hasta
  morir; los mobs se pelean), ajuste de `pvpDmg`, README («Qué incluye M4.5»), DESIGN §9 / §10 / §16, versión
  `0.4.5-m4.5`, artefacto, informe final.

## 4. Notas de implementación (rellenar al cerrar cada paso)

- **P0:** plan escrito tras leer `world.js`, `combat.js`, `skills.js`, `enemies.js`, `projectiles.js`,
  `inventory.js`, `quests.js`, `worldgen.js`, `localServer.js`, `gameClient.js`, `feedback.js` y el render de
  personajes y props.
- **P1:** el aviso de `F` de un cofre va bajo el cofre (no bajo tus pies, donde lo tapaba) y dice «F Abrir · Cofre de
  HELLFIRE» en su color; la etiqueta de ese cofre se oculta mientras (`rewards.promptDrop`) y cualquier etiqueta de
  botín bajo un aviso se atenúa al 22 % (`worldui`: los avisos se colocan antes que las etiquetas). Oclusión:
  `U.mnOcc2` (xyz + encendido) y `mnOccFade()` en `FRAG_PARS`; `rewards.focusPoint()` (tu cofre a ≤ 10 u) →
  `scene.update(ctx.occ2)`. Oro: `CONSUMABLES.crate2` / `crate3` con `crate {tier, ilvl, rar, minRarity}`,
  `CRATES`; `buy` los trata a todos igual (falla con `tier` si no has abierto esa Marea; solo mercancía propia de
  `CONSUMABLES`). El puesto enseña los tres cofres (el bloqueado con 🔒 y lo que hace falta). Verificado en el
  navegador (cofre tras palmeras, aviso, compra de un Cofre de la Marea II: nivel + 3). 130 tests.
- **P2:** `worldgen.js`: `L.cala` (−35, 66), `calaR` 21, `calaTrail` (de (−37, 6) a (−36, 45.5)), `calaSign`,
  `calaCp`; `trailInfo`, `calaClear`. Las palmeras, arbustos, rocas y flores que caerían en la Cala o en el desvío se
  descartan tras sus tiradas con `ghost()`: gasta las dos tiradas que habría hecho `addProp` (giro y variante) y deja
  su entrada en la rejilla de separación, así que fuera de la Cala no cambia ningún prop (comprobado: 35 quitados,
  0 movidos, 0 nuevos; el terreno solo cambia dentro de R + 7 y a ≤ 8 u del desvío). Tras la vegetación el suelo se
  asienta hacia 3.6 (con el 30 % de su relieve) y el desvío es una rampa; los props tocados suben o bajan con él.
  Decorado fijo: 16 tótems (`skullPost`) con hueco en la entrada, arcos de empalizada (`palisade`), cajas y
  barriles, 4 braseros, la hoguera y la bandera negra (`blackFlag`, ondea en `scene.update`); cartel «CALA
  CALAVERA · SIN LEY →» (`sign` con `h: 1`; `props.js` dibuja todos los carteles). `masks().path` pinta el desvío y
  el suelo del fuerte; `zoneAt` → `calavera`; `map.lawlessAt`, `map.cala {x, z, r, trail, entry, sign}`, punto de
  control `calavera` fuera del círculo. `src/data/lawless.js` (`LAWLESS`: `pvpDmg` 0.6, `heavyStagger` 0.3,
  `shockStagger` 0.5 a ≤ 3.2 u, `spill` 180 s / 0.8–2.6 u, `publicLife` 150 s). `World.canHit / hitState / strike /
  lawless`: todos los golpes de jugador (`meleeHits`, `lungeHits`, `crescentHits`, `rainHits`, `waveHits`,
  `stepShots`, `bounceShot`) pasan por ahí; `world.phist` guarda el historial de los piratas (`recordHistory` con
  registro propio, `historyAt` lo busca si no hay cerebro). `combat.js`: `hurtByPlayer` (dash → `dodge`, invulnerable
  → nada, guardia perfecta → nada y aturde al atacante cercano, bloqueo → × `blockMult` y aguante, si no → `hurtPlayer`
  con crítico del atacante, `kind: 'pvp'`, `by`); `hurtPlayer` admite `pierce` y `by`; `killPlayer` emite `death {by}` y
  llama `world.onDeath`. `inventory.js`: `spillOnDeath` (todo el equipo salvo el arma inicial, la bolsa y las
  pociones → caídas públicas con `from`; arma inicial del mismo kit; `stats.deaths` / `stats.pk`; evento privado
  `spill`), caídas públicas (`to: 0`, `loot {pub}` / `unloot {pub, by}`, el primero que la pisa y puede cargarla;
  se renumera al recogerla), `lootOnKill` en la Cala tira una vez y deja público (`T.gear` para el equipo de los
  Desalmados, P3), `publicDrops` → el que entra recibe `loot {pub, late}`. `spill` guarda al momento. Protocolo v5.
  La Cala vista en el navegador (tótems, empalizadas, cartel, cartel de zona). 137 tests.
- **P3:** `LAWLESS.spawns` (13: 4 grumetes, 2 arqueros, 2 diablillos, chamán, cangrejo y 3 Desalmados) entran en
  `map.enemySpawns` con `extra {cala, tier: LAWLESS.tier, hpMul}` (el cerebro hereda `tier`: daño, XP y loot de
  «Sin ley») y los Desalmados con `name` propio (`LAWLESS.names`). Los generadores de la Cala reaparecen aunque haya
  piratas cerca, levantándose del suelo (`riseT` 1.1 s). `systems/lawless.js` `stepInfighting` (tras `stepShots`):
  balas armadas de un mob dentro de la Cala que tocan a otro mob de dentro → `phit {ff}` + `damageEnemy(kind: 'ff')`;
  círculos que estallan ese tick, igual. `damageEnemy` con un mob como autor pone `b.foe` (6 s) y `pickTarget` lo
  prefiere mientras viva y esté en su correa. Desalmados (`ENEMIES.renegado`: tajo en círculo + media luna de 3;
  `ENEMIES.pistolera`: ráfaga de 4 + descarga de 6 perdigones de 0.7 s, `life` en el patrón), `renegade: true`:
  `pickTarget` pesa la distancia a un pirata × 0.7 y, mientras haya un pirata a ≤ R + 18 u (`world.calaAwake`, cada 30
  ticks), también caza mobs de la Cala (nunca a otro Desalmado). Sin piratas cerca, la Cala duerme (sin eventos ni
  muertes). `LOOT.renegado / pistolera.gear` (2 objetos, rareza + 0.8, el primero al menos Poco común) en
  `lootOnKill`. Medido en 3 min con un pirata quieto en la Cala: ~20 muertes entre mobs (la mitad a manos de
  Desalmados), ~18 reapariciones, ~20 caídas públicas. 140 tests.
- **P4:** `render/vfx/calaring.js` (anillo de 220 segmentos a R ± 0.55 pegado al suelo, capa FX: banda roja con
  marcas que late y se aviva al entrar), bandera negra que ondea. `hud`: chip «☠ SIN LEY» en la fila del oro, viñeta
  roja (`.law-vig`), `showZone(..., 'lawless')` en rojo; `main.enterZone`: aviso largo la primera vez
  (`settings.calaTaught`), «A salvo» al salir. Placas: `worldUI.setPlateHostile` (rojas con ☠) para los piratas que
  pueden herirte (los dos dentro); los Desalmados con su título y su nombre. `feedback`: números de daño PvP para quien
  golpea (crítico / bloqueo) y sonido de carne; `gameClient.predictMelee` también destella sobre piratas dentro.
  `main.killFeed`: «☠ Te hundió X» / «☠ Hundiste a Y» / «X hundió a Y» (a ≤ 45 u). `rewards`: caídas públicas
  (`handlePublic`: aparecen para todos, «☠ Fulano» / «☠ tuyo» en la etiqueta, vuelan hacia quien las recoge),
  «¡Recuperado!», aviso de `spill` y `spillAt()` → 💀 en el mapa. `mapview`: la Cala en rojo con su ☠ (el nombre bajo el
  anillo, que el del Sendero queda al lado), leyenda «Sin ley». Looks «Desalmado» / «Desalmada» (`charlooks`,
  `ENEMY_LOOK`, poses de sus ataques; la pistolera lleva pistolas). Probado en el navegador con dos clientes en el
  servidor Node (un navegador cada uno: con uno solo, el segundo no abre su socket en 4 s con swiftshader): placas
  rojas, chip y viñeta, números, «Hundiste a Mendoza» en A; en B `death {by}`, `spill` (3 objetos y 2 pociones) y
  `respawn`, con «Te hundió Barbanegra», «Lo perdiste todo en la Cala…» y «A salvo» al levantarse fuera; B se queda sin
  bolsa, sombrero ni pociones y A lo recoge con «☠ Mendoza» en las etiquetas; 💀 en el mapa de B. Arreglos que
  salieron: la ventana de gracia tras un golpe (0.35 s, para las balas) se comía el segundo tajo de cada combo contra
  un pirata → el sable y la estocada la atraviesan (test); la placa de quien te pelea se ocultaba al tapar a tu
  personaje (la regla de las placas) → la de un pirata hostil queda, al 55 %; las fichas de la tripulación tapaban la
  fila del oro (desde M4) y los avisos tapaban las fichas → van debajo, con la escala de la interfaz; el disolvente de
  palmeras apunta también a lo que derramaste. En solo salieron dos de la sim: una pirata quieta en la Cala subía de
  nivel con las muertes entre mobs (la XP iba a todo pirata a ≤ 25 u) → `killEnemy` da la muerte de un mob rematado
  por otro al último pirata que lo hirió en `LAWLESS.assist` (8 s) y, si no hay, sin XP ni misión (el botín cae igual);
  y los Desalmados se enzarzaban entre ellos (sus círculos se tocaban y `foe` los encadenaba) o con los mobs sin mirar
  a la pirata → no se hieren entre ellos, van a por un pirata a su alcance antes que a cualquier mob, y el golpe de
  un pirata devuelve a un mob contra él. Con eso, una pirata de nivel 1 quieta dentro cae a los ~8 s (11 veces en
  3 min). 143 tests.
