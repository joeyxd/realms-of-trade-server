# M5 / D09f-2b.31 — checkpoint durable del reloj de suelo

El suelo actual ya tiene reconstrucción opcional, pero sus plazos se expresan en World.tick, que empieza
en cero al crear un mundo. El reloj económico persistido por WorldState usa otra coordenada. Restaurar
el botín con tick cero prolongaría las ventanas; restaurar World.tick sin revisar inputs y predicción
mezclaría épocas del protocolo. Este corte entrega almacenamiento del checkpoint antes de ese montaje.

## Contrato cerrado en este corte

loadGroundClock(world) devuelve null o {world,tick,version,operationId}. commitGroundClock recibe
{operationId,world,expectedVersion,expectedTick,tick}. La creación explícita exige versión/tick previos
cero; un avance existente exige tick mayor y CAS tanto de versión como de tick. Ticks enteros seguros
0–9007199254740991 y versiones de escritura 0–2147483646. loadGroundClockOperation conserva petición
y éxito originales para aclarar una respuesta perdida. Replay histórico no retrocede el checkpoint.

SQL013 confirma checkpoint y recibo completo juntos. El UUID comparte namespace con los cinco tipos de
recibo de gameplay y sus intenciones. Tablas RLS, service_role con SELECT y escritura mediante RPC
schema-qualified SECURITY DEFINER de search_path vacío. Los demás roles no tienen acceso. Memoria
mantiene el mismo contrato, con durable:false. Un reloj ausente no crea datos ni adopta suelo legacy.

## Decisiones y trabajo siguientes

La política de tiempo offline se preguntó al autor y sigue pendiente al preparar este corte. Storage no
elige fuente, tasa, ageing offline, frecuencia de checkpoint ni lease. Una pausa offline y un reloj que
continúa requieren integraciones distintas. Tampoco fija World.tick ni convierte plazos existentes.

El siguiente montaje debe definir autoridad y coordenada del tiempo, epoch de inputs/predicción,
tratamiento de caída entre checkpoints, y correspondencia con availableAt/returnAt/expiresAt. Luego
componer carga del reloj, recuperación del diario y drain conjunto antes de admisión/publicación en
GameHost. El canario debe verificar muerte/recogida, reinicio, reconexión y plazos antes/dentro/después de
ventana. El cierre/reapertura de PGlite solo acepta persistencia del storage, no este flujo de gameplay.

Afinidad permanente por personaje/tipo, finalizador durable, leases y transacciones navales P4/P6
permanecen abiertos. No activar host/CLI ni cambiar env o protocolo en este corte.

## Reutilización y límites de aceptación

Se reutilizan StoreError, DTOs de suelo, snapshotDropData, namespace/advisory locks y SDK/PostgreSQL local.
Unreal/FAB consultado en solo lectura: BP_InventoryComponent.uasset (24878603 bytes) y SM_Potion.uasset
(117402 bytes) de ActionRPGMultiplayerStart. Blueprint/visual no aporta reloj ni transacción JS/Postgres;
no se modificó ni exportó la fuente. Autor confirmó SQL011/012 aplicadas el 2026-10-08; no es canario live.
SQL013 nueva requiere aplicar después de 001–012. Pruebas/evidencia en el informe de entrega.
