# D09f-2b.20 — captura completa de muerte antes de persistir

Base `5b6fd1c`. Sigue la [regla de perla ligada hasta morir](m5-pearl-release-staging.md).
El lote SQL007/008 conserva exclusivamente el delta de perlas; EXP, bolsa, equipo/pociones y suelo
ordinario necesitan una operación completa diferente. No ampliar silenciosamente ese recibo histórico.

## Resultado de este corte

`captureDeathPlan(world, entity, {seq, by})` produce datos congelados, síncronos y separados de la
autoridad. Se invoca con un jugador vivo, después de resolver un golpe mortal y antes de ejecutar
la muerte; no decide daño, elegibilidad de ataques ni identidad de cuenta de un cliente.

Reutiliza `killPlayer`, `spillPearls`, `spillOnDeath`, `syncProfile` y las reglas ECS existentes. Captura:

- Perfil canónico anterior y posterior de la víctima, con EXP actual del ECS, bolsa/perlas vacías,
  pérdidas adicionales de Cala y contador de muertes. Nivel, oro, maestría, tatuajes y economía conservados.
- Delta de PK del atacante en Cala, si existe su perfil, con progreso ECS actual. Fuera de Cala no
  fabrica un cambio del atacante; ninguna fila ECS ajena se escribe.
- Fila numérica ECS anterior/posterior, botín ordinario y perlas, ledger local y eventos reales.
- Tick, causa y reglas capturadas. La pérdida de EXP de 10 % sigue siendo provisional y ajustable.

La captura rechaza selectores con getters/campos desconocidos, actores inválidos, perfiles/ECS corruptos,
propiedad local contradictoria y UIDs huérfanos del titular. El helper de muerte ahora también rechaza
una segunda ejecución sobre un jugador ya muerto o retirado; el pipeline normal mantiene su comportamiento.

Los drops usan ordinales temporales desde 1; no consumen IDs globales ni chocan con drops ajenos.
El RNG de botín se bifurca desde su estado actual: la geometría queda congelada sin consumir el RNG vivo.
Los estados anterior/posterior del RNG son evidencia de la preparación, no permiso para rebobinarlo
durante un apply posterior. La política de reserva/avance de RNG del coordinador sigue pendiente.

Solo se consultan las funciones de lectura de mapa/cubierta del mundo trusted. No se invocan callbacks
personalizados de muerte/publicación; los eventos se decoran con el método real de `World` sobre el draft.
El resultado no contiene funciones, mapas, promesas ni referencias mutables del mundo. No incluye un
UUID/versión CAS suministrado por cliente, y no constituye una autorización para guardar o aplicar.

## Integración siguiente

Una reserva común debe cubrir víctima, atacante afectado y todos los UIDs antes del primer await.
La nueva operación durable debe confirmar juntos los perfiles CAS, propiedad/suelo de perlas, suelo
de objetos/pociones y un recibo idempotente, incluso con cero perlas. Identidad persistente propuesta
para cada drop: UUID de operación más ordinal; requiere validación, recuperación y consumo atómico.

Luego `drain()` aplicará exclusivamente el efecto confirmado, asignando IDs locales y publicando una
sola vez. Muerte/reaparición/cierre necesitan una barrera propia: `PearlStaging.current()` rechaza dead y
no puede usarse sin adaptar ese ciclo. Tras reinicio, hidratar estado actual sin repetir EXP, PK o eventos
históricos. Fallo local después de commit conserva fence; nunca revierte el resultado durable.

Este corte no añade SQL, storage, cola, journal, hooks, apply ni activación del host. No garantiza todavía
atomicidad o suelo tras crash. Afinidad nueva, mundo naval, finalizador, políticas/epoch/leases permanecen abiertos.

## Reutilización Unreal/FAB

Revisados el inventario/portabilidad y las fuentes concretas de solo lectura: BP_JigServerSave
580.554 B y BP_InventoryComponent 24.878.603 B, en ActionRPGMultiplayerStart. Blueprints sin ejecución
Node/CAS portable; se reutilizan los helpers del juego y el draft ECS ya aceptados. Sin assets nuevos,
modificación de fuentes Unreal ni nueva investigación de licencias.
