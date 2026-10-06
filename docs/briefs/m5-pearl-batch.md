# D09f-2b.4 — transacción de varias perlas

2026-10-06. Base `4414665`, después de SQL006 real y del efecto común `26ef249`.
Corte de almacenamiento server-only: no activa circulación durable en el juego.

## Contrato

`commitPearlBatch({ operationId, world, mode, profile, items })` conserva una cuenta y todos
los UIDs afectados en una sola transacción. `profile={id,expectedVersion,data}` es el perfil
posterior canónico; cada item contiene `{uid,kind,expectedVersion,ground}`. Los items deben
venir ordenados por UID, sin duplicados, con generaciones conocidas positivas. Coordenadas
y tiempos tienen los límites del DTO ground existente; el caller conserva la decisión de reloj.

- `death`: 1–9 perlas; representa **todas** las perlas de bolsa + tragada. Todas pasan a suelo
  explícito y el perfil queda con bolsa vacía/tragada null. Muerte sin perlas no requiere este RPC.
- `replace`: exactamente dos UIDs distintos. Una perla de bolsa pasa a tragada con `ground:null`;
  la tragada anterior pasa al suelo explícito. Conserva orden y contenido de la bolsa restante.
- El perfil cambia exclusivamente sus slots de perlas. Oro, XP, maestrías, equipo, quests y
  cualquier otro campo almacenado quedan iguales. **Solo resuelve la parte de perlas de muerte**:
  no hace atómico el resto de pérdidas de equipo/oro ni los cambios de mundo.
- Una versión CAS de perfil avanza una vez; cada UID y ubicación afectada avanzan una vez.
  El entrante conserva holder/since; los que salen quedan sin holder/since. Un UID 003 gestionado
  sin ubicación puede adquirirla; un UID ausente, otro dueño o un suelo de otro mundo se rechaza.
- Un UUID/recibo para el lote completo. Replay exacto devuelve el resultado histórico sin volver
  a mutar. Payload diferente con ese UUID se rechaza; exclusión SQL simétrica con 003/004/005.

`loadPearlBatchOperation` entrega request/recibo validados para reconciliación de storage.
No autoriza aplicar eventos históricos a World ni sustituye un diario de intención previa.
El nuevo lote **no entra todavía** en `ProfileSessions`, su cola/diario ni el coordinador de tick.

## SQL y afinidad

Aplicar [007_pearl_batch.sql](../../server/migrations/007_pearl_batch.sql) después de 001–006.
READ COMMITTED; UUID → fila de perfil → todos los UIDs old/new/lote ordenados, siguiendo
003/raw save → ledger/ubicaciones. Los guards existentes permanecen y el RPC usa un único
bloque de excepción para rollback completo, incluido el recibo provisional. Servicio únicamente.

La [afinidad permanente confirmada](m48-pearl-affinity.md) sigue pendiente de schema/saneado/runtime.
SQL conserva incluso un campo futuro fuera de `pearls`; el DTO actual rechaza campos que el
sanitizer todavía desconoce. La prueba SQL de conservación **no demuestra afinidad implementada
ni soporte completo de ese campo por SDK/perfiles**. Añadir el campo real requiere defaults/saneado.

## Reutilización y aceptación

Revisión acotada de `actionrpg/FINDINGS.md`; verificados intactos `BP_InventoryComponent`
(24.878.603 B), `ServerSlotInfoArray` (7.212 B) y `BP_JigServerSave` (580.554 B) en el inventario
ActionRPG de `C:\Unreal`. Referencias de UID/slots/save; paquetes Blueprint sin CAS/recibos Node
portables. Reutilizar DTO/profile/guards de 003–006 y SDK propio; sin exportaciones ni nuevo arte.

Probar memoria y SDK/PGlite, conjuntos exactos, límites, CAS por UID, rollback tardío,
UUIDs entre familias, permisos, respuestas perdidas y lectura/replay entre procesos nuevos.
Congelar fuentes y correr regresión pertinente en un árbol aislado, sin env/red externa.
PGlite no demuestra carreras entre backends PostgreSQL independientes ni leases multi-host.

Siguiente: aplicar/verificar 007 real con fixtures exactas; diario/cola/reservas del lote y
recuperación tras intención sin recibo; staging de muerte/reemplazo; hooks completos y restauración
con dueño de sim/host. Scope/reloj/adopción/invitados y afinidad siguen sus contratos abiertos.
