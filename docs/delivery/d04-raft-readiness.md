# D04 — punto de partida para la balsa

Revisión de lectura sobre `9a76925`, 2026-10-04; investigación Luna comprobada por el principal. No implementación ni aceptación de M6.
Puerta de entrada: D03 / M4.8 P5 aceptado localmente; quedó commiteado en `626beb7` durante A02, con aceptación física/publicación pendientes según su informe. Actualizar base y dueños antes de implementar.
Ya existen 28 piezas, `STARTER_RAFT`, validación de cuadrícula, colocar/quitar, estadísticas y producción: `src/data/raftparts.js`, `src/sim/economy/raft.js`.
`newEco()` aún crea `ships: []`; `newProfile()` lo usa. `sanitizeEco()` conserva balsas con grid/hold/at/hp/look, sin pose mundial: `src/sim/systems/trade.js` e `inventory.js`.
`eco.id` ya es la clave estable prevista para propietarios. No sustituirla por el id transitorio del jugador ni volver a regalar una balsa al reconectar.
El bit ECS `VEHICLE` está reservado, pero no conecta una balsa con propietario/cuadrícula/pose. El barco del muelle y el bote flotante son props distintos.
Snapshots de `src/net/localServer.js` no mandan balsas; cliente/renderer no tienen consumidor de piezas del perfil. Un asset de caja no resuelve esa brecha.
`worldgen.js` ofrece terreno, muelle y colisionadores estáticos; `movement.js` usa esos datos. Faltan superficies/bloqueos/escaleras de balsa compartidos por autoridad y predicción.
Orden propuesto para D04: primero P1, una balsa amarrada del jugador con estado autoritativo, snapshot completo para entrada tardía y renderer procedural; después P2, acceso y movimiento sobre cubierta.
Antes de implementar P1, el principal fija clave/id/revisión/pose del vehículo, regla de creación y migración de perfiles, y contrato de snapshot/eventos. Revisar protocolo; conservar guardados y evitar duplicación.
Rutas de integración: `world.js` o módulo de balsas enfocado; `localServer.js`; `gameClient.js`; `main.js`/`scene.js` y renderer de piezas nuevo. Un escritor por archivo y base aislada si D03 sigue activo.
P2 añade consultas de suelo/colisión y altura/nivel coherentes en `worldgen.js`/`movement.js`. La balsa amarrada es una prueba acotada; no decide mar abierto, barcos móviles ni abordaje.
Aceptación P1: creación única, guardar/cargar sin perder bienes, entrada tardía/reconexión coherentes y piezas visibles en la misma pose. P2: playa→muelle→cubierta, paredes y escalera, predicción frente a autoridad.
No afirmar persistencia pública: M5 sigue siendo puerta para bienes persistentes en riesgo. Editor D05 y bodega/UI D06 vienen después; fórmulas de navegación, pérdidas y topología conservan decisiones abiertas.
Fuente del alcance: `PLAN-M6.md` P1–P2, `PLAN-DELIVERY.md` D04 y `docs/NAVAL-ROADMAP.md`. Assets procedurales permiten avanzar aunque A02 no se adopte.

Checkpoint posterior, 2026-10-05: [D04 P1 implementado y aceptado localmente](d04p1-raft.md).
Este documento conserva la revisión inicial; P2 sigue pendiente.
