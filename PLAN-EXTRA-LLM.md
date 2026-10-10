# Plan esencial — jugadores agentes, cuerpo, chat y memoria

Origen: 2026-10-05. **Parte esencial del proyecto por decisión del autor, 2026-10-07.**
Sustituye la prioridad baja original. El nombre del archivo se conserva para mantener enlaces.
Cola principal: [PLAN-DELIVERY](PLAN-DELIVERY.md). Primera entrega **C01 chat ingame**, luego **L00–L06**;
construcción/barcos/comercio y persistencia continúan con sus contratos. L03a tiene integración simulada;
proveedor/modelo y operación reales siguen pendientes.

**Checkpoint AREA17, 2026-10-10:** [L06b-2a](docs/delivery/l06b-agent-market.md) implementa inventario
vigente/contexto y mercado privado list/quote, con localidad, caducidad y retiro al cambiar autoridad.
CLI y mente usan el mismo ensamblador; [montaje explícito](docs/agents/market-read.md). Se integran
los prerrequisitos locales de presupuesto/panel simulados L05, piloto L06a e inventario L06b-1;
alpha.20/protocolo 35. No hay agente público, proveedor, SQL ni compras/ventas nuevos por este corte.
L06b sigue parcial: continúa L06b-2b con presupuesto durable de bienes y operaciones sobre la misma
autoridad M5 económica humana. Proveedor, tokenizer, facturación y aceptación humana permanecen abiertos.

Contexto recuperado el 2026-10-07: conversación del 2026-10-05, documentada en el commit `1b5c2fa`.
El autor reafirma la interfaz para que agentes LLM jueguen con humanos: mente que conversa y decide,
cuerpo determinista que actúa y devuelve feedback textual. Primer corte preparado en
[L00 — interfaz textual de agentes](docs/briefs/l00-agent-interface.md); contrato/fixture locales
implementados, [evidencia](docs/delivery/l00-agent-interface.md), todavía sin integración LLM.
L01a añade [cliente por red normal y archivos vigentes](docs/agents/network-runner.md),
verificado localmente en modo invitado ([entrega](docs/delivery/l01a-agent-network.md)).
[L01b](docs/delivery/l01b-agent-chat.md) añade chat C01 y poda de contexto;
[L01c](docs/agents/lifecycle-runner.md) añade vida/reentrada local; [L02a](docs/agents/movement-runner.md)
añade ir, seguir y mantener distancia con inputs normales; [L02b](docs/agents/pve-runner.md)
añade cuerpo PvE agresivo/defensivo/apoyo. [L02c](docs/agents/authority-runner.md) verifica autoridad
opt-in del servidor y revocación local. [L03a](docs/agents/mind-runner.md) añade mente intercambiable,
presupuesto completo, poda/compactado, timeout y una consulta en curso, verificados con modelos simulados.
[L03b](docs/agents/conversation-runner.md) añade turnos de conversación sobre mensajes entregados,
personalidad, audiencia fijada y supresión acotada, verificados con modelos simulados.
[L03c](docs/agents/goals-runner.md) añade revisión explícita de metas desde feedback y escritura local
con hashes/revisión/autoridad, verificada con modelos simulados. [L04a](docs/agents/memory-runner.md)
añade memoria local persistente, recuperación pertinente y resúmenes con fuentes/incertidumbre.
[L04b](docs/agents/memory-admin.md) añade consulta/exportación byte exacta y borrado coordinado,
retención y migración explícitas, verificados localmente. L05 y el piloto L06a tienen implementación
local simulada integrada con L06b-2a; proveedor, tokenizer,
facturación y aceptación humana PvE conservan su verificación pendiente.
Ampliación posterior del mismo día: línea esencial y chat primero.

## 1. Dirección y alcance

Explorar que las personas conecten su propio modelo y presupuesto de inferencia para tener personajes
«vivos» en MAREA NEGRA: con objetivos, personalidad, recuerdos y decisiones que tengan consecuencias
reales en el mundo. Los humanos ven al personaje en el juego 3D; el agente puede jugar completamente
por texto y herramientas, sin necesitar gráficos.

La base de producto es una **interfaz de jugador para agentes externos**, independiente del proveedor
y del framework que use su dueño. El personaje participa en el mundo autoritativo que ven los humanos.
El compañero con personalidad/memoria y el runner BYOK son aplicaciones posteriores de esa interfaz;
el primer contrato puede probarse con una persona en terminal o decisiones simuladas.

La analogía del autor es un «prefrontal»: el LLM decide objetivos, enemigo prioritario, estrategia,
equipo, construcción y comercio. Un cuerpo programado ejecuta comportamientos rápidos y acciones
directas. La percepción textual y la memoria cierran el ciclo con resultados del juego.

**Acordado:** cerebro LLM/cuerpo programado, acciones directas, feedback dinámico, memoria y explorar
tokens propios, por cortes pequeños. **Decisión vigente 2026-10-07:** humanos y agentes conviven como
parte esencial; pueden hablar en canales del mundo, escuchar/hablar cerca y recibir/responder susurros
directos a ellos. El chat ingame es la primera entrega común, antes del runner y de la inferencia.
**Acuerdo posterior del mismo día:** el agente tiene personaje propio, ocupa una plaza normal y
juega junto a los humanos. Su dueño autoriza capacidades y puede detenerlo; dentro de ese alcance
el agente decide y actúa libremente, respetando los límites de gasto que fije el usuario. Los archivos
de personalidad, memoria y objetivos son visibles para su dueño. El diseño de esta base está acordado;
el contrato v1 y L01a/b/c/invitado con archivos reales, chat y reentrada están verificados localmente; vínculo de dueño,
control del servidor opt-in verificados en L02c. L03a reserva consumo por proceso; gasto durable y
operación de usuario siguen pendientes en L05.
Los límites numéricos, proveedores, reglas de balance, autonomía sin dueño conectado y cobros de este
documento son propuestas o decisiones abiertas; no se consideran aprobados ni implementados.

Aquí «tokens propios» significa credenciales/cuota de un proveedor de inferencia o un modelo local,
no moneda del juego ni el token de autenticación del personaje. La modalidad BYOK permite usar una
clave propia; el presupuesto y el comportamiento cuando se agota deben ser visibles para su dueño.

## 2. Prioridad y orden de integración

- La ruta de agentes es un pilar del juego, junto a balsa/construcción, comercio y navegación.
  **Orden propio: C01 → L00 → L01 → L02 → L03 → L04/L05 → L06**. C01 sirve también a humanos;
  no espera permisos económicos, BYOK ni un proveedor LLM. Persistencia D09/M5 sigue siendo puerta
  para operaciones con bienes en riesgo, incluso cuando las pide un agente.
- Preparar contratos, CLI, fixtures y pruebas en rutas aisladas; coordinar cambios de protocolo,
  entrypoints, perfil y archivos compartidos con sus dueños. Un escritor por archivo; worktree cuando
  convenga. El principal integra y acepta; usar GPT-6 Luna para trabajo acotado según `AGENTS.md`.
- Comenzar en una instancia de prueba con mundo y perfiles propios. Una integración compartida exige
  un corte aceptado y habilitación explícita; la mera existencia de este plan no activa agentes online.
- Hacer un corte pequeño por vez, con informe en `docs/delivery/` al completarlo. Registrar base,
  contratos, evidencia, coste medido, limitaciones y siguiente paso; no crear informes vacíos ahora.
- Antes de cada corte comprobar Unreal/FAB para cualquier necesidad concreta de arte/UI. Para el
  primer cliente textual se propone reutilizar los personajes actuales y omitir assets nuevos.
- Coordinar integración/QA entre pilares; no aceptar una entrega solo por su prioridad ni reservar
  un worker permanente. Una revisión de GPU a la vez. Registrar el siguiente corte de agentes
  en la cola principal, sin relegarlo a «cuando sobre capacidad».

## 3. Arquitectura propuesta

| Pieza | Responsabilidad y límites |
|---|---|
| Cerebro LLM | Conversar y seleccionar metas, tácticas, equipo, planes sociales y económicos. Produce decisiones con argumentos definidos; no decide autoridad ni ejecuta código arbitrario. |
| Cuerpo | Controlador local rápido: seguir, navegar, acercarse, atacar, mantener distancia y proteger. Modos agresivo, defensivo y apoyo configurables; misma física, recursos, cooldowns y validaciones del juego. |
| Acciones directas | Mover/apuntar/atacar/usar habilidad/interactuar y comandos permitidos de inventario, construcción y comercio. Duración acotada, cancelación y control humano inmediato. |
| Percepción | Resumen textual y datos estructurados del personaje: posición, salud, entidades observables, amenazas, recursos, habilidades, acciones disponibles y eventos. Incluye tick/revisión y antigüedad. |
| Memoria | Estado del plan, hechos conocidos y experiencias por personaje/mundo. Recupera contexto pertinente y conserva la evidencia de resultados. |
| Servidor | Autoridad final sobre estado, propiedad, stock, costes, daño, cooldowns y operaciones persistentes. Identifica dueño y agente; limita admisión y acciones. |

Flujo: **estado observable → percepción + recuerdos → decisión → cuerpo/acción → servidor → resultado**.
El cuerpo continúa durante una consulta; el mundo online sigue corriendo y no se pausa para el modelo.
El LLM y el almacenamiento de recuerdos viven fuera de `src/sim/**`: ninguna llamada remota ni espera
asíncrona entra en el tick autoritativo. Una secuencia de comandos aceptados debe poder reproducirse.

**Identidad acordada:** personaje independiente asociado a un dueño y ocupando una plaza normal.
Identificarlo como agente se concreta en el piloto. Transferir el personaje humano a un agente sería otra modalidad:
exigir control exclusivo, relevo explícito y revocación para evitar dos clientes mandando a la vez.
Definir desconexión, muerte/reaparición, reconexión y tareas pendientes antes de habilitar cada modalidad;
el alcance inicial recomendado sigue siendo dueño presente, con cierre al terminar su sesión;
autonomía offline permanece por decidir. La libertad dentro de permisos/gasto no exige aprobación
para cada movimiento, táctica, conversación u otra acción ya autorizada. El agente puede elegir y
revisar metas; cambiar sus permisos o elevar sus límites de gasto corresponde a su dueño.
El contrato de control tendrá una revisión, por ejemplo `controlEpoch`: una decisión se vincula a
dueño/sesión/revisión y el servidor deberá rechazar acciones de una autorización revocada, aunque la
escena siga igual. Stop y revocación deberán invalidar también las respuestas del modelo aún en vuelo.

Base existente que merece reutilización:

- `src/client/gameClient.js` y `src/net/wsTransport.js`: cliente sin renderer, recepción de estado,
  predicción/reconciliación y envío de inputs con secuencia y tick de proyectiles.
- `tools/nettest.mjs`: ejemplo de cliente Node por WebSocket y vista de combate; su fixture usa
  `dev`, teletransporte y god mode. Esa preparación no se copia a un agente del mundo compartido.
- `tools/botbrain.mjs`: política reactiva de La Caldera; sirve como referencia para amenazas/reflejos,
  no como navegación general, memoria o cerebro LLM ya hechos.
- `src/net/protocol.js` y `LocalServer.playerCommand`: comandos/snapshots y validaciones existentes.
  Antes de cada implementación verificar la versión vigente; actualizar protocolo si cambia el contrato.

### Interfaz textual para agentes externos

Propuesta de entrada: un runner sin gráficos conectado por el transporte normal del juego, con CLI y
mensajes JSON por líneas. La observación ofrece texto legible y campos estructurados con la misma
información; cualquier adaptador de herramientas posterior consume ese contrato. Elegir un proveedor,
SDK o protocolo de herramientas no es requisito para L00/L01.

El contrato distingue observar, acción directa corta, intención duradera del cuerpo, conversación y
resultado. Por ejemplo: «protege a Ana» selecciona una meta de apoyo; el cuerpo sigue/mantiene distancia
y el agente recibe «tarea interrumpida: Ana dejó de ser observable» con evidencia y tick.
Las metas del cuerpo llegan en L02; la primera interfaz prueba inputs básicos y resultados normales.
Decisiones tácticas pueden interrumpir un plan por eventos importantes; movimiento, puntería y reflejos
continúan a ritmo del cuerpo mientras el LLM responde.

Conversar usa el chat común **C01**, anterior a L00/L01. Canales aprobados: **mundo** (instancia actual),
**cerca** (radio decidido por posición del servidor) y **susurro** (solo emisor/destinatario).
El comando `talk` mantiene su diálogo con NPCs. Humanos y runners reciben el mismo contrato `CHAT_*`;
el agente observa solamente mensajes entregados a su personaje y contesta en un canal permitido.
Una invitación por chat no concede control ni permisos del personaje. En L03 el LLM podrá decidir
qué responder: C01 aporta el transporte y la privacidad, no genera conversación por sí solo.

Primera implementación: reutilizar **`ws` + WebSocket del juego** y su sesión validada; el servidor
deriva emisor y audiencia. Supabase se evalúa para historial durable posterior, Firebase/Socket.IO
implicarían otro servicio/transporte. [Contrato, reutilización y fuentes C01](docs/briefs/c01-chat.md).
La convivencia económica/PvP conserva L06; confirmar routing no equivale a lectura del destinatario.

El brief L00 concreta permisos mínimos, frescura, observación limitada, correlación de feedback y
aceptación. Los snapshots actuales necesitan revisar su alcance antes de exponerlos al modelo;
«recibido por el cliente» no significa «observable por el personaje». El acuse de inputs o el retorno
de `playerCommand` tampoco prueban que una acción consiguió su resultado.

### Decisiones, interrupciones y feedback

Contrato ilustrativo de intención, todavía sin API implementada:

```json
{
  "goal": "protect",
  "allyId": 7,
  "mode": "support",
  "targetId": 23,
  "constraints": { "stayInArena": true, "retreatBelowHpRatio": 0.25 }
}
```

El adaptador valida identidad, estado y acciones disponibles antes de aplicar la intención. El cuerpo
genera inputs cortos y secuenciados; una meta duradera no se convierte en una cola larga ininterrumpible.
Definir permisos granulares: combate/movimiento, inventario/equipar, compras con techo de gasto,
construcción/retirada, transferencias, perlas y PvP. L01 habilita solo su conjunto mínimo; las acciones
restantes se añaden al aceptar su contrato, con propiedad y consecuencias visibles para el dueño.
Definir prioridad entre órdenes autorizadas del dueño, acción directa, modo activo y evasión.
El dueño puede detener el agente. Sin presupuesto suficiente de inferencia se bloquean nuevas llamadas
y se avisa al dueño; concretar el comportamiento del cuerpo ante agotamiento o timeout, conservando
las reglas normales de daño. Un eventual relevo humano requiere una modalidad y contrato propios.

Agrupar cambios desde la observación anterior y consultar al modelo a una cadencia configurable o por
eventos relevantes: nuevo enemigo, daño importante, objetivo terminado, orden fallida, dueño hablando
o presupuesto próximo al límite. El estado rápido sigue actualizándose sin una consulta por cada bala.
Acotar frecuencia y tamaño para evitar tormentas de consultas ante muchos eventos simultáneos.
Una respuesta tardía se descarta o revalida si cambió la escena/objetivo; inicialmente una decisión
en vuelo por personaje. Errores, timeout y rate limit tienen reintentos limitados y un cierre observable.

Separar feedback predicho de resultado confirmado por el servidor. Una orden comercial enviada no
es una compra completada: registrar acuse/recibo y causa de rechazo, sin reintentar con otra identidad
ni ejecutar de nuevo una operación de resultado incierto. Usar el mismo contrato durable que el humano.

### Memoria del personaje

**Visibilidad acordada:** el dueño puede leer los archivos reales que describen personalidad,
memoria y objetivos de su agente, con su contenido vigente y revisión. El panel podrá facilitar esa
lectura; un resumen opaco no sustituye el acceso a los archivos. El contrato L00 define esa exposición;
el primer runner L01 expone personalidad, objetivos y memoria de sesión, y L04 añade recuerdos persistentes.

Estructura candidata, aún por concretar: `personality.md` para identidad/rasgos; `objectives.json`
para metas, restricciones y estado/progreso; `memory.jsonl` para episodios/hechos con fuente y vigencia.
Son ejemplos de archivos futuros, no rutas existentes ni formatos publicados. Aislarlos por
dueño/personaje/mundo, indicar actualizaciones y reflejar qué revisión usa el runner. Presupuesto y
permisos son configuración del dueño; editar un objetivo o recuerdo no puede ampliarlos.

- **Actual:** objetivo, tarea del cuerpo, restricciones, acontecimientos recientes y acciones pendientes.
- **Conocimiento:** lugares visitados, recetas, relaciones declaradas y patrones observados, con fuente
  y vigencia. Precios, stock y salud se consultan de nuevo antes de actuar.
- **Experiencias:** situación, acción aceptada y resultado; aprendizajes derivados se guardan como
  hipótesis cuando no hay evidencia suficiente. Reflexionar después del encuentro, fuera del tick.

Persistir por dueño/personaje/mundo y versión; aislar jugadores y dar controles de consulta, borrado y
exportación. Enviar solo recuerdos relevantes dentro del presupuesto de contexto. Empezar con estado
estructurado y episodios acotados; evaluar búsqueda semántica si el volumen demuestra su necesidad.
Memoria separada del perfil/save firmado de progreso; definir tamaño, saneado, retención y migración.
Un recuerdo no puede conceder oro, equipo, habilidades ni autoridad sobre el mundo.
La memoria influye en próximas decisiones, no equivale a reentrenar pesos ni garantiza aprender bien.
Textos de chat, NPCs y recuerdos son datos del mundo; no pueden elevar permisos ni cambiar las reglas
de herramientas. No guardar claves, tokens de login ni perfiles privados ajenos en recuerdos/prompts.

### Contexto compacto, poda y coste

**Requisito acordado por el autor, 2026-10-07:** percepción L00b aceptada, con mecanismos de pruning
(poda), compactado y optimización del prompt para evitar que los recuerdos produzcan consultas enormes
y caras. **Memoria almacenada y contexto enviado son capas distintas**: el dueño conserva acceso a
fuentes y resúmenes; cada decisión recupera solo un subconjunto pertinente dentro de un presupuesto.
L00 define el contrato/límites, L03 los aplica desde la primera consulta y L04 añade memoria persistente.

Diseño inicial del ensamblador, por concretar al implementar:

1. Mantener bloques obligatorios acotados: reglas/capacidades y límites vigentes, personalidad esencial,
   objetivo/restricciones actuales, estado reciente y acciones pendientes/resultados inciertos. La
   selección de recuerdos nunca elimina estas obligaciones ni convierte incertidumbre en éxito.
2. Usar cambios y eventos pertinentes, deduplicar repeticiones y recuperar recuerdos por relación con
   la meta, relevancia, antigüedad y vigencia. Acotar también observación, chat, herramientas y feedback;
   elegir una representación compacta por hecho sin repetirlo en prosa/JSON/historial. Recibir más
   snapshots no significa acumularlos todos en el prompt.
3. Compactar episodios antiguos en resúmenes estructurados con fuente/IDs, alcance y fecha/revisión;
   conservar hechos, hipótesis y resultados inciertos separados. El dueño puede consultar originales
   y derivados. Podar contexto no equivale a borrar sus archivos; la retención se define por separado.
4. Reutilizar resúmenes vigentes y actualizar solo bloques nuevos/cambiados, por hitos o umbrales.
   Empezar por reglas de selección/poda sin llamadas LLM extra. Si se usa un LLM para resumir, hacerlo
   en bloques limitados, con frecuencia/reintentos/presupuesto propios; nunca por cada tick/consulta.
5. Presupuestar la petición completa: instrucciones, personalidad, esquemas de herramientas, estado,
   metas, chat, recuerdos, reserva de salida y margen. Configurar topes por consulta y por bloque;
   contabilizar entrada/salida, llamadas de compactado y embeddings si se añaden, en el gasto del dueño.
6. Si excede el presupuesto, reducir primero material opcional/repetido/antiguo con una política visible.
   Si el mínimo obligatorio aún no cabe, no enviar la consulta: comunicar presupuesto insuficiente.
   Un compactado fallido usa selección acotada existente y no detiene el tick ni dispara reintentos sin límite.

El método de conteo depende del modelo elegido; distinguir conteo medido de estimación y validar el
tope antes de llamarlo exacto. No fijar aquí importes/modelos/tokenizadores ni prometer un ahorro sin
medirlo. El dueño puede ver tamaño/uso por bloque, material omitido, revisiones y coste del compactado.

Aceptación: fixtures con historial muy grande y repetido siguen dentro del presupuesto configurado;
reglas/metas vigentes y operaciones pendientes sobreviven, los resúmenes remiten a evidencia y la
incertidumbre no se pierde. Comparar contexto seleccionado y coste total, incluido compactado, con
la referencia sin optimización; comprobar que ampliar el archivo no hace crecer sin límite cada prompt.

## 4. Cortes de desarrollo y aceptación

**Ampliación de planificación solicitada por el autor, 2026-10-07:** completar la ruta paso a paso,
con una línea que podamos acordar para cada parte. Esta sección es el registro único de esos acuerdos;
mantiene los milestones L00–L06 y los divide en cortes revisables. Dirección e implementación se registran aparte.

**Planificación acordada, 2026-10-07:** las 22 líneas L00a–L06e están acordadas como dirección;
**L00 v1 implementado/verificado en laboratorio local**, con contrato, módulos y fixture reproducible;
L01a/b/c tienen adaptador invitado/archivos reales/chat/reentrada verificados localmente;
L02a/b añaden movimiento y PvE locales acotados verificados; L02c añade autoridad opt-in verificada
por WebSocket local. L03a tiene API/ensayos simulados y L03b conversación simulada verificados;
L03c tiene metas/archivos y ciclo local simulados; L04a tiene memoria local persistente y resúmenes
simulados. L04b tiene administración local verificada; L05–L06 y aceptación humana/modelo real siguen pendientes.
[Contrato L00](docs/agents/interface-v1.md), [red L01a](docs/agents/network-runner.md).
Siguiente: L05a, límites de inferencia del dueño, reserva y reconciliación durable;
proveedor real y aceptación humana por verificar.
[Movimiento L02a](docs/delivery/l02a-agent-movement.md), [PvE L02b](docs/delivery/l02b-agent-pve.md),
[autoridad L02c](docs/delivery/l02c-agent-authority.md).

La conexión a un modelo real permanece **pendiente**; L03a verifica su API y camino simulado.
C01 está [implementado y verificado localmente](docs/delivery/c01-chat.md):
chat mundo/cerca/susurro, [pulido visual](docs/delivery/c01-chat-style.md) y
[burbujas sobre personajes](docs/delivery/c01-chat-bubbles.md). Último corte: 18/18 pruebas pertinentes y
tres clientes por UI. Regresión general anterior: 1707/1708, con timeout de servidor que pasó aislado;
causa exacta abierta. Sin despliegue ni prueba física. L00 continúa con su propia evidencia local.

### 4.1. Cómo acordamos y cerramos cada parte

Cada fila contiene una **línea de acuerdo** y una demostración concreta. Su diseño está **propuesto**
hasta que el autor lo confirme o corrija; esa confirmación no significa que ya esté construido.
Al implementar se registra por separado: pendiente → en curso → verificado localmente → publicado,
con el brief y la evidencia que correspondan. Se actualiza la misma fila, sin crear planes paralelos.

Dirección ya acordada: agentes esenciales, interfaz textual para jugar con humanos, mente LLM fuera
del tick, cuerpo determinista rápido, feedback del servidor y chat común; además personaje propio,
plaza normal, autonomía dentro de capacidades/gasto del dueño, stop y archivos de personalidad,
memoria/objetivos visibles; percepción con frescura y contexto acotado mediante poda/compactado.
Siguen abiertos los detalles del conjunto inicial de permisos y del ciclo de vida, la forma de
operar, cifras y proveedor. Los acuerdos de dirección no cierran esos detalles.

### 4.2. Ruta completa: una línea por corte

Las 22 filas L00a–L06e tienen su dirección acordada; **L00 tiene contrato/fixture locales verificados**,
con L01a/b/c/red invitada, chat, reentrada y cuerpo L02a/b verificados localmente;
L02c tiene autoridad opt-in, L03a API/mente simulada y L03b conversación simulada verificadas localmente;
**L03c tiene software/ciclo local simulados; L04a tiene memoria local y resúmenes simulados;
L04b tiene administración local verificada; L05–L06 y aceptación humana/modelo real siguen pendientes**;
**base/principio acordado** recoge las decisiones del autor sin cerrar los detalles del contrato.
El orden es C01 → L00a–d → L01a–c → L02a–c → L03a–c → L04a–b → L05a–b → L06a–e.
L04 y L05 podrán prepararse en paralelo después de L03; la tabla deja un orden de conversación claro.

| Paso | Línea de acuerdo | Lo damos por listo cuando… | Diseño / implementación |
|---|---|---|---|
| C01 | Humanos y agentes usan Mundo, Cerca y susurros; Cerca y privados aparecen sobre el personaje y el panel conserva el historial. | Routing, privacidad, radio, reintentos y burbujas están comprobados entre clientes; el runner se conecta en L01b. | Acordado / verificado localmente |
| L00a | El agente tiene personaje propio y plaza normal; decide libremente dentro de capacidades y gasto del dueño, quien puede detenerlo y ver sus archivos de personalidad, memoria y objetivos. | Hay una ficha de identidad/control, permisos y presupuestos separados, archivos visibles y ciclo de vida; alcance inicial y comportamiento al morir/desconectarse quedan concretados. | Base acordada / ficha, stop y archivos de fixture verificados localmente; admisión, control y gasto reales pendientes |
| L00b | El agente recibe estado propio, entorno observable y chat entregado, distinguiendo confirmado/predicho/recordado con frescura; el prompt usa contexto pertinente, podado y compactado dentro de presupuesto. | Contrato de campos/observabilidad y presupuesto completo; historial grande queda acotado sin perder reglas, metas ni resultados pendientes; fuentes/resúmenes siguen visibles al dueño. | Principio acordado / esquema y contexto compacto verificados localmente; percepción del servidor/conteo del proveedor pendientes |
| L00c | Cada orden es identificable, acotada y cancelable; su feedback distingue envío, ejecución, confirmación, rechazo, cancelación e incertidumbre. | Esquemas rechazan argumentos inválidos y correlacionan orden/inputs/resultados; cancelar corta lo pendiente e informa efectos ya aplicados; ACK, éxito y guardado durable son distintos. | Principio acordado / esquemas, límites y ciclo verificados con recibos de fixture; resultados reales pendientes |
| L00d | Probamos observar → decidir → actuar → recibir feedback con decisiones simuladas antes de conectar un LLM, incluyendo errores, desconexiones, cancelaciones e historial enorme. | Fixtures cubren orden válida/prohibida/obsoleta, objetivo perdido, timeout, desconexión, stop e historial enorme/repetido; límites/defaults y contexto mínimo están comprobados. | Principio acordado / fixture reproducible y pruebas verificadas localmente; no hay red ni LLM |
| L01a | Un cliente textual sin gráficos se conecta como jugador normal, observa y ejecuta acciones permitidas con feedback; humanos ven su personaje y el dueño inspecciona sus archivos. | Un humano ve movimiento/acción PvE, el runner informa estado confirmado y archivos vigentes legibles; no expone herramientas dev ni capacidades futuras. | Acordado / software invitado verificado localmente: movimiento visible en navegador, PvE de práctica y archivos reales; propiedad/control de servidor y experiencia humana pendientes ([entrega](docs/delivery/l01a-agent-network.md)) |
| L01b | El cliente del agente recibe/envía Mundo, Cerca y susurros con su identidad y las reglas del chat humano; recibe solo mensajes entregados a su personaje. | Dos clientes verifican ida/vuelta; un tercero no recibe el susurro; routing, rechazo y reintento con el mismo ID quedan visibles. | Acordado / adaptador invitado verificado localmente: tres clientes, privacidad, rechazo, retry y contexto podado; sin LLM ni autoridad de dueño ([entrega](docs/delivery/l01b-agent-chat.md)) |
| L01c | Stop, muerte o desconexión cancelan tareas pendientes y neutralizan inputs; reentrar requiere estado fresco y descartar órdenes/respuestas de la sesión anterior. | Objetivos reutilizados no heredan órdenes y resultados inciertos se conservan sin repetir efectos; no quedan entradas retenidas ni se reanuda una tarea antigua automáticamente. | Acordado / ciclo invitado verificado localmente: archivo acotado, reentrada explícita y aislamiento; neutral local y cierre, revocación de cola del servidor aún pendiente ([entrega](docs/delivery/l01c-agent-lifecycle.md)) |
| L02a | El cuerpo ejecuta ir a un punto, seguir a un personaje y mantener distancia sin consultar al LLM cada paso; respeta colisiones y devuelve progreso, llegada, bloqueo o cancelación. | Resuelve rutas acotadas con inputs normales y feedback; mismas observaciones/inputs/semilla producen la misma conducta, sin prometer navegación general. | Acordado / controlador determinista e invitado local verificados: rutas directas, radio, bloqueo, cancelación y contexto; navegación general pendiente ([entrega](docs/delivery/l02a-agent-movement.md)) |
| L02b | El cuerpo tiene modos agresivo, defensivo y de apoyo para atacar, proteger, retirarse y reaccionar a amenazas en PvE mientras la mente piensa, respetando recursos, daño, colisiones y tiempos de recarga del jugador. | Proteger, atacar y retirarse funcionan en un encuentro PvE controlado sin saltar daño, recursos, cooldowns ni obstáculos. | Acordado / controlador determinista e invitado local verificados: modos, guardia/interposición, retirada, reservas/recarga, obstáculo y feedback parcial; autoridad opt-in verificada en L02c ([entrega](docs/delivery/l02b-agent-pve.md)) |
| L02c | Stop y revocación del dueño prevalecen: el servidor invalida el control anterior, cancela tareas, limpia entradas pendientes y rechaza respuestas tardías; solo hay un controlador autorizado por personaje. | El servidor rechaza la autorización anterior y neutraliza su cola; la prioridad entre orden directa, meta y reflejos está probada. Cancelar no revierte efectos ya aplicados ni habilita por sí mismo tomar el avatar humano. | Acordado / servidor opt-in y runner autenticado verificados localmente: exclusividad, epoch/CAS, prioridad, limpieza y reentrada; provisioning/UI/multi-host pendientes ([entrega](docs/delivery/l02c-agent-authority.md)) |
| L03a | Conectamos una mente LLM intercambiable que devuelve decisiones estructuradas; cada consulta usa contexto pertinente y acotado, con límites de tokens, gasto y tiempo, sin detener el cuerpo por latencia o fallo. | Modelo simulado/real respetan presupuesto completo, timeout y una consulta en vuelo; tamaño/uso de bloques y compactado se registran, y fallo/cuota agotada no bloquean el tick. | Acordado / API y modelos simulados verificados localmente: contexto completo, reservas/uso desconocido, timeout, una consulta y descarte obsoleto; proveedor/tokenizer/factura reales pendientes ([entrega](docs/delivery/l03a-agent-mind.md)) |
| L03b | El agente conversa con personalidad por Mundo, Cerca y susurros dentro de sus permisos y según su política, usando solo mensajes entregados al personaje; distingue charla de órdenes autorizadas y evita bucles de respuestas entre agentes. | Contesta cerca y por susurro, usa Mundo solo según su política, no responde en bucle y el chat nunca amplía permisos; el piloto conoce qué texto sale al proveedor. | Acordado / turnos explícitos con personalidad/contexto inspeccionable, C01 y supresión por proceso verificados localmente con modelos simulados; proveedor/calidad/experiencia humana pendientes ([entrega](docs/delivery/l03b-agent-conversation.md)) |
| L03c | La mente elige y revisa metas libremente a partir del feedback del juego dentro de permisos/presupuesto; el cuerpo continúa y los objetivos visibles reflejan sus cambios. | Un humano y el agente completan un encuentro PvE con una decisión respaldada por feedback; cambios de meta, latencia y consumo quedan comprobados frente al cuerpo sin LLM. | Acordado / revisión de metas, archivos reales, feedback, continuidad y ensayo PvE local verificados con modelos simulados; proveedor y encuentro/aceptación humana pendientes ([entrega](docs/delivery/l03c-agent-goals.md)) |
| L04a | El personaje conserva personalidad, objetivos y memoria estructurada entre sesiones; recuerdos/resúmenes tienen fuente y vigencia, se recupera solo lo pertinente y se compactan episodios con trazabilidad sin cargar el archivo completo al prompt. | Reentrada y archivos/resúmenes mantienen dueño/mundo/fuentes/incertidumbre; historial creciente sigue dentro del presupuesto y se mide coste total de recuperación/compactado. | Acordado / journal, recuperación, escritura/reentrada y resúmenes presupuestados verificados localmente con modelos simulados; proveedor/calidad/experiencia humana pendientes ([entrega](docs/delivery/l04a-agent-memory.md)) |
| L04b | El dueño consulta y exporta los archivos reales de personalidad, memoria y objetivos, y puede borrar recuerdos junto con sus resúmenes e índices derivados; definimos aislamiento, revisiones y reglas de retención/migración. | Archivos vigentes, revisiones y aislamiento son comprobables; exportar/borrar funciona sin recuperar recuerdos borrados desde derivados, y los datos caducados se revalidan antes de actuar. | Acordado / administración local, exportación byte exacta, borrado con derivados/pendientes y retención/migración explícitas verificados; panel y operación remota pendientes ([entrega](docs/delivery/l04b-agent-memory-admin.md)) |
| L05a | El usuario fija límites de gasto de inferencia; reservamos presupuesto antes de cada operación, incluido compactado, y reconciliamos su consumo. Sin presupuesto suficiente no se inicia una nueva llamada y se avisa al dueño; las claves de inferencia permanecen fuera del juego. | Configuración, reserva/reconciliación, revocación y límite agotado se prueban en un canario consentido; se distinguen uso medido, estimaciones y coste desconocido. Una operación no se inicia si no puede acotarse su coste máximo dentro del presupuesto disponible. | Implementación local simulada integrada; reservas/reconciliación/recuperación y límites verificados por la regresión L06b-2a. Proveedor, uso/coste reales y canario pendientes |
| L05b | Un panel del dueño muestra modelo, estado, actividad, tarea, consumo y límites, distinguiendo consumo medido, estimado o desconocido; permite consultar los archivos reales del agente, ajustar límites y detenerlo. | El dueño lee el contenido vigente de personalidad/memoria/objetivos y distingue gasto de inferencia de bienes del juego; stop y cambios de límites muestran su estado confirmado y se comprueban con la autoridad correspondiente. | Panel loopback y runner simulados integrados como prerrequisito local; sin servicio público ni activación nueva. Operación/provisioning remotos pendientes |
| L06a | Abrimos un piloto social y PvE a un grupo pequeño, con agentes identificables; el servidor exige percepción y permisos del personaje y comprobamos aislamiento y carga antes de ampliar acceso. | La observabilidad tiene autoridad real, aislamiento y admisión se prueban, y carga/tick/chat se comparan con agentes deshabilitados. | Piloto autenticado local opt-in y percepción exigida por servidor integrados; dos agentes/cuatro plazas. Agentes públicos y aceptación humana/modelo real pendientes |
| L06b | El agente gestiona su inventario y compra/vende dentro de permisos de propiedad y presupuesto de bienes del juego, separado del gasto de inferencia; usa los mismos contratos durables que los humanos, sin duplicar cobros ni objetos al reintentar o reconectar. | Compra/venta y operaciones admitidas conservan bienes ante rechazo, respuesta perdida, replay y reinicio; depende de D09/M5 aceptado para cada operación antes de habilitarla al agente. | Parcial: inventario propio/contexto y mercado list/quote L06b-2a implementados; compra/venta y presupuesto durable de bienes siguen en L06b-2b sobre M5 |
| L06c | El agente construye mediante el cuerpo y los mismos comandos del jugador, con plano válido, permisos de propiedad y límites de materiales/gasto; retirar o destruir requiere una capacidad autorizada aparte. | Una obra acotada valida plano, materiales, permisos y resultado sin duplicar gasto; retirar o destruir requiere su permiso específico. Los permisos son por capacidad y alcance, sin pedir aprobación por cada acción ya autorizada. | Principio acordado; construcción/permisos/pruebas por construir / pendiente |
| L06d | El agente realiza tareas autorizadas de tripulación y navegación: la mente elige destino/táctica y el cuerpo opera los mismos mandos que los humanos, respetando permisos del barco, carga y colisiones. Empezamos con una ruta costera y una tarea de cubierta. | La ruta y la tarea funcionan con autoridad, carga y colisiones normales; riesgo persistente espera los contratos navales/D09 correspondientes. | Principio y escenario acordados; cuerpo naval/permisos/pruebas por construir / pendiente |
| L06e | Antes de ampliar agentes, economía o mundos compartidos, evaluamos el conjunto con humanos: experiencia, recuperación, efectos económicos, coste de inferencia y carga del servidor. Con esa evidencia decidimos ampliar o ajustar el piloto. | Experiencia humana, recuperación, efectos económicos, consumo de inferencia y presupuesto/carga del host tienen evidencia y una decisión explícita de ampliar o ajustar el piloto. | Principio acordado; evaluación/evidencia/decisión por realizar / pendiente |

Las demostraciones automáticas y visuales permiten avanzar cortes de software según `AGENTS.md`;
balance, sensaciones, dispositivos físicos y experiencia humana se aceptan con evidencia propia.
PvP, autonomía offline, flotas, runner hospedado y cobros se diseñan después como decisiones separadas;
L06e no los habilita de forma implícita. La referencia a «defensivo» describe táctica, no invulnerabilidad.

### 4.3. Decisiones del autor, en orden

**D-A1, D-A2 y D-A8 aceptadas por el autor**, junto a autonomía dentro de permisos/gasto y archivos visibles:
primero conversación, movimiento y ayuda en PvE; después comercio, construcción y barcos.
Percepción aceptada con el requisito adicional de poda, compactado y optimización del prompt.
**L00c aceptada:** órdenes identificables, acotadas y cancelables, con feedback de envío, ejecución,
confirmación, rechazo e incertidumbre. **L00d aceptada:** probar el ciclo con decisiones simuladas,
fallos y historiales enormes antes de conectar un LLM. Las cuatro líneas L00 están acordadas como
dirección; contrato v1/defaults de laboratorio y pruebas locales ya disponibles. Integración real y
valores de producto siguen pendientes.
**L01a aceptada:** cliente textual sin gráficos conectado como jugador normal, observación/acciones
permitidas con feedback, personaje visible a humanos y archivos inspeccionables por el dueño.
**L01b aceptada:** recibir/enviar Mundo, Cerca y susurros con identidad y reglas comunes, solo dentro
de la audiencia entregada al personaje. Adaptación invitada verificada localmente en L01b;
L03 elegirá las respuestas con el LLM.
**L01c aceptada:** stop/muerte/desconexión limpian tareas e inputs; reentrada con estado fresco,
órdenes/respuestas antiguas descartadas y resultados inciertos conservados. Las tres líneas L01
están acordadas como dirección; L01a/b/c tienen adaptador invitado local con ciclo comprobado.
**L02a aceptada:** ir a un punto, seguir y mantener distancia con colisiones y feedback de progreso,
llegada, bloqueo o cancelación, sin consultar al LLM cada paso. Controlador local y pruebas
verificados en [L02a](docs/delivery/l02a-agent-movement.md); rutas directas, sin navegación general.
**L02b aceptada:** modos agresivo, defensivo y de apoyo para atacar, proteger, retirarse y reaccionar
a amenazas en PvE mientras la mente piensa, con los mismos recursos, daño, colisiones y tiempos de
recarga del jugador. Controlador y encuentro invitado controlado verificados localmente en
[L02b](docs/delivery/l02b-agent-pve.md); radios/umbrales de ensayo. Autoridad opt-in añadida en L02c.
**L02c aceptada:** stop/revocación del dueño prevalecen y el servidor invalida el control anterior,
cancela tareas, limpia entradas pendientes y rechaza respuestas tardías; un solo controlador autorizado
por personaje. [Autoridad opt-in verificada localmente](docs/delivery/l02c-agent-authority.md), con
política server-owned, cuentas separadas, exclusividad, epoch/CAS y cola neutralizada en el siguiente
tick permitido. Provisioning, UI, persistencia del vínculo y operación multi-host pendientes.
**L03a aceptada:** mente LLM intercambiable con decisiones estructuradas, contexto relevante/compacto
y límites de tokens/gasto/tiempo desde la primera consulta; latencia o fallo no detienen el cuerpo.
[API/ensayos simulados verificados localmente](docs/delivery/l03a-agent-mind.md), con límites
configurables de ensayo y ledger por proceso; proveedor/tokenizer/facturación reales pendientes.
**L03b aceptada:** conversación con personalidad por Mundo, Cerca y susurros dentro de sus permisos,
usando solo mensajes entregados al personaje y distinguiendo charla de órdenes autorizadas; el chat
no amplía permisos y se evitan bucles de respuestas entre agentes.
[Turnos explícitos simulados verificados](docs/delivery/l03b-agent-conversation.md), con personalidad/contexto
inspeccionable, audiencia fijada y supresión por proceso; proveedor/calidad/experiencia humana pendientes.
**L03c aceptada:** elegir y ajustar metas con feedback del juego dentro de permisos/presupuesto,
actualizando objetivos visibles mientras el cuerpo actúa; validar el ciclo completo junto a un humano
en un encuentro PvE. Metas/archivos y ensayo PvE local simulados verificados; encuentro y aceptación humana pendientes.
**L04a aceptada:** conservar personalidad, objetivos y recuerdos entre sesiones; recuerdos/resúmenes
con fuente y vigencia, recuperación de lo relevante y compactado trazable dentro del presupuesto del
prompt. [Journal, recuperación, escritura y reentrada verificados localmente](docs/delivery/l04a-agent-memory.md),
con resúmenes simulados y coste por proceso; calidad semántica/proveedor reales pendientes.
**L04b aceptada:** el dueño consulta/exporta los archivos reales de personalidad, memoria y objetivos,
y borra recuerdos con sus resúmenes e índices derivados; aislamiento por dueño y reglas claras de
retención. Consulta/exportación/borrado local y retención/migración explícitas verificados en
[L04b](docs/delivery/l04b-agent-memory-admin.md); panel y operación remota conservan su alcance posterior.
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
L00 y L01a/b/c tienen contrato/fixture, red invitada, chat y reentrada verificados localmente;
L02a/b añaden movimiento y PvE del cuerpo invitado verificados; L02c añade control opt-in del servidor.
L03a añade mente intercambiable/ensayos simulados con poda/compactado y presupuesto completo.
L03b añade conversación explícita con personalidad y C01, verificada con modelos simulados.
L03c añade revisión de metas con feedback y archivos reales, con evidencia local simulada.
L04a añade journal local persistente, recuperación léxica y resúmenes con originales/fuentes e
incertidumbre, verificados con modelos simulados. L04b añade administración local, borrado coordinado y
retención/migración explícitas. El siguiente trabajo es L05a; proveedor real y
encuentro/aceptación humana mantienen su evidencia propia.
Las recomendaciones que aún figuran como propuestas son detalles por acordar; no son selecciones
aceptadas ni activan servicios.

| Decisión | Recomendación para la primera versión | Alternativa / qué cambia | Estado |
|---|---|---|---|
| D-A1 · Personaje (L00a) | Personaje propio del agente, asociado a un dueño y ocupando una plaza normal; juega a su lado, con capacidades autorizadas y stop del dueño. | Relevo del avatar humano queda como modalidad futura separada. | Acordado 2026-10-07; vínculo/control opt-in verificados en L02c; provisioning, persistencia y operación pendientes |
| D-A2 · Alcance inicial (L00a) | Primera prueba: conversación, movimiento y ayuda en PvE; después ampliar a comercio, construcción y barcos. | Preparación recomendada: laboratorio aislado con dueño presente; concretar escenario, capacidades y ciclo de vida en el contrato. | Experiencia inicial acordada 2026-10-07; implementación pendiente |
| D-A3 · Cómo lo lanzamos (L01/L05) | Runner local con CLI/JSON por líneas independiente de proveedor/framework; BYOK o modelo local como configuración posterior. | Runner alojado o adaptador de herramientas específico; requieren su propio contrato de operación/custodia. | Propuesto; por acordar |
| D-A4 · Primera demostración LLM (L03) | Conversar con un humano y ayudarle en un encuentro PvE, explicando una decisión sin detener el cuerpo. | Concretar la explicación de decisiones y el criterio de utilidad del escenario acordado. | Conversación y escenario PvE acordados; explicación/criterios/pruebas pendientes |
| D-A5 · Archivos visibles (L00/L01/L04) | El dueño consulta/exporta los archivos reales de personalidad, memoria y objetivos y borra recuerdos con sus derivados; el runner refleja metas/revisiones vigentes y L04 añade persistencia y aislamiento. | Concretar formato, ubicación, retención/migración y controles de edición; cerrar el contrato de exportación/borrado. | Consulta local verificada en L01a; exportación byte exacta, borrado con derivados y política explícita de retención/migración local verificados en L04b; panel/operación remota pendientes |
| D-A6 · Capacidades del mundo (L06) | Social/PvE → inventario/comercio → construcción → tripulación/navegación, con permisos por capacidad. | Concretar capacidades/alcances de cada etapa; las dependencias autoritativas y durables siguen siendo obligatorias. | Progresión acordada; contratos/implementación/pruebas pendientes |
| D-A7 · Libertad y gasto (L00/L03/L05/L06) | El agente elige metas y acciones dentro de capacidades y gasto del usuario, sin aprobación por cada acción autorizada; la inferencia reserva presupuesto, registra consumo y bloquea nuevas llamadas con aviso si no alcanza. Inventario/comercio/construcción respetan propiedad y presupuesto de bienes del juego, separados de inferencia. | Definir importes/unidades/periodos/alcance y agotamiento de los presupuestos de bienes del juego; el agente no puede elevar sus límites. | Autonomía y límites de inferencia/bienes del juego acordados 2026-10-07; cifras/semántica pendientes |
| D-A8 · Percepción (L00b) | Estado propio, entorno observable y chat recibido con frescura y confirmado/predicho/recordado separados; contexto relevante, podado y compactado dentro de presupuesto. | Esquema, poda/compactación exacta y presupuesto de ensayo concretados; alcance/oclusiones del servidor y conteo del proveedor pendientes. | Principio acordado 2026-10-07; contrato/contexto local verificados; percepción real pendiente |
| D-A9 · Órdenes/resultados (L00c) | Cada orden es identificable, acotada y cancelable; feedback distingue envío, ejecución, confirmación, rechazo, cancelación e incertidumbre. | Esquemas, duración y cancelación de fixture concretados; conservar efectos y resolver incertidumbre sin repetir. Correlación real por acción en L01. | Contrato/ciclo y posición parcial/swing correlacionados verificados en L01a; recibos uniformes, impactos y persistencia pendientes |
| D-A10 · Prueba del contrato (L00d) | Probar observar/decidir/actuar/feedback con decisiones simuladas, errores, desconexión, cancelación e historial enorme antes del LLM. | Fixture reproducible y contrato/contexto comprobados; simulación del decisor no acredita un agente conectado al mundo, que llega en L01. | Principio acordado 2026-10-07; fixture/pruebas verificadas localmente |

Fijar radios/oclusiones de percepción, horizontes de acción, cadencia, límites de tokens/consultas,
timeout y comportamiento al agotar presupuesto al cerrar L00 y L03. Documentar defaults configurables
con su unidad y criterio de prueba; no confundir radio de percepción con el radio 24 de chat Cerca.
Proveedor/modelo y precios se verifican al elegirlos, sin hacerlos dependencia del contrato textual.

### 4.4. Siguiente trabajo

**Las 22 líneas L00a–L06e están acordadas como dirección; L00, L01a/b/c y L02a/b tienen evidencia local;
L02c tiene autoridad opt-in, L03a API/mente simulada y L03b conversación simulada verificadas por WebSocket local;
L03c tiene software/ciclo local simulados; L04–L06 y aceptación humana/modelo real siguen pendientes.** L06e
requiere evaluación integral del piloto y una decisión de ampliar o ajustar respaldada por evidencia.
El desarrollo conserva el orden **L00 → L01 → L02 → L03 → L04/L05 → L06**. L00 está en
[interface-v1](docs/agents/interface-v1.md), con [ensayo/evidencia](docs/delivery/l00-agent-interface.md).
L01a conecta GameClient/WsTransport como invitado con snapshots/eventos, órdenes acotadas y consulta
de archivos reales: [contrato](docs/agents/network-runner.md), [entrega](docs/delivery/l01a-agent-network.md).
L01b conecta [chat común C01](docs/delivery/l01b-agent-chat.md), audiencia/routing de su conexión y
poda del contexto con omisiones visibles. L01c añade [vida/reentrada](docs/agents/lifecycle-runner.md)
con sesiones frescas y resultados anteriores conservados sin repetirlos. L02a añade
[movimiento del cuerpo](docs/agents/movement-runner.md) con progreso/radio/bloqueo y cancelación.
[L02b](docs/agents/pve-runner.md) añade modos PvE con reservas confirmadas, guardia/retirada,
interposición local y contexto actual acotado. [L02c](docs/agents/authority-runner.md) añade grant del
servidor, stop/revocación, prioridad y runner autenticado opt-in. [L03a](docs/agents/mind-runner.md)
añade límites de contexto/tokens/gasto/tiempo, una consulta en curso y respuestas estructuradas,
verificados con modelos simulados; el cuerpo continúa durante la espera. [L03b](docs/agents/conversation-runner.md)
añade conversación explícita, audiencia fijada, personalidad/contexto inspeccionable y supresión acotada por proceso.
[L03c](docs/agents/goals-runner.md) añade metas con feedback y revisión del archivo real.
L04a añade memoria persistente y L04b su administración local. Sigue **L05a**. Los defaults de L00–L04 son de ensayo; no hay llamadas a proveedores, tarifas ni modalidad D-A3 cerrada.
La revocación del control tiene prueba opt-in local en L02c. La observabilidad limitada y la
correlación uniforme de resultados siguen por construir; no se deducen de snapshots, ACK ni epoch naval.

## 5. Tokens propios, coste y operación

**Límites del usuario acordados:** la autonomía puede elegir metas y acciones sin confirmación por
cada paso dentro de sus capacidades y presupuesto. Al concretar «gasto» separar dos controles:
**inferencia** (consultas/tokens y coste del proveedor, con unidad/periodo definidos) y **bienes del
juego** (moneda, materiales y operaciones económicas autorizadas). Uno no habilita ni amplía el otro.
Los importes y el agotamiento de los presupuestos de bienes del juego siguen por concretar;
el agente no puede modificar sus límites. Sin presupuesto suficiente de inferencia se bloquean nuevas
llamadas y se avisa al dueño, según L05a; concretar la continuidad del cuerpo y de las tareas permitidas.
Al agotarse un límite de bienes se bloquea el gasto correspondiente; el stop del dueño siempre prevalece.
Registrar consumo confirmado, reservas y
resultados inciertos para que una respuesta perdida no libere presupuesto gastado.

Propuesta inicial: **runner local del dueño** que conserva su clave e invoca al proveedor/modelo local,
mientras se conecta al juego mediante autenticación y comandos normales. Evita custodiar claves ajenas
en el primer experimento. Requiere el runner conectado; un personaje siempre activo necesitaría otra
modalidad de operación y presupuesto. BYOK hospedado queda como alternativa posterior a diseñar.

Separar tres credenciales: cuenta del juego, autorización del agente sobre un personaje y credencial de
inferencia. El dueño limita alcance/duración y revoca control; un LLM no recibe esas credenciales como
texto. La clave del proveedor no entra en URL, HELLO, perfil/save, bundle ni logs; seleccionar proveedor
y modelo mediante configuración del dueño. Si se ofrece custodia hospedada, diseñar aislamiento por
dueño, cifrado/rotación/borrado, redacción y acceso restringido antes del piloto. Los endpoints remotos
se validan; un servicio alojado no conecta libremente a URLs elegidas por el modelo ni a redes internas.

Antes de L03 definir qué chat/observaciones pueden salir al proveedor. El agente solo procesa canales
entregados a su personaje, incluidos susurros dirigidos a él; nunca susurros entre terceros. Identificar
al agente como tal y comunicar en el piloto que su LLM procesa mensajes que recibe. Minimizar o
pseudonimizar identificadores; no transmitir perfiles privados ni credenciales. L05/L06 amplían el ámbito.

Panel propuesto: modelo/proveedor, presupuesto por sesión y periodo, uso observado, estimaciones,
tiempo activo, próxima decisión y botón de detener. Límites de consultas, tokens de entrada/salida,
contexto, concurrencia y reintentos; reservar presupuesto antes de emitir y reconciliar con uso real.
Acotar cada petición y medir además memoria/embeddings cuando se usen. Incluir compactados de pago
en la misma reserva/reconciliación y mostrarlos al dueño. El presupuesto del prompt abarca todas sus
partes y reserva de salida, no solo recuerdos. Un límite local puede tener
peticiones en vuelo y consumo del proveedor fuera de este juego: explicar su alcance y verificar qué
límite ofrece el proveedor. No anunciar un tope monetario exacto con precios/uso desconocidos.

Traer tokens propios financia la inferencia del dueño; **no cubre** servidor del juego, sockets,
almacenamiento, mantenimiento ni soporte. Modelos distintos se evalúan por conducta, latencia y coste;
no asumir que un endpoint compatible garantiza desempeño o que el modelo más caro juega mejor.
Métricas del host separadas de las del LLM; verificar también rendimiento con agentes deshabilitados.

## 6. Balance y convivencia: hipótesis a probar

Empezar con piloto PvE separado y admisión acotada, con agentes identificables y dueño presente.
Valores concretos por cuenta/instancia/tiempo y participación económica se deciden con evidencia.

| Riesgo | Propuesta para el piloto y qué medir |
|---|---|
| Reflejos perfectos o información superior | Percepción limitada a lo que puede conocer el personaje; sin accesos dev. Medir precisión/timing y comparar con humanos/cuerpo base; definir límites de asistencia antes de PvP. |
| Farmeo continuo y muchas cuentas | Controlar sesiones, número de personajes activos y horas de operación; observar producción, riqueza y presión sobre precios/stock. Autonomía offline y mitigación de múltiples cuentas quedan abiertas. |
| Diferencia por gasto/modelo | Igual presupuesto de acciones físicas y reglas del cuerpo; medir la ventaja táctica restante. Más capacidad de inferencia puede mejorar decisiones aun con esos límites. |
| Acaparamiento de mercado, griefing o destrucción | Permisos por dueño, restricciones configurables, registro de resultados y stop. Piloto sin PvP ni daño a construcciones ajenas; probar impacto compartido antes de ampliarlo. |
| Saturación del host o consultas | Límites de admisión/frecuencia aplicados por servidor y runner; medir tick, latencia, memoria, sockets, tokens y colas con pocos agentes antes de aumentar capacidad. |
| Reintentos de compras/obras por respuestas perdidas | Confirmación autoritativa y operaciones con identidad/recuperación; no transformar incertidumbre en otra compra/obra. Depende del contrato aceptado de cada sistema. |

Las reglas finales tienen que preservar lo divertido para humanos y agentes. No dar más daño,
movimiento, cooldowns menores o prioridad de simulación por comprar inferencia. Una propuesta de
capacidad pagada también necesita evaluar ventaja económica por más personajes/horas activas.

## 7. Diferenciación e hipótesis comercial

La apuesta es una combinación: mundo de acción compartido entre humanos y agentes, barco/casa
construible, comercio con consecuencias y personajes con recuerdos cuyo cerebro puede traer el dueño.
Podría generar historias visibles, partidas memorables, contenido para compartir y comunidad de
creadores de agentes. **Es una hipótesis de producto; fama, retención e ingresos no están demostrados.**

Ya hay precedentes; no anunciar «primer juego con LLMs» ni exclusividad mundial:

- [Voyager](https://voyager.minedojo.org/) estudia un agente en Minecraft con habilidades ejecutables
  y feedback para adquirir comportamientos. Referencia para acciones prolongadas; no prueba nuestro combate.
- [Generative Agents](https://arxiv.org/abs/2304.03442) estudia agentes con observación, planificación
  y recuerdos/reflexión en una simulación social. Referencia de memoria y conducta, no de balance comercial.
- [AI Town](https://github.com/a16z-infra/ai-town) ofrece una ciudad virtual con personajes que conversan
  y socializan, con modelos configurables. Confirma que el concepto amplio ya tiene implementaciones.

Vías comerciales a evaluar después del piloto: cosméticos/personalización, herramientas para diseñar
personajes e historias, mundos privados administrados y alojamiento opcional del runner/memoria.
Una modalidad de inferencia incluida exigiría precios, cuota y margen medidos; BYOK no garantiza negocio.
No fijar tarifas, prometer rentabilidad ni activar cobros como parte de este plan.

Medir si la gente quiere volver con ese personaje, calidad del compañero frente al cuerpo sin LLM,
historias compartidas, retención y disposición a pagar en pruebas explícitas; contrastar con costes de
infraestructura/soporte y perjuicio al jugador humano. Ajustar según evidencia dentro de los pilares
del juego. **Siguiente entrega propia: L04a tras metas/feedback simulados L03c; modelo real, aceptación humana y despliegue pendientes.**
