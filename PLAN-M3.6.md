# PLAN M3.6 — Servidor Node real: 2–4 piratas en la misma isla, con latencia de verdad

> Documento de traspaso. Si la sesión se corta, cualquier modelo puede seguir desde la primera casilla `[ ]`
> sin leer el historial. Cada paso termina con tests en verde + commit + push. Marca `[x]` al terminar.
> Base: M3.5 terminado (`PLAN-M3.5.md`, 84 tests en verde, versión `0.3.5-m3.5`).

## 0. Contexto mínimo (leer primero)

- Repo `joeyxd/realms-of-trade-server`, rama **`claude/loving-lovelace-ptbif7`** (PR #1 abierto: no abrir otro).
- Juego «MAREA NEGRA»: ARPG isométrico toon (bullet hell), Three.js 0.160 (desde CDN), sim determinista
  (`src/sim/`, sin `Math.random`) y servidor autoritativo `LocalServer` (`src/net/localServer.js`) que hoy
  corre en un Web Worker. Diseño: `DESIGN.md` §10 (red). El cliente (`src/client/gameClient.js`) predice al
  jugador local, reconcilia con `ack` + `you` (PLAYER_FIELDS a precisión completa) e interpola al resto 100 ms.
- Decisión del autor: después del Combate V2 va **un servidor Node real con 2–4 jugadores** usando **el mismo
  `LocalServer`**, para medir el combate con latencia real; luego M4 (progresión/loot).
- Tests: `npm test` (necesita `npm install`). **Nunca** empujar en rojo. Capturas: `node tools/shot.mjs <dir>`
  (en el contenedor: `MN_LIBS=<scratchpad>/libs`). Balance: `LV=5 SKILL=0.8 node tools/playtest.mjs`.
- Artefacto (solo un jugador; no hay servidor detrás): `node tools/build-artifact.mjs dist/index.html` →
  republicar en la MISMA URL https://claude.ai/artifact/MpCdPMbgw41nJKcf8NvSrD (antes `Artifact list scope:"files"`).
- Commits terminan con:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Md1KNYppmXci5NXt42VucC
  ```
  Sin IDs de modelo en commits/código. Push: `git push -u origin claude/loving-lovelace-ptbif7`.
- Respuesta final al usuario **en español**, con enlaces al PR #1 y al artefacto.

### Reglas (las de M3.5 siguen valiendo)
1. **Un solo servidor de juego:** el proceso Node instancia `LocalServer` tal cual; nada de lógica de juego en
   `server/`. `server/` solo hace transporte, límites y despliegue.
2. Sim determinista y comando-céntrica: el jugador solo avanza con sus comandos, en cliente y servidor. Lo que el
   servidor sintetice (comandos de relleno) se corrige por reconciliación.
3. Lo que el servidor manda a todos es igual para todos (eventos); lo personal (`you`, `ack`) va por cliente.
4. Un servidor público **nunca** habilita `dev` (panel F4) ni `debug` (teletransporte): solo con `DEV=1`.
5. Comentarios en inglés, UI en español, números en `src/data/*`.

## 1. Objetivo

`npm start` levanta **un proceso** que sirve el juego (estáticos) y el mundo (WebSocket `/ws`). Abrir
`http://host:5173` en 2–4 navegadores = la misma isla, la misma Prueba de Fuego, los mismos bots. Si no hay
servidor (artefacto, `?solo`), el juego sigue en el Worker como hoy. Una herramienta (`tools/nettest.mjs`)
juega la arena en cooperativo con bots-cliente reales por WebSocket y latencia simulada, y mide.

## 2. Especificación

### 2.1 Servidor (`server/`)
- `server/index.mjs` (entrada, `npm start`): HTTP con estáticos en lista blanca (`/`, `index.html`, `src/**`,
  `styles/**`), `GET /health` → `ok`, `GET /status` → `{game, version, players, max, bots, tick, uptime}`,
  WebSocket en `/ws` (`ws` ^8, `maxPayload` 64 KB, **permessage-deflate**). Variables: `PORT` (5173),
  `MAX_PLAYERS` (4), `BOTS` (3), `DEV` (0), `ORIGINS` (lista; vacío = cualquiera), `LAG_MS`/`JITTER_MS`
  (latencia artificial por sentido, para pruebas).
- `server/host.mjs` (`GameHost`): un `LocalServer({dev, debug, pausable: false, maxPlayers})`, un id por socket,
  `send(id, msg)` → `JSON.stringify` → socket. Límites por socket: cubeta de tokens (≤ 120 mensajes/s,
  ≤ 48 KB/s), JSON inválido o mensajes sin `t` se ignoran (3 strikes/s → cierre 1008), `cmds` ≤ 32 por mensaje,
  latido (ping 10 s, muerto si no responde en 30 s), cierre ordenado en SIGTERM/SIGINT (1001). Conexiones
  simultáneas ≤ `MAX_PLAYERS + 4` (espectadores; el resto: 503).
- `LocalServer`: `maxPlayers` (hello sobrante → `{t:'full', max}`), `{t:'error', code:'version'}` si `v` no
  coincide, nombre saneado (sin controles, recortado, vacío → «Grumete», repetido → «Nombre 2»), `pausable`
  (online: el menú de pausa no detiene el mundo), `describe()` con `human: 1` para jugadores con cliente.

### 2.2 Cliente en línea
- `createTransport`: `?server=ws(s)://…` explícito, o **autodetección** si la página la sirve nuestro servidor
  (`fetch('/status')` ≤ 1.5 s y `game === 'MAREA NEGRA'`) → `WsTransport` a `ws(s)://<host>/ws`; `?solo`
  fuerza el Worker; si el socket no abre en 4 s → Worker.
- `WsTransport` completo: cola hasta `open`, `READY` al abrir, `net:closed` al cerrar, `stats` (bytes in/out,
  RTT por `ping`/`pong` cada 2 s).
- Título: píldora de modo — «EN LÍNEA · 2/4 piratas» / «SOLO» —, botón secundario «Jugar solo» cuando hay
  servidor (recarga con `?solo`), estado «Servidor lleno».
- En línea **la pausa no congela**: el menú se abre, la entrada queda neutra y el mundo sigue.
- Desconexión: velo «Se perdió la conexión con el servidor» + «Reconectar» (recarga).

### 2.3 Red robusta (servidor)
- **Comandos de relleno:** si un cliente no manda comandos durante `net.starveTicks` (12 = 200 ms), el servidor
  aplica comandos neutros (sin movimiento, `pt` avanzando) cada tick: sigue recibiendo golpes y el encuentro no
  se atasca (pestaña oculta, pico de lag). Los comandos reales que lleguen tarde se descartan hasta saldar los
  sintetizados (sus pulsaciones `prs` se suman al siguiente comando aplicado; `ack` avanza).
- **Rebobinado** `combat.rewind` 20 → 24 ticks (400 ms) si la medición lo pide (historial `HIST` = 32 ≥ 24 + 6).
- **Tiempo de instancia en cooperativo:** con 1 humano todo sigue igual. Con ≥ 2 humanos, el hitstop de las
  acciones de un jugador es **personal** (solo su cliente, ≤ 60 ms, sin cámara lenta) y el servidor no se
  detiene; los eventos del mundo (`e: 0`, muerte del jefe) siguen siendo de instancia. El snapshot lleva `hum`.
- **Escalado cooperativo de la Prueba de Fuego:** vida de oleadas × `1 + coopHp·(n − 1)` (0.6) y del jefe
  × `1 + coopBossHp·(n − 1)` (0.75), con `n` = participantes al empezar la oleada / el jefe. El evento `enc` lleva `n`.

### 2.4 Ancho de banda
- Medido en M3.5 (1 jugador, arena, 17 entidades): snapshots JSON ≈ 55 KB/s por cliente; con deflate por
  mensaje 23 KB/s; **con contexto (permessage-deflate) 10 KB/s**. Objetivo: ≤ 12 KB/s por cliente con 4
  jugadores en la arena.
- `encodeEntity` cuantiza lo que solo se interpola (x/y/z a 1/1000, `f` 1/1000 rad, `vx/vz/mag/wade` 1/100):
  ~45 % menos antes de comprimir. `you` (PLAYER_FIELDS) **sin tocar** (la reconciliación necesita los bits).
- El formato binario de `DESIGN.md` §10 queda para cuando haya > 8 jugadores por instancia.

### 2.5 Medir con latencia (`tools/nettest.mjs`)
- Arranca `GameHost` en el mismo proceso (puerto 0) y N bots-cliente (`GameClient` + `WsTransport` sobre el
  `WebSocket` global de Node 22) con latencia simulada (`RTT=0,80,160,250`, `JITTER`). Cada bot usa la política
  de `tools/playtest.mjs` (extraída a `tools/botbrain.mjs`) sobre **lo que ve su cliente** (balas en su `pt`,
  enemigos interpolados).
- Informe por RTT: victoria (s), daño recibido por jugador, reflejos por nivel, correcciones de predicción/s,
  error medio, comandos con `pt` recortado por el rebobinado, comandos de relleno, KB/s por cliente, ms por
  paso del servidor.

### 2.6 Presentación cooperativa
- Marcos de grupo («Tripulación», hasta 3 aliados humanos: nombre, nivel, vida, arma, caído), placas de nombre
  de humanos en otro color que las de los bots, avisos «X se unió / dejó la tripulación», tajo y FX de las
  habilidades de los demás humanos, ping en el HUD cuando hay red.

## 3. Pasos

- [x] **P0** Este plan.
- [x] **P1 Servidor Node.** `ws` en `dependencies`; `server/index.mjs`, `server/host.mjs`; cambios de
  `LocalServer` (§2.1); `npm start` = servidor, `npm run static` = el `serve` de antes; `render.yaml` en la raíz.
  Tests `tests/server.test.mjs`: dos clientes WebSocket se unen y se ven, los inputs mueven, desconectar
  despawnea, servidor lleno, versión, basura y exceso no tumban el proceso, `/health` y `/status`.
- [ ] **P2 Cliente en línea.** `WsTransport` completo, autodetección y `?server`/`?solo`, píldora y botones del
  título, pausa que no congela, velo de desconexión, ping. Verificación con Playwright: servidor + 2 páginas.
- [ ] **P3 Red robusta.** Comandos de relleno, tiempo de instancia cooperativo, escalado de la arena, nombres;
  tests en `tests/coop.test.mjs`.
- [ ] **P4 Ancho de banda.** Cuantización de `encodeEntity`, deflate, medición con 4 clientes (§2.4).
- [ ] **P5 Latencia.** `tools/botbrain.mjs`, `tools/nettest.mjs`, informe, ajuste del rebobinado; test de red
  con 2 clientes a 100 ms de RTT (predicción sin correcciones, se ven, los reflejos de uno llegan al otro).
- [ ] **P6 Presentación cooperativa** (§2.6) + capturas con 2 navegadores.
- [ ] **P7 Cierre.** README («Jugar en línea», despliegue en Render), DESIGN §10/§16, versión `0.3.6-m3.6`,
  artefacto republicado (modo solo), informe final.

## 4. Notas de implementación (rellenar al cerrar cada paso)

- **P1:** `server/index.mjs` exporta `createGameServer({port, host, bots, maxPlayers, dev, lagMs, jitterMs, origins})`
  (los tests lo arrancan en el puerto 0) y solo se ejecuta como entrada con `npm start`. `GameHost` no llama a
  `LocalServer.start()`: mueve su propio `pump()` cada 4 ms dentro de `try/catch` (un tick roto se registra y el
  proceso sigue; `status().errors`). Un broadcast se serializa una sola vez (`lastMsg`). El `WebSocket` global de
  Node 22 negocia permessage-deflate con `ws`. `PROTOCOL_VERSION` = 3; `cleanName` en `protocol.js`; `full` y
  `error` en `MSG`. `npm run static` sirve los estáticos como antes; `engines.node` ≥ 22.
