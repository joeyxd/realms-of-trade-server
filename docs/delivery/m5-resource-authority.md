# AREA15 — recursos y crafting durables

2026-10-10, hora de México. **LIVE** en `a5b8f127340c1febbd4c0b29cb83bbc2fa83fe98`,
`0.6.0-alpha.23`, protocolo 36. La activación inicial quedó registrada en `4c6743b`; el commit actual
solo añade docs/herramientas de GM/AREA17 sobre el mismo runtime. La autoridad Supabase usa
`MN_ECONOMIC_OPERATIONS=1` y `MN_RESOURCE_OPERATIONS=1`; recursos listos. Ver [activación inicial](m5-resource-authority/activation.json)
y [status final](m5-resource-authority/final-live-status.json).

Recolección, golpes parciales y fabricación pueden usar la misma transacción M5 de perfil/mundo/recibo
que comercio y aportes. El inventario y el estado del nodo ya no se confirman por caminos separados
en ese modo. Una respuesta perdida se reconcilia con el recibo; un replay conserva el estado actual
y no entrega de nuevo materiales, herramientas o eventos históricos.

Una operación aceptada confirma perfil, recursos y recibo en la transacción M5; el ACK/replay exacto
no entrega otra vez sus efectos. El checkpoint periódico del mundo conserva el tick lógico de recursos,
pero no es la confirmación de la operación: si una acción no llegó a commit/ACK, su efecto no se da
por confirmado. La reaparición se pausa durante el apagado; el reloj lógico conserva los ticks restantes
sin consumir tiempo offline. Tiempo de simulación aún no checkpointado puede retroceder tras una caída.

[Contrato, formato, política offline y activación](../briefs/m5-resource-authority.md).

## Verificación

La aceptación inicial de la release aislada registró **139/139 pruebas**, incluidas cuatro ventanas
locales de terminación abrupta. La revisión de runtime `4c6743b` registra **57/57** en
[current-release-acceptance.json](m5-resource-authority/current-release-acceptance.json) y su
[TAP](m5-resource-authority/current-release-acceptance.tap); comprende autoridad de recursos, SQL,
caídas locales de proceso, compatibilidad de perfiles y aprendizaje costero. La cobertura anterior
de **176 pruebas integradas** y **8 verificaciones UI** queda como evidencia histórica de integración.
La prueba de aprendizaje costero incluida en la release es AREA07 y solo altera progresión; no es una
recompensa de recursos ni parte de las ocho operaciones del canario AREA15.
La aceptación y hashes se registran en [evidence.json](m5-resource-authority/evidence.json),
con [TAP de la release](m5-resource-authority/isolated-acceptance.tap).
Se cubren reglas reales de recolección/crafting, perfiles/herramientas/nodos, dos cuentas, invitados,
respuestas perdidas, bloqueos durante I/O, revisiones antiguas, corrupción de snapshots, downgrade
incompatible, SQL idempotente y permisos de servicio. Se preservan los contratos anteriores de economía.
La regresión conserva perfiles con aprendizaje, prueba recibos históricos SQL014 al aplicar/reaplicar
SQL015 y usa las recetas y la capacidad de mochila publicadas. No incorpora cambios de crafting ni
el montaje opcional .40 del checkout compartido. Los 139 casos anteriores del árbol compartido son
evidencia separada; esta aceptación corresponde a `codex/area15-resource-live` sobre upstream.

Ocho combinaciones de mensajes de rechazo (cuenta/guardado, ES/EN, escritorio/390 px) pasan en
[QA de UI](m5-resource-authority/ui/evidence.json), sin errores de página ni desbordamiento; capturas
inspeccionadas. Se valida el texto nuevo, no se declara traducida toda la interfaz anterior.

Cuatro casos locales con `GameHost` y PostgreSQL/PGlite file-backed cubren gather/craft antes del
commit y después del commit, antes de drain/ACK. Un segundo proceso reabre la misma base sin reaplicar
migraciones y prueba el recibo: antes del commit no hay recompensa; después hay una sola transacción y
el replay no duplica. Esto es distinto del guardado/checkpoint periódico.

## Aceptación pública de recursos

La activación inicial está registrada en [activation.json](m5-resource-authority/activation.json):
revisión `4c6743b87b71ba765e316cd1652d1e4f23991501`, alpha.23/protocolo 36. El status final de
[a5b8f127](m5-resource-authority/final-live-status.json) confirma la imagen desplegada, `/health` 200,
un contenedor sano, timer del updater activo, tick avanzando, ambos flags en 1, recursos listos y cero
errores, jugadores, sockets, pendientes o cambios sin guardar. La imagen actual pasó **107/107** pruebas
offline. El canario autenticado público está en [live-acceptance.json](m5-resource-authority/live-acceptance.json):
siete operaciones reales antes del reinicio y una más tras un checkpoint, ocho confirmaciones totales.
Tras el primer reinicio ordenado se restauró el estado y se reprodujeron siete recibos sin duplicar;
tras el segundo, ocho. El checkpoint incluyó una recolección adicional.

El [registro de reloj](m5-resource-authority/ordered-restart-clock.json) documenta 12 918 ms offline y
una espera pública de 43,9 s, igual a la esperada según los ticks restantes; el tiempo offline no
consumió la reaparición. En total, las ocho acciones confirmadas tuvieron 23 replays exactos: siete
tras el primer reinicio ordenado, ocho tras el segundo y ocho tras SIGKILL.

La prueba remota [crash-restart.json](m5-resource-authority/crash-restart.json) terminó con señal
KILL/exit 137 después del ACK, sin jugadores ni escrituras pendientes. El contenedor fue observado
detenido y se inició manualmente con `docker start`; `restartCount=0`, así que esto no acredita
autoreinicio de Docker. El `after` público restauró profileVersion 12/worldVersion 1379 y reprodujo los
ocho recibos sin duplicar. El contenedor/imagen corresponden al commit `a5b8f127340c1febbd4c0b29cb83bbc2fa83fe98`,
que solo añade documentación/herramientas de GM/AREA17 sobre el runtime de `4c6743b`; ahora es la
revisión desplegada y aceptada.

La caída local, los reinicios ordenados y SIGKILL VPS son evidencias separadas. Este corte prueba
terminación del proceso después de ACK y recuperación mediante inicio manual del mismo contenedor; no
simula corte eléctrico, pérdida/restauración del disco ni concurrencia entre backends PostgreSQL
independientes. La prueba de recursos tampoco cierra persistencia de otras features como perlas,
muerte/botín, mercados autónomos, construcción o progreso/recompensas.

## Estado público observado

El autor confirmó haber aplicado SQL014 y SQL015. El [canario SQL real](m5-resource-authority/sql-live.json)
verificó capacidad, formato con tick, permisos y guards mediante un mundo QA temporal, sin reescribir
el mundo real. La verificación de [cleanup](m5-resource-authority/cleanup-verification.json) confirma
cuenta Auth y perfil ausentes, cuenta QA eliminada, mundo/recursos conservados y ocho recibos inmutables.
El despliegue anterior `922295ba5585d9c526ad81a4458b476e8a570fc3`/alpha.22 quedó históricamente
preparado, pasó 107/107 offline y se difirió por una conexión abierta; véase
[deployment-pending.json](m5-resource-authority/deployment-pending.json). Fue reemplazado por la
activación actual. Los flags se activan explícitamente en producción; siguen apagados en los defaults
de desarrollo/ejemplos. Se preservan los cambios concurrentes de agentes, GM, crafting, idiomas, arte
y planes; el worktree aislado no empaqueta el árbol dirty compartido.

## Pendiente

Quedan fuera de esta aceptación el autoreinicio automático del contenedor, corte eléctrico, pérdida o
restauración de disco, y cualquier promesa de durabilidad de otras features. Componer economía con
perlas/muerte/botín requiere dueño común del reloj y frontera atómica antes de activar esos sistemas.
XP/misiones, producción autónoma, cambios de construcción, custodia offline, scope personaje/mundo y
backups/restauración conservan sus cortes; AREA15 no cierra todo M5.
