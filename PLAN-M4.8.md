# PLAN M4.8 — «Perlas negras» (en curso: Brasa y circulación)

> Acordado con el autor durante M4.7 (2026-10-04). Primera entrega jugable: `0.4.8-alpha.1`, Brasa completa
> en mecánica y la base compartida. **M4.8 no está terminado**: faltan Escarcha, Tormenta y Tinta, pulido y balance.
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
  `BTN.G`, `KeyG`, botón táctil COMETA y cruceta abajo en mando. Panel Perlas en P.
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

### P2 — Escarcha ⏳ (siguiente)
- Añadir contenido y columnas predichas necesarias; ralentización/acumulaciones y congelación sin bloquear jefes.
- Ancla de hielo con campo apuntado y balas frenadas determinísticamente al `pt`; maldición fuego/lava ×1.5.
- Pruebas de expiración, enemigos/jefes, balas y reconciliación; capturas desktop/móvil.

### P3 — Tormenta ⏳
- Cadena de golpes con selección determinista y sin ciclos; Rayo de mástil cargable, saltos por carga.
- Curvatura de balas para la maldición compartida por cliente/servidor; pruebas de predicción y VFX.

### P4 — Tinta ⏳
- Marca de daño, Nube de tinta con comportamiento de enemigos y disparos a ciegas.
- Maldición de poción de día y daño nocturno; fuente autoritativa de hora, tests y VFX.

### P5 — Cierre ⏳
- Pulido de elementos en todos los ataques, sonido y balance de daño/probabilidad/valor.
- Aceptación con GPU real, mando real, teléfono real y dos navegadores en línea; las capturas SwiftShader no
  certifican 60 fps ni sustituyen esos dispositivos.
- Suite completa, documentación, versión final M4.8 y artefacto construido desde el commit. La URL pública de
  claude.ai sigue siendo M4.7 hasta republicarlo; esta entrega no despliega el servidor.

## 4. Probar esta entrega

En solo: F4 → «+ Perla de Brasa» → P → Tragar → cerrar el panel → esperar 4 s → G. En móvil, Bolsa → Perlas y
botón COMETA; en mando, cruceta abajo. El botín normal no requiere F4. Prueba también escupir, reemplazar y cancelar,
vadear sin modo dios y morir fuera de la Cala. En línea, otro pirata debe poder recoger la perla caída.

Implementación: `src/data/pearls.js`, `src/sim/systems/pearls.js`, `pearlcombat.js`, hueco G en `skills.js`,
`src/ui/pearlpanel.js`. Pruebas nuevas: `tests/pearls.test.mjs` (17); escenario visual `SCEN=pearl` en `tools/look.mjs`.
Los assets FAB elegidos por el autor se integrarán mediante `docs/ASSETS.md`; esta entrega conserva el arte procedural.
