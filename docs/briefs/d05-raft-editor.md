# D05 — Editor acotado de balsas

**Estado: IMPLEMENTADO Y ACEPTADO LOCALMENTE EN SOFTWARE.** Versión `0.6.0-alpha.2`, protocolo 14; [informe y evidencia D05](../delivery/d05-raft-editor.md). Regresión 413/413 y 24 capturas PC/móvil emulado inspeccionadas. Esto no acepta navegación, viento, pérdidas, balance, rendimiento físico ni publicación.

Los controles, el pago y las salvaguardas forman el contrato técnico implementado. Se conservan costes y fracción de devolución actuales; balance, tiers y límites por habilidad quedan para D08.

## Alcance jugable inicial

Entrar y salir del modo construcción con **B** o el botón táctil, cerca de la propia balsa amarrada. **I** conserva el inventario. **R rota solo dentro del contexto explícito de construcción**; fuera de él continúa activando la habilidad R. Al entrar, salir o cancelar el editor, limpiar pulsaciones pendientes para que no se filtren como habilidad o acción de combate. La integración debe suprimir la entrada del slot R mientras el editor está activo. Estos controles siguen la propuesta de [D08](d08-navigation-feel.md), que permanece sin implementar ni aceptar.

La paleta inicial es una lista permitida de siete piezas existentes: `foundation`, `floor`, `pillar`, `wall`, `railing`, `stairs` y `crate`. Mostrar nombre y coste actual. Partir de la starter actual, sin regalar el plano de QA ni habilitar implícitamente las otras piezas del catálogo. Usar el atlas cómic y las superficies procedurales ya integradas; para `crate`, usar el modelo existente con su fallback procedural. RepairBench y choza no son kits modulares de balsa para este corte.

El cliente puede mostrar un fantasma verde/rojo, orientación y motivo de `canPlace` en español, solo como ayuda visual. Envía una intención; nunca modifica el plano autoritativo ni gasta inventario de forma optimista. La respuesta del servidor y el siguiente snapshot autoritativo confirman el resultado. La demolición es un modo explícito: seleccionar la pieza y mostrar la devolución prevista antes de confirmar. No reutilizar clic derecho, que fuera del editor sigue siendo guardia.

## Autoridad y comandos implementados

Añadir `raft` a la ruta de comandos de jugador autenticado. La solicitud debe contener solo operación, id de balsa, `expectedRev`, id único de operación y pieza propuesta o índice de retirada con identidad esperada de esa pieza. Nunca aceptar del cliente propietario, posición, amarre, plano, bodega, mochila ni coste.

Resolver la balsa desde el perfil del solicitante y el registro activo `w.rafts`. Exigir que sea su balsa primaria exacta, esté viva y amarrada en Aldea, y que el jugador vivo esté quieto en su cubierta o a menos de 8 u del punto de edición del muelle y 2,5 u de su pasarela real. Un visitante no puede editar. Comprobar `expectedRev` antes de mutar; al retirar, comprobar también que `index` todavía apunta a la tupla `piece` esperada. `opId` identifica el recibo: repetir la misma operación devuelve su acuse privado `raftEdit` sin cobrar ni devolver dos veces; cambiar su payload se rechaza. Una revisión obsoleta devuelve un registro público vigente para recuperar estado.

Usar `canPlace` y `place`/`remove` como primitivas de reglas, con la lista de siete piezas permitidas aplicada antes. `place` comprueba los bienes necesarios antes de descargarlos, pero acepta un solo almacén genérico. El perfil real tiene `eco.pack` y la balsa tiene `hold`; ninguno es autoridad del cliente. Para D05, primero bodega de la balsa y después mochila del propietario, con saldo combinado verificado antes del débito síncrono. No aceptar un almacén elegido por cliente. `remove` devuelve hoy la mitad del coste mediante `load`, que puede descartar parte de la devolución si el almacén está lleno. Conservar la fracción existente: verificar capacidad antes de mutar, devolver primero a bodega y después a mochila, o denegar sin cambios si no cabe toda la devolución permitida. Explicar esta ruta en la UI; ni crear materiales gratuitos ni descartar un sobrante silenciosamente.

Tras una edición aceptada, actualizar el plano de la nave, incrementar revisión sin desbordamiento, refrescar `raftDeck` antes del siguiente movimiento y emitir un resultado al propietario con la nueva revisión. Marcar el perfil para guardado junto con el plano, bodega/mochila y revisión. Los snapshots ya contienen registros públicos completos: conservar el límite de `publicRafts` y no publicar bodega, mochila, perfil ni identidad privada. El cliente aplica el snapshot a `pred.rafts` y a `RaftDeck` antes de reconciliar movimiento. La UI espera acuse, revisión pública y revisión del perfil; reintenta el mismo UUID si falta respuesta. La base privada `berthBasis` conserva el origen de amarre al ampliar y reentrar, sin confiar en pose guardada del cliente.

`quote` muestra las ofertas acotadas de madera/hierro de Aldea; `supply` compra con oro, stock y capacidad reales, bodega primero y mochila después. Comprar exige además tres segundos de calma. No se regalan materiales ni cambia el oro starter. Esta ruta hace jugable el coste combinado sin adelantar bodega, venta, mercaderes ni producción de D06.

## Validez, límites y retirada segura

Las reglas existentes exigen cimientos conectados, soporte, ocupación válida, hasta tres niveles y una base de 12×12. Se mantienen. D05 añade un techo de edición de 600 piezas para que el saneado existente de 600 candidatos no descarte piezas aceptadas al guardar. Estos son máximos técnicos de persistencia, no presupuesto del renderer ni balance móvil medido. El comando valida ids, coordenadas enteras, orientación, nivel y pieza permitida; también rechaza invasión del muelle/otra balsa o pérdida de pasarela. Antes de mutar, el guardado firmado de invitado debe caber en `MAX_SAVE` (32 KiB).

Al retirar, reconstruir y revalidar el resto del plano para impedir piezas suspendidas o balsas partidas. Añadir protección por ocupación: denegar si un jugador o visitante está encima o dentro de la huella de soporte/colisión que desaparecería, en particular pisos y escaleras. La validación estructural general no garantiza por sí sola que alguien sobre una escalera conserve suelo seguro. Nunca eliminar piezas dependientes silenciosamente, teletransportar visitantes ni desplazar jugadores como efecto de una edición. Una denegación no cambia balsa ni recursos.

Al colocar, denegar una pared o escalera que encierre, interseque o cambie bruscamente el apoyo de un ocupante. Se protegen también aterrizajes activos de Abordaje. La ruta de salida usa consultas compartidas en una malla conservadora de 0,25 u y hasta 20.000 nodos; resultado desconocido se deniega. No se empuja ni teletransporta a visitantes. Las cajas conservan la limitación de colisión detallada de P2 hasta implementar esa geometría.

Los costes y motivos finales provienen del servidor. Traducir faltas de soporte, borde ocupado, cimiento desconectado, nivel inválido y materiales insuficientes a mensajes breves en español. Mantener visible la pieza seleccionada y la orientación en escritorio y móvil.

## Contratos existentes relevantes

- `PLAN-M6.md` §2 P3 registra la entrega implementada. El informe D04 P2 confirma su base de cubierta transitable.
- `src/data/raftparts.js` define catálogo, costes, `RAFT.cell`, niveles, `maxCells` y fracción de devolución. `src/sim/economy/raft.js` define `canPlace`, `place`, `remove` y `sanitizeRaft`; son primitivas, no el límite completo de autoridad del editor.
- `src/sim/systems/trade.js` contiene `eco.pack` y `hold` del perfil real. `src/sim/systems/rafts.js` enlaza la balsa activa a su propietario, actualiza la cubierta, gestiona visitantes al retirar una balsa y construye el snapshot público filtrado.
- `src/core/input.js` asigna R a una habilidad fuera del editor; `src/main.js` asigna B al editor e I al inventario. `src/ui/raftEditor.js` y `styles/raft-editor.css` proporcionan paleta, controles táctiles y fantasma. `src/render/rafts.js` y `src/render/raftMaterials.js` proporcionan renderer procedural, atlas y seam del modelo/fallback de caja.
- `src/client/gameClient.js` consume snapshots públicos y actualiza la cubierta predicha antes de reconciliar movimiento. `src/sim/raftGeometry.js` y movimiento comparten la consulta de superficie/bloqueo; una edición aceptada debe actualizar la geometría de autoridad y cliente por la ruta del snapshot.

## Criterios de aceptación

1. Id falsificado, balsa ajena, solicitud de visitante, balsa no amarrada o jugador fuera del radio autorizado se rechazan sin cambios de estado o recursos.
2. Repetir una operación o enviar `expectedRev` obsoleto no duplica cargos ni devoluciones. Una edición válida incrementa revisión una vez; el rechazo obsoleto permite recuperar el estado vigente.
3. Pieza desconocida/no permitida, orientación o coordenadas inválidas, nivel 3, ubicación fuera de huella, falta de soporte y saldo combinado insuficiente fallan atómicamente. Mochila, bodega, plano y revisión quedan intactos.
4. Retirar soporte estructural o escalera/piso ocupado, o colocar un bloqueo que atrape a un ocupante, se deniega. El visitante conserva apoyo; no se borran dependencias ni se teletransporta a nadie. La devolución con bodega/mochila llenas falla sin retirar la pieza.
5. Colocar/retirar actualiza las cachés de autoridad y cliente antes del siguiente movimiento; snapshot y entrada tardía muestran las mismas piezas/revisión; editar predicción no permite falsificar el plano.
6. Revisión en escritorio y móvil confirma B/botón para construir, I/inventario, R como habilidad fuera del editor y rotación dentro, limpieza de pulsaciones en entrada/salida/cancelación, guardia con clic derecho fuera del editor, orientación/motivo visibles y retirada explícita.
7. Guardar y volver a entrar restaura plano, revisión y recursos exactos tras operaciones aceptadas/denegadas, sin repetir cargos ni devoluciones.

Fuera de D05: navegación, viento, pérdidas de viaje, combate naval, destrucción y ajuste de balance.
