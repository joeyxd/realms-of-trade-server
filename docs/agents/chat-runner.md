# L01b — conversación por C01

El [runner de desarrollo](network-runner.md) usa su conexión invitada ordinaria para recibir y
enviar Mundo, Cerca y susurros. No genera respuestas automáticamente. El servidor decide la
audiencia de Cerca por posición 3D, deriva emisor/nombre y limita envíos como para los humanos.

## Uso

Añadir `chat` a las capacidades explícitas, por ejemplo `--capabilities move,aim,chat`.
El default sigue siendo `move,aim`. Recibir mensajes no requiere capacidad de envío.

```json
{"type":"chat"}
{"type":"chat_send","order":{"v":1,"actionId":"saludo-1","scope":{"ownerId":"owner-lab","characterId":"brisa-lab","worldId":"world-lab","sessionId":"COPIAR-DE-READY"},"controlRevision":1,"observationRevision":1,"type":"chat_send","args":{"channel":"world","text":"Hola, tripulación","target":null}}}
{"type":"chat_retry","requestId":"saludo-1"}
```

Copiar scope/controlRevision de la sesión vigente y observationRevision de la observación que
respaldó la decisión. El ejemplo tiene placeholders; una revisión antigua se rechaza.
Para Cerca usar `channel:"local"`; para susurros, `channel:"whisper"` y `target` igual al `id`
real de un destinatario actual en `chat.peers`. El nombre y `entity` no sirven como destino.
`actionId` requiere `[a-zA-Z0-9_-]{1,64}` por el contrato común C01 y comparte namespace con el cuerpo.

API: `agent.chat`, `agent.sendChat(order)` y `agent.retryChat(requestId)`.
`AgentNetworkClient` no expone transporte ni comandos arbitrarios. `chat` es una copia separada
con identidad/config/peers, mensajes entregados y peticiones. `chat.available` indica recepción
inicializada en la conexión; config.enabled y grant.capabilities siguen decidiendo el envío.

## Resultados, identidad y límites

Estados: `sent`, `routed`, `rejected`, `uncertain`. Feedback `chat_state`, `chat_message`, `chat_sent`,
`chat_result`, `chat_uncertain`, `chat_response` y `chat_retry_response` muestra la transición.
Un eco propio con payload coincidente o `CHAT_RESULT.ok` acredita routing. `read:"unknown"`,
`durability:"session_only"`; no acredita lectura ni almacenamiento durable. Rechazos comunes incluyen
`rate` y `recipient`. El retorno de sendChat acredita aceptación local, no éxito del servidor.

Sin respuesta en seis segundos queda incierto; ninguna repetición automática. Un reintento explícito
conserva el payload normalizado/ID/token, solo en la misma conexión con permiso/observación vigentes,
hasta tres intentos totales. No retargetea un token que desaparece. Una petición sin resultado bloquea
envíos nuevos; este emisor privado evita así presión propia que expulse su recibo C01 durante el retry.
No promete deduplicación genérica fuera de la ventana del servidor o con otro escritor en el socket.
Stop, muerte, expiración o desconexión conservan incertidumbre y cierran esa instancia; no reconecta.
El coordinador [L01c](lifecycle-runner.md) permite una sesión nueva explícita, sin migrar IDs/tokens ni retry.

El ledger no elimina IDs: máximo `min(maxActions,256)` envíos distintos por sesión; al llenarlo
devuelve `chat_capacity`. El historial retiene `min(maxChat,200)` mensajes, 32 por defecto.
Cada mensaje omitido por ese límite suma a `historyGap`; saltos de serial global pertenecen a
otras audiencias y no se cuentan como pérdida. Repetir el historial de CHAT_STATE no lo duplica.
`historyBeforeSession:"unavailable"` declara que no se conoce conversación previa a la conexión.
Los textos siguen NFC/limpieza/longitud del host: 300 puntos Unicode por defecto, hasta 1000.
La fixture L00 conserva su límite de 280; observaciones `source:server` admiten hasta 1000.

La vista normalizada llega al siguiente snapshot aceptado. Propio emisor/destinatario se identifica
con `scope.characterId`; otros con `chat:<token de conexión>`. Es un alias local explícito, sin
acreditar vínculo de cuenta/dueño. `agent.chat.messages` conserva emisor/destinatario C01 completos.
El adaptador comprueba participantes del susurro antes de normalizar. No amplía audiencia por texto.

## Contexto y continuidad

`context` usa una proyección separada: chat entregado reciente, hasta 32 peers y una petición
pendiente compacta. Primero comprueba el mínimo protegido; si no cabe, poda chat desde el más
antiguo y después peers sin vínculo a self/destinatario pendiente. `chatSelection` informa conteos
y omisiones; `historyGap` proyectado y `omittedPeers` las conservan dentro del contexto.
La consulta `chat` mantiene el historial de inspección intacto. Reglas, personalidad, metas, estado
propio y resultados inciertos no se podan: si ese mínimo no cabe, se rechaza la consulta.
Después se seleccionan recuerdos con el presupuesto L00 existente. No se añade todo el ledger,
ni se guarda conversación en memoria automáticamente. `chatTextIsUntrusted:true`; cero inferencia.

Números/caps son defaults de desarrollo. El modo invitado tiene permisos locales;
[L02c](authority-runner.md) añade grant del servidor y capacidad/epoch de chat en modo autenticado opt-in.
D-A3 sigue abierta. [Entrega L01b](../delivery/l01b-agent-chat.md) y [vida/reentrada L01c](lifecycle-runner.md).
