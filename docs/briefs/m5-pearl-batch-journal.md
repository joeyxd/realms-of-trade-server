# D09f siguiente — diario y cola de lote

2026-10-06. Corte técnico propuesto después de [SQL007 real aceptada](../delivery/d09f-pearl-batch-live.md).
No agrega reglas de gameplay ni activa el host. Principal: arquitectura/integración/aceptación;
Luna: búsquedas/revisión/pruebas acotadas. Un escritor por archivo; sim/LocalServer siguen con su dueño.

## Frontera

SQL007 tiene recibos atómicos de muerte/reemplazo, pero 005 y `pearlJournal.mjs` solo admiten
`pearl|ground`; `PearlQueue` reserva/compara un único `intent.uid`. El gate común ya puede reservar
varios UIDs. No crear una cola independiente que permita cruzar una intención batch con 003/004.

Nueva migración incremental después de 007, sin editar SQL aplicadas. Añadir familia batch al diario,
validación de request exacto/scope y convivencia exclusivamente del mismo UUID/request batch con
su intención batch. 003/004 e intenciones de otras familias siguen excluidas. El lock de UUID se
mantiene antes de profile/UID; terminales e identidad inmutables, acceso service-only.
Evitar simplemente quitar el guard 007 para hacer pasar una intención: aceptaría colisiones ajenas.

## Contrato a implementar

- Normalizar una intención batch sin perfiles concretos, con actor conocido, modo y lista exacta
  de UIDs/generaciones/ground ordenada. Congelar UUID/mundo/geometry/time antes del primer envío.
- Reservar una cuenta **y todos los UIDs** en mapas/gate compartidos antes del builder; operación
  all-or-nothing. Dranar CAS ordinarios previos y construir el perfil concreto una vez, usando
  `batchOperation`/`validBatchDelta`; liberar lanes no debe liberar la reserva de staging.
- Persistir request concreto antes de RPC. Preparación ambigua mantiene toda la reserva; no dividir
  el lote, cambiar UUID ni reenviar automáticamente una intención recuperada sin recibo conocido.
- Reconciliar recibo batch y estado actual de perfil, cada ledger y cada ubicación. Cualquier UID
  avanzado/conflictivo invalida el apply del lote completo; una lectura incierta mantiene reserva.
  El recibo histórico nunca autoriza volver a publicar un drop o restaurar una versión vieja.
- Startup debe cargar todas las páginas antes de admisión, rechazar solapamiento de cualquier UID,
  cuenta o UUID y reconstruir todas las reservas. Estado committed exacto se resuelve leyendo,
  sin builder ni RPC nuevo. Ausencia autoritativa permite reanudación explícita del request guardado,
  con un envío del lote completo; cancelaciones/terminalización siguen los límites actuales.
- Guardados posteriores deben rebasar solo slots actuales del lote y conservar progreso ajeno:
  XP, oro, equipo, quests y futura afinidad. Rechazar mezcla incompatible de slots; no dejar una
  muerte/reemplazo parcialmente aplicado. `flush` conserva fallos pegajosos y autoridad invalidada.

## Aceptación

Memoria y SDK/SQL local: 003/004/batch comparten reservas, overlaps por un UID intermedio,
CAS previos/posteriores, cancelación/desconexión, respuesta perdida, terminalización fallida,
backlog paginado con solapamientos, ausencia/recibo ambiguos y conflicto de cualquier UID.
Procesos Node nuevos para committed sin envío y unsent reanudado exactamente una vez.
Congelar fuentes y correr regresión pertinente aislada; después aplicar/verificar la nueva SQL
real con fixtures exactas. No cerrar esa aceptación con pruebas solo de DTO/gate/recibo.

Reutilizar el diario/cola/gate y guards de 003–007. La revisión ActionRPG de inventario/save ya
verificó candidatos Blueprint sin código Node portable; no necesita exportación ni arte nuevo.
No toca afinidad runtime, RNG, balance, precios, adopción/invitados, reloj offline o leases.
Al aceptar esta base, continuar staging/tick y hooks completos/restauración con sim/host;
no habilitar la ruta parcialmente durable de muerte o reemplazo.

## Implementación local aceptada — 2026-10-06

D09f-2b.5, base `64b9956`: [contrato y evidencia](../delivery/d09f-pearl-batch-journal.md).
**579/579** pertinentes aisladas, **91 nuevas**, 32 archivos y doce procesos Node nuevos para los dos
modos committed/unsent. Request/recibo/diario batch y reservas/reconciliación de todos los UIDs en la
cola común; CAS anterior, progreso posterior, fallos/cancelación/overlaps cubiertos. Identidad namespace
compartida en memoria al enlazar `createMemoryPearlJournals(store)`. Inventario/save ActionRPG intactos;
se reutilizó infraestructura Node propia. SQL001–007 y host/LocalServer/sim/protocolo sin cambios.
**SQL008 nueva pendiente de aplicar/verificar real**; este checkpoint no cierra la aceptación Supabase
ni activa staging/tick/gameplay batch. Sigue canario aislado real y después integración con sim/host.

## Aceptación real posterior — 2026-10-06

SQL008 aplicada por el autor y **18/18 comprobaciones reales** en cuatro procesos SDK/Supabase,
con ProfileSessions, respuesta perdida, startup sin dispatch y reanudación exacta de todo el lote.
Dos perfiles/seis UIDs de prueba limpiados; tres terminales conservados. **8/8** pruebas aisladas
del runner; runtime/SQL/host sin cambios. [Evidencia 2b.6](../delivery/d09f-pearl-batch-journal-live.md).
Sigue [staging de reemplazo](m5-pearl-batch-staging.md); P4/P6 y afinidad permanecen pendientes.
