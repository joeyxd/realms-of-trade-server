# Plan extra — personajes con LLM, cuerpo y memoria

Fecha: 2026-10-05. **Prioridad baja; exploración gradual en paralelo.**
Estado: dirección solicitada por el autor y plan documentado; implementación pendiente.
Cola principal: [PLAN-DELIVERY](PLAN-DELIVERY.md). Este plan usa IDs **L00–L06** y no renumera milestones.

## 1. Dirección y alcance

Explorar que las personas conecten su propio modelo y presupuesto de inferencia para tener personajes
«vivos» en MAREA NEGRA: con objetivos, personalidad, recuerdos y decisiones que tengan consecuencias
reales en el mundo. Los humanos ven al personaje en el juego 3D; el agente puede jugar completamente
por texto y herramientas, sin necesitar gráficos.

La analogía del autor es un «prefrontal»: el LLM decide objetivos, enemigo prioritario, estrategia,
equipo, construcción y comercio. Un cuerpo programado ejecuta comportamientos rápidos y acciones
directas. La percepción textual y la memoria cierran el ciclo con resultados del juego.

**Acordado en la conversación:** línea adicional de baja prioridad, desarrollo por cortes pequeños,
cerebro LLM/cuerpo programado, acciones directas, feedback dinámico, memoria y explorar tokens propios.
Los límites numéricos, proveedores, reglas de balance, autonomía sin dueño conectado y cobros de este
documento son propuestas o decisiones abiertas; no se consideran aprobados ni implementados.

Aquí «tokens propios» significa credenciales/cuota de un proveedor de inferencia o un modelo local,
no moneda del juego ni el token de autenticación del personaje. La modalidad BYOK permite usar una
clave propia; el presupuesto y el comportamiento cuando se agota deben ser visibles para su dueño.

## 2. Prioridad y trabajo paralelo

- La ruta principal de balsa, construcción, comercio, navegación y persistencia conserva su prioridad.
  Esta exploración no es requisito para aceptar D06, D08, D09 ni las entregas navales posteriores.
- Preparar contratos, CLI, fixtures y pruebas en rutas aisladas; coordinar cambios de protocolo,
  entrypoints, perfil y archivos compartidos con sus dueños. Un escritor por archivo; worktree cuando
  convenga. El principal integra y acepta; usar GPT-6 Luna para trabajo acotado según `AGENTS.md`.
- Comenzar en una instancia de prueba con mundo y perfiles propios. Una integración compartida exige
  un corte aceptado y habilitación explícita; la mera existencia de este plan no activa agentes online.
- Hacer un corte pequeño por vez, con informe en `docs/delivery/` al completarlo. Registrar base,
  contratos, evidencia, coste medido, limitaciones y siguiente paso; no crear informes vacíos ahora.
- Antes de cada corte comprobar Unreal/FAB para cualquier necesidad concreta de arte/UI. Para el
  primer cliente textual se propone reutilizar los personajes actuales y omitir assets nuevos.
- Posponer esta línea si compite por integración/QA con una entrega principal o aún no aporta una
  experiencia útil. No reservar un worker permanente ni una revisión de GPU simultánea.

## 3. Arquitectura propuesta

| Pieza | Responsabilidad y límites |
|---|---|
| Cerebro LLM | Seleccionar metas, tácticas, equipo, planes sociales y económicos. Produce decisiones con argumentos definidos; no decide autoridad ni ejecuta código arbitrario. |
| Cuerpo | Controlador local rápido: seguir, navegar, acercarse, atacar, mantener distancia y proteger. Modos agresivo, defensivo y apoyo configurables; misma física, recursos, cooldowns y validaciones del juego. |
| Acciones directas | Mover/apuntar/atacar/usar habilidad/interactuar y comandos permitidos de inventario, construcción y comercio. Duración acotada, cancelación y control humano inmediato. |
| Percepción | Resumen textual y datos estructurados del personaje: posición, salud, entidades observables, amenazas, recursos, habilidades, acciones disponibles y eventos. Incluye tick/revisión y antigüedad. |
| Memoria | Estado del plan, hechos conocidos y experiencias por personaje/mundo. Recupera contexto pertinente y conserva la evidencia de resultados. |
| Servidor | Autoridad final sobre estado, propiedad, stock, costes, daño, cooldowns y operaciones persistentes. Identifica dueño y agente; limita admisión y acciones. |

Flujo: **estado observable → percepción + recuerdos → decisión → cuerpo/acción → servidor → resultado**.
El cuerpo continúa durante una consulta; el mundo online sigue corriendo y no se pausa para el modelo.
El LLM y el almacenamiento de recuerdos viven fuera de `src/sim/**`: ninguna llamada remota ni espera
asíncrona entra en el tick autoritativo. Una secuencia de comandos aceptados debe poder reproducirse.

Propuesta de primer piloto: personaje independiente asociado a una cuenta/dueño, identificado como
agente y ocupando una plaza normal. Transferir el personaje humano a un agente sería otra modalidad:
exigir control exclusivo, relevo explícito y revocación para evitar dos clientes mandando a la vez.
Definir desconexión, muerte/reaparición, reconexión y tareas pendientes antes de habilitar cada modalidad;
el piloto no mantiene farmeo autónomo cuando el dueño termina la sesión.
El contrato de relevo incluye una revisión de control, por ejemplo `controlEpoch`: una decisión se
vincula a dueño/sesión/revisión y el servidor rechaza acciones de una autorización revocada, aunque la
escena siga igual. La toma humana debe invalidar también las respuestas del modelo que aún estén en vuelo.

Base existente que merece reutilización:

- `src/client/gameClient.js` y `src/net/wsTransport.js`: cliente sin renderer, recepción de estado,
  predicción/reconciliación y envío de inputs con secuencia y tick de proyectiles.
- `tools/nettest.mjs`: ejemplo de cliente Node por WebSocket y vista de combate; su fixture usa
  `dev`, teletransporte y god mode. Esa preparación no se copia a un agente del mundo compartido.
- `tools/botbrain.mjs`: política reactiva de La Caldera; sirve como referencia para amenazas/reflejos,
  no como navegación general, memoria o cerebro LLM ya hechos.
- `src/net/protocol.js` y `LocalServer.playerCommand`: comandos/snapshots y validaciones existentes.
  Antes de cada implementación verificar la versión vigente; actualizar protocolo si cambia el contrato.

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
Definir prioridad entre control humano, acción directa, modo activo y evasión. El dueño puede detener
el agente y tomar el personaje; al agotar presupuesto/tiempo de decisión, expira la autonomía permitida
y entra el comportamiento de cierre definido para esa instancia, conservando las reglas normales de daño.

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

## 4. Cortes de desarrollo y aceptación

Todas las implementaciones están **pendientes**. Cada fila puede dividirse si toca varios contratos.

| ID | Entrega acotada | Evidencia para aceptar |
|---|---|---|
| L00 | Contrato de observación/acciones, dueño, permisos, límites y fixture aislada. Adaptador de decisiones simuladas. | Mapa de interfaces vigentes y decisiones abiertas; comandos permitidos/denegados y presupuesto definidos; ninguna consulta pagada necesaria. |
| L01 | Cliente textual headless: observar, mover, apuntar, atacar, habilidad e interacción básica. | Salud/posición/eventos coherentes con servidor; otro cliente ve al personaje; inputs normales, sin teletransporte/god mode; cierre y desconexión comprobados. |
| L02 | Cuerpo con tres modos y acciones directas interrumpibles. | Seguir/proteger/mantener distancia en casos acotados; mismo resultado para mismos inputs/semilla; no escapar a cooldowns/colisiones; stop/toma humana inmediata y rechazo de respuesta tardía tras revocar control. Navegación general se acepta aparte. |
| L03 | Un LLM selecciona metas y modos; feedback por eventos, frescura y límites de inferencia. | Sesión breve con presupuesto explícito, coste/latencia medidos; decisiones tardías, respuesta inválida, timeout y cuota agotada no bloquean el mundo; resultado útil comparado con cuerpo sin LLM. |
| L04 | Memoria persistente e identidad del personaje. | Reentrada recupera hechos/experiencias pertinentes; no confunde mundos/dueños; distingue predicción/hecho/hipótesis; exportar/borrar funciona; repetición de escenarios permite evaluar adaptación. |
| L05 | Piloto BYOK con pocos participantes en PvE separado; panel de modelo, presupuesto y stop. | Clave revocable y aislada; sin secretos en logs/prompts; límite de gasto con semántica comprobada; participantes informados de datos enviados al proveedor y costes; canario consentido y recuperación sin cobros/reintentos repetidos. |
| L06 | Evaluar convivencia social, construcción y comercio en mundo compartido; después PvP y posible servicio comercial. | Permisos, balance económico, autoridad durable y presupuesto de host probados; experiencia humana aceptada. PvP, autonomía offline y cobro son decisiones posteriores separadas. |

Primer paso cuando haya capacidad: **L00**, después **L01**. No empezar cobrando ni admitiendo flotas de
agentes; demostrar primero que un personaje resulta útil e interesante con su dueño presente.
Construcción/comercio utilizan las funciones humanas cuando estén aceptadas. L06 espera sus contratos
de persistencia/recuperación y permisos; no habilitar bienes en riesgo para saltarse D09/M5.

## 5. Tokens propios, coste y operación

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

Antes de L05/L06 definir qué información de otros jugadores puede salir al proveedor. Minimizar o
pseudonimizar identificadores; comunicar el tratamiento de chat/acciones observadas y establecer el
consentimiento y ámbito del piloto. No transmitir conversaciones privadas ni perfiles ajenos.

Panel propuesto: modelo/proveedor, presupuesto por sesión y periodo, uso observado, estimaciones,
tiempo activo, próxima decisión y botón de detener. Límites de consultas, tokens de entrada/salida,
contexto, concurrencia y reintentos; reservar presupuesto antes de emitir y reconciliar con uso real.
Acotar cada petición y medir además memoria/embeddings cuando se usen. Un límite local puede tener
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
infraestructura/soporte y perjuicio al jugador humano. Detener/ampliar según evidencia, sin desviar la
prioridad del juego base. **Siguiente entrega: L00 cuando se le asigne capacidad; nada desplegado aquí.**
