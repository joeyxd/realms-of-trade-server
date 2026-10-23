# L03a — mente intercambiable del agente

## Propósito y alcance verificado localmente

Interfaz de decisión estructurada conectada al runner, con cuerpo L02a/b independiente y mente fuera de `src/sim/**`. API neutral al proveedor, contexto completo acotado y una consulta en curso por agente, verificados con modelos simulados; [entrega/evidencia](../delivery/l03a-agent-mind.md). Límites configurables de ensayo; proveedor/modelo, tokenizer, tarifas, custodia y operación reales pendientes.

Una consulta propone una orden ya soportada, como `go_to`, `attack_pve` o `body_pve`, o `wait`. `set_goal` no es un tipo admitido por `validateOrder`; conserva su corte de contrato propio. El runner fija actionId, scope, epoch y revisiones, valida la propuesta contra el estado original y actual, y la entrega a `AgentNetworkRunner.order(...)`. El modelo no puede devolver campos de autorización ni ampliar permisos. Propuestas obsoletas se descartan.

## Reutilización existente

- `tools/agent/context.mjs`: `buildContext({ required, memory, queryTags, scope, nowMs, limits, countUnits })` crea el documento provider-neutral (`rules`, `personality`, `tools`, `observation`, `goals`, `pending`), valida JSON/scope/recencia, deduplica contenido y selecciona memoria pertinente. Devuelve `ok`, `document`, `text` y `report` con unidades, bytes, IDs elegidos, omisiones y sobregasto. `compactMemory(...)` deduplica mecánicamente y conserva referencias fuente; no resume ni inventa hechos.
- `tools/agent/runner-context.mjs`: `buildRunnerContext(options)` aplica poda determinista al chat más antiguo y peers no fijados, conserva la historia de inspección y luego usa `buildContext`. Mantener este ensamblador como entrada de la primera consulta; añadir personalidad/metas/chat solo mediante los bloques ya definidos.
- `tools/agent/network-client.mjs` / `tools/agent/network-runner.mjs`: reutilizar `observation`, `grant`, `authority`, `actions`, `chat`, `order(...)`, `pump()`, `stop(...)` y feedback existente. `AgentNetworkRunner` ya proporciona coordinador de sesión y `AgentNetworkClient` restringe su fachada de red. La mente debe recibir proyecciones de lectura, no transporte, token ni funciones privadas del cliente.
- `tools/agent/contract.mjs`: `validateOrder(...)` verifica scope, epoch/revisión, frescura de observación, capacidad y argumentos. Mantenerlo como frontera antes de ordenar; no duplicar validadores del servidor.
- `tools/agent/session.mjs`: la sesión actual y sus tareas/cuerpo continúan funcionando mientras la consulta async espera. El resultado LLM no debe bloquear `pump()` ni el avance del cuerpo.

El contador predeterminado de `buildContext` es `estimated_utf8_bytes`, no tokenizer ni cuenta facturada. Sus límites (`maxContextUnits`, reserva de salida, margen y `maxInputBytes`) acotan el documento de entrada según ese contador; no incluyen por sí solos instrucciones/envoltura/serialización de un proveedor real, precio, ni consumo de salida. Si el mínimo obligatorio rebasa presupuesto, la integración debe omitir la llamada y emitir un estado legible; no debe recortar reglas/metas/pendientes para forzarla. Informar estimación y conteo medido por separado.

## Frontera de la mente

`AgentMind.decide()` prepara el payload completo mediante el adaptador inyectado, reserva consumo antes de `complete({body,signal,requestId,maxOutputTokens,maxResponseBytes})` y valida JSON/tamaño/tokens/argumentos de salida. Cancelación, timeout y cierre invalidan la respuesta. Si el adaptador ignora abort se conserva el slot hasta que termine para evitar solapamientos. Una observación nueva puede avanzar revisión dentro de la frescura original, tras validar nuevamente objetivo/vida/argumentos. Scope, epoch, tarea, prioridad, archivos o estado cambiados descartan la propuesta. No hay reintentos automáticos.

Conservar para inspección `context.report`, motivo de omisión/rechazo, revisión de entrada, tiempo de espera/resultado y estado estructurado de salida. No registrar secretos ni texto privado ajeno; los mensajes elegibles son solo los entregados al personaje por C01. La selección de recuerdos no equivale a retención/borrado: los archivos originales y derivados siguen bajo las fronteras de L04.

## Riesgos y límites que deben permanecer visibles

- La estimación UTF-8 puede no caber en una ventana real después de añadir envoltura, herramientas o reserva de salida. Hasta conectar y medir un tokenizer/endpoint concreto, no anunciar el límite como tokens exactos ni un ahorro/coste.
- La reserva/reconciliación y límites por proceso están verificados con recibos simulados; no prueban enforcement durable de una cuenta, facturación real, credencial BYOK o panel del dueño.
- El control del server es opt-in (L02c). No activar `agentControl`, compartir credenciales del dueño con el agente, ni tratar autorización del proveedor como autoridad de juego.
- El cuerpo sigue siendo dueño de inputs y acciones; la salida del modelo es solo una propuesta de decisión y pasa por validadores/contratos vigentes. Latencia, timeout, salida malformada, revocación o respuesta tardía no detienen el tick ni renuevan un grant.
- La observación actual del runner incluye filtrado local de entidades, no percepción autoritativa/oclusiones. L03a no debe declarar que el modelo conoce más que esa proyección ni elevarla.
- Conversación inteligente (L03b), selección/ajuste de metas (L03c), memoria persistente (L04), límites durables/operación/panel (L05) y nuevas capacidades del mundo conservan sus cortes.

## Cruce Unreal/FAB acotado

El inventario de `docs/research/unreal-assets/actionrpg/FINDINGS.md` identifica `AIBehaviorTree.uasset` y `AIBlackboard.uasset` como referencias conceptuales a organización de conducta/estado, y advierte que nombres/cadenas no verifican el grafo. Verificación de solo lectura de existencia/tamaño en `C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\AI\Behavior\`: `AIBehaviorTree.uasset` existe (111.879 bytes) y `AIBlackboard.uasset` existe (10.661 bytes). No son módulos ejecutables o exportables al cliente Node/WebSocket ni reducen el trabajo del contrato de decisión estructurada; se descartan para implementación L03a. No se abrieron ni modificaron.

## Evidencia/aceptación local

48/48 pruebas nuevas, 211 aprobadas y una omitida por symlink Windows en la suite completa de agentes; 206/206 de regresión. WebSocket real verifica movimiento durante la espera y stop del dueño que descarta la respuesta tardía; CLI real muestra límites/uso y sale correctamente. Historial de 10.000/20.000 recuerdos mantiene prompt acotado y fuentes originales. [Contrato](../agents/mind-runner.md), [TAP/manifest](../delivery/l03a-agent-mind.md). Proveedor, tokenizer, gasto facturado y operación reales pendientes.
