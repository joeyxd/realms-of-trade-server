# MAREA NEGRA

Action-RPG isométrico para navegador (Three.js 0.160), con arquitectura preparada para MMO.
**Rebanada vertical 1:** isla tropical + arena volcánica «La Caldera».
Todo es procedural: geometría, texturas (canvas), shaders y audio sintetizado. Las únicas dependencias externas
son los CDN de Three.js y GSAP, y Google Fonts.

- Diseño completo (números, jefe, progresión, protocolo): [`DESIGN.md`](DESIGN.md)
- Revisión del intento anterior (servidor Socket.io 2D): [`legacy/REVIEW.md`](legacy/REVIEW.md)
- **Para seguir el proyecto:** [`docs/HANDOFF.md`](docs/HANDOFF.md) · modelos externos (Meshy…): [`docs/ASSETS.md`](docs/ASSETS.md) · jugar en línea en tu servidor: [`docs/DEPLOY.md`](docs/DEPLOY.md)

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

Para un paquete ligado a un commit: `node tools/build-release.mjs HEAD`. Lee el árbol commiteado, comprueba
versión/protocolo e imports y crea `dist/<versión>-<SHA>/` con la página, módulos y assets. `release.json` registra
origen, bytes y SHA256 de cada archivo; cambios locales sin commit no entran. Servir por HTTP para probarlo.

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
| `SAVE_SECRET` | (al azar) | clave HMAC de las partidas guardadas (M4). Sin ella se inventa una al arrancar y las partidas no sobreviven a un reinicio; `render.yaml` la genera |

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
| Apuntar (el cuerpo mira al cursor; las piernas siguen la marcha) | ratón · stick derecho | auto-apuntado · arrastrar Q/E/R/G |
| Hablar / interactuar · junto a un armero: cambiar de arma · abrir tu cofre · en las runas: cambiar de Marea | F | botón de acción (aparece con su verbo: Hablar, Abrir, Cambiar, Marea, Zarpar) |
| Poción de ron-coco (cura el 40 %, 2 s de espera, máx. 5) | 1 · cruceta ↑ | botón de poción |
| Personaje: Equipo / Atributos / Misiones / Tatuajes / Perlas | I o B / C / L / T / P · Select | botón Bolsa |
| Mapa de la isla | M | botón Mapa |
| Zoom (3 niveles: 15 / 20 / 27 u, cámara a 48°) | rueda | — |
| Rotar cámara 90° (activar en Ajustes) | Z / X | — |
| Ataque del arma. Sable: combo de 3, golpea la bala justo antes del impacto para reflejarla (EXCELENTE / BUENO / POBRE). Pistolas: mantén para disparar | LMB / J / RT | botón ATK (mantener) |
| Guardia (mantener): bloquea de frente; alzada justo a tiempo ATRAPA la bala y tu siguiente ataque la devuelve | RMB / K / LT | botón GUARDIA (mantener) |
| Tus dos huecos: las artes del arma (sable: Estocada / Hoja de viento; pistolas: Descarga / Paso de humo) o tus tatuajes. Un área (Tromba, Abordaje) se apunta manteniendo y sale al soltar (RMB / ESC / B cancelan); el Timón se carga manteniendo | Q / E · RB / LB | botones Q / E (arrastrar apunta; mantener carga) |
| R con el RIPOSTE lleno. Sable: Tormenta. Pistolas: Lluvia de plomo | R / Y | botón R |
| Poder de la perla tragada: Brasa → Cometa; Escarcha → Ancla de hielo; Tormenta → Rayo de mástil; Tinta → Nube de tinta | G · cruceta ↓ | botón COMETA / ANCLA / RAYO / NUBE |
| Pausa y ajustes (ESC cierra antes el diálogo, el panel o el mapa) | ESC / Start | botón ⚙ |
| Rendimiento | F3 | — |
| Panel de pruebas (tuning en vivo, spawns, modo dios, cambiar de arma, hitboxes) | F4 | — |

Hay dos armeros: en la playa, junto al punto de inicio, y en la aldea. Desde M4 tu partida (nivel, equipo, bolsa,
maestrías, misiones, Marea) se guarda en el navegador, una por servidor; «Nueva partida» en Pausa la borra.

## Estado de los milestones

| | Contenido | Estado |
|---|---|---|
| M0 | `DESIGN.md`: loop, controles, proyectiles, jefe por fases, tablas de XP/stats/loot, archivos, protocolo | ✅ |
| M1 | Isla + agua + luz + cámara + personaje caminando y dasheando, con la arquitectura de red completa | ✅ |
| v2 | Dirección de arte por referencias: agua ✅, personajes ✅, ambiente paso 1 ✅ (luces locales, noche, noche volcánica, grading), paso 2 ✅ (bloom, chispas y brasas con estela, ceniza, humo con luz), tinta ✅ (M4.6); sigue la lluvia → `DESIGN.md` §15 | en curso |
| M2 | Proyectiles, parry/reflect, 2 enemigos, hitstop, números de daño, F4. **Test de diversión** | ✅ |
| M2.5 | «La Prueba de Fuego»: oleadas bullet hell en La Caldera + jefe HELLFIRE (2 fases) → `PLAN-M2.5.md` | ✅ |
| M3 | 5 oleadas, Cangrejo mortero, HELLFIRE en 3 fases (embestida, láser doble, meteoros, carriles de fuego, cortina, lava) → `PLAN-M3.md` | ✅ |
| M3.5 | Combate V2: apuntar con ratón / mando, reflejo a tiempo en 3 niveles, guardia que atrapa, armas con su kit (sable y pistolas), armeros → `PLAN-M3.5.md` | ✅ |
| M3.6 | Servidor Node real con 2–4 jugadores (WebSocket), mismo `LocalServer`, cooperativo medido con latencia → `PLAN-M3.6.md` | ✅ |
| M4 | «El botín»: objetos y rarezas, maestría por arma que abre el kit, loot personal, pociones, misiones y diálogo, Tía Perla, Mareas, partidas guardadas y firmadas, HUD y paneles completos → `PLAN-M4.md` | ✅ |
| M4.5 | «Sin ley»: los detalles de M4 (aviso del cofre, palmeras sobre el cofre, cofres de Marea para el oro) y la **Cala Calavera**, un fuerte donde hay fuego amigo, los mobs se pelean entre ellos, los Desalmados cazan a todos y si caes lo pierdes todo → `PLAN-M4.5.md` | ✅ |
| M4.6 | «Tinta»: el móvil siempre en horizontal (el juego se dibuja girado si el teléfono está de pie), botones táctiles de cristal por colores en arco, y el pase de cómic: contornos de tinta con peso, sombras duras teñidas con trama, superficies pintadas → `PLAN-M4.6.md` | ✅ |
| M4.7 | «Tatuajes»: Q / E libres (artes del arma o tatuajes), tres tatuajes con rangos y formas (Tromba, Abordaje, Timón), apuntado tipo MOBA, Doña Sepia y la pestaña Tatuajes; el cómic Ultra para GPU potentes → `PLAN-M4.7.md` | ✅ |
| M4.8 | «Perlas negras»: kit integrado y pulido, candidato P5 → `PLAN-M4.8.md`; aceptación física y publicación pendientes | rc.1 |
| M5–M8 | La estructura: mundo persistente (Supabase), «La Balsa», comercio entre pueblos, construcción → `PLAN-M5.md` … `PLAN-M8.md`, `docs/HANDOFF.md` | núcleo en parte |

### Entrega actual de M4.8 — candidato integrado (`0.4.8-rc.1`)

- Las perlas raras salen de élites, HELLFIRE y cofres de Marea. Recogerlas las guarda sin tragar en **Perlas (P)**;
  puedes tragarlas, entregarlas a un pirata cercano, dejarlas en el suelo o venderlas junto a Tía Perla.
- Brasa da **Cometa (G)**: una embestida de fuego que despeja balas parreables y deja suelo ardiente. Tus golpes
  queman durante 3 s; el agua te quita ~4 % de vida máxima por segundo. El panel explica el poder y la maldición.
- Escarcha da **Ancla de hielo (G)**: un campo de 4 s que frena al 50 % a enemigos y balas hostiles; mantener
  apunta, soltar lanza y ESC cancela. Tus golpes ralentizan 3 s; tres congelan 0,6 s (jefes no). Fuego y lava ×1.5.
- Tormenta da **Rayo de mástil (G)**: mantener carga (1.2 s), soltar alcanza 2–5 enemigos en cadena; CD 15 s.
  Los golpes del kit saltan una vez a otro NPC cercano a mitad de daño bruto. Las balas hostiles se curvan
  suavemente hacia tu posición al emitirse el patrón, hasta 18 u; los disparos propios y reflejados conservan su trayectoria.
- Tinta da **Nube de tinta (G)**: apunta y suelta para ocultar a los piratas cubiertos durante 5 s, radio 3 u,
  alcance 10 u y CD 18 s. Los enemigos disparan hacia donde vieron por última vez a su objetivo; la nube no
  borra balas ni protege del daño. Tus golpes marcan NPC durante 4 s para que reciban +10 % en golpes posteriores.
  De día las pociones curan al 70 %; de noche haces +10 % de daño. El HUD muestra hora y efecto vigente.
- Al morir caen **todas** tus perlas, incluso fuera de la Cala, con un pilar del color de la perla. Cualquiera puede recogerlas;
  después de 90 s sin recoger vuelven a una playa. Cambiar la tragada requiere confirmación y calma.
- Para probar sin esperar botín: en solo, **F4 → + Perla → P → Tragar**; cierra el panel y espera 4 s antes de G.
  ANCLA y NUBE se apuntan manteniendo/arrastrando y se lanzan al soltar; RAYO se carga manteniendo.
  F4 permite cambiar la hora del mundo para probar Tinta. «Luz del escenario» solo cambia la presentación.
- P5 unifica paleta y sonido elemental de golpes, artes, tatuajes y proyectiles propios/remotos. Una bala conserva
  el elemento con el que salió, incluso tras escupir o cambiar la perla; sus rebotes e impactos también.
- Revisión de balance reproducible: `node tools/pearl-balance.mjs`. Conserva probabilidades y valor actuales;
  separa daño, control, marcas/ocultación y maldiciones. No acredita equilibrio competitivo por sí sola.
- **M4.8 sigue pendiente de aceptación física y publicación:** GPU, teléfono y mando reales, audición en juego.
  Regresión actual: **278/278**. Evidencia y alcance en [D03 / P5](docs/delivery/d03-pearlkit.md).
  El registro de propiedad evita duplicados de partidas viejas durante la sesión del servidor; la persistencia
  tras reinicios corresponde a M5. Protocolo **12**: cliente y servidor en línea deben actualizarse juntos.

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

### Qué incluye M4 — «El botín»

- **Objetos** (`src/data/items.js`, `src/sim/items.js`): 6 huecos (arma, cabeza, pecho, botas, dos abalorios), 20
  bases (3 sables, 3 pistolas, 3 sombreros, 3 pechos, 3 botas, 5 abalorios), 5 rarezas (Común 55 % · Poco común 28 %
  · Raro 12 % · Épico 4,2 % · Legendario 0,8 %; presupuesto × 1 a × 3 y 0–4 afijos), 15 afijos con nombre
  («Sable de cubierta del Tiburón»), nivel 1–15 y valor en oro.
- **Estadísticas:** nivel + equipo + maestría → las columnas del ECS, **predichas** por el cliente (velocidad,
  enfriamiento, carga de RIPOSTE, daño de reflejos, aguante, recarga de dash, ventanas de reflejo, cadencia,
  pociones, XP); crítico, oro y vida al matar solo en el servidor. Con equipo, 0 correcciones de predicción.
- **Maestría por arma** (como Albion): toda la XP alimenta también la del arma que llevas (1–10). LMB + Q desde M1,
  **E en M2, R en M3** (candado «M2 / M3» en la barra), +2 % de daño por nivel y pasivas en M5 y M10 (Filo templado /
  Ojo del huracán; Gatillo fácil / Diluvio). El kit se abre en el camino; M10 llega hacia la quinta Prueba.
- **Pociones de ron-coco** (`1`, cruceta ↑, botón táctil): 40 % de vida al momento, 2 s de espera, máximo 5;
  empiezas con 2 y caen de los enemigos.
- **Loot personal:** cada pirata con derecho a la XP tira el suyo y solo ve y recoge sus caídas. Saltan del cadáver
  en arco, con haz de luz y nombre del color de su rareza, y se recogen solas al pasar. **Cofre de HELLFIRE** por
  participante (Raro o mejor + 2 objetos + oro + poción), que se abre con F. 7–11 objetos por vuelta.
- **Misiones** que decide el servidor: la cadena de la playa a HELLFIRE (Tierra firme → La capitana del puerto →
  Limpia el camino → Los guardianes → Sobrevive a La Caldera), «Coral para la tía» de Tía Perla y la «Caza en La
  Caldera» repetible de Brea. **Diálogo** con los PNJ (aceptar, entregar, comerciar). **Tía Perla** vende pociones
  (25 oro) y cofres misteriosos (120) y compra todo por su valor; desguazar en el camino da el 25 %.
- **Mareas**, la dificultad de La Caldera: I · II (vida × 1,8, daño × 1,5, objetos +3 niveles y más rareza, XP × 1,6,
  oro × 1,5) · III (× 3,2, × 2,4, +6, XP × 2,4, oro × 2,2). Vencer una abre la siguiente; se elige con F en las
  runas; en cooperativo manda la más baja de la tripulación.
- **Partidas guardadas:** el servidor manda tu perfil (nivel, XP, oro, pociones, bolsa, equipo, maestrías, misiones,
  Mareas, tutorial, último punto de control) y el cliente lo guarda en `localStorage`, uno por servidor. En Node va
  firmado con HMAC-SHA256 (`SAVE_SECRET`): una copia tocada se rechaza, empiezas de cero y la vieja queda aparte. En
  solo, el Worker confía en la suya.
- **HUD y paneles:** oro, Marea en combate, poción, candados, barra de maestría, seguimiento de misiones. Panel de
  Personaje (I / C / L) con el muñeco y tu retrato, la bolsa, fichas con comparación (▲ / ▼), equipar, desguazar
  (lo raro pide confirmación) y vender; diálogo; **mapa** de la isla (M) con tu objetivo y la tripulación. No pausan
  el mundo. En el móvil: bolsa 6 × 4 y la ficha a la vista.
- **Balance** medido con `RUNS=8 node tools/progress.mjs`: el bot de la Prueba con perfil propio (Nv 5, habilidad
  0,8) abre su cofre, recoge, se pone lo que puntúa mejor, desguaza el resto y sube de Marea. «Vida» es el daño
  recibido tras la defensa (en modo dios) dividido por la vida máxima, sin contar regeneración ni pociones:

  | Vuelta | Marea | Sable: tiempo · vida | Nv · maestría | ATK / DEF / VIDA | Pistolas: tiempo · vida | Oro de la vuelta |
  |---|---|---|---|---|---|---|
  | 1 | I | 161 s · 98 % | 9 · M6 | 32 / 39 / 339 | 191 s · 91 % | ~300 |
  | 2 | II | 207 s · 131 % | 10 · M7 | 35 / 67 / 325 | 227 s · 76 % | ~700 |
  | 3 | III | 260 s · 155 % | 10 · M8 | 82 / 77 / 457 | 341 s · 148 % | ~900 |
  | 5 | III | 148 s · 52 % | 10 · M10 | 85 / 77 / 514 | 284 s · 78 % | ~1200 |
  | 8 | III | 151 s · 32 % | 10 · M10 | 85 / 47 / 673 | 203 s · 29 % | ~900 |

  La primera Marea III es un muro y con su equipo baja a un tercio de la vida. Pendiente: en Marea III el oro sobra
  (~1000 por vuelta, con poco en qué gastarlo hasta M5).
- Protocolo v4 (`hello.save`, `profile`, `save`, eventos privados con `to`). 129 tests en Node (objetos, maestría,
  loot, guardado, misiones y Mareas incluidos).

### Qué incluye M4.5 — «Sin ley»

- **Los detalles de M4:** el aviso `F` de un cofre va bajo el cofre y lo nombra en el color de su rareza (su
  etiqueta se oculta y las de debajo se atenúan); las palmeras se disuelven también entre la cámara y tu cofre; el
  oro tiene en qué gastarse: **Cofre de la Marea II** (450 oro, objeto + 3 niveles y más rareza) y **III** (1100 oro,
  + 6 niveles, al menos Poco común) en el puesto de Tía Perla, con candado hasta que vences esa Marea.
- **La Cala Calavera:** un fuerte en ruinas junto a la costa este, por un desvío de tierra desde el Sendero del Humo
  (cartel «CALA CALAVERA · SIN LEY →»). Tótems de calaveras, empalizadas rotas, cajas y barriles para cubrirse,
  braseros, una hoguera y la bandera negra; en el suelo, un anillo rojo que late cuando estás dentro. El resto de
  la isla no cambia ni un prop (la vegetación de la Cala se descarta tras sus tiradas).
- **Fuego amigo:** dentro, todo golpe de un pirata hiere a cualquier otro pirata que también esté dentro: el
  combo del sable entero, la estocada, la hoja de viento, la tormenta, balas, perdigones, reflejos, rebotes y la
  lluvia de plomo, × 0,6, con críticos, tras la DEF y con compensación de lag. El dash lo esquiva, la guardia lo
  bloquea (gasta aguante), la guardia perfecta lo para y aturde al atacante cercano, y los golpes pesados aturden
  0,3 s. Fuera de la Cala, nada cambia.
- **Botín completo:** si caes dentro, todo lo que llevas puesto (salvo el arma inicial), la bolsa entera y las
  pociones quedan en el suelo 3 minutos para el primero que las pise; tú también puedes volver a por ellas
  («¡Recuperado!»). El oro no se pierde y te levantas con un arma inicial de tu kit (tu maestría sigue valiendo).
  El botín de los mobs de la Cala también es público: se tira una vez y es de quien llegue primero.
- **Mobs del caos:** 13 en el fuerte a «Sin ley» (vida × 1,6, daño × 1,4, objetos + 3 niveles y más rareza, XP y oro
  × 1,5), que se levantan del suelo aunque haya piratas. Sus balas y círculos hieren a otros mobs, que se revuelven
  contra quien les dio (hasta que un pirata les pega: entonces, contra el pirata). Tres **Desalmados** con nombre
  («Cuervo Malasangre», «La Viuda Roja»…): renegados de sable (tajo en círculo y media luna) o de pistolas (ráfaga y
  descarga a quemarropa) que van a por el pirata que tengan a su alcance y, si no hay ninguno, a por los mobs (nunca
  entre ellos), y que sueltan su equipo (2 objetos, uno al menos Poco común). Si un mob remata a otro, la muerte es
  del último pirata que lo hirió (8 s); si nadie lo tocó, su botín cae igual pero nadie gana XP por mirar. Sin
  piratas cerca, la Cala duerme. Una pirata de nivel 1 que se queda quieta dentro cae a los ~8 s.
- **En pantalla:** cartel de zona en rojo, un aviso largo la primera vez y «A salvo» al salir; chip «☠ SIN LEY» y
  viñeta roja mientras estás dentro; placas en rojo con ☠ de los piratas que pueden herirte; números de daño PvP;
  avisos «☠ Te hundió X», «☠ Hundiste a Y» y «X hundió a Y»; lo derramado lleva «☠ Fulano» y vuela hacia quien lo
  recoge; 💀 en el mapa donde caíste. Tía Perla y Brea te avisan de la Cala.
- **Balance** medido con `tools/lawless.mjs`: dos bots de `tools/botbrain.mjs` (habilidad 0,8) con perfil y equipo
  de su nivel se pelean en el fuerte hasta que uno cae (`MOBS=1` añade los mobs de la Cala durante `SECS`):

  | Duelo | Nivel · equipo | Tiempo hasta caer (mediana) |
  |---|---|---|
  | Sable contra sable | 6 · Poco común | 4,7 s |
  | Sable contra pistolas | 3 · nada / 6 · Poco común / 10 · Raro | 8,4 s / 10,5 s / 14,5 s |
  | Pistolas contra pistolas | 6 · Poco común | 16,4 s |

  Los bots no esquivan las balas de otro pirata (solo ven los proyectiles de los mobs), así que las pistolas ganan
  más de lo que ganarían contra alguien que las esquiva. Con los mobs, en 4 minutos: unos 57 mobs caen a manos de
  los piratas y 1–2 entre ellos (5–10 balas de un mob en otro); a estos bots, que reflejan casi todo, los mobs les
  quitan ~30 de vida por minuto y el otro pirata 130–240 (a una pirata de nivel 1 quieta, los mobs la hunden en ~8 s).
  Quien gana se queda con todo: el pirata de pistolas acabó con 6 piezas puestas y la bolsa llena (24); el de sable,
  con su arma inicial.
- Protocolo v5 (botín público `loot` / `unloot` con `pub`, `spill`, `hurt` con `kind: 'pvp'` y `by`, `death` con `by`).
  143 tests en Node.

Medido en la vista de juego (sumando todas las pasadas, incluido el bloom): 80–130 draw calls y 180–315 k triángulos en
alta (el pico es la aldea al atardecer), 65–80 draw calls y 140–190 k triángulos en baja.

### Qué incluye M4.6 — «Tinta»

- **Siempre en horizontal:** en un teléfono de pie (o con el giro bloqueado) el juego entero se dibuja girado 90°
  para jugar con el teléfono de lado; al tocar «Jugar» se pide pantalla completa y bloqueo horizontal donde el
  navegador lo deja (Android), y entonces se des-gira solo. Todo mide el «escenario» (`src/ui/stage.js`), no la
  ventana: lienzo, cámara, interfaz, ratón, joystick y apuntado de Q / E / R. «Forzar horizontal (móvil)» en Ajustes.
- **Botones nuevos:** cristal translúcido con un color por función (ataque rojo-naranja, guardia azul, dash
  turquesa, habilidades violeta, R dorado, poción rosa, acción ámbar), iconos de línea con contorno de tinta y
  tamaños por importancia en un arco alrededor de ATK: DASH a la izquierda, GUARDIA encima, Q / E / R en arco, la
  poción aparte y el botón de acción, que solo sale cuando hay algo que hacer. Pulsado, destello al acabar un
  enfriamiento, R que late cuando está listo, candado en lo bloqueado, aro de reposo del joystick. «Tamaño de los
  botones» (pequeño / mediano / grande) y «Vibración (móvil)» en Ajustes. En horizontal bajo, el seguidor de
  misiones se pliega a una línea y los avisos no tapan el arco.
- **Contornos de tinta con peso:** siluetas del mundo más gruesas, pliegues finos y los personajes, enemigos y PNJ
  con una línea gruesa por fuera de la figura (se leen de un vistazo y conservan sus colores). Tinta más oscura.
- **Sombras de cómic:** tres tonos duros y la sombra teñida con el color de cada hora (violeta de día, azul de
  noche); **trama de tinta** a mano en lo que no toca el sol (más ancha cuanto más oscuro, cruzada en lo más
  oscuro, más suave sobre la hierba, nunca en lo que brilla, la lava o el agua) y una línea de tinta donde empieza
  una sombra proyectada. Las nubes solo oscurecen.
- **Superficies pintadas:** ondas y punteado en la arena, pinceladas en la hierba con borde, losas entintadas,
  grietas en la roca y en las rocas, estratos del volcán, baldosas de la Caldera con junta de tinta, grietas de
  lava perfiladas y una **greca** alrededor del suelo de la arena; vetas en la madera y sillares en la piedra de
  los props, anillos en las palmeras, arbustos a dos tonos.
- **Etalonaje** más contrastado y saturado en las cuatro horas. Todo es procedural con la textura de ruido que ya
  había: ni texturas nuevas ni pasadas nuevas. Rendimiento: ver `PLAN-M4.6.md` §4.

### Qué incluye M4.7 — «Tatuajes»

- **Huecos libres:** Q y E llevan las artes de tu arma (las de siempre) o un **tatuaje** aprendido, que sirve con
  cualquier arma. Cada arma recuerda su carga. Se cambia fuera de combate (3 s sin recibir daño), nunca en la Cala, y
  el hueco cambiado se enfría unos segundos. Pestaña **Tatuajes** (`T`) en el panel del personaje.
- **Tres tatuajes**, con rango (I–V, sube con la *tinta*: la experiencia que ganas llevándolos puestos; el que va
  rezagado aprende el doble) y dos formas que abren los rangos II y IV:
  - **Tromba** (área): una columna de agua cae en el punto apuntado; aturde y borra las balas. *Ojo de tormenta* deja
    un remolino que atrae y golpea; *Gemelas* tira una segunda columna donde apuntas cuando cae la primera.
  - **Abordaje** (área): salto invulnerable hasta el último punto donde se puede pisar; al caer golpea, empuja y borra
    balas. *Parpadeo* es un teletransporte y tu siguiente golpe es crítico; *Ancla de abordaje* salta más y aturde.
  - **Timón** (carga): mantén para cargar y suelta: un timón que sale rápido y corto o lento, lejos y fuerte, golpea a
    la ida y a la vuelta, borra balas y, si lo atrapas, devuelve parte del enfriamiento. *Remolino* gira en el ápice;
    *Timón de guerra* es más grande, empuja y no devuelve nada.
- **Apuntar tipo MOBA:** mantener Q / E muestra el aro de alcance y la marca del área (el salto, con su arco y su
  aterrizaje real); soltar lanza; RMB, ESC o B del mando cancelan. «Lanzamiento de áreas: Rápido» en Ajustes lo lanza al
  pulsar. La Tromba de cualquier pirata se ve llegar (morada la tuya, ámbar la de otros). En táctil: arrastrar el botón
  lleva la marca, mantener carga el Timón.
- **Doña Sepia**, la tatuadora de la aldea, con su puesto de pieles y tinteros: el primer tatuaje es gratis, los
  demás cuestan 150 de oro.
- **Cómic Ultra** (GPU potentes): tramas Ben-Day, contornos más gruesos, viñetas de impacto, líneas de velocidad y
  onomatopeyas (¡CHOF!, ¡PATAPÚM!, ¡ZUUUM!…). «Efectos de cómic» en Ajustes.

## Arquitectura

```
src/sim/      simulación pura y determinista (sin THREE ni DOM): worldgen, ECS sobre typed arrays, movimiento, bots
src/net/      protocolo, LocalServer (servidor autoritativo), worker, transportes (Worker / en proceso / WebSocket), LagLink
server/       servidor Node: estáticos + WebSocket + límites (GameHost envuelve el mismo LocalServer)
src/client/   predicción del jugador local + reconciliación, interpolación del resto (buffer de 100 ms)
src/render/   escena, pipeline de contornos, toon, terreno, agua, cielo, vegetación, props, personajes, VFX
src/ui/       título, HUD, prompts/nameplates, pausa, táctil, botín, panel de personaje, diálogo, mapa
src/audio/    motor Web Audio, SFX, ambiente, música
src/data/     meta (nombre del juego), tuning (todos los números), ship_modules (gancho naval)
```

- **Un solo servidor de juego:** `LocalServer` (60 Hz, snapshots a 20 Hz) corre en un Web Worker en solo y dentro
  del proceso Node en línea (`server/host.mjs`: un id por socket, JSON comprimido con permessage-deflate, cubetas
  de tokens, latidos). El cliente solo envía inputs y predice su propio movimiento con el mismo código; los tests
  `client prediction matches the authoritative server exactly` (en proceso) y `two players at 100 ms RTT` (por
  WebSocket) comprueban error de predicción 0. Los bots son entidades `player` del servidor que generan los mismos
  comandos que un humano.
- **Partidas (M4):** el servidor es el dueño del perfil (`world.profiles`) y lo manda firmado; el cliente solo lo
  guarda y lo devuelve en `hello`. Equipo y maestría viven en columnas del ECS para que la predicción coincida.
- **Pendiente para un MMO de verdad:** cuentas y autenticación en `hello`, perfiles en una base de datos del
  servidor (hoy viajan firmados en el navegador), varias instancias (una por arena / grupo) y el protocolo binario
  (formato en `DESIGN.md` §10).
- **Ganchos navales:** muelle con barco anclado e interacción «ZARPAR · próximamente», `src/data/ship_modules.js`,
  componente `VEHICLE` reservado en el ECS, `camera.setMode('naval')` y mensajes `ship_*`, `board`, `dock`,
  `trade_*` reservados en `protocol.js`.
