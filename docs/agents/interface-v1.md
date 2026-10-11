# L00 · contrato textual v1 de laboratorio

2026-10-07. Contrato ejecutable y ensayo **locales**, proveedor neutral. Continúa el
[brief L00](../briefs/l00-agent-interface.md) y el [plan acordado](../../PLAN-EXTRA-LLM.md).
La versión `AGENT_INTERFACE_VERSION = 1` es propia de esta interfaz; el protocolo del juego
se versiona por separado en `src/net/protocol.js`. L01 importará su constante vigente.

## Probarlo y leer sus archivos

Desde la raíz del repo:

```powershell
node tools/agent/lab.mjs
node --test tests/agent-interface.test.mjs tests/agent-context.test.mjs tests/agent-lab.test.mjs
```

El ensayo emite JSON por líneas: archivos usados, input normal, ACK sin resultado, recibo de fixture,
stop e historial acotado. Todas las evidencias llevan `source: "fixture"`. Sus posiciones/resultados
están declarados por la fixture; no son movimiento físico ni respuestas de un servidor conectado.

Lee realmente estos archivos y comunica sus rutas al dueño:

- [Personalidad](../../tools/agent/fixtures/personality.md).
- [Objetivos](../../tools/agent/fixtures/objectives.json), con revisión y ámbito.
- [Recuerdos originales](../../tools/agent/fixtures/memory.jsonl), con certeza, fuente y vigencia.

Son archivos de prueba públicos del repo. L01 expondrá los archivos vigentes del personaje real;
L04 añadirá almacenamiento aislado, exportación, borrado y retención. Estos ejemplos no deciden
la ubicación de datos de usuarios ni la modalidad local/alojada de D-A3. Podar el contexto nunca
reescribe ni elimina estos originales. La prueba comprueba que el archivo de memoria sigue idéntico.

## Identidad, autorización y ciclo de vida

`AgentLabSession` recibe del controlador de la fixture un permiso de forma exacta:

```json
{
  "v": 1,
  "scope": {
    "ownerId": "owner-lab", "characterId": "brisa-lab",
    "worldId": "world-lab", "sessionId": "session-lab"
  },
  "controlRevision": 1,
  "expiresAtMs": 100000,
  "capabilities": ["move", "aim", "attack_pve"]
}
```

Los IDs son cadenas opacas de 1–100 caracteres `a-zA-Z0-9:_-`; revisiones, ticks y tiempos son
enteros seguros no negativos. La fixture usa tiempo virtual monotónico en milisegundos, inyectado
desde fuera de la simulación. L01 admite un invitado en una plaza normal; L02c añade cuentas y
control opt-in del servidor. Esta ficha local no demuestra autenticación ni reserva una plaza.

El modelo puede proponer órdenes; no recibe la API del controlador para cambiar permisos,
interrumpir por eventos ni registrar evidencia. Esas llamadas pertenecen al adaptador de confianza.
`stop(ownerId, nowMs)` verifica coincidencia del dueño dentro del ensayo. Identificar al dueño por
una cadena tampoco acredita autenticación real. [L02c](authority-runner.md) añade un grant del
servidor en el modo autenticado opt-in; esta fixture sigue sin acreditar propiedad.

Stop, revocación, muerte, expiración o desconexión retiran la tarea activa, devuelven input neutral,
invalidan la observación vigente e incrementan la revisión de control. La sesión queda detenida.
Una reentrada requiere otra instancia, nueva `sessionId`, permiso y observación fresca; no migra
tareas antiguas. El historial incierto se conserva como registro, sin volver a emitir sus acciones.
El stop no revierte efectos aplicados ni concede invulnerabilidad.

## Observación normalizada

`observe` admite exclusivamente la versión y estos campos:

| Campo | Significado |
|---|---|
| `scope`, `controlRevision` | Personaje/sesión/autorización a los que pertenece. |
| `revision`, `tick`, `receivedAtMs` | Revisión creciente, tick no decreciente y recepción usada para frescura. |
| `source` | Solo `fixture` en L00; no aceptar predicción como evidencia. |
| `confirmed.self` | `{position:{x,y,z}, hp, maxHp, dead}`; muerto equivale a HP cero. |
| `confirmed.entities` | Lista de `{ref:{entityId,life}, kind, position, hp}`; `kind` es player/npc/enemy. |
| `confirmed.combat` | Extensión opcional L02b de reservas/estado propios confirmados; forma exacta en [cuerpo PvE](pve-runner.md). Necesaria para `body_pve`. |
| `predicted` | Estado propio con la misma forma, o null; se mantiene separado del confirmado. |
| `chat` | Mensajes ya entregados `{id, channel, sender, recipient, text, tick}`. |
| `historyGap` | Número conocido de eventos omitidos; cero solo cuando no se conoce pérdida. |

La posición está en unidades del mundo, X/Z horizontal y Y vertical. Números finitos con valor
absoluto ≤1.000.000; HP propio entre cero y máximo positivo. HP de otra entidad puede ser `null`
si se desconoce. `entityId` es un entero y `life` un ID de ciclo de vida: reutilizar un número de
entidad no hereda órdenes. L01 debe producir esa identidad a partir del ciclo de spawn/despawn
confirmado; la retención visual del renderer no es evidencia de que siga viva.

`chat.channel` es world/local/whisper, con texto de hasta 280 puntos Unicode en fixture L00 y
hasta 1000 en fuente server (límite configurado de C01; 300 por defecto). Recipient es null
para canales compartidos. Un susurro normalizado requiere emisor o destinatario igual al personaje;
el adaptador mapeará las identidades opacas de C01 después de comprobar entrega a su sesión.
No ampliar audiencia a partir del contenido del mensaje. L00 valida la forma de mensajes de fixture;
recepción/envío reales y `CHAT_RESULT` están en [L01b](chat-runner.md). Routing no demuestra lectura humana.

La observación del laboratorio ya está filtrada por su productor. L00 no inventa radio u oclusiones
de percepción. Los snapshots actuales incluyen entidades del mundo; un filtro del runner en L01
solo protege el ensayo aislado. L06a requiere límites de percepción impuestos por el servidor.
No exportar perfiles privados, credenciales, mensajes de terceros ni herramientas dev.

## Órdenes acotadas y feedback

Todas las órdenes tienen forma exacta, sin campos adicionales:

```json
{
  "v": 1, "actionId": "action-1",
  "scope": {"ownerId":"owner-lab","characterId":"brisa-lab","worldId":"world-lab","sessionId":"session-lab"},
  "controlRevision": 1, "observationRevision": 1,
  "type": "move", "args": {"mx":1,"mz":0,"durationMs":250}
}
```

| Tipo implementado en la fixture | Argumentos exactos | Alcance |
|---|---|---|
| `move` | `mx`, `mz`, `durationMs` | Ejes entre −1 y 1, magnitud ≤1; emite intención de movimiento. |
| `aim` | `ax`, `az`, `durationMs` | Apuntado a coordenadas finitas. |
| `attack_pve` | `target:{entityId,life}`, `durationMs` | Enemigo vivo/observable confirmado; un pulso de ataque por actionId. |
| `go_to` | `x`, `z`, `tolerance`, `durationMs` | L02a: ruta planar directa, capability `move`, llegada por posición confirmada. |
| `follow` / `keep_distance` | `target:{entityId,life}`, `distance`, `tolerance`, `durationMs` | L02a: jugador observable vivo; seguir o mantener radio dentro de una tarea acotada. |
| `body_pve` | `mode`, `protect`, `retreatHpFraction`, `allowPotion`, `durationMs` | L02b: requiere `body_pve,move,aim,attack_pve`; modo reactivo con reservas propias y supresión de ataques cerca de jugadores. |

Las tareas L02a/L02b usan `maxTaskHorizonMs` (30000 ms por defecto). L02a devuelve feedback
`navigation`; [contrato de movimiento](movement-runner.md). Las tres acciones cortas
conservan `maxHorizonMs`. L02b devuelve `body` y requiere permiso explícito adicional;
[contrato PvE](pve-runner.md). No amplía autoridad del permiso local.

Las capacidades deben estar tanto implementadas como autorizadas por el permiso. Tipos futuros
devuelven `unsupported`, tipos conocidos sin permiso `forbidden`. El horizonte es un entero positivo
dentro del límite; estado obsoleto, autorización caducada, personaje muerto u objetivo perdido se
rechazan. Objetivos/compras/construcción/barcos/perlas/PvP no son herramientas ejecutables aquí.
Los inputs `{mx,mz,ax,az,btn,prs}` son intención; L01 usará los inputs normales y las mismas reglas
del servidor. L00 no acredita navegación, colisiones, daño o asistencia PvE física.

Una sola orden activa; una nueva retira la anterior. Repetir el mismo envelope canónico devuelve
el registro existente (`replay:true`), sin emitir otro ataque ni reiniciar una tarea. Cambiar datos
con el mismo ID devuelve `action_id_conflict`. No reintentar automáticamente un resultado incierto.

| Estado | Evidencia/acción |
|---|---|
| `accepted` | Validación local, todavía sin declarar envío. |
| `sent` | El adaptador registra rango de inputs `{first,last}`; no prueba entrega. |
| `executing` | La fixture sigue emitiendo dentro del horizonte; no prueba efectos físicos. |
| `confirmed` / `rejected` | Recibo explícito del productor de evidencia, con ID, tick, código y efecto. |
| `cancelled` | Retirado antes de declarar inputs enviados. |
| `uncertain` | Había inputs enviados y falta resultado final; incluye stop, pérdida de objetivo o timeout. |

El registro conserva orden, tick base, rango de inputs, ACK máximo, efectos parciales y resultado.
Un ACK nunca cambia el estado a confirmado: el servidor puede incluso avanzar ACK al descartar
un input tardío. Una tarea terminada tampoco equivale a impacto, interacción o guardado durable.
Los rangos se extienden de forma contigua; L01 será responsable de secuencias/reconexión del transporte.

El recibo de L00 tiene exactamente `v, actionId, scope, controlRevision, source, evidenceId, tick,
outcome, code, effect, durability`. Outcome es partial/confirmed/rejected; effect es null o texto
≤500 caracteres, y durability solo `not_applicable`. Tick no anterior al usado por la orden.
Recibos equivalentes se deduplican; el mismo ID con datos distintos se rechaza. Los efectos parciales
no se borran al cancelar. Un recibo tardío válido puede resolver incertidumbre con el permiso original,
pero jamás reactiva inputs ni acepta una decisión tardía del modelo. `recordEvidence` no es herramienta
del modelo; L01 necesita correlación específica por acción antes de aceptar evidencia real.

## Límites configurables del laboratorio

Son defaults de ensayo para verificar fronteras, no valores aceptados de balance o tarifas.

| `LAB_LIMITS` | Default | Unidad/efecto |
|---|---:|---|
| maxObservationAgeMs | 1500 | ms desde recepción; un estado más viejo corta inputs. |
| maxHorizonMs | 1000 | ms máximos de intención por acción corta. |
| maxTaskHorizonMs | 30000 | ms máximos de intención de movimiento L02a. |
| movementBlockedAfterMs / movementMinProgressMm | 1500 / 150 | Ventana sin avance y desplazamiento mínimo en milésimas de unidad, tras envío. |
| resultTimeoutMs | 3000 | ms adicionales tras el horizonte para declarar incertidumbre. |
| maxEntities / maxChat | 64 / 32 | Elementos por observación; exceso se rechaza. |
| maxActions / maxEffects | 256 / 16 | Registros por sesión y evidencias parciales por orden. |

Una sesión llena devuelve `action_capacity`; no elimina silenciosamente IDs/recibos para permitir
repeticiones. Tras el horizonte se devuelve input neutral aunque aún falte resultado. Cadencia
de decisión LLM, sesiones largas y archivo externo de resultados se concretarán en L01/L03.

## Prompt compacto y memoria

`buildContext` recibe `required`, un log de candidatos `memory`, `queryTags`, ámbito de memoria
`{ownerId,characterId,worldId}`, `nowMs`, límites y contador opcional `countUnits(text)`.
Required contiene exactamente **rules, personality, tools, observation, goals, pending**. Incluye
las reglas e instrucciones, todos los esquemas de herramientas y límites vigentes, personalidad
esencial, estado con frescura, metas/restricciones y cada resultado pendiente/incierto relevante.
El adaptador prepara esos bloques desde fuentes vigentes de confianza; el modelo no los sustituye.

Se toma una copia del mínimo requerido, se serializa una sola representación y se comprueba el
presupuesto. Si no cabe devuelve `required_context_over_budget`; no existe llamada de inferencia
como fallback. Un bloque ausente o dato no JSON produce error de contrato.

Cada recuerdo tiene campos exactos: `id`, revisión entera `revision`, `scope`, `text`,
`certainty` (confirmed/inferred/uncertain), `createdAtMs`, `validUntilMs` (entero o null), `tags`
y `sources:[{id,tick}]`. ID ≤160 caracteres, texto ≤8000, ≤32 tags y ≤64 fuentes. Fuentes y
recuerdos no otorgan autoridad. El mínimo de pendientes se conserva aunque un recuerdo incierto
opcional no entre: la selección de memoria no sustituye el registro de acciones.

Se examina la cola más reciente de un log **ordenado por inserción** hasta maxCandidates; se
reporta el resto como historial omitido. Se descartan forma inválida, otros ámbitos, expirados o
fechas futuras; por ID se conserva la revisión más alta dentro de esa ventana. La recuperación
de recuerdos antiguos por índice relevante llegará en L04, sin leer todo el archivo por consulta.

`compactMemory` agrupa solo texto/certeza/tags/ámbito idénticos; conserva fuentes originales con
ID/revisión, fecha y vigencia del grupo en bloques de fuentes acotados. IDs derivados SHA-256 son
de longitud acotada. No parafrasea ni inventa hechos, ni convierte hipótesis/incertidumbre en certeza.
El dueño podrá inspeccionar originales y derivados; el log se mantiene intacto.
Selección posterior: coincidencias con tags de la meta, recencia e ID estable; material opcional
que exceda un tope se omite. El informe devuelve IDs seleccionados, motivo/conteo de omisiones,
duplicados, bytes y unidades; `missingHistory` marca la ventana truncada.

| `DEFAULT_CONTEXT_LIMITS` | Default | Significado |
|---|---:|---|
| maxInputBytes | 12000 | Techo UTF-8 del documento completo. |
| maxContextUnits | 4096 | Entrada + reserva de salida + margen. |
| outputReserveUnits / marginUnits | 512 / 256 | Reservas incluidas antes de seleccionar memoria. |
| maxMemoryUnits | 1000 | Techo adicional de recuerdos seleccionados. |
| maxCandidates / maxSelected | 2000 / 32 | Trabajo de selección y elementos opcionales por consulta. |

El contador default usa bytes UTF-8 como **estimación de unidades**, reportada como
`estimated_utf8_bytes`: no afirma contar tokens de un modelo. Un contador inyectado devuelve
enteros no negativos y se reporta `injected_units`; L03 deberá validar tokenizer, envoltura real
del proveedor y schemas completos antes de anunciar un tope de tokens. El informe no se añade
automáticamente al prompt: si el adaptador añade texto, deberá volver a contarlo.
Compactado semántico opcional con LLM, cachés persistentes e índices pertenecen a L03/L04.

## Presupuestos del dueño separados

La autonomía usa capacidades otorgadas sin aprobación por cada paso. El dueño puede reducirlas
o detener la sesión; editar recuerdos/metas no aumenta permisos ni presupuestos. L00 no realiza
gastos: **cero llamadas de inferencia** y ninguna operación económica implementada.

| Control | Contrato para los siguientes cortes |
|---|---|
| Contexto por petición | Límites anteriores: cortar opcionales; bloquear si el mínimo no cabe. |
| Inferencia del dueño | Unidad/periodo y límite de llamadas/tokens/coste explícitos; reservar antes de consulta, resumen, embedding o reintento; consumo confirmado/estimado/desconocido separado. |
| Respuesta perdida de inferencia | Mantener reserva incierta hasta reconciliar; no devolver gasto supuesto disponible ni repetir automáticamente. |
| Bienes del juego | Moneda/materiales/operaciones con límites propios y contratos autoritativos; no habilitados por tener presupuesto LLM. |
| Agotamiento | Inferencia insuficiente bloquea nuevas llamadas y avisa; en esta fixture no hay llamadas que continuar. Bienes bloquean el gasto correspondiente. |

Importes, periodos, proveedor/modelo y continuidad de tareas con inferencia agotada se decidirán
en L03/L05; presupuestos de bienes y recuperación en L06/D09. No hay reserva monetaria real ni
cobro implementado por este contrato. Claves/cuenta y datos privados no se meten en prompt ni archivos
de personalidad. Una modalidad alojada y PvP/offline conservan sus decisiones propias.

## Integración siguiente

[L01a](network-runner.md) conecta estas formas a GameClient/WsTransport y a un invitado admitido
normalmente. `AgentSession({source:'server'})` valida fuentes reales explícitas; `AgentLabSession`
mantiene `fixture` obligatoria. Ninguna sesión admite evidencia de la otra fuente ni de predicción.
El adaptador conserva snapshots confirmados antes de predicción y eventos antes de deduplicación
visual. La posición observada es efecto parcial; el swing correlacionado confirma inicio sin impacto.
L01b adapta chat C01, identidad de conexión, routing/incertidumbre y contexto podado;
la capacidad local `chat` permite su sobre separado `chat_send`, sin ampliar los inputs L00 del cuerpo.
[L01c](lifecycle-runner.md) comprueba desconexión/reentrada local con archivo de incertidumbre.
[L02c](authority-runner.md) añade revocación/control exclusivo del servidor en modo autenticado opt-in;
L06a sigue pendiente para percepción autoritativa. Filtros, scope/grant local del modo invitado y
ensayos de fixture no acreditan esas autoridades. Los números/defaults de L00 siguen siendo de desarrollo.
