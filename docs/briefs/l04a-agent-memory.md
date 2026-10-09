# L04a — memoria persistente del agente

## Alcance y estado

L04a conserva episodios acotados entre sesiones, recupera contexto pertinente desde el journal completo y permite compactar episodios seleccionados en resúmenes trazables. El alcance implementado es local y de ensayo: el CLI habilita el flujo con `--mind simulated --mind-memory`. `remember` guarda una observación entregada por el servidor sin llamar al modelo; `compact_memory` solicita una interpretación para un conjunto explícito de fuentes y consume la reserva de inferencia de tipo `compaction`. No hay captura por tick, resumen automático ni reintento automático.

El CLI disponible solo conecta `createSimulatedMind`. El adaptador y el contador se pueden inyectar en código para pruebas, pero esta ruta no conecta proveedor pagado ni tokenizer externo. La recuperación léxica no usa embeddings ni proveedores y no demuestra calidad semántica.

## Archivo y estructura

`memory.jsonl` es el único journal persistente del personaje y admite dos formas:

- Los registros legacy escritos por el dueño siguen siendo legibles. Se proyectan como afirmaciones del dueño, con certeza `uncertain` y una advertencia explícita: sus fuentes no son recibos autenticados del servidor.
- Los sobres v2 incluyen episodios `episode` y resúmenes `summary`, con scope de dueño/personaje/mundo, tiempos de creación y vigencia, payload, ID por contenido y SHA-256 local. El hash comprueba consistencia local; no es una firma del servidor ni autentica los hechos observados.

Un episodio toma una proyección pequeña de una observación `server`: posición y salud propias, metas, feedback reciente, hasta cuatro mensajes recientes y acciones pendientes. No guarda archivos de entidades, credenciales ni una transcripción completa. La respuesta de compacción debe citar exactamente todas las fuentes fijadas; el journal valida que cada fuente sea un episodio de ese mismo scope y que el resumen conserve la incertidumbre y la vigencia más restrictiva. Episodios y resúmenes se anexan al mismo archivo; crear un resumen nunca borra ni reemplaza los originales.

`parseMemoryJournal` valida el JSONL y deriva `pending` entre episodios. La incertidumbre recordada se agrega al bloque obligatorio del prompt como `retryAllowed: false`. No reanuda una acción ni permite repetirla; requiere volver a observar el estado actual en una sesión nueva. Los recuerdos son evidencia histórica que debe revalidarse, no estado actual ni autoridad de gameplay.

## Recuperación y presupuesto

`retrievePersistentMemory` recorre todos los registros que aceptó el parser, en vez de recortar el historial por su posición al final del archivo. Filtra scope, revisiones, fechas futuras y recuerdos vencidos; tokeniza texto y etiquetas con normalización Unicode, compara etiquetas exactas y añade una influencia modesta de recencia. Las coincidencias léxicas o de etiqueta anteceden al fallback de recuerdos recientes sin coincidencia. La consulta tiene un máximo de 8.000 caracteres y 64 términos únicos; la salida predeterminada queda limitada a 64 candidatos (máximo configurable de 128). Los duplicados idénticos se limitan para dar espacio a hechos distintos. Un resumen pertinente solo puede representar sus episodios cubiertos si puntúa al menos igual para la consulta; de lo contrario, el original sigue disponible. El reporte conserva IDs y puntuaciones para ordenar el contexto después de la compactación mecánica.

Esto prueba búsqueda local por tokens/tags y recencia sobre el historial completo acotado. No es ranking semántico, no entiende equivalencias o implicaciones y no garantiza que toda coincidencia importante aparezca entre los candidatos. El prompt y sus bloques obligatorios siguen sujetos a la medición del adaptador; la recuperación por sí sola no realiza una llamada ni genera coste. La compacción sí es una llamada presupuestada de tipo `compaction`.

El journal y el writer L04a limitan `memory.jsonl` a 1 MiB. Al alcanzar capacidad, el append falla (`memory_too_large`); no elimina, reemplaza ni caduca registros silenciosamente. Más de 64 pendientes actuales rechaza la captura con `memory_pending_capacity` sin recortarlos. Las etiquetas de resúmenes solo pueden venir de sus fuentes; los hablantes se guardan con pseudónimos por scope, omitiendo nombres/destinatarios. El límite total del historial y una política de retención/limpieza corresponden a L04b.

## Escritura y límites de autoridad

`createMemoryStore(...).append(...)` fija el directorio y scope, valida la nueva entrada y la revisión esperada, comprueba los hashes vigentes de `personality.md`, `objectives.json` y `memory.jsonl`, adquiere `.memory.lock` de forma exclusiva, vuelve a leer y validar el journal, prepara un temporal y publica el append con rename. El lock coordina escritores que respetan ese archivo; un editor no cooperativo todavía puede competir fuera del protocolo. Si el resultado del rename queda incierto, la mente bloquea nuevos commits de memoria en ese proceso en lugar de repetir una escritura posiblemente exitosa.

`remember` y `compact_memory` son explícitos y comparten el único turno de inferencia de `AgentMind` con decisión, chat y metas. `remember` no consume tokens de proveedor. La compacción pasa por el presupuesto configurado y por los mismos fences de autoridad, plazo, scope y archivos; solo persiste una interpretación, nunca una orden. La continuidad de memoria no conserva tareas ejecutables ni poderes entre sesiones.

## CLI y revisión operativa

Con `--mind-memory`, el proceso acepta `remember` y `compact_memory` con `sourceIds`; produce `memory_result` o `compaction_result`. El journal se vuelve a leer desde los archivos del dueño antes de formar cada snapshot. El modo de mente debe habilitarse explícitamente con `--mind simulated`; la operación permanece local y simulada. `--mind-max-calls`, `--mind-max-tokens`, `--mind-max-cost` y `--mind-timeout` configuran límites del ensayo, no gasto real.

Las pruebas relevantes están en `tests/agent-memory-journal.test.mjs`, `tests/agent-memory-store.test.mjs`, `tests/agent-memory-mind.test.mjs`, `tests/agent-memory-retrieval.test.mjs`, `tests/agent-memory-context.test.mjs`, `tests/agent-memory-network.test.mjs` y `tests/agent-memory-recovery.test.mjs`. Deben leerse junto con la salida de ejecución del corte; su existencia no prueba uso humano, proveedor externo ni despliegue.

## Reutilización Unreal acotada

Verifiqué de forma read-only, con `Get-Item`, los candidatos `AIBlackboard.uasset` en ambas fuentes Unreal: `C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\AI\Behavior\AIBlackboard.uasset` (10.661 bytes) y `C:\Unreal\MyProject\Content\ActionRPGStarterSystem\AI\Behavior\AIBlackboard.uasset` (10.593 bytes). Coinciden con [el inventario ActionRPG](../research/unreal-assets/actionrpg/files.csv) y [el inventario de MyProject](../research/unreal-assets/myproject/files.csv).

Los nombres y rutas solo sirven como referencia conceptual para separar datos recordados de la conducta. No inspeccioné ni exporté el contenido de los paquetes, y el inventario deja sus clases internas sin verificar. El runtime persistente de Marea Negra sigue usando contratos JSONL y JavaScript propios; L04a no importa esos assets ni depende de ellos.

## Siguiente corte

L04b debe definir la administración del dueño: consulta/exportación y borrado coordinado de episodios, resúmenes y derivados; además de retención, migración y límites de capacidad. Los originales permanecen íntegros en L04a hasta que exista esa política explícita.
