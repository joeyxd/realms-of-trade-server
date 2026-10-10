# PRG01d — primera bodega, Tala y capacidad personal

Decisiones del autor, 2026-10-10. Este contrato sustituye el precio provisional y las barreras de la primera lección de PRG01c. SQL021 y los recibos históricos conservan su significado; no se modifica una migración anterior para reinterpretarlos.

## Recorrido aprobado

- La caja básica se fabrica desde el comienzo en la mesa de trabajo. Fabricar un kit consume dos tablas; colocarlo consume el kit. La caja que ya trae una balsa se conserva.
- El encargo personal de la primera bodega acepta entregas parciales hasta diez tablas. Al terminar enseña `raft_storage` y reserva la construcción de la primera bodega, sin un segundo cobro. No exige Tala 60 ni esperar a la carpintería comunitaria. Las siguientes bodegas cuestan diez tablas.
- Una tabla de madera básica requiere dos troncos. Una palmera completa entrega entre tres y seis troncos según los aciertos de sus tres golpes. Tala mejora el margen de acierto; las cifras de ventanas son tuning inicial, pendiente de playtest.
- La mochila inicial debe admitir al menos cuatro tablas. Cada mercancía mantiene volumen y masa independientes; mejores mochilas aumentan volumen, y Fuerza aumenta el peso admisible.
- Maderas regionales más resistentes y mejores hachas forman la expansión posterior. Este corte no inventa regiones, árboles ni herramientas que ya estén publicados.

## Significado de almacenamiento y cooperación

La bodega existente es una pieza de barco, de una casilla y veinte unidades de volumen compartido. El coste de diez tablas no significa diez slots. La caja básica añade seis unidades. Reutilizar estos conceptos en casas y tierra firme queda registrado, pero exige su propio contrato de propiedad, acceso y persistencia.

La cooperación de Tala es abierta: golpear el mismo árbol registra a los participantes sin formar una party. Diez puntos de práctica por ciclo se reparten proporcionalmente a los golpes. Los troncos siguen correspondiendo a quien termina el árbol. No hay todavía creación/invitación/líder de party ni reparto automático de misiones, XP general o recursos; una futura party debe definir esos tres repartos por separado.

## Autoridad y compatibilidad

M5 sigue siendo el único escritor: perfil, recursos y recibo se confirman juntos antes del ACK. Las entregas parciales, el crédito de primera construcción y los kits pertenecen al perfil personal; no a un autosave nuevo. El mundo comunitario se conserva y sigue aceptando sus aportaciones independientes.

El servidor emite el desafío de Tala y evalúa el instante de llegada del golpe usando su reloj lógico. El cliente dibuja el marcador y envía el intento; no decide acierto, rendimiento ni recompensa. Cada ciclo conserva sus aciertos junto al ledger de participantes. Los ciclos heredados parcialmente talados no reciben bonificaciones retroactivas. Apagado/reinicio pausa los plazos existentes.

Los perfiles y recibos anteriores se leen con su DTO original. La capacidad nueva se deriva de metadatos reconocidos por el servidor; nunca de un número enviado por el cliente. No se descartan mercancías al adoptar una mochila. Cambiar o mejorar una mochila y construir/retiro de almacenamiento deben conservar bienes y revisar ambas capacidades, además de la masa estructural de la balsa.

Tuning inicial de capacidad: mochila básica 18 uV; mejoras 30/42 uV. Fuerza = 10 + (nivel − 1), límite de carga = 18 + 2 × (Fuerza − 10) uM. Son unidades de juego, no kilogramos. Una mochila básica vacía permite el máximo de seis troncos de una palmera o seis tablas, y cumple el mínimo de cuatro pedido por el autor. Volumen y peso deben mostrarse por separado.

## Entregas y aceptación

La ampliación posterior INV01–03 se está planificando en el checkout compartido: huecos/pilas, stat Carga con puntos de nivel y lentitud por sobrepeso. Este corte conserva su contrato inicial de volumen/masa; no implementa ni cierra ese diseño posterior. Su migración y aceptación deben coordinarse antes de sustituir estos límites.

1. Contratos puros y pruebas de compatibilidad: desafío/rendimiento, encargo parcial/crédito/kit y mochila/Fuerza.
2. Montaje en la autoridad y UI ES/EN: flujo completo desde palmera hasta bodega y mejora de mochila, incluidos reintentos y rechazo por capacidad.
3. Migración aditiva, sin reinterpretar SQL016/021 ni recibos anteriores; caída antes/después del commit y adopción del mundo actual.
4. Publicación revisada, readiness SQL y canario autenticado. Mantener la activación apagada hasta aceptar esa combinación exacta.

La referencia visual sigue siendo el banco S19 y la caja procedural existente, revisados en [D06-REUSE](../research/unreal-assets/D06-REUSE.md). No se necesita arte ni exportación Unreal nueva para este recorrido.

## Contrato implementado y alcance de activación

El estado personal es opcional y versionado: `workshop:{v:1,boards:0..10,storageCredit:boolean,crateKits:0..99}`. La ausencia representa el estado vacío; campos adicionales, descriptores inseguros y versiones futuras se rechazan. `tradeRev` aumenta con cada operación personal exitosa. Las entregas aceptan de 1 a 10 tablas, únicamente desde la mochila y hasta completar diez; no consumen carga comunitaria. El recibo final enseña `raft_storage` y da un crédito único. Si la lección ya estaba aprendida por progreso previo, se considera completada y no se vuelve a otorgar crédito.

Colocar la primera bodega usa ese crédito; las siguientes cuestan diez tablas. El kit de caja cuesta dos tablas en el banco, y colocar una caja consume un kit. El taller no requiere Tala ni completar una misión/comunidad. El desguace conserva el salvamento proporcional a la condición de la pieza: una bodega devuelve hasta tres tablas y una caja hasta una tabla a vida completa. Las piezas dañadas devuelven menos; no se restaura la vida de la balsa ni se devuelve un kit. El perfil inicial con funciones nuevas se habilita mediante `workshopOperations`; con esa opción apagada, un perfil nuevo conserva el formato/capacidad legado de 10 y no recibe metadatos `carry` ni `workshop`. Los perfiles legados existentes tampoco se reescriben al iniciar sesión. Tras un recibo de taller exitoso, un perfil legado puede adoptar la mochila básica de 18 uV si, después de pagar, su carga cabe en volumen y masa; nunca se descartan bienes.

Las migraciones son aditivas: SQL024 se aplica después de SQL001–SQL023 y conserva las barreras de adopción de mundo de SQL023. SQL021 y sus recibos históricos no se reinterpretan ni se vuelven a ejecutar. La mochila básica y sus mejoras tienen 18/30/42 uV; Fuerza es `10 + (nivel - 1)` y la carga máxima es `18 + 2 × (Fuerza - 10)` uM. Las mejoras cuestan, respectivamente, 2 tablas + 3 lona y 4 tablas + 5 lona. Se cobran los materiales y luego se valida que la carga restante quepa en el nuevo límite; si no cabe, la operación se rechaza sin mutación.

Tala conserva el desafío con objetivo a +45 ticks, cierre a +90 y comienzo no anterior a +6. El ancho inicial es 5/8/11 ticks para práctica 0/60/180; los tres golpes producen 3–6 troncos según aciertos y diez puntos de práctica por ciclo. Esos valores son tuning inicial, pendiente de playtest.

## Estado de aceptación

La entrega local y la evidencia visual están en [PRG01d starter workshop](../delivery/prg01d-starter-workshop.md). La publicación y la activación SQL en un entorno vivo siguen pendientes; las pruebas locales no son un canario autenticado ni confirman persistencia en producción.

Referencias: [PRG01c](prg01c-artisan-storage.md), [Tala durable](prg01b2-logging.md), [autoridad de recursos](m5-resource-authority.md), [continuidad](../CONTINUITY-STATUS.md).
