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

## Publicación del código inerte

El actualizador instaló `9ea14a052ea34bed683959c2a9fcd36a1f186aea` con una autoridad sana y timer activo:
[estado](m5-ground-pearl-leave/final-status.json). La imagen exacta pasó
**194/194** comprobaciones del actualizador y **96/96** adicionales
sin red ni credenciales: [validación](m5-ground-pearl-leave/updater-validation.json),
[imagen](m5-ground-pearl-leave/exact-image-tests.json). Los 16 módulos coinciden por
SHA256 con Git y las fuentes locales normalizadas a LF: [fuentes](m5-ground-pearl-leave/published-source-check.json).
La entrada pública ordinaria pasó **6/6**, alpha.59/protocolo 58:
[smoke](m5-ground-pearl-leave/public-smoke.json).

La [lectura final](m5-ground-pearl-leave/final-domain.json) conserva los montajes
comunes nulos, sin reloj común ni filas/intenciones de suelo. No se ejecutó SQL,
adopción ni gameplay durable de QA en el VPS. Los tests de imagen usan memoria;
la durabilidad corresponde a los tests SQL/SIGKILL locales. Conteos solapados.

## Integración concurrente

La integración con compañeros de `6b713d2`, alpha.60/protocolo 59, pasa **122/122**
en 17 archivos seriales, incluidas las pruebas de host, SIGKILL y propiedad del comando:
[manifiesto](m5-ground-pearl-leave/concurrent-integration.json),
[TAP](m5-ground-pearl-leave/concurrent-integration.tap). Fuentes sin cambios durante la ejecución.
El permiso del compañero admite solo chat; su montaje excluye el piloto común de suelo.
Esta prueba local no sustituye la evidencia pública de `9ea14a0` ni acredita alpha.60 en VPS.

El VPS se verificó después en `6b713d2`, alpha.60/protocolo 59: una autoridad sana,
actualizador **194/194**, [16 hashes de imagen iguales a Git](m5-ground-pearl-leave/concurrent-image-check.json)
y [entrada pública 6/6](m5-ground-pearl-leave/concurrent-public-smoke.json).
[Estado](m5-ground-pearl-leave/concurrent-live-status.json) y
[lectura del dominio](m5-ground-pearl-leave/concurrent-live-domain.json): montajes comunes nulos,
sin reloj común, filas de suelo ni intenciones. Esta lectura no activa el piloto.

La integración de GM036, upstream `e4fdaf5`, alpha.61/protocolo 59, pasa **83/83** en
12 archivos seriales: [manifiesto](m5-ground-pearl-leave/gm-integration.json),
[TAP](m5-ground-pearl-leave/gm-integration.tap). Incluye SQL036, restauración de recursos,
publicación GM, adopción detenida y planner/comando/host de `leave`. Fuentes sin cambios.
Los conteos se solapan con la aceptación anterior; este grupo no repite sus SIGKILL ni declara
verde la suite completa. No acredita la publicación de alpha.61.

GM036 admite recursos nuevos con CAS y conserva IDs retirados, pero rechaza el montaje
con `GroundHostAuthority`; publicar contenido exige un mundo vacío y sin coordinadores pendientes.
La composición de recursos GM activos con el piloto común queda pendiente de integración explícita
antes de su adopción pública. No se ejecutaron migraciones ni admisiones en esta entrega AREA15.
