# L01c — vida y reentrada local

El [coordinador](../../tools/agent/network-runner.mjs) mantiene terminal cada cliente
cerrado y permite al operador dueño iniciar explícitamente una nueva sesión invitada.
Se integra con [red](network-runner.md), [chat](chat-runner.md) y archivos L00.
[L02c](authority-runner.md) extiende este ciclo al modo autenticado opt-in: grant fresco del servidor,
recibo de limpieza de cola y reanudación del binding por su dueño. Las garantías de neutral local
descritas aquí corresponden al modo invitado. Self-stop del CLI libera el lease; stop/revoke de la
cuenta del dueño requieren `resume`. Los intentos de reentrada fallidos también consumen `maxSessions`.

```powershell
node tools/agent/run.mjs --url ws://127.0.0.1:5173/ws --files tools/agent/fixtures --owner owner-lab --character brisa-lab --world world-lab --stay-open
```

JSON por stdin: `{"type":"stop"}` detiene; `{"type":"lifecycle"}` inspecciona;
`{"type":"reenter"}` pide reentrada; `{"type":"exit"}` cierra el proceso.
`observe`, `files`, `context`, `actions` y `chat` siguen disponibles al estar detenido
con `--stay-open`. Sin ese flag, stop/muerte/corte conservan la salida habitual del CLI.
SIGINT/SIGTERM, EOF y líneas mayores de 16 KiB cierran también ese modo.

## Interrupción

Muerte por evento del servidor o snapshot propio con HP cero, desconexión inesperada,
despawn propio, stop, expiración y revocación local detienen el cliente. La revisión
de control avanza una sola vez por interrupción. Se cancela lo aceptado sin enviar;
cuerpo/chat enviados sin recibo final quedan `uncertain`. Lo confirmado no se pierde.

Se limpian outbox, entradas de predicción, referencias y datos iniciales; se detiene
el ticker. En un socket vivo se intenta un input neutral y después se cierra incluso
si falla el flush. En un corte ya cerrado no se puede enviar neutral. `termination`
informa motivo, hora, buffers locales y si se intentó neutral; no acredita recepción
ni revocación de entradas retenidas en el servidor (`serverQueueRevocation:"unproven"`).
Snapshots, chat y resultados tardíos del socket cerrado no cambian su archivo ni el nuevo cliente.

## Reentrada explícita

`AgentNetworkRunner` conserva la API pública del cliente y añade `reenter(ownerId)`,
`lifecycle` y `priorUncertainty`. El constructor acepta `maxSessions` (8 por defecto,
1–16); cada sesión admite como máximo 256 acciones corporales y 256 peticiones de chat.
No se evictan IDs ni archivos para hacer sitio: al llenar sesiones, devuelve
`session_capacity`. Son límites de ensayo, no presupuesto monetario.

Reentrada requiere dueño local correcto, cliente detenido por muerte/corte/stop y
autorización aún vigente. No renueva caducidad ni capacidades. Expiración o revocación
requieren otra autorización/proceso. Espera el callback de cierre del socket anterior
(hasta 2 s); WELCOME y snapshot propio válido en la nueva conexión preceden a `ready`.
Admisión fallida queda detenida; no reconecta sola. El cierre local no es un ACK de
liberación de plaza del host: si aún devuelve FULL, informa el fallo y conserva el archivo;
el operador puede pedir otra reentrada después. Stop del dueño durante espera o
admisión cancela la transición. `close()` termina el coordinador y bloquea más reentradas.

Cada conexión obtiene sessionId, revisión y referencias `life` nuevas, incluso si el
servidor reutiliza números de entidad. No hereda observación, inputs, tareas, destinatarios
ni historial local de chat. Solo consume chat entregado por C01 a la nueva conexión.
Las órdenes/respuestas antiguas fallan por scope; los IDs aceptados anteriores
quedan reservados entre cuerpo y chat aun si alguien reescribe el sobre. Un retry C01
incierto sigue permitido solamente en su conexión original viva, según L01b.

`reenter_response` informa `taskResume:"none"`, `characterContinuity:"new_guest_body"`
y el grant actualizado. Es un nuevo cuerpo invitado con el mismo alias local, sin restaurar
inventario/progreso ni demostrar vínculo de cuenta. La continuidad de cuenta y control
autoritativo pertenecen a los cortes posteriores.

## Inspección y contexto

`lifecycle.archives` conserva scope, identidad, término y ledgers completos acotados,
con resultados e incertidumbre. Es una copia separada, privada del proceso; no se
escribe a memoria ni se exporta automáticamente. Al salir del proceso se pierde ese
archivo de sesión. El CLI puede capturar su JSON; retención/exportación del producto
siguen en L04. `actions`/`chat` consultan solo la sesión actual.

La reentrada vuelve a leer archivos reales y expone hashes. Personalidad y objetivos
permanecen inspeccionables; que un objetivo siga activo no reanuda ninguna orden.
`context` conserva incertidumbre anterior resumida en el bloque protegido `pending`,
con sesión, motivo, evidencia y `retryAllowed:false`. No importa conversación antigua
ni sus tokens al chat actual. El archivo completo no entra en el prompt.

Se conserva la poda L01b y el presupuesto L00; si el mínimo protegido de incertidumbre
no cabe, se rechaza `required_context_over_budget` en lugar de omitirlo. Cero llamadas
LLM y gasto deshabilitado. [Entrega y pruebas](../delivery/l01c-agent-lifecycle.md).
