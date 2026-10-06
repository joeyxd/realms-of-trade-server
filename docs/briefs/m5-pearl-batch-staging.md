# D09f-2b.7 — staging de reemplazo con dos UIDs

2026-10-06. Siguiente corte después de [SQL008 y cola verificadas reales](../delivery/d09f-pearl-batch-journal-live.md).
Implementación pendiente. Principal: arquitectura/integración/aceptación; Luna: revisión y pruebas acotadas.
Un escritor por archivo; conservar el trabajo paralelo de sim/LocalServer/host y arte.

## Frontera

`PearlStaging` hoy aplica give y bag→swallowed vacío; su bookkeeping y drain trabajan con un UID.
SQL007/008 y `ProfileSessions.commitPearlBatch` ya confirman/recuperan el reemplazo atómico. Extender
el coordinador dormant para reservar y aplicar los dos UIDs del reemplazo confirmado por el caller.
Conservar la regla actual de `swallowPearl`: el UID confirmado debe ser exactamente el swallowed
actual, con las comprobaciones de calma, bolsa y propiedad del servidor.

## Contrato del corte

- Fuente de cuentas/entidad/tipo/holder/generaciones desde autoridad conocida. UUID nuevo servidor;
  un actor, entrante de bolsa y saliente tragada. Ambos UIDs se reservan antes de builder/primer await,
  usando el gate común. Compartir bookkeeping con give/swallow; ninguna segunda cola o mapa de autoridad.
- Reutilizar `swallowPearl` en un world/ECS draft separado. Capturar el perfil después, drop del saliente,
  ledger y eventos sin cambiar el world vivo, RNG, drops ni `nextDrop`. Reutilizar búsqueda standable y
  fallback actuales; no inventar posiciones, pérdidas o tiempos. Request SQL congela esa metadata una vez.
- Drenar saves CAS anteriores y construir una vez desde el perfil confirmado, conservando todos los
  campos fuera de `pearls`. Enviar un lote replace a la cola/journal existentes, nunca dos single commits.
- Promises solo encolan completion. `drain()` síncrono es el único apply/publicación: comprobar vida,
  sesión/gate, perfil anterior, ambos ledgers/generaciones y ausencia de bypass en el hueco de apply.
  Preparar todos los cambios y eventos antes de escribir cualquiera.
- El ID del drop local se asigna sin colisión en el apply síncrono; no alterar la posición/times ya
  confirmados. Perfil, ambos ledgers, drop, contador y eventos avanzan juntos. Efecto de swallowed con
  la regla ECS común y estado actual; conservar progreso/movimiento/combate ajenos mientras espera IO.
- Guardado final/eventos una vez; liberar toda la reserva solo después del apply. Fallo tras SQL confirmado
  revierte exclusivamente el apply local y deja fence para recargar autoridad. No revertir SQL ni volver
  a publicar a partir del recibo histórico. Close/death/recycle invalidan incluso si hay revival antes de drain.
- Reconcile/resume de storage no otorga una nueva licencia de apply histórico. Mantener give y swallow
  vacío compatibles; saves/admisión/publicación siguen honrando la misma reserva durante todo el hueco.

## Aceptación

Memoria vinculada y SDK/SQL001–008 aislados: cuatro tipos, orden de bolsa conservado, confirmación
stale, UID/holder/generación indebidos, combate, límites y mapa; saves anteriores/progreso posterior,
reply/journal perdido, solapamiento con cualquiera de los dos UIDs, disconnect/death/recycle, bypass,
fallo en evento/ECS/drop/save y rollback/fence sin medio reemplazo. Ninguna Promise muta World;
recuperación histórica no produce loot ni efecto. Revisar hashes y regresión pertinente, sin `.env`.

Reutilización: diario/cola/gate, drafts/ECS effect y helper de swallow/drop propios. Candidatos ActionRPG
inventory/save verificados en 2b.6 son Blueprints; no exportarlos ni añadir arte para este corte.
Verificar cualquier candidato nuevo por ruta exacta si aparece una necesidad concreta.

## Gates siguientes

Este corte sigue dormant; hooks y restauración del host se integran con dueño exclusivo después.
La muerte completa modifica equipo/oro/mundo además de perlas: revisar esa operación completa antes
de conectar spill durable. Hidratación de mundo, reloj tras reinicio, adopción de UID/invitados y leases
siguen abiertos. No escoger esas políticas ni las curvas/crédito de afinidad como parte del reemplazo.
La afinidad acordada pertenece al personaje/tipo y persiste al perder la perla; requiere su propio corte.
