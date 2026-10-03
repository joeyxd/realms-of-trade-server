# PLAN M3.5 — Combate V2: apuntar al cursor, reflejo con la espada en 3 niveles, guardia y armas con habilidades

> Documento de traspaso. Si la sesión se corta, cualquier modelo puede seguir desde la primera casilla `[ ]`
> sin leer el historial. Cada paso termina con tests en verde + commit + push. Marca `[x]` al terminar.
> Base: M3 terminado (`PLAN-M3.md`, 55 tests en verde, versión `0.3.0-m3`).

## 0. Contexto mínimo (leer primero)

- Repo `joeyxd/realms-of-trade-server`, rama **`claude/loving-lovelace-ptbif7`** (PR #1 abierto: no abrir otro).
- Juego «MAREA NEGRA»: ARPG isométrico toon (bullet hell), Three.js 0.160, sim determinista + servidor local en
  un worker. Diseño en `DESIGN.md` (§4 controles, §5 movimiento, §6 proyectiles, §9 progresión, §10 red, §16).
- Decisiones del autor (confirmadas): **el frente sigue al ratón / stick derecho**; **LMB = espada**, el
  reflejo es un **golpe a tiempo con 3 niveles** (EXCELENTE / BUENO / POBRE); **RMB = guardia** y una
  **guardia a tiempo tiene efecto**; hay **ataque a distancia**; **el arma equipada define las habilidades**
  (estilo Albion); el Combate V2 va **antes de M4**. Después: servidor Node real + cooperativo, M4, ciudad.
- Tests: `npm test`. **Nunca** empujar en rojo. Capturas: `node tools/shot.mjs <dir>` (en el contenedor:
  `MN_LIBS=<scratchpad>/libs`). Balance: `LV=5 SKILL=0.8 node tools/playtest.mjs` (+ `WEAPON=pistolas`).
- Artefacto: `node tools/build-artifact.mjs dist/index.html` → republicar en la MISMA URL
  https://claude.ai/artifact/MpCdPMbgw41nJKcf8NvSrD (antes: `Artifact list scope:"files" url:<esa>`).
- Commits terminan con:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Md1KNYppmXci5NXt42VucC
  ```
  Sin IDs de modelo en commits/código. Push: `git push -u origin claude/loving-lovelace-ptbif7`.
- Respuesta final al usuario **en español**, con enlaces al PR #1 y al artefacto.

### Reglas del código (las de M3 siguen valiendo)
1. Sim determinista: nada de `Math.random` en `src/sim/**`. Lo «aleatorio» que el cliente predice (desvío
   de un reflejo BUENO/POBRE, dispersión de la pistola) sale de un **hash** de datos compartidos
   (`hash01(pid, seq, k)` en `src/core/rng.js`), nunca de `world.rng`.
2. **Todo lo que toca balas hostiles va dentro del paso del comando** (`stepPlayerCombat`, evaluado en el
   tick `pt`), para que la predicción y la reconciliación lo repitan igual: reflejos, guardia, la onda de la
   Hoja de viento, la Descarga y la Lluvia de plomo limpiando balas. Las balas destruidas llevan `(e, seq)`.
3. **El daño a enemigos lo decide solo el servidor** (`world.isServer`), contra las posiciones que el jugador
   veía (`historyAt(pt − interpTicks)`, como el melee de M2). Los disparos del jugador (reflejos, balas,
   perdigones, devoluciones) también: cada disparo guarda su `lag` y el servidor lo prueba contra la historia.
4. Estado nuevo del jugador que se predice → columna en `ECS` + nombre en `PLAYER_FIELDS` (`src/sim/ecs.js`).
5. Comentarios en inglés, UI en español, números en `src/data/*` (`tuning.js`, `weapons.js` nuevo).
6. Materiales nuevos → `prewarm()` en `src/render/scene.js`. FX: `LAYER.FX`, `...FXU`, `#include <colorspace_fragment>`.

## 1. Objetivo

Que el combate se sienta como un **MOBA de habilidades apuntadas** dentro del bullet hell:
- Tu frente es tu cursor: caminas en una dirección y miras/atacas en otra (piernas con el movimiento, torso
  con el cursor). El parry frontal, la placa del cangrejo y la guardia cobran sentido.
- **La espada es la defensa con timing**: golpear la bala justo antes de que te toque la devuelve; cuanto más
  tarde (y más peligroso), mejor el reflejo. Aporrear el clic solo destruye balas lejos.
- **La guardia (RMB) es la seguridad**: mantenerla reduce el daño de frente y gasta aguante; subirla justo a
  tiempo **atrapa** la bala (¡ATRAPADA!) y el siguiente ataque la devuelve.
- **El arma define tu kit** (Q, E, R y el ataque básico). Dos armas en M3.5: **Sable de cubierta** (cuerpo a
  cuerpo, reflejos) y **Pistolas de chispa** (a distancia). Se cambian en los **armeros** del mundo.

## 2. Especificación

### 2.1 Apuntar (sim + entrada)

- `cmd.ax, cmd.az` (ya existen: punto del mundo) + bit nuevo **`BTN.AIM = 128`** en `cmd.btn` = «el apuntado es
  explícito» (ratón movido o stick derecho inclinado).
- `movement.js`: con `AIM` y `|aim − pos| > 0.15` → `facing = dampAngle(facing, atan2(aim − pos), aimLambda 30)`;
  sin `AIM` → como hoy (mira hacia donde caminas). `faceLock` se sigue respetando (golpes). En el dash, la
  dirección del dash. Las acciones (golpe, guardia, habilidades) siguen girando al apuntado al pulsarse
  (`faceAim`), con o sin `AIM` (táctil y teclado usan el auto-apuntado).
- **Retroceso:** moverse a > 110° del frente → velocidad × `backMul 0.9` (de lado × 1).
- **Mando (Gamepad API, nuevo en `src/core/input.js`):** stick izq. mueve, stick der. apunta (`AIM` si
  `|stick| > 0.3`; punto = jugador + dir × 4 u, mismo look-ahead de cámara que el ratón), **RT** espada/disparo
  (mantener = disparo continuo con pistolas), **LT** guardia (mantener), **A** dash, **X** interactuar,
  **RB** Q, **LB** E, **Y** R, **Start** pausa. Zona muerta 0.18. Sin stick derecho = auto-apuntado como en táctil.
- **Teclado sin ratón:** J espada, **K guardia (mantener)**, Q/E/R; auto-apuntado (amenaza más inminente → enemigo
  más cercano → dirección de movimiento).
- **Animación (`characters.js`):** ángulo local del movimiento `lm = atan2(vx, vz) − f`. Adelante/lado: cadera
  gira hacia el movimiento `clamp(lm, ±1.1)`; atrás (|lm| > 1.9): cadera `clamp(lm − π, ±0.9)` y la zancada va
  **hacia atrás**. Columna y pecho contrarrotan (−0.5 / −0.4 × giro de cadera): el torso sigue al cursor. Inclinación
  adelante/atrás con `cos(lm)`, alabeo lateral con `sin(lm)`.

### 2.2 Espada: reflejo a tiempo en 3 niveles (sustituye al parry de RMB)

En los frames activos de cada golpe del combo (`swingActive`), para cada bala hostil viva dentro del arco:

```
tc = tiempo hasta que la bala tocaría tu hurtbox (raíz de |p + v·t| = hurtR + r + slack), ∞ si no viene a ti
PARREABLE:  tc ≤ 0.07 → EXCELENTE · tc ≤ 0.15 → BUENO · tc ≤ 0.26 → POBRE · si no → DESTRUIDA (como hoy)
PESADO:     tc ≤ 0.07 → EXCELENTE (se devuelve el orbe pesado) · si no → «clunk» (sigue su camino)
IMPARABLE:  la espada no la toca (dash = FANTASMA)
```
`slack = 0.15 u` (una bala que te iba a rozar cuenta como «viene a ti»). Golpe 3 (360°): devuelve **radial**.

| Nivel | Dirección | Velocidad | Daño (`R = max(dañoBala, 0.8·ATK)`) | Homing | Rebotes | RIPOSTE | Feel |
|---|---|---|---|---|---|---|---|
| **EXCELENTE** | recta al cursor | × 1.9 (mín. 9) | **R × 3** | 1.5 rad/s, cono 24° | 2 | +18, +5 XP | hitstop 0.11 · slow-mo 0.35× 0.25 s · flash · onda · «¡EXCELENTE!» |
| **BUENO** | cursor ± 10° (hash) | × 1.4 | R × 2 (el reflejo de hoy) | 4 rad/s, cono 60° | 1 | +10 | hitstop 0.08 · «BUENO» |
| **POBRE** | cursor ± 35° (hash) | × 1.0 | R × 1 | 0 | 0 | +5 | hitstop 0.05 · «POBRE» |
| destruida | — | — | — | — | — | +4 | como hoy |

- La **cadena** (x1 → x5, ≤ 1.2 s) sube con EXCELENTE y BUENO; POBRE ni sube ni corta.
- **Coyote (60 ms, sigue):** si una parreable te tocó y aún no hizo daño, **LMB** la convierte en un reflejo
  **POBRE** desde tu posición («¡JUSTO!»); **RMB** la convierte en un bloqueo de guardia (daño × 0.25).
- Evento: `parry {pid, e, seq, x, z, tier: 3|2|1, perfect (= tier 3), chain, heavy}` (se mantiene el nombre).
- Se borran el parry de RMB y su whiff (`parryT`, `parryLock`, `parryBuf`, `parryHits`): RMB es la guardia.

### 2.3 Guardia (RMB mantenido, todas las armas)

| Parámetro | Valor |
|---|---|
| Arco frontal | 130° (la bala o el dueño del círculo dentro del arco al contacto) |
| Bloqueo | parreable: daño × 0.25 · pesado: × 0.4 + empujón 7 · sin i-frames (`noInv`), empujón 2 |
| Aguante | 60; cuesta `1.0 × dañoBruto` (pesado `1.5 ×`); recarga 30/s tras 0.7 s sin bloquear; a 0 → **GUARDIA ROTA** (aturdido 0.9 s) |
| Movimiento | × 0.45 mientras está alzada; el frente sigue al cursor |
| **Guardia PERFECTA** | el golpe llega ≤ **0.13 s** después de alzarla → 0 daño, 0 aguante, **¡ATRAPADA!** |
| Rearme | una nueva ventana perfecta exige ≥ 0.45 s desde la anterior (aporrear RMB no sirve) |
| Imparables | atraviesan la guardia: daño completo + aturdido 0.3 s («¡IMPARABLE!»), como hoy |
| Círculos | los de cuerpo a cuerpo (mordisco, tajo, golpe del jefe) se bloquean; los que caen del cielo (`keep`: mortero, meteoro), los láseres, carriles y la lava **no** |
| Interacción | LMB o una habilidad bajan la guardia; el dash la baja; durante windup/activo de un golpe RMB queda en búfer |

**Guardia perfecta = atrapar.** Cada bala parreable/pesada atrapada se guarda (máx. **3**, caducan a los 6 s):
`catchN`, `catchHv` (cuántas pesadas), `catchDmg` (máx. daño). El **siguiente ataque básico** (golpe de sable o
disparo de pistola) las **devuelve todas** al cursor en abanico (7° entre ellas): nivel BUENO pero homing 2 rad/s,
daño `2 × max(catchDmg, 0.8·ATK)`, las pesadas salen pesadas (× 3, rompen el escudo del jefe). Cuentan como
**reflejos** (`kind 'shot'`: ignoran blindaje y escudo). Además: los enemigos a ≤ 3 u en wind-up/ataque quedan
**aturdidos 0.7 s** (servidor, `cancelEmitter`), +12 RIPOSTE, +3 XP, hitstop 0.09, slow-mo 0.5× 0.15 s.
Eventos: `guard {e, seq, st: 'up'|'block'|'perfect'|'break', pid, x, z, n}` y `release {e, seq, n, heavy}`.

### 2.4 Armas y habilidades (`src/data/weapons.js`, nuevo)

```js
export const WEAPONS = {
  sable:    { name: 'Sable de cubierta',  basic: 'combo',  q: 'lunge', e: 'wave',  r: 'storm' },
  pistolas: { name: 'Pistolas de chispa', basic: 'pistol', q: 'blast', e: 'blink', r: 'rain'  },
};
export const WEAPON_KINDS = Object.keys(WEAPONS); // índice = ecs.weapon
export const SKILLS = { lunge: {...}, wave: {...}, storm: {...}, pistol: {...}, blast: {...}, blink: {...}, rain: {...} };
```
Guardia, dash y medidor RIPOSTE son de todas las armas. **R** consume RIPOSTE 100 y es distinta por arma.
Q y E tienen enfriamiento propio (`cdQ`, `cdE`, predichos). Las habilidades se lanzan **al cursor** al pulsar
(búfer 130 ms), cancelan la guardia, no se lanzan aturdido/muerto/dasheando; durante su windup/activo no se
puede empezar un dash (el búfer del dash espera). Desbloqueo por nivel de DESIGN §9 → **reemplazado**: el kit
entero está disponible desde Lv 1 (M4 lo atará a la maestría del arma, como Albion).

**Sable de cubierta** (cuerpo a cuerpo, reflejos)

| Tecla | Habilidad | Números |
|---|---|---|
| LMB | Combo de 3 + **reflejo a tiempo** (§2.2) | etapas de `tuning.melee` (igual que hoy) |
| Q | **Estocada**: embestida al cursor que atraviesa la línea | windup 0.08 s · 4.5 u en 0.16 s (curva del dash) · recover 0.22 s · ATK × 1.8 a los enemigos a ≤ 1.0 u del recorrido (una vez, aturde como el 3.er golpe) · destruye parreables a ≤ 1.0 u · **sin i-frames** · CD 7 s |
| E | **Hoja de viento**: media luna que vuela al cursor (el ataque a distancia del sable) | windup 0.12 s · 14 u/s · 0.75 s (≈ 10 u, se corta en rocas: `clipDistance`) · media anchura 0.9 · ATK × 1.4 a cada enemigo que cruza (una vez) · **destruye las parreables que cruza** (+2 RIPOSTE c/u, máx. 10) · CD 5 s |
| R | **Tormenta** (la onda RIPOSTE de hoy) | refleja todo a 6 u, ATK × 3 a los enemigos en el radio |

**Pistolas de chispa** (a distancia; reflejan solo atrapando con la guardia)

| Tecla | Habilidad | Números |
|---|---|---|
| LMB (mantener) | **Disparo** alterno (mano izq./der., ±0.24 u lateral) | cada 0.2 s · 20 u/s · 0.65 s (13 u) · radio 0.16 · ATK × 0.6 · dispersión ±1.5° (hash) · sin homing · mover × 0.85 · `kind 'bullet'` (el blindaje y el escudo SÍ cuentan) · no interactúa con balas hostiles |
| Q | **Descarga**: escopetazo en cono | 7 perdigones en 44° · 16 u/s · 0.4 s · ATK × 0.55 c/u · empujón 7 · **sopla las parreables** en 3.2 u / 70° delante · retroceso propio 5 u/s · enraizado 0.15 s · CD 6 s |
| E | **Paso de humo**: blink | teletransporte de hasta 4.5 u hacia donde caminas (o al cursor si estás quieto), por pasos con colisión (no atraviesa rocas) · i-frames 0.3 s (ESQUIVA/FANTASMA cuentan) · nube de humo · CD 7 s |
| R | **Lluvia de plomo**: zona en el cursor (máx. 9 u) | aviso 0.35 s → 1.5 s de lluvia: ATK × 0.55 cada 0.15 s a los enemigos en r 3.2 (perfora DEF) · **borra las parreables dentro** · sigues moviéndote |

Daño por segundo de referencia (ATK 10): pistola ≈ 30 a 13 u; combo de sable ≈ 34 a 2 u + reflejos.

### 2.5 Estado y red

- `ECS` nuevo (todo en `PLAYER_FIELDS`): `weapon` · `guardT` (−1 bajada) · `guardP` (ventana perfecta disponible) ·
  `guardRe` · `guardSt` (aguante) · `guardRegT` · `catchN` · `catchHv` · `catchDmg` · `catchT` · `cdQ` · `cdE` ·
  `castK` (0 nada · 1 Q · 2 E · 3 R) · `castT` · `castX` · `castZ` (dirección o punto) · `qBuf` · `eBuf` · `shotCd` · `shotN` ·
  onda: `waveT0` (tick `pt` de salida, 0 = no hay) · `waveX` · `waveZ` · `waveDx` · `waveDz` · `waveEnd` (ticks) · `waveId` · `waveN` ·
  lluvia: `rainT0` · `rainX` · `rainZ` · `rainId` · estocada: `lungeT` · `lungeDx` · `lungeDz` · `lungeCov`.
- `ACT` nuevos: `GUARD 4` (el hueco del parry), `LUNGE 15, THROW 16, SHOOT 17, BLAST 18, CAST 19` (animación de los demás).
- Comando: `cmd.w` = arma pedida + 1 (0 = sin cambio). `sanitizeCmd` lo acepta (`& 0x0f`). La sim cambia de arma
  solo **a ≤ 2.4 u de un armero** (`map.racks`, determinista): predicho y validado igual. Evento `equip {e, weapon, seq}`.
- `HELLO {…, weapon}` (arma inicial, la última que usaste: `settings.weapon`), `describe()` y la snapshot
  (`ENT.WPN = 17`) llevan el arma para dibujar a los demás.
- **Disparos (`Shots`)**: columnas nuevas `key` (adopción: `pid` para reflejos, `−(seq·8 + k)` para disparos de
  habilidades y devoluciones), `homing`, `kind` (0 reflejo · 1 bala · 2 perdigón · 3 devolución), `knock`, `lag`.
  El cliente adopta el disparo del servidor por `key` (hoy por `pid`). `stepShots` del servidor prueba impactos y
  homing contra `historyAt(tick − lag)`, con `lag = clamp(tick − pt, 0, rewind) + interpTicks` (favorece al que
  dispara, como el melee). Los rebotes heredan el `lag`.
- Eventos de habilidades para los demás jugadores (los tuyos ya se ven por predicción): `cast {e, skill, seq, x, z}`,
  `wave {e, id, x, z, dx, dz, tick, end, speed, w}`, `rain {e, id, x, z, tick, dur, r}`, `blink {e, x0, z0, x1, z1}`.

### 2.6 Render / UI / audio

- **Armas en la mano** (`charlooks.js`): `buildLook(idx, wpn)` con `wpn` = `null | 'own' | 'pistols'`; pistolas de
  chispa (cañón de latón, culata de madera, llave) en ambos puños. `CharacterView.setWeapon(kind)` cambia la
  geometría del `SkinnedMesh` (mismo esqueleto). Los enemigos no cambian.
- **Poses** (`characters.js`): guardia del sable (hoja cruzada delante, brazo libre de apoyo) y de pistolas
  (brazos cruzados delante del pecho); pistolas apuntando al frente con retroceso alterno; estocada (brazo
  extendido, cuerpo bajo); lanzamiento de la hoja (tajo horizontal amplio); descarga (dos manos al frente, golpe
  atrás); lluvia (brazo arriba).
- **FX:** color del reflejo por nivel (EXCELENTE blanco-dorado con estela larga, BUENO acento, POBRE tenue y corta);
  arco de guardia con el color del aguante (acento → naranja → rojo) y destello al bloquear; **balas atrapadas**
  orbitando sobre el hombro (1–3, rojas si pesadas); fogonazo y trazador de pistola (amarillo); media luna de la
  Hoja de viento (shader de arco que vuela); humo y afterimage del blink; zona de lluvia (círculo + gotas de plomo
  estiradas cayendo + chispas en el suelo); **armero** (estante de madera con sable y pistolas, prop + colisión).
- **HUD:** la barra de acción cambia con el arma (iconos y textos de LMB, Q, E, R), Q/E con barrido de
  enfriamiento, RMB con el aguante y 3 puntos de balas atrapadas, R con el medidor; floats «¡EXCELENTE!»,
  «BUENO», «POBRE», «¡ATRAPADA!», «GUARDIA ROTA», «x3 DEVUELTAS»; toast al equipar con el kit.
- **Táctil:** ATK (pistolas: mantener = continuo), **GUARDIA (mantener)**, DASH, **Q y E arrastrables** (tocar =
  auto-apuntado; arrastrar = flecha/círculo de apuntado; soltar = lanzar; arrastrar de vuelta al botón =
  cancelar), R igual, F contextual.
- **Tutorial:** el cañón de práctica enseña el reflejo a tiempo con la espada («LMB justo antes del impacto»,
  pide un BUENO o EXCELENTE) y después la guardia («mantén RMB… súbela justo a tiempo para ATRAPAR; LMB para
  devolverla»); el armero de la playa: «F para probar las pistolas».
- **Audio:** golpe de reflejo por nivel (EXCELENTE = «clang» brillante + campanilla), bloqueo (golpe sordo),
  guardia perfecta (clang + «tink» de atrapar), guardia rota, devolución, pistoletazo (alterna tono), descarga,
  blink (whoosh con humo), lluvia (repiqueteo), estocada, hoja de viento.
- **F4:** botón «Arma: sable/pistolas» (equipa sin armero), umbrales de niveles y guardia editables.

## 3. Pasos

- [x] **P0** Este plan (commit + push).
- [x] **P1** Apuntar: `BTN.AIM`, frente al cursor en `movement.js` (+ `backMul`), mando (Gamepad API), K mantenida,
  piernas/torso separados en `characters.js`. Tests: el frente sigue al apuntado y no al movimiento con `AIM`,
  vuelve a seguir al movimiento sin `AIM`, el retroceso es más lento; la predicción sigue exacta.
- [x] **P2** Espada V2 + guardia: niveles por `tc` en `swingActive`, coyote con LMB (POBRE) y RMB (bloqueo), borrar
  el parry de RMB, guardia completa (bloqueo, aguante, rotura, perfecta, rearme, imparables, círculos), atrapar y
  devolver con el siguiente golpe, aturdir a los de cerca (servidor). Mínimo de feedback/HUD/tutorial para que se
  pueda jugar. Reescribir los tests de parry (`combat.test.mjs`, `m25`, `m3`) y la política del bot
  (`tools/playtest.mjs`). Tests nuevos: los 3 niveles según el momento del golpe (y sus daños/velocidades),
  desvío determinista igual en cliente y servidor, pesado solo en EXCELENTE, aporrear destruye pero no refleja,
  guardia bloquea × 0.25 y gasta aguante, rotura aturde, perfecta atrapa y el golpe siguiente devuelve,
  rearme, imparable atraviesa la guardia, círculo del cielo no se bloquea, predicción exacta con guardias.
- [x] **P3** Armas: `weapons.js`, columnas ECS, `cmd.w`, armeros (`map.racks` en `worldgen.js` sin mover nada más
  de la isla), `equip`, HELLO/describe/snapshot con arma, `Shots` con `key/homing/kind/knock/lag`, adopción por
  `key`, impactos con `historyAt(tick − lag)`. Tests: solo se cambia junto a un armero, la predicción del cambio
  es exacta, un disparo acierta donde el cliente veía al enemigo con 150 ms de lag.
- [x] **P4** Sable: Estocada, Hoja de viento (onda analítica en el comando), Tormenta como R del sable. Tests:
  la estocada recorre 4.5 u, daña una vez y destruye balas; la hoja destruye las parreables que cruza (también en la
  predicción) y daña una vez a cada enemigo; enfriamientos.
- [x] **P5** Pistolas: disparo continuo, Descarga, Paso de humo, Lluvia de plomo; la devolución de atrapadas con
  pistola. Tests: cadencia y daño, el escudo/blindaje frenan las balas pero no las devueltas, la descarga sopla
  balas, el blink no atraviesa rocas y da i-frames, la lluvia daña cada 0.15 s y borra balas; predicción exacta.
- [x] **P6** Render: pistolas en la mano + `setWeapon`, poses (guardia ×2, apuntar, estocada, hoja, descarga, lluvia),
  FX (niveles, guardia, atrapadas, fogonazo/trazador, media luna, humo/blink, lluvia), armero, prewarm.
- [x] **P7** UI/audio/tutorial: barra de acción por arma, enfriamientos, aguante y atrapadas, floats, táctil
  (GUARDIA mantenida, Q/E/R arrastrables), tutorial nuevo, sonidos, F4.
- [ ] **P8** Balance con el bot para las dos armas (`WEAPON=pistolas`), perf (≤ 0.5 ms/step), verificación
  (tests, capturas 23-aim-strafe, 24-reflect-excelente, 25-guard-catch, 26-pistolas, 27-lluvia), docs (DESIGN §4 §5
  §6 §9 §10 §16, README), versión `0.3.5-m3.5`, artefacto republicado.

## 4b. Estado real (lo que quedó, difiere del §2 donde se indica)
- P1: `input.aimDevice` ('mouse' | 'gamepad' | 'keys' | 'touch') decide el bit `AIM` (WASD no lo cambia: ratón +
  teclado sigue apuntando con el cursor); el ratón se escucha en toda la ventana (sobre el HUD también). El mando
  se lee cada frame (`input.pollPad()`, Start abre la pausa). `__mn.sheet({ run: true, move: π/2 })` muestra la
  marcha lateral / hacia atrás en la hoja de personajes. Tests en `tests/m35.test.mjs` (+ `tests/helpers.mjs`).
- P2: `ACT.GUARD = 4` reutiliza el número del parry (`ACT.PARRY` queda como alias); `BTN.GUARD = 4` (= `PARRY`).
  `tuning.sword` (niveles), `tuning.guard`, `tuning.parry` queda para la economía del reflejo (cadena, RIPOSTE,
  rebotes, `reflect.wave` = la onda R). Un orbe pesado golpeado antes de tiempo hace «clunk» y ese golpe ya no lo
  puede reflejar. Los círculos llevan `sx, sz` (de dónde viene el golpe) para el arco de la guardia. `Shots` ya
  tiene `key/homing/cone` (adelantado de P3) y el cliente adopta por `key`. Evento `stun {id}` (guardia perfecta).
  Tutorial: paso nuevo «guard» tras «parry». Bot: golpes a tiempo + atrapar orbes pesados (LV6/0.9 ≈ 205 s).
- P3: `src/data/weapons.js` (`WEAPONS`, `WEAPON_KINDS`, `WEAPON`, `SKILLS`, `RACK_R 2.4`; F4 los ajusta con
  `root: 'skills'`). Dos armeros: `map.racks` = playa (junto al spawn) y aldea; su colisión se añade antes de la
  vegetación y su prop después de todos los sorteos (la isla queda idéntica: mismo hash de props sin los armeros).
  El cambio vive en `src/sim/systems/skills.js` (`rackNear`, `stepEquip`, `setWeapon`: suelta golpe, guardia y
  lanzamiento; los enfriamientos siguen). En el cliente F junto a un armero manda `w` en el siguiente comando
  (aviso «F Armero: tomar …», toast con el kit, `settings.weapon` recuerda el arma para el próximo HELLO); F4:
  botón «Arma: cambiar» (op `weapon`, sin armero). `Shots.kind` (`SHOT.REFLECT/BULLET/PELLET/RELEASE`), `knock`,
  `lag`: `spawnShot` recibe `pt` y el servidor calcula `lag`; `stepShots`, el homing y los rebotes usan
  `world.lagPos(e, lag)` (= `historyAt`). Balas y perdigones dañan como `kind 'bullet'` (blindaje, escudo y DEF
  cuentan); reflejos y devoluciones como `'shot'`. Columnas nuevas ya en `PLAYER_FIELDS`: `weapon cdQ cdE qBuf eBuf
  castK castT castX castZ shotCd shotN` (las de onda/lluvia/estocada llegan con P4/P5). Tests en
  `tests/weapons.test.mjs`. El prop del armero se dibuja en P6 (hasta entonces es una colisión invisible).
- P4: lanzamiento genérico en `skills.js` (`bufferSkills`, `tryCast`, `stepCast`, `castPose`): Q/E con búfer, esperan a
  los frames activos de un golpe y cortan su recuperación, bajan la guardia; `castLock` impide empezar un dash en el
  windup/activo (movement.js), un dash en la recuperación la cancela, el aturdido también. ACT nuevos 15–19.
  Estocada: curva del dash por pasos con colisión, sin velocidad residual; destruye parreables a ≤ 1 u del tramo
  recorrido cada tick; `world.lungeHits` (servidor, historial a `pt − interpTicks`, una vez por estocada con
  `swingId`, pesado). Hoja de viento: columnas `wave*` (tick de salida en `pt`, origen, dirección, fin recortado
  con `clipDistance`, id = seq), `stepWave` barre el frente `f(prev) − depth … f(pt)` (antes del chequeo de muerte:
  sigue volando aunque caigas), `world.crescentHits` con `brain.waveBy` (una vez por enemigo). Daño de habilidades:
  `kind 'skill'` (blindaje, escudo y DEF cuentan). Eventos `cast {skill, dx, dz}`, `wave {id, tick, end, …}`,
  `destroy {skill}`. Tests en `tests/sable.test.mjs`.
- P5: disparo de pistola en `combat.js` (es el ataque básico: LMB mantenido o pulsado con búfer, `shotCd`, mano
  alterna con `shotN`, `firePistol` en `skills.js`, clave `−(seq·8 + 5)`, evento `fire {hand}`); con pistolas el
  LMB no refleja (ni coyote: solo RMB bloquea), y el gatillo mantenido gana a la guardia. Descarga: windup 0.05,
  perdigones `SHOT.PELLET` (claves `−(seq·8 + k + 1)`), sopla parreables (+2 RIPOSTE c/u, máx. 10), retroceso por
  `kbx/kbz`, enraizado 0.15 s. Paso de humo: pasos de 0.3 u con `moveWithCollision` (se para si avanza < la mitad),
  i-frames 0.3 (ESQUIVA/FANTASMA como el dash), evento `blink`. Lluvia: `callRain` (punto recortado a 9 u, retraso
  0.35 s), `stepRain` antes del chequeo de muerte (borra parreables dentro; pulsos `t0 + k·9` en `(prev, pt]`),
  `world.rainHits` (historial a `T − interpTicks`, perfora DEF); columnas `rainT0 rainX rainZ rainId`; evento `rain`.
  **Arreglo:** el cliente no adoptaba nunca los disparos predichos (el evento `shot` trae `owner`, no `e`): desde M2
  los reflejos se veían duplicados un momento. Tests en `tests/pistolas.test.mjs`.
- P6: `buildLook(idx, wpn)` con `wpn = false | true | 'pistols'` (pistolas: cañón de latón sobre la caja de
  madera, culata a través del puño, llave y martillo; caché por clave `i`, `ia`, `ip`), `CharacterView.setWeapon`
  cambia la geometría (mismo esqueleto) y `recoil(hand)`; main.js lo fija cada frame desde `ps.weapon` (tú) y
  `rec.r.wpn` (los demás). Poses nuevas: SHOOT (dos brazos al frente, cada uno salta con su disparo), guardia de
  pistolas (antebrazos cruzados), LUNGE, THROW, BLAST (patada), CAST (pistola al cielo). `Shots.tier` (+ evento)
  para el aspecto: EXCELENTE blanco-dorado con estela larga, POBRE tenue y corta; balas y perdigones = trazador
  ámbar (tipo 3 del shader). `src/render/vfx/weaponfx.js`: media luna en el tiempo de proyectil, lluvia (anillo
  del color del jugador, gotas, chispas, polvo; un pulso de anillo + repiqueteo cada 0.15 s), balas atrapadas
  girando sobre el hombro (local), fogonazo + humo, humo del blink (+ afterimage). Guardia teñida por el aguante
  (acento → naranja → rojo). Armero: prop `rack` (postes, travesaño, tablero con el sable, estante con dos
  pistolas, banderín). `Decals.take()` ya no recicla anillos fijos (aro de práctica, runas). Sonidos de armas en
  `sfx.js` (pistola alterna, descarga, blink, lluvia, estocada, media luna, equipar). `__mn.sheet({weapon, fire,
  loop})` para revisar poses.
- P7: `Hud.setWeapon(kind)` (iconos y textos de LMB/Q/E/R, nombre del arma sobre la barra) y
  `setCooldowns(q, qMax, e, eMax)` (barrido cónico + segundos); se quitan los «Pronto». Táctil: ATK y GUARDIA
  mantenidos (`input.touchHeld`), Q / E / R arrastrables (`input.touchAim {x, y, k, release}`: el comando de la
  pulsación lleva ese apuntado con `AIM`, línea de apuntado, soltar sobre el botón cancela), etiquetas por arma,
  barrido de enfriamiento, R brilla con el medidor lleno. Aviso la primera vez junto a un armero; toast con el kit
  al equipar. Controles de la pausa reescritos. F4: 7 deslizadores de habilidades (`root 'skills'`). El tutorial
  sigue con «parry» (reflejo a tiempo) y «guard» de P2; las pistolas se enseñan con el armero y el toast.

## 4. Riesgos y notas
- **Latencia y ventanas cortas:** EXCELENTE es 70 ms de `tc`, pero se mide en el tick `pt` que el jugador veía
  (lag compensation de M2), así que con 150 ms de ping se juzga lo que viste. Revisar en el milestone de red real.
- **Aporrear LMB:** los frames activos cubren ~35 % del tiempo con clic continuo; como las balas se juzgan al entrar
  al arco (lejos → `tc` grande), aporrear destruye pero casi nunca da BUENO/EXCELENTE. Si el bot demuestra lo
  contrario, juzgar el nivel solo en el primer tick activo.
- **Pistolas contra el jefe en fase 2/3:** el escudo frena las balas (× 0.2) → el pistolero depende de atrapar
  (guardia perfecta) y devolver; el orbe pesado atrapado rompe el escudo. Comprobar con el bot que es posible y no
  eterno (objetivo: jefe en < 2× el tiempo del sable).
- La onda de la Hoja de viento y la lluvia viven en columnas del jugador: solo una de cada a la vez (CD > vida).
- `historyAt` guarda 32 ticks: `lag` ≤ 20 + 6 cabe. Si se sube `rewind`, subir `HIST`.
- Cambiar el combate rompe los tests de parry de M2–M3: reescribirlos en P2 conservando lo que miden
  (predicción exacta, lag compensation, rebotes, escudo).
