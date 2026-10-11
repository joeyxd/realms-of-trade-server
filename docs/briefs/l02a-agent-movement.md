# L02a — movimiento del cuerpo

2026-10-08. Continuación autorizada después del ciclo invitado L01c. Raíz diseña e
integra; Luna implementa el controlador puro y comprueba contrato/pruebas en archivos
separados. Checkout compartido conservado.

Órdenes `go_to`, `follow` y `keep_distance`, con una intención activa y horizonte
acotado, autorizadas por la capacidad `move`. Vector planar normalizado obtenido de
observación confirmada, tiempo inyectado y referencia de vida. Llegada, seguimiento,
espera, bloqueo y cancelación visibles; ningún LLM por paso, azar, teletransporte o
escritura directa al ECS. El cuerpo sigue utilizando GameClient/WsTransport y las
colisiones de `src/sim/systems/movement.js`. Se conserva la incertidumbre de inputs
enviados y la separación entre ACK y resultado observado.

Ruta directa local, hasta 64 unidades y 30 s por defecto. Sin mapa completo/pathfinding
global, navegación naval ni decisiones PvE nuevas. Falta de avance observado durante
1.5 s de emisión da bloqueo; no identifica por sí sola qué obstáculo lo causó.
Seguir mantiene un radio sin retroceder; mantener distancia sí retrocede. Al perder
el target, morir, quedar obsoleto el estado o cancelarse, deja de emitir movimiento.

Reutilización cruzada con [Unreal/FAB](../research/unreal-assets/CANDIDATES.csv):
`Content/Dreamrise_SMSK/Blueprints/BP_ZombieAI.uasset` es candidato de enemigo por
nombre/ruta, con grafo/dependencias sin verificar y Blueprint no ejecutable en Node;
descartado para estas órdenes. `folder-family: Content/ActionRPGStarterSystem/InventorySystem/**`
es arquitectura de inventario, ajena a locomoción. Fuentes Unreal intactas. Se toma
`src/sim/systems/bots.js` solo como referencia de waypoint/bloqueo: su RNG y estado
bot no se trasladan al controlador del jugador.

Aceptación: determinismo de fixtures, validación/capacidades/caducidad, llegada sin
predicción, seguimiento/radio, pérdida o cambio de vida, bloqueo/progreso, supersede,
cancelación y stop; ensayo invitado por WebSocket real con movimiento y colisión.
Sin cambios de protocolo/host/SQL/UI/proveedor. Revocación autoritativa continúa en
L02c; combate reactivo en L02b; LLM, memoria durable y presupuesto en L03–L05.
