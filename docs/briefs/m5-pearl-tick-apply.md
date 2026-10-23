# D09f-2b.13 — apply síncrono antes de la reserva del tick

## Contrato implementado

`LocalServer.beforeTick()` es un adaptador trusted opcional de boolean síncrono. Ejecuta únicamente
trabajo de apply que ya terminó su IO: no inicia RPC, reanuda requests ni espera Promises. El caller
traduce los outcomes de `PearlStaging.drain()` o la readiness de `PearlStartup.drain()`; pasar el array
o el objeto directamente falla por contrato. `true` permite consultar `tickAccess`, no sustituye
sus reservas. `false` espera esta vuelta sin dequeue/ACK/filler/tiempo de simulación y descarta `acc`.

Se ejecuta una vez por entrada exterior a `pump`, `step` o `applyFiller`, antes de consultar permiso.
`pump` lo ejecuta incluso durante pausa y sin tiempo acumulado suficiente para un tick. Sus ticks
de catch-up vuelven a consultar el permiso puro, pero no drenan de nuevo; el filler interno es
privado y no abre otra frontera dentro de un tick admitido. Ningún resultado async cambia ECS.

La simulación permanece síncrona: no llegan nuevos resultados de IO dentro de ese pump. La autoridad
no inicia ni cambia reservas desde callbacks de un tick admitido. Inputs previos al apply conservan
la política actual: se ejecutan con el estado vigente después; epoch/rebase sigue pendiente.

## Fallos y publicación

Un throw, Promise/thenable, resultado no booleano o reentrada de pump/step/filler cierra permanentemente
la frontera de tick y sus eventos para esta instancia. El error inicial se propaga; los siguientes
intentos esperan sin volver a ejecutar el adaptador, simular ni producir heartbeats del pump. Un
rechazo accidental de Promise se consume. Capturar una reentrada desde `beforeTick` o `tickAccess`
no vuelve a autorizar el tick. El rechazo puro habitual de `tickAccess` sigue siendo temporal.

No hay rollback genérico de un callback trusted arbitrario. Si falla después de escribir o desde un
helper ya admitido, sus cambios previos pueden permanecer y el comando ya retirado no se reinserta;
se detiene el avance/publicación posterior. Su dueño debe conservar el fence, reconciliar y reemplazar
la autoridad. El gate y el rollback propio de PearlStaging siguen siendo necesarios.

Un drain correcto conserva sus eventos en `world.events` y dirty mientras una pausa u otra lane
impide el tick. Cuando se admite, el flujo normal emite eventos una vez antes del snapshot de ese
tick y programa saves como antes. No se añade publicación especial durante pausa. Desde que un
adaptador configura/usa la frontera, `flushEvents` externo (incluidos HELLO/disconnect) conserva
los eventos para el tick admitido; retirar el hook después no elimina esta propiedad. Sin hook,
el Worker y el lifecycle previo conservan su publicación habitual.

La espera temporal puede seguir enviando snapshots públicos actuales con ACK anterior. Estos pueden
reflejar ECS ya aplicado cuando otra lane sigue bloqueada; no son el evento privado de éxito ni el
inventario durable. La publicación directa de PROFILE/SAVE, SPAWN/WELCOME y las mutaciones de lifecycle
conservan sus contratos propios. Esta frontera no establece aislamiento completo de admisión.

`storage.tickBlocked` ahora se actualiza en la preflight del pump incluso si todos están pausados;
es disponibilidad del último chequeo, no progreso de simulación, readiness de startup ni health.

## Integración y aceptación

GameHost conserva `beforeTick=null`: no construye automáticamente staging/startup, no configura
diario ni despacha comandos durables. Los tests inyectan adapters trusted sobre el host real y sobre
un startup real de memoria con clock mapper explícito. `prepared` no permite simular; el drain ready
instala suelo una vez antes de la primera simulación. No convierte esa fixture en una política
general de scope/reloj/adopción para el host.

Cubrir recibo lento→apply durante pausa sin tick/ACK/tiempo, otro UID que mantiene bloqueo, eventos
retenidos ante HELLO/disconnect, fillers/catch-up sin segundo drain, false temporal, errores sticky,
reentrada capturada, fence de staging y startup prepared→ready. Regresión desde `9846df4` con dos
overlays propios; incluir el puente naval ya commiteado y excluir ediciones paralelas del worktree.

No cambia SQL/env/perfil/snapshot/you/EVENT ni PROTOCOL_VERSION 16. No activa circulación durable,
afinidad permanente, captura granular de efectos, muerte completa o finalizador durable.

Inventario Unreal/FAB cruzado y candidatos re-verificados de solo lectura: BP_JigServerSave
(580.554 B) y BP_InventoryComponent (24.878.603 B). Blueprints de referencia, sin lógica Node/CAS
portable. Se reutilizan drain/gate/tick/eventos del repo; no se importan ni modifican fuentes Unreal.

[Mapa común](m5-pearl-common-gate.md), [frontera anterior](m5-pearl-tick-access.md),
[entrega y evidencia](../delivery/d09f-pearl-tick-apply.md).
