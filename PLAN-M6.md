# PLAN M6 — «La Balsa»: tu barco es tu casa

> Idea del autor (referencia: *Raft*): **empiezas con cuatro tablones y una vela** y la vas haciendo crecer, pieza a
> pieza en una cuadrícula, hasta una fortaleza flotante. La balsa es tu casa, tu taller, tu bodega y lo que te lleva
> de pueblo en pueblo a comerciar (M7). Une las dos patas de la estructura: **construcción y barcos**. Los solares en
> los pueblos (M8) quedan para más adelante y para los edificios grandes.
>
> «De una balsa a cualquier parte.»

## 0. Qué hay ya en el código

| Pieza | Dónde | Estado |
|---|---|---|
| 28 piezas: cimiento, piso, pilar, pared, puerta, ventana, barandilla, techo, escalera, escala, vela, vela mayor, motor, ancla, bodega, cofre, caja, huerto, cañaveral, purificador, red, parrilla, alambique, mesa de cartas, hamaca, litera, farol, cañón giratorio, adorno | `src/data/raftparts.js` | ✅ |
| Reglas de construcción: cimientos conectados (12 × 12 máx.), pisos con soporte (pilar o pared debajo, o un voladizo de una casilla), piezas sobre cubierta libre, bordes junto a una cubierta, la red al borde, 3 niveles | `src/sim/economy/raft.js` (`canPlace`) | ✅ |
| Colocar pagando con una bodega, quitar devolviendo la mitad (sin tirar lo que sostiene algo ni partir la balsa) | `place` / `remove` | ✅ |
| Lo que hace la balsa: flotación contra peso (sobrecarga = se arrastra), velocidad por velas y motores, bodega, tripulación, cañones, reaparición | `raftStats` | ✅ |
| Producción en el reloj del juego: el purificador riega los huertos (más con techo), las redes pescan, la parrilla y el alambique cocinan, el motor quema madera | `stepRaft` | ✅ |
| Guardado en el perfil (`p.eco.ships`: `{kind: 'raft', grid, hold, at, hp, look}`) | `trade.js` (`sanitizeEco`) | ✅ |
| Viajes entre pueblos (ruta, horas por velocidad, eventos con semilla), bodegas | `voyage.js`, `cargo.js` | ✅ |
| Barcos clásicos (balandra… galeón) para más adelante | `src/data/ships.js` | ✅ datos |
| Modelos externos por pieza (`part:<id>` en el manifiesto) | `docs/ASSETS.md` | gancho por añadir (P2) |

## 1. Decisiones (a confirmar con el autor)

- Todo pirata empieza con la **balsa inicial** (`STARTER_RAFT`: 2 × 2, una vela, una caja) amarrada al muelle de la
  Aldea.
- Se construye **con lo que llevas a bordo**: la madera, la lona y el hierro salen de la bodega de la balsa (o de tu
  mochila al estar en ella). Se consiguen comerciando (M7), pescando con la red, recogiendo restos flotantes
  (P5) y saqueando.
- **Se camina por la balsa**: la cubierta es suelo (y los pisos superiores, con escaleras); las paredes chocan. En el
  muelle es una zona más de la isla; en el mar, una instancia propia (fase B).
- **Viajar** (fase A): desde el timón, elegir destino en la carta (mesa de cartas) → travesía con el tiempo de
  `voyageHours(leguas, raftStats.speed)` y los eventos de la ruta; la balsa produce mientras viaja.
- **Defender** (fase B): tiburones, piratas y la Corona atacan en el mar. Se pelea **sobre tu propia cubierta** con
  el combate de siempre (bullet hell, parry, tatuajes), y los cañones giratorios disparan solos o a mano.
- **Personalizar**: bandera y pintura (`RAFT_LOOKS`), adornos.

## 2. Pasos

- [ ] **P1 La balsa en el muelle.** Al crear perfil, `p.eco.ships = [{ kind: 'raft', grid: newRaft(), … }]`.
  Entidad `vehicle` en el ECS (reservada) con su cuadrícula; el servidor la manda en el snapshot (piezas al
  entrar, cambios como eventos `raftPart`). Render: una pieza = una malla procedural (cajas de madera con la tinta
  de `props.js`) colocada en su casilla, la balsa meciéndose sobre el agua (`water.js` ya mece el barco anclado).
- [ ] **P2 Caminar por ella.** `map.groundAt` y las colisiones consultan la balsa cerca del muelle: la cubierta da la
  altura del suelo, las paredes y barandillas son colisionadores, las escaleras suben de nivel. Test: un jugador
  camina de la playa a la cubierta.
- [ ] **P3 Modo construcción** (tecla B / botón táctil). Menú de piezas (rejilla de iconos como la referencia:
  nombre, coste, lo que hace), fantasma verde / rojo en la casilla apuntada con el motivo de `canPlace` en español,
  rotar bordes con R, quitar con clic derecho. Comandos `raft` `{op: 'place', piece}` / `{op: 'remove', i}` →
  eventos `raftPart` / `raftDenied`. Gancho de assets `part:<id>` (un kit modular de Meshy: misma medida de casilla,
  `RAFT.cell` = 2 u).
- [ ] **P4 Vivir en ella.** La producción en el reloj (`stepRaft` en `economy.step` para las balsas de los
  jugadores conectados), panel de la balsa (bodega, agua, lo que produce, peso / flotación, velocidad), cofres,
  hamaca como punto de reaparición, faroles de noche (luces locales).
- [ ] **P5 Zarpar.** El timón abre la carta; travesía (`planVoyage` + `stepRaft` acelerado); restos flotantes que
  recoger con un gancho por el camino (madera, lona, barriles); llegar a puerto abre su mercado (M7).
- [ ] **P6 (fase B) El mar.** Instancia de mar, la balsa movida por el viento y el timón, encuentros de la ruta
  como peleas sobre cubierta, cañones giratorios, daño por pieza (`hp`), reparar.
- [ ] **P7 Progresión y aspecto.** Mesa de cartas: investigar piezas (vela mayor, motor, alambique) con muestras
  que se traen de cada isla. Banderas y pintura. Las cinco etapas de la referencia: balsa desnuda → refugio →
  ampliada (huertos, bodega) → avanzada (motor) → mega balsa.

## 3. Notas

- La cuadrícula y las reglas son del servidor; el cliente solo pide y dibuja. `sanitizeRaft` rehace la balsa
  guardada pieza a pieza, así que una partida editada no puede colocar lo imposible.
- `RAFT.maxCells` (12 × 12) y 3 niveles: suficiente para la «mega balsa» sin romper el rendimiento (una malla
  fusionada por balsa, como los props por trozo).
- Los barcos clásicos (`data/ships.js`) quedan como alternativa de compra en el astillero (M8), o como enemigos.
