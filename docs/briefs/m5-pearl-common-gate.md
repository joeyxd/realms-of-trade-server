# D09f-2 — reserva común e integración de rutas

Dueño M5: módulos de `server/` para autoridad/cola/staging, pruebas y aceptación.
Dueño gameplay D06b/D08: `LocalServer`, sim/economía, cliente/UI, entrypoints y protocolo.
Un escritor por archivo; este brief entrega el contrato concreto para coordinar el siguiente parche.
La base server-only D09f-2a no activa el juego: [resultado](../delivery/d09f-mutation-gate.md).

## Base compartida

`pearlMutationGate(profileSessions)` devuelve una sola autoridad de reservas por instancia de sesiones.
Staging, entradas a sesiones, guardados y commits pearl/ground/batch consultan esa misma puerta.
Un handle opaco autoriza al dueño a entrar a sus propias lanes; no es dato del cliente, RPC ni diario.
Se pueden reservar varios UIDs/cuentas de una vez. El gate no realiza la transacción;
SQL007/008 y la cola batch existente aportan commit/recibo/diario atómicos del lote.

Antes de activar hay que conectar **todas** las rutas del mapa siguiente. Guardar después de mutar no
sirve como preflight: el bloqueo debe ocurrir antes del primer cambio, evento, consumo de RNG o drop.

| Punto actual | Parche que debe aportar el dueño |
|---|---|
| `LocalServer.playerCommand` y `devCommand` | Resolver cuentas por sesión/entidad del servidor y UIDs por inventario/ledger actuales; comprobar/reservar todo el efecto antes del helper. Incluir inventario, misiones, aprendizaje, mercado, comercio, editor y producción, además de pearl. Busy se maneja en la frontera del comando, sin excepción fuera del bucle ni acuse de éxito |
| `world.applyCommand`, `world.stepWorld`, `economy.onAdvance` | Interceptar efectos autónomos en sus helpers: pickup/return, combate/death, rewards, chest/kill mint y producción. Un guard solo alrededor de comandos deja estos bypasses abiertos |
| `sendProfile` / perfil privado de snapshot | `staging.assertPublishable(clientId)` antes de `syncProfile`, borrar dirty o enviar. Si espera, conservar dirty y programación; snapshot de movimiento puede continuar solo con una separación explícita del perfil privado |
| `sendSave` / autosave / final disconnect | Snapshot canónico de perfil vivo por `staging.save`; este difiere el snapshot propio pendiente y conserva progreso. `ProfileSessions.save` ya rechaza bypass directo durante una reserva, pero el adaptador debe manejar busy antes de limpiar `saveAt` o publicar blobs |
| Close / death / despawn / detach / cambio de entidad | Invalidar cuentas y todos sus UIDs antes del cambio. Sesiones ya invalidan en close/fail/release; sim death/detach todavía necesitan hooks. Invalidation es sticky incluso con revival en el mismo tick |
| Frontera de tick | `staging.drain()` síncrono antes de `flushEvents` y snapshots. Nunca await RPC en sim. Apply/fence usa identidades y estado actuales; una finalización Promise solo encola trabajo |
| HELLO / startup | Diario completo recuperado antes de admitir; hidratar autoridad de ledger/suelo antes de `attachPearls`. Entrada a ProfileSessions ya vuelve a comprobar cuentas/UIDs tras lecturas async; eso no restaura un World |

## Contratos que preceden la activación

- [D09f-2b.1](../delivery/d09f-same-holder.md) agrega CAS/recibo/diario para bag→swallowed vacío
  dentro de la familia ground, con 006. [D09f-2b.2](../delivery/d09f-swallow-staging.md) añade staging
  dormant de sus efectos ECS/apply en tick; [D09f-2b.3](../delivery/d09f-common-effect.md) comparte
  la regla ECS con sim. Los hooks completos siguen pendientes.
  003 rechaza from=to. Reemplazo usa la familia batch de dos UIDs.
- D09f-2b.4/5 aporta SQL007 y DTO/cola/diario SQL008 para muerte pearl-only y reemplazo;
  verificaciones reales 31/31 y 18/18 en 2b.4/6. [D09f-2b.7](m5-pearl-batch-staging.md)
  implementa staging dormant del reemplazo y apply de ambos UIDs/drop/ECS en tick.
  La muerte completa aún necesita integrar equipo/oro/mundo junto al spill de perlas;
  el lote pearl-only no acredita atomicidad de esos otros efectos.
- Efectos autónomos retenidos deben conservar ganadores, geometría y RNG capturados sin perder recompensas
  ni repetir rolls. El gate no crea esa cola ni elige silenciosamente qué recompensas se descartan.
- Scope/namespace estables, cuentas/invitados/adopción de raras y mapping del reloj de suelo se resuelven
  explícitamente antes de habilitar restauración. SQL conserva números; no escoge envejecimiento offline.
- Un solo host por mundo hasta leases P5. Movimientos generales barco/puerto/mercado siguen como otros cortes.

## Aceptación del parche integrado

Probar los helpers reales de comandos y efectos autónomos, con gate habilitado y sin habilitar solo give.
RPC y journal lentos, saves anteriores/posteriores, commerce/producción, death→revival, close/recycle,
respuestas perdidas y crash antes/después de apply deben conservar UIDs/oro/progreso sin éxito anticipado.
El jugador sigue recibiendo movimiento/errores legibles; un guard no debe tirar el tick ni perder dirty.
Reinicio real de GameHost reconstruye estado actual sin reaplicar eventos históricos ni grants.

Inventario Unreal/FAB cruzado antes de D09f-2a: `BP_InventoryComponent`, `BP_JigServerSave` y
`MP_WorldContainer` son referencias de inventario/guardado, sin lógica Node/CAS portable; se reutilizan
DTOs/cola/diario/elegibilidad existentes. No nuevos assets ni cambios a fuentes Unreal.
