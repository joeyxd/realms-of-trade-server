# L01b — chat del runner y contexto acotado

2026-10-08. Implementación local autorizada tras [L01a](l01a-agent-network.md).
HEAD inicial `4a23e6f81a163c44be0d7143fc7143e68d540b18`, checkout compartido con trabajo concurrente.
Esta misión cambia tooling/pruebas/documentación de agentes; no cambia SQL, protocolo, host,
chat común, UI, simulación, dependencias o cuentas. Sin commit, publicación o despliegue.

## Comportamiento implementado

El personaje invitado recibe/envía Mundo, Cerca y susurros mediante su conexión C01 ordinaria.
El servidor deriva emisor/audiencia y aplica sus límites. El runner valida capacidad local `chat`,
scope/control/observación y destinatario por token de conexión. No usa nombre ni ID de entidad
para retargetear un susurro; no interpreta mensajes como órdenes ni amplía permisos por texto.

Feedback distingue `sent`, `routed`, `rejected`, `uncertain`. Eco propio coincidente o CHAT_RESULT
confirma routing, con lectura desconocida y durabilidad de sesión. Un timeout no reenvía: retry
explícito conserva ID/payload/token, una petición pendiente bloquea nuevas, máximo tres intentos.
Stop conserva incertidumbre y cierra; el ledger de IDs no se borra para poder reutilizarlos.
Historial/ledger/capacidad y ausencia de historia previa quedan visibles en `chat`.

El contexto poda mensajes antiguos y peers opcionales en una proyección separada hasta caber
en el presupuesto L00; conserva reglas, personalidad, metas, estado propio y acciones/resultados
inciertos. Informa conteos, omisiones y gap proyectado. El historial de inspección no cambia.
Recuerdos se seleccionan después sin incluir el archivo completo. Si el mínimo protegido excede
el presupuesto, rechaza la consulta. No hay inferencia ni escritura automática de memoria.

## Verificación aceptada

- **88 pruebas de agentes: 87 aprobadas, cero fallos y una omitida**.
  Incluye L00, L01a, archivos reales, red/cuerpo, CLI, diez pruebas de chat y tres de poda.
  La omisión conserva la limitación Windows EPERM al crear un symlink; no cuenta como aprobada.
  [TAP completo](l01b-agent-chat/agent-tests.tap) y [ejecución](l01b-agent-chat/agent-tests.json).
- **20/20 de regresión seleccionada**: chat común, burbujas y red de dos jugadores con 100 ms RTT.
  No se ejecutó la suite completa del juego.
- Tres invitados por WebSocket verifican Mundo/Cerca/susurro; tercero excluido del privado.
  Rechazos de rate/destinatario, respuesta perdida con mismo-ID retry sin doble entrega, frescura,
  capacidad, Unicode 290 puntos, historial limitado y replay de CHAT_STATE sin duplicación.
  También mensajes privados ajenos/recibos malformados, stop sin resend e incertidumbre protegida.
- [Ensayo visual](l01b-agent-chat/evidence.json), [informe](l01b-agent-chat/report.md) y capturas
  [Mundo/Cerca](l01b-agent-chat/chat-world-cerca.png) / [Privado](l01b-agent-chat/chat-private-route.png).
  Raíz inspeccionó ambas: Brisa identificada en panel/burbuja, canal y destino visibles.
  Dos humanos por UI en contextos aislados + Brisa, tres plazas normales, protocolo 26 vigente,
  `dev:false`, cero errores de navegador y cierre del host comprobado. Tres envíos del agente enrutados,
  texto fijado por QA, lectura desconocida. No acredita experiencia humana, WAN o dispositivos físicos.

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/agent-interface.test.mjs tests/agent-context.test.mjs tests/agent-lab.test.mjs tests/agent-owner-files.test.mjs tests/agent-network.test.mjs tests/agent-runner.test.mjs tests/agent-chat.test.mjs tests/agent-runner-context.test.mjs
node --test --test-concurrency=1 tests/chat.test.mjs tests/chat-bubbles.test.mjs tests/net.test.mjs
node tools/qa-agent-chat.mjs
```

Durante comprobaciones iniciales se corrigió el ensamblado CLI para respetar los seis bloques
obligatorios L00. Una excepción naval al entrar un invitado fue corregida por trabajo concurrente;
esta misión no editó esa ruta. El arnés aisló perfiles de los dos navegadores. El test CLI maneja
rechazo explícito por cruzar una revisión de snapshot y vuelve a decidir con estado fresco;
no repite una petición aceptada. Los intentos fallidos no son evidencia de aceptación.

## Reutilización y continuidad

C01/CHAT_*, GameClient/WsTransport, configuración y panel/burbujas existentes. Sin arte/dependencia
nueva. Candidatos concretos Unreal/FAB descartados en el [brief](../briefs/l01b-agent-chat.md).
[Uso y contrato](../agents/chat-runner.md) explica caps, identidad local y retry.
[Registro de hashes/verificaciones](l01b-agent-chat-verification.json).

Sigue **L01c: muerte/desconexión/reentrada**, estado fresco y órdenes antiguas retiradas.
Autoridad de dueño/capacidades/revocación L02c, LLM L03, memoria durable L04 y presupuesto/panel
L05 siguen pendientes. Runner invitado no resuelve perfiles secundarios de cuenta ni D-A3/hosting/BYOK.
