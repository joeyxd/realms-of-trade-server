# D09f-2b.31 — checkpoint durable del reloj de suelo

Almacenamiento server-only aceptado localmente para guardar y recuperar el tiempo lógico de suelo.
El reloj económico de WorldState y World.tick son coordenadas distintas; este corte conserva un
checkpoint separado. No conecta todavía ese checkpoint con los plazos de gameplay ni activa el host.

## Contrato y seguridad

loadGroundClock(world) devuelve null o {world,tick,version,operationId}. commitGroundClock exige
operationId, world, expectedVersion, expectedTick y tick; creación explícita desde versión/tick cero,
y avances con tick estrictamente mayor. CAS compara versión y tiempo previo. Ticks enteros seguros
0–9007199254740991; última versión legible 2147483647, sin overflow de escritura. Ausencia de reloj no
crea filas, adopta suelo viejo ni hace backfill. El caller futuro deberá ser la autoridad de tiempo.

Checkpoint y recibo completo se confirman juntos. loadGroundClockOperation aclara una respuesta
perdida; replay devuelve el resultado histórico sin hacer retroceder el checkpoint actual. Un UUID
con otra petición o reservado por cualquier recibo de perla/ground/batch/death/drop o intención falla
sin cambios. Los cinco commits y el diario rechazan a su vez UUIDs ya pertenecientes al reloj.
SDK valida entradas antes de RPC y rechaza resultados sin identidad/versiones vinculadas.
Getter/Proxy y claves extra no ejecutan callbacks. Memoria mantiene el contrato pero durable:false.

SQL013 instala tablas RLS con SELECT exclusivo para service_role, sin INSERT/UPDATE/DELETE/TRUNCATE
directos. Un RPC SECURITY DEFINER schema-qualified, con search_path vacío y ejecución service-only,
realiza las escrituras acotadas. Usa el lock de UUID de operaciones ya existente, seguido de lock del
mundo y CAS. Recibos inmutables; anon/authenticated sin lectura ni ejecución. No modifica los guards
anteriores: agrega exclusión del nuevo namespace. El FK relaciona checkpoint y recibo; no pretende
impedir que un administrador de base altere manualmente filas fuera de la autoridad del RPC.

## Evidencia local

**145/145** comprobaciones pertinentes en diez archivos, **37 nuevas**, sin fail/cancelled/skipped/todo.
Node24.14.0, base fija 15ccf1c7 más fuentes propias. Cohorte final de 52.109,3568 ms; 469 módulos/SQL/JSON
bajo src/server/tests/tools y package manifests, más 954 archivos de Three físico privado, vigilados
antes/después sin drift. SDK2.117.2 y PGlite0.5.8 por junction, sin hash completo de esas dependencias.
Archivo aislado sin .env real. Comparación posterior de 469 fuentes contra Git: contenido idéntico
tras normalizar CRLF a LF; la evidencia identifica los archivos con esa diferencia de fin de línea.
La pasada previa 144/144 conserva log, pero no se suma: se agregó después
la prueba del último incremento de versión y se corrigió el nombre del test de reapply por dueño de BD.

Incluye concurrencia de solicitudes CAS, dos valores de baseline, mundos independientes, respuesta
perdida/replay tras avances, namespace en ambos sentidos para las cinco familias y diario drop, rechazo
de DTOs/respuestas hostiles, ranges SQL, ACL/RLS y rollback de transacción. SQL001–013 y reapply013 por
dueño de base, RPCs por service_role. La competencia de llamadas en PGlite serializa un backend local;
no constituye aceptación de contención real entre conexiones/procesos ni lease de servidor.

Una base PGlite file-backed se cierra y reabre sin recrear roles ni reaplicar migraciones: checkpoint y
recibo conservados, retry exacto sin segundo avance. Fixture retenida con ruta en el log. Este caso
acepta persistencia del storage, no reinicio de GameHost. Perfiles, economía, fuentes de botín y sus
plazos permanecen intactos al guardar checkpoints. Afinidad todavía no recibe crédito runtime.

Integración enfocada compartida **28/28** (788,349 ms) en tres archivos de memoria/store/journal;
798 fuentes y 954 archivos Three vigilados pre/post, sin drift. No acepta el conjunto de gameplay naval,
arte/chat/agentes paralelo. Cambios propios limitados a trece archivos; ningún hunk de host/CLI/sim.
Durante la integración se observaron ediciones externas en DESIGN.md, PLAN-DELIVERY.md,
deploy/marea-negra.env.example y docs/HANDOFF.md; se conservaron y quedaron fuera del commit.
[Evidencia y fuentes](d09f-ground-clock-evidence.json).

El primer ensayo de las fixtures pasó 6/16 y falló 10/16: expectativas de DTO inválido vs resultado de conflicto,
reuso de UUID/intención y reapertura que recreaba roles. Se corrigieron antes del freeze; la pasada
posterior 16/16 y la prueba inicial de boundaries 20/20 fueron preparatorias, no se suman a 145/145.
La revisión independiente de runtime/SQL no encontró un fallo bloqueante; la última versión y los
permisos se comprobaron además en ejecución. No se afirma regresión completa de todos los features.

## Estado y siguiente integración

Autor confirmó SQL011/012 aplicadas el 2026-10-08. SQL013 nueva pendiente de aplicar después de 001–012
y verificar mediante canario Supabase. No se consultó ni modificó el servicio real en este corte.
Sin push, deploy, cambio de env/protocolo, reinicio ni activación por defecto.

La política de tiempo offline sigue pendiente de respuesta del autor. Storage no elige fuente/tasa,
checkpoint cadence ni ageing offline, y no restaura World.tick. Sigue definir autoridad/mapeo/epoch
para inputs y predicción, y qué ocurre en una caída entre checkpoints. Luego cargar reloj y componer
recuperación/drain conjunto antes de admitir jugadores; finalmente canario real de muerte/recogida,
restart/reconexión/WAN y plazos. Guardar este checkpoint por sí solo no cierra esa ventana de caída.

Afinidad permanente por personaje/tipo, finalizador durable, leases y transacciones navales P4/P6
siguen abiertos. El [brief de integración](../briefs/m5-ground-clock.md) conserva esos límites.
Unreal/FAB revisado en solo lectura: BP_InventoryComponent.uasset (24878603 bytes) y SM_Potion.uasset
(117402 bytes), ActionRPGMultiplayerStart. No aportan reloj/transacción JS/PostgreSQL; sin cambios/export.
