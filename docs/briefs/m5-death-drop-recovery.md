# M5 — diario y recuperación del botín ordinario (D09f-2b.27)

## Objetivo y frontera

Registrar la petición exacta de pickup/expire antes de enviarla. Una respuesta incierta mantiene
reservados receptor, perlas conservadas y fuente (UUID de muerte + ordinal) hasta que lecturas
completas confirmen el resultado o conflicto. No se aplican efectos al World ni se activa el host.

## Autoridad y recuperación

Familia drop en el journal existente, con scope igual a world. UUID de transición distinto del
UUID de creación; namespace exclusivo frente a pearl/ground/batch/death, también por escrituras
SQL directas. Solo una intención pending exacta puede acompañar un recibo nuevo. Los terminales
conservan identidad/auditoría; replay histórico no consume de nuevo ni revierte progreso.

ProfileSessions.commitDeathDrop recibe el DTO concreto sin builder. Reserva sin await cuenta
receptora (solo pickup), todos sus UIDs de perla y fuente del drop. Saves previos se asientan y
su baseline/versión deben seguir coincidiendo: nunca recapturar capacidad, UID, tick o progreso.
Snapshot tardío solo puede ser el before completo sin cambios; otro progreso cerca la sesión.
La capability del caller contiene exactamente las tres clases de recursos y sigue hasta apply/fence,
incluso después de liberarse la cola de storage. Expiry tiene lane de drop sin cuenta.

recoverPearls valida todo el backlog paginado antes de instalar reservas; duplicados de UUID,
cuenta, UID o fuente rechazan todo el scan. Startup lee recibos/estado actual/perfiles y cierra
auditoría, sin enviar commit. Recibo null permanece pending; resumeDeathDrop explícito reenvía
UUID/request/tick/versions originales solo después de null autoritativo. Un error de lectura no
permite ese envío. Recibo visible + lectura actual fallida mantiene las reservas. Estado completo
avanzado cierra conflicto; no publica ni aplica el perfil histórico. reconcileDeathDrop solo lee.

## Reutilización comprobada

Fuentes Unreal/FAB revisadas de solo lectura por el principal: BP_InventoryComponent.uasset
24,878,603 bytes en InventorySystem/Components y SM_Potion.uasset 117,402 bytes en
Assets/PickupMeshes/O_Potion, bajo C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem.
El Blueprint no ofrece una cola/journal portable JS/Postgres y la poción sirve únicamente como
candidato visual. Se reutilizan PearlQueue/MutationGate/journal y las reglas SQL011 de inventario.
Sin arte nuevo, exportaciones ni escrituras en fuentes Unreal.

## Aceptación

Memoria y SDK/PostgreSQL local: petición detached, reserva síncrona, exclusión de fuente/cuenta/UID,
capabilities, baseline tras saves, respuestas prepare/commit/terminal perdidas, resume exacto,
progreso avanzado y lecturas incompletas, cancelación/close, expiry sin cuenta y backlog corrupto.
SQL001–012 + reapply012, permisos, namespace INSERT/UPDATE en ambas direcciones y conservación
del historial/suelo terminal. Procesos independientes con PGlite en disco prueban recuperación
real del diario sin reenvío automático. Esto no prueba World/partida completa ni concurrencia de
backends PostgreSQL independientes. Sin reloj/epoch/offline, backfill, leases, env, protocolo o deploy.
Siguiente: staging/apply en tick, hooks y restauración con reloj estable, luego piloto restart/WAN.
Afinidad permanente sigue abierta.
