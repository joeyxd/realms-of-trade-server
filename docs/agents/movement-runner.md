# L02a — ir, seguir y mantener distancia

El runner invitado ejecuta estas órdenes con la capacidad `move`. No llama al LLM
por paso: convierte posiciones confirmadas en ejes normales del jugador. Colisiones,
velocidad y terreno siguen en GameClient/servidor; no mueve entidades directamente.

```js
const envelope = (actionId, type, args) => ({ v: 1, actionId,
  scope: agent.grant.scope, controlRevision: agent.grant.controlRevision,
  observationRevision: agent.observation.revision, type, args });
agent.order(envelope('punto-1', 'go_to', {
  x: 4, z: 6, tolerance: 0.5, durationMs: 10000,
}));
// Copiar una ref de un jugador visible en observation.confirmed.entities.
agent.order(envelope('seguir-1', 'follow', {
  target: player.ref, distance: 3, tolerance: 0.5, durationMs: 15000,
}));
agent.order(envelope('distancia-1', 'keep_distance', {
  target: player.ref, distance: 4, tolerance: 0.5, durationMs: 15000,
}));
agent.cancel('distancia-1', agent.grant.scope.ownerId);
```

CLI usa `order` con el mismo sobre y `{"type":"cancel","actionId":"distancia-1"}`.
`actions` devuelve el estado actual; `navigation` emite progreso hasta dos veces por
segundo y cambios de estado. La meta visible de un archivo no crea una tarea por sí sola.

| Orden | Criterio planar X/Z |
| --- | --- |
| `go_to` | Ruta directa a X/Z hasta estar dentro de `tolerance`; entonces deja de mover. Destino inicial hasta 64 unidades del self confirmado. |
| `follow` | Acerca al jugador hasta `distance + tolerance`; espera si ya está más cerca. Puede seguirlo de nuevo dentro de la misma tarea si se aleja. |
| `keep_distance` | Acerca o retrocede para mantener `distance ± tolerance`; espera en esa banda. Si coinciden posiciones, usa eje +X determinista para separarse. |

Solo jugadores vivos/observables con la misma `{entityId,life}` sirven como target.
Despawn, cambio de vida o pérdida de observación cancela, sin resolver otro personaje
con el mismo ID. No busca objetivos escondidos ni destinos por el mundo completo.
La percepción sigue siendo filtro local de desarrollo, sin oclusión autoritativa.

`navigation` contiene `status`, `why`, `distance`, `position`, `destination`,
`observedAtMs`, `observationTick` y `source`. Sus estados son `moving`, `holding`,
`arrived`, `blocked` y `cancelled`. La posición y su timestamp son del snapshot;
un pump no rejuvenece ese dato. Predicción y ACK aislado no acreditan llegada.

La llegada de `go_to` se confirma con `destination_observed` solo cuando un snapshot
propio confirmado está dentro del radio y reconoce todos los inputs de esa acción.
Si ya estaba allí, no necesita emitir inputs. Es un criterio espacial observado;
no acredita causalidad exclusiva, permanencia exacta ni guardado durable. Seguir y
mantener distancia son tareas continuas; `holding` no las convierte en éxito definitivo.

Una sola acción de cuerpo está activa. Supersede, cancelación, stop, muerte, permiso
caducado y observación obsoleta cortan emisión. Cancelar intenta neutral en la conexión
viva; inputs ya enviados siguen inciertos, pues la cola del servidor no tiene revocación
confirmada en modo invitado. [L02c](authority-runner.md) añade recibo de limpieza del servidor
en modo autenticado opt-in. Reentrada L01c conserva resultados y crea una tarea vacía.

| Límite | Default / unidad |
| --- | --- |
| `maxTaskHorizonMs` | 30000 ms por tarea, configurable en `limits` de la API local; no renueva la autorización. |
| `movementBlockedAfterMs` | 1500 ms sin avance observado, tras declarar input enviado. |
| `movementMinProgressMm` | 150 milésimas de unidad de mundo para reiniciar la ventana de progreso. |
| `tolerance` | 0.25–2 unidades, argumento requerido. |
| `distance` | 0.5–16 unidades y mayor que tolerance, argumento requerido de seguimiento/radio. |

Los tres límites de API se validan como enteros positivos hasta 1000000, igual que
los demás límites de laboratorio. El horizonte de `move`, `aim` y `attack_pve` sigue
siendo `maxHorizonMs` (1000 ms por defecto). Sin avance observado se informa
`blocked/no_observed_progress`; eso no identifica un obstáculo ni garantiza una ruta
alternativa. El controlador no reintenta automáticamente la tarea terminada.

Dirección local determinista, sin azar; no es pathfinding global ni cuerpo naval.
[L02c](authority-runner.md) añade control opt-in del servidor; cuerpo reactivo en L02b y LLM pendiente en L03.
[Brief y reutilización](../briefs/l02a-agent-movement.md).
