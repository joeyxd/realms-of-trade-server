# L03b — conversación con personalidad

La mente [L03a](mind-runner.md) puede proponer una respuesta textual a un mensaje C01 entregado al personaje.
Comparte adaptador, presupuesto completo, timeout y una consulta en curso con las decisiones del cuerpo.
El software se comprueba con modelos simulados; calidad lingüística, proveedor, tokenizer, tarifas y factura reales
requieren evidencia posterior. D-A3 sigue propuesto. No hay cadencia automática ni cambios de objetivos.

## API y audiencia

```js
const mind = new AgentMind({ adapter, budget,
  readSnapshot: async () => runnerMindSnapshot(runner, await loadOwnerFiles({ directory, scope })),
  submitOrder: (order) => runner.order(order),
  sendChat: (order) => runner.sendChat(order),
  conversationPolicy: { channels: ['local', 'whisper'], maxRepliesPerPeer: 1 },
});
const result = await mind.converse({ messageId: deliveredMessage.id });
```

`messageId` lo elige el consumidor a partir de `runner.chat.messages`; recibir un evento no lanza inferencia.
El runner exige que el mensaje siga en el chat entregado y en su observación normalizada, con emisor, texto,
canal y tick coincidentes. Comprueba peer vigente, identidad de entidad, destinatario propio del susurro,
capacidad `chat`, configuración del host, vida, grant, epoch, frescura y resultados pendientes.
El `self` de C01 es un token opaco de conexión, distinto del personaje/cuenta; no se usa un nombre como destino.

El canal de respuesta conserva el canal recibido. Susurro vuelve al token del remitente; Cerca/Mundo usan
destinatario `null`. El servidor C01 determina la audiencia de Cerca al **enviar la respuesta** según las posiciones
vigentes: puede diferir de la audiencia original. Solo Susurro garantiza el intercambio privado entre esas conexiones.
Mundo requiere incluir `world` explícitamente en la política. No hay publicación espontánea ni selección de audiencia
por el modelo. C01 mantiene sus límites y validación; esta capa no cambia el protocolo ni amplía permisos.

Salida permitida:

```json
{"v":1,"decision":{"type":"reply","args":{"text":"Con calma, compañero. Te escucho."}}}
```

También se permite `wait` con argumentos vacíos. Identidad, canal, destinatario, cancelación, órdenes corporales,
metas y capacidades en la salida se rechazan. El texto debe estar ya normalizado como C01, ser no vacío y caber
en `chat.config.maxLength` por puntos Unicode, además del límite de bytes/tokens de L03a.
El runner genera `mind_<uuid>` como ID C01 y actualiza únicamente la revisión de observación antes del envío.

## Contexto y consumo inspeccionables

Personalidad viene del archivo real refrescado del dueño. Mensajes y recuerdos siguen siendo datos no confiables;
«haz X» en chat no es una orden autorizada de gameplay. La respuesta no cambia archivos ni objetivos.
`required.tools.conversation` conserva el mensaje seleccionado, ruta fijada y política. Ese bloque no se poda;
si el mínimo protegido no cabe, la consulta falla antes de reservar o despachar. El resto usa la poda/compactado
mecánico L03a: chat antiguo, peers no fijados y recuerdos pertinentes dentro del presupuesto completo.

`result.providerContext` y `mind.state.records` muestran una copia del **documento seleccionado** que se entregó
al adaptador: personalidad, mensajes entregados, reglas, metas, resultados pendientes y recuerdos elegidos.
El report incluye conteos, omisiones, fuentes, hashes de archivos y fingerprint del body completo preparado.
No se imprime el body nativo del proveedor ni se pasan token de cuenta, socket o funciones de mutación al adaptador.
El adaptador confiable puede añadir su framing, que debe contar en `prepare`; este documento no es prueba de una
petición real ni permiso para enviar estos datos a un proveedor. El dueño puede ver qué texto incluiría la consulta.

`converse` usa `kind:decision` en el mismo ledger que `decide`. Reserva antes de I/O y reconcilia uso nativo incluso
si la propuesta caduca o se rechaza. Confirmado, reservado y desconocido permanecen separados; desconocido no es cero.
Timeout/cancel no repiten la inferencia ni el envío. Una llamada que ignore abort retiene la plaza hasta terminar.

## Supresión y resultados

La política de ensayo tiene `channels:['local','whisper']`, `maxTurns:32`, `maxRepliesPerPeer:1`,
`cooldownMs:5000`, `maxMessageAgeTicks:120` y `blockedPeers:[]`. Son límites configurables de proceso,
no valores aceptados de producto. `maxTurns` admite 1–256, `maxRepliesPerPeer` 1–32, cooldown 0–3.600.000 ms
y edad 0–1.000.000 ticks. Los límites de inferencia siguen aplicando aunque la política sea más permisiva.

Un ID entrante admitido queda consumido antes de armar la consulta, incluso si luego falla presupuesto,
contexto, proveedor o envío. No se expulsa del ledger ni se recupera para un reintento. Ecos propios y recibos no
son disparadores. Un siguiente mensaje del mismo peer supera el default de un intento por interlocutor;
dos agentes con ese default no mantienen una cadena de respuestas. No se deduce «humano» o «agente» del nombre:
C01 no ofrece aquí esa clasificación autorizada. `blockedPeers` permite excluir tokens conocidos por el consumidor.
No hay planificador de respuestas; límites/cooldown acotan consumidores que llamen la API repetidamente.

Los contadores persisten en la misma instancia de mente entre reentradas. Los peers son tokens de conexión:
reconectar al interlocutor puede cambiar el token; el límite total de proceso sigue vigente. Reiniciar el proceso
reinicia esta política y el ledger L03a. No existe garantía durable/global contra bucles, cuota ni gasto.

`result.ok` acredita aceptación **local** de `sendChat`; `agent.chat.requests` acredita después `routed`,
`rejected` o `uncertain`, con `read:'unknown'` y durabilidad de sesión. No significa lectura ni éxito de gameplay.
Un envío `sent/uncertain` bloquea nuevos turnos. Si el callback lanza o entrega una respuesta sin contrato,
`chat_submission_uncertain` bloquea futuras conversaciones en esa instancia y protege el resultado incierto
en contextos del cuerpo; no hay reparación ni reintento automático. Stop, revocación, muerte, cambio de archivos,
sesión/epoch/tarea, destinatario perdido o fuente cambiada descartan propuestas tardías sin deshacer efectos previos.

## CLI de desarrollo

```text
--mind simulated --capabilities move,aim,chat
--conversation-channels local,whisper --conversation-max-turns 32
--conversation-max-replies 1 --conversation-cooldown 5000
```

```json
{"type":"chat"}
{"type":"respond","messageId":"COPIAR-ID-ENTREGADO"}
{"type":"mind"}
```

La CLI simulada devuelve la línea scripted «Con calma, compañero. Te escucho.»; comprueba transporte y contratos,
no adaptación lingüística inteligente. La personalidad real está en el contexto del adaptador y puede variar sin
recompilar. `think` conserva decisiones corporales/wait, `respond` usa solo respuesta/wait y ambos mantienen stdin
disponible para stop. El usuario no necesita editar un sobre de gameplay para responder. No hay UI nueva.

[Entrega y evidencia](../delivery/l03b-agent-conversation.md). [L03c](goals-runner.md) añade selección/revisión de metas con feedback y [L04a](memory-runner.md) persistencia/recuperación de memoria; sigue L04b.
Proveedor real y experiencia conversacional con humanos conservan su aceptación separada.
