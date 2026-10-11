# L02c — control autorizado por el servidor

El host puede admitir un agente autenticado con personaje propio, separado del avatar de su dueño.
La política opt-in es la fuente del vínculo y de las capacidades. El runner adopta el grant recibido;
un UUID escrito en sus archivos o en una orden no demuestra propiedad.

Implementación: [registro](../../server/agentControl.mjs), [host](../../server/host.mjs),
[runner](../../tools/agent/network-client.mjs). [Evidencia local](../delivery/l02c-agent-authority.md).
El modo invitado de L01/L02a/b conserva sus garantías locales. Esta extensión requiere protocolo **28**
en cliente y servidor; la interfaz de órdenes L00 permanece en v1.

## Admisión y configuración

`createGameServer` acepta `agentControl` solo como configuración de código confiable. No existe
variable de entorno ni opción npm que lo active por defecto. Requiere `resolvePlayer` y una política:

```js
const server = createGameServer({
  resolvePlayer: authenticatedAccountResolver,
  worldId: 'authority-lab',
  agentControl: {
    worldId: 'authority-lab', ttlMs: 300000,
    bindings: [{ ownerId: ownerAccountUuid, characterId: agentAccountUuid,
      capabilities: ['move', 'aim', 'attack_pve', 'body_pve', 'chat'] }],
  },
});
```

El resolver verifica el token mediante el contrato de cuentas existente y devuelve el UUID de
cuenta. El token del agente resuelve `characterId`; el del dueño resuelve `ownerId`. No se comparte
el token del avatar humano: las identidades son distintas. El resolver inyectado en las pruebas
es una fixture local, no una verificación contra un proveedor de cuentas en producción.

La política admite hasta 64 personajes únicos; ningún personaje administrado puede ser dueño de
otro binding. Cada grant ocupa una plaza y usa la exclusividad de perfil existente. `agent:true`
sin política, token válido o binding se rechaza. Un HELLO normal de una cuenta administrada también
se rechaza, incluso tras stop. Un fallo de admisión retira el lease y cierra la conexión administrada.
Si el host tiene `worldId`, debe coincidir con la política. En un host efímero con `worldId:null`,
la política define su ámbito de control; no crea persistencia del mundo.

## Estado y mensajes

`WELCOME.control` contiene el estado privado del servidor:

```js
{
  grant: { v: 1, scope: { ownerId, characterId, worldId, sessionId },
    controlRevision, expiresAtMs, capabilities },
  state: 'active', why: null, taskRevision: 0, task: null
}
```

El servidor emite `sessionId` fresco y un epoch `controlRevision` creciente. El runner verifica
dueño/personaje/mundo esperados, adopta esa sesión y reduce capacidades y plazo a la intersección
con su configuración local. El cliente no emite grants. El lease usa reloj monotónico del host
fuera de la simulación; dura 5 minutos por defecto, con máximo de 1 hora. No hay renovación automática.

| Mensaje | Principal y contrato |
|---|---|
| `agent_task` | Agente vigente: `epoch,expectedTaskRevision,actionId,type,args,priority`. Solo `goal` o `reflex`. |
| `agent_cancel` | Agente: `epoch,expectedTaskRevision`; no cancela una orden directa del dueño. |
| `agent_release` | Agente: `epoch`; libera su sesión sin deshabilitar el binding. |
| `agent_control` | Cuenta autenticada del dueño: `op,characterId`; operaciones `stop,revoke,resume`. `direct,cancel` añaden `task` con CAS. |
| `agent_state` | Respuesta privada al controlador de esa sesión y al solicitante autorizado: `ok,state,why?,receipt?`. |
| `inputs` | Input humano normal más `control:{epoch,taskRevision}` para un agente. Ambos enteros vigentes y tarea activa. |
| `chat_send` | C01 normal más `control:{epoch}`; exige capacidad `chat` y lease vigente. No necesita tarea corporal. |

Una orden directa usa `task:{epoch,expectedTaskRevision,actionId,type,args}`; el servidor fuerza
prioridad `direct`. La cancelación del dueño usa `task:{epoch,expectedTaskRevision}`. El principal
se obtiene de su sesión de cuenta, sin confiar en campos `ownerId` del payload. Un dueño ajeno
no obtiene el estado privado. Para las fixtures, el estado vigente se inspecciona mediante
`game.agentControl.byCharacter(characterId)` o `runner.authority`; la UI del dueño queda para L05b.

Solo hay una tarea activa. Prioridad: **directa > meta > reflejo**. Reemplazar o cancelar exige
revisión CAS vigente; IDs reutilizados se rechazan. El registro conserva hasta 256 IDs por lease
y un último estado por personaje. No elimina IDs para aceptar más acciones dentro del mismo lease.
`move,aim,attack_pve` duran hasta 1000 ms; `go_to,follow,keep_distance,body_pve`, hasta 30000 ms.
Todos vencen como máximo al vencer el grant. Son límites de desarrollo, no tarifas ni balance.

## Cola, tick y revocación

El host valida el control al recibir y encolar, y LocalServer vuelve a comprobarlo justo antes
de aplicar cada input, después de incorporar pulsaciones retenidas (`carry`). El tipo de tarea
y sus capacidades limitan movimiento, AIM, ataque, guardia y poción; cambios de arma, habilidades,
dash, interacción y comandos de inventario/naval no están habilitados para el agente.
La simulación mantiene los validadores humanos de daño, recursos, colisiones y cooldowns.

Stop/revoke del dueño incrementan el epoch, cancelan la tarea y deshabilitan el binding.
Reemplazo, cancelación y expiración también limpian cola, carry, último input y temporización de
inputs. El siguiente tick permitido recibe neutral y limpia buffers pendientes de ataque/habilidades.
Si la persistencia ha detenido el tick, esa neutralización física espera; el control antiguo queda
invalidado inmediatamente. Los inputs descartados no reciben ACK de aplicación. Efectos ya aplicados,
incluido un ataque iniciado, permanecen.

El recibo `receipt:{tick,queueCleared,neutralPending,ack}` confirma limpieza de cola y programación
de neutral, **no que el siguiente tick ya ocurrió**, ni éxito de una acción ni guardado durable.
El runner conserva acciones enviadas sin resultado como inciertas. Un recibo perdido mantiene
`serverQueueRevocation:'unproven'`; no fabrica confirmación ni reenvía efectos.

`resume` del dueño solo vuelve a permitir admisión: requiere conexión fresca, sesión/epoch nuevos
y tarea vacía. Muerte, expiración y desconexión retiran el controlador; una respuesta tardía no
restaura tareas. La reentrada del runner es explícita y acotada por `maxSessions`, incluyendo
intentos fallidos. No existe recuperación de grants entre reinicios ni coordinación entre hosts.

El guard PvE del servidor admite ataque solo con sable y lo suprime si otro jugador vivo está a
menos de 8 unidades en su ECS, independientemente del filtro de percepción del runner. No valida
fidelidad de una trayectoria/intención de alto nivel ni demuestra una política PvP completa.
Percepción autoritativa, oclusiones y convivencia siguen en L06a.

## Runner y token

```powershell
node tools/agent/run.mjs --url ws://127.0.0.1:5173/ws --files C:/ruta/agente --owner UUID_DUENO --character UUID_AGENTE --world authority-lab --account-token-env MN_AGENT_TOKEN --capabilities move,aim,attack_pve,body_pve,chat --stay-open
```

Los archivos deben tener ese scope. `MN_AGENT_TOKEN` es el nombre de una variable de entorno;
su valor viaja por el HELLO autenticado existente. No se incluye en URL, argumentos, feedback,
prompt, archivos ni stdout. La prueba del CLI verifica esa separación con un token de fixture.

Las metas esperan ACK de tarea antes de enviar inputs. Órdenes directas llegan del servidor y
desplazan la meta local. Una espera de control mayor de 3 segundos cierra el cliente sin repetir
la solicitud. El runner no puede cancelar ni reemplazar una tarea directa.

`{"type":"stop"}` del CLI es **self-release**: detiene el cuerpo local y pide liberar el lease.
Espera un recibo hasta 1 segundo; si stdin termina mientras espera, el CLI aguarda el cierre de
forma acotada. Self-release permite nueva admisión sin `resume`. Stop/revoke de la **cuenta del
dueño** deshabilitan el binding y sí requieren `resume`. Una etiqueta local de dueño no equivale
a esa autenticación. SIGINT/EOF/desconexión conservan incertidumbre cuando no llega el recibo.

No se conectó un LLM. Se conserva el presupuesto de contexto L00/L01: selección relevante,
deduplicación, compactado trazable y omisiones visibles. El contador actual estima unidades con
bytes UTF-8; tokenizer y envoltura completa del proveedor deberán verificarse en L03a.
Provisionar cuentas/vínculos, custodiar credenciales y ofrecer panel/lanzamiento permanecen abiertos.
