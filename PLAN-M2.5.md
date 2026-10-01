# PLAN M2.5 — «La Prueba de Fuego» (bullet hell en La Caldera + jefe)

> Documento de traspaso. Si la sesión se corta, cualquier modelo puede seguir desde la primera casilla `[ ]`
> sin leer el historial. Cada paso termina con tests en verde + commit + push. Marca `[x]` al terminar.

## 0. Contexto mínimo (leer primero)

- Repo `joeyxd/realms-of-trade-server`, rama **`claude/loving-lovelace-ptbif7`** (PR #1 ya abierto: no abrir otro).
- Juego: «MAREA NEGRA», ARPG isométrico toon en Three.js 0.160, sim determinista + servidor local en worker.
  Diseño completo en `DESIGN.md` (§6 proyectiles, §7 enemigos, §8 jefe, §10 red, §16 milestones).
- Tests: `npm test` (node --test, hoy 34 en verde). **Nunca** empujar con tests en rojo.
- Capturas: `node tools/shot.mjs` (Playwright + Chromium en `/opt/pw-browsers`; usa `Q=low` para pruebas
  sensibles al tiempo: SwiftShader en alta calidad no llega a tiempo real).
- Artefacto: `node tools/build-artifact.mjs dist/index.html` → republicar en la MISMA URL
  https://claude.ai/artifact/MpCdPMbgw41nJKcf8NvSrD (leerla con la herramienta Artifact `read` antes si hace falta).
- Commits: mensaje en inglés o español, terminar con:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Md1KNYppmXci5NXt42VucC
  ```
  Sin IDs de modelo en commits/código. Push: `git push -u origin claude/loving-lovelace-ptbif7`.
- Respuesta final al usuario **en español**, con enlaces al PR #1 y al artefacto.

### Reglas del código (no romper)
1. **La sim es determinista**: nada de `Math.random` en `src/sim/**`; usar `world.rng` (servidor) o hashes del id.
2. **Proyectiles hostiles = analíticos.** El servidor emite UN evento `pattern` y el cliente lo expande con
   `emitPattern()` (`src/sim/projectiles.js`). Cualquier campo nuevo de patrón (p. ej. `arms`, `waves`, `alt`)
   **tiene que ir dentro del evento** (`fire()` en `src/sim/systems/enemies.js`) o el cliente diverge.
3. La IA enemiga corre **solo en el servidor** (`stepEnemy`). El cliente ve enemigos por snapshot + eventos.
4. Lo que el jugador predice (parry, destroy, graze, ghost, dash) vive en `src/sim/systems/combat.js` y corre
   igual en cliente y servidor: si añades una recompensa ahí, deduplica con `H.mark(s, e, k, seq)` como `graze`.
5. Comentarios en inglés, UI en español. Datos en `src/data/*`, no números mágicos en sistemas.
6. Materiales nuevos: añadirlos a `prewarm()` de `src/render/scene.js` (si no, tirón al compilar el shader).
7. Decals de suelo: winding CCW visto desde arriba + `fxDepthFadeBias(0.15, 0.3)` (si no, desaparecen).

## 1. Objetivo (lo que pidió el usuario)

Una zona llena de enemigos cuerpo a cuerpo y a distancia con **muchas balas volando** (bullet hell real),
donde el **dash sea imprescindible**, donde **reflejar balas mate enemigos** (y reboten entre ellos), rematada por
un **jefe** con disparos **omnidireccionales** y **esbirros melee que te persiguen**. «The whole enchilada».

Decisión: la zona es **La Caldera** (arena r=19 ya existe en `worldgen.js`, `L.arena=[25,0]`). Al pisar el
círculo de runas del centro empieza **La Prueba de Fuego**: 3 oleadas → jefe **HELLFIRE** (versión de 2 fases;
la fase 3 con lava/meteoros/láseres sigue siendo M3). Los 2 centinelas de la puerta se quedan como guardianes.

## 2. Contenido nuevo

### 2.1 Enemigos nuevos (`src/data/enemies.js`)
| id | Nombre | HP | Def | Vel | Rango | Ataque | Wind-up | CD | XP |
|---|---|---|---|---|---|---|---|---|---|
| `grunt` | Grumete ahogado (esbirro melee) | 24 | 0 | 4.6 | 0–0.9 (persigue) | `aoe` mordisco r=1.05 delante (reach 0.85), 9 daño | 0.42 s | 1.1 s | 8 |
| `imp` | Diablillo de fuego | 28 | 0 | 5.5 | orbita 5–7 | `spiral` 8 orbes parreables, 45°/orbe (círculo completo en 0.8 s), 7 u/s, 7 daño | 0.4 s | 2.8 s | 20 |
| `shaman` | Chamán de coral | 60 | 1 | 2.4 | 8–10 | `ring` 12 orbes **alternando parreable/imparable** (`alt: true`), 6 u/s, 9 daño | 0.6 s | 3.5 s | 40 |
| `hellfire` | HELLFIRE, Señor de La Caldera (jefe) | 1600 | 4 | 1.6 | 6–11 | ver 2.2 | — | — | 1500 |

- `grunt`: flag `chaser: true` → en `chase` va directo al objetivo (sin orbitar), se para a `range[1]`;
  `light: true` → knockback × 1.6 (los combos los empujan). Llegan en manadas de 4–6.
- `imp`: flag `hover: true` (solo visual: flota 0.35 u y se balancea). Fuego/ascuas al morir.
- Encounter: los enemigos de la prueba nacen con `extra = { enc: 'caldera' }` → `aggro` = 40, `leash` = 60
  (persiguen a cualquiera dentro de la arena) y nacen en estado `wake` (animación de levantarse 0.8 s).

### 2.2 Jefe HELLFIRE (2 fases) — `ENEMIES.hellfire.phases`
Brain propio `stepBoss()` en `src/sim/systems/boss.js` (llamado desde `stepEnemy` cuando `def.boss`).
Ciclo de ataques fijo por fase (no `chooseAttack`), con `b.spin` (ángulo base que rota 23° por ataque) para
que los patrones no se repitan iguales. Recolocación lenta hacia `range` alrededor del objetivo.

**Fase 1 (100 % → 55 %)** — ciclo `fan5, spiral2, fan5, rings2`; orbe pesado cada 12 s.
| Ataque | Patrón | Detalle |
|---|---|---|
| `fan5` | `fan` parreable | 5 balas, 8° entre balas, 9 u/s, 10 daño, wind-up 0.5 s (apuntado) |
| `spiral2` | `spiral` con `arms: 2` | 24 orbes parreables en 2 s (gap 0.083), 15°/paso, 6.5 u/s, 8 daño, wind-up 0.4 |
| `rings2` | `rings` | 2 anillos de 16, `alt: true`, 0.5 s entre anillos, desfase 11.25°, 6 u/s, 10 daño, wind-up 0.45 |
| `heavy` | `single` pesado | 4.5 u/s, 24 daño, wind-up 0.8 s (gran brillo). Reflejado (PERFECTO) → **stagger 1.5 s + ROTO** |

**Cambio de fase (al 55 %)**: 2.0 s invulnerable (acto `ENRAGE`, pose de rugido), se limpian **solo** los
proyectiles hostiles (evento `clear` con `hostile: 1` — el cliente NO debe borrar los disparos reflejados),
banner «FASE 2 — ¡HELLFIRE!», destello rojo, temblor de cámara, invoca 3 grumetes.

**Fase 2 (55 % → 0)** — ciclo `flower, wall, rings3, summon, fan7`; orbe pesado cada 10 s; `slam` si el
objetivo está a < 4 u (castiga pegarse); **escudo**: todo daño × 0.35 **excepto los reflejos** (los reflejos
rompen escudos, DESIGN §6). Reflejar el orbe pesado → escudo roto 4 s (daño × 1.5) + stagger.
| Ataque | Patrón | Detalle |
|---|---|---|
| `flower` | `spiral` con `arms: 4` | 48 orbes en 2.4 s (gap 0.05), 9°/paso, 5.5 u/s, 8 daño — la flor omnidireccional |
| `wall` | `fan` imparable | 9 púas, 10° (muro de 80°), 8 u/s, 14 daño → **hay que dashear a través** (FANTASMA) o rodear |
| `rings3` | `rings` | 3 anillos de 16 `alt`, 0.45 s, desfase 11.25°, 6.5 u/s |
| `summon` | invocación | 3 `grunt` en un círculo de 4 u alrededor del jefe (máx 6 esbirros vivos), wind-up 0.6 s, evento `summon` |
| `fan7` | `fan` parreable | 7 balas, 9°, 10 u/s, apuntado |
| `slam` | `aoe` | r=4.2 centrado en el jefe, 20 daño, wind-up 0.9 s (solo si objetivo < 4 u; prioridad máxima, CD 4 s) |

**Muerte**: evento `time` slow-mo 0.3× 1.2 s para todos los jugadores de la arena, explosión de huesos y
ascuas, XP 1500 a los participantes, toast «¡Has superado La Prueba de Fuego!», banner de victoria.

### 2.3 Encuentro «La Prueba de Fuego» — `src/data/encounters.js` + `src/sim/systems/encounter.js`
```js
export const ENCOUNTERS = {
  caldera: {
    name: 'La Prueba de Fuego', startR: 3.2,   // pisar el círculo de runas del centro (r 3.2) la inicia
    radius: 21,          // dentro = participante
    wipeGrace: 5,        // s sin participantes vivos dentro → reinicio (la oleada/jefe se quita)
    rest: 4,             // s de respiro entre oleadas (se limpian proyectiles hostiles)
    spawnR: 14, spawnN: 10,  // puntos de aparición en anillo, saltando el sector de la puerta (±35°)
    waves: [
      { groups: [['grunt', 5], ['archer', 2]] },
      { groups: [['imp', 3], ['grunt', 4], ['archer', 2]], late: { after: 8, groups: [['grunt', 4]] } },
      { groups: [['shaman', 2], ['imp', 2], ['grunt', 6]], late: { after: 10, groups: [['archer', 2], ['imp', 1]] } },
    ],
    boss: { kind: 'hellfire', at: [7, 0], intro: 2.5 },   // (u, v) relativo al centro de la arena
    cooldown: 40,        // s tras ganar antes de poder repetir
  },
};
```
Máquina de estados (servidor, en `world.encounters[id]`): `idle → intro(1.5 s) → wave(i) → rest → … → bossIntro
→ boss → victory(cooldown) → idle`. Reinicio por *wipe* → `idle` pero recordando `reached: 'boss'`
(si ya llegaste al jefe, la siguiente vez empieza directamente en `bossIntro`: checkpoint de jefe).
- Una oleada termina cuando todos sus enemigos (incluidos los `late`) están muertos; `late` aparece a los
  `after` s o cuando la oleada inicial muere, lo que llegue antes.
- Eventos: `enc { id, st, wave, waves, left, t }` en cada transición y cuando cambia `left` (contador de enemigos).
- Snapshot: `enc` (estado compacto) cada 30 ticks para quien se une tarde (MMO-ready).
- `world.killEnemy` → `encounterOnKill(world, e)`; `world.despawn` limpio en reinicio.
- Equidad: ningún patrón nace a < 2.5 u de un jugador (los enemigos aparecen a 14 u); enemigos a > 16 u del
  objetivo no disparan; tope objetivo ≤ 140 balas hostiles vivas en oleada 3 y ≤ 180 en fase 2.

### 2.4 Mecánicas que hacen brillar el bullet hell
- **Rebote** (`tuning.parry.reflect.bounce`): un disparo reflejado que impacta salta al enemigo más cercano
  (≤ 7 u, distinto del golpeado) con daño × 0.75: normal 1 rebote, PERFECTO 2, onda RIPOSTE 1.
  Servidor (`world.stepShots`): en vez de terminar, reapunta y emite `shotBounce {sid, x, z, dx, dz, target}`;
  cliente (`gameClient.onEvent`): reorienta la copia visual (`sidOf` → slot). Float «REBOTE» + chispas cian.
- **ESQUIVA** (dash): atravesar con i-frames de dash un proyectil parreable/pesado que te habría dado →
  +1 XP, +3 % RIPOSTE, float «ESQUIVA» (una vez por proyectil, marca `'d'`). En `contacts()` de combat.js
  junto a la lógica de `ghost` (que sigue siendo para imparables: +8 %).
- Cámara: durante la prueba (`enc.st !== 'idle'` y jugador dentro) `distTarget × 1.18` para ver la arena.

## 3. Cliente / render / UI
- **Looks** (`src/render/charlooks.js`, `LOOKS`): cambios de paleta sobre los constructores existentes:
  `grunt` = `skeletonArcher` con algas/verde ahogado y cuchillo (`weapon: 'cutlass'`, sin arco), escala 0.82;
  `imp` = `skeletonArcher` rojo brasa + cuernos (2 conos) + ojos naranja, escala 0.72, `hover`;
  `shaman` = `skeletonArcher` coral/turquesa + báculo con gema (`weapon: 'staff'`);
  `hellfire` = `skeleton` (brute) obsidiana/brasa, gemas naranja, escala 1.75.
  `skeletonArcher` solo pone arco si `L.weapon === 'bow'`. `CharacterView` acepta `{ scale }` (root.scale).
- `scene.addCharacter`: ramas para `grunt|imp|shaman|hellfire`; jefe con luz local naranja (lights.js) y
  burbuja de escudo (esfera fresnel, aditiva) visible si `rec.shield`.
- `feedback.js`: casos `enc` (banners), `phase`, `summon` (erupción de huesos), `shotBounce`, `dodge`,
  `shield` (toast «¡ESCUDO ROTO!»); `debrisKind` → `'bone'` para grunt/shaman/hellfire, `'ember'` para imp.
- `hud.js`: **barra de jefe** arriba al centro (nombre, título, HP, marca al 55 %, estado del escudo);
  banner grande «OLEADA 2/3» (reutilizar `showZone`), contador «Enemigos: n» en el tracker de objetivos,
  banner de victoria. `sfx.js`: gong de oleada, rugido de fase (ruido filtrado + grave), rebote (tic agudo).
- Arena: círculo de runas en el centro (decal emisivo, pulsa cuando la prueba está disponible) y muro de
  fuego en la puerta mientras dura la prueba (solo visual + aviso «Si sales, la prueba se reinicia»).

## 4. Pasos (cada uno: implementar → `npm test` → commit → push)

- [x] **P0 · Cierre M2 (docs)** — DESIGN §7 fila Centinela (diablillo pasa a M2.5), §10 compensación de lag
  (pt, catch-up, filtro asimétrico de reloj, tiempo de instancia), zona de práctica, §16 M2 ✅ + fila M2.5,
  §14 añadir `data/enemies.js`, `data/encounters.js`, `systems/boss.js`, `systems/encounter.js`;
  README (controles J/K/LMB/RMB/R/F4, contenido M2); `src/data/meta.js` → `0.2.0-m2`.
- [x] **P1 · Patrones** — `emitPattern`: `spiral` con `arms` (k → brazo k % arms, paso ⌊k/arms⌋; ángulo
  `ang + brazo·2π/arms + paso·spread`, t0 por paso); nuevo `rings` (n por anillo × `waves`, `gap`, desfase
  `spread` por anillo, `alt` alterna por índice dentro del anillo); `patternCount` (rings = n·waves).
  `fire()` copia `arms/waves/alt` al evento; `fireDur` correcto. Test: servidor y cliente expanden igual.
- [x] **P2 · Enemigos grunt/imp/shaman** — datos, `chaser`/`light` en `stepEnemy`/`damageEnemy`, looks,
  vistas, debris, botones F4 (+ Grumete, + Diablillo, + Chamán). Test: el mordisco del grumete daña a un
  jugador quieto y no a uno que dashea fuera al final del wind-up.
- [x] **P3 · Rebote + ESQUIVA** — tuning, `stepShots`, evento `shotBounce`, cliente, feedback. Tests: un
  reflejo PERFECTO mata a uno y rebota al segundo; dashear a través de una bala parreable da `dodge` 1 vez.
- [ ] **P4 · Encuentro** — datos, sistema, ganchos en `world` (spawn/kill/reset/snapshot), runas, eventos,
  ops dev `enc` (start / wave n / boss / phase2 / reset). Tests: entrar inicia oleada 1; matar todo avanza;
  tras oleada 3 aparece el jefe; wipe reinicia y recuerda `reached: 'boss'`; victoria → cooldown → idle.
- [ ] **P5 · Jefe** — `systems/boss.js` (fases, ciclo, `spin`, escudo, invocación, slam, orbe pesado que
  rompe), clear hostil sin tocar shots. Tests: al 55 % cambio de fase + invulnerable 2 s + clear hostil;
  escudo × 0.35 salvo reflejos; muerte → victoria + XP.
- [ ] **P6 · UI/feel** — barra de jefe, banners, contador, sonidos, cámara, burbuja, luz, muro de fuego.
- [ ] **P7 · Verificación** — F4 (botones prueba), escenas `16-wave2`, `17-boss1`, `18-boss2` en
  `tools/shot.mjs`; bot de parry (ver `scratchpad/c2.js` de la sesión anterior: pulsa K cuando
  `client.hazards` tiene una bala a < 0.35 s) jugando oleadas; checklist §16 (legibilidad parreable/pesado/
  imparable con 150 balas, nada tapa al personaje, FPS con Q=low/high). Test de rendimiento: fase 2 + 6
  grumetes + 200 balas → `world.step` medio < 2 ms en node. Test cliente/servidor (estilo
  `clientAndServer()` de `tests/combat.test.mjs`) 1200 ticks en la arena: error de predicción 0.
- [ ] **P8 · Cierre** — DESIGN (§7 tabla, §8 «versión M2.5 de 2 fases», §16 M2.5 ✅), README, meta
  `0.2.5-m2.5`, rebuild + republicar artefacto (misma URL), push, informe final en español.

## 5. Riesgos y cómo evitarlos
- **Divergencia de patrones** (cliente ve balas distintas): todo parámetro en el evento; test P1.
- **Rendimiento**: `contacts()` recorre el pool por jugador y tick (cap 1500, OK); el render de proyectiles
  es instanciado. Si baja de 50 FPS en Q=low, reducir `flower` a 36 orbes antes que tocar el motor.
- **Injusticia**: balas desde fuera de pantalla → regla de 16 u + zoom de cámara; telegraphs siempre ≥ 0.4 s.
- **Clear de fase** no debe borrar reflejos del jugador (el `clear` actual del cliente sí lo hace: usar
  `hostile: 1`).
- **XP de la prueba** cuenta para misiones de matar (aceptado, igual que el arquero del F4).
