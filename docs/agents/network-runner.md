# L01/L02 — cliente textual de desarrollo

[Movimiento L02a](movement-runner.md): `go_to`, `follow` y `keep_distance` usan la
capacidad `move`, inputs normales y feedback de posición confirmada. `cancel` corta
una tarea sin cerrar la sesión; la incertidumbre de inputs enviados se conserva.
[Cuerpo PvE L02b](pve-runner.md): modos agresivo/defensivo/apoyo con reservas propias,
guardia, retirada y ataque suprimido cerca de jugadores; permiso explícito `body_pve`.

Implementación local sobre `GameClient`/`WsTransport`; usa el protocolo importado del juego,
sin renderer y con personaje invitado/plaza normal. Su scope y permisos son del proceso local.
El servidor aún no vincula un dueño a un personaje de agente ni impone esos permisos.
No hay LLM, llamada pagada, cuenta secundaria, persistencia de memoria o panel del dueño.
[L01b](chat-runner.md) conecta recepción/envío de chat C01 con capacidad local explícita.
[L01c](lifecycle-runner.md) añade archivo de sesiones y reentrada explícita con estado fresco.

## Usarlo

Con un servidor compatible ya iniciado, desde la raíz del repo:

```powershell
node tools/agent/run.mjs --url ws://127.0.0.1:5173/ws --files ./tools/agent/fixtures --owner owner-lab --character brisa-lab --world world-lab
```

La carpeta de ejemplo pertenece al laboratorio. Para otro personaje, preparar una carpeta propia
con `personality.md`, `objectives.json` y `memory.jsonl` usando esos formatos y el mismo scope de
dueño/personaje/mundo en objetivos y recuerdos. `worldId` es una etiqueta local declarada;
WELCOME verifica la versión y proporciona la semilla real del mapa, no acredita esa etiqueta.
La ubicación/formato de producto, exportación/borrado, edición concurrente y retención siguen en L04.

Se imprime el contenido real de los tres archivos, rutas absolutas, hashes y revisión de objetivos.
`--inspect` permite leerlos sin abrir socket. `--capabilities move,aim,attack_pve` habilita las tres
acciones en este proceso; por defecto solo `move,aim`. `--minutes` limita su autorización local
a 1–60 minutos, cinco por defecto. No es un presupuesto de tokens ni de dinero.

JSON por línea en stdin:

```json
{"type":"observe"}
{"type":"files"}
{"type":"context"}
{"type":"actions"}
{"type":"stop"}
```

`files` vuelve a leer los archivos; `context` los refresca antes de ensamblar el prompt acotado.
Conserva reglas/metas/resultados pendientes, recupera solo recuerdos candidatos y muestra hashes,
omisiones y presupuesto estimado de bytes. Si el mínimo no cabe devuelve rechazo; no hace una
llamada de inferencia. Los archivos completos son para inspección y no se añaden al prompt.
Ctrl+C, `stop`, EOF, expiración o desconexión cierran la sesión; una instancia cerrada no reconecta.
`--stay-open` conserva la inspección por stdin tras cierre y habilita `reenter` explícito en
un cliente nuevo; [ciclo L01c](lifecycle-runner.md). No renueva la autorización.
No se guardan ni modifican objetivos/recuerdos automáticamente en este corte.

Las acciones usan `{"type":"order","order":<sobre v1>}` con scope/revisión frescos de `ready`
y `observe`. Quien automatiza el envío conserva la revisión que respaldó su decisión; las
respuestas antiguas fallan en lugar de reasignarse al estado nuevo. Máximo 16 KiB por línea.
`cmd`, herramientas dev, comercio, construcción y naval no están en esa superficie.
Chat usa `chat`, `chat_send` y `chat_retry`, con su propio sobre y [semántica](chat-runner.md).

## API y semántica

`AgentNetworkClient` exportado por `tools/agent/network-client.mjs`:

```js
const agent = new AgentNetworkClient({ url, grant, name: 'Brisa [IA]', onFeedback });
await agent.connect(); // WELCOME y primer snapshot propio válido, no solo socket abierto
const observation = agent.observation;
agent.order({ v: 1, actionId: 'move-1', scope: agent.grant.scope,
  controlRevision: agent.grant.controlRevision, observationRevision: observation.revision,
  type: 'move', args: { mx: 1, mz: 0, durationMs: 500 } });
// El ticker normal avanza inputs; stop exige el ownerId local.
agent.stop(agent.grant.scope.ownerId);
```

`connect({autoTick:false})` y `pump()` permiten ensayos deterministas del adaptador; no se expone
el cliente/transporte, `send`, `observe` o `recordEvidence`. El factory de transporte y reloj son
dependencias de confianza del anfitrión para tests, no herramientas del modelo. El grant usa
milisegundos del reloj del proceso; el CLI crea una caducidad compatible.

- Movimiento y apuntado mandan inputs normales, cuantización/secuencias/`pt` del cliente y `w:0`.
  Apuntado incluye `BTN.AIM`; el sable inicial es el único arma admitida por este adaptador.
- Snapshot `you` se decodifica por `PLAYER_FIELDS` antes de reconciliación; `predicted:null`.
  Entidades cercanas se recortan por radio local de 24 y límite L00. `viewReport` informa las
  entidades omitidas; `historyGap` no cuenta entidades. No demuestra oclusión/percepción del servidor.
- `SPAWN`/`DESPAWN` crudos cambian el ciclo `life`; una orden al ciclo anterior se retira
  antes del siguiente snapshot. La deduplicación visual no oculta resultados al adaptador.
- El ACK se registra separado. Posición posterior + ACK/horizonte permiten un efecto **parcial**
  `position_observed`; nunca completan el movimiento ni acreditan llegada/causalidad exclusiva.
  Sin resultado concluyente, timeout/stop conserva la orden enviada como `uncertain`.
- `swing {e,seq}` correlacionado confirma **inicio del swing**, código `swing_started`, sin
  afirmar impacto/daño/baja. El evento no tiene tick: el recibo usa el snapshot previo como
  referencia inferior explícita. `source:server` significa datos recibidos y correlacionados por
  el adaptador; el servidor no firma un recibo con ese `actionId`. Durabilidad `not_applicable`.
- Ataque requiere enemigo confirmado/ciclo vigente y queda bloqueado localmente si hay otro
  jugador a menos de 8 unidades entre las entidades recibidas, incluso si el cap lo omite del
  contexto. Es un guard de ensayo PvE, no permiso autoritativo ni política de convivencia aceptada.
- Stop limpia outbox, intenta input neutral y cierra conexión aun si el flush falla. Lo ya enviado
  conserva incertidumbre; no se repite automáticamente. No prueba revocación de cola en servidor.

Los números de radio/horizonte/tamaño/archivo siguen siendo defaults de desarrollo. La identidad
de invitado se distingue de una cuenta auténtica: hoy cada cuenta tiene un solo perfil/sesión,
por lo que compartir token entre dueño y agente independiente no resuelve su propiedad.
El CLI es una herramienta de verificación, sin cerrar D-A3 ni elegir hosting, proveedor o BYOK.
[L02c](authority-runner.md) añade modo autenticado opt-in: cuentas separadas y mapping confiable
del host, grant emitido por servidor, tareas CAS y revocación de cola. Las garantías locales descritas
arriba corresponden al modo invitado; la identidad y stop del modo autenticado se detallan en ese contrato.

## Verificación y siguiente corte

Pruebas `tests/agent-*.test.mjs`; ensayo visual reproducible `node tools/qa-agent-network.mjs`
con Playwright/Chrome y librerías locales ya disponibles (ver su configuración).
[Entrega L01a](../delivery/l01a-agent-network.md) separa lo probado de las puertas abiertas.
L01b añade [chat común C01](../delivery/l01b-agent-chat.md) dentro de la audiencia de su conexión,
routing visible y poda de contexto. L01c completa [vida/reentrada local](lifecycle-runner.md);
[L02c](authority-runner.md) añade autoridad/control opt-in. Sigue L03a; L06a mantiene pendiente percepción.
