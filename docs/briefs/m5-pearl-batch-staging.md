# D09f-2b.7 — staging de reemplazo con dos UIDs

2026-10-06. Siguiente corte después de [SQL008 y cola verificadas reales](../delivery/d09f-pearl-batch-journal-live.md).
Implementado en `server/pearlStaging.mjs`; **681/681** pruebas aisladas, **94 nuevas**.
[Resultado y límites](../delivery/d09f-replace-staging.md). Principal:
arquitectura/integración/aceptación; Luna: revisión y pruebas acotadas.
Un escritor por archivo; conservar el trabajo paralelo de sim/LocalServer/host y arte.

## Frontera

`PearlStaging` conserva give y bag→swallowed vacío; el bookkeeping/drain compartidos ahora admiten
ambos UIDs del reemplazo. SQL007/008 y `ProfileSessions.commitPearlBatch` confirman/recuperan el lote.
El método dormant `replace` reserva y aplica los dos UIDs del reemplazo confirmado por el caller.
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

Verificación exacta repetida antes de implementar 2b.7: en
`C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\InventorySystem`,
`Components\BP_InventoryComponent.uasset` (24,878,603 bytes) y
`SaveSystem\BP_JigServerSave.uasset` (580,554 bytes). No ofrecen autoridad Node portable;
se reutilizan los módulos propios existentes, sin cambios en las fuentes Unreal ni exportación.

## Implementación

`replace({ uid, replaceUid, source: { clientId, entity }, expectedVersion, replaceExpectedVersion })`
es una frontera interna del servidor. Los dos números de generación proceden de lecturas gestionadas
del caller autorizado; cola/SQL los contrastan antes de confirmar. No hay ruta de cliente nueva.

El draft llama `swallowPearl`, congela posición/ticks del drop y manda un solo batch replace por la
cola existente. En `drain()` asigna el ID desde el contador vivo, aplica ambos ledgers/perfil/drop/ECS
y publica los dos eventos actuales. El progreso vivo fuera de slots de perlas se conserva; las
comprobaciones posteriores al enqueue de save detectan mutaciones de ledger sin compartir sus clones.
Un fallo local restaura sus escrituras y conserva la reserva cercada, incluso con SQL confirmado.
Recuperar un recibo histórico no vuelve a crear ese drop ni publica otro evento.

## Gates siguientes

Este corte sigue dormant; hooks y restauración del host se integran con dueño exclusivo después.
La muerte completa modifica equipo/oro/mundo además de perlas: revisar esa operación completa antes
de conectar spill durable. Hidratación de mundo, reloj tras reinicio, adopción de UID/invitados y leases
siguen abiertos. No escoger esas políticas ni las curvas/crédito de afinidad como parte del reemplazo.
La afinidad acordada pertenece al personaje/tipo y persiste al perder la perla; requiere su propio corte.
