# D09f — staging de perlas antes de mutar el juego (primer corte aislado)

Base de gameplay `bcd0886`, documentación `68fdcec`, D09e `cfb494b`.
005 aplicada por el autor y verificada en Supabase: [aceptación real](../delivery/d09e-journal-live.md).
D09f-1 implementa el coordinador dormant de una entrega entre cuentas, aceptado sobre `1b5c2fa`:
[contrato y evidencia](../delivery/d09f-pearl-staging.md). No habilita circulación durable en host/juego.
D09f-2a añade la [reserva común de autoridad](../delivery/d09f-mutation-gate.md), con gates en sesiones/
cola/guardados y permiso interno; los [hooks concretos de integración](m5-pearl-common-gate.md) siguen
pendientes con el dueño gameplay. No activa ninguna ruta de circulación.

## Dueños y reutilización

Principal M5: contrato, coordinador server-only, pruebas aisladas y aceptación.
D06b conserva `LocalServer`, sim/economía, cliente/UI, protocolo, versión y entrypoints. Acordar un único
escritor y parche concreto antes de integrar cualquiera de esos archivos; no activar un wrapper parcial.

Inventario existente revisado: `ActionRPGStarterSystem/InventorySystem/SaveSystem/BP_JigServerSave`,
`BP_InventoryComponent` y `MP_WorldContainer` son referencias de organización, no lógica ejecutable
en Node ni evidencia de CAS/idempotencia. `SM_StoragePart_03` ya aporta la caja visual A02; no aporta
autoridad de inventario. Reutilizar DTOs, cola y diario 003–005. Sin nuevos assets ni cambios a Unreal.

## Primera implementación acotada

Preparar y comprobar una **transferencia give de un UID ya gestionado entre dos cuentas**, en fixtures
aisladas con destino vivo/cercano/capacidad suficiente. Empezar fuera del host público, con las reglas de
elegibilidad extraídas o compartidas con `transferPearl`; evitar dos implementaciones que puedan divergir.
No requiere decidir adopción de raras, invitados, envejecimiento offline ni pérdidas navales.

1. El comando se valida contra la autoridad actual y reserva cuentas/UID antes del primer await. No cambiar
   perfiles, ledger, stats, dirty flags, drops, RNG, eventos ni respuestas de éxito al preparar.
2. Capturar el plan inmutable y el UUID una vez. `ProfileSessions.commitPearlGround` construye los snapshots
   CAS tras drenar guardados previos; ground=null para destino en cuenta. No aceptar holders/precios del cliente.
3. Esperar confirmación y cierre del diario fuera del tick; llevar la finalización a una cola cuyo apply ocurra
   en un límite de tick definido antes de `flushEvents`/snapshots. Una tarea Promise no debe mutar la sim directamente.
4. La reserva de gameplay permanece hasta aplicar o cercar el resultado, incluso si la cola de storage ya
   liberó sus lanes. Mientras espera, cualquier otra ruta que cambie ese UID/perfil debe pasar por la misma
   reserva; progreso ajeno permitido solo si puede rebasarse sobre el resultado confirmado.
5. Aplicar una vez a las entidades aún válidas, con perfiles actuales y delta confirmado; publicar eventos/ack
   después. Si cambia la identidad de conexión, ocurre death/close o el apply falla tras commit, cercar y
   recargar autoridad; no revertir SQL ni publicar un resultado histórico a una entidad reciclada.
6. Crash entre commit y apply: startup recupera el diario y reconstruye estado desde perfiles/ledger/ubicación
   actuales. Un recibo antiguo por sí solo no autoriza otra aplicación ni otro crédito.

API del primer corte: `PearlStaging.give` reserva plan → commit async → finalización pendiente;
`drain()` aplica síncronamente en tick o cerca. `assertAvailable` guarda rutas de mutación,
`save` difiere snapshots y `invalidate` conserva transiciones de lifecycle. Reutiliza `transferPearl`
sin editarlo sobre perfiles/ledger/dirty/eventos separados; no duplica elegibilidad. El coordinador
probado en aislamiento es un avance de integración; habilitarlo exige cubrir todas las rutas siguientes,
restauración y políticas pendientes. D06b conserva archivos compartidos y no recibió parche de activación.

## Mapa que debe cubrir la integración completa

| Ruta actual | Riesgo y contrato requerido |
|---|---|
| `LocalServer.playerCommand`, case pearl | Antes de llamar helpers síncronos; hoy mutan y emiten al recibir comando |
| `transferPearl`, `leavePearl`, `spitPearl` | UID y cuentas, ubicación exacta; mantener cercado hasta apply |
| `swallowPearl` | Bag→swallowed vacío: CAS 006, staging dormant D09f-2b.2 y efecto común D09f-2b.3 listos; conectar hooks. Reemplazo expulsa otro UID y exige lote pendiente |
| `spillPearls` vía `world.onDeath` | Puede quitar varios UIDs del mismo perfil; 003/004 son de un UID y conservan los demás. Diseñar lote atómico antes de tratarlo como una sola operación durable |
| `pickPearl` vía `inventory.pickDrop`/`stepDrops` | Una reserva determina ganador; no borrar drop ni otorgar UID antes de commit |
| `rollPearl`/`dropPearl`, kill/chest/dev mint | UID nuevo y valores RNG exactos; no recomputar destino al reintentar |
| `returnPearl` y `sellPearl` | Destino costero/RNG, oro y ubicación. La venta actual crea drop y retorno en memoria; el plan durable conserva el destino final |
| `attachPearls`/claim al entrar | Cargar y validar autoridad durable antes de reclamar memoria; resolver invitados/adopción sin aceptar blobs viejos |
| `sendProfile`/`sendSave`, close, comercio/editor/producción | Snapshots y cambios de oro/perfil comparten lane. onSave ocurre después del efecto y no puede ser el gate de un comando durable |

`dropPearl` usa ticks para pickAt/t y `returnPearl` consume lootRng. SQL conserva availableAt/returnAt
enteros sin escoger reloj; no convertirlos silenciosamente en epoch ms. Definir mapping/restauración
antes de activar suelo persistente. La restauración de economía no demuestra restauración de estos drops.

## Aceptación y límite de activación

- Comando lento: cero efectos antes del commit; apply/evento una vez en frontera de tick, sin await en sim.
- Dos comandos por UID/cuenta, save/comercio/death/close mientras espera: reserva común y progreso correcto.
- Respuesta perdida, terminal write perdido, reinicio antes/después del commit y antes/después del apply:
  request/UUID exactos, estado actual, ningún UID/oro duplicado ni evento de éxito anticipado.
- Reutilizar fixtures Supabase solo si una prueba local no cubre la duda; no tocar jugadores existentes.
- Antes de inyectar diario en host: startup con recover, hidratación de ledger/suelo, scopes/UIDs estables,
  política de cuentas/invitados/adopción, mapping de reloj y todas las rutas de mutación bajo el gate.
- Mantener una autoridad por world ID. Leases P5, legendarias/cartel, pérdidas navales y transacciones
  generales de mercado/barco/perfil son cortes distintos y siguen pendientes.
