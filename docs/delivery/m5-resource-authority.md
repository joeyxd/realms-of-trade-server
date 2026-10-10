# AREA15 — recursos y crafting durables

2026-10-10, hora de México. Código publicado `922295b`, alpha.22; imagen comprobada en VPS.
Activación y aceptación autenticada VPS pendientes por una conexión abierta.

Recolección, golpes parciales y fabricación pueden usar la misma transacción M5 de perfil/mundo/recibo
que comercio y aportes. El inventario y el estado del nodo ya no se confirman por caminos separados
en ese modo. Una respuesta perdida se reconcilia con el recibo; un replay conserva el estado actual
y no entrega de nuevo materiales, herramientas o eventos históricos.

La reaparición se pausa durante el apagado por decisión del autor. El reloj lógico comparte el
checkpoint/commit del mundo; reiniciar con un año añadido a la hora del sistema conserva los ticks
restantes. El tiempo de juego aún no checkpointado puede retroceder tras una caída; los resultados
confirmados de la operación permanecen juntos.

[Contrato, formato, política offline y activación](../briefs/m5-resource-authority.md).

## Verificación

**139/139 pruebas pasan en la release aislada**, incluidas cuatro de terminación abrupta de proceso.
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

Cuatro pruebas de proceso usan `GameHost`, adaptador Supabase y PostgreSQL/PGlite file-backed:
gather/craft × antes del commit/después del commit antes de drain y ACK. El padre envía SIGKILL sin
`host.close()`/`db.close()` del hijo; otro proceso reabre la misma base sin reaplicar migraciones,
admite la cuenta, comprueba perfil/mundo y reintenta la petición. Antes del commit no hay recompensa;
después existe una sola transacción y el replay no vuelve a consumir/entregar.

Esto demuestra recuperación local tras terminar un proceso. No simula corte eléctrico, pérdida del
disco ni dos backends PostgreSQL concurrentes; tampoco equivale a una caída del VPS real.
Las pruebas anteriores de reinicio ordenado económico siguen distinguiéndose de estas nuevas.

## Estado público observado

La release `922295ba5585d9c526ad81a4458b476e8a570fc3` se publicó en la rama de continuidad y se
construyó en el VPS como `marea-negra:alpha-922295ba5585`. Su imagen identificada pasó **107/107**
pruebas en un contenedor sin red ni credenciales del mundo. El cierre bajo el lock del actualizador
confirmó cero jugadores, una conexión y ninguna escritura pendiente; aplazó la sustitución.
[Revisión, imagen, checks y estado público](m5-resource-authority/deployment-pending.json).
El flag de recursos sigue apagado. No se ejecutaron las fases autenticadas de recursos ni un reinicio
del VPS para este corte; las herramientas `qa-m5-resource-live.mjs before|after|cleanup` quedan preparadas.

Antes de este despliegue, `/health` público respondió 200; `/status` mostró `0.6.0-alpha.18`, Supabase
durable, cuentas habilitadas, cero jugadores, cero errores y autoridad económica activa. La única
autoridad ejecutaba la revisión `b84c2daa3107139cb4022b176357db7d59e4caca`, imagen
`marea-negra:alpha-b84c2daa3107`, contenedor sano. Una conexión abierta aplazaba el actualizador.
Esta observación no acepta todavía recursos durables en producción.

El autor confirmó haber aplicado SQL014 y SQL015. El [canario SQL real](m5-resource-authority/sql-live.json)
verificó capacidad, formato con tick, permisos y guards mediante un mundo QA temporal, sin reescribir
el mundo real. Mundo y cuenta QA eliminados; la evidencia conserva la corrección del cleanup inicial.
La opción nueva está apagada por defecto hasta
activar la release compatible. Se preservan los cambios concurrentes de agentes, GM, crafting,
idiomas, arte y planes; el worktree aislado no empaqueta el árbol dirty compartido.

## Pendiente

Cerrar la conexión, activar la release compatible y aceptar este flujo con SQL015 y configuración
revisadas. Primero verificar la release con flag apagado; después recrear la única autoridad con ambos
flags activos, conservando cuentas/secretos/world ID. Después, composición única de economía
y perlas/muerte/botín: hoy reclaman montajes incompatibles de `beforeTick`. Hace falta el dueño común
del reloj y su frontera atómica antes de activarlas juntas. XP/misiones, producción autónoma, cambios
de construcción, custodia offline, scope personaje/mundo y backups/restauración conservan sus cortes.
