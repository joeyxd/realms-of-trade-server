# MAREA NEGRA

Action-RPG isométrico para navegador (Three.js 0.160), con arquitectura preparada para MMO.
**Rebanada vertical 1:** isla tropical + arena volcánica «La Caldera».
Todo es procedural: geometría, texturas (canvas), shaders y audio sintetizado. Las únicas dependencias externas
son los CDN de Three.js y GSAP, y Google Fonts.

- Diseño completo (números, jefe, progresión, protocolo): [`DESIGN.md`](DESIGN.md)
- Revisión del intento anterior (servidor Socket.io 2D): [`legacy/REVIEW.md`](legacy/REVIEW.md)

## Cómo ejecutarlo

```bash
npm install          # ws (servidor) y three (tests de geometría)
npm start            # servidor de juego: http://localhost:5173 → abre 2–4 pestañas o equipos y compartís la isla
npm test             # tests en Node (simulación, red, servidor, geometría de personajes, luces, partículas)
npm run static       # solo estáticos (sin servidor): cada pestaña juega su propia isla en un Web Worker
```

No hace falta bundler. El juego también se puede publicar como Artifact multi-archivo (modo solo):
`node tools/build-artifact.mjs dist/index.html` genera la página (con los estilos incrustados) y lista los módulos
`src/**` que hay que publicar junto a ella.

### Jugar en línea (M3.6)

`npm start` levanta **un solo proceso** que sirve el cliente y corre el mundo: el mismo `LocalServer` que en solo
vive en el Web Worker, detrás de WebSockets (`/ws`). La página que sirve lleva la marca `<meta name="mn-server">`
y el cliente entra en línea sin preguntar; con `?solo` juega en su Worker, con `?server=wss://host/ws` se conecta a
otro servidor. En el título eliges **nombre** y aspecto; la píldora dice cuántos piratas hay a bordo (máximo 4).

| Variable | Por defecto | Qué hace |
|---|---|---|
| `PORT` / `HOST` | 5173 / 0.0.0.0 | dónde escucha |
| `MAX_PLAYERS` | 4 | humanos por instancia (el resto puede mirar, y recibe «tripulación completa») |
| `BOTS` | 3 | bots que pasean por la isla |
| `DEV` | 0 | `1` habilita F4 y el teletransporte de `?debug` (nunca en un servidor público) |
| `ORIGINS` | (todas) | orígenes permitidos para el WebSocket, separados por comas |
| `LAG_MS` / `JITTER_MS` | 0 | latencia artificial por sentido, para probar (`?lag=&jitter=` hace lo mismo en el cliente) |

**Desplegar en Render:** el `render.yaml` de la raíz crea un *web service* gratuito (Node 22, `npm install
--omit=dev`, `npm start`, comprobación en `/health`). `/status` devuelve jugadores, tick, ms por paso y contadores
de red. En el plan gratuito el servicio duerme tras 15 min sin visitas; la primera visita lo despierta (~30 s).

Medir la red: `RTTS=0,100,200 N=2 LV=6 SKILL=0.9 node tools/nettest.mjs` levanta un servidor por RTT y bots-cliente
reales por WebSocket que juegan la Prueba de Fuego en cooperativo (ver «Qué incluye M3.6»).

Herramienta de capturas (Playwright, Chromium headless):

```bash
node tools/shot.mjs shots/ --quality=high          # título, playa, dash, aldea, capitana, sendero, Caldera
node tools/shot.mjs shots/m --scenario=title --w=390 --h=844 --quality=medium
```

Parámetros de URL para desarrollo: `?q=low|medium|high` (calidad), `?perf` (overlay F3), `?worker=0`
(servidor en el hilo principal), `?tod=day|dusk|night|cycle` y `?phase=0..1` (hora del día), `?debug`
(teletransporte `__mn.teleport(x, z)`, `__mn.fxTest()`, la ficha de personajes `__mn.sheet({ yaw, run, pitch, dist,
list })`, la hora `__mn.tod('night')` / `__mn.tod('cycle', 0.75)` y las vistas del bloom `__mn.view('bloom' | 'glow')`).

## Controles

| Acción | Teclado / ratón | Táctil |
|---|---|---|
| Moverte (8 direcciones, relativo a la cámara) | WASD / flechas | joystick (mitad izquierda) |
| Dash (0,22 s, 5,5 u, invulnerable) | ESPACIO | botón DASH |
| Apuntar (el cuerpo mira al cursor; las piernas siguen la marcha) | ratón · stick derecho | auto-apuntado · arrastrar Q/E/R |
| Hablar / interactuar · junto a un armero: cambiar de arma | F | botón F |
| Zoom (3 niveles: 15 / 20 / 27 u, cámara a 48°) | rueda | — |
| Rotar cámara 90° (activar en Ajustes) | Z / X | — |
| Ataque del arma. Sable: combo de 3, golpea la bala justo antes del impacto para reflejarla (EXCELENTE / BUENO / POBRE). Pistolas: mantén para disparar | LMB / J / RT | botón ATK (mantener) |
| Guardia (mantener): bloquea de frente; alzada justo a tiempo ATRAPA la bala y tu siguiente ataque la devuelve | RMB / K / LT | botón GUARDIA (mantener) |
| Habilidades del arma (al cursor). Sable: Estocada / Hoja de viento. Pistolas: Descarga / Paso de humo | Q / E · RB / LB | botones Q / E |
| R con el RIPOSTE lleno. Sable: Tormenta. Pistolas: Lluvia de plomo | R / Y | botón R |
| Pausa y ajustes | ESC / Start | botón ⚙ |
| Rendimiento | F3 | — |
| Panel de pruebas (tuning en vivo, spawns, modo dios, cambiar de arma, hitboxes) | F4 | — |

Hay dos armeros: en la playa, junto al punto de inicio, y en la aldea. El arma que lleves se recuerda para la
próxima partida.

## Estado de los milestones

| | Contenido | Estado |
|---|---|---|
| M0 | `DESIGN.md`: loop, controles, proyectiles, jefe por fases, tablas de XP/stats/loot, archivos, protocolo | ✅ |
| M1 | Isla + agua + luz + cámara + personaje caminando y dasheando, con la arquitectura de red completa | ✅ |
| v2 | Dirección de arte por referencias: agua ✅, personajes ✅, ambiente paso 1 ✅ (luces locales, noche, noche volcánica, grading), paso 2 ✅ (bloom, chispas y brasas con estela, ceniza, humo con luz); siguen lluvia, modo tinta → `DESIGN.md` §15 | en curso |
| M2 | Proyectiles, parry/reflect, 2 enemigos, hitstop, números de daño, F4. **Test de diversión** | ✅ |
| M2.5 | «La Prueba de Fuego»: oleadas bullet hell en La Caldera + jefe HELLFIRE (2 fases) → `PLAN-M2.5.md` | ✅ |
| M3 | 5 oleadas, Cangrejo mortero, HELLFIRE en 3 fases (embestida, láser doble, meteoros, carriles de fuego, cortina, lava) → `PLAN-M3.md` | ✅ |
| M3.5 | Combate V2: apuntar con ratón / mando, reflejo a tiempo en 3 niveles, guardia que atrapa, armas con su kit (sable y pistolas), armeros → `PLAN-M3.5.md` | ✅ |
| M3.6 | Servidor Node real con 2–4 jugadores (WebSocket), mismo `LocalServer`, cooperativo medido con latencia → `PLAN-M3.6.md` | ✅ |
| M4–M6 | Progresión/loot, momentos Highlight, rendimiento y móvil final | siguiente |

### Qué incluye M1

- **Isla de 400×400 u** generada con semilla: playa, Aldea Coralina (6 chozas, fogata, puesto, faroles, muelle con
  barco anclado), Sendero del Humo con baldosas, selva, volcán con río de lava y La Caldera (suelo de basalto con
  grietas de lava, pilares, braseros y portón).
- **Render toon**: una sola función de bandas de luz (`mnBand`) compartida por personajes, props, terreno y agua;
  contornos por post-proceso (profundidad + normales, grosor constante, sin artefactos diagonales); sombras del sol
  que siguen al jugador encajadas a texel; sombras de nubes.
- **Ambiente v2, paso 1**: luces locales en el mismo estilo de bandas (faroles, braseros, fogata, lava, ventanas de
  las chozas, ojos de los centinelas, luz del jugador de noche y destello del dash), con parpadeo y sin saltos al
  cambiar cuáles están activas; se reflejan en el agua. Presets **día, atardecer, noche** (luna, estrellas, agua
  oscura con camino de brillos) y **noche volcánica** en La Caldera; ciclo día/noche de 16 min o una hora fija
  («Hora del día» en Pausa). Grading por preset: contraste en curva S, tonos partidos (sombras índigo, luces ámbar)
  y viñeta.
- **Ambiente v2, paso 2**: bloom por máscara de brillo (lava, vetas de las grietas, gemas, faroles, ventanas, luna y
  estrellas, destellos en el agua, fuego, chispas y afterimages; la arena al sol no brilla), más fuerte de noche y en
  La Caldera. Chispas y brasas con estela que se enfrían al subir, burbujas de lava que revientan, ceniza que cae
  cerca de La Caldera, y humo en volutas iluminado por el preset y por los braseros.
- **Agua v2**: refracción en pantalla del fondo (con sus contornos), absorción por canal a lo largo del rayo
  (arena → turquesa → azul profundo), cáusticas onduladas sobre el fondo, espuma de contacto alrededor de rocas,
  postes, casco, carga flotante y piernas, encaje de espuma en la orilla, ondas de espuma al vadear, destellos de sol
  que titilan, algas y piedras bajo el agua. Variante barata para calidad baja. Detalle en `DESIGN.md` §11.
- **Personajes adultos low-poly** (v2, según referencias): ~6,5 cabezas, facetados, ropa por capas (capucha y
  capa, abrigo abierto, chaleco, corsé, cinturones con hebilla, bandolera, bolsas, brazaletes, botas con vuelta,
  hombreras). 5 aspectos de jugador (Corsario, Exploradora elfa, Bucanero, Tormenta, Brasa), la Capitana Brea, Tía
  Perla y el **Centinela** esqueleto (dos duermen en la entrada de La Caldera; despiertan en M2). Esqueleto de 15
  huesos con rodillas, codos y paneles de tela; animación procedural (respiración, cambio de peso, carrera con
  rodillas/codos y contrarrotación, dash, faldones con muelles) y afterimages del dash. Retratos del HUD y del
  selector de aspecto renderizados con el modelo real. 1,7–2,5 k triángulos y 1 draw call por pasada cada uno.
- **Cámara MOBA**: seguimiento amortiguado, look-ahead al cursor (máx. 20 %), 3 zooms, shake por trauma, punch,
  modo naval reservado. La vegetación y los props que tapan al jugador o están pegados a la cámara se disuelven.
- **Mundo vivo**: 5 bots con nombre que pasean por la aldea (la UI no los distingue de jugadores), la Capitana Brea
  y Tía Perla con diálogos, cangrejos que huyen, gaviotas, mariposas, humo de fogata y del volcán, chispas, brasas y ceniza.
- **UI**: título animado (JUGAR solo se activa tras compilar los shaders), HUD con retrato, barras, barra de acción
  con cargas de dash y recarga radial, banner de zona, objetivos del tutorial, avisos flotantes, nameplates que
  escalan con la distancia y se ocultan si tapan al jugador, pausa con ajustes, overlay F3, controles táctiles.
- **Audio sintetizado**: pasos por material (arena, hierba, roca, tierra, madera, agua), whoosh del dash, olas,
  viento, aves FM, insectos y lava mezclados por zona, música generativa (marimba + pad + bajo) que cambia a modo
  menor con dron en La Caldera.
- **Calidad** baja/media/alta + AUTO (baja un nivel si cae de 45 fps).

### Qué incluye M2

- **Proyectiles analíticos** (parreable ámbar, pesado naranja, imparable violeta con ✕) con 150 ms de armado, sombra
  en el suelo y recorte contra pilares, rocas y acantilados. El servidor envía un evento de patrón y cada cliente lo
  expande con los mismos ids; nada se sincroniza bala a bala.
- **Combate**: combo de 3 golpes (el tercero aturde y cancela ataques), destruir bolas con el golpe, **parry** de
  110° (PERFECTO en los primeros 80 ms, cadena x1→x5 con «clang» que sube de tono), reflejo con homing que ignora
  armadura, bloqueo del pesado, castigo al parrear un imparable, **ROCE** (+XP, +RIPOSTE), **FANTASMA** al dashear a
  través de un imparable y **RIPOSTE** (onda r=6 que refleja todo).
- **Enemigos**: 3 arqueros esqueleto junto al Sendero del Humo y 2 centinelas dormidos en el portón de La Caldera
  (tajo AoE con círculo que se llena, abanico de púas, orbe pesado). Steering sin pathfinding, wind-ups
  telegrafiados, respawn, debris de huesos al morir.
- **Red**: compensación de lag por `pt` (el servidor evalúa cada comando en el tick que veía el jugador), predicción
  del combate con reconciliación y deduplicación, tiempo de instancia (hitstop y slow-mo del PERFECTO en servidor y
  cliente). Test con un cliente a la mitad del ritmo del servidor: error de predicción 0.
- **Feel**: hitstop por tipo de golpe, slow-mo, onda de 3 capas, destellos, temblor, números de daño que se apilan,
  toasts de tutorial, nameplates con barra de vida, sonidos sintetizados por evento.
- **Zona de práctica** en la playa (muñeco + cañón con anillo de cuerda) y **panel F4** con sliders de tuning en
  vivo (cliente y servidor local a la vez), spawns, curar, riposte lleno, nivel ±, modo dios e hitboxes.
- 34 tests en Node (`npm test`).

### Qué incluye M2.5 — «La Prueba de Fuego»

- **Bullet hell en La Caldera**: pisa el círculo de runas del centro y llegan 3 oleadas (con refuerzos) de
  **grumetes ahogados** (esbirros melee que te persiguen en manada y muerden), **diablillos de fuego** (espirales
  de 10 orbes) y **chamanes de coral** (anillos que alternan ámbar parreable y violeta imparable), más arqueros.
  Hasta ~100 balas a la vez. Banner por oleada, contador de enemigos, cámara algo más abierta durante la prueba.
- **HELLFIRE**, Señor de La Caldera: jefe de 2 fases con barra propia. Abanicos apuntados, espirales de 3 y 6
  brazos (la «flor»), anillos alternos, muro de púas imparables (dashea a través), orbe pesado, golpe de área si
  te pegas a él e invocación de esbirros. Al 55 %: ENRAGE (invulnerable, limpia las balas) y **escudo** que solo
  atraviesan tus reflejos; refleja su orbe pesado con un PERFECTO para romperlo.
- **Rebote**: los reflejos que impactan saltan al siguiente enemigo (2 veces con PERFECTO). **ESQUIVA**: atravesar
  balas con el dash da XP y RIPOSTE.
- Reinicio si todos caen o salen, con checkpoint en el jefe; botones de la prueba en F4 (iniciar, oleada,
  jefe, fase 2, ganar, reiniciar).
- 44 tests en Node; una partida simulada con bot la supera en ~100 s (el jefe, ~50 s) recibiendo ~2 barras de vida.

### Qué incluye M3 — la prueba completa

- **5 oleadas**: las dos nuevas traen al **Cangrejo mortero**, blindado por delante (de frente tus golpes hacen
  × 0,2: rodéalo con un dash o devuélvele las balas, que atraviesan la placa). Gira despacio y lanza 3 morteros
  alrededor de ti que caen 1,1 s después… aunque él ya haya muerto.
- **HELLFIRE en 3 fases** (3200 HP, umbrales 75 % y 45 %):
  - Fase 1: abanicos, espirales y anillos + **Embestida** (un rectángulo rojo marca la línea; luego carga).
  - Fase 2, con escudo: la flor, muro de púas, invocaciones y el **láser doble rotatorio** (crúzalo con dash:
    FANTASMA).
  - Fase 3, «¡HELLFIRE DESATADO!»: **meteoros** que caen del cielo (uno de cada tres sobre ti), **carriles de
    fuego** que barren la arena, **cortinas de balas** con un hueco por fila y **lava** que se come la arena del
    borde hacia dentro (de 19 a 11 u). Sus llamas frenan tus golpes (× 0,5): refleja la cortina contra él, y su
    orbe pesado con un PERFECTO lo aturde 2,5 s.
- Música por capas que sube con las oleadas, barra del jefe con dos marcas, consejos la primera vez que ves cada
  peligro, botones nuevos en F4 (+ Cangrejo, Fase 3).
- `tools/playtest.mjs`: un bot sin cabeza juega la prueba entera (`LV=6 SKILL=0.9 node tools/playtest.mjs`).
  Casi perfecto: ~170 s en total (jefe ~70 s), ~2,5 barras de daño recibido; con `SKILL=0.7`: ~260 s.
  La sim tarda ~0,16 ms por paso con ~115 balas vivas.
- 55 tests en Node.

### Qué incluye M3.5 — Combate V2

- **Apuntar:** con ratón o stick derecho el cuerpo mira al cursor mientras caminas hacia otro lado (las piernas
  siguen la marcha, el torso el cursor; hacia atrás vas a × 0,9). Mando completo (Gamepad API).
- **Sable de cubierta:** el reflejo depende de cuándo golpeas: EXCELENTE (≤ 70 ms antes del impacto: recta al cursor,
  × 3, devuelve orbes pesados, cámara lenta), BUENO (≤ 150 ms, × 2), POBRE (≤ 260 ms, × 1, se desvía); antes,
  la bala solo se destruye. Q **Estocada** (embestida de 4,5 u que atraviesa la línea), E **Hoja de viento** (media
  luna que vuela al cursor, corta balas y daña a todo lo que cruza), R **Tormenta**.
- **Pistolas de chispa:** disparo alterno mantenido (balas que el blindaje y el escudo frenan), Q **Descarga**
  (escopetazo que sopla balas), E **Paso de humo** (blink con invulnerabilidad), R **Lluvia de plomo** (zona en el
  cursor). No reflejan: atrapan con la guardia.
- **Guardia** (RMB mantenido) con aguante, rotura y **guardia perfecta**: atrapa hasta 3 balas que tu siguiente
  ataque devuelve, y aturde a quien estaba atacándote de cerca.
- Red: el cambio de arma, las habilidades y los disparos se predicen exactos; los disparos se juzgan contra los
  enemigos tal como los veía quien disparó (lag compensation). Arreglo: el cliente ya no duplica sus reflejos.
- Bot: `WEAPON=pistolas LV=6 SKILL=0.9 node tools/playtest.mjs`. Sable ~150 s (jefe ~55 s), pistolas ~215 s
  (jefe ~100 s); la sim tarda ~0,12 ms por paso.
- 84 tests en Node.

### Qué incluye M3.6 — en línea, 2–4 piratas

- **Servidor Node real** (`npm start`): sirve el juego y corre el mundo en un proceso; el mismo `LocalServer` que en
  solo vive en el Worker, detrás de WebSockets comprimidos. Límites por conexión, latidos, `/health`, `/status`,
  `render.yaml` para Render. El quinto jugador recibe «tripulación completa» y sigue mirando.
- **Cliente:** entra en línea solo si la página viene del servidor; nombre y aspecto en el título, píldora «EN
  LÍNEA · n/4», «Jugar solo / en línea», ping en el HUD, aviso de conexión perdida con «Reconectar». En línea el
  menú no congela el mundo.
- **Cooperativo:** marcos de la tripulación (nombre, nivel, vida, arma, caído), placas verdes para los humanos,
  «X subió a bordo / dejó la isla», el tajo de los demás. La Prueba de Fuego escala con la tripulación (oleadas
  × 1,6 de vida con dos, HELLFIRE × 1,75) y lo dice («Tripulación 2»). Tu hitstop es tuyo: con compañía no
  detiene a los demás; la muerte del jefe sí detiene a todos.
- **Red robusta:** si un cliente se calla (pestaña oculta, pico de lag) el servidor lo rellena con comandos neutros
  (le siguen golpeando); lo que llega tarde no da movimiento extra. Rebobinado 20 → 24 ticks (400 ms).
- **Arreglo:** una muerte por disparo (que espera a que la bala visual llegue) podía caer sobre la entidad que
  reusaba su id: el jefe nacía «muriendo» (sin barra, sin auto-apuntado) y los arqueros abatidos con reflejos no
  contaban en el tutorial. Ahora el despawn espera a esa muerte.
- **Medido** con `tools/nettest.mjs` (2 bots-cliente reales por WebSocket, sable + pistolas, Nv 6, habilidad 0,9,
  ±5 ms de jitter):

  | RTT | Victoria | Correcciones de predicción | Fuera del rebobinado | Por cliente |
  |---|---|---|---|---|
  | 0 ms | 128 s | 0 | 0 | ~6 KB/s |
  | 100 ms | 175 s | ≤ 0,7/min (0,3 u) | 0 | ~6 KB/s |
  | 200 ms | 201 s | ≤ 0,6/min (0,3–0,6 u) | 0 | ~6 KB/s |
  | 300 ms | 277 s | ≤ 0,2/min (0,4–0,6 u) | 0 | ~5 KB/s |

  Las correcciones son los empujones de los golpes (el servidor los decide); el daño recibido no crece con la
  latencia porque cada golpe se juzga en el tick que veía el jugador. Con 4 jugadores en la arena: 8 KB/s por
  cliente en el cable y ~0,3–0,6 ms por paso en el servidor. Entre ejecuciones la victoria varía ±30 s.
- 95 tests en Node (servidor, cooperativo y red incluidos).

Medido en la vista de juego (sumando todas las pasadas, incluido el bloom): 80–130 draw calls y 180–315 k triángulos en
alta (el pico es la aldea al atardecer), 65–80 draw calls y 140–190 k triángulos en baja.

## Arquitectura

```
src/sim/      simulación pura y determinista (sin THREE ni DOM): worldgen, ECS sobre typed arrays, movimiento, bots
src/net/      protocolo, LocalServer (servidor autoritativo), worker, transportes (Worker / en proceso / WebSocket), LagLink
server/       servidor Node: estáticos + WebSocket + límites (GameHost envuelve el mismo LocalServer)
src/client/   predicción del jugador local + reconciliación, interpolación del resto (buffer de 100 ms)
src/render/   escena, pipeline de contornos, toon, terreno, agua, cielo, vegetación, props, personajes, VFX
src/ui/       título, HUD, prompts/nameplates, pausa, táctil
src/audio/    motor Web Audio, SFX, ambiente, música
src/data/     meta (nombre del juego), tuning (todos los números), ship_modules (gancho naval)
```

- **Un solo servidor de juego:** `LocalServer` (60 Hz, snapshots a 20 Hz) corre en un Web Worker en solo y dentro
  del proceso Node en línea (`server/host.mjs`: un id por socket, JSON comprimido con permessage-deflate, cubetas
  de tokens, latidos). El cliente solo envía inputs y predice su propio movimiento con el mismo código; los tests
  `client prediction matches the authoritative server exactly` (en proceso) y `two players at 100 ms RTT` (por
  WebSocket) comprueban error de predicción 0. Los bots son entidades `player` del servidor que generan los mismos
  comandos que un humano.
- **Pendiente para un MMO de verdad:** autenticación en `hello`, varias instancias (una por arena / grupo),
  persistencia del personaje y el protocolo binario (formato en `DESIGN.md` §10).
- **Ganchos navales:** muelle con barco anclado e interacción «ZARPAR · próximamente», `src/data/ship_modules.js`,
  componente `VEHICLE` reservado en el ECS, `camera.setMode('naval')` y mensajes `ship_*`, `board`, `dock`,
  `trade_*` reservados en `protocol.js`.
