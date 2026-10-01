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
npm test             # tests en Node (simulación, geometría de personajes, luces locales, partículas)
npm install          # opcional: trae three como devDependency para el test de geometría de personajes
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
(servidor en el hilo principal), `?tod=day|dusk|night|cycle` y `?phase=0..1` (hora del día), `?debug`
(teletransporte `__mn.teleport(x, z)`, `__mn.fxTest()`, la ficha de personajes `__mn.sheet({ yaw, run, pitch, dist,
list })`, la hora `__mn.tod('night')` / `__mn.tod('cycle', 0.75)` y las vistas del bloom `__mn.view('bloom' | 'glow')`).

## Controles

| Acción | Teclado / ratón | Táctil |
|---|---|---|
| Moverte (8 direcciones, relativo a la cámara) | WASD / flechas | joystick (mitad izquierda) |
| Dash (0,22 s, 5,5 u, invulnerable) | ESPACIO | botón DASH |
| Hablar / interactuar | F | botón F |
| Zoom (3 niveles: 15 / 20 / 27 u, cámara a 48°) | rueda | — |
| Rotar cámara 90° (activar en Ajustes) | Z / X | — |
| Atacar (combo de 3; rompe las bolas ámbar) | LMB / J | botón ATK |
| Parry / reflejar (¡PERFECTO! justo antes del impacto) | RMB / K | botón PARRY |
| RIPOSTE (onda que refleja todo; con el medidor lleno) | R | botón R |
| Pausa y ajustes | ESC | botón ⚙ |
| Rendimiento | F3 | — |
| Panel de pruebas (tuning en vivo, spawns, modo dios, hitboxes) | F4 | — |

Las habilidades Q/E aparecen bloqueadas en la barra de acción y se desbloquean por nivel (3/5) en M4.

## Estado de los milestones

| | Contenido | Estado |
|---|---|---|
| M0 | `DESIGN.md`: loop, controles, proyectiles, jefe por fases, tablas de XP/stats/loot, archivos, protocolo | ✅ |
| M1 | Isla + agua + luz + cámara + personaje caminando y dasheando, con la arquitectura de red completa | ✅ |
| v2 | Dirección de arte por referencias: agua ✅, personajes ✅, ambiente paso 1 ✅ (luces locales, noche, noche volcánica, grading), paso 2 ✅ (bloom, chispas y brasas con estela, ceniza, humo con luz); siguen lluvia, modo tinta → `DESIGN.md` §15 | en curso |
| M2 | Proyectiles, parry/reflect, 2 enemigos, hitstop, números de daño, F4. **Test de diversión** | ✅ |
| M2.5 | «La Prueba de Fuego»: oleadas bullet hell en La Caldera + jefe HELLFIRE (2 fases) → `PLAN-M2.5.md` | en curso |
| M3–M6 | Oleadas y jefe, progresión/loot, momentos Highlight, rendimiento y móvil final | — |

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

Medido en la vista de juego (sumando todas las pasadas, incluido el bloom): 80–130 draw calls y 180–315 k triángulos en
alta (el pico es la aldea al atardecer), 65–80 draw calls y 140–190 k triángulos en baja.

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
