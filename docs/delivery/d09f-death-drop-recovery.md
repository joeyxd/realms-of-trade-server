# D09f-2b.27 — recuperación durable de botín ordinario

Implementado y aceptado localmente sobre 5ddb299. Recogidas y expiraciones usan el diario y la cola
comunes: una respuesta perdida mantiene cuenta/fuente reservadas, y recuperar no vuelve a entregar
el botín ni sobreescribe progreso posterior. [Contrato](../briefs/m5-death-drop-recovery.md).
[Evidencia fija](d09f-death-drop-recovery-evidence.json).

## Implementación

SQL012 extiende la familia drop en mn_pearl_intents. Conserva exactamente las ramas de validación
SQL010, la inmutabilidad/checks de SQL011 y los triggers anteriores. Solo un intent pending con
scope/request exactos admite un recibo nuevo; UUIDs retenidos excluyen familias antiguas por INSERT
 y UPDATE, incluso antes del recibo. Receipt-first puede obtener un intent exacto para su reconciliación.
Lecturas/escrituras permanecen service-only; reapply no reabre estados ni modifica historia.

ProfileSessions.commitDeathDrop toma el DTO concreto sin builder. La cola reserva sin await receptor,
perlas conservadas y fuente (UUID de muerte:ordinal); expiry reserva fuente sin necesitar sesión.
Saves anteriores se asientan y se verifica baseline/versión completa. Un snapshot tardío solo puede
ser el before sin cambios; otro progreso falla sin reescribir SQL confirmado. Capability del caller
mantiene sus tres clases de recursos hasta apply o fence, independiente de liberar lanes de storage.

recoverPearls valida todo el backlog antes de reservar: duplicados de cuenta/UID/UUID/fuente rechazan
el scan completo, incluidas colisiones entre páginas. Startup lee, sin commit automático. Recibo null
permanece pending; resumeDeathDrop envía exactamente una petición original tras null autoritativo.
reconcileDeathDrop solo lee. Recibo visible requiere drop terminal y perfil receptor completos idénticos;
lectura fallida mantiene reservas, progreso avanzado cierra conflicto sin efectos históricos.
Respuesta terminal perdida conserva auditoría committed aunque el contexto local después sea stale.

## Verificación

**1486/1486**, **116 archivos**, Node v24.14.0; sin fallos/canceladas/skipped/todo. **56 nuevas**.
Network 2/2, concurrency 1: 6497.462 ms. Core 1484/1484, concurrency 2: 123915.6215 ms.
Total 130413.0835 ms. **371 fuentes LF SHA-256** estables antes/después (370 del repo y Three privado).
SQL001–012 + reapply012 en PGlite/SDK local. Tres procesos Node reabren base en disco: dos respuestas
pickup perdidas, startup read-only, expiry pendiente, resume exacto y auditoría tras progreso posterior.
No se resucitan los drops terminales ni se pierde el oro adquirido después.

Casos compartidos memoria/SQL: payload detached, reserva inmediata, capability exacta, baseline,
snapshots tardíos unchanged/changed, perlas conservadas bag/swallowed, cierre en prepare, respuestas
prepare/commit/terminal perdidas, current reads unavailable/malformed, progreso avanzado y expiry sin
cuenta. Checks de namespace SQL bidireccionales, delta/scope exactos, permisos y backlog paginado.
Se corrigieron fixtures de UUID y la expectativa del código identity/operation en datos malformados;
ninguno acreditaba un fallo de producción. Revisión independiente de implementación y del principal.

Three 0.160.0: copia privada con 954 archivos verificados. SDK 2.117.2 y PGlite 0.5.8 por versión.
Las otras dependencias son junctions, sin afirmar hash completo. PGlite serializa queries, no prueba
contención de conexiones PostgreSQL independientes. Fuentes fijas usan protocolo 19; el checkout
compartido conserva trabajo ajeno concurrente. Dos comprobaciones focalizadas compartidas pasaron
56/56 (22295.8703 ms y 21825.652 ms), pero sus checks de estabilidad fallaron por ediciones
navales ajenas durante ambas ejecuciones. Los 15 archivos propios permanecieron idénticos a la
aceptación fija. No se acepta una fuente estable del checkout compartido; no se repite ni pausa el
trabajo naval para obtener esa medición. La aceptación completa corresponde a la copia fija y al árbol
del commit propio, no a toda la navegación/arte/chat/recursos concurrentes.

## Continuidad

Aplicar [SQL011](../../server/migrations/011_death_drop_lifecycle.sql) si falta, y después
[SQL012](../../server/migrations/012_death_drop_journal.sql). SQL010 confirmada por el autor;
SQL011/012 sin confirmación ni canario Supabase real de este corte.
No aplica botín al World ni activa pickup/expiry del host. Sigue staging/apply síncrono en tick,
hooks y restauración con reloj estable, ensamblaje del piloto y restart/reconexión/WAN completos.
Afinidad permanente y escalado elemental continúan abiertos. Sin backfill, epoch/offline, leases,
perfil/protocolo/env nuevos, push/deploy ni reinicio del PC. Solo rutas propias, trabajo paralelo conservado.
