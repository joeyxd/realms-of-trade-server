# D09f-2b.10 — publicación, guardados y desconexión del perfil

Continúa el [arranque preparado](m5-pearl-startup.md). Este corte conecta el gate existente a las salidas
reales de GameHost/LocalServer; no habilita comandos de perla durables ni invoca startup/staging en el host.

`LocalServer.profileAccess(id, entity, purpose)` es un hook opcional, booleano y síncrono, anterior a
`syncProfile`. Sin hook conserva el flujo del Worker. GameHost resuelve las cuentas desde sus sesiones
autenticadas y los UIDs desde el inventario y ledger de la entidad actual del World. Incluye UIDs de invitados; los campos del mensaje
no autorizan lanes. Un `pirateId` histórico no cambia la cuenta resuelta y no se adopta/reemplaza aquí.

Mientras el gate o la queue retienen una cuenta/UID, `sendProfile` conserva perfil, dirty, `profT` y
programación; `sendSave` conserva perfil, `saveAt` y `lastBlob`. Ambos devuelven false y no publican datos.
Una salida aceptada devuelve true. Un `onSave` que devuelve false también conserva la programación y
suprime el blob. Errores de publicación/firma no borran la programación ni anticipan `lastBlob`.
La revisión periódica existente reintenta usando el estado actual después de liberar la lane.

Los snapshots existentes contienen tuples ECS de movimiento/combate, sin inventario del perfil,
UIDs de perlas, blobs ni recibos durables. Siguen llegando al jugador afectado y a los otros clientes,
con sus ACKs y estado actual. No se agregan campos ni cambia PROTOCOL_VERSION 16.

## Cierre que no oculta un guardado rechazado

`beforeDetach(id, entity)` invalida las cuentas/UIDs antes de borrar recibos locales, quitar barcos,
detach del perfil/ledger o despawn. La invalidación es sticky: una respuesta tardía no vuelve a
autorizar el apply de una entidad cerrada/reutilizada. Un cierre sin reserva guarda como antes.

Si el snapshot final queda bloqueado, GameHost conserva una copia aislada del perfil y progreso ECS en
`unsavedProfiles`, no envía ese inventario a storage y no intenta combinarlo con un recibo. El host
detiene simulación/admisión después del detach, health deja de estar disponible y `close()` rechaza
`StoreError('flush')` tras esperar las autoridades de almacenamiento existentes. Status expone solo
`storage.unsaved`, nunca el contenido privado. La copia se toma sobre un perfil clonado; los helpers
de detach cambian presencia/ledger/recibos, no los campos persistidos del inventario de ese personaje.

Esta copia **solo vive en memoria**. No garantiza el último progreso si termina el proceso, no es un
save reanudable y nunca autoriza volver a escribir los UIDs anteriores al commit. Un finalizador durable
debe resolver/conservar el progreso junto al request antes del cierre; permanece como trabajo propio.
El cierre durante startup también necesita esperar su IO cuando se conecte ese coordinador al host.

## Reutilización y aceptación

Inventario Unreal/FAB y candidatos `BP_JigServerSave.uasset` (580.554 B) y
`BP_InventoryComponent.uasset` (24.878.603 B) verificados de solo lectura en ActionRPGMultiplayerStart.
Son referencias Blueprint, sin guard de publicación Node/CAS portable. Se reutilizan gate, sesiones,
staging, syncProfile y scheduling existentes; no se importan assets ni se modifica Unreal.

Probar los métodos reales del host: cuenta/UID/queue busy, datos falsos del cliente, invitados con blob,
preservación y reintento de dirty/saveAt, continuidad de snapshots y hueco entre recibo confirmado y
apply. Desconexión invalida antes de mutación, no guarda el snapshot contradictorio, retiene copia aislada
y falla el flush. Regresión de combate/perfil/Worker, cuentas y host en archivo Git aislado.

No cambia SQL/env ni añade afinidad. Siguen los [hooks de mutación](m5-pearl-common-gate.md), comandos y
efectos autónomos, apply en tick, scope/reloj/adopción/startup del host, muerte completa y finalizador
durable. La integración de afinidad por personaje/tipo sigue pendiente; P4/P6 continúan parciales.
