# Compañeros: propósito, continuidad y reacciones

Dirección expresada por el autor, 2026-10-10: alguien que normalmente juega solo puede
tener un equipo, conversar y compartir aventuras con un personaje con identidad, oficio,
personalidad y recuerdos. También interesa explorar habitantes, rivales y villanos
patrocinados por el juego que participen en el mundo.

Este documento distingue esa intención de producto de las recomendaciones técnicas.
La plantilla de compañía está implementada para fichas nuevas. El
[corte L04c](../delivery/l04c-companion-continuity.md) implementa captura tras conversación,
refresco y resumen acotados en el Studio local; los demás eventos automáticos,
la integración JEV y los actores patrocinados descritos aquí **son propuestas**.
No añade SQL, protocolo, proveedor, autonomía offline ni permisos de gameplay.

## Resultado que buscamos

Que la persona disfrute una aventura compartida: alguien reconoce un plan anterior,
aporta una perspectiva propia, ayuda cuando puede, escucha y deja espacio para jugar.
El oficio orienta sus intereses; sus rasgos cambian cómo interpreta y expresa una
situación. La personalidad necesita aparecer también al elegir cuándo hablar,
preguntar, esperar o proponer ayuda, no solamente al añadir adjetivos a una respuesta.

La finalidad no es producir el máximo de recursos ni maximizar mensajes o tiempo
conectado. Un buen compañero respeta el ritmo del jugador, conserva voz y compromisos
con fuente, acepta correcciones y no inventa aventuras compartidas. La ficción puede
tener afecto y carácter sin exigir atención ni castigar una ausencia.

Ejemplo objetivo, todavía no demostrado como comportamiento integrado: después de
una reconexión Brisa recuerda que querían preparar una balsa; pregunta si continúan
y, solo con lectura actual y herramientas concedidas, comprueba qué pueden hacer.
El recuerdo del plan no prueba que la balsa exista ni que queden materiales.

## Qué existe hoy

Base histórica: `2a51c8d`, [L03d-e2b](../delivery/l03d-local-companion-studio.md).
Actualización local L04c: [contrato](l04c-companion-continuity.md) y
[evidencia](../delivery/l04c-companion-continuity.md).

| Elemento | Comportamiento actual |
| --- | --- |
| Consulta al modelo | Cada petición se construye de nuevo; el adaptador local envía instrucciones y contexto explícitos. No mantiene una conversación creciente en el proveedor. |
| Archivos | Al iniciar y al leer el snapshot para una operación se cargan personalidad, objetivos y memoria del scope dueño–personaje–mundo. Hay comprobación de hashes antes de publicar efectos. |
| Contexto | Incluye reglas, personalidad, herramientas concedidas, observación, objetivos y pendientes. Recupera recuerdos pertinentes y poda los opcionales dentro de topes medidos. |
| Sesión de juego | Inicio/reentrada explícitos admiten una sesión nueva. Muerte, desconexión, stop, revocación o caducidad interrumpen el runner; no disparan una reconexión autónoma. |
| Controles de Brisa | Iniciar, detener, reentrar, consultar/exportar archivos, guardar episodio, refrescar contexto y resumir fuentes elegidas. Refrescar cancela tardías sin cambiar sesión, cuota o stop. |
| Compactado | API y botón del Studio para resumir de uno a ocho episodios, con presupuesto compartido, fuentes y originales conservados. |
| Automatización | Captura tras conversación confirmada sin inferencia; resumen opt-in ante presión/pausa, máximo un intento automático por cuota durable, contando los manuales. Apagado al reiniciar. No cambia de sesión ni reanuda órdenes. |
| Límite duro | Una petición cuyo contexto obligatorio no cabe se rechaza antes de emitirla. El journal tiene un tope de tamaño: resumir no lo reduce, porque conserva los originales. |

En Brisa local se comprobó recuperación de un episodio después de cerrar el proceso.
El ensayo de resumen real fue rechazado; el original permaneció intacto. Eso acredita
continuidad desde disco, no calidad de resumen ni una memoria automática completa.
L04c añade automatismos locales con proveedor simulado: 97 pruebas aprobadas/una omitida
por symlink Windows y navegador 9/9. No se volvió a consumir el modelo real en ese corte.
La memoria vive en archivos locales; el mundo de ese ensayo es efímero y su identidad
es de fixture. No equivale a continuidad pública autenticada bajo M5.

Entradas técnicas: [local-companion](../../tools/agent/local-companion.mjs),
[network-runner](../../tools/agent/network-runner.mjs),
[mind](../../tools/agent/mind.mjs), [mind-context](../../tools/agent/mind-context.mjs),
[snapshot/recuperación](../../tools/agent/mind-snapshot.mjs),
[memoria](../agents/memory-runner.md), [ciclo de vida](../agents/lifecycle-runner.md).

## Continuidad propuesta

El subconjunto local de chat, refresco y resumen ya se implementó en L04c. La tabla
conserva la dirección más amplia: eventos de tareas y operación pública siguen pendientes.

Separar tres conceptos evita reinicios innecesarios:

1. **Turno mental:** una consulta breve con contexto pertinente. Ya se reconstruye.
2. **Ventana de trabajo:** lo que conviene traer al siguiente turno: asunto en curso,
   última pregunta, compromisos abiertos, fuentes y resultados inciertos. Puede
   refrescarse o resumirse sin retirar al personaje del mundo.
3. **Sesión de juego/control:** conexión, identidad admitida y permisos vigentes.
   Se renueva por razones de conexión/control; llenar contexto no justifica renovarla.

La continuidad procede de documentos persistentes más observación fresca, no de
mantener un chat de proveedor indefinidamente. Tampoco significa mandar todos los
archivos completos en cada consulta. Se carga identidad y trabajo actual, y se
recupera la parte relevante de los recuerdos con referencias a sus fuentes.

| Disparador propuesto | Trabajo esperado | ¿Nueva sesión de juego? |
| --- | --- | --- |
| Llega un mensaje entregado o una orden autorizada | Recuperar contexto pertinente y decidir si necesita conversación/reflexión; separar chat de mandato. | No |
| Termina una tarea, cambia un plan o hay un momento relevante | Capturar un episodio pequeño con evidencia y pendientes; agrupar eventos repetidos. | No |
| Presión de contexto o demasiados episodios del mismo asunto | Primero seleccionar/podar. Si aporta valor y hay presupuesto, solicitar un resumen trazable fuera de una interacción urgente. | No |
| El dueño pulsa refrescar contexto | Releer archivos, tomar observación actual y reconstruir la ventana; invalidar la consulta anterior si procede. | No |
| El dueño pulsa resumir | Mostrar alcance/coste acotado, resumir fuentes elegidas y conservar originales; fallo conserva el último estado válido. | No |
| Muerte, desconexión, revocación o permiso vencido | Detener, conservar lo incierto y resolver admisión/autorización antes de reentrar. Un stop manual permanece detenido. | Solo con admisión válida |
| Reinicio del servicio | Cargar documentos y consumo durable, empezar detenido conforme al contrato actual y revalidar mundo/control. | Sí, al admitirlo |

El umbral debe contar el **payload completo** con instrucciones, esquema, herramientas,
reserva de salida y margen; distinguir tokenizer real de estimación. Los valores
dependen del modelo y de las pruebas. Puede haber aviso temprano, un umbral de
resumen y un tope duro, con separación entre umbrales y espera mínima para no
compactar en bucle. L04c usa 80 % del payload completo o poda de opcionales y 3 s de pausa
como política local de ensayo, con cuota durable; no fija porcentajes universales.

Un resumen debe conservar referencias, preferencias explícitas, compromisos abiertos,
correcciones, incertidumbre y el punto de continuación. No necesita copiar todo el
diálogo. Cambiar de ventana o sesión no borra fuentes, no reinicia la cuota, no
resuelve una operación incierta y no ejecuta de nuevo una orden antigua.

Para crecer más allá del tope del journal hace falta una política independiente
de archivo/retención y búsqueda. Compactar contexto no equivale a borrar historia.
El borrado solicitado por el dueño debe alcanzar resúmenes e índices derivados,
conforme al contrato de [administración de memoria](../agents/memory-admin.md).

Controles del Studio L04c: detener, refrescar contexto, resumir ahora y reconectar
explícitamente. La administración más amplia conserva su contrato. La UI muestra motivo del refresco, última
captura guardada, uso del contexto y consumo conocido/pendiente. No se promete que
una parada pueda deshacer una acción ya confirmada.

## Cuerpo, interpretación social y conversación

| Capa propuesta | Responsabilidad | Ejemplo |
| --- | --- | --- |
| Cuerpo programado | Ejecutar tareas concedidas con observación vigente, límites, interrupciones y feedback. No esperar inferencia para cada input. | Seguir, guardar distancia, asistencia PvE; detenerse al perder permiso/objetivo. |
| Interpretación social opcional | Clasificar una situación ambigua entre opciones acotadas; sugerir tono, relevancia o necesidad de consultar la mente. | ¿Es una pregunta, una broma o un cambio de plan? ¿Conviene escuchar o pedir aclaración? |
| Mente conversacional | Voz, diálogo, recuerdos pertinentes y decisiones de mayor alcance dentro de las herramientas disponibles. | Hablar de una aventura o revisar una propuesta del grupo. |

Los controladores de movimiento/PvE ya tienen implementaciones locales, pero **la
Brisa del Studio solo tiene chat**. No se demuestra aquí actividad corporal durante
inferencias reales. Una conversación puede tardar segundos de forma aceptable;
quedarse sin reacción corporal ante peligro exige una solución distinta.

Una latencia conversacional tolerable no justifica ignorar frescura: el runner
descarta propuestas corporales obsoletas. Un plan lento debe transformarse en una
tarea acotada revalidada contra el presente, no aplicarse a una escena antigua.
Los resultados de la capa social también necesitan scope, vigencia e invalidación.

## JEV: experimento recomendado, no dependencia urgente

La documentación oficial describe JEV como un modelo de decisiones tipadas y
probabilidades; no genera diálogo. Puede encajar en la interpretación social o
en la selección de contexto. «Cerebro límbico» es una metáfora de diseño: no prueba
sentimientos ni conocimiento real del estado emocional de la persona.

Preguntas candidatas independientes sobre el mismo estado acotado:

- Elegir intención conversacional: pregunta, propuesta, humor, despedida, otro/incierto.
- Valorar si hay una oportunidad contextual de ayuda, sin convertirla en autorización.
- Elegir tono compatible con los rasgos y el mensaje, sin diagnosticar emociones.
- Valorar relevancia de candidatos ya recuperados o necesidad de una reflexión larga.

Agrupar las preguntas útiles en una llamada, ejecutarla fuera del tick y consumir
solo las respuestas aplicables. Si falla, tarda o hay ambigüedad, conservar el
comportamiento programado y una salida prudente. No poner JEV delante de cada input,
stop, lectura exacta, reacción urgente o comprobación de permisos.

Un estado narrativo sencillo —ánimo, confianza por relación, preocupaciones,
preferencias— podría modular voz y prioridades. Sus cambios necesitan eventos con
fuente, límites y revisión del dueño. Confianza narrativa nunca concede privilegios;
ánimo inferido no es un hecho sobre el humano. La temperatura de muestreo del LLM
es un parámetro distinto: subirla no crea por sí sola afecto, recuerdos ni continuidad.

El catálogo consultado publica `jev-1.13.0` a **USD 0,042 por millón de tokens de
entrada**, salida sin cargo; es una referencia del proveedor, no una factura ni
una medida de coste/latencia para nuestro juego. Sus docs señalan mejor precisión
en inglés: la evaluación debe incluir español real del alfa. No se ha llamado JEV,
configurado su credencial ni medido latencia end-to-end en este corte.

Fuentes consultadas 2026-10-10: [System One](https://docs.typesafe.ai/concepts/system-one),
[modelos y precio](https://docs.typesafe.ai/models),
[routing](https://docs.typesafe.ai/patterns/intent-routing),
[confianza](https://docs.typesafe.ai/confidence).

## Compañero personal y actor del mundo

Comparten la interfaz de jugador y la autoridad del juego. Su propósito y su
controlador deben ser explícitos y distintos; no basta con cambiar el oficio a
«villano» en una ficha cuyo mandato sigue siendo acompañar a su dueño.

| Dimensión propuesta | Compañero personal | Actor patrocinado por el juego |
| --- | --- | --- |
| Finalidad | Colaborar y compartir aventuras con su jugador. | Habitar el mundo y perseguir una agenda coherente: oficio, comercio, facción o conflicto. |
| Control y gasto | Dueño autenticado, capacidades y presupuesto propios. | Identidad/controlador del sistema y presupuesto del patrocinador. |
| Memoria | Relaciones y aventuras privadas del scope autorizado. | Experiencias y conocimiento del actor; acceso público/privado según contrato explícito. |
| Recursos | Posesiones y operaciones válidas del personaje. | Posesiones y operaciones válidas; ayudas del sistema, si existiesen, serían una regla explícita del mundo. |
| Perspectiva | Lo que observó o le comunicaron con fuente. | También limitada: un villano no conoce automáticamente la posición o recuerdos privados de todos. |

Visión posible: una carpintera reúne materiales y mejora su taller; una tripulación
transporta bienes; un rival prepara una expedición y responde a consecuencias del
mundo. Construcción, recolección, navegación y conflicto requieren herramientas y
reglas propias, todavía ausentes de la mente actual. PvP, autonomía offline, cupos,
ritmo productivo y ventajas de patrocinio siguen abiertos; no se activan por prompt.

## Prompts y documentos

| Parte | Contenido y autoridad |
| --- | --- |
| Reglas/herramientas del sistema | Límites efectivos, identidad y capacidades del turno; los concede el runtime/servidor. |
| Personalidad | Propósito de compañía, oficio, valores, voz, rasgos y preferencias ficticias declaradas. No concede herramientas. |
| Objetivos | Plan e intenciones actuales, restricciones y estado respaldado por feedback. Un objetivo escrito no prueba que se cumplió. |
| Memoria | Episodios, preferencias comunicadas y momentos compartidos con fuente, incertidumbre y scope. |
| Estado actual | Observaciones y lecturas del servidor, caducables; no se reconstruyen desde una vieja conversación. |

La [plantilla](../../src/net/companionTemplates.js) añade ahora propósito y hábitos:
responder al turno actual, evitar presentaciones repetidas, retomar asuntos guardados,
ofrecer ayuda sin monopolizar, respetar pausas y mantener separadas confianza y
autorización. Se aplica a documentos nuevos. No reescribe silenciosamente fichas
existentes, recuerdos, metas ni el presupuesto de Brisa.

## Siguiente corte recomendado y cómo aceptarlo

La continuidad local de conversación, el punto con fuentes, el resumen explícito y
la política acotada por presión se implementaron en L04c. Siguen identidad/ledger central,
wizard ingame y calidad real. Después comparar cuerpo solo, cuerpo+LLM y
cuerpo+clasificador+LLM en las mismas escenas. No hacen falta nuevos assets para
este corte: se reutilizan archivos, controladores y UI existentes; no hay trabajo
de arte que requiera portar fuentes Unreal/FAB.

Criterios de aceptación propuestos:

- Tras cerrar/reabrir, conserva nombre/voz/preferencia guardada y retoma un asunto
  pendiente sin volver a presentar al personaje ni afirmar estado viejo como actual.
- Una conversación larga sigue dentro del payload total; un resumen rechazado no
  destruye fuentes ni impide recuperar el episodio original. Un reinicio no renueva cuota.
- Stop cancela decisiones tardías; recargar contexto no reactiva una tarea ni repite
  una operación incierta. Reentrada requiere admisión y permisos actuales.
- La tarea corporal permitida sigue operativa mientras conversa; sin JEV/proveedor
  mantiene un comportamiento válido. Latencia de movimiento y de diálogo se miden aparte.
- En español, mejora coherencia, pertinencia y variedad frente a la base observada;
  no aumenta invenciones, interrupciones ni gasto sin justificación. Medir p50/p95,
  coste nativo, rechazos y preferencia del jugador, no solo porcentaje de JSON válido.
- Para actores patrocinados, cerrar primero controlador, memoria, economía y reglas
  de convivencia. Una agenda narrativa no sustituye esos contratos.

La calidad humana de la compañía, del resumen y del modelo local sigue pendiente.
El ajuste de plantilla y las pruebas de L04c no acreditan esos criterios de calidad
ni despliegue de automatismos en el alfa.

Validación del ajuste de plantilla: **19/19** pruebas existentes de documentos,
contexto acotado, adaptador local, runtime y servidor Studio. Ejecutadas con
`node --test tests/companion-templates.test.mjs tests/local-openai-mind.test.mjs tests/agent-mind-context.test.mjs tests/local-companion-runtime.test.mjs tests/companion-studio-server.test.mjs`.
El proveedor de esas pruebas es simulado; no se consumió inferencia real ni se
revalidó calidad conversacional. Revisión independiente sin incidencias materiales
y `git diff --check` sin errores.
