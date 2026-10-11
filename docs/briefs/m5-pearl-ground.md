# D09c — ubicación durable de perlas (M5 P4/P6)

Base `12a6854`. Principal conserva arquitectura, `server/store.mjs`, nuevo `server/pearlGround.mjs`,
`server/migrations/004_pearl_ground.sql`, integración y documentación M5 propia. Luna recibe tests nuevos
y revisión acotada. LocalServer/sim/client/editor y host del PC siguen con su otro responsable: sin editar,
reiniciar, publicar ni activar circulación en este corte. No alterar 001/002/003 ya aplicadas.

## Contrato

`store.commitPearlGround({operationId,uid,kind,from,to,expectedVersion,profiles,world,ground})` confirma en
una transacción los perfiles CAS (si hay endpoints), ledger, ubicación y recibo. `ground` es null cuando
`to` es una cuenta; al dejar/vender o crear/relocar en suelo es `{x,z,availableAt,returnAt}`. Coordenadas finitas
acotadas; tiempos enteros seguros de milisegundos elegidos por el servidor, `returnAt > availableAt >= 0`.
El almacenamiento no elige posiciones/precios, no avanza reloj de juego ni elimina expirados. El futuro caller
debe decidir cómo mapear su reloj persistente a esos tiempos; no introducir avance offline aquí.

`from:null,to:null,profiles:[]` permite mint en suelo (generación 0) o relocación de suelo existente.
Pickup (null→cuenta, generación >0) exige ubicación en suelo de ese mundo. Los demás endpoints siguen el
contrato 003: versiones/perfiles ya existentes, movimiento puro del UID y conservación de otras perlas.
Una ubicación tiene `{world,ground,version}`; su versión es la misma generación del UID. Cada movimiento la
actualiza, incluyendo tombstone `ground:null` al estar en perfil. UID ya tracked conserva su mundo hasta P5.

UIDs ya registrados por 003 sin ubicación se empiezan a rastrear al efectuar un movimiento desde su dueño
de cuenta validado, o mediante mint nuevo; no hay bootstrap de mismo dueño ni adopción de UID no registrado.
Un UID sin dueño y sin suelo no se reclama silenciosamente. No adopta/cuarentena raras de perfiles.
Una vez tracked, la antigua RPC 003 no puede cambiar su generación sin actualizar ubicación: guardia diferida
evita perder el suelo. Guardados normales de perfil siguen permitidos si conservan propiedad.

Recibo de familia ground por UUID/payload exacto: un replay no muta ni vuelve a acreditar oro, otro payload
falla. En cambios de perfil el wrapper usa 003 dentro de su transacción; un recibo 003 preexistente aislado
no puede convertirse en operación ground. Recibos ground y 003 son familias internas distintas; caller
genera UUID nuevo por intención. El guard de recibos comparte lock por UUID entre ambas familias para impedir
colisiones incluso con llamadas concurrentes antiguas; no aplicar recibos viejos como lecturas actuales.

Lecturas: `loadPearlLocation(uid)`, `listPearlGround(world,{afterUid:null,limit:64})` (1–256, UID ordenado,
incluye expirados para recuperación) y `loadPearlGroundOperation(operationId)`. Servicio solamente, errores
fijos sin mensajes del proveedor. No endpoint público ni nueva variable de entorno. Memoria replica reglas
pero no es durable; SQL exige READ COMMITTED como 003.

## Aceptación

Mint/restore/list; transfer→sale/drop→pickup→relocate preservan UID y oro. Replay tras cambios devuelve su
resultado histórico sin modificar estado actual. Contendientes/stale CAS, payload cambiado, kind/mundo
incorrectos y pickup sin ground fallan sin cambios parciales.
Rollback después de escribir perfil/UID pero antes de guardar ubicación, guardia frente a RPC03/raw writes,
permisos/RLS y reaplicación. SDK real con transporte PGlite local; ninguna prueba toca Supabase/host activo.
Regresión de D09a/b/cuentas relevante. Entregar 004 lista para aplicar; no afirmar aplicada antes de verificarla.
