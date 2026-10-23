# D09f-2b.9 — arranque común de diario y suelo

2026-10-06. Continúa la reconstrucción aceptada en `83b77fa`. Dueño M5: gate, coordinador server-only,
adaptador de suelo, pruebas y aceptación. Host, LocalServer, sim, protocolo y visuales conservan sus dueños.

## Contrato

`PearlStartup({sessions,world,worldId,mapClock,pageSize,maxRows})` compone la recuperación existente
del diario y `PearlGroundHydration`. Exige diario configurado con scope idéntico al mundo y mapper
síncrono explícito y puro, sin efectos por closures sobre World. No selecciona envejecimiento offline,
adopción de invitados ni relojes por defecto.

`start()` captura tick/maps/contador y obtiene una barrera global antes del primer await. La fase de
recuperación admite únicamente la reconciliación existente de recibos; ninguna operación sin recibo
se reanuda automáticamente. El diario puede cerrar sus auditorías terminales, pero no hay dispatch de
gameplay, escritura de World, RNG, mint ni efectos históricos.

El gate permite iniciar recuperación antes de `pearls.admitting`, con autoridad local vacía.
Después exige queue recuperada, cero sesiones/tasks/UIDs/cuentas/operaciones sin resolver y transfiere
el mismo handle opaco a hidratación sin liberarlo. Aunque la queue ya marque `admitting=true`, la
barrera sigue cerrando todas las lanes, incluidas las desconocidas. No se altera la semántica de queue.

Estados: `idle → recovering → loading → prepared → ready`. `start()` concurrente comparte su Promise.
La preparación asíncrona conserva World; solo `drain()` síncrono instala ledger/drop y cambia a ready.
Drain exitoso repetido conserva el mismo resultado. El caller debe mantener sim/listener detenidos y
comprobar `startup.ready` antes de admitir, publicar o arrancar la simulación. La captura verifica
tick/maps/contador; no detecta toda escritura arbitraria a otros campos de World por un caller ajeno.

Intención pendiente, error de IO, cambio de World, colisión o rollback local dejan startup `fenced`
y la barrera retenida. Las reservas y requests pendientes permanecen exactos para resolución explícita
por una autoridad reconstruida; no se borran ni se intenta avanzar alrededor de ellos.
`cancel()` antes de apply cerca inmediatamente; IO ya iniciado puede terminar/reconciliar el diario,
pero no inicia hidratación posterior ni aplica World. La cancelación de un runtime ya listo pertenece
al cierre del host; este coordinador rechaza cancel después de apply y no revierte gameplay posterior.

## Reutilización comprobada

Inventario Unreal/FAB cruzado y archivos concretos verificados sin modificación:
`C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\InventorySystem\SaveSystem\BP_JigServerSave.uasset`
(580.554 B) y `Components\BP_InventoryComponent.uasset` (24.878.603 B). Son referencias Blueprint;
no aportan autoridad Node/CAS ni recuperación de nuestros recibos. Reutilizar ProfileSessions/PearlQueue,
diario SQL008, gate e hidratación existentes. No importar assets ni recrear arte en este corte.

## Aceptación y límites

Contrato común en memoria y SDK contra SQL001–008 local: diario lento, transición sin hueco de admisión,
recibo confirmado y estado posterior, request sin recibo preservado, cancelación en cada espera,
World cambiado, instalación síncrona/idempotente y conservación de perfil/progreso/eventos/RNG.
Probar capabilities falsos/ajenos/stale y exclusión de autoridades/recursos ya activos.
Regresión de queue/gate/staging/hidratación sobre archivo Git aislado y hashes comprobados.

No activar parcialmente GameHost ni reiniciar/publicar servicio. Sin SQL/env nueva. Sigue la integración
del host con reloj/scope/adopción explícitos y hooks completos de comandos, efectos autónomos,
publicación/guardados/lifecycle/tick. Muerte completa necesita equipo/oro/mundo; afinidad permanente
por personaje/tipo continúa como corte propio. Una autoridad por mundo hasta leases.
