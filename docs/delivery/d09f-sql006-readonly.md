# SQL 006 aplicada — comprobación de validadores, 2026-10-06

El autor confirma que ejecutó `006_pearl_same_holder.sql` en Supabase. Se consultaron exclusivamente
las funciones IMMUTABLE `mn_valid_pearl_intent` y `mn_valid_pearl_swallow` con JSON sintético;
sin lecturas de tablas/jugadores ni escrituras de perfiles, ledger, recibos, diario o estado de juego.

**6/6 comprobaciones reales:** ground acepta from=to con un endpoint; familia 003 sigue rechazándolo;
swallow exacto es válido; editar progreso en ese delta se rechaza; ambas funciones deniegan al cliente
público con 42501. [Evidencia estructurada](d09f-sql006-readonly-evidence.json).

Esta comprobación demuestra las reglas/privilegios de esos validadores en el proyecto configurado.
No verifica el commit SQL nuevo con perfiles reales/canario, concurrencia PostgreSQL, restart de
GameHost ni circulación durable integrada. El host/LocalServer todavía usa los helpers actuales;
`PearlStaging`/diario no están conectados. Las 356/356 pruebas de almacenamiento/staging anteriores
siguen siendo evidencia local aislada, no una aceptación live de gameplay.

La [afinidad por personaje/tipo](../briefs/m48-pearl-affinity.md) está confirmada como requisito:
aprendizaje conservado tras perder/recuperar la perla. Su campo/progresión/escalado/UI siguen pendientes.
006 no añade ese sistema. No se reinició ni publicó el host; trabajo naval concurrente intacto.

Aceptación posterior del mismo día: [commit/recuperación real, 21/21](d09f-same-holder-live.md), con
fixtures sintéticas limpiadas y dos auditorías terminales retenidas. Amplía esta comprobación;
integración del host/juego y afinidad siguen pendientes.
