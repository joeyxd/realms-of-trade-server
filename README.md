# MAREA NEGRA

Action-RPG isométrico para navegador (Three.js 0.160), con arquitectura preparada para MMO.
**Rebanada vertical 1:** isla tropical + arena volcánica «La Caldera».
Todo es procedural: geometría, texturas (canvas), shaders y audio sintetizado. Las únicas dependencias externas
son los CDN de Three.js y GSAP, y Google Fonts.

- Diseño completo (números, jefe, progresión, protocolo): [`DESIGN.md`](DESIGN.md)
- Revisión del intento anterior (servidor Socket.io 2D): [`legacy/REVIEW.md`](legacy/REVIEW.md)

## Cómo ejecutarlo

```bash
npx serve .          # o: npm start  → http://localhost:5173
npm test             # tests de la simulación en Node (determinismo, dash, colisiones, predicción)
```

Basta con cualquier servidor estático; no hace falta bundler. El juego también se puede publicar como Artifact
multi-archivo: `node tools/build-artifact.mjs dist/index.html` genera la página (con los estilos incrustados) y
lista los módulos `src/**` que hay que publicar junto a ella.

Herramienta de capturas (Playwright, Chromium headless):

```bash
node tools/shot.mjs shots/ --quality=high          # título, playa, dash, aldea, capitana, sendero, Caldera
node tools/shot.mjs shots/m --scenario=title --w=390 --h=844 --quality=medium
```

Parámetros de URL para desarrollo: `?q=low|medium|high` (calidad), `?perf` (overlay F3), `?worker=0`
(servidor en el hilo principal), `?debug` (teletransporte `__mn.teleport(x, z)` y `__mn.fxTest()`).

## Controles

| Acción | Teclado / ratón | Táctil |
|---|---|---|
| Moverte (8 direcciones, relativo a la cámara) | WASD / flechas | joystick (mitad izquierda) |
| Dash (0,22 s, 5,5 u, invulnerable) | ESPACIO | botón DASH |
| Hablar / interactuar | F | botón F |
| Zoom (3 niveles: 17 / 23 / 30 u, cámara a 48°) | rueda | — |
| Rotar cámara 90° (activar en Ajustes) | Z / X | — |
| Pausa y ajustes | ESC | botón ⚙ |
| Rendimiento | F3 | — |

Atacar (LMB), parry (RMB) y las habilidades Q/E/R aparecen bloqueadas en la barra de acción: llegan en M2 y se
desbloquean por nivel (3/5/7).

## Estado de los milestones

| | Contenido | Estado |
|---|---|---|
| M0 | `DESIGN.md`: loop, controles, proyectiles, jefe por fases, tablas de XP/stats/loot, archivos, protocolo | ✅ |
| M1 | Isla + agua + luz + cámara + personaje caminando y dasheando, con la arquitectura de red completa | ✅ |
| M2 | Proyectiles, parry/reflect, 2 enemigos, hitstop, números de daño, F4. **Test de diversión** | siguiente |
| M3–M6 | Oleadas y jefe, progresión/loot, momentos Highlight, rendimiento y móvil final | — |

### Qué incluye M1

- **Isla de 400×400 u** generada con semilla: playa, Aldea Coralina (6 chozas, fogata, puesto, faroles, muelle con
  barco anclado), Sendero del Humo con baldosas, selva, volcán con río de lava y La Caldera (suelo de basalto con
  grietas de lava, pilares, braseros y portón).
- **Render toon**: una sola función de bandas de luz (`mnBand`) compartida por personajes, props, terreno y agua;
  contornos por post-proceso (profundidad + normales, grosor constante, sin artefactos diagonales); sombras del sol
  que siguen al jugador encajadas a texel; sombras de nubes; hora dorada al entrar en La Caldera (transición de 2 s).
- **Agua v2**: refracción en pantalla del fondo (con sus contornos), absorción por canal a lo largo del rayo
  (arena → turquesa → azul profundo), cáusticas onduladas sobre el fondo, espuma de contacto alrededor de rocas,
  postes, casco, carga flotante y piernas, encaje de espuma en la orilla, ondas de espuma al vadear, destellos de sol
  que titilan, algas y piedras bajo el agua. Variante barata para calidad baja. Detalle en `DESIGN.md` §11.
- **Personaje chibi** con 5 aspectos: un solo mesh con huesos rígidos (1 draw call por pasada), animación procedural
  (respiración, carrera con inclinación, estiramiento en el dash, squash & stretch con muelles amortiguados) y
  afterimages del dash.
- **Cámara MOBA**: seguimiento amortiguado, look-ahead al cursor (máx. 20 %), 3 zooms, shake por trauma, punch,
  modo naval reservado. La vegetación y los props que tapan al jugador o están pegados a la cámara se disuelven.
- **Mundo vivo**: 5 bots con nombre que pasean por la aldea (la UI no los distingue de jugadores), la Capitana Brea
  y Tía Perla con diálogos, cangrejos que huyen, gaviotas, mariposas, humo de fogata y del volcán, brasas.
- **UI**: título animado (JUGAR solo se activa tras compilar los shaders), HUD con retrato, barras, barra de acción
  con cargas de dash y recarga radial, banner de zona, objetivos del tutorial, avisos flotantes, nameplates que
  escalan con la distancia y se ocultan si tapan al jugador, pausa con ajustes, overlay F3, controles táctiles.
- **Audio sintetizado**: pasos por material (arena, hierba, roca, tierra, madera, agua), whoosh del dash, olas,
  viento, aves FM, insectos y lava mezclados por zona, música generativa (marimba + pad + bajo) que cambia a modo
  menor con dron en La Caldera.
- **Calidad** baja/media/alta + AUTO (baja un nivel si cae de 45 fps).

Medido en la vista de juego (sumando todas las pasadas): ~100 draw calls y ~300 k triángulos en alta, ~50 draw
calls y ~145 k triángulos en baja.

## Arquitectura

```
src/sim/      simulación pura y determinista (sin THREE ni DOM): worldgen, ECS sobre typed arrays, movimiento, bots
src/net/      protocolo, LocalServer (servidor autoritativo), worker, transportes (Worker / en proceso / WebSocket stub)
src/client/   predicción del jugador local + reconciliación, interpolación del resto (buffer de 100 ms)
src/render/   escena, pipeline de contornos, toon, terreno, agua, cielo, vegetación, props, personajes, VFX
src/ui/       título, HUD, prompts/nameplates, pausa, táctil
src/audio/    motor Web Audio, SFX, ambiente, música
src/data/     meta (nombre del juego), tuning (todos los números), ship_modules (gancho naval)
```

- **Qué está simulado hoy:** el servidor corre en un Web Worker (`LocalServer` a 60 Hz, snapshots a 20 Hz). El
  cliente solo envía inputs y predice su propio movimiento con el mismo código; el test
  `client prediction matches the authoritative server exactly` comprueba error de predicción 0. Los bots son
  entidades `player` del servidor que generan los mismos comandos que un humano.
- **Plan para el servidor real:** un proceso Node que importe `src/net/localServer.js` (es puro) y lo ponga detrás
  de WebSockets: cada conexión llama a `connect/receive/disconnect` y `send` escribe al socket. En el cliente,
  cambiar `createTransport` por `new WsTransport(url)` (misma interfaz). Pasos: validar ritmo de inputs por
  cliente (ya se limita la cola a 30 comandos y 1–4 por tick), autenticación en `hello`, instancias por arena,
  persistencia del personaje y protocolo binario (formato en `DESIGN.md` §10). El servidor Socket.io de `legacy/`
  sirve de plantilla para el despliegue en Render.
- **Ganchos navales:** muelle con barco anclado e interacción «ZARPAR · próximamente», `src/data/ship_modules.js`,
  componente `VEHICLE` reservado en el ECS, `camera.setMode('naval')` y mensajes `ship_*`, `board`, `dock`,
  `trade_*` reservados en `protocol.js`.
