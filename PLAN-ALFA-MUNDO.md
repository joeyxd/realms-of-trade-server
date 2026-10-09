# Alfa del mundo — Salty Shore y tres pueblos que crecen

Fecha: 2026-10-08. Plan de producto y contrato entre mecánicas, mundo y arte.
Estado: plan aprobado por el autor como base de trabajo; nombres secundarios y cifras siguen ajustables.
Este documento no acredita implementación, rendimiento, migraciones ni publicación.


## Checkpoint S21 - terreno de isla (2026-10-08)

El autor autorizó un pase solo de terreno: [informe local](docs/delivery/map-revamp-v1.md). Conserva base/colocaciones/RNG legacy 400/N401 y amplía por postpass determinista a 560/N561, resolución 1. Suelo seco muestreado +63,148347 % (paso 2, umbral >0,65). Dos conexiones suaves de terreno permiten llegar caminando a puntos interiores (171 y 109 aristas; ascenso máximo 0,1412 y 0,1377 por paso, límite 0,15); se conservan los núcleos húmedos, sin puentes ni assets nuevos. Salty Shore: tres niveles 2,4/6,4/10,4, rampas y seis pads planos de huts existentes. Conserva orden/identidad/XZ de 1.259 props y 176 recursos, con Y proyectada; volcán/boss, PvP, llegada y muelle protegidos. Sin pueblo, gameplay, colisiones, recursos o assets nuevos. No mueve los anclajes de Puerto Sol/Ceniza ni implementa el corredor A3. Alpha 0.1.0-alpha.15/protocolo 31 requiere recarga de host/peers. Aceptación local: 220 pruebas, 30 capturas de escena + 2 del panel M, cinco contextos emulados, 20 chequeos de datos de calidad y geometría reutilizada; catálogo rev. 37 (110 filas, 54 aplicadas); fuentes y enlaces HTTP comprobados. No publicado; FPS físico y multijugador humano pendientes.

## 1. Dirección confirmada y decisiones abiertas

El autor quiere pasar de la validación de sistemas a construir el juego de alfa: tres pueblos especializados
que crecen con ayuda de los jugadores. El primero se llama **Salty Shore**, en la isla existente, y su pueblo
se reconstruye con el agente de arte. La imagen aportada fija plaza, terrazas, arquitectura de madera,
toldos, muelles ramificados, agua turquesa y silueta reconocible. El equipo de mecánicas concreta funciones,
espacios transitables y autoridad; coordina anclas con arte antes de cambiar terreno o colisiones.

La balsa es casa, taller, almacén y transporte. Mejorarla permite traer mejores cargamentos; las obras del
pueblo habilitan nuevas enseñanzas, servicios y cadenas que vuelven a mejorar la balsa y la vivienda.

**Decisión confirmada por el autor, 2026-10-08:** mundos/servers separados, cada uno con sus personajes,
economía y progreso propios. Dentro del mundo elegido, la geografía y el estado son continuos y persistentes
hasta un wipe explícito del server. Se permiten cargas de mapa/sector sin crear una nueva copia del pueblo,
reiniciar contenido ni perder continuidad de barcos, casas, carga y obras. No compartir progreso global.

**Ampliación confirmada por el autor, 2026-10-08:** dos de los tres pueblos se conectan por tierra,
con recursos, bandidos y comercio terrestre; el mar ofrece otra opción de transporte con ventajas y
desventajas. Preparar crecimiento hacia miles de jugadores exige separar población registrada,
concurrencia mundial y concentración local; no supone capacidad actual ni cambia el cupo del alfa.

El autor aprobó continuar con este plan el 2026-10-08. Base de trabajo, ajustable mediante implementación y medición:

- Tres núcleos: Salty Shore, Puerto Sol y Bahía Ceniza; los dos últimos conservan nombres provisionales del catálogo.
- Salty Shore y Puerto Sol en la misma isla, con camino y ruta costera; Bahía Ceniza en otra isla.
  Pareja y ubicación aceptadas como base del plan; S21 modifica el terreno de la isla actual, sin mover los anclajes de Puerto Sol/Ceniza ni implementar el corredor A3.
- Primera meta: ocho personajes conectados, contando humanos y agentes; ocho balsas navegables simultáneamente.
- Conocimiento personal aprendido permanentemente; fabricación sujeta a estación, materiales y permisos.
- Presupuestos iniciales de terreno, viviendas y piezas para medir, no límites de producto ya aceptados.

No cambiar IDs persistidos por un cambio de nombre visible. Salty Shore puede conservar `aldea` internamente
en la primera integración. `sol` y `ceniza` ya tienen identidad económica. Los seis mercados históricos
(incluida Cala) y partidas anteriores requieren una decisión de compatibilidad; este plan no borra datos ni lugares.

## 2. Tres pueblos, tres razones para viajar

| Núcleo | Función y recursos | Edificios de desarrollo | Premios de contenido propuestos |
|---|---|---|---|
| Salty Shore | Inicio, madera/piedra, pesca y víveres; reparación y primeras viviendas | Carpintería comunitaria → almacén de puerto → astillero ligero | Puerta, bodega y vela adicional; después variantes de vivienda/carga |
| Puerto Sol | Fibra, tejidos y provisiones; necesita madera y recibe alimentos | Tejeduría → taller de velas → mercado de suministros | Lona/cuerda, aparejos y velas especializadas; fabricación textil a bordo con compromisos |
| Bahía Ceniza | Mineral y metal; necesita madera/combustible y provisiones | Fundición → herrería → taller naval | Herrajes y módulos metálicos nuevos; armamento dentro del corte naval correspondiente |

Fibra/mineral, recetas de lona/cuerda y sus nodos son contenido nuevo, no recursos hoy conectados.
Las especialidades existentes del catálogo son una base; sus valores actuales no son balance de alfa.

Cada pueblo empieza con un servicio básico útil y acceso a sus materias primas. El avance inicial de Salty
Shore usa insumos locales. Sol puede arrancar con madera disponible desde Salty Shore, y Ceniza con recursos
locales y suministros de los otros dos. Ningún proyecto inicial exige un producto que solo existe tras ese
mismo proyecto, ni uno bloqueado por una dependencia circular entre las tres ciudades.

Viajar ofrece utilidad antes de completar la obra: comprar/vender, conseguir materias distintas y aceptar
encargos. Una ciudad avanzada sigue necesitando recursos básicos; la madera y la vela conservan funciones
por masa, coste y autonomía. Los pueblos abren ramas complementarias, no una escalera universal que vuelve
inútiles los barcos anteriores. PvP no es requisito para construir una casa o aprender las recetas básicas.

### 2.1. Dos pueblos por tierra y por mar

Geografía propuesta: Salty Shore y Puerto Sol comparten la isla inicial; un corredor terrestre une sus
plazas/mercados y una ruta costera une sus muelles. Bahía Ceniza ocupa otra isla, sosteniendo la utilidad
del transporte naval. Los tres pueblos deberán ser accesibles por recorridos reales del mismo mundo persistente.

```text
Salty Shore ===== camino / bosque / recursos ===== Puerto Sol
     \____________ navegación costera ______________/
       \                 mar                     /
                       Bahía Ceniza
```

| Opción | Ventaja propuesta | Coste/riesgo y motivo para mejorar |
|---|---|---|
| A pie por camino principal | Entrada barata; entregas pequeñas, compras urgentes y recolección durante el viaje | Poco espacio; desvíos y encuentros PvE anunciados. Medir tiempo completo y número de viajes necesarios |
| A pie por desvío del bosque | Acceso a recursos y atajos, con decisión de explorar o escoltar | Bandidos más exigentes y menor visibilidad; no debe ser obligatorio para recetas iniciales |
| Balsa por la costa | Más capacidad para mercancía a granel; aprovechar viento/corrientes y combinar puertos | Construir/cargar/atracar/reparar cuesta recursos y tiempo; costa, manejo y carga limitan el viaje |
| Viaje a Ceniza | Acceso a otra cadena productiva y demanda de suministros | Necesita transporte marítimo; preparar provisiones/capacidad y evaluar el recorrido |

La rentabilidad depende de cotización vigente, cantidad transportable, tiempo total de carga/viaje/venta,
consumibles/reparación y riesgo. No garantizar que mar sea siempre más rápido, ni que caminar gane siempre
por no pagar barco. Mantener nichos: porte reducido de bienes valiosos o entrega urgente por tierra;
volumen/peso y expediciones más largas por mar. Un precio anunciado no reserva stock ni garantiza beneficio.

Primera entrega terrestre: personaje a pie y mochila existente; carros, animales de carga y caravanas
organizadas quedan para después. Hoy `PACK_CAP=10` representa **espacio/volumen**, no diez kilos. Definir
aparte masa, carga de equipo y efecto sobre marcha antes de añadir transporte terrestre ampliado; no
trasladar silenciosamente la fórmula de flotación al peatón ni convertir su mochila en bodega ilimitada.
El límite actual de mercancías a pie es de volumen; no acredita una penalización de marcha por masa.

El corredor incluye señalización desde las salidas, un camino principal legible, claros de recolección
y un desvío con campamento de bandidos. Las zonas de encuentro muestran señales/aviso y permiten combatir,
retirarse o elegir otra ruta. La distancia, el retorno y los ciclos de recursos/enemigos se balancean tras
medir recorrido con mochila y barco cargados; cargar un sector no repone el campamento ni sus recompensas.

Propuesta inicial: peligro **PvE** en el camino, sin activar PvP/full-loot. Reutilizar patrones/rigs de
enemigos existentes solo si encajan; `renegado`/`pistolera` pertenecen hoy a Cala, con nivel/ataques y régimen
sin ley propios. No copiar su ley ni su dificultad al corredor de inicio. Daño, retirada, muerte y recuperación
necesitan reglas explícitas; pérdidas públicas permanentes siguen condicionadas por D09/M5 y decisiones del autor.
El campamento del camino se define fuera del régimen `lawlessAt` de Cala: no hereda PvP, fuego amigo ni
full-loot por reutilizar un enemigo. Revisar límites de zona junto con arte y autoridades de combate/muerte.

Compra, transferencia mochila/bodega, venta y aporte conservan el mismo bien y cantidad, sea cual sea la ruta.
Solo cuenta la entrega física confirmada en destino. No duplicar stock/recompensas por llegar primero a pie
y después en barco, ni conceder premios infinitos por comprar/revender o reciclar el mismo aporte. Una mejora
del pueblo puede abrir servicio/encargo regional; no fuerza a usar un modo de transporte para aportar.
Acceder a una bodega requiere nave/punto de descarga físicamente accesible y permiso válido; no abrir el
almacén remoto de un barco abandonado en otro puerto. Cada aporte debita una fuente identificada una vez.

Compatibilidad: `TOWNS.sol` está hoy en otra isla y `LANES` define un trayecto marítimo anterior; solo
`aldea`/`cala` son caminables. El corte de Sol debe coordinar terreno, anclas, acceso al mercado, grafo de rutas,
tiempos y recuperación de poses/partidas. Editar el campo `island` no crea una conexión física. Preservar Cala
y revisar la representación del viaje legacy; no mover pueblos/guardados mientras arte trabaja las anclas.

## 3. Crecimiento comunitario y ritmos diferentes

La «edad» es una lectura del desarrollo alcanzado: asentamiento → puerto artesano → centro especializado.
Se deriva de obras y capacidades; el calendario por sí solo no desbloquea una era. Una fundición puede
avanzar mientras otra ciudad todavía trabaja en tejidos. Cada proyecto declara requisitos específicos.

Primer proyecto: **Carpintería de Salty Shore**.

1. El tablón de la plaza presenta función, materiales faltantes y recetas que habilita.
2. Se entregan cantidades elegidas desde mochila o bodega, estando físicamente en el punto de recepción.
3. El servidor acepta como máximo lo que aún falta; cobra solo esa cantidad y devuelve confirmación.
4. La obra muestra acopio/cimientos, andamios y edificio terminado según hitos confirmados.
5. El carpintero abre las enseñanzas y el servicio para visitantes del pueblo.

No fijar todavía una cifra definitiva de madera/piedra: medir recolección, porte, distancia y tiempo de
aporte primero. La primera obra debe mostrar una mejora durante una sesión inicial razonable. Las posteriores
requieren cooperación y comercio, con progreso parcial visible; una comunidad pequeña también debe avanzar.

Para el alfa, empezar con un proyecto principal por pueblo y metas por temporada/cohorte anunciadas y
estables. No aumentar el precio a mitad de la obra porque se conectó otro jugador. Medir aportes de 1, 4 y 8
participantes antes de cerrar umbrales. Ayuda NPC acotada es una opción futura, no una fuente ilimitada de bienes.

El beneficio compartido llega a quien visita el taller. Ayudar deja reconocimiento y puede abrir encargos
personales; recompensas monetarias, descuentos y exclusividad se diseñan por separado. No conceder XP o pago
infinito por retirar y volver a entregar lo mismo. La obra y su reputación reconocen aportes efectivos.

La plaza muestra lo que falta, último hito y próxima mejora. Los aportes pueden mostrarse con nombres públicos
de personaje; nunca identidad de cuenta o wallet. Las obras comunitarias tienen emplazamientos reservados y
no consumen automáticamente un solar privado. La cuenta de mercado y el almacén del proyecto son distintos.

## 4. Aprender una receta y poder fabricarla

Separar cuatro condiciones: desarrollo del pueblo, aprendizaje del personaje, estación requerida y materiales.
Una obra permite que un artesano enseñe. Un encargo corto o adquisición de plano concede el conocimiento;
haber donado no entrega automáticamente todas las recetas. Mantener las nueve piezas del editor actual,
el refuerzo y las reparaciones disponibles; aplicar la progresión a contenido nuevo.

El personaje conserva lo aprendido tras morir o cambiar de pueblo. Conocer una receta no concede materiales
ni acceso a un taller ajeno. Recetas portátiles se usan en un banco a bordo desbloqueado y construido;
recetas pesadas necesitan instalación terrestre. Así aprender y montar un taller móvil son mejoras distintas.
Transferir conocimiento/bienes entre mundos requiere política propia; no copiar economía automáticamente.

Menú propuesto:

- Receta conocida: función, materiales disponibles/faltantes, estación y resultado.
- Receta anunciada por un pueblo: silueta, edificio requerido, ubicación y cómo aprenderla.
- Producción bloqueada: motivo concreto y próximo paso, sin consumir insumos.
- Obra completada: aviso, cambio visible y artesano accesible; no obligar a consultar un wiki.

Maestría por oficio viene después de este recorrido. No introducir fallos aleatorios de fabricación ni un
grind de niveles para las piezas domésticas iniciales. Eficiencia/variantes posteriores necesitan balance.

## 5. Salty Shore: contrato funcional con el agente de arte

La referencia concentra una gran fachada/tela roja, plaza central abierta, madera cálida y toldos mostaza,
muelles en diagonales y agua turquesa que separa las masas. Aplicar esa jerarquía en cámara jugable y móvil;
la panorámica no determina por sí sola dimensiones ni cuántos NPC activos soporta el juego.

| Ancla | Función de juego | Condición espacial |
|---|---|---|
| Playa de llegada | Spawn, recoger los primeros recursos, orientación | Camino terrestre corto hacia plaza/banco; sin combate obligatorio al nacer |
| Capitanía reconocible | Orientación, mapa y encargos iniciales | Silueta visible desde playa y puerto; interacción accesible a nivel de suelo |
| Plaza/tablón | Encuentro y proyecto comunitario | Espacio abierto; todas las rutas principales convergen sin cuellos de botella |
| Mercado | Cotizaciones, compra/venta y demanda regional | Acceso a plaza y camino de carga; separar stock ordinario de acopio de obras |
| Carpintería/obra | Preparar madera y aprender piezas | Frente libre para interactuar; tres estados visuales con la misma ancla |
| Astillero/muelles | Construir, reparar, cargar y atracar | Maniobra y pasarelas legibles, amarres con reserva server-owned |
| Salidas terrestres | Bosque, piedra y exploración con riesgo anunciado | Rutas independientes de decoración y parcelas privadas |
| Barrio de viviendas | Casas/talleres del jugador | Parcelas reservadas; no obstruir plaza, spawn ni entradas del puerto |

Propuesta espacial: núcleo activo de 100–140 u de lado, aproximadamente 30–45 u de plaza abierta y corredores
principales de 5–6 u. Ajustar tras probar cámara, personajes y acarreo. Ocho amarres utilizables iniciales
en Salty Shore más espacios de servicio; los otros dos puertos deben aceptar a los ocho navegantes si coinciden.
Las ocho balsas principales son el presupuesto mundial combinado, navegando o atracadas: un amarre reservado
vacío no dibuja otra copia del barco cuando su dueño visita otro puerto. Los espacios adicionales de servicio
no habilitan flotas/NPC extra. Un amarre de visita no cambia propiedad ni concede otra balsa. Gran barco/casco
necesita canal y giro medidos; medir los ocho cascos juntos y distribuidos entre puertos.

Kit de la obra: acopio, cimientos, andamios, taller acabado, puesto de recepción e iconos de función.
Arte entrega pivote, huella/altura, colisiones simplificadas, puntos de interacción y variantes de calidad;
mecánicas entrega IDs, estados y reglas. No mover `spawn`, `village`, `dock`, suelos o pasarelas solo para una
captura: deben actualizarse navegación, recursos, guardados/poses y tests de ocupantes conjuntamente.

Reutilización revisada: `prop:storage-crate`, materiales de madera urbana, tablas, toldos y tejados existentes
son base reutilizable. [Auditoría Unreal](docs/research/unreal-assets/survival/FINDINGS.md) identifica
`SM_SmallWoodeHut` y `SM_RepairBench` como candidatos, no GLB listos ni sistemas de construcción portables.
La casa es prefabricada, no un kit modular; Blueprint no demuestra autoridad del juego web. La selección/export
de edificios corresponde al agente de arte, manteniendo `C:\Unreal` intacto y verificando estilo/coste móvil.

## 6. Mundos separados, geografía continua y cargas de sector

Arquitectura de producto confirmada: un **mundo/server persistente** contiene su población, geografía,
tres pueblos, mercados, obras y propiedad. Reiniciar el proceso, desconectarse o cargar otro mapa no lo
resetea. Otros worlds tienen sus propias partidas y economías; una cuenta puede identificarse en varios,
pero su personaje y patrimonio de gameplay quedan ligados al world seleccionado. Transferencias entre
worlds no forman parte del alfa y requieren una decisión independiente, no un import de partida libre.

Una **zona/sector** es parte geográfica del mismo mundo. Un **proceso de simulación** es infraestructura.
Para el alfa, proponer un proceso autoritativo por mundo y cargar sectores de escena según proximidad;
no exigir ya múltiples servidores para una sola geografía. Si después se distribuyen sectores entre
procesos, el cambio de zona necesita handoff: un único propietario del personaje/barco y del inventario,
destino preparado, origen cercado antes de activar destino y recibo/recuperación si se pierde la respuesta.
Tripulación, HP, carga y posición relativa pasan juntos, sin copiar la nave ni resetear enemigos por entrar.

Las cargas pueden mostrar una transición breve, pero origen/destino se conectan espacialmente. Entrar
en Salty Shore muestra el mismo pueblo que construyeron sus residentes; una visita no crea una instancia
de grupo. La escena lejana puede descargarse y NPC lejanos usar simulación simplificada, conservando estado
autoritativo. Regeneración de nodos/enemigos y producción usan reglas explícitas del mundo; cargar el mapa
no es su disparador. Recuperación tras caída/downtime y exposición offline conservan su política M5 pendiente.

Persistencia a implementar/verificar: personajes/recetas, casas/permisos, barcos/condición/carga/amarre,
mercados, proyectos/contribuciones, recursos con ciclo durable y reloj/estado compartido. Identidad de cuenta
no equivale a identidad de personaje por mundo; revisar claves de perfil, HMAC guest, imports y recibos
existentes antes de habilitar otro server. `WORLD_ID` en economía no demuestra por sí solo ese aislamiento.
En el código actual `ProfileSessions.open` y `store.loadProfile/saveProfile` usan solo el UUID de cuenta
(`server/profileSessions.mjs`, `server/store.mjs`); `worldId` va por separado a `WorldState`. Dos hosts con
el mismo store leerían el mismo perfil y sus escrituras competirían por CAS. El contrato nuevo debe resolver
personaje por cuenta + mundo + época y aislar también inventario, recetas, propiedad, imports y operaciones;
no basta con lanzar otro proceso con distinto `WORLD_ID`. Elegir migración/esquema o stores separados en
un corte M5 coordinado, sin cambiar las RPC/migraciones que otro agente trabaja durante esta planificación.

El wipe debe ser una acción administrativa explícita, con alcance anunciado. Diseñar una época de mundo
(`worldEpoch` o equivalente) para distinguir la nueva partida e invalidar cargas/recibos del estado anterior;
no aceptar que un antiguo blob guest restaure patrimonio después del wipe. Cuentas de acceso y datos ajenos
al gameplay se tratan por separado. Este documento no autoriza ejecutar un wipe ni define su periodicidad.

### Cupo simultáneo y población persistente: metas distintas

| Presupuesto propuesto | Primera meta | Expansión condicionada |
|---|---|---|
| Personajes conectados | 8 en total, humanos + agentes con cuerpo | 12 y luego 16 tras carga sostenida y revisión de densidad |
| Balsas en navegación | Las 8 pueden navegar a la vez, una principal por personaje | Flotas y más NPC navales después de medir |
| Mundo navegable | Envolvente inicial de 800–1.000 u por lado, tres núcleos | Más islas/sectores cuando navegación y carga lo justifiquen |
| Rutas directas | 90–180 s de navegación entre puertos como objetivo de diseño | Atajos/corrientes y rutas opcionales con riesgo, midiendo barco cargado |
| Parcela doméstica | Huella de 16×16 u, una inicial por personaje residente | Ampliaciones y propiedad conjunta posteriores |
| Densidad residencial | Ensayo inicial con 8 propietarios y sus viviendas; parcelas repartidas entre pueblos | Cupo total de residentes/parcelas por mundo por diseñar; no equivale a conexiones simultáneas |
| Nave/construcción para ensayo de rendimiento | Escenarios de 120 y 240 piezas por barco/casa | Elegir límite operativo tras medir; no confundirlo con las 600 tuplas técnicas actuales |

La envolvente no significa dibujar ni simular con el mismo detalle un millón de celdas. Salty Shore reutiliza
la isla existente, ampliada/adaptada con arte para conectar Puerto Sol por tierra; otra isla contiene Ceniza.
El mar costero ofrece una alternativa al camino. Usar sectores de terreno/colisión y niveles de detalle,
conservando geografía única. Una ruta más larga necesita acciones o puntos de interés; ajustar distancias a
velocidad normal con carga, nunca a un boost máximo permanente. La envolvente inicial no es el tamaño final
de un mundo con miles de residentes; expansión de regiones, parcelas y puertos necesita presupuesto propio.

Las ocho plazas son personajes activos, incluidos agentes controlados por LLM. NPC de taller con interacción
sencilla tienen presupuesto separado; habitantes decorativos no requieren ocho agentes LLM ni simulación
completa. La inferencia permanece fuera del tick, y cada agente mantiene identidad/permisos ordinarios.

El primer ensayo de ocho propietarios no limita el mundo a ocho residentes durante toda su vida. Separar
desde el diseño cupo conectado, personajes registrados, barcos persistidos y parcelas físicas disponibles.
Personajes humanos y de agente cuentan en la reserva persistente si tienen vivienda/balsa; un agente no
añade propiedad fuera del presupuesto. Antes de admitir más residentes, definir reservas, disponibilidad
de solares y presupuesto de construcciones guardadas/visibles, con LOD y sectores. No introducir desahucio
offline ni borrar casas automáticamente como solución de rendimiento. La propiedad de un desconectado
permanece hasta el wipe o las reglas de juego que el autor acuerde explícitamente.

Objetivo de espacio doméstico: parcela privada más una balsa personal; puerto/plaza/talleres son compartidos.
El distrito residencial conserva salidas y pasillos públicos. Costes, reclamación y permanencia de terreno
siguen por concretar; la parcela no es una compra/mint activada por este plan.

### Crecimiento hacia miles: población, concurrencia y concentración

| Escala distinta | Qué debe crecer | Qué no demuestra capacidad |
|---|---|---|
| Miles de personajes registrados | Almacenamiento por mundo/época, consultas, reservas de propiedad y espacio habitable | Miles de filas guardadas no son miles de cuerpos activos |
| Miles conectados repartidos por un mundo | Simulación por regiones, filtros de interés, transporte y servicios durables coordinados | Más procesos con copias independientes del mismo pueblo no forman un mundo continuo |
| Cientos/miles juntos en una plaza o batalla | Presupuesto de densidad local: combate, cuerpos, barcos, piezas, red y GPU | Sumar capacidad de regiones lejanas no resuelve la concentración en una sola |

Arquitectura objetivo propuesta, después del alfa pequeño:

1. **Entrada/directorio del mundo:** autenticar personaje en mundo/época, localizar su región, reservar
   capacidad y enrutar conexión/reconexión. Una sesión activa por personaje; identidad de región/autoridad
   recuperable tras caída. No sustituye la autoridad de gameplay ni admite imports de otro world.
2. **Procesos de región:** ciudad, camino/bosque y aguas pueden distribuirse en máquinas distintas cuando
   el perfil medido lo justifique. Cada región real tiene un único dueño de escritura; las réplicas de lectura
   no aceptan acciones. Añadir máquinas sirve para distribuir regiones, no para crear otra Salty Shore idéntica.
3. **Interés espacial de red:** enviar estado dinámico cercano y contexto de tripulación/grupo autorizado,
   además de resúmenes mundiales acotados. No transmitir al cliente todos los personajes, proyectiles,
   construcciones y nodos del archipiélago. Objetos estáticos cambian por revisión; contenido lejano usa LOD.
4. **Cruces de frontera:** transferir personaje, nave, tripulación, inventario, daño y acción pendiente con
   recibo y dueño único. Diseñar también visión/colisiones/proyectiles en el borde y estructuras que lo ocupan;
   no usar el cambio de proceso para escapar del combate, duplicar carga o activar una nave dos veces.
5. **Economía/obras persistentes del mundo:** cotizar y confirmar stock, saldo, aportes y propiedad mediante
   transacciones versionadas con recibos. Regiones comparten esos hechos, no stocks independientes ni una
   caché como permiso para gastar. Evitar que una única cola mundial serialice cada paso de movimiento.

La creación/reasignación de procesos no mueve una región activa sin cercar al dueño anterior y restaurar
su estado. Desconectados y regiones inactivas conservan bienes/propiedad y ciclos según política explícita;
no necesitan simulación física completa a 60 Hz ni consultas LLM continuas. Agentes con cuerpo cuentan en
concurrencia/densidad ordinarias; la mente permanece fuera del tick y su gasto tiene presupuesto propio.

Ante llegada repentina: cola visible y reservas con caducidad para el mundo/región que exceda el cupo
**medido**, margen de máquinas listas y monitorización de atraso/red/memoria. Si destino está lleno, conservar
al viajero y su carga bajo autoridad de origen y comunicar la espera; no perderlo en tránsito ni convertir
la espera en invulnerabilidad. Nunca ocultar jugadores cercanos, copiar el pueblo por grupo o expulsar/borrar
propiedad para fingir capacidad. Otros servers independientes son opción para nuevos personajes, no migración
automática de quienes ya pertenecen a un mundo. Coste por conectado y capacidad local condicionan admisión.
Caducar una reserva libera solo el cupo; no borra, mueve ni desconecta del dueño autoritativo al personaje,
barco o carga. Cola/retry no ejecutan compras/aportes. Tras desconexión o caída, resolver autoridad y recibo
del mismo intento antes de reanudar; una reconexión no crea otra llegada ni duplica una entrega pendiente.

Secuencia propuesta: 8 → 12 → 16 en host único tras evidencia; luego prototipo con dos regiones, filtro de
interés y handoff recuperable; después ensayos de concurrencia creciente y concentración máxima. Llegar a
miles conectados en un mismo world es una fase MMO posterior, no un cambio de `MAX_PLAYERS`. Conservar desde
ahora identidad por mundo, IDs estables y comandos/recibos facilita ese camino sin implementar un clúster
completo antes de que recoger, construir y comerciar sean un recorrido jugable.

Referencias de arquitectura, no elección de proveedor/runtime: la documentación de
[Replication Graph de Epic](https://dev.epicgames.com/documentation/en-us/unreal-engine/replication-graph-in-unreal-engine)
describe listas de actualización por región, objetos dormidos y relevancia por conexión. Aplicar esos
principios requiere implementación propia en el protocolo actual; no implica migrar a Unreal.
[Agones Fleet Autoscaler](https://agones.dev/site/docs/reference/fleetautoscaler/) escala procesos disponibles
según demanda/capacidad declarada. De ello no se deduce capacidad del juego, partición espacial ni coherencia
del mundo: son contratos de nuestra simulación. Ninguno de esos sistemas se instala/activa en este corte.

## 7. Capacidad actual y cómo aceptar el objetivo

Inspección del checkout del 2026-10-08:

- Host por defecto: cuatro personajes de conexión (`server/host.mjs`, `server/index.mjs`); los agentes que
  usan HELLO normal ocupan esa misma plaza. Los bots NPC del servidor están aparte.
- Pilotaje físico: cuatro registros activos, también al reembarcar (`src/sim/naval/pilot.js`). Cambiar solo
  `MAX_PLAYERS` no permite ocho dueños navegando. `NAVAL_TRIAL.maxBodies=32` no acredita capacidad de alfa.
- Una isla de 400×400 u (`src/data/tuning.js`), simulación de 60 Hz y snapshots de 20 Hz.
- Snapshot público global para cada cliente (`src/net/localServer.js`); no hay filtro de interés de red
  por pueblo/distancia. Culling visual existente no reduce por sí solo bytes o simulación del servidor.
- Solo la balsa principal en `aldea` se monta en mundo (`src/sim/systems/rafts.js`). Escanear 64 posiciones
  candidatas de amarre no demuestra 64 atraques seguros ni reserva durable multipuerto.
- El plano admite hasta 600 piezas, 12×12 cimientos y tres niveles. Son límites de saneado/geometría, no
  presupuestos de FPS. No truncar una nave guardada al bajar un límite operativo propuesto.
- Tres pueblos caminables/desarrollables, vivienda modular terrestre, progreso personal de recetas,
  transacciones de aportes y gestión de mundos requieren implementación; datos de mercados/solares existen.

Meta de aceptación propuesta: PC 60 FPS y móvil de referencia 30 FPS sostenidos en calidad apropiada,
simulación p95 <8 ms y p99 <12 ms por tick a 60 Hz, con margen para snapshot/I/O/GC. Medir duración total
de pump y atraso, no solo World.step. Estas cifras son objetivos del proyecto; ninguna está demostrada
para el mundo nuevo. Medir percentiles de frame y eventos largos, no solo FPS medio de una captura.

Ensayos de 8, 12 y 16 clientes reales de protocolo, primero headless y después escena representativa;
añadir clientes lentos/reconexiones y margen sobre el cupo candidato. Duración inicial de 30 minutos y
soak de dos horas antes de publicación de cada cupo. Un fixture headless no prueba GPU ni teléfono real.

Escenarios obligatorios: todos en plaza; ocho barcos/ocupantes en el mismo puerto; dispersos entre pueblos;
construcción mientras navegan otros; combate con proyectiles/VFX; entregar último material simultáneamente;
guardar, reiniciar y reentrar con obra/carga/propiedad conservadas. Reportar hardware, build, escenas, perfiles
de calidad, latencia/jitter, memoria, piezas, entidades activas, bytes por cliente/segundo y total saliente.

Para el corredor terrestre, aceptar mercado accesible a pie, ida/vuelta por ambas rutas, recurso recolectado
una vez, encuentro con retirada posible y entrega conservada desde mochila/bodega. Medir margen por viaje
y por minuto, porte, tiempo y reparación bajo cotizaciones reales; registrar dónde cada modo resulta útil.
Para distribución futura, añadir cruce concurrente de frontera, caída en cada etapa del handoff, reconexión,
proyectil/ocupante a ambos lados y doble entrega del último material desde procesos distintos. Cupo mundial
y densidad máxima local requieren resultados separados; carga sintética sin GPU no acepta un puerto lleno.

Usar filtrado de interés para posiciones/combate/recursos cercanos, manteniendo los datos privados de cada
dueño y resúmenes mundiales de mercados/obras. La pertenencia a tripulación requiere contexto de la balsa
aunque el jugador se aleje de su antiguo puerto. Reducir dibujo mediante lotes/LOD, medir sombras/tinta/agua
y evitar cargar todas las variantes de texturas en móvil. No cambiar tasas de combate silenciosamente.

Instrumentación: el host tiene contadores de bytes y tiempo medio; faltan percentiles/carga representativa.
`monitorEventLoopDelay` y utilización permiten observar demora del bucle según la
[documentación oficial de Node](https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions).
Medir pases completos con los contadores de [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html);
reinicio por frame apropiado al postproceso. La agrupación de geometrías repetidas mediante
[InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) reduce draw calls; no acredita por sí sola FPS.
El runtime sigue en Three r160: revisar APIs disponibles localmente, sin migrar versión como parte de este plan.

## 8. Entregas para construir el juego

| Corte propuesto | Resultado jugable y verificable |
|---|---|
| A0 — contrato Salty Shore | Anclas/huellas/colisiones, rutas, amarres y espacios de obra coordinados con arte; conservar el loop actual |
| A1 — carpintería y aprendizaje | Proyecto compartido, entrega conservada/única, tres estados visuales, artesano y primeras recetas personales guardadas |
| A2 — cadena completa | Recursos → refinado → puerta/bodega/vela adicional → construcción y navegación reales; reparación y reentrada |
| A3 — Puerto Sol y corredor | Segundo pueblo en la misma isla: mercado accesible a pie y por costa, bosque/recursos/bandidos PvE, cadena fibra/lona y contrato regional |
| A4 — Bahía Ceniza | Tercer pueblo caminable, metalurgia y abastecimiento; ruta completa sin dependencias circulares |
| A5 — vivienda inicial | Parcelas reservadas, propietario/permisos, piezas/transitabilidad/almacenamiento; no limitarse a un modelo de casa |
| A6 — encuentro naval | Armamento del jugador y rival móvil/derrotable sobre el daño por pieza; salida/recuperación y economía conservadas |
| A7 — ocho conectados | Reservas multipuerto, ocho pilotajes, aislamiento por mundo y límites medidos; población persistente y cupo simultáneo separados |
| A8 — base para regiones | Después del loop y capacidad inicial: filtro de interés, dos regiones reales y handoff recuperable; sin anunciar todavía miles de conectados |

A0 y arte avanzan en paralelo con autoridad durable M5. A1 debe tener commit atómico entre inventario del
personaje, almacén/progreso de obra y recibo; replay y respuesta perdida no pueden pagar/aportar dos veces.
Perfil de navegador firmado y autosave periódico no bastan para dos autoridades que mutan recursos distintos.
Probar primero integración local; desplegar economía persistente cuando sus contratos M5 estén completos.

Para aprendizaje: evento de servidor, defaults/saneado/migración, versión de snapshot y guardado de receta.
Para mundo: ID de proyecto, revisión, materiales aceptados, contribuciones acotadas, estado y unlocks derivados.
No aceptar un `townLevel`/receta aprendido enviado por el cliente. Carga en tránsito no cuenta como entrega.

Estos cortes concretan M6/M7/M8 y el objetivo nuevo del autor; A8 inicia la fase de crecimiento posterior
al alfa pequeño. No dan por terminado D09/M5 ni modifican las
migraciones 001–012 que otro agente trabaja. No se ha cambiado cupo, datos de pueblos, nombre runtime,
guardados, permisos, `.env`, SQL ni arte en esta entrega documental.

Primera implementación recomendada: A0 + A1 en Salty Shore y un premio de contenido pequeño. Antes de añadir
dos pueblos, demostrar que aportar, terminar obra, aprender, construir, salir y reentrar es un mismo recorrido.

### 8.1 Continuación concreta — banco de materiales y contrato de aportes

2026-10-09: **A1b1 implementado y probado localmente**, [backend PostgreSQL opcional](docs/delivery/a1b1-community-postgres.md), 31/31 pertinentes. Transacción de mochila/proyecto/recibo, rollback inyectado, respuesta perdida y recuperación desde otro proceso; scope por mundo/época y convivencia con SQL001–013. No se aplica SQL live ni se monta en partida: sus tablas todavía no son la autoridad del perfil M5. Sigue A1b2, identidad y guardado de sesión coordinados, antes del tablero/artesano/aprendizaje. Se conserva alpha.16/protocolo 32 y costes actuales.

2026-10-08: **A1a implementado y probado localmente**, [contrato y store de memoria](docs/delivery/a1a-community-contribution.md), 17/17 pruebas. Débito de mochila, crédito limitado al remanente y recibo exacto; rechazos terminales, CAS y claves por mundo/época. Es un ensayo aislado, no durable ni montado en partida: no completa A1. Sigue A1b, transacción durable y recuperación coordinadas con M5, antes del tablero/artesano/aprendizaje. No cambia costes finales, versión/protocolo, terreno, SQL, configuración ni permisos.

2026-10-08, petición aprobada y entregada localmente: **D08c.7d, alpha.16/protocolo 32**.
[Entrega](docs/delivery/d08c7d-tools.md): hacha/pico de piedra desde insumos recogibles a mano,
banco de tres recetas, selección contextual y dos ranuras fijas guardadas. 24 rocas/6 vetas nuevas,
minería compartida y mineral bruto separado de hierro; 206 nodos conservan los 176 previos/S21.
121 casos pertinentes únicos verificados, 3/3 vistas emuladas y reentrada firmada, capturas inspeccionadas.
Se entrega base clásica por golpes; mantener/bonus opcional de timing siguen como siguiente corte.
Bahía Ceniza mantiene su especialidad; fundición, tiers, aprendizaje y aportes comunitarios pendientes.
Sin SQL/publicación ni persistencia durable de nodos; prioridad de bootstrap cumplida.

2026-10-08: el autor priorizó palmeras cortables y muchas piedras antes del aporte comunitario.
[D08c.7c](docs/delivery/d08c7c-harvest.md), alpha.14/protocolo 30, integra 96 palmeras y 69
piedras recogibles en la isla existente: tres golpes → dos troncos → banco → madera de balsa.
Reutiliza arte actual sin mover pueblo/terreno. **87/87 seleccionadas en serial + 3/3 vistas**,
capturas inspeccionadas. Materiales conservados con el guardado actual; agotamiento/golpes y
regeneración aún son de sesión, no acredita persistencia del mundo ni cierra antifarming.
Terminado este corte local, sigue el contrato atómico descrito abajo.

2026-10-08: [D08c.7b](docs/delivery/d08c7b-workbench.md) integra el panel del banco y preparación por
tandas en el juego ordinario, alpha.13/protocolo 29. Madera preparada paga construcción/reparación
existentes; no es aún una obra compartida ni desbloqueo personal. Reutiliza el banco runtime S19/S14
sin cambiar la reconstrucción de Salty Shore que hace arte.

La inspección confirmó que inventario de personaje y autosave de mundo usan commits independientes.
Antes de A1, concretar operación de aporte con identidad de mundo/personaje/proyecto, cantidades y
revisiones esperadas; store aplica débito de inventario, crédito de proyecto y recibo en una sola
transacción. Mismo ID/request devuelve el mismo resultado; otro request con ese ID se rechaza.
Recuperación después de respuesta perdida/reinicio lee el recibo y la revisión confirmada antes de
publicar el cambio en ECS/UI. No sumar puntos de obra desde el cliente ni inferir entrega por carga en ruta.

Orden inmediato: contrato/store/recuperación de aportes → montaje autoritativo de proyecto y tablero
con anclas de arte → artesano y aprendizaje personal con defaults/saneado/guardado → primera pieza
aprendida usada en la balsa. Conservar rutas de recursos y editor mientras se hace la transición.
