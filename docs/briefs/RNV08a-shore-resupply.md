# RNV08a — Abastecimiento de mochila en una parada de costa

## Resultado

Durante una parada seca normal en tierra, el jugador puede usar un mercado físico ya existente y atender sus
provisiones de mochila. La bodega de la balsa permanece bloqueada hasta volver al muelle de origen. Las
transferencias de agua con barriles de la balsa también quedan bloqueadas mientras dura la parada; fabricar
recipientes, recoger agua, rellenar desde mochila o cubeta, beber y comer siguen disponibles.

El cliente trata `voyage.active`, `voyage.phase === 'shore'` y `voyage.shoreService === true` como estado
informativo para la parada autorizada. La recuperación, la salida al agua y la navegación no habilitan servicio
de costa. El servidor sigue siendo dueño de ubicación, cotizaciones, débito/crédito, transferencia y recibos.

## Alcance del corte

- Mostrar una nota ES/EN de bodega bloqueada y ocultar/desactivar el acceso a transferencia de carga en costa.
- Permitir abrir un mercado existente y caminable solo cuando el snapshot autoritativo anuncia el servicio seco.
- En el panel de agua, bloquear depósito, retiro y relleno de cantimplora desde barril durante la parada.
- Mantener las operaciones que usan solo mochila o recipientes personales: recetas, manantial, cubeta,
  provisiones, bebida y comida.
- Reembarcar y comprobar que el mismo viaje, barco y carga siguen presentes.

No agrega un mercado de Puerto Sol, otra economía, un nuevo contrato de persistencia, transferencias barco-costa,
amarres permanentes, combate naval, ni nuevas ciudades. La fixture de QA usa el mercado físico existente que el
servidor presenta al jugador y debe nombrar ese mercado como fixture; nunca se rotula como Puerto Sol.

## Reutilización de assets

El pase no necesita un asset nuevo. Reutiliza el muelle y los postes procedurales existentes, además de la caja
Dreamrise ya aceptada como `prop:storage-crate`. La inspección concreta de Unreal/FAB no encontró una malla
verificada para muelle, letrero, puesto o puerto. `SM_SmallWoodeHut` y `SM_RepairBench` son candidatos terrestres
de exportación pendiente; `SM_StoragePart_03` ya se exportó y sirve como prop de caja, no como muelle ni almacén
funcional. Los dos paquetes de barril de MyProject permanecen sin inspección geométrica ni exportación.
Fuentes: [CANDIDATES.csv](../research/unreal-assets/CANDIDATES.csv), [portabilidad](../research/unreal-assets/PORTABILITY.md)
y [S17 carga pintada](../briefs/visual-s17-port-cargo.md).

## Verificación

`node --test tests/shore-stop-ui.test.mjs` verifica la disponibilidad del servicio y los bloqueos de las
acciones de UI. `node tools/qa-shore-stop.mjs` ejecuta una sesión serial de GameHost desechable en escritorio ES
y móvil EN, con capturas, compra y venta confirmadas por el servidor, agua/cantimplora, reembarque y comparación
del mismo viaje/bodega. La fixture de ubicación forzada queda declarada como fixture de QA; no acredita habilidad
de navegación ni representa una ciudad nueva.

Este brief describe el contrato. La [entrega](../delivery/rnv08a-shore-resupply.md) registra publicación,
revisión e imagen VPS y separa la aceptación visual local del canario autenticado público.
