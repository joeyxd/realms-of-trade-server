# L00 — interfaz textual de jugador para agentes

2026-10-07. **Pilar esencial; contrato v1 y fixture verificados localmente, después de C01 chat.** Continúa
[PLAN-EXTRA-LLM](../../PLAN-EXTRA-LLM.md), conversación del 2026-10-05/commit `1b5c2fa`.
El autor pidió recuperar ese contexto para incorporarlo al desarrollo del juego. Esta preparación
recoge su decisión posterior de promover agentes a parte esencial y comenzar por el
[chat ingame C01](c01-chat.md). Desarrollo incremental dentro de [PLAN-DELIVERY](../../PLAN-DELIVERY.md).

Ampliación solicitada por el autor el mismo día: completar el plan por líneas de acuerdo antes de
implementar la siguiente parte. El registro único vive en
[PLAN-EXTRA-LLM §4](../../PLAN-EXTRA-LLM.md#4-cortes-de-desarrollo-y-aceptación).
Identidad aceptada por el autor el mismo día: personaje propio, plaza normal, capacidades autorizadas
y stop del dueño. También acordó libertad de metas/acciones dentro de límites de gasto del usuario
y archivos de personalidad, memoria y objetivos visibles para su dueño. **Experiencia inicial también
aceptada:** conversación, movimiento y ayuda en PvE; después comercio, construcción y barcos.
**L00b aceptada con poda, compactado y optimización del prompt:** percepción con frescura y
confirmado/predicho/recordado separados, usando contexto pertinente y acotado. **L00c también
aceptada:** órdenes identificables, acotadas y cancelables, con feedback que distingue envío,
ejecución, confirmación, rechazo e incertidumbre. **L00d aceptada:** ciclo con decisiones simuladas,
errores, desconexiones, cancelaciones e historiales enormes antes de conectar un LLM. **L01a aceptada:**
cliente textual sin gráficos que entra como jugador normal, observa/actúa con feedback y permite
ver personaje/archivos. **L01b aceptada:** recibir/enviar Mundo, Cerca y susurros con identidad/reglas
comunes y solo mensajes entregados al personaje. **L01c aceptada:** stop/muerte/desconexión limpian
tareas/inputs; reentrada con estado fresco, descartando órdenes/respuestas antiguas y conservando
resultados inciertos sin repetir acciones automáticamente.
**L02a aceptada:** ir a un punto, seguir y mantener distancia, respetando colisiones y reportando
progreso/llegada/bloqueo/cancelación sin consultar al LLM cada paso. Controlador/pruebas pendientes.
**L02b aceptada:** modos agresivo, defensivo y de apoyo para atacar, proteger, retirarse y reaccionar
a amenazas en PvE mientras la mente piensa, respetando recursos, daño, colisiones y tiempos de recarga
del jugador. Controlador/pruebas pendientes.
**L02c aceptada:** stop/revocación del dueño prevalecen y el servidor invalida el control anterior,
cancela tareas, limpia entradas pendientes y rechaza respuestas tardías; un solo controlador autorizado
por personaje. Revocación/pruebas pendientes.
**L03a aceptada:** mente LLM intercambiable con decisiones estructuradas, contexto relevante/compacto
y límites de tokens/gasto/tiempo desde la primera consulta; latencia o fallo no detienen el cuerpo.
Integración, valores de límites y pruebas pendientes.
**L03b aceptada:** conversación con personalidad por Mundo, Cerca y susurros dentro de sus permisos,
usando solo mensajes entregados al personaje y distinguiendo charla de órdenes autorizadas; el chat
no amplía permisos y se evitan bucles de respuestas entre agentes. Conversación/pruebas pendientes.
**L03c aceptada:** elegir y ajustar metas con feedback del juego dentro de permisos/presupuesto,
actualizando objetivos visibles mientras el cuerpo actúa; validar el ciclo completo junto a un humano
en un encuentro PvE. Integración y prueba del escenario pendientes.
**L04a aceptada:** conservar personalidad, objetivos y recuerdos entre sesiones; recuerdos/resúmenes
con fuente y vigencia, recuperación de lo relevante y compactado trazable dentro del presupuesto del
prompt. Persistencia y pruebas pendientes.
**L04b aceptada:** el dueño consulta/exporta los archivos reales de personalidad, memoria y objetivos,
y borra recuerdos con sus resúmenes e índices derivados; aislamiento por dueño y reglas claras de
retención. Gestión, detalles de retención/migración y pruebas pendientes.
**L05a aceptada:** límites de gasto de inferencia fijados por el dueño, reserva antes de cada operación
incluido compactado, registro de consumo, bloqueo de nuevas llamadas sin presupuesto suficiente y aviso
al dueño; claves de inferencia fuera del juego. Operación, importes/unidades/periodos y pruebas pendientes.
**L05b aceptada:** panel del dueño con modelo/estado/tarea/consumo/límites, distinguiendo gasto
medido/estimado/desconocido; consulta de archivos reales de personalidad/memoria/objetivos, ajuste de
límites y stop. Panel y pruebas pendientes.
**L06a aceptada:** piloto social/PvE para un grupo pequeño, agentes identificables y percepción/permisos
del personaje exigidos por el servidor; comprobar aislamiento y carga antes de ampliar acceso.
Piloto, autoridad de percepción y pruebas pendientes.
**L06b aceptada:** inventario y compra/venta dentro de permisos y presupuesto del juego, separado de
inferencia; mismas reglas humanas y guardado/recuperación verificados antes de habilitar cada operación,
sin duplicar cobros ni objetos al reintentar o reconectar. Comercio, contratos y pruebas pendientes.
**L06c aceptada:** construir mediante el cuerpo y comandos comunes del jugador, con planos válidos,
propiedad y límites de materiales/gasto; desmontar/destruir son capacidades autorizadas por separado.
Construcción, permisos y pruebas pendientes.
**L06d aceptada:** tareas autorizadas de tripulación/navegación, mente para destino/táctica y cuerpo
para los mismos mandos humanos, respetando permisos del barco, carga y colisiones; empezar con una ruta
costera y una tarea de cubierta. Cuerpo naval, permisos y pruebas pendientes.
**L06e aceptada:** evaluar con humanos experiencia, recuperación, efectos económicos, coste de
inferencia y carga del servidor antes de decidir ampliar o ajustar el piloto con evidencia.
Evaluación, evidencia y decisión pendientes. Las 22 líneas L00a–L06e quedan acordadas como dirección;
El primer contrato ejecutable L00 y su fixture están implementados en este checkout:
[contrato v1](../agents/interface-v1.md), [evidencia local](../delivery/l00-agent-interface.md).
L01–L06 siguen pendientes. Sigue L01a: adaptar la red normal a observaciones/órdenes/resultados,
personaje admitido y archivos vigentes visibles, antes del LLM.

## Experiencia que queremos

Un agente externo controla un personaje real que los humanos ven en el mundo. Recibe lo que el
personaje puede conocer por texto y herramientas; conversa, elige objetivos y cambia de táctica.
Su dueño fija capacidades y límites; el agente decide libremente dentro de ellos sin aprobación
por cada acción autorizada. El dueño puede detenerlo y leer sus archivos vigentes de personalidad,
memoria y objetivos. El contenido y estado de las metas visibles deben reflejar lo que usa el runner.
Un cuerpo programado ejecuta movimiento, puntería, habilidades y conductas rápidas. El servidor
decide las consecuencias y el agente recibe feedback para ajustar su siguiente decisión.

**Observar → decidir/conversar → ordenar al cuerpo → inputs normales → servidor → observar resultados.**

El LLM es la mente; el cuerpo aporta ejecución y reflejos. Una respuesta del modelo puede cambiar
de táctica por un evento relevante, pero el juego continúa mientras responde. El sistema de decisiones
y recuerdos vive fuera de `src/sim/**`. Determinismo del cuerpo significa repetir sus resultados con
las mismas observaciones, inputs y semilla; no presupone que el LLM repita la misma decisión.

## Base comprobada al preparar el brief

| Pieza actual | Reutilización y límite |
|---|---|
| `src/client/gameClient.js` | No necesita renderer; recibe estado/eventos, predice y reconcilia al jugador. Su estado predicho no es confirmación autoritativa. |
| `src/net/wsTransport.js` | Admite una implementación WebSocket inyectada; envía inputs y despacha snapshots/mensajes. Falta el adaptador textual de agente. |
| `src/net/protocol.js` | Revisión inicial 19; C01 incorpora mensajes `CHAT_*` en 20 y las entregas navales posteriores siguen avanzando el protocolo. Importar/verificar la constante vigente al implementar; L00 tiene versión propia 1. |
| `src/net/localServer.js` | `playerCommand` valida y despacha comandos; su `true` significa despacho, no éxito ni guardado durable. `snapshot.ack` tampoco confirma daño, compra o meta completada. |
| `tools/nettest.mjs` / `tools/botbrain.mjs` | Referencias de cliente Node y reacción de combate. Separar preparación dev de inputs de jugador; no son navegación general ni integración LLM existente. |
| `talk` / `src/ui/dialog.js` | Diálogo con NPCs. La conversación humana/agente usa el nuevo contrato común C01, con mundo/cerca/susurro. |

Los milestones activos y su continuidad se revisaron en HANDOFF, PLAN-DELIVERY, DESIGN y M4.8/M5.
Este brief no acepta pendientes navales, visuales ni de persistencia.

## Después del chat: L00, luego L01a

L00 define esquemas, permisos, límites y escenarios; añade un adaptador de decisiones simuladas en
una fixture aislada. L01a, acordada como dirección, conecta ese contrato a un personaje por la red normal;
su adaptador sigue por construir. L02 añade conductas
seguir/proteger/mantener distancia; L03 conecta el primer LLM. Memoria y BYOK conservan L04/L05.

| Corte L00 | Línea que debemos cerrar | Entregable concreto |
|---|---|---|
| L00a | Personaje propio/plaza normal, autonomía dentro de capacidades y gasto del dueño, stop y archivos de personalidad/memoria/objetivos visibles. | Ficha/control/ciclo y archivos de fixture concretados; presupuestos separados descritos. Admisión/archivos reales L01, revocación del servidor L02c y gasto real L05/L06 pendientes. |
| L00b | Percepción permitida con frescura y hechos/predicción/recuerdos separados; seleccionar, podar y compactar el contexto dentro de presupuesto. | Esquema/ensamblador local, poda y compactación exacta trazable verificados; observabilidad autoritativa y conteo del proveedor pendientes. |
| L00c | Orden identificable, acotada y cancelable, con feedback de envío/ejecución/confirmación/rechazo/cancelación/incertidumbre. | Esquemas, correlación, límites, stop y recibos tardíos verificados con fuente fixture; resultado real por tipo de acción pendiente en L01. |
| L00d | Ciclo completo con decisiones simuladas, errores/desconexiones/cancelaciones e historial enorme antes de conectar un LLM. | Fixture reproducible y pruebas locales; 50.000 registros sintéticos dejan contexto acotado y pendientes intactos. No hay red, física ni inferencia. |

**L00 v1 verificado en laboratorio local:** [contrato](../agents/interface-v1.md) y
[evidencia](../delivery/l00-agent-interface.md). Defaults de ensayo configurables; cifras de producto,
proveedor, operación y presupuestos monetarios siguen por acordar en sus cortes.
L01c tiene dirección acordada y verificará cierre/reentrada; L02c tiene principio acordado y construirá
la revocación autoritativa y el control exclusivo por personaje. Un eventual relevo del avatar humano
sigue como modalidad futura separada. Acordar estas líneas no equivale a pasar sus pruebas.

Archivos implementados para el primer corte: `docs/agents/interface-v1.md`, módulos aislados bajo
`tools/agent/`, fixtures y pruebas específicas. El principal conserva arquitectura, integración y
contratos compartidos; Luna puede inventariar campos y verificar escenarios en archivos disjuntos.
Si es necesario cambiar protocolo/servidor, preparar ese cambio como corte propio con su dueño.

Un runner de terminal con JSON por líneas prueba el contrato sin depender de un proveedor ni framework.
El comando de L00 es `node tools/agent/lab.mjs`; emite JSON por líneas y lee archivos de fixture.
No es todavía un runner conectado ni una elección de modalidad D-A3.
Cada herramienta usa argumentos tipados y una lista de acciones admitidas; texto del modelo no ejecuta
código ni se convierte directamente en comandos arbitrarios del servidor.

| Operación propuesta | Primera entrega | Resultado que debe expresar |
|---|---|---|
| `observe` | L00/L01a | Estado propio confirmado, entidades observables, cambios recientes, acciones disponibles, tick y antigüedad. Texto y datos describen los mismos hechos. |
| `act` | L00/L01a | Movimiento/apuntado/ataque/habilidad permitida por un tramo corto; identidad de acción y secuencias emitidas. Distingue envío de resultado observado. |
| `interact` | L01a | Una interacción existente sin gasto, como diálogo con NPC, vinculada a un objetivo vigente y al evento privado correspondiente. |
| `stop` | L00/L01a | Cancela la tarea y libera entradas; informa qué quedó aplicado y qué sigue incierto. Desconectar también limpia tareas. |
| `set_goal` | L02 | Meta, modo y restricciones; progreso/fallo/interrupción del cuerpo, con inputs normales y duración limitada. |
| `say` | C01 transporte, L01b adaptador del runner | Mundo/cerca/susurro usando identidad de sesión y audiencia autorizada; routing confirmado, límites y rechazo explícito. Lectura humana no se deduce del acuse. |

Cada sesión declara capacidades disponibles. Una función futura devuelve `unsupported`; no se anuncia
como ejecutable. Los nombres de herramientas son propuestas, no una API publicada.

## Percepción y feedback

- Separar estado confirmado del servidor, predicción local y conocimiento/recuerdo. Campos ausentes
  son desconocidos; no rellenarlos con supuestos. Incluir mundo/sesión/personaje, revisión de observación,
  tick recibido y antigüedad; el reloj del runner mide frescura fuera de la simulación.
- Los snapshots actuales recorren entidades del mundo. Definir observabilidad antes de enviarlos al
  modelo: estado privado propio y entorno permitido, con radio/oclusiones/eventos a especificar.
  Un filtro inicial del runner solo valida el piloto aislado; no prueba un límite impuesto por el servidor.
  L00 documenta qué conoce también un humano y qué no debe exportarse.
- Correlacionar cada orden con `actionId`, observación usada, autorización de control y rango de inputs.
  Estados mínimos propuestos: aceptada por el adaptador, ejecutándose, completada, rechazada,
  cancelada y resultado incierto. «Aceptada» no significa «completada».
- Cancelar corta tareas/inputs aún pendientes y refleja efectos ya confirmados e incertidumbre;
  no revierte automáticamente daño o gastos aplicados. Definir duración y feedback por tipo de orden.
- Describir daño/posición/interacción con eventos y snapshots confirmados. Un ACK de secuencia indica
  procesamiento del input; si no existe evidencia suficiente del resultado, conservar la incertidumbre.
  El estado de una meta del cuerpo y el resultado de una operación del juego son contratos distintos.
- Invalidar objetivos cuando desaparecen o cambia su ciclo de vida; una entidad nueva que reutiliza
  el mismo número no hereda la tarea anterior. Acotar cola de eventos e indicar pérdida de historial
  con una observación completa, en vez de fingir que no ocurrió nada.
- Cadencia/eventos del LLM, horizonte de acción, tamaño de contexto y timeouts serán configuración
  con defaults documentados en L00. La simulación no espera inferencia. Revalidar o descartar decisiones
  tardías y agrupar eventos para evitar una consulta por tick/proyectil.

Ejemplo de feedback esperado, ilustrativo: «Orden a17: acercamiento cancelado; el objetivo dejó de ser
observable en tick 1240. Posición confirmada (8, 12); sin confirmación de impacto». No inventar una
causa específica cuando solo conocemos que faltó respuesta.

## Contexto y memoria dentro de presupuesto

Requisito del autor acordado al aceptar L00b: **pruning, compactado y optimización** para que los
recuerdos no formen prompts enormes/caros. El archivo de memoria visible al dueño se conserva bajo
su política de retención; cada consulta usa selección pertinente, eventos deduplicados y resúmenes
con fuente/vigencia. Fuentes, resúmenes y revisión usada siguen accesibles al dueño.

L00 define presupuesto por bloque y de la petición completa: instrucciones, personalidad esencial,
herramientas, observación, objetivos, chat, recuerdos y reserva de salida/margen. Los permisos/límites,
metas/restricciones actuales y acciones pendientes/resultados inciertos son obligatorios. Si ni ese
mínimo cabe, no enviar la consulta y explicar el límite; recortar historial no convierte un resultado
incierto en completado. Concretar tokenizer/conteo o estimación al elegir modelo, sin cifras inventadas.

L03 incorpora el ensamblador desde la primera consulta, antes de la persistencia L04. Primero selección,
deduplicación y reutilización de resúmenes; compactado LLM opcional por hitos/umbrales y en bloques
acotados, con coste/frecuencia/reintentos incluidos en el presupuesto del usuario. Si falla, usar
selección acotada existente sin bloquear el tick. El plan detalla el
[diseño de contexto compacto](../../PLAN-EXTRA-LLM.md#contexto-compacto-poda-y-coste).

## Reutilización revisada para L00

Cruce con [candidatos Unreal/FAB](../research/unreal-assets/CANDIDATES.csv) y
[portabilidad](../research/unreal-assets/PORTABILITY.md): InventorySystem de ActionRPGStarterSystem
es referencia conceptual para economía futura L06b, no un contrato ejecutable en Node;
`BP_Holdable_BuildHammer` corresponde a construcción L06c. Sus Blueprints/widgets no resuelven
esquemas, contexto o fixtures textuales. L00 no exporta/importa esos recursos ni arte.
Reutiliza Node y `node:test` ya disponibles; GameClient/WsTransport/C01 se integran en L01.

## Control y alcance inicial

**Acuerdo de identidad/autonomía:** personaje propio asociado a su dueño, plaza normal y permisos
configurados por ese dueño. El agente elige metas y acciones dentro de esos permisos y límites,
sin confirmación por cada acción autorizada; el dueño puede detenerlo. El contrato separará límite
de inferencia del gasto de moneda/materiales del juego, con unidad/periodo, reservas y consumo
confirmado. Sin presupuesto suficiente de inferencia se bloquean nuevas llamadas y se avisa al dueño,
según L05a. Cifras, continuidad del cuerpo y agotamiento de los límites de bienes del juego siguen por
concretar; el agente no puede elevarlos. Este acuerdo no concede por sí mismo una capacidad económica
todavía no implementada.

**D-A2 acordada:** comenzar por conversación, movimiento y ayuda en PvE; las capacidades de
comercio, construcción y barcos se añaden después. **Preparación recomendada del laboratorio:**
instancia local separada, mundo/perfiles propios y admisión normal de personaje. Sin credenciales de
proveedor ni inferencia pagada para demostrar L00/L01a. Permisos iniciales: observar, movimiento,
combate PvE básico, interacción sin gasto y detener. Compras, transferencias, retirada/construcción,
perlas, pilotaje y PvP quedan fuera de ese conjunto hasta aceptar sus contratos.

Usar la misma física, colisiones, daño y cooldowns que un jugador. Nunca publicar `dev`, teleport o
god mode como herramientas del agente. Una fixture puede preparar un escenario antes de la sesión,
pero sus privilegios no pasan al runner. El personaje sigue sujeto a daño al detenerse.

Revisión de control ligada a sesión/personaje; invalidar tareas y respuestas pendientes al desconectar,
morir o revocar. L02c verificará control exclusivo y revocación del servidor; un eventual relevo humano
requiere una modalidad y contrato propios. Una revisión local no acredita revocación autoritativa;
el epoch del ensayo naval tampoco es automáticamente una autorización de agente.

La dirección de L01b está acordada; su adaptador está pendiente. Conversación C01/L01b separa
chat/órdenes del dueño, datos del mundo y permisos. El texto recibido no
eleva capacidades. El runner escucha mundo/cercanía y susurros dirigidos a su personaje; no conversaciones
privadas ajenas. Verificar recepción real en ambos clientes. L03 añade respuestas elegidas por el LLM.

## Archivos visibles para el dueño

Requisito acordado: acceso al contenido real y vigente de **personalidad, memoria y objetivos**,
aislado por dueño/personaje/mundo. L00 define campos, revisión y cómo se exponen; el primer runner
L01 los hace legibles, incluida memoria de sesión; L04 añade persistencia/retención y L05 una UI
que facilita el acceso. La visibilidad se incluye desde el runner, sin esperar a la memoria avanzada.

Los objetivos muestran prioridades, restricciones, estado/progreso y cambios escogidos por el agente.
La memoria distingue hechos confirmados, observaciones e hipótesis, con fuente/vigencia. Indicar
qué versión de personalidad/objetivos usa el runner. Formatos candidatos: `personality.md`,
`objectives.json` y `memory.jsonl`; son propuestas, no archivos ya creados. Exportar, borrar o editar
tendrá controles y revisiones por concretar; el acceso del dueño no hace esos datos públicos.
Permisos/presupuesto se validan por separado: cambiar texto de objetivos o recuerdos no los amplía.

## Reutilización y coordinación

Para el primer cliente textual, reutilizar personajes/mapa y transportes existentes. No hay necesidad
de arte nuevo. Al implementar, cruzar cualquier UI/asset concreto con SUMMARY/CANDIDATES/PORTABILITY
del inventario Unreal/FAB y registrar los candidatos revisados; este brief no afirma una nueva exportación.
Preservar cambios visuales ajenos y no reiniciar el host público como parte del laboratorio.

## Evidencia para aceptar el primer corte

1. Contrato versionado con capacidades, campos disponibles/desconocidos, permisos, límites/defaults
   y política de observación; decisiones simuladas válidas/incorrectas producen resultados comprobables.
2. En L01a, otro cliente observa al personaje mover/apuntar/actuar con inputs normales. Texto y estado
   confirmado coinciden; una predicción revertida nunca se registra como éxito confirmado.
3. Objetivo perdido/reutilizado, acción no permitida, estado obsoleto, timeout y desconexión no dejan
   tareas largas o inputs retenidos. Resultado incierto se conserva como tal.
4. Repetición de las mismas observaciones/inputs/semilla verifica el cuerpo básico. El host sigue
   avanzando cuando el decisor simulado tarda o falla; no hay llamadas LLM dentro de `src/sim/**`.
5. Informe del corte con base Git, alcance, evidencia y límites. L01b/L02/L03 requieren su propia
   aceptación: este brief no prueba chat, navegación general, memoria ni convivencia en producción.
6. El contrato describe archivos visibles y presupuestos separados; en L01 el dueño puede leer la
   personalidad, metas y memoria de sesión que usa el runner. Cambios de meta quedan reflejados y
   ni el modelo ni esos archivos pueden ampliar capacidades o límites del dueño.
7. Fixtures con historial enorme/repetido quedan dentro del presupuesto de contexto sin perder
   reglas/metas ni operaciones pendientes; resúmenes conservan fuentes/incertidumbre y no borran
   originales. En L03 medir entrada/salida y coste del compactado, comprobando crecimiento acotado.

Primera demostración objetivo: humano y personaje del runner en la misma instancia aislada; humano
ve movimiento/acción y el runner recibe explicación verificable del resultado, además del chat común C01.
Después cuerpo de apoyo y una decisión LLM, por cortes. La economía compartida espera D09/M5 y L06.
