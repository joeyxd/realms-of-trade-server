# Memoria persistente L04a

El runner conserva personalidad, metas y recuerdos por `ownerId/characterId/worldId`. Cada sesión carga los archivos reales; una sesión nueva recibe un grant y observación nuevos y conserva la incertidumbre histórica sin reanudar órdenes. [Entrega y evidencia](../delivery/l04a-agent-memory.md), [brief](../briefs/l04a-agent-memory.md).

## Uso explícito

```powershell
node tools/agent/run.mjs --url ws://127.0.0.1:5173/ws --files C:/ruta/brisa --owner owner-lab --character brisa-lab --world world-lab --mind simulated --mind-memory
```

```json
{"type":"remember"}
{"type":"files"}
{"type":"compact_memory","sourceIds":["episode:HASH_VISTO_EN_FILES"]}
{"type":"context"}
{"type":"mind"}
```

`remember` guarda un episodio de estado entregado por el servidor sin inferencia; `compact_memory` hace una consulta separada al adaptador para resumir de uno a ocho episodios concretos. La única implementación CLI es simulada y su resumen es una línea de ensayo, sin calidad lingüística aceptada. No hay captura por tick ni tareas automáticas. `--mind-goals` puede añadirse para revisar metas; personalidad, metas y memoria siguen siendo archivos separados.

En código, `AgentMind` acepta `appendMemory` y `readCommitSnapshot` además de las dependencias L03. El writer confiable recibe `{expectedRevision,expectedHashes,entry,guard}` y debe ejecutar el guard síncrono, puro e idempotente antes de publicar. `createMemoryStore({directory,scope}).append` implementa ese contrato. Su recibo exitoso contiene `replay:false`, revisión siguiente, hash del archivo y `entryId`. Recepción tardía, cancelación o fallo ambiguo siguen el contrato de resultados inciertos, sin reintento automático.

## Archivo y procedencia

`memory.jsonl` conserva los registros v1 del dueño y añade sobres v2 con campos exactos: `v`, `kind`, `scope`, `createdAtMs`, `validUntilMs`, `payload`, `id`, `sha256`. `kind` es `episode` o `summary`. La revisión del journal es el número de líneas; cada append conserva los bytes anteriores, incluidos BOM y CRLF. Un hash local detecta inconsistencias; alguien con acceso a escribir puede recalcularlo. No es una firma ni un recibo autenticado del servidor.

Un episodio incluye sesión/epoch, tick/revisión y posición/HP propios, hasta 16 metas con texto de hasta 300 caracteres, ocho acciones con cuatro efectos por acción, cuatro mensajes entregados y hasta 64 pendientes actuales. Informa cuántas metas/acciones/mensajes omitió. Los IDs de hablantes son pseudónimos por dueño/personaje/mundo; omite nombres y destinatarios. El contenido de chat sigue siendo texto no confiable. Más de 64 pendientes hace fallar la captura con `memory_pending_capacity`; nunca se recortan silenciosamente. Un episodio exige observación `server`, pero el archivo local no acredita por sí solo autenticidad externa.

Un resumen fija referencias al ID/hash de todos sus episodios, hereda la vigencia más restrictiva y solo puede elegir etiquetas derivadas de esas fuentes. Siempre es `inferred`, o `uncertain` si alguna fuente tiene pendientes/feedback sin resolver o evidencia de fixture. No acredita que se completó una meta. Los originales permanecen accesibles en el mismo archivo; una interpretación del modelo puede ser incorrecta aunque sus referencias sean válidas. Los episodios actuales usan vigencia histórica ilimitada (`null`): eso conserva qué se observó, sin afirmar que la situación siga vigente.

Las afirmaciones v1 se proyectan como `uncertain`, conservando sus bytes y referencias originales. El parser rechaza fuentes inexistentes, scope cruzado, hash alterado, IDs v2 duplicados y versiones v1 iguales con contenido diferente. Las operaciones pendientes tienen identidad por sesión y `retryAllowed:false`; sobreviven al proceso. Un feedback terminal posterior para la misma identidad puede resolverlas. Si el bloque obligatorio crece demasiado, se rechaza la consulta antes de enviarla.

## Recuperación y coste

La recuperación local escanea todo el journal validado, hasta 1 MiB por defecto, antes de elegir candidatos. Elimina versiones superadas antes de comprobar fecha/expiración para evitar resucitar una versión vieja. Usa palabras Unicode sin acentos, etiquetas exactas y recencia; busca con el texto de metas activas, chat reciente y el turno de conversación elegido. Las coincidencias anteceden al fallback reciente. Devuelve hasta 64 candidatos (máximo 128), preservando el orden aunque el límite de contexto sea menor. Mantiene afirmaciones contradictorias y variantes de certeza distintas; limita duplicados.

El contexto final sigue limitado por los topes L03, con instrucciones, esquema, reglas, personalidad, observación actual, metas, pendientes, reserva de salida y margen medidos en el payload completo. Un resumen puede representar fuentes pertinentes cuando su puntuación es al menos igual; si no, puede seleccionarse el original. El reporte muestra consulta, puntuaciones, IDs, omisiones, bytes y conteo del adaptador. Es búsqueda léxica, sin embeddings ni prueba de comprensión semántica. La deduplicación mecánica no mezcla vigencias diferentes.

Recuperar y capturar no hacen llamadas de proveedor. Resumir usa el ledger compartido con `kind:compaction`: reserva antes de I/O y reconcilia uso nativo aunque el texto sea inválido, se cancele o llegue tarde. Uso desconocido conserva una reserva sin convertirlo en cero. Un resumen válido puede guardarse mientras su coste permanece desconocido; esa reserva limita llamadas futuras. `mind` permite ver uso confirmado, incierto y reservado. El ledger de gasto sigue siendo por proceso; L05 debe dar continuidad durable.

## Escritura y límites

El writer conserva directorio/scope fijos, valida el journal entero, usa `.memory.lock` exclusivo, temporal exclusivo, hashes de los tres archivos, lectura final acotada y rename atómico. Repite el guard después de verificar archivos, inmediatamente antes del rename. Stop, epoch, prioridad directa del dueño, muerte, frescura, tarea y cambio de archivos invalidan la operación. Cancelar no deshace una escritura terminada: un recibo conocido tardío queda visible en `memory` y `lateMemory`. Si el resultado no puede conocerse, se bloquean nuevas escrituras de memoria en ese proceso.

El lock coordina escritores cooperativos del mismo archivo. Un editor externo que lo ignore puede competir; no se promete CAS del sistema operativo, escritura multi-host, recuperación automática de locks ni durabilidad ante fallo físico. Las comprobaciones síncronas finales pueden ocupar brevemente el event loop. Al llegar a 1 MiB se rechaza el append, conservando el historial; resumen y poda de contexto no borran archivos.

L04b sigue con consulta/exportación/borrado y eliminación coordinada de derivados, retención y migración. Panel del dueño, proveedor/tokenizer/facturación reales, percepción L06a y calidad/aceptación humana conservan sus pruebas propias. L04a no modifica protocolo ni simulación ni elige D-A3.
