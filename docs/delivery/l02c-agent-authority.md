# L02c — autoridad y revocación: verificado localmente

El servidor ya puede conceder un controlador exclusivo a un personaje de agente autenticado,
separado del avatar del dueño. Stop/revoke del dueño invalidan el epoch, cancelan la tarea y
limpian cola, pulsaciones retenidas y último input antes del siguiente tick permitido. La prioridad
directa > meta > reflejo se comprueba en el servidor, con CAS independiente para las tareas.

Entrega de software **opt-in local**, 2026-10-08. [Contrato y uso](../agents/authority-runner.md),
[brief/reutilización](../briefs/l02c-agent-authority.md),
[verificación con hashes y TAP](l02c-agent-authority-verification.json).
Se conserva la dirección y demostración de las 22 filas del plan, y D-A3 continúa `Propuesto; por acordar`.

## Qué cambia

- `AgentControl` mantiene bindings de cuentas distintas, lease acotado, sesión fresca, epoch,
  tarea CAS, capacidades y exclusividad. Vive fuera de la simulación determinista.
- GameHost autentica ambas cuentas mediante `resolvePlayer`, valida el principal del dueño y
  bloquea admisión normal de cuentas administradas. Un fallo de admisión retira el controlador.
- LocalServer comprueba cada input al encolar y justo antes de aplicar, después del carry.
  Cancelación/reemplazo/expiración limpian la cola; stop/revoke deshabilitan además el binding.
  Reanudación exige conexión fresca y no restaura tareas. Muerte/desconexión retiran el lease.
- El runner espera ACK de tarea, recibe órdenes directas, conserva efectos inciertos y adopta
  el grant del servidor. El CLI lee el token por nombre de variable de entorno y espera el
  recibo de self-release incluso si stdin termina inmediatamente después de stop.
- El guard PvE del host comprueba sable y ausencia de otro jugador vivo a menos de 8 unidades.
  Comandos, naval, dash, habilidades, cambios de arma e interacción quedan fuera de capacidades.

El protocolo pasa de **27 a 28** por `WELCOME.control`, mensajes de control y sobres de epoch/tarea
para inputs/chat administrados. Cliente y servidor deben ser compatibles. La interfaz L00 sigue v1.
El entrypoint npm no activa `agentControl`; el host de pruebas lo monta explícitamente.

## Pruebas y evidencia

Root ejecutó las 19 suites de agentes y 18 suites de regresión, con reporter TAP y hashes de
fuentes antes/después. Ninguna dependencia registrada cambió durante las ejecuciones.

| Grupo | Resultado | Evidencia |
|---|---|---|
| Agentes L00–L02c | 164 pruebas: **163 aprobadas, 1 omitida**, 0 fallidas | [TAP completo](l02c-agent-authority/agents-tests.tap), [comando/metadatos/hashes](l02c-agent-authority/agents-tests.json) |
| Host, cuentas, naval, persistencia existente, chat, red y combate | **206/206 aprobadas** | [TAP completo](l02c-agent-authority/regression-tests.tap), [comando/metadatos/hashes](l02c-agent-authority/regression-tests.json) |

La omisión es `EPERM` de Windows al crear un symlink para comprobar escape del directorio de
archivos del dueño. No se presenta como aprobada. El resto de sus comprobaciones pasó.
Se puede reproducir con `node tools/qa-agent-authority.mjs all`.

Las pruebas nuevas incluyen registro unitario, WebSockets reales, host y CLI hijo autenticados
con resolver de fixture; no dependen de un proveedor de cuentas ni de inferencia externo:

- Dos controladores, dueño ajeno, scope incorrecto, token no mapeado y HELLO normal administrado.
- Lease/tarea expirados, límites/IDs, payloads extra y revisiones ausentes, nulas o antiguas.
- Orden directa > meta > reflejo, rechazo de cancelación del agente sobre orden directa y
  cancelación autenticada del dueño. AIM fuera del tipo de tarea también se rechaza.
- Cola/carry/último input neutralizados; descartados sin ACK y efectos ya aplicados preservados.
  Tráfico tardío por `LagLink`, stop/revoke, resume y sesión/epoch nuevos sin tarea heredada.
- Jugador entrando en rango entre enqueue y aplicación, incluido ATTACK incorporado desde carry.
  Muerte, corte, fallo de perfil tras admisión y cierre seguro sin reutilizar el camino humano.
- Runner esperando control, interrupción con incertidumbre y recibo real; reentradas fallidas
  acotadas. CLI `stdin.end(stop)`, salida 0 y token ausente de stdout/contexto/archivos.

La regresión incluye pruebas SQL embebidas de contratos existentes. **No se aplicaron migraciones
a un servicio externo**, no se provisionaron cuentas y no se ejecutó ningún despliegue.
Los tests de esta autoridad no añaden SQL ni cambian perfiles persistidos.

## Límites de la aceptación

El binding se configura en código confiable y vive en una instancia. Faltan provisioning,
persistencia/administración de vínculos, recuperación entre reinicios, coordinación multi-host,
panel y operación de credenciales. El resolver real disponible debe verificarse al montar un
piloto; los tokens de fixture no demuestran admisión en producción. El dueño conserva su avatar;
esta entrega no incorpora relevo de posesión.

`neutralPending:true` confirma que la cola está limpia y el neutral programado. No afirma que el
tick físico ya sucedió, que un efecto anterior se revirtió o que se guardó algo. Un tick bloqueado
por persistencia espera; el input antiguo ya está invalidado. Si el runner pierde el recibo,
conserva `unproven`. Self-stop del CLI libera el lease; stop/revoke autenticados del dueño
deshabilitan el binding y requieren resume. Son operaciones distintas.

El servidor limita capacidades y tipo de input; no demuestra que cada trayectoria siga fielmente
la intención de alto nivel. El guard PvE no es una política PvP completa ni percepción autoritativa.
La evaluación de convivencia, carga y experiencia humana permanece pendiente.

Checkout compartido y sucio; la evidencia identifica HEAD, fuentes y hashes sin atribuirse cambios
navales, visuales o Web3 concurrentes. Sin commit de misión, publicación o despliegue.

## Siguiente corte

**L03a:** mente intercambiable con decisión estructurada, una consulta en vuelo, timeout y contexto
completo acotado desde la primera llamada. Reutilizar selección/poda/compactado de L00/L01; medir
envoltura, schemas, salida reservada y material omitido. El contador actual usa bytes UTF-8 como
estimación de unidades; antes de afirmar un límite de tokens hay que validar el contador del
proveedor. No cargar archivos completos ni dejar que historial creciente aumente el prompt sin tope.
El coste de resumir también pertenece al presupuesto. No se conectó un LLM ni se habilitó gasto.
