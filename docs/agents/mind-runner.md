# L03a — mente intercambiable y contexto acotado

La mente propone una decisión estructurada al runner. El cuerpo conserva su ciclo de inputs mientras
la consulta espera, falla o agota presupuesto. La integración está verificada localmente con modelos
simulados, WebSocket real y procesos CLI; proveedor, tokenizer y factura reales siguen pendientes.
La autoridad L02c permanece opt-in. El checkout probado usa protocolo **29** (trabajo de workbench
concurrente); L03a no modifica el wire y mantiene órdenes L00 v1.

Implementación: [mente](../../tools/agent/mind.mjs), [contexto completo](../../tools/agent/mind-context.mjs),
[presupuesto](../../tools/agent/inference-budget.mjs), [proyección](../../tools/agent/mind-snapshot.mjs).
[Entrega y evidencia](../delivery/l03a-agent-mind.md).

## Uso local

La CLI habitual mantiene inferencia desactivada. Para ensayar el camino completo sin servicios externos:

```powershell
node tools/agent/run.mjs --url ws://127.0.0.1:5173/ws --files C:/ruta/brisa --owner owner-lab --character brisa-lab --world world-lab --mind simulated --mind-max-calls 8 --mind-max-tokens 100000 --mind-max-cost 100000 --mind-timeout 1000
```

Enviar `{"type":"think"}` inicia una consulta explícita. `{"type":"mind"}` muestra configuración,
reservas, consumo conocido, uso sin resolver y registros de decisiones; `mind_cancel` invalida la
respuesta pendiente. `stop` conserva el flujo de liberación L02c. El comando `think` no bloquea el
lector de stdin; la CLI puede recibir stop/exit durante la espera. No hay bucle autónomo de consultas.
El simulador de CLI devuelve `wait`; los ensayos programáticos verifican decisiones de movimiento.
La admisión autenticada mantiene `--account-token-env` y la configuración server-owned de L02c.

Estos límites son de laboratorio y de proceso. Los tokens simulados equivalen a bytes UTF-8 y
`costUnits` son unidades de ensayo, sin conversión a moneda o tarifa. Reiniciar el proceso reinicia
el ledger; todavía no sirve como límite durable compartido de una cuenta del proveedor (L05).

## API de adaptación

```js
const mind = new AgentMind({
  adapter, budget, // InferenceBudget({ scope: {ownerId,characterId,worldId}, limits })
  readSnapshot: async () => runnerMindSnapshot(runner, await loadOwnerFiles({ directory, scope })),
  submitOrder: (order) => runner.order(order),
  limits: { timeoutMs: 1000 },
  contextLimits: { maxMemoryUnits: 1000, maxCandidates: 2000, maxSelected: 32 },
});
const result = await mind.decide();
```

El adaptador de confianza proporciona `id`, `countMode`, `countText(text)`,
`prepare(request) -> {body,inputTokens,maxCostUnits}` y
`complete({body,signal,requestId,maxOutputTokens,maxResponseBytes}) -> {text,usage}`.
`prepare` es puro y sin I/O: recibe instrucciones, esquema, contexto y límite de salida; devuelve el
payload serializado exacto que `complete` transmite. Debe contar toda la entrada y framing del modelo,
acotar la lectura de respuesta y respetar el límite de salida. Su reserva de coste debe cubrir la
entrada y la salida máximas, incluyendo cualquier componente facturable que añada el proveedor.
No puede añadir otra envoltura, consultas, embeddings o reintentos fuera del presupuesto.

Los modos son `simulated_tokens`, `estimated_tokens` y `measured_tokens`. La etiqueta medida es una
declaración del adaptador; solo se podrá aceptar como exacta tras verificar el tokenizer y la petición
de un modelo concreto. Contar texto y contabilizar uso facturado son operaciones distintas.
`usage` proviene del recibo del adaptador, separado del texto generado, y tiene exactamente
`{inputTokens,outputTokens,costUnits}`; falta o forma inválida dejan consumo sin resolver.
Ningún modelo, SDK, endpoint, clave o tarifa se configura por defecto en esta entrega.

El adaptador recibe únicamente el payload y límites. No obtiene el runner, socket, funciones de
control, token de cuenta, credenciales ni archivo completo de memoria. Las claves futuras permanecen
en su transporte privado. `loadOwnerFiles` mantiene el saneado y aislamiento de archivos existentes.
La observación y el chat siguen siendo la proyección entregada al personaje; percepción autoritativa
y oclusiones conservan L06a.

## Contexto y presupuesto

La selección de L00/L01 cuenta cada candidato **dentro del wrapper final**, con instrucciones y esquema.
Los bloques obligatorios son reglas, personalidad, herramientas, estado, objetivos y pendientes.
Primero se poda chat antiguo y peers no fijados; se deduplica mecánicamente la memoria idéntica,
con fuentes/IDs/revisiones y certeza conservadas, y se selecciona por relevancia/recencia.
Si el mínimo obligatorio no cabe, no hay reserva ni dispatch. Los originales no se borran ni reescriben.
No hay llamadas LLM extra de resumen, embeddings o retries.

| Tope por consulta | Default de ensayo |
|---|---:|
| Entrada + salida reservada + margen | 16000 unidades del contador del adaptador |
| Entrada serializada | 64000 bytes UTF-8 |
| Salida / margen | 1024 / 256 unidades |
| Respuesta aceptable | 8192 bytes UTF-8 |
| Timeout / antigüedad máxima de la decisión | 1000 / 1500 ms |
| Intentos / registros de la mente | 64, configurable hasta 256 |
| Memoria / candidatos / seleccionados | 1000 unidades / 2000 / 32 |

El reporte conserva tamaño/unidades por bloque, wrapper completo, hash del payload, revisiones de
archivos, fuentes seleccionadas, omisiones y método/coste del compactado. Las medidas por bloque
son diagnósticas; el tokenizer puede tener framing no aditivo y manda el conteo del payload completo.

`InferenceBudget` reserva entrada + salida máxima y coste máximo antes de I/O. Decisión, compactado,
embedding y retry usan el mismo ledger si se incorporan en cortes futuros. Calls y IDs están acotados;
no se evictan para permitir reutilización. El uso confirmado libera solo la diferencia respecto de la
reserva; un error después de dispatch o una respuesta perdida conserva la reserva como **sin resolver**.
La vista separa confirmado, reservado en curso y sin resolver. Una conciliación de confianza puede
resolver lo desconocido; el modelo no dispone de esa operación. Un recibo que supera lo reservado
registra el consumo real, bloquea nuevas consultas y descarta la decisión. El guard no puede impedir
que un transporte o proveedor incumpla su propio límite; esa frontera requiere verificación real.

## Aplicación y cancelación

La respuesta tiene exactamente `{"v":1,"decision":{"type":"wait","args":{}}}` o un tipo de cuerpo
existente: move, aim, attack_pve, go_to, follow, keep_distance, body_pve. No puede incluir scope,
epoch, IDs de acción, capacidades, comandos de chat, mutaciones de metas o evidencia de éxito.
La mente genera el ID local y fija autorización/revisiones; valida argumentos contra la observación
original y después contra el estado actual. Un snapshot nuevo puede avanzar la revisión, siempre
que la decisión original siga fresca y el mismo objetivo/vida/argumento siga siendo válido.

Stop, muerte, expiración, cambio de sesión/epoch/capacidades, tarea reemplazada/cancelada, prioridad
directa del dueño o revisión de archivos invalidan la propuesta pendiente. Una aceptación local de
orden tampoco prueba efecto físico, entrega ni persistencia: conserva el feedback del runner.
Si submitOrder lanza una excepción tras una posible escritura, se registra resultado incierto,
se protege en contextos posteriores y no se reintenta automáticamente.

Hay una sola consulta en curso. Timeout/cancel devuelve al llamador e invalida la respuesta, pero si
el adaptador ignora AbortSignal, el slot permanece ocupado hasta que termine. Un adaptador que nunca
termina requiere detener/reparar su transporte; no se lanza otra consulta que pueda solaparse o cobrar
de nuevo. El cuerpo continúa con su tarea acotada y las reglas de autoridad del servidor.
CLI stop/exit y feedback de cierre cancelan la mente; integraciones programáticas deben conectar
su ciclo de cierre a `mind.cancel()`/`mind.close()`. La reentrada no reinicia cuota ni reanuda consultas.

[L03b](conversation-runner.md) añade conversación explícita con personalidad sobre C01, verificada
con modelos simulados. [L03c](goals-runner.md) añade metas revisables desde feedback y archivos reales.
[L04a](memory-runner.md) añade memoria persistente con fuentes/vigencia y recuperación pertinente; sigue L04b. Selección de proveedor/modelo,
operación/custodia (D-A3), tokenizer/facturación real, memoria durable, panel y convivencia económica
siguen pendientes y requieren su evidencia propia.
