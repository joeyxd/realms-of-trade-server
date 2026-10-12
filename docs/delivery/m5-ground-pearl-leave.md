# AREA15: soltar perlas con recibo durable

Continúa [perlas nuevas de élites/cofres](m5-ground-pearl-mint.md).
[Contrato](../briefs/m5-ground-pearl-leave.md). Sin migración, flag ni protocolo nuevos.

## Implementación

El montaje explícito `mountGroundPearls()` conecta `pearl/leave` del jugador autenticado
a la familia `ground` SQL004/018/019 existente. Solo recibe un UID; el servidor resuelve
cuenta, perfil y generación actuales. Reserva la cuenta y todos sus UIDs antes de IO,
conserva el progreso ECS previo mediante `settleGroundProfile` y consulta la propiedad
durable. Una perla de generación 2 no puede reutilizar un recibo de generación 1.

La proyección usa `leavePearl` sobre copias aisladas, conservando calma, dispersión y
reglas existentes. El commit confirma perfil, UID, ubicación, mundo/reloj y recibo.
El drain síncrono instala perfil, metadatos confirmados de sesión, suelo, ledger,
allocator, índice actual y eventos juntos. No publica durante IO ni vuelve a tirar RNG.
Deriva, pérdida de callbacks, cierre o desconexión cercan el host; un fallo durante
apply revierte sus escrituras locales. El plazo utiliza el reloj común con pausa offline.

El dueño del comando se comprueba antes del dispatch. Reemplazar el callback o dejarlo
nulo no permite volver al helper inmediato, incluso antes del siguiente tick.
Sin montaje, LocalServer conserva su comportamiento actual. En el piloto incompleto,
`give` y `swallow` se rechazan; `spit` y `sell` mantienen sus denegaciones de gameplay.

## Aceptación

**28/28 casos nuevos correctos.** Cohorte **625/636 en 73 archivos**,
cero omisiones y fuentes congeladas, base `e625a5c`: [manifiesto](m5-ground-pearl-leave/acceptance.json),
[TAP](m5-ground-pearl-leave/acceptance.tap) y [evaluación](m5-ground-pearl-leave/acceptance-evaluation.json).
Nueve fallos de asignación/clonación (incluido el padre de subtests) en tres archivos
desaparecen al repetirlos en serie: **49/49**, fuentes idénticas, sin cambios de código
[retry](m5-ground-pearl-leave/resource-recheck.json), [TAP](m5-ground-pearl-leave/resource-recheck.tap).
La causa transitoria exacta no está establecida. Quedan los dos fallos heredados descritos abajo;
no se declara la cohorte verde ni se suman conteos solapados.
Los artefactos `initial-*` y `progress-*` son lecturas históricas anteriores a esa aceptación.

Los casos propios cubren proyección aislada, deriva de propiedad/perfil/ledger/geometry,
rollback, comandos reales, calma, progreso ECS pendiente, generación durable actual,
reserva antes de IO y retención de publicación hasta el boundary. El host comprueba
cierre/desconexión y sustitución de callbacks, incluido `null` antes del dispatch.

Dos SIGKILL locales interrumpen procesos reales después de preparar SQL019 y después
del commit SQL, antes del apply. Reabrir PGlite persistente sin migraciones recupera
una sola ubicación/recibo; hidrata el suelo actual sin callbacks/eventos históricos y
permite recoger la perla una vez. La bolsa durable deja de poseer el UID.

La cohorte incluye los coordinadores anteriores de mint/muerte/suelo, diario/recuperación,
economía/recursos, Carga/atributos/sobrepeso, taller, agua/cantimplora, SQL034/035 y
compatibilidad de contenido/red. Conteos solapados con las entregas anteriores.

Los fallos heredados se comparan con upstream limpio `e625a5c` en el
[manifiesto](m5-ground-pearl-leave/upstream-check-manifest.json): una aserción antigua
del HTML de `commandDenied`, frente al wrapper de localización actual, y Cometa/agua
profunda. El segundo es un fallo de comportamiento real; este corte no cambia movimiento,
skills ni esas pruebas. La cohorte general no se declara verde si conserva esos fallos.

## Límites y continuación

El [recheck independiente en upstream](m5-ground-pearl-leave/upstream-resource-recheck.manifest.json)
también pasa 33/33 + 15/15 + 1/1 en esos tres archivos, con tests/helpers/ECS/mundo
idénticos. No reproduce los fallos transitorios ni establece su causa.

El código del piloto no equivale a su activación pública. Siguen `give` transaccional,
después `swallow` y el sobre completo de kill/cofre: oro/equipo/XP/misiones, consumo del
cofre y RNG entre procesos. Después, adopción/transición detenida con exclusión del writer
anterior/actualizador y canario autenticado en VPS. No se adopta el mundo público aquí.

SIGKILL local no acredita pérdida eléctrica/disco, PostgreSQL concurrente entre backends
ni lease entre procesos. Una caída anterior a la intención durable aún puede perder el
comando sin confirmar. La entrada pública ordinaria verifica compatibilidad del deploy;
no acredita gameplay durable de `leave` activado en producción.

Se comprobó físicamente `BP_JigServerSave.uasset` (580554 B) en ActionRPG bajo `C:\Unreal`.
Es Blueprint y no ejecuta el contrato Node/Postgres; se reutilizan el helper JS y los
coordinadores existentes. Fuentes Unreal intactas, sin arte nuevo ni cambios visuales.
