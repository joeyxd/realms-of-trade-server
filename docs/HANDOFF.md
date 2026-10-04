# Traspaso: cómo seguir con MAREA NEGRA

Para quien retome el proyecto (persona o modelo). Leer `AGENTS.md` y esto primero, luego `DESIGN.md` (el diseño entero) y el
`PLAN-*.md` del milestone en curso.

## 1. Qué es y sus reglas

- Action-RPG isométrico / bullet hell para navegador, **Three.js 0.160** desde CDN, sin bundler. Interfaz y textos
  en **español**; comentarios de código en **inglés**, con el estilo de los que ya hay (qué hace y por qué, en
  prosa, sin relleno).
- **Servidor autoritativo**: `LocalServer` (`src/net/localServer.js`) corre el mundo; en solo vive en un Web Worker,
  en línea dentro de `server/index.mjs` (WebSocket). El cliente predice solo al jugador (`PLAYER_FIELDS` en
  `src/sim/ecs.js`) y reconcilia.
- **Determinismo**: la simulación (`src/sim/**`) no usa `Math.random` ni el reloj; usa `world.rng` / semillas
  (`mulberry32`). Lo que toca balas hostiles va en `stepPlayerCombat` al tick del comando (`pt`); los golpes a
  enemigos son del servidor (`world.*Hits`, `historyAt`).
- **Eventos privados**: `world.emit({ type, to: e, … })`. Los que deben guardar la partida al instante van en
  `SAVE_NOW` (`src/net/saves.js`).
- **Perfil** (lo que se guarda, firmado en el navegador): `newProfile` / `sanitizeProfile` en
  `src/sim/systems/inventory.js`. Todo campo nuevo necesita su valor por defecto y su saneado.
- `PROTOCOL_VERSION` (`src/net/protocol.js`) sube cuando cambia lo que se manda en el snapshot o en `you`.
- **Procedural + assets**: todo se dibuja por código; cualquier pieza se puede cambiar por un `.glb`
  (`docs/ASSETS.md`).

## 2. Mapa del repo

```
src/core      bucle, entrada, ajustes, matemáticas, rng
src/data      números y contenido (tuning, armas, tatuajes, enemigos, objetos, misiones, mercancías, pueblos,
              barcos, piezas de balsa, edificios)
src/sim       ECS, mundo, generación del mapa, sistemas (movimiento, combate, habilidades, enemigos, jefe,
              inventario, misiones, comercio), economía (mercados, bodegas, viajes, balsa, solares)
src/net       protocolo, LocalServer, transporte (worker / WebSocket), partidas guardadas
src/client    gameClient (predicción, interpolación)
src/render    escena, pipeline (tinta, bloom, agua), toon, personajes, props, vegetación, VFX, assets externos
src/ui        HUD, paneles, diálogo, mapa, cómic, táctil, título, pausa
server/       servidor Node (estáticos + WebSocket + partidas firmadas)
tools/        build-artifact, look (capturas), import-asset, playtest, nettest, progress, botbrain…
tests/        node --test (233 tests, incluyendo 17 de perlas)
docs/         ASSETS, DEPLOY, HANDOFF y los briefs de trabajo (docs/briefs)
deploy/       systemd, Caddy, env de ejemplo, script de actualización
```

## 3. Estado (2026-10-04)

| Milestone | Estado |
|---|---|
| M1 … M4.6 | ✅ (ver `DESIGN.md` §16) |
| **M4.7 «Tatuajes»** | ✅ (cómic Ultra, huecos Q/E, los tres tatuajes, apuntar y VFX, pestaña y Doña Sepia) |
| M4.8 «Perlas negras» | **en curso**: Brasa y circulación jugables; faltan Escarcha, Tormenta, Tinta y cierre (`PLAN-M4.8.md`) |
| M5 mundo persistente (Supabase) | plan (`PLAN-M5.md`) |
| M6 «La Balsa» | **núcleo hecho** (piezas, reglas, estadísticas, producción, guardado + tests); falta todo lo visible (`PLAN-M6.md`) |
| M7 comercio | **motor hecho** (mercados, comando `market` + tests); falta la UI y los mercaderes (`PLAN-M7.md`) |
| M8 construcción en pueblos | núcleo de solares hecho; plan (`PLAN-M8.md`) |
| Assets externos | ✅ (`docs/ASSETS.md`) |
| Jugar en línea en un servidor propio | ✅ (`docs/DEPLOY.md`) |

### M4.7 terminado (lo que queda abierto)

1. **P3** (sim de los tatuajes) ✅: los tres tatuajes y sus formas se lanzan, golpean, borran balas y se predicen
   (`tests/tattoos2.test.mjs`). Eventos para el render: `cast` (el del salto con `x0, z0, x1, z1, air, h, form`),
   `slam {x, z, r, form}`, `blink`, `tromba {x, z, tick, r, form, n}` (n 0 la primera, 1 la gemela), `trombaHit`,
   `trombaEnd`, `wheel {x, z, dx, dz, v0, R, r, k, hang, tick, form, slot}`, `wheelBack`, `wheelCatch`,
   `wheelDrop`; la posición del timón en vuelo está en `ecs.whX / whZ` (y `wheelOut()` para la ida).
2. **P4 + P5** (cliente) ✅: apuntado tipo MOBA, VFX, animación, iconos, sonido, pestaña Tatuajes y Doña Sepia.
3. **P1**: el autor revisa el cómic Ultra y manda ajustes.
4. **P6** ✅: versión `0.4.7-m4.7`, protocolo 7, README / DESIGN, artefacto.

Después: M4.8 (perlas), y la estructura (M6 balsa → M7 comercio → M5 persistencia → M8), en el orden que decida el
autor.

### M4.8 en curso — checkpoint Brasa (`0.4.8-alpha.1`)

- Base compartida: perfil `pirateId` / `pearls`, ledger UID en memoria, botín público, bolsa de 8, confirmación
  con UID anterior, entregar a otro pirata, vender, escupir, caída al morir en cualquier zona y retorno a playa tras 90 s.
- Brasa: G / cruceta abajo / botón COMETA. Embestida predicha, colisiones, limpieza de balas parreables, estela
  ardiente de 2 s; quemadura de todo el kit y maldición al vadear. El poder no se puede poner en Q/E.
- Pestaña Perlas (P), HUD G, VFX naranja iniciales y pilar de luz. Cambios fuera de combate. F4 permite dar una
  perla en solo para probar; cerrar el panel y esperar 4 s antes de G.
- Archivos de entrada: `src/data/pearls.js`, `src/sim/systems/pearls.js`, `pearlcombat.js`, `skills.js`,
  `src/ui/pearlpanel.js`. Próximo paso concreto: **P2 Escarcha** en `PLAN-M4.8.md`.
- **Protocolo 8**: actualiza cliente y servidor juntos. Partidas anteriores migran con bolsa vacía. El ledger
  no sobrevive a reinicios; M5 debe cerrar los duplicados antes de introducir perlas únicas.
- Validación: 233 tests (231 sin red + 2 de red); capturas y recorrido de panel/confirmación/G en desktop y
  móvil emulado 844×390. VFX de Cometa capturados con partículas detenidas por el render de software. Falta
  aceptación a 60 fps con GPU y dispositivos reales. `shots/review/` contiene evidencia local, ignorada por Git.
- `package-lock.json` corregido: Three.js 0.160 viene del registro npm, sin enlaces a carpetas temporales;
  `npm ci` comprobado en instalación limpia. `tools/look.mjs` acepta Playwright/Chrome instalados en Windows.
- No se han seleccionado/importado assets FAB. El autor los está revisando; la mecánica conserva el arte
  procedural y el importer GLB de `docs/ASSETS.md`. Tampoco se ha desplegado el servidor ni republicado el artefacto;
  la URL de claude.ai conserva M4.7.

### Dirección del autor y discusión naval (2026-10-04)

- Construir y habitar en tierra o en barcos modulares es la joya del juego; barcos aéreos más adelante.
- Usar **GPT-6 Luna** para trabajo delegable que ahorre tiempo/tokens sin comprometer calidad, con autoría,
  integración y revisión final del agente principal. Regla persistente: `AGENTS.md`.
- Antes de investigar los proyectos Unreal/FAB del autor, cerrar la conversación sobre combate naval, carga,
  pérdidas y protección de la casa. Propuesta y evidencia: `docs/NAVAL-HOUSING-DISCUSSION.md`.
- No inspeccionar esa carpeta todavía. Cuando toque: inventario de solo lectura con Luna, contenido adicional
  adquirido y su portabilidad/utilidad; excluir módulos base de Unreal. El autor gestiona las licencias.
- Las reglas de esa discusión aún no están aprobadas ni implementadas. M4.8 sigue en el checkpoint Brasa.

## 4. Cómo trabajar

- **Tests**: `npm test`. Si el equipo va cargado (otro navegador corriendo), la suite entera puede pasar de 10 min:
  correr `ls tests/*.test.mjs | grep -v net.test | xargs node --test` y `node --test tests/net.test.mjs` aparte.
  En PowerShell, limitar concurrencia y separar red:
  ```powershell
  $testFiles = @(rg --files tests -g '*.test.mjs' | Where-Object { $_ -notmatch '(^|[\\/])net\.test\.mjs$' })
  node --test --test-concurrency=2 @testFiles
  node --test tests/net.test.mjs
  ```
- **Ver los cambios visuales** (siempre, con capturas): `OUT=shots/x Q=high SCEN=village,fight,impact node
  tools/look.mjs` (escenarios en su cabecera; `lineup` para personajes de cerca; `MN_LIBS` si la red bloquea el
  CDN). Mirar las capturas antes de dar algo por bueno.
  En Windows: `MN_PLAYWRIGHT` = ruta absoluta al `index.mjs` de Playwright; `MN_BROWSER` = ruta al Chrome/Edge
  instalado. `MN_THREE` / `MN_GSAP` = carpetas de los paquetes locales si el CDN está bloqueado. `SCEN=pearl`
  prueba esta entrega; para móvil `PHONE=1`, `VW=844`, `VH=390`.
- **Artefacto** (la versión que se juega en claude.ai, modo solo): construir desde lo **commiteado**, no desde el
  árbol de trabajo:
  ```bash
  P=/tmp/pub; rm -rf $P && mkdir -p $P && git archive HEAD | tar -x -C $P
  (cd $P && node tools/build-artifact.mjs dist/index.html)   # imprime la página y la lista de archivos
  ```
  y publicar `dist/index.html` con esos archivos (`root` = `$P`) en la **misma URL**:
  https://claude.ai/artifact/MpCdPMbgw41nJKcf8NvSrD
- **Git**: rama `claude/loving-lovelace-ptbif7`, PR https://github.com/joeyxd/realms-of-trade-server/pull/1 (no
  abrir otro). Mensajes de commit descriptivos en inglés, con las líneas de coautoría del entorno al final; ningún
  identificador de modelo en commits ni en el código.
- **Método del autor**: el agente principal diseña, integra, revisa y pule; usar agentes GPT-6 Luna para todo trabajo
  delegable que ahorre tiempo/tokens sin comprometer el resultado (`AGENTS.md`), con un brief preciso
  (ejemplos en `docs/briefs/`). Se revisa todo antes del commit.
- Hablar con el autor en **español**.

## 5. Trampas conocidas

- `BufferAttribute.getComponent` no existe en three 0.160 (usar `getX/getY/getZ/getW`).
- `MeshToonMaterial` no acepta `flatShading` en el constructor (asignarlo después).
- Los materiales de los personajes llevan `aGlow` y `color` por vértice; un material nuevo de personaje debe
  compartir los uniformes `glow` / `flash` de la vista (`toonmat.js charToon`).
- La pasada de contornos usa `mesh.userData.nm` (o `material.userData.nm`): una malla con lista de materiales
  necesita su `userData.nm` propio.
- En el entorno de agentes, `cd` en Bash cambia el directorio de trabajo para siempre: usar rutas absolutas o
  `git -C`.
