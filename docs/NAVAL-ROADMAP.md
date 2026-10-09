# Barcos habitables, rutas y mundo productivo — hoja de ruta

Fecha: 2026-10-04. Estado: **dirección del autor registrada; implementación pendiente**.
Esta hoja incorpora su respuesta a [la discusión inicial](NAVAL-HOUSING-DISCUSSION.md).
Discusión adicional solicitada el 2026-10-06: [navegación activa y actividades de travesía](NAVIGATION-ACTIVITIES-DISCUSSION.md).
Solo propuestas; no modifica acuerdos, estado de implementación ni orden de entregas.

Las filas acordadas orientan los milestones. Las fórmulas, formatos de combate y ejemplos marcados como
recomendación siguen abiertos; este documento no anuncia sistemas ya jugables.

## 1. Dirección acordada con el autor

| Área | Dirección que debe conservarse |
|---|---|
| Hogar | Construir y habitar en tierra o en un barco modular; aire después. Poder dejar reservas en puerto y llevar solo lo que se quiere arriesgar |
| Escala | Calidad de materiales y habilidad de navegación condicionan el tamaño/capacidad útil de la balsa/barco. Un posible nivel propio de la embarcación queda por definir |
| Maniobra | Peso y carga deben afectar mucho el giro y la movilidad. Navegación mejora el manejo de forma apreciable; no elimina todas las desventajas de un barco grande/pesado |
| Distribución | El acomodo de piezas y módulos cambia estadísticas y manera de combatir, además del aspecto |
| Acción | Tirar carga para ganar velocidad/maniobra es una decisión táctica real durante la persecución |
| Derrota | Recuperación con costes; reparar, restaurar o recoger pecios nunca duplica módulos ni carga |
| Rendición | Ofrecer parte de la carga para negociar la salida, con reglas verificables y consecuencias |
| Piratería | Patrullas, notoriedad y bounty; agresiones pueden encarecer servicios, restringir ciudades y provocar persecución |
| Señales | Explorar banderas de exposición y marcas de agresión como referencias distintas; no confundir el riesgo voluntario con delito |
| Rutas | Opciones seguras de ganancia modesta, o largas que compensen distancia con bienes/ganancias; atajos disputados por NPCs y jugadores |
| Viaje seguro | PvE vencible y problemas con respuesta: piratas NPC, provisiones/plagas, oleaje/clima. Seguro frente a jugadores no equivale a viaje sin actividades |
| Oficios | Crafting extenso, materiales por tier y región, cadenas productivas y harvesting en zonas terrestres con combate |
| Comercio | Especialidades/niveles que abran mercancías, mayores cantidades o mejores condiciones de compra/venta |
| Perlas | Progresión por uso y afinidad con el poder; guardar ese aprendizaje. La regla actual de circulación de la perla sigue vigente |
| Ciudades | Consumo/demanda de materiales y entregas de jugadores/caravanas; escoltas asaltables y progreso visible de edificios/recursos por milestones |
| Tecnología | Convivencia de balsa/velas, motores, buques, estética victoriana/steampunk y enclaves de alta tecnología, incluso robots |
| Exposición | Las mercancías y recursos que llevas en tu casa-nave se arriesgan al entrar en aguas de combate; un cofre privado no los vuelve inmunes |
| Entrega | Avanzar desde una versión básica completa hacia sistemas más complejos |

## 2. Tamaño, materiales, navegación y distribución

Recomendación: separar **límite estructural**, **límite de operación competente** y **límite técnico del juego**.
Materiales/casco habilitan una superficie, altura y carga estructural; navegación permite aprovechar barcos más
exigentes y mejora su respuesta. El límite técnico protege el rendimiento y no se compra ni se supera con XP.
Empezar con navegación de balsa y ampliar familias después. No exigir varias maestrías antes del primer viaje.

La habilidad no crea flotación. Un piloto experto puede manejar mejor una balsa cargada, pero no hacer que
144 casillas de madera básica funcionen como un casco reforzado. Tampoco una pieza de tier alto debe elevar
por sí sola todo el barco: definir refuerzos/casco elegible y una regla de calidad estructural verificable.
Un piloto poco entrenado conserva acceso al barco y al plano; cualquier restricción de ampliación/salida debe
explicarse antes de pagar materiales. Cambiar de piloto no borra piezas ni repara daños.

| Entrada | Efecto recomendado, aún sin números de balance |
|---|---|
| Calidad de casco/refuerzos | Capacidad estructural, durabilidad, flotación por peso, coste de reparación |
| Masa total | Aceleración/frenado, velocidad y esfuerzo para girar; incluye piezas, carga, provisiones y munición |
| Masa alejada del centro | Mayor resistencia al giro; concentrar maquinaria/carga pesada permite responder mejor |
| Distribución izquierda/derecha y altura | Penalizaciones acotadas de equilibrio/estabilidad; aviso visual y explicación |
| Posición/orientación de armas | Arcos de tiro y cobertura; poner cañones en todos los lados cuesta peso, espacio y logística |
| Navegación | Mejor respuesta del timón y acceso a maniobras; bonus limitado para conservar los roles de tamaños |
| Daño operativo | Propulsión, timón y flotación efectivos reducidos; recalcular sin alterar el plano conservado |

Primera versión: agregados deterministas, no hidrodinámica completa ni física individual de cada tablón.
Separar volumen de bodega y peso: llenar una bodega con plumas no equivale a llenarla con mineral. Hoy
`cargo.js` combinaba espacio/peso; D08c.8 incorpora dimensiones independientes de catálogo y lectura nominal.
Para que el acomodo de carga importe habrá que asignar contenido a módulos de bodega, además de un total global.

El editor debe mostrar antes/después de colocar o mover una pieza: carga, flotación, velocidad, tiempo de giro
y arcos. La comparación «vacío / carga prevista» tiene que ser visible al zarpar. Probar balsa ligera, mercante
cargado y fortaleza; un experto mejora el mismo barco, pero la fortaleza no obtiene toda la movilidad del pequeño.
No fijar ahora porcentajes, grados por segundo ni XP. Un nivel de barco, si se adopta, conviene que represente
certificación/refit financiado, no un multiplicador universal por edad o por hundimientos.

Tirar carga retira bienes reales del barco y actualiza el peso de inmediato; quedan a flote disputables o se
pierden según su tipo. El enemigo puede elegir perseguir o recoger. Nada de recuperar automáticamente lo
tirado al volver a puerto, convertirlo en una mejora gratuita o expulsar suministros sin consecuencias.

### 2.1 Porte y mejoras del barco — revisión 2026-10-07

**Enfoque aprobado por el autor el 2026-10-07:** masa y volumen separados, porte limitado por
estructura/flotación y más capacidad mediante mejoras o ampliación del barco. La fórmula
conceptual y los roles de las mejoras siguientes quedan como base de implementación.
Las cifras, los márgenes de seguridad y los umbrales requieren calibración; esta aprobación
no equivale a balance probado ni activa nuevos bloqueos de gameplay.

Estado previo a D08c.8: `cargo.js` limitaba el espacio abstracto de bodega usando `GOODS.w`;
`trial.js` emplea ese mismo `w` como masa e incluye mochila y bodega. El rig vivo suma peso de
piezas y carga, compara con flotación y penaliza manejo al sobrecargar. No existe aún un máximo
estructural que prohíba zarpar. `raftStats()` económico usa media unidad de masa por unidad de
espacio, mientras el pilotaje usa una completa; unificar esa fuente antes de aplicar límites.
Materiales por tier y skill de navegación todavía no entran en esa capacidad.

**Checkpoint D08c.8 local:** `volume` conserva todos los valores de espacio anteriores; `mass`
independiente alimenta `holdMass`, `raftStats` y el rig vivo. Snapshot privado y paneles muestran
nave equipada, carga de bodega y mochila del dueño, espacio y porte nominal restante/exceso;
editor anticipa colocación con materiales consumidos. [Entrega](delivery/d08c8-raft-capacity.md).
La lectura usa flotación existente, sin límite estructural/materiales ni reserva nuevos; masa corporal/
tripulantes y mochilas de invitados también siguen abiertas. No se presenta como implementación de
la fórmula completa ni bloquea cargas/salida; los números de densidad son tuning inicial por calibrar.

Base acordada: dar a cada bien masa y volumen independientes. Medir el porte como
`máximo de carga = max(0, min(límite estructural, desplazamiento seguro) - masa de la nave equipada - masa de tripulación)`.
El límite estructural depende de casco/refuerzos elegibles y materiales; el desplazamiento
seguro depende del volumen de casco o flotadores útiles, con margen de reserva por calibrar.
Pisos superiores, paredes, mobiliario, maquinaria, armas, velas y módulos de bodega consumen
peso; no añaden flotación. La mochila y suministros a bordo también consumen porte.

| Mejora | Lo que aumenta | Coste o límite que conserva |
|---|---|---|
| Bodega/cajas | Espacio para mercancía | Pesan; no crean capacidad de flotación |
| Más casco/flotadores o diseño con mayor desplazamiento | Porte útil | Tamaño, resistencia al giro y materiales |
| Casco/refuerzos de mejor calidad | Capacidad estructural y durabilidad | Deben mejorar la estructura real, no una pieza aislada |
| Vela/motor | Empuje para mover la carga | Peso, espacio y requisitos; no eleva por sí solo el porte |
| Navegación | Respuesta y aprovechamiento del barco | No multiplica la flotación ni sustituye un upgrade |

Primera lectura implementada en D08c.8: masa/volumen separados y lectura autoritativa.
**D08c.9 local** añade límite mínimo estructura/desplazamiento seguro (90% de flotación), 3 uM por persona,
mochilas consentidas, aviso pesado al 85%, bloqueo de zarpe nuevo e ingreso de bodega que aumenta exceso.
Refuerzo 1:1 cuesta 1 madera + 1 hierro: cimiento 10→14 uM estructurales, 4→5 uM propios, 60→90 HP,
sin nueva flotación. Balsa inicial con piloto: 16 uM de bienes; un refuerzo 19; cuatro 22,4.
[Contrato](briefs/d08c9-raft-load-limits.md), [entrega](delivery/d08c9-raft-load-limits.md).
Cifras iniciales sin balance físico; tiers/skill/lastre humano dinámico siguen posteriores.
**D08c.10 local** incorpora reparación material por instancia en puerto; conserva daño al atracar/remontar
durante la sesión, reconstruye casilla original, refuerzo mantiene fracción HP y retiro devuelve según
condición. Módulos destruidos dejan de producir/aportar porte; plano y mercancía se conservan.
[Entrega](delivery/d08c10-raft-repair.md). Condición/pose durable y recuperación entre sesiones siguen
pendientes en ese checkpoint antes de introducir amenazas con riesgo económico público.
**D08c.11 local** conserva IDs/HP por instancia y última pose confirmada al guardar/reentrar.
El personaje vuelve a su checkpoint y la balsa reaparece detenida, sin piloto/tripulación.
Costa válida permite reembarque cercano; recuperar en puerto conserva daño, mercancía y plano.
Pose incompatible/otro seed/sin flotación vuelve al amarre sin curación ni pérdida de carga.
[Entrega](delivery/d08c11-raft-recovery.md): 617/617 pertinentes y 3/3 vistas emuladas locales.
HMAC guest y cuenta/CAS en memoria; guardado periódico y replay guest conservados, sin exposición
offline, Supabase live, SQL o publicación. Sigue primera ruta/amenaza PvE limitada; D09/M5 deben
cerrar custodia/pérdidas antes del riesgo económico público permanente.
**D08c.12 local** añade ensayo opcional: tres boyas en orden, batería anclada con salvas a marcas
fijas/aviso de 2 s y regreso con atraque real. Daño por instancia viva en casco girado, 6 HP por
impacto/hasta 24 por ensayo y piso del 50%; se guarda/repara sin tocar plano/carga. Sin botín/XP,
progreso/resultados de sesión. [Entrega y evidencia](delivery/d08c12-naval-route.md):
15/15 nuevas + 371 previas seleccionadas + 9/9 host y 3/3 vistas emuladas con capturas
inspeccionadas; fixtures/incidencias documentadas, sin afirmar balance/dispositivos físicos.
Fuentes Unreal revisadas/intactas y runtime reutilizado, sin nuevas texturas, SQL ni publicación.
Siguiente: armas y rival móvil/derrotable. No cierra piratería/abordaje o riesgo económico público.
Conservar capacidad de regresar si el daño reduce flotación durante el viaje: consecuencias
visibles y recuperación de D09, sin borrar mercancía ni convertir un límite nuevo en pérdida
silenciosa al cargar un perfil. Acomodo por bodega y tiers completos pueden seguir después.
Este enfoque acordado complementa recolección/crafting; no activa pérdidas permanentes ni modifica
la cola principal. Balance de masa, margen seguro y daño en mar quedan por fijar.

## 3. Formato del mar: alternativas y recomendación

El zoom, el modelo de movimiento y la separación de servidores son decisiones diferentes.
Una cámara alejada no necesita otro mundo; entrar en combate no tiene que teletransportar barcos.

| Opción planteada | Lo que aporta | Coste o problema principal |
|---|---|---|
| Mar abierto continuo a escala global | Encuentros orgánicos, persecuciones y refuerzos | Alcance de red/servidor muy grande; no es la capacidad actual del repo |
| Batalla privada creada al atacar | Cupos y escenarios fáciles de controlar; PvE/clima preparado | Separación artificial; problemas para escoltas, terceros, huida y entrar/salir sin exploits |
| Viaje y batalla en mundos distintos | Compresión de distancias; combate detallado | Transferencia de barco/carga y correspondencia entre coordenadas; duplicación o escape por transición si se diseña mal |
| Mar regional compartido con dos escalas de cámara | Encuentros/auxilio dentro de la región; navegar y pelear en el mismo lugar | Requiere sectores acotados, transferencia segura y presupuestos de entidades; continuidad global no resuelta |

**Recomendación pendiente:** mar compartido por regiones acotadas, cámara de navegación más alejada y cámara
de combate cercana. Dentro de una región, cambiar cámara conserva posición, velocidad, daño, participantes
y carga. Patrullas/clima pertenecen a la región o llegan con aviso; no se materializan encima del jugador sin
opción de reaccionar. Cruces entre regiones requieren un único dueño autoritativo del barco y liquidación de
estado; no conceden inmunidad ni permiten huir cambiando zoom.

Un primer prototipo puede ser un encuentro PvE pequeño con entrada/salida explícitas, después dos barcos de
jugadores. Sirve para verificar maniobra y combate; no decide por accidente que toda piratería será una arena
privada. Límite de participantes, refuerzos, reconexión, timeout y reglas del borde quedan por medir antes de PvP.
Si no cabe combate abierto, una instancia pública de encuentro con incorporaciones controladas es alternativa
a evaluar; las mercancías se transfieren una sola vez y el resultado siempre se liquida.

## 4. Acción naval y abordaje

Recomendación: mantener proyectiles legibles/esquivables y habilidades activas, con **movimiento naval propio**.
Un mercante lee la andanada y prepara el giro; una balsa ligera aprovecha huecos; una fortaleza busca su arco
de fuego. No todos necesitan el dash invulnerable del personaje. Acelerar, virar de emergencia, frenar, usar
humo, desplegar defensa o soltar carga pueden ocupar ese espacio de acción, con costes y contraataques.
Vela y motor comparten reglas de masa y logística; tienen maniobras distintas. Impulso, combustible, tensión
de aparejos, enfriamientos y potencia definitiva son propuestas que requieren prototipo.

El objetivo de combate no es siempre vaciar HP: cortar una vela/timón, abrir una brecha, proteger un convoy,
salir con la carga o aceptar rendición ofrecen victorias distintas. El barco se mueve como cuerpo coherente;
daño por módulo y flotación simplificada primero, fragmentos individuales y naufragio complejo después.

| Abordaje | Ventaja | Desventaja |
|---|---|---|
| Arena aparte con módulos simbólicos | Movimiento/combate más sencillo y espacio controlado | El diseño de tu casa y su cubierta pierde protagonismo; hay que reconciliar daño y carga al salir |
| Tus dos barcos reales, con cubierta transitable | Construir pasillos/coberturas y colocar módulos cambia la pelea; conserva identidad | Plataformas móviles, alturas, colisión y latencia son trabajo nuevo |

**Recomendación pendiente:** abordaje sobre las cubiertas construidas. Primero gancho/amarre a velocidad baja,
dos barcos en formación temporal y una pasarela o salto corto validado; movimiento relativo al barco y combate
en una cubierta principal. Esto reduce el problema de saltar entre dos plataformas que giran a toda velocidad.
Permitir soltar amarres con reglas/coste; no inmovilizar indefinidamente a una víctima desde alcance imposible.
Las mismas piezas generan colisiones/cobertura visible; no hace falta una arena que finja ser otro barco.
Saltos largos con barcos móviles, múltiples niveles de combate simultáneos y batallas de muchos barcos después.

Solo: tripulación básica automática y órdenes de rumbo/disparo/defensa. Cooperativo: jugadores pueden ocupar
estaciones o abordar. La automatización ayuda a operar, no aporta tripulación infinita ni hace obligatorio llevar
amigos. Definir quién gobierna el barco mientras su dueño pelea y qué hace la tripulación enemiga al abordarla.
Habilidades del pirata contra personas, módulos y casco tendrán categorías/alcances propios; no convertir una
perla de tierra en arma de asedio sin balance explícito. El movimiento de un personaje y el de su barco son distintos.

## 5. Riesgo, rendición, notoriedad y recuperación

Propuesta de tres capas legales independientes:

1. **Región/ruta:** puerto protegido, ruta protegida frente a PvP con PvE, o aguas disputadas anunciadas antes de entrar.
2. **Bandera/contrato voluntario:** trabajo/riesgo adicional visible y mejores oportunidades; no declara culpabilidad.
3. **Agresión/notoriedad:** hechos del servidor, facción afectada, sanciones y bounty. Defenderse no equivale a iniciar delito.

Definir qué agresiones son ilegales incluso en aguas disputadas, y cuáles pertenecen a contratos/guerras
consentidas. No asumir que todo PvP es impune o criminal. Notoriedad persistente y marca de agresor inmediata
son estados separados; cambiar bandera no limpia delitos. Facciones pueden aplicar sanciones diferentes.
Patrullas persiguen según alcance/inteligencia, no por omnisciencia permanente sobre todo mercante.
Debe existir salida jugable para un pirata: puertos clandestinos/servicios más caros y una vía acotada de
reducir notoriedad. No prohibirle todo comercio hasta condenarlo a abandonar el personaje.

Bounty monetario, financiación, elegibilidad y pagos quedan por definir. No pagar oro infinito por matar ni
permitir cobrar repetidamente por un aliado/alter ego. Primero marcar, sancionar y patrullar; después contratos
de cazarrecompensas con fuentes y límites de pago verificables.

Rendición: oferta concreta de bienes, aceptación identificada y transferencia atómica. La interfaz debe indicar
quién acepta y qué cese de fuego garantiza. Una tregua de ese grupo no convierte al rendido en invulnerable
frente a todo el servidor. Nuevos atacantes, incumplimiento y reincidencia requieren reglas visibles; no retirar
carga varias veces por repetir el comando o reconectar.

Puerto: depositar reserva allí la protege **en ese lugar**; retirar, producir a bordo o transportar vuelve a
exponer bienes. El puerto no teletransporta existencias al destino. El contenido de tu casa-nave también paga
ese riesgo. La protección exacta de muebles/trofeos vinculados y del equipo personal sigue pendiente: no crear
una categoría «doméstico» que permita comerciar materias primas invulnerables.

Restauración propuesta: conservar identidad/plano y reparar el estado operativo mediante materiales/servicio
en un puerto registrado, sin devolver bienes perdidos ni avanzar la ruta. Retirar instancia anterior antes de
restaurar; un pecio no deja una copia vendible de cada módulo mientras el astillero devuelve otra.
Rescate/seguro no puede crear riqueza neta al hundir barcos propios o de aliados. Primer servicio en especie;
costes, tiempos, porcentaje de carga perdida, protección de patrimonio y captura de barco siguen abiertos.
Amarre seguro y desconexión en combate requieren política propia, acotada y reconectable; no aplicar una
supuesta inmunidad al cerrar el navegador ni exposición offline indefinida.

## 6. Oficios, rutas y afinidad

Una red productiva por regiones debe dar motivos para cosechar, fabricar, transportar y proteger:
recurso local → refinado → componente → módulo/consumible/obra. Cada receta declara skill, estación,
entradas, salidas, cantidades y tiempo. Tier superior tiene coste/logística y ventajas específicas; no hace
obsoletos todos los materiales inferiores. Taller terrestre y fabricación a bordo comparten datos, con costes,
capacidad y especialidades distintas para que navegar no sustituya a todos los puertos.

Primera cadena propuesta, ilustrativa: madera local + fibra → tablones y lona → vela/bodega. Otra región aporta
mineral → metal/refuerzos; la ciudad mecánica necesita ambas familias más combustible/repuestos. No elegir
todavía nombres finales, recetas extensas ni porcentajes de éxito. Harvesting terrestre con enemigos debe
resolver exploración, reaparición de nodos, capacidad y extracción; PvP terrestre solo donde esté anunciado.

Comercio: empezar con pocas especialidades por familia, por ejemplo alimentos, materiales y manufacturas.
Abrir surtido/contratos, cantidades y negociación limitada. La skill no fabrica stock, ignora leyes o da un
descuento que permita comprar y revender sin mover bienes para generar oro. Aprendizaje por entregas/actividad
válida; disminuir crédito de bucles entre amigos/cuentas o recompras sin aporte productivo.

Rutas: comparar ganancia **neta por tiempo**, coste de suministros, variación de resultados y riesgo de quebrar,
no solo el precio de destino. Las protegidas necesitan actividad interesante, con avisos y respuestas: reparar
aparejos tras oleaje, proteger comida de plagas, vencer/evadir un NPC o refugiarse del temporal. No usar una
tirada inevitable de pérdida como sustituto del combate que el jugador esperaba poder ganar.
No exigir viajes rutinarios larguísimos para hacer viable la ruta segura. Bienes raros también pueden llegar por
rutas largas protegidas, con costes/margen acordes; el PvP no será requisito de progresión doméstica.

Afinidad de perla: recomendación de XP por **personaje + tipo de poder**, separada del UID físico de la perla.
La perla cae/circula; el aprendizaje queda y solo aplica al poder que llevas. Prestar una perla no presta sus
niveles. Un tipo distinto conserva su propio aprendizaje. Más control/opciones antes que un multiplicador
enorme de daño; primeras mejoras, techo y reset quedan por definir. Uso válido contra objetivos/desafíos,
no subir de nivel pulsando G en puerto ni golpeando un aliado infinitamente.
No alterar automáticamente maldiciones, circulación o balance ya entregado de M4.8.

## 7. Ciudades y tecnologías que cambian el mundo

Separar demanda ordinaria del mercado de **pedidos de desarrollo** con cantidades, destino y plazo.
Mercado puede abastecer consumo normal; una obra acredita solo entrega real aceptada, nunca la promesa de
carga en tránsito. Caravanas/escoltas mueven bienes identificados: saqueados no cuentan también como entregados.
Pagos y materiales deben tener fuentes/sumideros explícitos; no crear caravanas infinitas explotables.

Ejemplo propuesto: entregas de madera/metal/lona financian un astillero, una caravana intenta completar la
última remesa, escoltas y piratas disputan ese cargamento; al llegar, aparecen andamios y después el edificio,
con nuevas recetas/servicios. Una intercepción retrasa suministros y altera oferta/rumores. Primera versión:
no permite borrar una ciudad ni viviendas ajenas offline. Decidir límites de aportes, ayuda NPC y alcance de
los milestones para no dejar un servidor pequeño eternamente bloqueado ni uno grande terminado en una tarde.

Convivencia tecnológica por regiones/cadenas, no un árbol donde un robot invalida toda vela. Motores necesitan
combustible/repuestos; vapor aporta potencia con masa/calor; tecnología avanzada requiere componentes y
servicios especializados. Vela puede ofrecer autonomía y bajo coste. Roles, alcance y contrajuego mantienen
viables construcciones simples; presupuestos numéricos y tecnología jugable concreta quedan por probar.
Enclaves de robots son visión de contenido posterior; compartir contratos de módulos/crafting desde el inicio,
sin intentar fabricar todas las eras ni las naves aéreas en la primera entrega.

## 8. Orden y aceptación por rebanada

Orden operativo junto a assets y misiones de agentes: [PLAN-DELIVERY.md](../PLAN-DELIVERY.md).
Esta sección conserva los hitos de diseño; el plan de ejecución concreta sus entregas/checkpoints.

El orden de abajo es recomendación de entrega, con dependencias explícitas. No renumera M5–M8 ni marca
checklists anteriores como terminadas. Los prototipos pueden vivir en memoria; economía pública persistente
requiere primero las transacciones de M5.

| Rebanada | Milestones | Resultado comprobable antes de ampliar |
|---|---|---|
| A. Base actual | M4.8 | Tormenta/Tinta y cierre del kit existente; afinidad como extensión planificada, no incluida por sorpresa en el cierre |
| B. Habitar y abastecer | M6 A + M7 UI + M8 vivienda básica | Balsa transitable, editor, carga, dos mercados; depositar en puerto y recuperar reservas locales |
| C. Operar lo construido | M6 estadísticas/progresión | Una familia de materiales/navegación; vacío/cargado cambia giro; distribución explicable; tirar carga mueve bienes reales |
| D. Autoridad durable | M5 | Propiedad, transferencias y liquidación idempotentes; depósito, daño/recuperación y reconexión sin duplicados |
| E. Primer mar divertido | M6 B + M7 rutas | Un enemigo naval vencible, dos rutas legibles, proyectiles/maniobra, daño a un módulo, reparación y recuperación del mismo barco |
| F. Piratería controlada | M6 B + M7 legal | Dos jugadores, huida/rendición, saqueo con capacidad real, marca/notoriedad y patrulla básica; después abordaje de dos cubiertas |
| G. Red productiva | M7 oficios + M8 talleres | Pocas cadenas regionales completas, harvesting terrestre, especialidad comercial; probar oro/hora y uso de materiales bajos |
| H. Mundo visible | M8 ciudad + M7 convoy | Pedido, caravana/escolta/intercepción y una obra visible; la misma remesa no llega y se saquea a la vez |
| I. Ampliación | Después de evidencia A–H | Más tiers/tecnologías, afinidad completa, flotas/clima/alturas; aire después |

M5 puede desarrollarse en paralelo con B/C, pero es puerta obligatoria antes de publicar bienes persistentes
en riesgo. Antes de cada etapa, medir teclado/mando/móvil, solo/cooperativo y latencia. La aceptación incluye
estado real y comportamiento visual, no solo datos calculados ni una captura con la simulación detenida.

## 9. Contratos técnicos que el repo todavía necesita

- Identidades estables de barco/pieza; separar plano, daño operativo, ubicación y vida de una instancia.
  El array actual de piezas no basta para intercambiar daño/pecios ni para copiar un barco entre regiones.
- Movimientos de bienes autoritativos: puerto → bodega → expulsado/saqueado/entregado/destruido. Pueden ser
  lotes/cantidades con recibos; no hace falta un UID por cada tablón. Una cantidad nunca ocupa dos destinos.
- Restaurar: pago/materiales, retiro de instancia anterior y activación reparada como operación idempotente;
  validar reintentos, fallos parciales y reconexión. No esperar al autosave periódico para transacciones de riesgo.
- XP/skills/afinidad con defaults, migración y saneado; misiones/acciones acreditadas por servidor.
- Notoriedad, treguas, caravanas y proyectos como estado compartido durable. Perfil cliente no decide aportes,
  liquidación ni créditos. Revisar protocolo al exponer campos nuevos en `you`/snapshot.
- Coordenadas relativas a cubierta, colisiones/pasarela y pose de barco; presupuestos de barcos, piezas,
  proyectiles y tripulación. Recalcular agregados al modificar construcción/carga/daño, no física por pieza a 60 Hz.
- RNG del mundo y eventos reproducibles; resolución de combate/desconexión y fronteras antes de PvP público.

Base actual: `raft.js` agrega masa/flotación/propulsión y velocidad, sin timón/tiers/skill; `voyage.js` es viaje
abstracto con eventos; `market.js` tiene oferta/consumo y precio, no la red completa de oficios; M5 sigue en plan.
Fuente revisada: commit `40949b2` (Escarcha), sin cambios de gameplay en esta actualización de diseño.

## 10. Referencias verificadas y límites

- [UWO — Trading Skills (Papaya Play)](https://wiki.papayaplay.com/uwo/doku.php?id=mer_skills):
  skills comerciales elevan límites de compra; Accounts mejora negociación. Referencia para especialidades,
  no aprobación de nuestras curvas de precios/XP.
- [UWO — Production (Papaya Play)](https://wiki.papayaplay.com/uwo/doku.php?id=prod): receta, skill/rango y
  materiales; recolección en tierra/mar y recetas de NPC que se fabrican allí. Nuestra red por regiones es propuesta propia.
- [UWO — Going To Sea (Papaya Play)](https://wiki.papayaplay.com/uwo/doku.php?id=sea): provisiones,
  previsión de clima y daño por temporales. Plagas/oleaje interactivos son dirección del autor, no mecánicas
  concretas verificadas por esta página.
- [Sea of Thieves — Ships of Fortune, 13-05-2020](https://www.seaofthieves.com/news//ships-of-fortune):
  banderas emisarias vinculan actividad/recompensas y exposición a cazadores. Referencia histórica de intención,
  no descripción completa del balance vigente.
- [Tibia — manual oficial, combate](https://www.tibia.com/gameguides/?section=combat&subtopic=manual):
  marcas de agresión y sanciones por muertes injustificadas en sus reglas PvP. Inspiración para señalización,
  no equivalencia entre sus mundos/modos y nuestras aguas disputadas.
- [EVE — Insurance, actualizado 15-07-2024](https://support.eveonline.com/hc/en-us/articles/212726885-Insurance):
  cobertura del casco, excluyendo módulos/carga. Separar categorías es útil; devolver nuestro hogar mediante
  servicio/materiales es una adaptación propuesta, no una mecánica idéntica a EVE.

Consultadas el 2026-10-04: páginas del operador/desarrollador y resultados indexados de esas mismas páginas;
varias aperturas directas devolvieron timeout/403. No se utilizaron foros de jugadores como prueba.

## 11. Decisiones abiertas antes de implementar sus fases

- Topología de regiones/encuentros y reglas de refuerzos/fronteras; formato final de abordaje y controles.
- Fórmulas de carga/giro, límites por material/skill, nivel de barco y coste de maniobras.
- Patrimonio doméstico/equipo protegido, costes de rescate, pérdida de carga y captura temporal/permanente.
- Legalidad por región/facción, salida de notoriedad, financiación de bounty y alcance de treguas.
- Familias de oficio/afinidad, XP/techo y recetas iniciales; contenido tecnológico que llega en cada fase.
- Proyectos compartidos de ciudad, contribuciones, apoyo NPC y requisitos de población.

La dirección ya está registrada. Las respuestas pendientes no impiden cerrar M4.8 ni avanzar el prototipo
doméstico básico; no deben sustituirse por decisiones silenciosas sobre pérdidas o PvP.
