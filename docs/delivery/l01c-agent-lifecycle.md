# L01c — muerte, desconexión y reentrada

2026-10-08. **Implementado y verificado localmente** en el runner invitado.
Stop/muerte/corte cancelan acciones sin enviar, conservan las enviadas como inciertas,
limpian buffers locales y cierran la conexión. Reentrada explícita crea sesión y estado
frescos; no reutiliza órdenes, IDs, objetivos de ataque ni respuestas anteriores.

## Comportamiento entregado

[AgentNetworkRunner](../../tools/agent/network-runner.mjs) coordina clientes terminales,
con archivo acotado e inspeccionable de identidad, cierre y resultados de cuerpo/chat.
Los IDs anteriores quedan reservados entre ambas vías, incluso con un sobre reescrito.
sessionId/revisión y referencias de vida son nuevos; WELCOME sin snapshot propio válido
no habilita acciones. Stop durante espera de cierre o admisión cancela la transición.

El permiso conserva capacidades y fecha de expiración. No hay reconexión ni reintento
automático. Máximo 8 sesiones por defecto (1–16 configurable), sin expulsar IDs para
hacer sitio. Al detenerse intenta neutral solo con socket vivo, limpia outbox/predicción
y cierra aunque falle el flush. Una interrupción avanza la revisión una sola vez.

CLI optativo `--stay-open`, `lifecycle`, `reenter` y `exit`; modo habitual conserva salida
al detenerse. Reentrada relee personalidad/memoria/objetivos y expone hashes. Conservar
un objetivo no reanuda órdenes. `context` incluye incertidumbre anterior resumida y
protegida; no añade el archivo completo ni conversa con un proveedor. Mantiene poda y
rechazo si el mínimo no cabe. [Contrato y uso](../agents/lifecycle-runner.md).

## Evidencia revisada por raíz

Suite completa L00/L01a/b/c: **97 pruebas, 96 aprobadas, 0 fallos, una omitida** por EPERM
al crear symlink en Windows. La omisión no cuenta como aprobada. Nueve pruebas nuevas:
ocho de ciclo y una del CLI real. Regresión C01/burbujas/red: **20/20**, sin omisiones.

| Evidencia | Lo que comprueba |
| --- | --- |
| [Resultado final de agentes](l01c-agent-lifecycle/agent-tests-final.json), [último bloque TAP](l01c-agent-lifecycle/agent-tests-final-tail.tap) | Muerte por evento/HP cero; stop/corte/despawn; acciones enviadas/sin enviar; neutral fallido; callbacks tardíos; scope/IDs/targets; dueño/caducidad/capacidad; admisión y carreras de stop; regresión L00/L01. Raíz revisó ambos bloques de salida; el TAP conservado contiene casos 57–97 y totales |
| [TAP chat/red](l01c-agent-lifecycle/chat-network-regression.tap), [comando y conteos](l01c-agent-lifecycle/chat-network-regression.json) | Routing C01, privacidad, historial/reintentos, burbujas y red con latencia |
| [Pruebas de ciclo](../../tests/agent-lifecycle.test.mjs) | Dos invitados por WebSocket, host local `dev:false`, cero bots, dos plazas normales; observador ve el cuerpo reentrado, sin movimiento anterior ni errores del host |
| [Prueba CLI](../../tests/agent-lifecycle-runner.test.mjs) | Movimiento enviado → stop → inspección → reentrada explícita; archivos/hashes iguales, contexto protegido, IDs antiguos rechazados, cero inferencia/gasto |
| [Verificación y hashes](l01c-agent-lifecycle-verification.json) | Comandos, conteos, fechas disponibles, archivos revisados y límites del alcance |

Raíz leyó runtime/pruebas y ejecutó las dos suites finales, después de integrar el trabajo
Luna. Los nueve casos nuevos incluyen datos wire de confianza para muerte/fallos; no se
presentan como muertes obtenidas jugando. La reentrada/visibilidad usan host y WebSocket
reales locales. Sin cambio de UI/arte, sin nueva captura ni aceptación de sensaciones/WAN.

Se repitió la verificación tras un cambio concurrente del cliente común. Un intento
obtuvo [timeout de admisión](l01c-agent-lifecycle/agent-tests-admission-timeout.json)
en un caso previo de chat; otro quedó [interrumpido al agotar 120 s](l01c-agent-lifecycle/agent-tests-interrupted.json).
El caso de admisión pasó aislado; la causa de esos dos intentos sigue sin comprobarse.
Una ejecución aparte mostró una carrera verificable en la prueba de reintentos de chat:
el timeout del emisor no garantiza que el receptor ya haya recibido su frame. La
[prueba](../../tests/agent-chat.test.mjs) ahora espera esa entrega antes de exigir una
sola copia, conservando el límite de reintentos y la comprobación de deduplicación.
La suite completa final pasó con esta espera; no se atribuyen a ella los otros timeouts.
Los logs de los intentos fallidos se conservan. El JSON final distingue fecha de lectura
del resultado de timestamps de proceso, que esa ejecución directa no capturó.

La repetición de chat/red tuvo un [intento interrumpido a los 45 s](l01c-agent-lifecycle/chat-network-regression-interrupted.json)
y un [timeout en el caso previo de movimiento con latencia](l01c-agent-lifecycle/chat-network-regression-timeout.json).
Este último dejó intervalo, sockets y host abiertos al cancelar el test; raíz terminó
solo su árbol de procesos de prueba. La causa del timeout de movimiento no está comprobada.
La [prueba de red](../../tests/net.test.mjs) ahora registra teardown desde el inicio y
aborta la espera del intervalo, conservando sus 30 s y todas sus aserciones. Pasaron
[los dos casos aislados](l01c-agent-lifecycle/net-cleanup-tests.json) y la suite final
de 20 casos. Un [ensayo de aborto](l01c-agent-lifecycle/net-cleanup-abort.json) con una
copia temporal y timeout de 1 s confirmó cancelación y salida natural del proceso;
ese fallo esperado no se cuenta como una prueba funcional aprobada. La copia se eliminó.
Los [hashes de dependencias comunes](l01c-agent-lifecycle/dependency-final-check.json)
siguen iguales a la comparación anterior; el checkout compartido no es un snapshot inmutable.

Un ensayo preliminar de reentrada inmediata obtuvo admisión fallida porque el callback
de cierre del cliente precedía a la liberación de plaza del host. La prueba final espera
ese conteo en el host de ensayo antes de solicitar reentrada. El runtime conserva el
fallo visible y el archivo cuando ocurre; no añade retry automático ni finge un ACK de
liberación de plaza. La admisión fallida también está cubierta por fixture.

## Alcance y continuidad

El archivo es **del proceso**, acotado e inspeccionable; se pierde al salir. La reentrada
crea un **nuevo cuerpo invitado**, conservando alias y archivos locales, sin restaurar
inventario/progreso de cuenta. Neutral intentado no prueba recepción ni revocación de
cola del servidor. Propiedad dueño→personaje/control exclusivo autoritativo siguen en
L02c; memoria persistente/exportación/borrado en L04, presupuesto monetario en L05 y LLM en L03.

Sin cambios SQL, protocolo, host, simulación, dependencias ni UI por esta misión. Checkout
compartido ya sucio y con trabajo concurrente preservado; sin commit/push/publicación.
La modalidad D-A3 permanece «Propuesto; por acordar». Las 22 líneas de dirección se mantienen.
[Brief y reutilización Unreal/FAB](../briefs/l01c-agent-lifecycle.md): componentes Node/C01
existentes; Blueprint de guardado e icono de HP descartados para este ciclo, fuentes intactas.

**Sigue L02a:** ir a un punto, seguir y mantener distancia con inputs normales y feedback
de progreso/llegada/bloqueo/cancelación, antes de conectar la mente LLM.
