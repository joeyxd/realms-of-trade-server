# D09f-2a — reserva común de autoridad, sin activación del juego

Base `0e82162`, 2026-10-05. Amplía [D09f-1](d09f-pearl-staging.md) en módulos server-only.
[Mapa concreto del siguiente parche](../briefs/m5-pearl-common-gate.md).
No requiere SQL ni env nuevos. Aceptación aislada en [evidencia](d09f-gate-evidence.json).

## Resultado

`server/pearlMutationGate.mjs` tiene una sola instancia por `ProfileSessions` mediante WeakMap.
Mapas privados y handles opacos congelados reservan todo el conjunto de cuentas/UIDs antes de awaits.
Valida cuentas UUID canónicas, UIDs ASCII, listas completas (incluye holes), duplicados, conflictos y
capacidad antes de instalar ninguna lane. Un handle copiado, de otra autoridad o liberado no autoriza nada.

- `assertAvailable({accounts,uids})`: comprueba reservas de gameplay, recuperación/lanes de PearlQueue y
  sesiones closed/failed/pearlBusy. Los saves ordinarios anteriores se drenan por la cola, como antes.
- `reserve({accounts,uids})` → handle; `active(handle)`; `release(handle)` solo tras éxito del dueño.
  Hasta 256 entradas por lista y 256 reservas retenidas por autoridad. Invalid/fenced consumen capacidad.
  Staging conserva su límite adicional (64 por defecto, 1–256 configurable).
- `invalidate({accounts,uids})` invalida la operación entera; `fence(handle)` retiene todas sus lanes.
  No hay reset/unfence ni liberación automática por reconcile. Recargar autoridad es otro procedimiento.
- `assertStorageAvailable(resources,handle)` admite solo el permiso vivo del conjunto exacto.
  `PearlQueue.commit` lo comprueba antes de reservar storage; sin permiso, ambos commits de sesiones
  rechazan una reserva de gameplay. Así la coordinación cubre ambos sentidos, no solo lectura de la cola.
- `assertStorageAuthorized` vuelve a comprobar la autorización tras awaits previos al primer envío.
  Invalidar durante prepare impide dispatch y cierra rejected el mismo intent si el cierre se confirma.
  Resume explícito comprueba antes/después de reprepare; read-only reconcile puede seguir resolviendo el
  recibo, sin liberar gameplay, aplicar tarde ni mandar otra mutación por una reserva inválida.
- `assertSnapshotAvailable` protege cuenta y todos los UIDs del snapshot. `ProfileSessions.save` rechaza
  bypass directo antes de pending/write; solo saves internos baseline/apply llevan permiso del dueño.
  Snapshots ordinarios durante una operación storage-only conservan el rebase previo de progreso/oro.
- `ProfileSessions.open` comprueba cuentas/UIDs antes y después de cargar; una reserva que aparece durante
  la lectura bloquea entrada. Close/fail/release invalidan antes de quitar identidad o llamar callbacks.
- `PearlStaging` usa este gate; dos coordinadores comparten sus lanes. `save` sigue difiriendo su snapshot
  pendiente; `assertPublishable(clientId)` impide publicar el perfil viejo entre commit y tick apply.
  Rechecks tras decorar eventos y encolar saves cubren invalidation reentrante antes del éxito.

Firmas internas ampliadas, compatibles con callers anteriores:

```js
sessions.commitPearl(meta, build, reservation = null)
sessions.commitPearlGround(meta, build, reservation = null)
sessions.save(clientId, profile, reservation = null)
```

El token queda dentro del proceso. DTO/RPC/diario, SQL 003–005 y protocolo no cambian.
El gate no ejecuta callbacks, cancela Promises/RPC en vuelo, revierte SQL ni fabrica una transacción de lote.

## Evidencia

Pruebas enfocadas: **80/80**; aceptación de regresión pertinente: **226/226**, incluidas **42 nuevas**.
Seis archivos propios sobre Git archive de `0e82162`, 17 archivos de tests, concurrencia 2, sin copiar env.
Las pruebas cubren toda la base store/SQL/SDK/host, familias 003/004, sesiones/diario y reglas de perlas,
además de singleton/capabilities, reserva de conjuntos/capacidad, recuperadas sin sesiones, ambas familias
sin bypass, snapshot por cuenta/UID, open async y close, aplicación/publicación y fallos de lifecycle.
El caso anterior de save directo que llegaba a escribir ahora verifica rechazo **antes del dispatch**,
seguido de apply legítimo. Dos enqueues reales conservan el microtask fence anterior.
Sintaxis de los seis archivos y `git diff --check` comprobados. Los módulos nuevos solo se ejercitan en
fixtures; los tests de host restauran su instancia local aislada, sin reiniciar el host del autor.

Hashes LF normalizados/comando/counts en el JSON; logs completos ignorados en `shots/review`.
Revisión GPT-6 Luna de solo lectura, conclusiones verificadas por principal. Sin pruebas externas nuevas.

## Reutilización y alcance pendiente

Revisados candidatos concretos en `CANDIDATES.csv` y `actionrpg/FINDINGS.md`: `BP_InventoryComponent`,
`BP_JigServerSave`, `MP_WorldContainer`. Ayudan como referencia de flujo; Blueprints no ejecutables en
Node y nombres server/save no prueban atomicidad/anti-duplicado. Reutilizados sesiones/DTO/cola/diario y
`transferPearl` existentes; no nuevos assets, no modificación de Unreal.

Host/LocalServer/sim no importan staging ni reciben hooks de esta entrega. Sus rutas de gameplay todavía
no reservan ni bloquean publicación: **no activar give aisladamente**. No inicio/reinicio/publicación del
host, Supabase live ni aceptación visual D06b/D08. No cambia trabajo del otro dueño ni versión/protocolo.
Los guardados ya despachados y llamadas directas al store quedan fuera de esta puerta; no se deshacen.

**Siguiente D09f-2b:** un solo escritor para el parche de hooks del brief, CAS same-holder y lote death/
reemplazo, restauración/hidratación de World, scope/reloj/adopción/invitados. Reservar varios UIDs no
convierte 003/004/005 en un lote atómico. P4/P6 siguen parciales; leases y movimientos navales aparte.
