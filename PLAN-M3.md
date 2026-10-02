# PLAN M3 — 5 oleadas, Cangrejo mortero y HELLFIRE en 3 fases

> Documento de traspaso. Si la sesión se corta, cualquier modelo puede seguir desde la primera casilla `[ ]`
> sin leer el historial. Cada paso termina con tests en verde + commit + push. Marca `[x]` al terminar.
> Base: M2.5 terminado (`PLAN-M2.5.md`, 44 tests en verde, versión `0.2.5-m2.5`).

## 0. Contexto mínimo (leer primero)

- Repo `joeyxd/realms-of-trade-server`, rama **`claude/loving-lovelace-ptbif7`** (PR #1 abierto: no abrir otro).
- Juego «MAREA NEGRA»: ARPG isométrico toon, Three.js 0.160, sim determinista + servidor local en un worker.
  Diseño en `DESIGN.md` (§6 proyectiles, §7 enemigos/oleadas, §8 jefe, §16 milestones). M3 en §16 =
  «Oleadas + enemigos restantes + jefe 3 fases».
- Tests: `npm test`. **Nunca** empujar en rojo. Capturas: `node tools/shot.mjs <dir>` (ver cabecera del archivo;
  en el contenedor: `MN_LIBS=<scratchpad>/libs` para servir three/gsap en local).
- Artefacto: `node tools/build-artifact.mjs dist/index.html` → republicar en la MISMA URL
  https://claude.ai/artifact/MpCdPMbgw41nJKcf8NvSrD (antes: `Artifact list scope:"files" url:<esa>` para que
  deje sobrescribir).
- Commits terminan con:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Md1KNYppmXci5NXt42VucC
  ```
  Sin IDs de modelo en commits/código. Push: `git push -u origin claude/loving-lovelace-ptbif7`.
- Respuesta final al usuario **en español**, con enlaces al PR #1 y al artefacto.

### Reglas del código (las de M2.5 siguen valiendo)
1. Sim determinista: nada de `Math.random` en `src/sim/**` (usar `world.rng` en el servidor).
2. Peligros hostiles **analíticos**: el servidor emite UN evento (pattern / aoe / beam / lava) con TODOS los
   parámetros y el cliente lo reconstruye igual (`src/client/gameClient.js` `case '<tipo>'`). Campo nuevo =
   campo en el evento.
3. IA enemiga y jefe **solo en el servidor**. Lo que el jugador predice (`contacts()` en `combat.js`) corre
   igual en cliente y servidor: todo peligro nuevo que haga daño va en `contacts()` con registro de golpes
   `{e, seq}` (como `a.hits` de los AoE) para que la reconciliación (`gameClient.js` ~l.271) lo deshaga.
4. Comentarios en inglés, UI en español, números en `src/data/*`.
5. Materiales nuevos → `prewarm()` en `src/render/scene.js`. Decals: winding CCW + `fxDepthFadeBias`.
6. FX: `LAYER.FX`, `...FXU`, `#include <colorspace_fragment>`; aditivo premultiplicado como el escudo.

## 1. Objetivo

Completar la Prueba de Fuego según DESIGN §7–§8: **5 oleadas** (llega el **Cangrejo mortero**, blindado por
delante) y **HELLFIRE en 3 fases** con los ataques que faltaban: **Embestida**, **láser doble rotatorio**,
**meteoros**, **carriles de fuego**, **cortina de balas con huecos** y **lava que encoge la arena**.
El dash sigue siendo protagonista: láseres y carriles se cruzan con dash (iframes), la lava obliga a moverse
hacia dentro, los meteoros castigan quedarse quieto.

## 2. Especificación

### 2.1 Primitivas nuevas de la sim (`src/sim/projectiles.js` + `combat.js`)

**a) Patrón `rows` (cortina):** `n` balas por fila, separadas `sp` u en perpendicular a `ang`, centradas en
`(x, z)`; `waves` filas, `gap` s entre filas; en cada fila w se saltan las `hw` posiciones desde `holes[w]`
(el id se consume igual: `patternCount = n·waves`). Campo opcional `life` (s) para que crucen la arena
(se pasa a `Hazards.spawn` como último parámetro). Todo en el evento: `sp, holes[], hw, life`.

**b) AoE «keep»:** `addAoe({..., keep: 1})` = proyectil de mortero/meteoro ya en el aire: NO se cancela si el
dueño muere o es aturdido (`cancelPending`, `killEnemy`, `feedback 'cancel'` lo respetan); `clear()` sí lo
cancela. Evento `aoe` lleva `keep: 1` y `fall: 'mortar'|'meteor'` (+ `fx, fz` origen del mortero) para el render.

**c) Beams (`H.beams`)** — láser, carril de fuego y embestida con la misma forma analítica:
```
{ id, owner, kind: 'laser'|'lane'|'charge', x0, z0, ang0, omega (rad/s), vx, vz (u/s, el origen se mueve),
  off, len, w, t0 (inicio telegraph), tAct, tEnd (ticks), dmg, every (ticks entre golpes), keep, hits: [{e, seq, tick}] }
en el tick t ≥ tAct:  τ = (t − tAct)·DT;  O = (x0 + vx·τ, z0 + vz·τ);  a = ang0 + omega·τ;
segmento de O + dir(a)·off a O + dir(a)·(off + len); daña si dist(jugador, segmento) < w/2 + hurtR·0.5.
```
- `contacts()`: para cada beam activo en `(prev, pt]` → si iframes (dash) = no daña (+ marca para FANTASMA
  de beam: `+riposte.ghost`, evento `ghost` con `beam: id`, una vez por beam y jugador); si `hurtInv` = nada;
  si no, y el último golpe de ese jugador fue hace ≥ `every` ticks → `hurtPlayer(kind 'beam')`.
- Evento `beam {id, src, kind, x0, z0, ang0, omega, vx, vz, off, len, w, tick (t0), tAct, tEnd, dmg, every}`.
  El cliente lo añade a `H.beams` (como `aoe`). `cancelPending(owner)` cancela beams no activos aún;
  `clear()` cancela todos; `sweep` borra los que acabaron hace > 40 ticks.

**d) Lava (`H.lava`)** — una por instancia (null si no hay):
```
{ id, cx, cz, r0, rMin, rate (u/s), t0 (tick), R (radio exterior), dmg, every (ticks) }
r(t) = max(rMin, r0 − rate·(t − t0)·DT); daña si r(t) < dist < R + 1 en ticks múltiplos de `every`
(una vez por tick y jugador; registro `hits` como los AoE). El empujón va hacia el centro.
```
Eventos `lava {…}` (aparece/cambia) y `lava {off: 1}` (se apaga: victoria, reset, wipe). La snapshot
`enc` añade el campo 9 = lava activa (0/1) para los que entran tarde (el cliente pide nada: basta con el
evento; si falta, solo el visual se pierde).

### 2.2 Cangrejo mortero (`src/data/enemies.js` → `crab`)

| HP | DEF | Vel. | Rango | Ataque | Wind-up | CD | XP |
|---|---|---|---|---|---|---|---|
| 80 | 3 | 2.0 | 7–11 | `mortar`: 3 AoE r=2.2 (una en el jugador, dos a 2.6 u a los lados), vuelan 1.1 s | 0.5 s | 3.0 s | 50 |

- **Blindado por delante (120°):** golpes cuerpo a cuerpo y onda RIPOSTE de frente → daño × 0.2 (evento
  `damage` con `armor: 1`, «clunk», float «BLINDADO»); flanco/espalda × 1; **los reflejos ignoran el blindaje**.
- Gira despacio (`turn: 2.4` rad/s): un dash al costado lo deja expuesto. Orbita como el arquero.
- Nuevo `kind: 'mortar'` en `startWindup`/`fire`: al FINAL del wind-up crea 3 AoE `keep` con
  `tAct = tick + flight/DT` y emite `aoe` con `fall: 'mortar'` y el origen (para el arco del proyectil).
- Look: vista no humanoide `CrabView` (nuevo `src/render/crab.js`, mismo API que `CannonView`):
  caparazón coral/óxido con placa frontal metálica, 6 patas animadas al andar, 2 pinzas, tubo de mortero en la
  espalda que brilla en el wind-up y retrocede al disparar.

### 2.3 Oleadas 4 y 5 (`src/data/encounters.js`)

| Oleada | Composición | Refuerzo |
|---|---|---|
| 1–3 | igual que M2.5 | igual |
| 4 | 2 cangrejos + 2 arqueros + 3 diablillos + 6 grumetes | a los 8 s: 1 cangrejo + 5 grumetes |
| 5 | 3 cangrejos + 2 chamanes + 6 grumetes | a los 10 s: 3 diablillos + 2 arqueros + 5 grumetes |

Banners: «OLEADA n/5» + subtítulo por oleada (4: «Cangrejos: flanquéalos o devuélveles las balas»,
5: «Todo a la vez»). Música: `music.setLevel(1 + min(2, ⌊wave/2⌋))` en oleadas, 3 en el jefe (si existe la
API; si no, solo `setMood`).

### 2.4 HELLFIRE en 3 fases (HP 3600, DEF 8)

Cada cambio de fase: 2 s invulnerable, se limpian balas/AoE/beams hostiles, banner, rugido, luz más roja.

| Fase | Umbral | Ciclo | Extras |
|---|---|---|---|
| 1 | 100–70 % | `fan5, spiral2, charge, fan5, rings2` · gap 0.75 | orbe pesado cada 12 s · `slam` si te pegas |
| 2 | 70–35 % | `flower, laser2, rings3, summon, wall, fan7, laser2, spiral2` · gap 0.5 | **escudo** (× 0.2 salvo reflejos) · orbe cada 10 s rompe el escudo 4 s (× 1.5) · invoca 3 grumetes + 1 diablillo |
| 3 | 35–0 % | `meteors, curtain, lanes, flower, meteors, spiral3, lanes, rings3` · gap 0.45 | **lava** 19 → 11 u (0.12 u/s, 6 daño / 0.5 s) · orbe cada 14 s: reflejarlo = aturdido 3 s y daño × 2 · invoca 4 grumetes al entrar |

Ataques nuevos (en `hellfire.attacks`):
- `charge` (**Embestida**): telegraph = rectángulo 10 × 2.2 (beam `kind 'charge'`, mostrado desde `t0`),
  wind-up 0.7 s; luego el jefe corre 18 u/s durante `len` (recortado por colisiones con `clipDistance`);
  contacto 20 daño. El servidor mueve al jefe exactamente por `O(t)` del beam (el beam es su cuerpo:
  `off −1.1, len 2.2, w 2.2`). Recover 0.6 s.
- `laser2` (**Láser doble rotatorio**): 2 beams opuestos desde el jefe, `len 22, w 0.9`, telegraph 0.6 s,
  `omega ±50°/s` (signo alterno cada vez), 4 s activos, 10 daño cada 0.2 s. El jefe queda enraizado.
- `meteors`: 8 AoE r=1.8 `keep`, telegraph 0.9 s, escalonados 0.15 s; 1 de cada 3 en un jugador (posición
  actual), el resto al azar dentro del radio útil (lava). `fall: 'meteor'`.
- `lanes` (**Carriles de fuego**): 3 beams `kind 'lane'` paralelos (ancho 3, largo 40, separación 9.5) que
  barren la arena en perpendicular a 5 u/s durante 3 s, telegraph 0.6 s, 10 daño cada 0.25 s. Dirección al
  azar (rng). Se cruzan con dash.
- `curtain` (**Cortina de balas**): patrón `rows` desde el borde opuesto al jugador: 4 filas de 30 parreables
  (sp 1.15 u, gap 0.9 s, velocidad 5.5, life 8 s), hueco de 3 posiciones (≈ 3.5 u) en un sitio distinto
  por fila (rng). Parreables: también se pueden reflejar en masa.
- `spiral3`: espiral de 4 brazos, 48 balas, gap 0.12.
- `lava`: no es un ataque del ciclo: se enciende al entrar en la fase 3 (evento `lava`).
- Fase 3 sin escudo; `phases[i].broken = {time, mult, stagger}` reemplaza a los globales por fase.

Muerte: igual que M2.5 (slow-mo, 1500 XP, minions se desmoronan) + se apaga la lava.

### 2.5 Render / UI / audio
- `src/render/vfx/hazardfx.js` (nuevo): `BeamFx` (pool de 12 quads: telegraph línea fina roja que parpadea →
  láser con núcleo blanco y halo magenta-naranja; carril = banda de fuego en el suelo con ruido que se
  desplaza; embestida = rectángulo rojo que se llena como los AoE) y `LavaRing` (anillo del radio actual al
  borde, shader de lava con grietas emisivas, borde interior brillante que avisa). Actualizados con el tick
  de proyectiles (`update(dt, tick)` como `decals`).
- Decals: pool 14 → 32 (meteoros + morteros a la vez).
- Caída: `aoe.fall` → bola de fuego que cae del cielo (meteoro) o proyectil en arco desde el cangrejo
  (mortero) que llega exactamente en `tAct` (usar `effects` / un mesh simple en la capa FX).
- Jefe fase 3: luz del jefe más roja e intensa, partículas de llamas en el cuerpo, banner «¡HELLFIRE DESATADO!».
- HUD barra del jefe con 2 marcas (70 % y 35 %). Consejos (`teach`): láser/carril («Cruza el fuego con
  dash»), lava («La lava avanza: quédate cerca del centro»), blindaje («Golpea al cangrejo por detrás o
  devuélvele las balas»).
- Audio: `laser` (zumbido), `lane` (rugido de fuego), `meteor` (silbido + impacto ya es `slam`), `mortar`
  (thump), `armor` (clunk metálico), `lava` (burbujeo grave en loop simple o al aparecer).
- F4: spawn cangrejo, trial «fase 3», el resto igual.

## 3. Pasos

- [x] **P0** Este plan (commit + push).
- [x] **P1** Primitivas sim: patrón `rows` (+holes/life), AoE `keep`, `H.beams` (+contacts, eventos, cliente,
  reconciliación), `H.lava` (+contacts, eventos, cliente). Tests nuevos en `tests/m3.test.mjs`
  (rows con huecos y vida, beam laser gira y daña cada `every`, dash a través no daña y da FANTASMA, lava
  encoge y daña fuera, keep sobrevive a la muerte del dueño, predicción cliente = servidor con beams).
- [x] **P2** Cangrejo: datos, `turn`, `kind 'mortar'`, blindaje frontal en `damageEnemy`. Tests (mortero
  3 círculos y sobrevive a la muerte, blindaje frente vs espalda vs reflejo).
- [ ] **P3** Oleadas 4–5 + banners + música. Actualizar test de flujo del encuentro (5 oleadas).
- [ ] **P4** HELLFIRE 3 fases: datos, `charge`, `laser2`, `meteors`, `lanes`, `curtain`, `spiral3`, lava al
  entrar en fase 3, `broken` por fase, `encounterDev` op `phase3`. Tests (umbrales 70/35, embestida mueve y
  daña, láser, lanes, lava se apaga al morir, ciclo fase 3).
- [ ] **P5** Render: `CrabView`, `hazardfx.js` (beams + lava), caída de meteoros/morteros, decals 32, look
  fase 3, prewarm.
- [ ] **P6** UI/feel/audio: banners, marcas en la barra, consejos, sonidos, float BLINDADO, F4.
- [ ] **P7** Balance con el bot (`scratchpad/bot25.mjs` → oleadas 4–5 + 3 fases) y densidad/perf (≤ 0.5 ms/step).
- [ ] **P8** Verificación (tests, capturas 20-trial-wave5, 21-hellfire-laser, 22-hellfire-3), docs (DESIGN §7
  §8 §16, README), versión `0.3.0-m3`, artefacto republicado.

## 4. Riesgos y notas
- Beams en `contacts()`: el swept test usa la posición al tick `pt` (los beams van lentos: 50 °/s a 22 u
  ≈ 19 u/s en la punta → hasta 0.32 u por tick; aceptable con `w/2 + hurtR·0.5`).
- La embestida mueve al jefe por fórmula: no llamar a `steer` durante `charge` (el knockback también se ignora).
- La cortina usa `life` mayor que la de las parreables: no tocar `tuning.projectiles.parryable.life`.
- Si la densidad de la fase 3 pasa de ~250 balas vivas, bajar `curtain.n` antes que la cadencia.
