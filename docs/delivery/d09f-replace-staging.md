# D09f-2b.7 — reemplazo durable y drop en tick

Base `621dc98`, 2026-10-06. [Brief y reutilización](../briefs/m5-pearl-batch-staging.md).
Implementación server-only dormant sobre SQL007/008 y cola existentes. No hay SQL nueva.

## Resultado

`PearlStaging.replace` toma el UID de la bolsa, el UID tragado confirmado, la sesión/entidad y
ambas generaciones gestionadas del caller interno. Resuelve cuenta, holder y tipos desde la autoridad
actual, crea un UUID servidor y reserva la cuenta/ambos UIDs antes del primer await. Give y swallow
vacío conservan sus APIs, usando ahora el mismo bookkeeping para uno o varios UIDs.

La elegibilidad y el efecto previsto vienen de `swallowPearl` real sobre perfil/ECS/drop/ledger/eventos
separados. Calma, orden de bolsa, búsqueda standable y fallback al checkpoint conservan sus reglas;
el draft no cambia World ni consume RNG. Congela posición y ticks del drop saliente una sola vez.
Tras los saves CAS anteriores, el builder conserva el perfil confirmado fuera de `pearls` y envía
un único batch replace por `ProfileSessions.commitPearlBatch`, con diario/recibo existentes.

Commit y cierre de diario solo encolan finalización. `drain()` síncrono valida vida, identidad,
sesión/reserva, perfil antes/después y ambos ledgers. Prepara el efecto ECS común desde el estado vivo,
preservando HP/progreso/gear/mastery/movimiento/combate según las reglas existentes. La calma fue
aceptada al comando; combate posterior no provoca una segunda evaluación después del commit.

El ID local del drop se asigna desde `nextDrop` vivo en ese drain, conservando la posición/ticks
confirmados. Un drop legítimo creado durante IO puede adelantar el contador; un ID actual ocupado
o contador inválido cerca la operación sin sobrescribir otro drop. Perfil, ambos ledgers, drop,
contador, efecto ECS, dirty y eventos avanzan juntos. Los eventos actuales `loot` y
`pearlChanged(op=swallow)` reciben el ID/elem finales; no hay DTO/protocolo nuevo.

El enqueue de save final conserva el progreso más reciente. Clones independientes permiten detectar
mutaciones de perfil/ledgers/drop por callbacks antes de publicar. Fallos locales, incluso después
de insertar el drop o anexar el primer evento, restauran las escrituras propias y conservan el fence.
El commit SQL confirmado permanece intacto: ni rollback de DB ni replay de un efecto histórico.
Close/death/recycle requiere invalidación sticky, incluso si revive antes del siguiente drain.

## Evidencia

**681/681** pruebas pertinentes, **94 nuevas**, 36 archivos, concurrencia 2; cero fallidas,
canceladas, omitidas o TODO. Git archive del commit completo
`621dc9800828bd7360fcd870ee0be64c556c7f51` más seis archivos propios de código/tests,
junction de dependencias local y sin `.env`. Hashes SHA256 normalizados LF de las seis fuentes
propias y 67 fuentes/tests anteriores conservados antes/después; estos últimos coinciden con la base.
[JSON de aceptación](d09f-replace-staging-evidence.json) conserva comando, archivos y hashes;
log completo local ignorado: `shots/review/m5-replace-staging-accept.log`.

Los contratos nuevos aportan 45/45 en memoria y 45/45 sobre SQL008; la comparación con el helper
aporta 4/4. Los 587 tests anteriores conservados incluyen el canario local de SQL008 y los procesos
de recuperación de storage/diario/cola. No son 681 checks contra Supabase live.

Pruebas nuevas: contrato idéntico en memoria vinculada y SDK/PGlite con SQL001–008; cuatro kinds,
request inmutable, CAS previo, progreso posterior, ambas reservas, generaciones atrasadas,
confirmación/propiedad/combate, close/death/recycle/bypass, diario lento/fallido, dos respuestas perdidas
y reconciliación sin apply histórico. Las fallas de publicación cubren evento parcial, inserción del
drop tras mutación, segundo ledger, enqueue de save, callback que muta ambos ledgers y release.
Una comparación adicional de World/ECS completos con `swallowPearl` real cubre los cuatro kinds,
incluyendo otras entidades, eventos decorados, drop/ledger/dirty/counter y ambos RNG.

Reconstruir `ProfileSessions` y un `World` dentro del proceso carga el swallowed confirmado sin
eventos históricos; ese test no restaura suelo ni acredita restart de GameHost. La regresión pertinente
conserva los tests/procesos de storage, journal, cola, gate y staging anteriores.
Revisión/pruebas GPT-6 Luna; arquitectura, integración y aceptación revisadas por el principal.

Reutilización comprobada por ruta exacta: los Blueprints ActionRPG de inventario/guardado no aportan
autoridad Node portable. Se reutilizan helper, draft/ECS effect, cola, diario y gate propios;
ningún asset nuevo/exportación ni modificación de fuentes Unreal. [Rutas y tamaños](../briefs/m5-pearl-batch-staging.md).

## Límites y continuación

El único runtime modificado es `server/pearlStaging.mjs`. Host/LocalServer/sim/cliente/protocolo,
migraciones y `.env` permanecen fuera del corte; el trabajo naval/arte paralelo no forma parte de
esta aceptación. No se ejecutan canarios live ni se despliega/reinicia el host.

Staging sigue dormant. Los [hooks completos](../briefs/m5-pearl-common-gate.md), restauración de suelo,
scope/reloj tras reinicio, adopción de UIDs/invitados y leases siguen antes de activar persistencia
en gameplay. Los ticks congelados usan el reloj actual del helper; no definen envejecimiento offline.
La muerte completa debe integrar sus otros efectos de equipo/oro/mundo además del lote pearl-only.

El progreso existente fuera de `pearls` se conserva; afinidad permanente aún no tiene campo ni crédito
runtime. La decisión acordada sigue siendo aprendizaje del personaje por tipo, retenido al perder
la perla y usado al recuperarla, sin transferir aprendizaje a otro dueño. Curvas/tasas/crédito
requieren su propio corte. P4/P6 siguen parciales.
