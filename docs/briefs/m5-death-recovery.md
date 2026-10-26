# D09f-2b.22 — diario y recuperación de muerte completa

Base a762dac. El autor confirmó SQL009 aplicada sin error el 2026-10-07; no se verificó Supabase real en este corte.

## Contrato

La muerte usa familia death en el mismo journal y PearlQueue de ProfileSessions. No crear una segunda cola que permita solapar muerte con give/swallow/leave o batches históricos. commitDeath(concrete, reservation) recibe la operación completa ya capturada y canónica; no invoca builder. reconcileDeath lee recibo/estado, resumeDeath permite un envío explícito del request exacto después de una lectura autoritativa que devuelve recibo null. recoverPearls conserva su nombre/API y recupera las cuatro familias.

La cola toma síncronamente UUID, cuentas de víctima/PK y todos los UIDs de los perfiles anterior/posterior, incluidas las perlas conservadas por el atacante. Espera guardados previos, pero exige versión y baseline completos exactamente iguales al capture. El caller debe asentar el progreso antes de capturar la muerte, bajo reserva común. No recalcular pérdidas ni rebasar un snapshot distinto sobre una muerte histórica. Un snapshot tardío idéntico al baseline puede sustituirse por el perfil posterior exacto; cualquier cambio de XP/bolsa/progreso de víctima o atacante falla y exige reconstrucción de autoridad, sin revertir storage confirmado.

El journal escribe primero UUID/scope/request exactos como pending. Respuestas perdidas retienen las reservas hasta que lecturas completas prueben resultado actual o conflicto. Recibo histórico por sí solo no demuestra estado vigente. Startup solo lee: ninguna muerte se reenvía automáticamente y ningún builder/RNG/evento se ejecuta. Una generación/perfil avanzado retira el contexto local como conflict. La pérdida de respuesta terminal conserva el audit committed si ya llegó a DB; no lo reescribe como conflict.

La reserva opaque del caller sobre cuentas/UIDs sigue viva después de liberar lanes de storage, hasta apply o fence. Close/invalidation durante prepare cancela antes de dispatch y cierra el pending como rejected; la reserva invalidada queda sticky. No habilitar apply/publicación de ECS desde continuaciones Promise ni liberar un fence por reconciliar un recibo.

SQL010 aplica después de 001–009. Amplía solo familia admitida y guard de namespace; conserva requests/recibos históricos y los archivos SQL anteriores. Permite coexistencia del recibo con su death intent exacto pendiente; bloquea las tres familias antiguas y journal ajeno en ambos sentidos, incluso inserciones/updates directos de UUID. Los guards de completion/drops de SQL009 siguen activos. RLS/RPC son service-only, search_path vacío; no agrega tablas ni columnas.

## Aceptación y límites

Memoria y PostgreSQL local/PGlite por SDK Supabase: cero/nueve perlas, Cala/PK/drops, progreso previo/tardío, reservas de víctima/atacante y UID conservado, lost prepare/commit/terminal, lectura corrupta/no disponible, conflicto por avance y reintento exacto. Tres procesos nuevos prueban lost prepare → resume explícito → startup sin repetir EXP/bolsa/perlas/botín. Regresión fija y hashes en el informe de entrega.

Este corte es server-only: no activa hooks de muerte del host, captura bajo reserva, apply/snapshot/eventos, respawn ni suelo ordinario actual recogible. listDeathDrops sigue siendo historial de creación; consumo/pickup/hidratación/expiry durables requieren otro lifecycle. Una autoridad por mundo hasta leases. SQL010 y verificación Supabase real pendientes; no leer env ni reiniciar/publicar el host. Afinidad permanente, epoch/reloj/políticas y finalizador siguen abiertos. Siguiente: staging de muerte completa y apply síncrono, con protección de close/respawn/recycle; después lifecycle del botín.

## Reutilización Unreal/FAB

Inventario CANDIDATES/FINDINGS cruzado y candidatos concretos reverificados en C:\Unreal: BP_JigServerSave 580.554 B y BP_InventoryComponent 24.878.603 B. Blueprints no ejecutables en Node/CAS; reutilizamos journal, cola, gate, deathOperation/captureDeathPlan y helpers actuales. Fuentes intactas, sin assets nuevos ni auditoría de licencias.
