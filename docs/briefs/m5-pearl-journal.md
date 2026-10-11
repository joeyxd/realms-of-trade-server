# D09e — diario de solicitudes y recuperación tras restart

Base `c6bc368`. Principal: arquitectura, `server/pearlJournal.mjs`, cola/sesiones y aceptación.
Luna: migración 005 y pruebas SQL nuevas; revisión acotada. D06 conserva cliente/sim/protocolo/UI,
entrypoints y host. No modificar `.env`, arrancar host, publicar ni activar circulación gestionada.

## Reutilización

Se revisaron SUMMARY, CANDIDATES.csv y PORTABILITY del inventario Unreal/FAB existente.
`ActionRPGStarterSystem/InventorySystem/SaveSystem/BP_JigServerSave` es referencia de flujo;
no hay evidencia de un diario de UUID/request CAS portable a Node/Postgres. `SM_StoragePart_03`
es apariencia de almacenamiento. Reutilizar DTOs y recibos 003/004, no importar Blueprints ni arte.

## Contrato

Diario opcional, server-only, por `scope` estable (mundo). Adaptadores memoria y Supabase separados
del store existente. Cada fila exacta: `{operationId,scope,family,request,state}`, family pearl/ground,
request canónico sin operationId, state pending/committed/conflict/rejected. Ground exige world=scope.
`prepare(family,concrete)` escribe antes del primer commit; mismo UUID/payload es idempotente,
cambio de scope/familia/request se rechaza. `resolve(family,concrete,state)` verifica identidad completa
y conserva resultados terminales, nunca sustituye otra solicitud ni reabre un terminal.
`list({afterId,limit})` solo pendientes del scope, cursor UUID exclusivo/orden ascendente, límite 1–256.

`ProfileSessions(store,onFailure,{journal})` comienza sin admisión hasta `recoverPearls()`.
Escanear/validar todo el backlog antes de reservar o reconciliar; duplicidad de UID/cuenta/UUID
en pendientes aborta admisión. Reservas compartidas de cuenta/UID/UUID sobreviven por recarga del diario.
Startup y reconcile leen recibo de su familia y perfiles/ledger/ubicación actual. Exacto: committed;
estado posterior: conflict sin publicar recibo viejo; ausente/malformado/lectura fallida: pending.
No ejecutar builder tras restart ni guardar snapshots de la instancia perdida.

`resumePearl`/`resumePearlGround` permiten reanudar explícitamente pendientes sin recibo con un solo
envío del request/UUID persistido; preparar de nuevo de forma idempotente antes de ese envío si una
respuesta de prepare se perdió. Primero buscar recibo: si existe, solo comparar estado actual.
No fabricar UUID, cambiar payload ni reenviar un recibo conocido. Fallo de resolve retiene reservas;
reconcile reintenta la escritura terminal exacta sin repetir la mutación. Flush falla con pendientes.

El diario es recuperación de una autoridad, no lease ni exclusión global entre hosts. Las operaciones
de juego actuales siguen sin staging previo a mutación/ack; integración del host es otro corte coordinado.
005 queda pendiente de aplicar y verificar en el proyecto real; aceptación local con PGlite/SDK.

## Aceptación

- Reinicio antes/después del commit, respuesta de prepare/resolve perdida, RPC/reads ambiguos.
- Reanudación concreta sin builder, crédito una vez, estado avanzado no publicado, cuenta bloqueada.
- Backlog paginado completo antes de admitir; corrupción/solapamientos no se silencian.
- Memoria/SQL/SDK con mismo contrato; RLS y RPCs service-only, migración reaplicable.
- Regresión M5 sobre árbol confirmado aislado de D06; preservar archivos ajenos y no reiniciar host.
