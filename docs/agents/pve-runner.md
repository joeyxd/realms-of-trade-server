# L02b — cuerpo PvE del runner

`body_pve` ejecuta un modo local durante una tarea acotada, con inputs normales
del sable inicial. No consulta modelos. El dueño habilita explícitamente las cuatro
capacidades `move,aim,attack_pve,body_pve`; el default sigue `move,aim`.

```powershell
node tools/agent/run.mjs --url ws://127.0.0.1:5173/ws --files ./tools/agent/fixtures --owner owner-lab --character brisa-lab --world world-lab --capabilities move,aim,attack_pve,body_pve
```

Enviar el sobre con scope/revisiones frescos de `ready` y `observe`:

```json
{"type":"order","order":{"v":1,"actionId":"cubrir-1","scope":{"ownerId":"owner-lab","characterId":"brisa-lab","worldId":"world-lab","sessionId":"REEMPLAZAR"},"controlRevision":1,"observationRevision":1,"type":"body_pve","args":{"mode":"defensive","protect":null,"retreatHpFraction":0.3,"allowPotion":false,"durationMs":15000}}}
```

Argumentos exactos: `mode`, `protect`, `retreatHpFraction`, `allowPotion`, `durationMs`.
El horizonte usa `maxTaskHorizonMs` (30 s por defecto). Umbral entre 0.1 y 0.8;
`allowPotion` debe ser booleano y autoriza consumir solo pociones propias.

| Modo | Conducta local |
|---|---|
| `aggressive` | Persigue el enemigo vivo más cercano dentro de 12 unidades de sí y del punto inicial; vuelve a ese punto si sale del radio. |
| `defensive` | Permanece en su posición, cubre amenazas cercanas con guardia y contraataca dentro del alcance. |
| `support` | Requiere `protect:{entityId,life}` de un jugador vivo observado. Lo acompaña hasta 3 unidades; ante un enemigo cercano busca un punto a 2 unidades del protegido hacia la amenaza y cubre con guardia. |

En los otros modos `protect` es null. Empates se resuelven por ID y ciclo; perder
al protegido cancela. Enemigos muertos o fuera de observación no se mantienen como
objetivos. Retirar por SPAWN/DESPAWN al enemigo actual o protegido cancela de inmediato;
otra tarea requiere decisión explícita.

HP bajo prevalece sobre el modo: se aleja del enemigo observado más cercano hasta
6 unidades, cubre si tiene reserva y puede intentar una poción autorizada. Reanuda
el modo cuando HP alcanza umbral + 0.1. Esta regla y radios/cadencias son defaults
de ensayo, no aceptación de balance ni navegación global.

`confirmed.combat` es una extensión opcional del contrato v1 local, necesaria para
esta orden: `{weapon,attackStage,stagger,castLock,guardStamina,potions,potionCooldown,
playerNearby,guardRaised}`. Se decodifica del `you` existente antes de predicción.
`playerNearby` usa todas las entidades recibidas dentro del filtro local de 24
unidades antes del cap de contexto: otro jugador a menos de 8 suprime ataques.
El cuerpo continúa cubriendo/moviéndose. La orden corta `attack_pve` conserva
su rechazo/interrupción anterior. No es percepción ni permiso impuesto por servidor.

Ataque básico hasta 1.7 unidades, solo sin ataque activo, stagger o bloqueo de cast;
intentos separados por 450 ms (800 en defensivo). Guardia respeta la reserva mínima
del juego y la guardia ya levantada. Poción requiere HP bajo, stock y recarga cero:
un intento por firma de stock/recarga y separación mínima de 1 s. Sin respuesta de
consumo no repite sobre la misma reserva observada. El servidor puede rechazar
cualquier intento y sigue calculando daño, consumo y recargas. No usa dash, Q/E/R/G
ni cura aliados. Cubrir no garantiza cambiar aggro o interceptar toda amenaza.

`actions`, eventos `body` y el contexto muestran solo el estado actual `body`:
modo, estado, motivo, referencias, posición/distancia, supresión de ataque y tick/
recepción/source de observación. Estados: holding/following/approaching/attacking/
guarding/retreating/blocked/cancelled. Describen intención local; `guarding` no prueba
guardia aplicada. No se acumula un recorrido por paso. Feedback periódico de una
tarea activa hasta dos veces por segundo, además de cambios de estado.

`body_swing_started`, `body_potion_used`, `body_potion_denied` y
`body_guard_observed` son efectos parciales deduplicados por categoría. Los eventos
sin tick usan explícitamente el snapshot previo como referencia inferior; inicio
de swing no acredita impacto. Guardia observada no acredita protección del aliado.
ACK no fabrica resultado. No hay resultado final automático de victoria/protección;
caducidad o cancelación de trabajo enviado conserva `uncertain`.

`cancel`/stop/muerte/desconexión/revocación local y estado obsoleto retiran el cuerpo.
Movimiento enviado sin avance confirmado de 0.15 unidades durante 1.5 s informa
bloqueo y queda neutral. [Ciclo L01c](lifecycle-runner.md) conserva archivo acotado
y reentrada fresca sin tareas previas. El modo invitado no demuestra revocación de la cola del
servidor; [L02c](authority-runner.md) añade esa autoridad opt-in y guard PvE sobre el ECS del host.
Percepción autoritativa y política PvP completa quedan en L06a. Memoria durable/LLM/presupuesto monetario
siguen en L03–L05. [Brief y reutilización](../briefs/l02b-agent-pve.md).
