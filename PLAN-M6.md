# PLAN M6 — «La Balsa»: tu barco es tu casa

Entregas jugables y pruebas de arte: [PLAN-DELIVERY.md](PLAN-DELIVERY.md), D04–D06/D08 y mar D10–D12.

Checkpoint 2026-10-05: **P1–P2 implementados y aceptados localmente en software**, versión `0.6.0-alpha.1`, protocolo 13.
Identidad/migración, amarre, snapshot y renderer; [P1](docs/delivery/d04p1-raft.md).
Pasarela/cubierta, bloqueos y escaleras compartidos; [P2](docs/delivery/d04p2-raft-walk.md), 383/383 y PC/móvil emulado.
Editor y bodega siguen pendientes. No es aceptación de mar/pérdidas, rendimiento físico ni publicación.

Prueba de arte solicitada por el autor (2026-10-05): [material cómic de la balsa](docs/delivery/raft-comic-material.md),
atlas original de cuatro superficies y derivados WebP para escritorio/móvil. Se integra sobre P1;
P2 se acepta por separado mediante recorrido/pruebas. El atlas no equivale a importar un kit FAB modular.

> Idea del autor (referencia: *Raft*): **empiezas con cuatro tablones y una vela** y la vas haciendo crecer, pieza a
> pieza en una cuadrícula, hasta una fortaleza flotante. La balsa es tu casa, tu taller, tu bodega y lo que te lleva
> de pueblo en pueblo a comerciar (M7). Une las dos patas de la estructura: **construcción y barcos**. Los solares en
> los pueblos (M8) quedan para más adelante y para los edificios grandes.
>
> «De una balsa a cualquier parte.»

## 0. Qué hay ya en el código

| Pieza | Dónde | Estado |
|---|---|---|
| 29 piezas: cimiento, piso, pilar, pared, puerta, ventana, barandilla, techo, escalera, escala, vela, vela mayor, motor, ancla, bodega, cofre, caja, huerto, cañaveral, purificador, red, parrilla, alambique, mesa de cartas, hamaca, litera, farol, cañón giratorio, adorno | `src/data/raftparts.js` | ✅ |
| Reglas de construcción: cimientos conectados (12 × 12 máx.), pisos con soporte (pilar o pared debajo, o un voladizo de una casilla), piezas sobre cubierta libre, bordes junto a una cubierta, la red al borde, 3 niveles | `src/sim/economy/raft.js` (`canPlace`) | ✅ |
| Colocar pagando con una bodega, quitar devolviendo la mitad (sin tirar lo que sostiene algo ni partir la balsa) | `place` / `remove` | ✅ |
| Lo que hace la balsa: flotación contra peso (sobrecarga = se arrastra), velocidad por velas y motores, bodega, tripulación, cañones, reaparición | `raftStats` | ✅ |
| Producción en el reloj del juego: el purificador riega los huertos (más con techo), las redes pescan, la parrilla y el alambique cocinan, el motor quema madera | `stepRaft` | ✅ |
| Guardado en el perfil (`p.eco.ships`: `{kind: 'raft', id, rev, berth, grid, hold, at, hp, look}`) | `trade.js` (`sanitizeEco`) | ✅ |
| Viajes entre pueblos (ruta, horas por velocidad, eventos con semilla), bodegas | `voyage.js`, `cargo.js` | ✅ |
| Barcos clásicos (balandra… galeón) para más adelante | `src/data/ships.js` | ✅ datos |
| Modelos externos por pieza (`part:<id>` en el manifiesto) | `docs/ASSETS.md` | gancho por añadir (P2) |

## 1. Base de la primera entrega (detalles a confirmar con el autor)

- Todo pirata empieza con la **balsa inicial** (`STARTER_RAFT`: 2 × 2, una vela, una caja) amarrada al muelle de la
  Aldea.
- Se construye **con lo que llevas a bordo**: la madera, la lona y el hierro salen de la bodega de la balsa (o de tu
  mochila al estar en ella). Se consiguen comerciando (M7), pescando con la red, recogiendo restos flotantes
  (P5) y saqueando.
- **Se camina por la balsa**: la cubierta es suelo (y los pisos superiores, con escaleras); las paredes chocan. En el
  muelle es una zona más de la isla. El formato del mar/abordaje sigue abierto; ver la recomendación regional abajo.
- **Viajar** (fase A): desde el timón, elegir destino en la carta (mesa de cartas) → travesía con el tiempo de
  `voyageHours(leguas, raftStats.speed)` y los eventos de la ruta; la balsa produce mientras viaja.
- **Resolver encuentros** (fase B, formato pendiente): amenazas NPC y navales se prototipan por rebanadas.
  Topología, combate de cubierta y controles de cañones siguen abiertos. Reutilizar el kit del personaje donde
  encaje, con balance naval específico; alternativas en `docs/NAVAL-ROADMAP.md` §§3–4.
- **Personalizar**: bandera y pintura (`RAFT_LOOKS`), adornos.

### 1.1 Dirección acordada con el autor, 2026-10-04

- Materiales de calidad y navegación condicionan tamaño/capacidad útil. Carga/peso penalizan claramente giro
  y velocidad; skill mejora manejo sin eliminar las desventajas del grande. Posible nivel de barco pendiente.
- Distribución de módulos importa: equilibrio, resistencia al giro y arcos, con estadísticas explicables en el editor.
- Soltar carga para acelerar/maniobrar; bienes retirados realmente, disputables/perdidos y sin recuperación automática.
- Reservas locales de puerto seguras; mercancías/recursos a bordo de la casa-nave expuestos en rutas de combate.
- Rendición por carga, patrullas/notoriedad y recuperación con costes sin duplicación; políticas en M5/M7.
- Balsa/vela/motor/buque y regiones con tecnologías distintas comparten construcción/logística; aire después.

Fórmulas, límites por tier, patrimonio vinculado, pérdida de carga y controles no están cerrados. Recomendación:
mar compartido en regiones acotadas, zoom de navegación/combate sobre el mismo estado, acción naval con inercia
y proyectiles esquivables; abordaje sobre dos cubiertas reales enganchadas a baja velocidad primero.
Alternativas y criterios de aceptación: `docs/NAVAL-ROADMAP.md` §§2–5 y 8.

## 2. Pasos

- [x] **P1 La balsa en el muelle.** Al crear perfil, `p.eco.ships = [{ kind: 'raft', grid: newRaft(), … }]`.
  Entidad `vehicle` en el ECS enlazada a su cuadrícula; el servidor la manda en el snapshot (piezas al
  entrar; en P1 lista completa para reparar entrada tardía/bajas, eventos `raftPart` al implementar el editor).
  Render: piezas en su casilla, geometría procedural agrupada por color y caja FAB con fallback, balanceo visual
  leve. Los perfiles marcados vacíos no reciben otra starter; solo la balsa primaria amarrada en Aldea es visible.
- [x] **P2 Caminar por ella.** `RaftDeck` aporta suelo/bloqueos a movimiento y aterrizajes compartidos.
  Pasarela de amarres adyacentes, cubierta/pisos, puertas cerradas, paredes/barandillas y escaleras en cuatro
  direcciones; predicción instala geometría antes del replay. PC/móvil emulado muelle→cubierta→piso→muelle,
  14 pruebas nuevas y regresión 383/383. Amarres remotos, puertas interactuables y escalas quedan abiertos;
  [informe y límites](docs/delivery/d04p2-raft-walk.md).
- [ ] **P3 Modo construcción** ([brief D05](docs/briefs/d05-raft-editor.md), tecla B / botón táctil). Menú de piezas (rejilla de iconos como la referencia:
  nombre, coste, lo que hace), fantasma verde / rojo en la casilla apuntada con el motivo de `canPlace` en español,
  rotar con R solo dentro del editor y retirada en modo explícito; fuera R sigue habilidad/clic derecho guardia.
  Comandos `raft` `{op: 'place', piece}` / `{op: 'remove', i}` con identidad/revisión/operación del brief →
  eventos `raftPart` / `raftDenied`. Gancho de assets `part:<id>`: geometría procedural o piezas exportadas de
  un kit compatible, misma medida de casilla (`RAFT.cell` = 2 u). Selección FAB según el inventario Unreal.
- [ ] **P4 Vivir en ella.** La producción en el reloj (`stepRaft` en `economy.step` para las balsas de los
  jugadores conectados), panel de la balsa (bodega, agua, lo que produce, peso / flotación, velocidad), cofres,
  hamaca como punto de reaparición, faroles de noche (luces locales).
- [ ] **P5 Zarpar.** El timón abre la carta; travesía (`planVoyage` + `stepRaft` acelerado); restos flotantes que
  recoger con un gancho por el camino (madera, lona, barriles); llegar a puerto abre su mercado (M7).
  Este viaje abstracto es fase A; sus pérdidas aleatorias no sustituyen el combate naval interactivo de fase B.
- [ ] **P6 (fase B) El mar.** Movimiento por timón/propulsión, proyectiles, daño por pieza y reparación.
  Dividir en rebanadas: estadísticas de carga/giro y jettison → encuentro NPC → dos jugadores con huida/rendición
  → patrulla/notoriedad → abordaje de dos cubiertas. Topología y costes pendientes; M5 es puerta de persistencia.
- [ ] **P7 Progresión y aspecto.** Mesa de cartas: investigar piezas (vela mayor, motor, alambique) con muestras
  que se traen de cada isla. Banderas y pintura. Las cinco etapas de la referencia: balsa desnuda → refugio →
  ampliada (huertos, bodega) → avanzada (motor) → mega balsa.
  Incluir tiers de materiales y navegación, con vista vacío/cargado. No convertir nivel de barco en bonus
  universal que anule peso o haga desaparecer roles. No es necesario cerrar todas las tecnologías en M6.

## 3. Notas

- La cuadrícula y las reglas son del servidor; el cliente solo pide y dibuja. `sanitizeRaft` rehace la balsa
  guardada pieza a pieza, así que una partida editada no puede colocar lo imposible.
- `RAFT.maxCells` (12 × 12) y 3 niveles son límites técnicos actuales; los límites por materiales/skill son
  trabajo futuro dentro de un presupuesto medido. Fusionar mallas no prueba por sí solo rendimiento de combate.
- Los barcos clásicos (`data/ships.js`) quedan como alternativa de compra en el astillero (M8), o como enemigos.
- Separar plano de daño operativo antes de persistir destrucción; no usar `sanitizeRaft` para borrar partes
  domésticas porque perdieron soporte en combate. Identidades estables de piezas/carga y recuperación en M5.
