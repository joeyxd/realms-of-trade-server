# L01a — personaje invitado por red normal

2026-10-07, implementación local autorizada tras L00. Base al empezar:
`5ddb299b81bdb2cf94744e5385f073396737845c`, checkout compartido con trabajo concurrente.
Sin commit, publicación, despliegue o SQL en esta misión. No altera protocolo, gameClient,
host, simulación, renderer, dependencias ni cuentas del juego.

## Comportamiento implementado

`AgentNetworkClient` reutiliza GameClient/WsTransport: plaza invitada ordinaria, mapa generado por
la semilla de WELCOME y primer snapshot propio antes de admitir órdenes. Movimiento, AIM y
un pulso de ataque al enemigo confirmado usan los inputs/secuencias/`pt` normales. Sin CMD dev,
teleport, god, nivel, economía, construcción, naval o chat expuestos al decisor.

Snapshots confirmados se copian antes de prediction/reconcile; eventos antes de dedup visual.
Ciclo `life` por spawn/despawn retira objetivos antiguos inmediatamente. ACK queda separado;
la posición posterior solo produce efecto parcial `position_observed`. El movimiento sigue sin
recibo final uniforme; timeout/stop conserva incertidumbre. Swing por entidad/secuencia confirma
inicio del ataque con `swing_started`, sin afirmar daño/impacto/baja ni inventar tick del evento.

Stop local intenta neutral, limpia outbox y cierra incluso si falla el flush. Una instancia cerrada
no reconecta ni repite tareas. Muerte/desconexión/reentrada completas y autoridad del servidor
conservan sus siguientes cortes L01c/L02c.

El CLI consulta archivos reales de personalidad/objetivos/memoria por directorio explícito: contenido,
rutas, hashes, revisión y scope. Los refresca antes del contexto acotado; no mete archivos completos
al prompt. Valida límites/UTF-8/JSON/scope de cada recuerdo, incluso los omitidos de candidatos.
No modifica originales ni persiste memoria nueva. Exportación/borrado/derivados y formato de producto L04.

## Evidencia local

- **74 pruebas pertinentes: 73 aprobadas, una omitida.** `tests/agent-{interface,context,lab,owner-files,network,runner}.test.mjs`:
  L00 completo, aislamiento de fuentes, fresco/obsoleto, scopes, límites/archivos, process CLI,
  admisión/version/plaza llena, inputs/ACK/efectos parciales, swing, ciclo de entidad, stop/flush fallido.
- La omisión es creación de **symlink de archivo**: Windows devuelve EPERM. El código lo rechaza,
  pero esta máquina no ejecutó ese caso. No convertir esa omisión en prueba aprobada.
- **12/12 regresión seleccionada**: chat existente y netcode de dos jugadores a 100 ms RTT.
  No se volvió a ejecutar la suite completa del juego; el corte cambia tooling/controlador fuera del runtime.
- Dos invitados normales por WebSocket ocupan plazas distintas; un tercero recibe rechazo de plaza llena.
  Movimiento llega al snapshot del segundo. Un invitado camina con órdenes cortas al muñeco original
  de práctica y recibe swing real, sin mutación de ECS ni comandos dev para preparar el escenario.
- [Ensayo visual](l01a-agent-network/evidence.json) y capturas en la misma carpeta: navegador ordinario
  + invitado agent, nombre/personaje visible y movimiento por inputs. Prueba automatizada de software;
  experiencia humana, dispositivos/FPS físicos y WAN no se deducen de ella.
  Se inspeccionaron las capturas [antes](l01a-agent-network/normal-client-agent-before-move.png) y
  [después](l01a-agent-network/normal-client-agent-after-move.png): una orden de 500 ms produjo
  desplazamiento observado de 2.675 en servidor y 3.045 en el cliente interpolado, con feedback parcial.
  Host invitado `dev:false`, protocolo 25, dos plazas normales, sin errores de navegador y cierre comprobado.

Comandos ejecutados:

```powershell
node --test --test-concurrency=2 tests/agent-interface.test.mjs tests/agent-context.test.mjs tests/agent-lab.test.mjs tests/agent-owner-files.test.mjs tests/agent-network.test.mjs tests/agent-runner.test.mjs
node --test --test-concurrency=1 tests/chat.test.mjs tests/net.test.mjs
node tools/qa-agent-network.mjs
```

[Registro de verificaciones y hashes](l01a-agent-network-verification.json) conserva counts y
fuentes pertinentes; [uso/API](../agents/network-runner.md). L00 conserva su evidencia histórica;
sus módulos fuente evolucionan aquí, con la regresión L00 incluida en la nueva comprobación.

## Reutilización y límites de aceptación

GameClient, WsTransport, protocolo/PLAYER_FIELDS/BTN y muñeco/mundo existentes. Solo Node builtins;
no framework/proveedor adicional. `ActionRPGStarterSystem/InventorySystem/**`, UMG/ItemImages del
inventario Unreal/FAB no aportan al cliente Node ni lector Markdown/JSON/JSONL; descartados en
el [brief](../briefs/l01a-agent-network.md), fuentes Unreal intactas.

**Invitado con autorización local**, no vínculo autoritativo dueño→personaje. Actualmente una cuenta
tiene un único perfil/sesión; este corte no añade agentes secundarios de cuenta ni comparte token.
Filtro local de radio 24 y guard PvE cerca de otros jugadores son defaults de ensayo, no percepción,
permisos o revocación del servidor aceptados. Ataque restringido al sable inicial; carece de modo
defensivo/apoyo y navegación general. CLI de desarrollo no cierra modalidad D-A3, BYOK o hosting.

Consulta/compactado son locales, **cero llamadas LLM y cero gasto de inferencia**; no hay presupuesto
monetario real, edición automática de metas ni economía del agente. Sin piloto público o despliegue.
Sigue **L01b: chat C01 por su conexión**, recepción/envío de Mundo/Cerca/susurros, audiencia y routing
visible, sin elegir aún respuestas del modelo. Después L01c, cuerpo L02 y mente L03.
