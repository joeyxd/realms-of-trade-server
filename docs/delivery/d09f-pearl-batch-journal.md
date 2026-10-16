# D09f-2b.5 — diario y cola compartida para lotes

2026-10-06. Base `64b9956`. Corte server-only después de la aceptación real de SQL007.
La aceptación de este checkpoint fue local. **Aceptación posterior: SQL008 aplicada y verificada real,
18/18 con ProfileSessions y cuatro procesos nuevos**: [evidencia 2b.6](d09f-pearl-batch-journal-live.md).
No cambia host, LocalServer, cliente, protocolo, reglas de pérdida, reloj, RNG o afinidad.

## Comportamiento

`ProfileSessions.commitPearlBatch(meta, build, reservation)` usa la misma `PearlQueue` que 003/004.
`meta` contiene `{ operationId, actor, world, mode, items }`; cada item conserva UID/tipo/generación y
ground exactos, en orden estricto. Actor conocido, UUID, geometry/time y modo quedan separados del
perfil CAS que el builder construye después de drenar los guardados ordinarios anteriores.
El builder recibe filas desconectadas `{ id, version, data }` y devuelve `[{ id, data }]` del actor.
No puede cambiar progreso/oro/equipo ni omitir una perla de muerte o alterar el reemplazo de dos UIDs.

La cuenta, el UUID y **todos los UIDs** se reservan antes del primer await/builder. Una intención 003/004
que solape cualquier item rechaza el lote completo; no instala reservas parciales ni usa otra cola.
El permiso opaco del gate debe cubrir exactamente esos recursos. La cola libera sus lanes al terminar,
pero la reserva del caller de staging permanece hasta apply/fence mediante su dueño actual.

El request concreto se escribe en el diario antes de enviar el RPC007. Preparación/recibos/terminalización
ambiguos mantienen todas las reservas. Los reintentos de la autoridad viva conservan el request/UUID;
startup carga y valida todas las páginas antes de abrir admisión, incluyendo overlaps de UID/cuenta/UUID.
Un recibo committed exacto se recupera leyendo perfil y **cada ledger/ubicación**, sin builder/RPC nuevo.
Una lectura fallida/malformada conserva pending; el avance de un solo item produce conflicto del lote.
`resumePearlBatch` permite un envío explícito del request persistido solo después de ausencia autoritativa
del recibo. `reconcilePearlBatch` es de lectura/terminalización; no publica drops ni eventos históricos.

Guardados recibidos durante el envío conservan XP/oro/mastery/otros campos vigentes. Para un lote, sus
slots `pearls` deben seguir iguales al baseline completo: una mezcla old/new o cambio de orden/slots
incompatible falla sin avanzar parcialmente la autoridad local. Se reemplazan esos slots juntos y se
guarda con la nueva versión CAS. Fallos de sesión/flush permanecen pegajosos incluso tras recuperación.
Esto conserva progreso existente; no agrega campos ni crédito de afinidad.

## SQL008 e identidad en memoria

[008_pearl_batch_journal.sql](../../server/migrations/008_pearl_batch_journal.sql) amplía la familia del
diario a `batch` y reutiliza el validador007 con scope igual al world del request. Conserva literalmente
el validador006 de pearl/ground y sus RPCs, guards, estado terminal inmutable y permisos service-only.
Mantiene los cuatro triggers007 y el lock de UUID antes de profile/UID.

Un recibo batch nuevo admite exclusivamente una intención batch **pending** con request/scope exactos,
o ausencia de intención; un terminal sin recibo no habilita un commit tardío. Una intención batch puede
auditar un recibo batch ya existente solo con identidad exacta. Ambos excluyen recibos003/004 y otras
familias del diario. La excepción004 para su hijo003 exacto sigue funcionando.

`createMemoryPearlJournals(store)` enlaza el store de memoria original a su namespace privado de
recibos/intenciones; fábricas reconstruidas comparten filas y los mismos guards. Enlazar antes de decorar
sus métodos. La variante histórica sin argumento conserva su uso como doble independiente; no prueba
exclusión entre journal y storage. Ninguna variante de memoria es durable tras terminar el proceso.

## Verificación y límites

**579/579** pertinentes, cero fallos/canceladas/omitidas, en 32 archivos de un archive de base fija
más quince fuentes/pruebas propias; **91 nuevas**. SDK y SQL001–008 locales, sin `.env` copiado.
Hashes de las quince fuentes propias iguales antes/después; otras 22 fuentes verificadas contra base
sin cambios, incluidas las siete migraciones aplicadas y sim/host/gate/staging/protocolo.
La regresión final y hashes quedan en [evidencia](d09f-pearl-batch-journal-evidence.json).
Incluye contrato común memoria/SDK/SQL008, límites de identidad/permisos, reservas cruzadas por UID
intermedio, CAS anterior/progreso posterior, preparación/respuesta/terminalización perdidas, cancelación,
lecturas inciertas, avance de un item, backlog paginado solapado y conservación de rutas003–007/staging.
Doce procesos Node independientes cubren death/replace: committed recuperado sin envío y unsent
reanudado una vez, seguidos de progreso posterior y nuevo restart sin replay de gameplay.
PGlite con SDK local valida SQL; esos procesos no son reinicios de GameHost ni canarios Supabase.
Durante desarrollo se corrigieron dos assertions de pruebas SQL (orden de llamadas tras lecturas
adicionales y número de parámetros del test de inmutabilidad). La regresión final completa volvió
a pasar; no se cambió runtime/SQL para acomodarlas. También verifica explícitamente la ruta006
same-holder después de aplicar008.

Reutilización comprobada: ActionRPG `BP_InventoryComponent.uasset` (24.878.603 B) y
`BP_JigServerSave.uasset` (580.554 B) siguen presentes bajo `C:\Unreal\ActionRPGMultiplayerStart`.
Son Blueprints de inventario/save sin cola CAS/recibos Node portable; se reutilizan DTO/store/journal/gate
propios. Fuentes intactas, sin exportación/arte nuevo ni auditoría de licencias.

No hubo lectura de credenciales, tráfico a Supabase, DDL remota, browser, reinicio/despliegue/push ni
mutaciones de jugadores existentes. No valida carreras de backends independientes ni implementa leases.
Los edits navales/visuales y `PLAN-DELIVERY.md`/`docs/HANDOFF.md` de otro escritor quedan preservados.
`PLAN-M5.md` y este informe registran el estado propio de este corte.

Sigue aplicar008 después de001–007 y verificar un canario real aislado de diario/cola/restart con limpieza
condicional y auditorías terminales retenidas. Después: staging/tick de lote y hooks completos/restauración
con el dueño de sim/host. La muerte completa también modifica equipo/oro/mundo: el lote de perlas no hace
atómicos esos efectos. Afinidad permanente personaje+tipo mantiene su dirección aprobada y ejecución
pendiente. P4/P6 siguen parciales; no habilitar gameplay parcialmente durable.
