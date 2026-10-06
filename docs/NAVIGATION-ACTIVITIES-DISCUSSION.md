# Navegación activa — discusión de actividades y travesías

2026-10-06. **Brainstorm solicitado por el autor; propuestas sin aprobar ni implementar.**
Continúa [la dirección naval](NAVAL-ROADMAP.md) y [D08](briefs/d08-navigation-feel.md).
No cambia la cola de entregas, las puertas móviles/visuales ni las decisiones abiertas de PvP y pérdidas.

## Petición y punto de partida

El autor quiere que navegar largas distancias sea entretenido por sí mismo: controles dinámicos,
actividades o minijuegos que puedan dar velocidad u otras ventajas mientras viaja su casa-barco.
El principal realizó la síntesis de diseño con dos análisis de GPT-6 Luna: actividades y balance.

Fuente consultada: `fe48fab`. La bahía D08a tiene masa, distribución, inercia, timón, frenado,
cuatro escenarios de viento constante y lastre de prueba. No tiene ráfagas, olas físicas de juego,
corrientes, ajuste manual de vela, tripulación operativa ni navegación activa en la partida pública.
Su aceptación visual sigue pendiente. El movimiento visual del agua no constituye oleaje de simulación.

## Apuesta de diseño

Proponer tres capas que se alternan: crucero agradable, oportunidades de navegación y encuentros.
La calidad del manejo, las señales del entorno y la belleza del viaje deben sostener la primera capa;
un minijuego no arregla por sí solo una travesía demasiado larga o un barco que responde mal.

En crucero, una ayuda básica puede mantener el rumbo y ajustar la vela con eficiencia razonable.
Mantener rumbo no equivale a esquivar obstáculos o amenazas, atracar ni conceder protección al desconectar.
La existencia y política definitiva de esa asistencia aún deben probarse.

La participación activa ofrece elecciones: aprovechar una ráfaga, entrar en una corriente, mantener
velocidad sobre una ola o desviarse por algo interesante. No es necesario ejecutar continuamente
una secuencia para conservar una velocidad de viaje viable. Fallar una oportunidad benigna significa
perder su ventaja; no implica romper una vela o perder mercancía. Un temporal o encuentro peligroso
puede tener consecuencias propias, pero debe anunciarse y ofrecer respuestas o una ruta alternativa.

## Actividades propuestas

| Actividad | Acción y señales | Beneficio o decisión | Coste, límite y relación con el barco |
|---|---|---|---|
| **Cazar una ráfaga** | Ajustar la apertura/tensión de vela cuando cambian viento, tela y sonido; sostener o mover un control contextual | Capturar mejor el viento durante una oportunidad breve | La misma fuerza adicional acelera menos una nave pesada; ajuste limitado por aparejos. Ignorar conserva ayuda básica |
| **Montar una ola** | Anticipar dirección y colocarse en la cara favorable; usar timón y propulsión, sin abrir una pantalla aparte | Conservar o ganar avance con empuje del entorno | Entrar/salir exige espacio y anticipación; una casa cargada tarda más en virar. No teletransporte ni invulnerabilidad |
| **Leer corrientes** | Identificar bandas en el agua/carta y decidir rumbo de entrada/salida | Llegar antes o ahorrar esfuerzo/combustible donde corresponda | Desvío, obstáculos, viento y ruta de salida pueden hacer que una corriente rápida sea peor para ese viaje |
| **Boga de emergencia** | Remos con pulsos espaciados o alternativa mantenida/asistida, únicamente en calma o maniobra lenta | Una ayuda limitada para no quedar varado y una oportunidad de cooperación | Nunca exigir golpeteo continuo ni permitir que muchas manos propulsen una fortaleza como una balsa. No prioridad del primer prototipo |
| **Gancho, pesca y pecios** | Decidir si acercarse, frenar y recoger; opcionalmente apuntar un lanzamiento sencillo | Recursos, colección o un hallazgo, con coste de tiempo | Bienes reales aumentan carga. No lluvia constante de botín ni progreso infinito por permanecer en una zona |
| **Vida a bordo** | Cocinar, preparar pedidos, decorar y conversar durante tramos tranquilos | La casa participa en el viaje; preparar el siguiente puerto | Producción usa entradas/espacio/tiempo reales. Pilotaje asistido y caminar sobre una cubierta móvil son dependencias pendientes |
| **Respuesta a una amenaza** | Reducir vela, asegurar un aparejo, esquivar una andanada, reparar una avería localizada o decidir soltar carga | Sobrevivir, conservar bienes o conseguir una apertura para huir | Actividad contextual, no averías inventadas cada minuto para mantener al jugador ocupado. Riesgo durable necesita D09 |

El trimado debe afectar al viento que el barco realmente encuentra. Ajustar una vela en viento constante
puede enseñar el control, pero no justifica un premio renovable por pulsar periódicamente la misma tecla.
Después del control básico, ráfagas graduales y anunciadas ofrecen motivos reales para cambiar el ajuste.
Las primeras ventanas deberían ser amplias: leer y decidir, no acertar un fotograma perfecto.

Las olas jugables requerirían un campo simplificado y reproducible de dirección/fase/intensidad.
El shader del agua dibujaría señales coherentes con ese estado; no se leerían sus píxeles como autoridad.
Corrientes también serían parte del mundo compartido, no un regalo invisible personalizado por jugador.

## Hacer que construir cambie cómo navegas

Una balsa ligera puede entrar y salir rápido de una oportunidad; un mercante carga más, anticipa sus
curvas y escoge líneas amplias. Un barco pesado bien equipado puede sostener una ruta estable, pero no
debe ganar por minijuegos la agilidad completa del pequeño. Materiales, navegación, masa y distribución
siguen siendo entradas del manejo. Ninguna actividad crea flotación ni elimina una sobrecarga.

Ideas de módulos para estudiar después: aparejos que amplían el ajuste útil, una mesa de cartas que
mejora la previsión local y almacenamiento que protege tipos de bienes del oleaje. Cada ventaja paga
peso, espacio, coste o una especialización. No convertir una mesa en un multiplicador universal de velocidad.
Mover carga real entre bodegas puede importar, pero requiere contenido asignado a módulos y una acción
con tiempo/alcance; el agregado global actual no demuestra que ya sea posible. No primer prototipo.

La skill de navegación podría mejorar lectura, respuesta y tolerancia de una maniobra. El jugador nuevo
debe poder aprender y participar desde el primer viaje; evitar doble ventaja enorme de reflejos y nivel.
XP por actividad válida y trayecto/desafío real, no por pulsar la vela en puerto o repetir un circuito mínimo.

## Balance, controles y cooperación

- Recompensas de navegación por barco y condición del entorno; varias personas no acumulan el mismo
  beneficio varias veces. Pueden repartirse timón, vigilancia y otras tareas, con ventaja de coordinación
  limitada. Una persona con asistencia básica debe seguir siendo viable.
- Un control principal de rumbo/propulsión y, en el primer experimento, una única acción contextual
  adicional. Conservar timón mientras se ajusta la vela; probar dos pulgares en móvil antes de añadir más.
  Alternativas mantenidas/asistidas, señales de forma/sonido además del color y sin pulsaciones rápidas.
- Bonificaciones mediante eficiencia/empujes acotados del modelo de movimiento, conservando inercia.
  No sumar porcentajes de remo, vela, ola, crew y consumibles sin un presupuesto conjunto verificable.
- En persecución, el mismo entorno y reglas para ambos barcos. La oportunidad es visible, disputable
  por posicionamiento y no garantiza escapar. Frenar o virar mal puede costar la línea favorable.
  Cambiar cámara, piloto o conexión no renueva la oportunidad ni borra riesgo.
- Ganar tiempo cambia ganancias por hora: evaluar comercio neto, suministros y exposición junto al
  tiempo de llegada. No conceder dinero, combustible ni reparación gratuita por un acierto.
- Velas, vapor y motor pueden tener distintas decisiones: trimado, presión o marcha/temperatura.
  Es visión futura; no un requisito de administrar varios medidores constantemente. Motores conservan
  consumo y logística; nuevas eras no vuelven obsoletas las construcciones simples por defecto.

## Ritmo y escena objetivo

Alternar salidas/atraques precisos, tramos tranquilos con vida a bordo, oportunidades breves y encuentros
que cambian decisiones. La frecuencia depende de zona/clima/ruta; no un contador que siempre interrumpe
al mismo intervalo. Una ruta protegida frente a jugadores puede tener mar, exploración y PvE anunciado.
Un atajo disputado debe advertirse antes de entrar: aprovechar una corriente no implica consentimiento PvP.

Escena objetivo, **no función entregada**: llevas mineral en tu casa-barco; aparece una ráfaga y un pirata
entra por popa. Tu amigo ajusta la vela mientras tú anticipas una curva hacia una corriente. La nave
cargada tarda en responder, por lo que puedes abandonar esa línea segura o soltar una caja valiosa.
El enemigo elige perseguir o recoger. Alcanzáis el paso con espuma, lona tensada y el taller visible en
cubierta. La emoción sale de pilotar y decidir con tu construcción, sin abrir un minijuego que oculte el mar.

## Camino de prueba recomendado, pendiente de aprobación

1. Conservar la cola actual: móvil D06b y revisión visual/humana de D08a; M5/D09 puede avanzar con su dueño.
2. Si el autor elige esta dirección, abrir un corte experimental de ajuste de vela en la bahía aislada.
   Empezar enseñando ajuste en viento fijo, después comparar ayuda básica y ajuste activo con una secuencia
   de ráfagas reproducible. Sin perfil, XP, carga real, pérdidas ni protocolo de juego.
3. Si el control es agradable, probar una segunda oportunidad de ola/corriente; no implementar las siete
   actividades antes de saber si una sigue gustando. Corriente es alternativa si el oleaje cuesta demasiado
   o no resulta legible desde cámara isométrica. Mantener oportunidad y ruta comparables entre pruebas.
4. Llevar la selección a autoridad/predicción/cubierta móvil en el orden de D08; actividades de viaje
   y NPC pertenecen a D10. Bienes expuestos exigen D09; persecución/PvP se valida en D11.

Comparar balsa vacía, lastre centrado/periférico y casa cargada; mismas condiciones y rumbo de destino.
Medir tiempo/distancia, correcciones, giros, fallos, uso voluntario y pérdida de control mientras se ajusta.
Preguntar tras varios trayectos si quieren repetirlo y si lo sintieron como obligación. Probar un tramo
sin participar: debe seguir siendo razonable. Repetir con mando y móvil horizontal/vertical.
Decidir duración/frecuencia/ventaja después de probar; no adoptar porcentajes o ventanas de balance ahora.

Descartar o cambiar el minijuego si solo produce más clics, si hay una secuencia siempre óptima, si falla
en táctil, si obliga a cooperativo o si vuelve irrelevantes peso/distribución y decisiones de ruta.
Comprobar determinismo y consistencia a diferentes FPS; después latencia/predicción al integrar online.
Capturas y emulación no prueban rendimiento en un teléfono real.

## Ampliación del autor — maniobras críticas y rutas cambiantes

2026-10-06, segunda ronda. El autor valora las opciones iniciales y pide muchas alternativas
para analizar juntos: actividades que también hagan divertido el combate y permitan salvarse
en desventaja, rutas marítimas cambiantes y un ajuste de vela con impulso fuerte durante varios
segundos. Esta intención amplía la discusión; no selecciona todavía maniobras, recursos o cifras.
Tres análisis Luna aportaron catálogo activo, entorno y crítica de balance; el principal conserva
la síntesis y la elección de recomendaciones. No se implementó ni se verificó diversión jugable.

### Qué significa un impulso que cambia la situación

La maniobra debe tener suficiente efecto para alterar una oportunidad real: cruzar el arco de una
andanada, alcanzar la entrada de una corriente, abrir distancia para una reparación o adelantar
al rival para interceptarlo. La magnitud se evalúa por esos resultados, además de por velocidad.
Una ventaja breve puede ser fuerte sin convertirse en velocidad superior permanente.

La aceleración sigue siendo progresiva, con masa, vela, viento y espacio de maniobra. Un mercante
pesado necesita anticiparse; un barco ligero puede aprovechar una apertura tardía. La maniobra
no crea flotación, elimina sobrecarga ni detiene al perseguidor. No concede invulnerabilidad.
Como ejemplo de ventana para experimentar, no balance acordado, podría evaluarse un empuje
de varios segundos (por ejemplo 5–8) y observar si cambia la línea de tiro o permite tomar un paso.
No todas las ayudas necesitan ese mismo tiempo, efecto o mecanismo de recuperación.

Tres modelos alternativos de acceso al impulso:

| Modelo | Qué permite | Compromiso |
|---|---|---|
| **Oportunidad del mar** | Capturar una ráfaga u ola cuando pasa por tu ruta; leer y posicionarse | No siempre está disponible. Es un fenómeno compartido; el primer barco no consume el viento para los demás |
| **Esfuerzo del aparejo** | Forzar temporalmente la vela cuando necesitas actuar, siempre que haya viento utilizable | Acumula tensión y después pide navegar sin forzar; posible pérdida temporal de eficiencia. No tiene daño aleatorio por una oportunidad benigna |
| **Reserva operativa** | Usar un esfuerzo acotado de remos/tripulación o una maniobra de motor | Tope por barco y tecnología. Motor consume recursos reales; no elegir ahora si el esfuerzo de tripulación requiere provisiones, descanso u otro recurso |

Recomendación para comparar: oportunidad ambiental frente a sobretensión voluntaria. Una combinación
posterior podría dar decisiones interesantes, pero necesita presupuesto conjunto para impedir sprint
continuo. Cambiar piloto, cámara o conexión no recupera recursos ni reinicia ventanas. No conceder
un recurso automático por tener pocos HP: el jugador prepara su salida con opciones accesibles,
observación, equipamiento o un sacrificio; no con una alteración invisible de reglas a su favor.

### Catálogo de opciones para discutir

Todas las filas son propuestas; algunas exigen sistemas todavía inexistentes. No equipar todas
las maniobras simultáneamente ni exigir todas las actividades durante cada viaje.

| Opción | Momento fuerte | Coste, fallo posible y respuesta del rival |
|---|---|---|
| **1. Captura de ráfaga** | Ajustar vela y rumbo para atravesar una línea de fuego o alcanzar un paso con empuje breve | Necesita viento y posición; un ajuste tardío pierde la oportunidad. El rival puede capturar la misma racha o cortar la salida |
| **2. Sobretensar aparejos** | Elegir un empuje extraordinario cuando no puedes esperar otra racha | Tensión y recuperación posterior; depende del viento. El rival puede aguantar el sprint y atacar cuando baja la eficiencia |
| **3. Virada comprometida** | Coordinar vela/timón para cambiar la línea de tiro o de persecución | Sacrifica avance y exige espacio; masa e inercia limitan el giro. Un rival que reserve su disparo puede aprovechar tu desaceleración |
| **4. Recoger vela y amagar** | Reducir avance cuando una andanada ya apunta por delante; escoger después otra línea | Puedes quedar más cerca del atacante. No es un freno instantáneo; el rival puede repartir disparos o esperar |
| **5. Boga de emergencia** | Empuje limitado en calma para salir de una zona lenta o orientar una balsa | Reserva operativa por definir, tope por barco; muchas personas no multiplican el empuje sin límite. El rival conserva espacio para interceptar |
| **6. Soltar carga selectiva** | Sacrificar una mercancía para mejorar aceleración/giro y ofrecer botín alternativo | Pérdida real y retirada única. El rival elige recoger, seguir o dividirse; no supone que toda tripulación abandone la caza |
| **7. Ancla de arrastre** | Frenar y ayudar a pivotar si profundidad, velocidad y equipo lo permiten | Compromete movimiento y equipo; carga de cuerda y límites deben probarse. El rival puede atacar durante la recuperación. Nunca giro perfecto a máxima velocidad |
| **8. Gancho de virada** | Usar un punto fijo visible y válido para doblar una esquina con una maniobra espectacular | Solo donde exista anclaje, con alcance/masa/tensión limitados; modelado nuevo y mayor complejidad. La trayectoria es previsible y la cuerda puede fallar según reglas visibles |
| **9. Montar una ola** | Mantener una línea favorable para una aceleración que abra o cierre distancia | Espacio y anticipación; tomar mal la ola pierde avance. El rival también puede montarla |
| **10. Corriente que bifurca** | Elegir tarde entre dos salidas para alterar una intercepción | Una salida puede alejarte del destino; el barco pesado decide antes. El rival puede predecir, acompañar o cortar por otra ruta |
| **11. Canal de marea** | Cruzar un atajo temporal compatible con tu calado y escapar de una nave mayor | Ventana anunciada, calado ligado al barco/carga y alternativa. El rival puede esperar a la salida; el paso no aparece o desaparece debajo del casco |
| **12. Banco de niebla** | Romper contacto visual y elegir un rumbo nuevo | Tú también pierdes información. Sonido/estela/señales pueden permitir seguirte según reglas por definir; no borra ataques válidos ni combate |
| **13. Borde de temporal** | Rodear o cruzar una franja de clima para dificultar la persecución | Control/visibilidad y eventual riesgo anunciado. El rival puede rodear y anticipar salida; no es refugio inmune |
| **14. Pantalla de humo** | Gastar un recurso para ocultar la intención de giro o de reparación | Duración/área acotadas y visión reducida para ambos; el rival puede cubrir salidas o disparar a posiciones probables |
| **15. Engaño de rumbo/señuelo** | Soltar un objeto identificable o amagar hacia una ruta para provocar una mala decisión | Ocupa módulo/recurso si se adopta; un rival atento puede reconocerlo. Sin copia perfecta del barco, HUD falso obligatorio ni pérdida forzada de control enemigo |
| **16. Vela auxiliar de emergencia** | Desplegar superficie adicional previamente instalada para aprovechar viento favorable | Peso/espacio, tiempo de despliegue y límites de estructura; no potencia gratuita almacenada. El rival ve el despliegue y puede forzar una curva desfavorable |
| **17. Sobremarcha de motor/vapor** | Potencia breve independiente del ajuste de vela para interceptar o huir | Combustible/calor/presión y recuperación. Conserva masa; es contenido tecnológico posterior, no requisito para la balsa inicial |
| **18. Reparación de emergencia localizada** | Restaurar parcialmente un timón o aparejo para volver a responder durante la lucha | Repuesto y tiempo, alcance/interrupción por definir; reparación acotada, no HP completo. El rival puede mantener presión. No fabrica piezas ni carga duplicadas |

Humo y niebla necesitarían reglas compartidas de información/detección, incluyendo NPCs. Reducir
VFX en móvil no permite ver mejor a través de una cobertura; sus señales y consecuencias deben
seguir siendo legibles. Un cliente no recibe omnisciencia que el diseño le pide fingir que ignora.
Señuelos no obligan al perseguidor a dispararles ni alteran sus inputs: engañan mediante información
del mundo que puede interpretar. Saltar/caminar para una estación no será obligatorio en cada ajuste.

### Rutas cambiantes sin perder un mundo que aprender

Geografía, puertos y reglas de exposición/PvP siguen siendo estables y se consultan antes de entrar.
Lo que cambia es la utilidad de una ruta por viento, corriente, marea o visibilidad compartidos.
Una oportunidad rápida no convierte silenciosamente unas aguas protegidas en zona de combate.
Las mareas pueden cambiar disponibilidad de un paso fijo, pero no mover los puertos ni inundar
por sorpresa una casa en tierra. Escala temporal, frecuencia y alcance se deciden con pruebas.

- **Corredores de viento:** favorecen un rumbo por una ventana anunciada; las banderas/nubes/agua
  ayudan a leerlo. Desviarse para capturarlo puede ser mala decisión si luego debes volver contra viento.
- **Corrientes que rotan o bifurcan:** cambian entradas útiles y salidas a vigilar. La carta muestra
  previsión útil; no una garantía exacta que hace innecesario observar el mar.
- **Pasos de marea:** calendario/señales y calado requerido; decidir esperar, aligerar o tomar la vuelta.
- **Niebla/frentes:** se desplazan gradualmente, ofreciendo cobertura con incertidumbre para ambos.
- **Restos u obstáculos en movimiento:** trayectoria advertida, alternativa y presupuesto reducido;
  opción posterior para variar líneas. Nada aparece debajo de un barco para salvar o castigar a alguien.

La previsión y el conocimiento local pueden ser un oficio útil sin exigir consultar una wiki:
información suficiente en carta/puerto y mejoras de lectura mediante navegación o mesa de cartas.
Descubrir un atajo no hace inútil el camino estable; una casa pesada puede preferir ruta amplia,
un mercante puede esperar la marea y una balsa ligera puede aprovechar una ventana corta.
Evitar añadir muchos cambios solo para alargar trayectos y vender después un módulo que los elimina.

### Consecuencias y criterios de elección

Que ambas partes tengan maniobras permite que un pirata use ráfaga para interceptar, una virada
para entrar en arco y niebla para preparar una emboscada; no una colección de salvaciones exclusivas
del defensor. La ventaja nace de posicionamiento, anticipación y decisiones, sin conocimiento perfecto
obligatorio. Ningún boost asegura alcanzar o escapar de cualquier nave.

La nave pesada también necesita opciones útiles: una reparación localizada, humo con coste, anticipar
un corredor o negociar/soltar bienes pueden darle salida. No probar solo que una balsa vacía puede
esquivar. Navegación y materiales pueden mejorar tolerancia/recuperación, pero no volver inútiles
estas actividades para principiantes ni dar ventajas enormes simultáneas de nivel y precisión manual.

En solitario/táctil: dirección continua y una acción contextual extra con ventanas amplias; elegir
qué maniobra llevas antes de multiplicar botones. El sistema puede ser exigente por decidir el
rumbo y el momento, sin depender de golpeteo o de acertar un fotograma. Cooperativo reparte atención
y funciones dentro de límites por barco; no concede reservas infinitas por cambiar de jugador.

Recomendación inicial, **no selección aprobada**: ráfaga fuerte + virada comprometida + una corriente
con dos líneas/salidas visibles. En bahía aislada, comparar ayuda básica y control activo contra una
andanada guionizada o un perseguidor de prueba. Después variar ligero/pesado, carga/distribución y
posición inicial. Comprobar tanto una ventana que permite salvarse como una ejecución tardía que
no lo logra. La prueba no entrega combate naval integrado ni arriesga mercancías persistentes.

Medir distancia relativa, tiempo en arcos/alcance, maniobras necesarias para entrar/salir, uso y
recuperación del impulso, respuestas útiles del perseguidor y legibilidad. Preguntar si atribuyen
el resultado a una decisión comprensible y si quieren repetir. Si toda oportunidad garantiza
escape, si el pirata nunca puede responder o si solo gana el barco más pequeño, volver a ajustar.
No imponer tasas de éxito ni pérdida definitiva por este brainstorm. Continúan las puertas
móviles/visuales de D08, autoridad/predicción, D09 para riesgo y D11 para PvP público.

## Assets y límites de esta misión

Revisada [la evaluación D08 de Unreal/FAB](research/unreal-assets/D08-REUSE.md): existen candidatos
de salpicadura/viento como referencia visual; no un sistema naval portable comprobado. La propuesta
reutiliza balsa, atlas y agua actuales. Antes de implementar una nueva señal/efecto, reabrir solo su
candidato concreto y registrar encaje/exportación/presupuesto; no repetir el inventario completo.

Esta misión solo registra discusión y enlaces. No modifica controles, simulación, activos Unreal,
Supabase, demo ni estado de aceptación. Los próximos agentes deben distinguir esta recomendación
de las decisiones que el autor apruebe después.
