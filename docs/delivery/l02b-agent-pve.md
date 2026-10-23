# L02b — cuerpo PvE del invitado

2026-10-08. **Implementado y verificado localmente**. La orden `body_pve` ejecuta
modos agresivo, defensivo y de apoyo con movimiento, apuntado, ataque básico,
guardia y pociones normales del sable inicial. El servidor conserva daño,
consumo, recargas y colisiones. El cuerpo no consulta modelos por paso.

El dueño debe habilitar `move,aim,attack_pve,body_pve`; el default sigue `move,aim`.
Una tarea activa, horizonte acotado y permiso `allowPotion` separado en la orden.
Agresivo persigue amenazas locales; defensivo mantiene posición y cubre; apoyo
acompaña a un jugador vivo observado y se coloca entre él y un enemigo cercano.
HP bajo prevalece y provoca retirada. Otro jugador observado a menos de 8 unidades
suprime ataques, incluido el protegido, mientras movimiento y guardia continúan.

`confirmed.combat` decodifica las reservas y bloqueos propios del snapshot existente
antes de predicción. ACK no los estima. Pulsos respetan estado confirmado y cadencia;
una poción no se repite sobre la misma reserva sin respuesta de consumo. `body`
muestra solo estado actual, referencias, supresión y posición/tick/recepción reales.
El contexto no acumula una historia por paso. Swing, poción y guardia observados
son efectos parciales; no se anuncia victoria ni protección final por un ACK.

Cancelación, caducidad, muerte, datos obsoletos y retiro/reutilización de IDs cortan
el cuerpo y conservan incertidumbre enviada. Tras SPAWN/DESPAWN, otra orden exige
snapshot fresco. Sin avance confirmado, el watchdog informa bloqueo y queda neutral.
Vida/reentrada conserva L01c; no se reanuda automáticamente una tarea antigua.

[Contrato y ejemplos](../agents/pve-runner.md), [brief y reutilización Unreal/FAB](../briefs/l02b-agent-pve.md).

## Evidencia de raíz

**143 pruebas de agentes: 142 aprobadas, 0 fallos y una omitida** por EPERM de symlink
en Windows. Regresión chat/burbujas/red/combate/armas/Sin ley/items **63/63**, sin
omisiones. Veintiocho casos nuevos: veinte de controlador/sesión/contrato, siete
de wire/red y uno de CLI. Raíz revisó los archivos e integración y ejecutó ambas
suites finales; los ensayos aislados de Luna preceden esta aceptación.

| Evidencia | Alcance |
| --- | --- |
| [TAP agentes](l02b-agent-pve/agent-tests.tap), [comando y conteos](l02b-agent-pve/agent-tests.json) | L00–L02b, determinismo, permisos, frescura, vida, recargas, reservas, proximidad, horizonte, cancelación, contexto y archivos |
| [TAP regresión](l02b-agent-pve/chat-combat-network-regression.tap), [comando y conteos](l02b-agent-pve/chat-combat-network-regression.json) | Chat, privacidad, burbujas, red con latencia, combate/guardia, armas, reglas Sin ley y objetos |
| [Controlador/sesión](../../tests/agent-pve.test.mjs), [wire/red](../../tests/agent-pve-network.test.mjs), [CLI](../../tests/agent-pve-runner.test.mjs) | Modos, efectos parciales, ACK sin éxito fabricado, ciclos de vida y cancelación del dueño |
| [Estabilidad](l02b-agent-pve/dependency-stability.json), [manifiesto](l02b-agent-pve-verification.json) | Timestamps/hashes, archivos probados estables, UTF-8, enlaces y 22 filas de dirección conservadas |

WebSocket real local con dos invitados normales, `dev:false`, cero bots y
`worldId:null`. Fixtures antes de listen/JOIN: suelo plano, colliders de arte
omitidos, enemigos ambiente retirados, dummy de 200 HP y posiciones/stock iniciales
explícitos. Los controles del cuerpo pasan por el transporte y motor normales.

El primer encuentro comprueba daño al dummy y cadencia de swing del servidor.
Una reducción explícita de HP en el fixture dispara retirada: el cuerpo avanza más
de 1.2 unidades y aumenta su distancia a la amenaza. Consume una de dos pociones;
con HP aún bajo el umbral, snapshots conservan la segunda y recarga positiva durante
otra ventana de 500 ms. Una tarea distinta, sin permiso de poción, comprueba el
watchdog en la barrera de agua. Su posición inicial se instala mediante un
reposicionamiento explícito de fixture entre fases; la orden no cruza el obstáculo
ni teletransporta. Este reposicionamiento no acredita movimiento del agente.

El segundo encuentro mueve apoyo más de 3 unidades desde X=-2 al punto cercano a
X=2 entre aliado X=0 y enemigo X=5. Un proyectil dirigido desde el enemigo es fixture
de amenaza; la guardia mantenida lo bloquea con coste real de stamina y daño reducido
al protector. Se espera 700 ms adicionales antes de verificar HP intacto del aliado.
No se reinicia la ventana de guardia perfecta. Después, defensivo mantiene guardia
y posición con variación menor de 0.25 unidades durante 500 ms. Ambos hosts reportan
cero errores. No prueba todos los ataques, aggro, rutas o encuentros del producto.

CLI real admite/rechaza órdenes, consulta cuerpo/contexto con hashes de archivos,
conserva snapshot real y cancela sin reanudar entradas antiguas. Cero llamadas de
inferencia; gasto de juego deshabilitado. Raíz corrigió aim absoluto, firmas de
consumo, cobertura, pruebas de observación y retiro de objetivos antes del cierre.
Los ajustes del fixture preceden las suites finales persistidas.

## Límites

Radios/cadencias/umbral son defaults de ensayo; solo sable inicial. Apoyo es
interposición/guardia local, sin curación de aliados, habilidades especiales, dash,
pathfinding global ni garantía de supervivencia. Snapshot propio confirmado;
filtro de entidades y permisos del dueño siguen siendo locales.

**Sigue L02c:** controlador único, stop/revocación y cola de inputs bajo autoridad
del servidor. El neutral local no demuestra esa revocación. LLM, memoria durable y
presupuesto monetario siguen en L03–L05. Se conservan las 22 líneas de dirección y
D-A3 «Propuesto; por acordar».

Sin cambios de host, SQL, protocolo, simulación, dependencias, proveedor o UI por
este corte. Sin nueva aceptación visual, experiencia humana, dispositivo físico,
suite integral del juego o despliegue. Checkout compartido conservado; sin commit,
push o publicación.
