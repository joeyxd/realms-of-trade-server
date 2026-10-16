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
| `LocalServer.playerCommand`, `devCommand` y debug teleport | [2b.11](m5-pearl-command-access.md) conecta preflight inmediato síncrono antes de helpers; actor/receptor por sesión/entidad, UIDs actuales y guard mundial conservador para mint/RNG/estado compartido. Busy envía feedback privado sin mutación ni acuse de éxito. [2b.18](m5-pearl-managed-request.md) aporta generaciones consultadas bajo la reserva. [2b.19](m5-pearl-release-staging.md) liga la tragada hasta morir, retira nuevos spit/replace y admite give/swallow/leave. Leave desde bolsa usa suelo durable, geometría congelada y apply reversible, conservando elemento/acciones; muerte pierde EXP/bolsa en sim actual, su transacción durable completa sigue pendiente. Dispatch público y demás rutas durables siguen pendientes; producción autónoma sigue en la fila siguiente |
| `world.applyCommand`, `world.stepWorld`, `economy.onAdvance` | [2b.12](m5-pearl-tick-access.md) agrega una barrera conservadora antes del tick/filler real del host: toda la simulación autoritativa espera, antes de dequeue/tiempo/daño/pickup/return/RNG/producción; snapshots/PING continúan con el último ACK aplicado. Falta captura/retención granular para mantener movimiento durante la espera, apply automático y protección de llamadas directas fuera de esas entradas |
| `sendProfile` / perfil privado de snapshot | [2b.10](m5-pearl-profile-io.md) conecta preflight de cuenta/UID del host antes de `syncProfile`, borrar dirty o enviar; busy conserva dirty y programación. Snapshot actual separado: solo tuples ECS de movimiento/combate, sin inventario/UID/blob/recibo, continúa durante la espera |
| `sendSave` / autosave / final disconnect | 2b.10 bloquea antes de sync y conserva `saveAt`/blob hasta aceptación. [2b.14](m5-pearl-profile-snapshot.md) aporta captura canónica opcional del baseline/apply y save reservado separado, con puente trusted del host; falta montarlo automáticamente. Final save bloqueado se retiene en memoria y close falla flush; falta finalizador durable que conserve/resuelva ese progreso |
| Close / death / despawn / detach / cambio de entidad | 2b.10 invalida cuenta/UID antes del detach real del host; respuesta tardía no autoriza apply. Sesiones ya invalidan en close/fail/release. Sim death/despawn y otros cambios de entidad todavía necesitan hooks. Invalidation es sticky incluso con revival en el mismo tick |
| Frontera de tick | [2b.13](m5-pearl-tick-apply.md) aporta `beforeTick` opcional síncrono antes del permiso/pausa, una vez por entrada exterior pump/step/filler. Eventos de apply retenidos hasta tick admitido, sin flush externo de HELLO/disconnect; errores/reentrada sticky. [2b.15](m5-pearl-input-boundary.md) limpia acciones de combate ya recibidas y buffers ECS al confirmar swallow/reemplazo, con rollback y movimiento/ACK conservados. [2b.16](m5-pearl-host-mount.md) permite montaje trusted explícito del host con sus tres adapters; fallo detiene host y teardown espera rollback, close espera IO sin apply. Entry point no lo habilita ni despacha comandos durables; startup/políticas/epoch de extremo a extremo pendientes. Nunca await RPC en sim |
| HELLO / startup | [Arranque común](m5-pearl-startup.md) compone diario y [suelo](m5-pearl-ground-hydration.md) con una sola barrera desde el primer await hasta drain. [2b.17](m5-pearl-host-startup.md) lo monta en el host mediante API trusted con diario/ID/reloj/piloto solo cuentas explícitos y bots cero: economía/recuperación asentadas antes de drain/listener/sim/admisión; fallo/cancelación no aplica ni resume. Invitados/importación rechazados en ese piloto; entrypoint/dispatch completo/políticas definitivas siguen pendientes |

## Contratos que preceden la activación

- [D09f-2b.1](../delivery/d09f-same-holder.md) agrega CAS/recibo/diario para bag→swallowed vacío
  dentro de la familia ground, con 006. [D09f-2b.2](../delivery/d09f-swallow-staging.md) añade staging
  dormant de sus efectos ECS/apply en tick; [D09f-2b.3](../delivery/d09f-common-effect.md) comparte
  la regla ECS con sim. Los hooks completos siguen pendientes.
  003 rechaza from=to. Batch conserva reemplazos históricos, sin nuevas entradas de gameplay desde .19.
- D09f-2b.4/5 aporta SQL007 y DTO/cola/diario SQL008 para muerte pearl-only y reemplazo;
  verificaciones reales 31/31 y 18/18 en 2b.4/6. [D09f-2b.7](m5-pearl-batch-staging.md)
  implementa staging dormant del reemplazo y apply de ambos UIDs/drop/ECS en tick.
  .19 retira nuevas creaciones de reemplazo y conserva la recuperación histórica. La muerte completa
  aún necesita integrar EXP/bolsa/equipo/mundo junto al spill de perlas;
  el lote pearl-only no acredita atomicidad de esos otros efectos.
- Efectos autónomos retenidos deben conservar ganadores, geometría y RNG capturados sin perder recompensas
  ni repetir rolls. El gate no crea esa cola ni elige silenciosamente qué recompensas se descartan.
  2b.12 evita evaluar el tick entero mientras hay reserva; no ofrece esa cola granular. 2b.13 aporta
  la frontera de apply previa al permiso, también durante pausa; 2b.16 configura el adapter mediante
  montaje trusted explícito. Activación/dispatch automáticos siguen pendientes.
- La barrera común de startup impide nuevas lanes desde la recuperación del diario hasta la instalación
  de suelo, incluso cuando la queue ya marca admisión disponible. Hidratación exige cero sesiones,
  tasks y operaciones pendientes después de recuperar el diario. No sustituye los hooks de gameplay,
  no restaura perfiles/efectos históricos. 2b.17 conecta esa barrera al host explícito y el suelo instalado
  entra en sus snapshots ordinarios tras admisión; no habilita la circulación durable ni recupera todo World.
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
