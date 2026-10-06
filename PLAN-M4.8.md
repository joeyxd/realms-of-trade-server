# PLAN M4.8 — «Perlas negras» (candidato integrado; aceptación física pendiente)

> Acordado con el autor durante M4.7 (2026-10-04). Entrega actual: `0.4.8-rc.1`, las cuatro perlas,
> circulación y pulido integrado. **M4.8 no está terminado**: aceptación física y publicación pendientes.
> Las perlas legendarias únicas dependen de M5 (mundo persistente en el servidor): aquí solo las raras.

## 0. La idea

Inspirado en las frutas del diablo, pero nuestro: te tragas una **perla negra** de la Marea y el mar te maldice.
Los tatuajes (M4.7) son lo que entrenas: cualquiera los aprende y se cambian fácil (el «Haki»). La perla es tu
destino: rara, poderosa, con un precio, y **fluye**: se te cae al morir.

## 1. Decisiones del autor

- **Una perla tragada por pirata.** Da cuatro cosas: una **habilidad propia en la tecla G**, un **elemento que
  tiñe todo tu kit** (arma, artes y tatuajes), una **pasiva** y una **maldición**.
- **Raras pero disponibles** (con copias): botín de élites, jefes y cofres de Marea (más con la Marea alta).
- **Se cae al morir**, para que circulen y sean algo importante.
- **Niveles**: las raras primero; las **legendarias** después (M5): **únicas por servidor**, todo el mundo sabe
  quién la trae y, si su portador no entra en unos días, vuelve al mar.
- Las zonas tipo MOBA quedan aparcadas: primero la base divertida, luego la estructura (economía, construcción,
  barcos, comercio entre pueblos; ver `DESIGN.md`).
- **Afinidad por uso** (dirección del autor, 2026-10-04): guardar aprendizaje del poder y desarrollar sus niveles.
  Extensión posterior al kit actual; propuesta de personaje + tipo de poder, independiente del UID circulante,
  en `docs/NAVAL-ROADMAP.md` §6. Curvas, mejoras y límites todavía abiertos; no está implementada.

## 2. Propuesta (por afinar al empezar)

### 2.1 Elementos: muchas perlas sin hacer un kit entero cada vez
Cada golpe del pirata lleva su elemento (`elem`; M4.7 deja la columna y el paso por `strike`). Un elemento es un
estado al golpear + una paleta de VFX + una capa de sonido, y vale para **todo** el kit: con Brasa, la Tromba es un
tornado de fuego que deja el suelo ardiendo, el Timón deja estela de lumbre y el Abordaje cae con explosión.

| Elemento | Al golpear | Tinte |
|---|---|---|
| Brasa | quema (daño en el tiempo) | naranja / rojo |
| Escarcha | ralentiza; 3 acumulaciones congelan 0.6 s (jefes no) | azul hielo |
| Tormenta | salta a un enemigo cercano (× 0.5) | amarillo eléctrico |
| Tinta | marca: el enemigo recibe +10 % de daño | negro / morado |

### 2.2 Las cuatro primeras perlas (raras)
Las G reutilizan los tipos de lanzamiento de M4.7 (`ground`, `dir`, `charge`) con su marca y su carga.

| Perla | G | Pasiva | Maldición |
|---|---|---|---|
| Brasa | «Cometa» (`dir`): sales disparado como bola de fuego, estela que quema | quemar | «El agua te apaga»: en el agua pierdes vida poco a poco |
| Escarcha | «Ancla de hielo» (`ground`): campo helado que frena a los enemigos **y a sus balas** | ralentizar | el fuego y la lava te hacen × 1.5 |
| Tormenta | «Rayo de mástil» (`charge`): cuanto más cargas, más saltos | encadenar | «Imán de tormenta»: las balas enemigas se curvan un poco hacia ti |
| Tinta | «Nube de tinta» (`ground`): dentro no te ven y disparan a ciegas | marcar | «La luz te quema»: de día las pociones curan × 0.7; de noche +10 % de daño |

Legendarias (M5): versiones únicas con nombre propio («Corazón del Kraken», «Ojo del Huracán»…): la misma base,
una G más fuerte, aspecto propio y cartel de **SE BUSCA**.

### 2.3 Al morir
- La perla (y las que lleves sin tragar) sale de tu cuerpo y queda en el suelo con un pilar de luz visible desde
  lejos. Cualquiera puede tomarla; tú también, si vuelves corriendo.
- Si nadie la toma en 90 s (afinable), **vuelve a la marea**: reaparece en una playa al azar con aviso («Una
  perla negra volvió al mar cerca de…»). Siempre sigue en circulación.
- Tomarla la guarda **sin tragar** en la bolsa: un objeto que se vende y se cambia (la mercancía más valiosa del
  juego). Tragarla con otra ya dentro: la vieja sale (con confirmación). Escupirla: fuera de combate.

### 2.4 Lo técnico
- Hueco G: `SLOTS` gana `g`; `LOADOUT_SLOTS` conserva Q/E para que las perlas no se puedan equipar como tatuajes.
  `BTN.G`, `KeyG`, botón táctil del poder (COMETA / ANCLA / RAYO / NUBE) y cruceta abajo en mando. Panel Perlas en P.
- La perla es un objeto con `uid` único.
- **Duplicados**: hoy la partida vive firmada en el navegador del jugador, así que alguien puede guardar una copia
  de antes de morir y recuperar la perla. En M4.8, mitigación en memoria (el servidor recuerda qué `uid` salió de
  qué partida y quita la perla de una partida vieja, hasta que se reinicie). M5 lo cierra con base de datos.
  En solo no importa: es tu partida.

## 3. Pasos

### P0 — Circulación y propiedad ✅
- Perfil migrable: `pirateId`, `pearls: {swallowed, bag}` (hasta 8 sin tragar); `uid` propio, separado del equipo.
- Botín público de élites (2.5 %), HELLFIRE (12 %) y cofres (8 %). La probabilidad sube ×1.5 en Marea II y ×2 en III,
  usando la Marea del encuentro/cofre, no el selector del jugador. Una tirada de enemigo por muerte.
- Recoger, tragar, reemplazar nombrando el UID anterior, escupir, dejar, entregar a otro humano cercano y vender
  a Tía Perla por 600 oro. Cambios fuera de combate; G queda al menos 4 s en enfriamiento al cambiar.
- Al morir en cualquier zona caen todas las perlas. Las caídas son públicas, con pilar de luz; tras 90 s reaparece
  el mismo UID en una playa transitable. Las ventas también lo devuelven al mar.
- Ledger de UID en memoria: rechaza partidas viejas que intentan recuperar una perla caída/entregada/vendida o
  entrar con una copia que ya está activa. Reconectar al propietario legítimo sí funciona. **No es durable tras
  reiniciar**: lo cierra M5; no introducir legendarias únicas antes de eso.

### P1 — Brasa y G ✅ (mecánica; VFX iniciales)
- Cometa: 8 u, ATK ×2.8, 14 s de enfriamiento; respeta paredes/agua profunda, despeja balas parreables y deja suelo
  ardiente durante 2 s. Predicción y eco del servidor sin duplicar efectos.
- Todo golpe del kit con Brasa aplica quemadura: 3 s, pulsos cada 0.5 s de ATK ×0.12, sin críticos ni reaplicación
  recursiva; otro golpe renueva la duración. Maldición del agua: ~4 % de HP máximo/s, ignorando armadura; muelles secos.
- Pestaña Perlas, icono G y enfriamiento, mando y móvil; confirmación de reemplazo visible y cancelable. El panel
  conserva el desplazamiento al refrescar, también en pantallas bajas.
- Tinte naranja en golpes, afterimages y Tromba; estela de fuego y perla procedural. Queda pulir la paleta/sonido
  de todo el kit (gotas, Timón, proyectiles) en P5.
- Protocolo 8: estado G predicho y elemento remoto. El servidor en línea debe usar esta misma revisión.

### P2 — Escarcha ✅ (mecánica; VFX iniciales)
- Ancla de hielo: mantener G apunta y soltar lanza; ESC / RMB / B cancelan sin gastar. Alcance 10 u, radio 3 u,
  duración 4 s, enfriamiento 16 s. En el campo, enemigos y balas hostiles van al 50 %; los campos superpuestos
  aplican la ralentización más fuerte. Tus disparos y reflejos conservan su velocidad.
- Golpes del kit: ralentización del 30 % durante 3 s; tres golpes consumen acumulaciones y congelan 0,6 s.
  Los jefes se ralentizan pero nunca se congelan. Este estado afecta a NPC enemigos; congelar jugadores en PvP
  no forma parte de esta entrega. La congelación detiene movimiento y relojes de acción del enemigo.
- Maldición: daño recibido de fuego/lava ×1.5, con marcas explícitas de fuente; flechas y golpes físicos no
  cambian. Conserva la marca al bloquear y en daño pendiente, áreas, láseres, Cometa y quemaduras de Brasa.
- Trayectoria analítica de balas al `pt`: entrada/salida del campo, expiración, solapamiento y obstáculos;
  se conserva historia durante la vida de las balas más el rewind para evitar saltos al expirar o reconectar.
- Protocolo 9: columnas predichas `icX/icZ/icT0/icEnd/icSeq` y lista autoritativa `frost` en snapshots. El eco
  adopta el campo predicho por pirata/secuencia; la reconciliación retira casts rechazados y repara eventos perdidos.
- Panel, HUD, botón ANCLA, área azul, campo con cristales y sonidos de hielo. 14 pruebas nuevas en
  `tests/escarcha.test.mjs`; regresión completa: 247/247. La revisión visual se registra en `docs/HANDOFF.md`.

### P3 — Tormenta ✅ (mecánica; VFX iniciales)
- Golpes del kit contra NPC: un salto al vecino vivo más cercano a ≤5 u, daño bruto ×0.5; sin crítico nuevo,
  reaplicación elemental ni salto hacia jugadores. Distancia y luego ID resuelven empates. Un golpe mortal también salta.
- Rayo de mástil: mantener G carga (lleno a 1.2 s), soltar dispara; a los 3 s se libera automáticamente.
  CD 15 s al soltar; dash, stagger o muerte cancelan sin gasto. Puedes moverte al 55 % durante la carga.
  Primer objetivo en cono de 40°, alcance 10 u; luego 1–4 saltos a ≤5 u (2–5 enemigos distintos), ATK ×1.8
  y ×0.75 por salto. Selección autoritativa con posiciones históricas de NPC, sin ciclos ni PvP.
- Imán de tormenta: patrones hostiles cerca de un portador (18 u desde la salida de cada bala) se curvan
  hacia su posición **al emitir el patrón**; el portador más cercano gana, con empate por ID. Giro máximo
  0.22 rad/s y desvío total 0.45 rad, luego tangente recta. No persigue cambios posteriores de posición.
  Balas propias/reflejadas conservan su trayectoria. Obstáculos se calculan sobre la curva real, con vida fija.
- Curva geométrica por distancia; Escarcha se compone con pasos fijos de ¼ tick y caché independiente del
  orden de consulta. La integración de ralentización en curvas es una aproximación determinista a 240 Hz.
- Protocolo 10: anclas `magnets` viajan con el patrón y snapshots `storm` conservan patrones afectados y
  sus retiradas/omisiones por capacidad para reparar eventos perdidos y entrada tardía, sin revivir balas destruidas. G usa las columnas
  de carga/CD existentes; su eco no repite sonido ni pulso. HUD, botón RAYO, cono amarillo y arcos del servidor.
- 12 pruebas en `tests/tormenta.test.mjs`; regresión vigente: 259/259. Capturas y límites de aceptación en `docs/HANDOFF.md`.

### P4 — Tinta ✅ (mecánica; VFX iniciales)
- Golpes válidos del kit marcan NPC vivos durante 4 s. El primer golpe no recibe la bonificación; los siguientes,
  de cualquier atacante, hacen daño bruto ×1.1. No se acumula; un golpe de Tinta renueva. Sin marcas PvP,
  sobre daño rechazado o después de muerte/reutilización del slot.
- Nube de tinta: mantener/arrastrar G apunta, soltar coloca; alcance 10 u, radio 3 u, duración 5 s, CD 18 s.
  Preparación 0.22 s y recuperación 0.18 s, movimiento al 45 % durante la preparación. Cancelar el apuntado no gasta CD.
  Oculta a todos los piratas vivos cubiertos. Un NPC no adquiere un pirata oculto nunca visto; conserva su última
  posición visible para moverse/disparar a ciegas, o cambia a otro visible. Cañones, morteros y jefe comparten esa regla.
  Balas y ataques de área ya comprometidos continúan; la nube no da invulnerabilidad ni borra proyectiles.
- Hora autoritativa compartida con la economía: día de 16 min, inicio 08:00, noche 20:00–06:00. Pociones ×0.7
  de día, daño saliente ×1.1 de noche, compuesto una vez con marcas. El ciclo visual sigue al servidor;
  los presets de «Luz del escenario» son cosméticos. HUD muestra hora, período y maldición vigente.
- Protocolo 11: snapshot `ink` con nubes y marcas, ancla `clock` y columnas predichas
  `inkX/inkZ/inkT0/inkEnd/inkSeq`. Eco por pirata/secuencia sin doble feedback, rollback del rechazo,
  recuperación de eventos perdidos y entrada tardía. Un cast aceptado sigue hasta su vencimiento aunque cambie la perla.
- Panel, icono G, botón NUBE, área morada, humo procedural de suelo y anillo de marca. Se corrigió el solapamiento
  del tutorial con la hora en móvil. 12 pruebas en `tests/tinta.test.mjs`; evidencia y límites en
  [informe D02](docs/delivery/d02-tinta.md). P5 conserva aceptación con GPU y dispositivos reales.

### P5 — Candidato integrado; aceptación física pendiente ⏳
- Paleta compartida en todo el kit: Tromba/vórtice/gotas, carga/estela/captura del Timón, Abordaje, Hoja,
  Lluvia, boca de pistola y proyectiles/impactos propios y remotos. Geometría/señales hostiles y pools conservados.
  El Timón usa seis materiales independientes con el shader toon original; no cambia otro pirata al tintarse.
- Capa de sonido breve por elemento al iniciar un ataque/habilidad; máximo dos voces añadidas por inicio,
  sin emitir por partícula. Audición del conjunto en dispositivo real aún pendiente.
- Protocolo 12: `shot` / `shotEnd` incluyen `elem` de salida y propietario. Predicción adopta el valor del servidor;
  impacto diferido y rebotes lo conservan tras cambiar/escupir. Eventos neutrales declaran `elem: 0`.
- Balance auditado mediante `tools/pearl-balance.mjs`: una muestra de ATK 13 sin crítico produce 13 base,
  23 con Brasa tras 3 s y 20 con Tormenta frente a dos objetivos. Control/marcas/maldiciones se evalúan aparte.
  Se conservan probabilidades y 600 oro; hace falta juego real para afirmar equilibrio competitivo.
- Suite completa **278/278**, versión `0.4.8-rc.1` y documentación: [informe D03](docs/delivery/d03-pearlkit.md).
- Aceptación con GPU real, mando real, teléfono real y dos navegadores en línea; las capturas SwiftShader no
  certifican 60 fps ni sustituyen esos dispositivos.
- La versión final M4.8 requiere esa aceptación. Construir el artefacto desde el commit con
  `node tools/build-release.mjs HEAD`; republicación pública y servidor compatible se verifican por separado.

## 4. Probar esta entrega

En solo: F4 → «+ Perla de Brasa / Escarcha / Tormenta / Tinta» → P → Tragar → cerrar el panel → esperar 4 s → G.
Con Escarcha/Tinta, mantener apunta y soltar coloca el campo. Con Tormenta, mantener carga y soltar encadena.
F4 → «Hora del mundo: día/noche» permite comprobar Tinta; cambiar el preset de luz no cambia su maldición.
En móvil, Bolsa → Perlas y botón COMETA / ANCLA / RAYO / NUBE; arrastrar ANCLA/NUBE apunta, mantener RAYO carga
y soltar lanza. En mando, cruceta abajo. El botín normal no requiere F4. Prueba escupir, reemplazar y cancelar,
vadear sin modo dios y morir fuera de la Cala. En línea, otro pirata debe poder recoger la perla caída.

Implementación: `src/data/pearls.js`, `src/sim/systems/pearls.js`, `pearlcombat.js`, hueco G en `skills.js`,
`src/ui/pearlpanel.js`. Pruebas: `tests/pearls.test.mjs` (17), `tests/escarcha.test.mjs` (14); escenarios visuales
`SCEN=pearl`, `SCEN=escarcha`, `SCEN=tormenta` y `SCEN=tinta` en `tools/look.mjs`; Tinta tiene 12 pruebas nuevas.
Los assets FAB elegidos por el autor se integrarán mediante `docs/ASSETS.md`; esta entrega conserva el arte procedural.

## 5. Extensión posterior: afinidad (plan; fuera del cierre P5 actual)

- [x] **Regla confirmada por el autor, 2026-10-06:** afinidad/nivel del personaje por tipo de poder,
  independiente del UID físico. El uso válido mejora el dominio y la eficacia del poder. Perder, soltar,
  vender, prestar o morir con la perla no borra ese aprendizaje. Recuperar una perla del mismo tipo
  vuelve a aprovechar la afinidad alcanzada; otro jugador usa su propio aprendizaje, no el del objeto.
- [ ] Definir curva/techo de XP, acciones acreditables y mejoras concretas. La identidad/conservación
  anterior ya es requisito; cifras, ritmo y balance siguen abiertos. [Contrato](docs/briefs/m48-pearl-affinity.md).
- [ ] Acreditar uso válido en servidor; defaults/migración/saneado y persistencia M5. Bloquear progresión por
  pulsar en puerto o repetir acciones sin desafío. Revisar protocolo/UI al exponer el aprendizaje.
- [ ] Mostrar nivel y siguiente mejora, conservar maldición/circulación y comparar novato/experto sin una brecha
  enorme de daño. No elegir cifras ni implementar antes de cerrar esta definición.
