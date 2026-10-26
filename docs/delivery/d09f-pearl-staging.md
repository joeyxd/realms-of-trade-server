# D09f-1 — entrega de perla preparada antes de mutar

Aceptación 2026-10-05, base `1b5c2fa` más dos archivos propios. D09e/005 ya verificados:
[evidencia real anterior](d09e-journal-live.md). Este corte acepta un coordinador **dormant y aislado**,
no una activación del juego ni la integración completa de D09f. [Evidencia](d09f-staging-evidence.json).

## Resultado y contrato

`server/pearlStaging.mjs` prepara una entrega give de un UID ya gestionado entre dos cuentas.
Reutiliza `transferPearl` sin editarlo: ejecuta sus reglas sobre clones de ambos perfiles, ledger/dirty
separados y eventos capturados; ECS se lee. Así conserva combate/calma/distancia/capacidad/bag sin otra
implementación de elegibilidad. No cambia perfiles vivos, drops, RNG, stats, dirty flags ni eventos al preparar.

- `new PearlStaging(sessions, world, scope, {limit:64})`: scope coincide con diario, límite 1–256 contexts.
- `give({uid,source:{clientId,entity},target:{clientId,entity},expectedVersion})`: solo adaptador autoritativo;
  holder/kind salen de cuentas/perfiles, UUID se crea en servidor. Requiere UID conocido/generación >0,
  ledger local en origen, cuentas distintas y perfiles canónicos. Devuelve handle sin ack de éxito.
- Reserva cuentas/UID antes del primer await. Snapshot previo drena por ProfileSessions; builder aplica
  delta congelado a CAS tras guardados anteriores, sin volver a tirar RNG ni reevaluar distancia/calma.
  `commitPearlGround` con ground=null confirma perfiles/ledger/tombstone/recibo y cierre del diario.
- Completion Promise solo encola finalización. `drain()` es síncrono y debe ejecutarse en frontera de tick
  antes de `flushEvents`/snapshots; nunca esperar RPC dentro de sim. Reserva de gameplay permanece incluso
  después de liberar PearlQueue. Dos operaciones disjuntas pueden progresar por separado.
- `assertAvailable({accounts,uids})` debe anteceder a todas las rutas que alteren sus perfiles/UIDs.
  `save(clientId,raw)` valida snapshot contra el perfil vivo y difiere su escritura. Al aplicar toma progreso
  vivo más reciente, incluso posterior al último autosave, y cambia solo `pearls`.
- `invalidate(account)` es sticky y debe preceder a death/close/despawn; detecta death→revival entre drains.
  Identidad de sesión/perfil y ECS.clientId, vida, pearl baseline, ledger y versión de recibo deben seguir válidos.
  Guardado directo pendiente/en vuelo o versión avanzada es bypass: bloquea apply sin éxito.
- Valida ambas escrituras y prepara eventos en buffer antes de tocar estado vivo. Aplica delta, ledger,
  dirty y dos eventos una vez. Saves de ambos se encolan síncronamente; si el segundo falla, fence elimina
  pendientes y marca failed antes de que el microtask del primero pueda escribir.
- Error de storage, respuesta/journal ambigua, lifecycle, autoridad cambiada o apply fallido cerca cuentas/UID
  para recarga de autoridad. No liberar automáticamente, revertir SQL ni convertir reconcile en apply tardío.
  Fallo local intenta restaurar su delta/eventos tentativos; un contenedor roto sigue cercado aunque el undo falle.

## Aceptación

**38/38** nuevas en checkout y **184/184** pertinentes sobre archivo de Git `1b5c2fa` más coordinador/test,
16 archivos, `--test-concurrency=2`, dependencias locales mediante junction. No acepta cambios D06b activos.
Hashes LF normalizados, comando/archivos/counts en JSON durable; log completo en `shots/review` ignorado.
Sintaxis y `git diff --check` comprobados. Revisión GPT-6 Luna de solo lectura; principal verificó conclusiones.

Pruebas cubren RPC/cierre de diario lentos, reserva después de storage y apply único, reglas existentes,
identidad/config inválidas, guardados previos/progreso posterior, comandos disjuntos/límite, muerte/close/
recycle/client rebound/bypass y sticky invalidate. Incluyen reply perdido con request idéntico, recibo/terminal
desconocidos sin apply por reconcile, fallos event/apply/save/contenedor y segundo enqueue real sin escritura.
Reinicio tras commit antes de apply reconstruye perfiles/ledger actuales usando **nuevas sesiones sobre memoria**,
sin otro envío, oro ni evento histórico. No representa reinicio de GameHost o proceso Node en este corte.

## Reutilización, límites y siguiente exacto

Inventario concreto Unreal/FAB revisado con Luna: `BP_JigServerSave`, `BP_InventoryComponent` y
`MP_WorldContainer` en InventorySystem son referencias de organización; sin ejecución Node ni contrato CAS/
idempotencia portable. `SM_StoragePart_03`/A02 solo aporta caja visual. Reutilizados reglas de give/DTO/cola/
diario existentes; ningún asset nuevo ni modificación de `C:\Unreal`.

No cambió SQL/env ni consultó Supabase live de nuevo. No arrancó/reinició/publicó host, no tocó LocalServer,
sim/economía, UI, versión/protocolo ni trabajo D06b. El módulo solo lo importa su test. Rutas actuales de
juego siguen sin este gate; **no activar solo give**. El caso de snapshot directo detecta y cerca bypass,
no puede deshacer una escritura que otro camino ya despachó. El callback de eventos se apoya en `World.emit`
actual (solo ECS/eventos), y el enqueue en `ProfileSessions.save` actual (síncrono, write por microtask).

**D09f-2:** acordar un solo escritor y parche concreto para puerta común de comandos/snapshots/lifecycle
con el dueño D06b. Antes de activación, diseñar CAS para same-holder bag/swallowed y lote de varios UIDs
en death/reemplazo; cubrir mint/pick/return/joins/dev, startup/recover/hidratación, reloj de suelo y política
de cuentas/invitados/adopción. Leases P5, legendarias/cartel, pérdidas navales y transacciones generales
mercado/barco/perfil continúan como cortes distintos. P4/P6 siguen parciales.
