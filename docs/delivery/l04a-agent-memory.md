# L04a — memoria persistente con recuperación pertinente

Implementado y verificado como software local con modelos simulados. El personaje conserva episodios
entre sesiones, recupera recuerdos relacionados con sus metas/conversación y puede guardar resúmenes
con fuentes, vigencia e incertidumbre. La calidad de esas interpretaciones con un modelo real y la
experiencia humana siguen pendientes. Sin publicación ni despliegue.

## Resultado

`AgentMind.remember()` guarda una proyección acotada del estado entregado por el servidor, sin consulta
al modelo. `compactMemory({sourceIds})` fija de uno a ocho episodios y solicita un resumen separado,
presupuestado como `compaction`. La respuesta debe citar todas las fuentes y elegir etiquetas que ya
procedan de ellas. El resumen hereda la vigencia más restrictiva y permanece `inferred` o `uncertain`;
una interpretación puede ser incorrecta aunque sus referencias sean válidas.

El journal `memory.jsonl` conserva sus registros originales, incluidos los bytes BOM/CRLF, y añade
episodios/resúmenes v2. Un hash verifica consistencia local; no autentica observaciones ni hechos ante
alguien que pueda editar el archivo. Los registros legacy del dueño se proyectan como `uncertain` sin
cambiar sus bytes. La incertidumbre de acciones conserva identidad por sesión y aparece en el contexto
obligatorio con `retryAllowed:false`. Reiniciar carga memoria, sin reanudar órdenes antiguas.

La recuperación recorre el historial completo validado antes de seleccionar candidatos. Compara palabras
Unicode, etiquetas y recencia con metas activas/chat/turno elegido; mantiene contradicciones y vigencias
distintas. No usa proveedor ni embeddings. El contexto final sigue sujeto a los límites L03 y conserva
obligatorios personalidad, reglas, estado actual, metas y pendientes. El archivo completo nunca se envía
por defecto a la mente.

El writer usa scope/directorio fijos, revisión, hashes de los tres archivos del dueño, lock cooperativo,
temporal exclusivo y rename atómico. Comprueba autoridad, epoch, tarea, vida, frescura y prioridad del
dueño antes de publicar. Una escritura ambigua bloquea nuevos commits de memoria en ese proceso;
un recibo conocido tardío queda visible. Decisión, conversación, metas y compacción comparten una consulta
en curso y el ledger de inferencia. Uso desconocido sigue reservado, separado del uso confirmado.

La CLI habilita el flujo explícitamente con `--mind simulated --mind-memory`; acepta `remember`,
`compact_memory` y sus `sourceIds`, y `files` muestra la revisión real. El resumen del adaptador CLI
es una línea scripted de ensayo. No hay captura por tick, calendario autónomo ni modelo externo elegido.
El [contrato](../agents/memory-runner.md) detalla API, formato y límites;
el [brief](../briefs/l04a-agent-memory.md) registra diseño y reutilización.

## Verificación local

Captura final: **578 aprobadas / 3 omitidas / 0 fallos**: 372 de agentes y 206 de regresión.
Hay 58 casos nuevos en siete archivos (57 aprobados / 1 symlink omitido). Las tres omisiones totales
son pruebas de creación de symlinks que Windows rechaza con `EPERM`; se ejecutan las demás comprobaciones
de rutas, tipos, hashes y temporales. La revisión final también cubre episodios con metas pausadas.

Comandos, tiempos, conteos y hashes antes/después están en el
[manifiesto](l04a-agent-memory-verification.json), [agentes](l04a-agent-memory/agents-tests.json),
[TAP de agentes](l04a-agent-memory/agents-tests.tap), [regresión](l04a-agent-memory/regression-tests.json)
y [TAP de regresión](l04a-agent-memory/regression-tests.tap). Las dependencias no cambiaron durante
las capturas aceptadas y se comparan de nuevo con los archivos vigentes al generar el manifiesto.
Las 22 direcciones/demostraciones y D-A3 conservan la [base capturada](l04a-agent-memory/baseline.json).

Las pruebas comprueban procedencia, scope, revisiones, expiración, fuentes inventadas/incompletas,
conservación de originales, etiquetas derivadas, pseudónimos de hablantes, capacidad, ranking,
presupuesto, cancelación y recibos tardíos. WebSocket localhost verifica guardar desde una observación
de servidor, entrar con otra sesión, recuperar y resumir sin enviar órdenes anteriores. El pendiente
histórico es una fixture declarada; no se presenta como una pérdida real de entrega de red. Stop del
dueño por el binding real del host invalida una escritura retenida y conserva los tres archivos.

Un proceso hijo CLI guarda episodio y resumen en el archivo real, recarga la revisión y termina
limpiamente. Otro proceso hijo inicia desde esos archivos y recupera ambos. Las credenciales de la fixture
no aparecen en contexto ni salida. No participan jugadores humanos ni se contacta un proveedor externo.

El ensayo de recuperación usa archivos reales de 256 y 2.400 registros, por debajo de 1 MiB.
El hecho relevante más antiguo queda antes de la ventana legacy de 2.000 candidatos y aun así llega al
contexto seleccionado, con la advertencia de afirmación no autenticada del dueño. Los originales,
personalidad y metas permanecen íntegros.

| Dato del ensayo | 256 registros | 2.400 registros |
|---|---:|---:|
| Archivo de memoria | 74.107 bytes | 698.667 bytes |
| Registros examinados en el journal | 256 | 2.400 |
| Payload transmitido, con bloques obligatorios | 7.241 bytes | 7.242 bytes |
| Unidades del contador simulado | 1.811 | 1.811 |
| Payload sin selección para comparar tamaño | 90.236 bytes | 849.868 bytes |
| Consultas de proveedor para recuperar | 0 | 0 |

Ese contador de recuperación aproxima una unidad por cuatro bytes UTF-8; no es un tokenizer externo
ni una medida de facturación. El TAP registra tiempos locales solo como diagnóstico, sin SLA ni
rendimiento físico aceptado. El tamaño final varía por el payload obligatorio, no crece con todo el archivo.

Otra prueba inicia una mente nueva y un adaptador scripted usa el peligro histórico junto con HP actual
80 para proponer un cuerpo PvE defensivo validado. Hace una consulta de ensayo y registra 138 unidades
nativas confirmadas de esa fixture. La orden tiene identidad nueva y no reutiliza la acción histórica.
Esto verifica conexión memoria→contexto→contrato; no demuestra comprensión, ventaja táctica ni calidad
de un LLM real.

## Límites y continuidad

El journal admite 1 MiB por defecto; más de 64 pendientes actuales rechaza la captura. Llegar al límite
rechaza el append y conserva el historial. Resumir o podar el contexto no elimina archivos. La selección
es léxica: no garantiza entender equivalencias, detectar mentiras ni recuperar todo hecho importante.

El lock coordina escritores cooperativos locales; un editor que lo ignore puede competir. No se promete
CAS del sistema operativo, escritura multi-host, durabilidad ante fallo físico ni recuperación automática
de locks. Los checks finales síncronos pueden ocupar brevemente el event loop. El presupuesto permanece
por proceso; su continuidad durable corresponde a L05.

L04a no cambia simulación/protocolo ni concede autoridad mediante recuerdos. La captura usa protocolo
32 del checkout compartido. No elige proveedor, tarifas, custodia ni operación D-A3; no se aplican
migraciones externas. La regresión SQL embebida existente sí se ejecuta localmente. El trabajo ajeno
del checkout se conserva; esta entrega no constituye un commit, publicación o despliegue.

Unreal/FAB: verificadas las rutas/tamaños de ambos `AIBlackboard.uasset`, 10.661 y 10.593 bytes,
registrados en el brief. Referencia conceptual de separación de datos/conducta; sin inspección de
grafos, exportación, dependencia portable a Node ni cambios en fuentes Unreal.

Siguiente tramo de software: **L04b**, administración del dueño, consulta/exportación y borrado
coordinado de originales/resúmenes/derivados, retención y migración explícitas. La calidad con un modelo
real, percepción L06a y experiencia humana conservan su evidencia pendiente.
