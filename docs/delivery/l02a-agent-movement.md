# L02a — movimiento del cuerpo invitado

2026-10-08. **Implementado y verificado localmente**. El agente puede ir a X/Z, seguir
a un jugador observable y mantener distancia sin llamadas LLM por paso. Usa ejes
normales del jugador; terreno, colisiones y velocidad siguen en el motor actual.

Una intención activa, duración acotada y capacidad `move`. Seguimiento/radio usan
referencias de vida y se cancelan al perder el target. `navigation` muestra movimiento,
espera, llegada, bloqueo y cancelación con posición/tick/hora confirmados. El pump no
rejuvenece el snapshot; predicción o ACK aislado no acreditan llegada. Llegada espacial
de `go_to` espera ACK de todos sus inputs, sin prometer causalidad exclusiva ni guardado.

La espera de seguimiento emite neutral dentro del mismo rango de secuencias para
poder continuar cuando el target se aleja, dentro de la tarea autorizada. Cancelar
intenta neutral, corta trabajo local y conserva incertidumbre de inputs ya enviados.
Stop/muerte/reentrada siguen L01c; no se reanuda una tarea terminada automáticamente.
CLI añade `cancel`; `actions` y contexto acotado muestran la navegación actual,
con archivos reales/hashes visibles y cero inferencia/gasto.

[Contrato y ejemplos](../agents/movement-runner.md), [brief y reutilización Unreal/FAB](../briefs/l02a-agent-movement.md).

## Evidencia de raíz

**115 pruebas de agentes: 114 aprobadas, 0 fallos y una omitida** por EPERM de symlink
en Windows. Regresión chat/burbujas/red **20/20**, sin omisiones. Dieciocho casos
nuevos: once de sesión/controlador, seis de wire/red y uno de CLI.

| Evidencia | Alcance |
| --- | --- |
| [TAP completo agentes](l02a-agent-movement/agent-tests.tap), [comando y conteos](l02a-agent-movement/agent-tests.json) | L00/L01/L02a, determinismo, frescura, permisos, horizonte, radio, progreso, bloqueo, cancelación, ACK, lifecycle, contexto y archivos |
| [TAP regresión](l02a-agent-movement/chat-network-regression.tap), [comando y conteos](l02a-agent-movement/chat-network-regression.json) | C01, privacidad, burbujas y dos jugadores con latencia |
| [Sesión](../../tests/agent-movement.test.mjs), [wire/red](../../tests/agent-movement-network.test.mjs), [CLI](../../tests/agent-movement-runner.test.mjs) | Fixtures deterministas, targets por vida, pausa/reanudación dentro del horizonte, stop/reentrada sin tareas antiguas y consulta/cancelación del dueño |
| [Dependencias durante pruebas](l02a-agent-movement/dependency-stability.json), [manifiesto](l02a-agent-movement-verification.json) | Timestamps, hashes y alcance; sin cambios durante estas suites |

Raíz leyó controlador, integración y pruebas, corrigió la continuidad de secuencias
durante espera y ejecutó ambas suites finales. Los ensayos aislados previos de Luna
no sustituyen esa ejecución. Correcciones de fixture/esperas del CLI precedieron la
suite final; los timeouts anteriores de L01c están registrados en su entrega fechada.

WebSocket real local con dos invitados normales, `dev:false`, cero bots y `worldId:null`.
El mapa de ensayo instala terreno plano y una barrera de agua antes de listen/JOIN,
sin colliders de arte: comprueba desplazamiento de varios metros, seguimiento hasta
radio, retroceso hasta banda y bloqueo del motor ante terreno no transitable. Las
posiciones vienen del servidor y los saltos entre snapshots quedan acotados; cero
errores del host. Este ensayo no acredita todas las rutas del mapa de producto.

CLI real consulta personalidad/memoria/objetivos, hashes y navegación en prompt
acotado; rechaza cancel malformado, conserva resultado incierto al cancelar y sigue
recibiendo snapshots. No llama a proveedor ni habilita gasto.

## Límites

Rutas directas locales X/Z, hasta 64 unidades inicialmente; 30 s por defecto.
Sin pathfinding global, búsqueda de targets ocultos, navegación naval ni combate
reactivo nuevo. `blocked` significa falta de avance observado, no diagnóstico de
un obstáculo. Percepción y propiedad siguen siendo locales; revocación de cola del
servidor sigue sin comprobarse (L02c). Archivo de ciclo del proceso y cuerpo invitado
nuevo al reentrar; memoria durable/exportación/borrado y presupuesto siguen en L04/L05.

Sin cambios de host, SQL, protocolo, simulación, dependencias, proveedor o UI por
este corte. No nueva aceptación visual, experiencia humana, dispositivo físico ni
suite integral del juego. Trabajo ajeno preservado; sin commit/push/publicación.
D-A3 sigue «Propuesto; por acordar» y se conservan las 22 líneas de dirección.

**Sigue L02b:** cuerpo PvE agresivo, defensivo y de apoyo, antes de conectar el LLM.
