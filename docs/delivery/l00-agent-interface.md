# L00 · interfaz ejecutable y ensayo de decisiones simuladas

2026-10-07. Base Git al comenzar: `14510ff5c7eb80c24b90415067b503a4ac979022`, checkout compartido
con trabajo naval/arte/economía concurrente. [Brief](../briefs/l00-agent-interface.md),
[contrato v1](../agents/interface-v1.md), [evidencia JSON](l00-agent-interface-evidence.json).

L00 ya tiene módulos ejecutables fuera de la simulación y una fixture reproducible. La versión 1
describe permiso/ámbito, estado confirmado/predicho, frescura, ciclo de vida de objetivos, órdenes
acotadas y resultados. El laboratorio valida datos y muestra el ciclo sin conectar un servidor ni LLM.
La dirección de las 22 líneas sigue acordada; L01–L06 conservan implementación pendiente.

## Comportamiento entregado

- `contract.mjs`: forma exacta de permiso/observación/orden/recibo; capacidades move/aim/attack_pve,
  argumentos finitos, horizonte, ámbito y revisión de control. Acciones futuras devuelven unsupported.
- `session.mjs`: una orden activa, IDs y recibos deduplicados; envío/ACK/resultado separados,
  interrupciones y neutralización, pérdida/reutilización de objetivo, incertidumbre preservada y
  recibos tardíos que no reactivan inputs. Capacidad acotada sin borrar IDs para volver a ejecutarlos.
- `context.mjs`: presupuesto completo, mínimos protegidos, selección pertinente y poda de opcionales;
  compactación mecánica exacta con fuentes/certeza/ámbito. Ventana de candidatos reciente, expiración,
  revisión vigente y reporte de omisiones. Si el mínimo no cabe, se bloquea la consulta.
- `lab.mjs`: lee archivos reales de personalidad/objetivos/memoria de fixture, muestra rutas y hashes
  del contenido usado; decisiones simuladas y tiempo virtual. Los originales no se modifican.

## Verificación local

```powershell
node tools/agent/lab.mjs
node --test tests/agent-interface.test.mjs tests/agent-context.test.mjs tests/agent-lab.test.mjs
```

**46/46 pertinentes**: 31 de interfaz/ciclo, 14 de contexto y una prueba de proceso que repite
el ensayo completo y compara exactamente su salida. Incluyen argumentos inválidos, capacidades
prohibidas/no implementadas, estado caducado, muerte/desconexión/stop, objetivo perdido/reutilizado,
timeout, IDs/recibos conflictivos y un retry cíclico que se rechaza sin afectar el registro anterior.

Caso de historial grande: **50.000 registros, 14.755.561 bytes de historial JSON sintético**;
se examinan los 2.000 candidatos más recientes y se reportan 48.000 omitidos. La consulta resultante
ocupa **2.519 bytes/unidades estimadas de entrada + 512 de salida + 256 de margen = 3.287**, por
debajo del límite de ensayo 4.096. Metas/reglas y una acción incierta permanecen intactas; los
recuerdos originales siguen idénticos. Esta comparación prueba tamaño acotado, no ahorro monetario
ni tokens reales de un proveedor. El coste de LLM del ensayo es cero: no existe ninguna llamada.

Las pruebas están incluidas por el glob actual `tests/*.test.mjs`; no se añadieron dependencias
ni se cambió package/protocolo/servidor/simulación. `git diff --check` para los archivos del corte
y enlaces locales se verifican antes de cerrar la entrega. La revisión independiente de Luna y
la revisión del principal comprobaron scopes, presupuesto, replay, stop y lectura de archivos.

## Reutilización y límites

Se revisaron [CANDIDATES](../research/unreal-assets/CANDIDATES.csv) y
[PORTABILITY](../research/unreal-assets/PORTABILITY.md): InventorySystem de ActionRPG y
BP_Holdable_BuildHammer no aportan un contrato textual/fixture portable; se dejan como referencias
para L06b/c. Este corte reutiliza Node/node:test. GameClient/WsTransport/C01 serán la base de L01.
Las fuentes Unreal permanecen intactas; no se importó arte ni un framework de inferencia.

La fuente permitida es exclusivamente **fixture**. La coincidencia de ownerId/controlRevision local
no autentica al usuario ni revoca control en el servidor. Tampoco hay un personaje admitido en el
mundo, asistencia PvE física, chat del runner, observabilidad autoritativa, persistencia aislada de
memorias, reservas monetarias, provider/BYOK elegido o despliegue. `confirmed` significa evidencia
de la fixture, con durability not_applicable; no acredita guardado del juego.

Siguiente corte **L01a**: conectar el contrato con un personaje por red normal; capturar snapshots
confirmados antes de predicción/eventos antes de deduplicación visual, emitir inputs normales y
exponer archivos vigentes. L01b/c verificarán chat/reentrada; control autoritativo L02c, inferencia
L03, memoria persistente L04, gasto/panel L05 y convivencia/percepción L06 tienen su propia aceptación.
