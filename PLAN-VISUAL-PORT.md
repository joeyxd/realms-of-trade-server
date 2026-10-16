# Ruta visual — de la isla actual al puerto tropical ilustrado

Fecha: 2026-10-06. Base inspeccionada: `fa226d2`, con trabajo naval ajeno en el checkout.
Estado: **plan general propuesto y diagnóstico**; arena S01 y huellas dinámicas aplicadas en el mapa local,
[rocas S02](docs/delivery/coast-rocks-v1.md), [suelos/transiciones S03](docs/delivery/ground-family-v1.md)
y [conchas/cantos S04](docs/delivery/beach-details-v1.md)
integrados con revisión artística del autor pendiente.
[Familia S05 de palmeras](docs/delivery/palm-family-v1.md) integrada localmente; ocho casos visuales
(tres modos y cinco fallos) sin errores JS/shader; snapshots de seis fuentes verificados con --check.
Catálogo revisión 10: 80 filas, 24 aplicadas y 52 enlaces de palma exactos por bytes; S01–S04 también pasan
y la repetición idempotente conserva revisión 10. Revisión artística fina, FPS físicos y publicación pendientes.
[S06 raíces y plantas bajas](docs/delivery/palm-bases-v1.md) integradas localmente. **62/62** pruebas sin
omisiones; ocho QA (PC/móvil/low y cinco fallos), sin errores JS de juego ni GL, programas enlazados.
Catálogo revisión 11: 82 filas/26 aplicadas, 47 enlaces HTTP únicos exactos. Galería temporal 1× y contacto
real con dither S05 documentados. Revisión artística fina, FPS físicos y publicación pendientes.
Puerto completo y publicación pendientes. [Ruta y recursos S01](docs/briefs/visual-s01-sand-family.md).
Referencia: imagen del puerto aportada por el autor y su lista de terreno, construcción, props y materiales.

Actualización 2026-10-08: la dirección de alfa identifica el primer pueblo como **Salty Shore**;
[A0/A1](PLAN-ALFA-MUNDO.md) coordina sus anclas funcionales y obras. El
[índice de arte](docs/art/README.md) conserva las entregas locales S07–S21. El [revamp de terreno S21](docs/delivery/map-revamp-v1.md), autorizado por el autor como pase solo de terreno, amplía la isla de 400/N401 a 560/N561 (resolución 1), con +63,148347 % de suelo seco muestreado (paso 2, umbral >0,65). Dos conexiones suaves de terreno permiten alcanzar caminando el interior (171 y 109 aristas; ascenso máximo 0,1412 y 0,1377 por paso, límite 0,15); núcleos húmedos conservados, sin puentes ni assets. Salty Shore tiene tres niveles, rampas y seis pads de huts existentes. Preserva orden/identidad/XZ de props y recursos, con Y proyectada; volcán/boss, PvP, llegada y muelle protegidos. Sin pueblo, gameplay, colisiones, recursos o assets nuevos. 0.1.0-alpha.15/protocolo 31 requiere recarga de host/peers; 220 pruebas, 30 capturas de escena + 2 del panel M, cinco contextos emulados y 20 chequeos de datos de calidad. Catálogo rev. 37 (110 filas, 54 aplicadas); fuentes y enlaces HTTP comprobados. La fachada [S20](docs/delivery/town-hall-v1.md) permanece sobre la hut. El corredor A3 entre Salty Shore y Puerto Sol no está implementado ni se mueven los anclajes de Puerto Sol/Ceniza. Local, no publicado; FPS físico y multijugador humano pendientes.

**Precisión del autor, 2026-10-06:** estética ilustrada moderna con lectura tipo sprite y carácter cercano
a Borderlands: formas expresivas, superficies pintadas y tinta marcada. Las nuevas láminas de arena y
palmera fijan ese lenguaje. Trabajamos por piezas en el [catálogo HTML](tools/art-catalog/index.html),
con referencias, archivos y evidencia de aplicación; [lanzador/uso](tools/art-catalog/README.md).
La lectura tipo sprite orienta el arte; este catálogo acompaña el renderer 3D actual.

## 1. Resultado que buscamos

Una Aldea Coralina reconocible como puerto tropical habitado: costa irregular, roca angular, terrazas,
arquitectura de madera remendada, telas apagadas, palmeras, carga, muelles ramificados y embarcaciones.
Todo comparte luz cálida, sombras frías y un acabado de cómic pintado que se lee desde la cámara de juego.

La imagen sirve para fijar **lenguaje visual y jerarquía**, no dimensiones, número de habitantes,
reglas de navegación o una implementación de shaders. Una imagen no permite deducir su motor ni confirmar
si el acabado procede de geometría, pintura, iluminación o postproceso. Las técnicas de este plan son
propuestas para nuestro runtime Three.js; no afirmaciones sobre cómo se produjo la referencia.

El objetivo completo exige arte, composición y adaptación técnica. Primero debe funcionar un rincón pequeño;
después se extiende el kit. No comprometemos plazos ni una reproducción píxel por píxel antes de ese ensayo.

### Alcance y continuidad

- Este plan acompaña [PLAN-DELIVERY](PLAN-DELIVERY.md), especialmente A05, D04–D06 y D14/M8.
  V00–V08 identifican cortes visuales; no reemplazan entregas D ni convierten sus gates en aceptados.
- La planificación visual y los ensayos aislados pueden avanzar mientras continúan M5/D09 y D08.
  Cambiar alturas transitables, edificios con colisión o embarcaciones funcionales exige el corte de gameplay
  correspondiente. La migración 007 y la afinidad de perlas conservan su ruta independiente.
- La dirección deseada viene del autor. Cantidades de assets, técnicas, presupuestos y fases de abajo son
  recomendaciones revisables; no decisiones económicas, de combate o navegación cerradas.
- Conservar los cambios ajenos en `src/data/navalHandling.js`, `src/sim/naval/handling.js`,
  `tools/naval-lab/{index.html,input.js,style.css}` y los nuevos archivos `navalNavigation.js`/`navigation.js`.

## 2. Lectura detallada de la referencia

### 2.1 Composición: por qué se siente como un lugar

| Región de la imagen | Observación visible | Qué debemos producir |
|---|---|---|
| Centro alto, ligeramente a la izquierda | Edificio principal alto, torre, gran lona y bandera; concentra silueta y atención | Un edificio protagonista del puerto, con dos o tres alturas visuales, balcones y señal propia de Aldea Coralina |
| Centro | Plaza abierta con un elemento vertical y caminos que conectan escaleras, tiendas y muelles | Espacio de respiro y encuentro; rutas claras antes de decorar |
| Lado izquierdo y fondo cercano | Playa y edificios ascienden por terrazas rocosas | Costa diseñada, taludes y plataformas; varias cotas legibles, no casas dispersas sobre una superficie uniforme |
| Centro bajo y derecha | Muelles se bifurcan, se cruzan y forman pequeñas ensenadas | Un conjunto de plataformas con postes, soportes y accesos; uniones que expliquen cómo se sostiene |
| Primer plano | Agua somera, rocas que sobresalen, cubierta cercana y vegetación cortada por el encuadre | Detalle de primer plano que enmarca sin bloquear al jugador |
| Fondo derecho | Arco de roca, islotes y ruinas separados por agua | Un hito de silueta propio y geografía distante simplificada; no hace falta reproducir las ruinas para el primer puerto |
| Agua entre estructuras | Superficies azules relativamente abiertas rodean zonas densas de madera y roca | Mantener espacios vacíos para separar masas; no rellenar cada metro con props |
| Pequeños habitantes | Grupos alrededor de actividad, escaleras y puestos | Escala humana y focos de actividad; una escena llena de NPC reales no es requisito de la primera prueba |

Las diagonales de muelles y escaleras conducen al centro. El edificio alto ancla el pueblo y el arco equilibra
su silueta desde lejos. Los detalles están agrupados alrededor de actividad: carga en atraques, mercancía en
puestos, cuerdas en estructuras, vegetación sobre bordes. Esa distribución aporta más que colocar props al azar.

La panorámica reúne mucho contenido en un solo encuadre. Necesitamos **tres vistas**: panorámica de dirección
artística, cámara normal de juego y cámara móvil. Aprobar solo la panorámica puede esconder problemas de
oclusión, escala, colisión y lectura del combate. La cámara actual es perspectiva de aspecto isométrico;
no hay motivo para sustituirla por ortográfica sin comparar ambas en el laboratorio.

### 2.2 Formas, escala y construcción

- Rocas con caras amplias, fracturas escogidas, bordes rotos y estratos verticales. La variación importante
  está en la silueta y en los cambios de plano; un normal map no crea un arco ni un saliente.
- Arquitectura de postes, vigas y tablones visibles. Cubiertas desniveladas, toldos con caída, balcones,
  escaleras y amarres evitan que cada edificio parezca una caja de paredes lisas.
- Madera irregular con lógica constructiva: tablas ligeramente diferentes y reparaciones localizadas.
  El desorden decorativo se mantiene compatible con pivotes, cuadrícula y uniones exactas.
- Palmeras de alturas y curvaturas distintas, con copas que forman abanicos claros y proyectan sombra.
  Variar escala sin cambiar silueta sería insuficiente.
- Cascos, mástiles y velas se distinguen desde lejos. Aparejos finos sirven cerca del barco protagonista;
  no todas las embarcaciones necesitan el mismo detalle.
- Los letreros y telas grandes aportan identidad. Marcas pequeñas, conchas y clavos son secundarios desde
  la cámara normal: exagerar selectivamente su tamaño o agruparlos si queremos que se lean.

### 2.3 Color y superficie

La lectura dominante combina arena marfil/ocre, madera marrón cálida, piedra gris cálida y agua cian/turquesa.
Rojo apagado, mostaza y verde azulado aparecen como acentos en toldos, banderas y pintura. Las hojas tienen
centros oscuros y planos amarillo-verdes bajo el sol. Los fondos pierden contraste y se enfrían.

Como paleta de trabajo inicial —estimada a simple vista, no muestreada de la imagen— proponemos:

| Familia | Base orientativa | Regla |
|---|---|---|
| Arena | `#E6C98C`, claros `#F3DDB0` | Evitar amarillo uniforme y grano fotográfico visible desde lejos |
| Madera | `#9A673F`, claros `#C4945A`, oscuros `#533D2C` | Unificar valor; pintura por máscaras y piezas, no color aleatorio por tabla |
| Roca | `#8F8A79`, claros `#BCB49B`, grietas `#494852` | Planos claros amplios y unas pocas grietas que describan volumen |
| Mar | somero `#55C5B8`, costa `#20AAB5`, profundo `#267EAB` | Color de fondo + profundidad + superficie; no un albedo azul uniforme |
| Follaje | `#45633A`, claros `#91A74A` | Copas legibles sin una saturación verde idéntica en toda la isla |
| Acentos | rojo `#A24E38`, mostaza `#CCA653`, lona `#DFCAA0` | Concentrarlos en puestos e hitos, dejando respiro entre ellos |

La textura tiene marcas grandes y controladas: vetas, desconchados, costuras y grietas. El microdetalle debe
desvanecerse con distancia. Los colores planos por sí solos no darán el aspecto, pero el ruido fino tampoco.
Probar también manchas de pincel y bordes de color irregulares en roca, madera y frondas, legibles desde
la cámara normal. Ese carácter pintado requiere autoría de superficie; toon y normales suaves no lo garantizan.

### 2.4 Luz, tinta y profundidad

El sol dibuja caras cálidas y sombras firmes. Los contactos bajo plataformas, aleros, carga y roca anclan
las piezas al suelo. La tinta más oscura aparece en uniones, siluetas y algunos detalles interiores;
aplicarla con igual grosor a cada hoja, tabla y guijarro saturaría la imagen.

Necesitamos distinguir sombra solar, oclusión local y líneas de tinta. El contorno actual no sustituye una
sombra de contacto. Primero probar sombras existentes y oclusión pintada moderada; SSAO solo si una
comparación muestra que resuelve un hueco y su coste cabe en el tier elegido.

La bruma azul distante, el cielo y el contraste reducido del fondo ayudan a separar planos. Evitar niebla
que borre todo el puerto, bloom de mediodía o profundidad de campo que oculte superficies jugables.

### 2.5 Agua: lo que hay que igualar

En la referencia se ven fondos claros, piedras sumergidas, cambios de profundidad, pequeños reflejos y
espuma en contactos. La costa tiene franjas húmedas e irregularidades; el turquesa forma parte del paisaje.
El reto incluye **fondos, geometría litoral y distribución de espuma**, además del shader.

La toma estática no demuestra velocidad de olas, ciclo de mareas ni simulación naval. No añadiremos esos
sistemas para conseguir la imagen. La animación inicial debe ser contenida y no competir con barcos/personajes.

## 3. Punto de partida verificado en el repo

Diagnóstico por lectura del código, inventario existente e inspección de capturas guardadas de la balsa
(`shots/review/raft-comic/release-high-day/{overview,hero}.png`). Estas capturas ilustran la base integrada;
**no son una captura nueva del HEAD ni una medición de GPU/teléfono**.

| Sistema | Ya existe | Brecha que debemos abordar |
|---|---|---|
| Cámara | Perspectiva, seguimiento, zoom y rotación en `src/render/camera.js` | Encuadres de comparación reproducibles y puerto legible al caminar |
| Toon y tinta | Bandas, detalle pintado, contornos por profundidad/normales, trama | Calibrar líneas y detalle por categoría; no convertir cada faceta en una grieta negra |
| Luz y grading | Presets cálidos/fríos, sombras solares, luces locales, bloom | Ajuste conjunto con materiales y contacto bajo estructuras; revisar frustum de sombras en panorámica |
| Agua | Absorción por profundidad, refracción de pantalla en media/alta, cáusticas, Fresnel, espuma, ondas | Mejor fondo/costa; reducir formas repetidas y ruido blanco si dominan; validar muelles/cascos y low |
| Terreno | Heightfield compartido, máscaras y materiales procedurales de arena/roca/camino | Costa diseñada, terrazas, roca de silueta propia; el heightfield no puede representar voladizos/arcos |
| Vegetación | Palmeras, arbustos, rocas y algas procedurales; instancing y viento | Copas/curvas variadas, agrupación intencional, materiales y siluetas más ricos |
| Props | Choza, mercado, muelle, barril, letreros y otros tipos procedurales | Kit portuario común, mejores uniones y pequeños conjuntos de actividad |
| Construcción | Cuadrícula de balsa y piezas en `src/data/raftparts.js` | Un vocabulario visual compartido para tierra/barco; escalones/terrazas jugables no están resueltos por arte |
| Modelos/texturas | GLB, manifiesto, fallback, atlas de balsa y crate Dreamrise | Validar escala/pivote/UV y consumidor por cada nueva familia |
| Calidad | Low/medium/high/ultra y AUTO; variantes de textura por dispositivo | Garantizar que el estilo sobreviva a low y que la bajada automática no destruya lectura |

Las capturas muestran una diferencia concreta: el atlas nuevo de la balsa ofrece mucha veta, desgaste y
color, mientras el muelle próximo sigue una madera procedural más uniforme. El agua ya tiene profundidad y
espuma, pero sus redes blancas y algunas formas grandes llaman más la atención que en la referencia.
Antes de multiplicar assets conviene unificar contraste, escala de detalle y paleta de esos sistemas.

### Limitación de los materiales actuales

`src/render/assets/toonmat.js` convierte materiales glTF a toon conservando color/albedo, emisión, recorte
alfa y normal opcional. **No conserva roughness, metallic ni AO**. `toon.normal` es opt-in. El atlas de la
balsa es albedo, no una colección de mapas PBR. El agua usa su shader propio.

Por tanto, tener un set PBR exportado no prueba que sus mapas se vean en el juego. Proponemos partir del
toon actual y añadir solo respuestas que mejoren una comparación concreta: brillo de metal, humedad y
contacto. Mantener los mapas de autoría permite ampliar después sin rehacer la fuente.

La base Three.js usada sigue siendo r160; validar cambios contra esa versión. Su
[MeshToonMaterial r160](https://github.com/mrdoob/three.js/blob/r160/src/materials/MeshToonMaterial.js)
admite mapas de color, normales y oclusión, pero no el modelo metallic/roughness de MeshStandardMaterial.
La falta de conservación de mapas en nuestro adaptador es una limitación adicional del proyecto.

## 4. Validación y mejoras de tu lista

La lista acierta al empezar por costa/agua/roca/palmas, compartir materiales, construir edificios con piezas
y decorar por grupos. También distingue correctamente geometría, normal y alfa. La ampliaría así:

| Propuesta de tu lista | Validación / cambio recomendado |
|---|---|
| Terreno editable y terrazas | Añadir máscaras de costa, senderos, zonas de actividad y transición material; distinguir suelo jugable de roca decorativa |
| Tres piezas de acantilado | Buen arranque; hacen falta remate superior, pie/transición con arena y roturas de silueta para ocultar uniones |
| Arco armado con bloques | Adecuado para composición; malla propia solo si la silueta y las uniones lo justifican. Nunca intentar resolver el hueco con heightmap |
| Palmera alta/inclinada/corta | Añadir dos siluetas de copa y colores coherentes; variar únicamente altura dará clones evidentes |
| Módulos 2 × 2 m; paredes 3 m | Ya existe `RAFT.cell = 2` y altura por nivel `2.6 u`. Usar esas medidas para piezas compartidas; un edificio especial puede tener otra altura visual |
| Muelles por pisos/postes/barandales | Añadir vigas inferiores, remates, esquinas, amarre y variantes dañadas; soportes y poste no deberían terminar flotando |
| Taberna/puestos/casas como conjuntos | Validado; primero un puesto y una casa, después el edificio protagonista. No producir siete edificios finales a la vez |
| Madera y variantes pintadas | Añadir trim sheet: bandas UV de borde, viga, tablón y herraje reutilizables. Pintura/humedad por máscaras explícitas |
| Arena seca y húmeda | Mantener una base común con mezcla controlada; añadir fondo marino y contacto de roca, sin pedir una textura distinta para cada playa |
| Piedra compartida | Separar roca natural de piedra tallada en máscara/detalle; no aplicar un patrón de ladrillo a todos los riscos |
| Alfa para hojas/redes/telas | Correcto. Usar recorte donde basta; ondas, humo y fuego requieren VFX propios. Comparar red recortada contra pocos segmentos cerca de cámara |
| Props de ambiente | Añadir juntas oscuras, soportes, tejas/remiendos, cuerdas con anclajes y suciedad localizada; priorizar piezas que explican uso |
| Habitantes y barcos | Separar silueta decorativa de entidad funcional. Rig/animación/colisión/cubierta/transporte se aceptan en sus entregas correspondientes |
| HUD al final | Mantener durante pruebas el HUD actual; comparar también sin interfaz. Ajustar escala/contraste del HUD nuevo cuando el entorno funcione |

Faltaban además: pivotes y sockets, densidad de texel consistente, LODs, culling, transparencia/oclusión
del jugador, suelo de contacto, biblioteca de composiciones, variantes móvil y un modo de revisión de materiales.

## 5. Biblioteca de materiales y mapas

### 5.1 Familias de autoría

P0 = primer rincón; P1 = ampliar puerto; P2 = acabado/vida. Las variantes son parámetros o regiones de atlas
cuando sea posible, no un shader y un archivo independientes por cada color.

| Familia | Variantes/uso | Fuente y decisión inicial | Mapas que tienen sentido |
|---|---|---|---|
| M01 Madera costera, P0 | Clara, oscura, salitre, tabla reparada | Extender/calibrar atlas de balsa; comparar en muelle y pared antes de otra textura | Albedo + máscara de variación/pintura; normal suave opcional |
| M02 Madera pintada, P1 | Turquesa apagado, rojo, mostaza, blanco | M01 + máscara de pintura y desgaste; no duplicar vetas | Albedo/máscaras; roughness de autoría si luego hay consumidor |
| M03 Roca natural, P0 | Cara cálida, sombra fría, fractura, pie húmedo | Nueva autoría controlada; revisar candidato `SM_Rock` antes de modelar definitivo | Albedo + máscara de grieta/humedad; normal selectivo |
| M04 Arena y fondo somero, P0 | Seca, húmeda, camino pisado, bajo el agua | Ampliar base procedural y evaluar una textura tileable de grandes manchas | Albedo o color procedural + máscara de mezcla; micro-normal opcional |
| M05 Lona, P0 | Cruda, remendada, roja, mostaza, turquesa | Reusar región cloth del atlas como prueba; nuevas costuras si su lectura lo pide | Albedo, máscara de tinte; alfa solo para roturas; normal suave opcional |
| M06 Hierro y óxido, P1 | Herraje oscuro, metal expuesto, parche oxidado | Reusar iron del atlas; implementar respuesta especular estilizada solo si aporta | Albedo; máscaras; roughness/metallic de autoría, aún sin consumo toon |
| M07 Cuerda/red, P0/P1 | Fibra tostada, amarre, red | Reusar rope; geometría de curvas de baja sección y LOD, no fibras individuales | Albedo; alfa en red simplificada; normal opcional |
| M08 Corteza, P0 | Bandas grandes cálidas, base oscura | Palma procedural como base; UV y detalle específico | Albedo/vertex color; máscara de bandas; normal opcional |
| M09 Hoja tropical, P0 | Palma, hoja ancha, arbusto | Silueta propia; comparar fronda de geometría con card recortada | Albedo + alfa si card; máscara de viento; color por instancia |
| M10 Piedra tallada, P1 | Base de monumento, escalón/plaza | Derivar paleta de M03; juntas diferentes | Albedo + máscara de juntas/contacto |
| M11 Mar y espuma, P0 | Somero/profundo, contacto, reflejo | Ampliar shader de agua y sus inputs actuales; no comprar un pack de mar | Depth/height + normales/ruido + máscara de espuma; no albedo azul gigante |
| M12 Suciedad, musgo, sal, P1 | Bases de postes, grietas, esquinas, playa | Decals/vertex masks compartidos y puntuales | Albedo + alfa o máscara; bajo contraste y distancia limitada |
| M13 Emisión/VFX, P1 | Brasa, farol, fuego, humo | Sistemas existentes; atlas pequeño solo donde mejore la forma | Emissive + máscara; soft alpha en VFX, no importador de props |
| M14 Piel/cabello/ropa, P2 | NPC pescador, comerciante, marinero | Personajes actuales para escala; biblioteca/rig posterior | Colores/atlas y normales opt-in; compatible con animación existente |
| M15 Señalética, P1 | Nombres, mercancía, banderas | Atlas/arte propio, tipografía legible al zoom real | Albedo + alfa donde proceda; texto de Aldea Coralina, no copiar marca de referencia |

En la primera prueba no hacen falta quince sets completos. Bastan cuatro grupos compartidos: atlas
madera/lona/hierro/cuerda existente, roca/arena, palma/hoja y los inputs actuales de agua. Señales y decals
se incorporan después de aprobar esa base.

### 5.2 Qué entregar por material

- Fuente editable y, si procede, modelo de alta resolución fuera del bundle; variantes finales con nombre,
  versión y consumidor concreto. Un moodboard o una imagen de material no son un set listo para renderizar.
- Albedo sin iluminación direccional ni sombras fuertes horneadas; se admite oclusión pintada local suave.
  Comprobar bajo dos direcciones de luz para evitar doble sombreado.
- Normal tangente con convención declarada y relieve discreto. Orientación de canales validada sobre una
  pieza de prueba; no inferir normal físico correcto de una imagen bonita sin comprobación.
- Roughness/metallic/AO solo cuando aporten y exista consumidor. Para madera, arena, cuerda, hoja y lona,
  metallic es cero; para óxido/pintura no tratar toda la superficie como metal expuesto.
- En un futuro set glTF compatible puede empaquetarse AO en R, roughness en G y metallic en B si se
  referencia cada uso correctamente. Es un formato de entrega posible, no un canal ya activo del shader.
  La [especificación glTF 2.0](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc)
  define el empaquetado de metallic/roughness y el uso de oclusión; el adaptador sigue necesitando integración.
- Albedo/emisión de color en sRGB; normales y máscaras como datos sin conversión de color. La
  [guía de color de Three.js r160](https://github.com/mrdoob/three.js/blob/r160/docs/manual/en/introduction/Color-management.html)
  distingue estos inputs. Revisar conversión de salida y postproceso con una carta gris; no añadir una segunda corrección a ciegas.
- Alfa en hojas, redes, telas rotas y VFX. Una máscara de desconchado mezcla madera/pintura; no debe abrir
  agujeros en una pared. Color, sombra y pasada de normales/profundidad deben recortar la misma silueta.
- UVs con veta orientada, bordes alineados a trim y densidad comparable. Probar costuras, mipmaps y
  atlas a distancia; añadir padding para que el filtrado no traiga el color de otra región.
- Derivados de inicio 1024 PC / 512 móvil como el atlas existente. 2048 solo si una comparación a cámara
  real lo justifica; no subir todas las familias por un asset protagonista.
- WebP existente para color si conserva lectura. Mapas de datos requieren comprobar error de compresión;
  KTX2 es un ensayo posterior con loader/transcoder y medición, no soporte que este plan dé por integrado.

## 6. Kit de modelos y reglas de ensamblaje

### 6.1 Reglas antes de producir

Usar `2 u` por celda y `2.6 u` por nivel para piezas que compartan balsa/editor. Exportar con +Y arriba,
frente +Z, transformaciones aplicadas y pivotes definidos. El suelo se encaja por esquina/centro de celda
según un contrato único; pared/barandal por borde; soporte por punto de apoyo. Documentar el contrato
en V03, y no mezclar convenciones de piezas adquiridas sin adaptarlas.
Estas medidas pertenecen al contrato de balsa: no fijan la altura de terrazas ni obligan a todos los edificios
especiales a usar la misma escala. Su transitabilidad se define en el corte de gameplay correspondiente.

Definir sockets de poste, viga, escalera, cuerda y toldo. La variación artística mueve tablas, remates y
color, conservando límites estructurales. Los meshes visibles no definen por sí solos los colliders:
verificar anchura de paso, altura de suelo y oclusión de cámara contra la simulación.

### 6.2 Producción gradual

| Grupo | Primera producción | Ampliación tras aprobar |
|---|---|---|
| Costa/roca | Pared, esquina, bloque alto; remate y pie; roca playa grande/mediana/grupo | Arco protagonista, isla distante, salientes y rupturas |
| Palma/vegetación | Una palma con dos copas y tres poses; un arbusto/hoja ancha | Tronco arrastrado, hierbas y otras siluetas donde falte variedad |
| Estructura | Piso, poste, viga, diagonal, panel pared, abertura puerta/ventana, barandal, techo, escalera | Esquina/remate, suelo roto, contraventana, puerta separada, escalera de mano y pasarela |
| Puerto | Reusar piso/poste/barandal; añadir amarre y soporte inferior | Ramas/esquinas, grúa, variantes sobre pilotes |
| Tela | Toldo rectangular y bandera; una vela con bordes/amarres | Toldo triangular, cortina/remiendo y estandarte |
| Props | Crate integrado, barril, cesta/cubeta, cuerda, mostrador, farol | Cofre articulado, sacos, red, mesa/banco, carga, frutas/pescados agrupados |
| Hitos | Un puesto y una casa piloto | Edificio central, torre, monumento, almacén y taller como prefabs del kit |
| Barcos | Balsa actual y silueta provisional de bote/velero | Un bote y un velero protagonista modular; barco en construcción al segundo pase |

El primer rincón usa únicamente las piezas que necesita. Conchas, tornillos, interior completo de taberna,
flota, multitud y ruinas del fondo se producen después. Los prefabs incluyen una lista de piezas y
transformaciones; no sustituyen las reglas de construcción del jugador.

### 6.3 Reutilización de la colección existente

Consulta acotada de [CANDIDATES](docs/research/unreal-assets/CANDIDATES.csv),
[SUMMARY](docs/research/unreal-assets/SUMMARY.md) y [PORTABILITY](docs/research/unreal-assets/PORTABILITY.md):

| Recurso | Estado real | Decisión para este plan |
|---|---|---|
| `prop:storage-crate` / Dreamrise `SM_StoragePart_03` | GLB integrado; entrega A02 documentada | Reusar en cargo/mercado, ajustar coherencia visual si la comparación lo pide |
| `tex:raft-comic-v1` | Albedo WebP 1024/512 integrado, madera/lona/hierro/cuerda | Primera base del kit; revisar UV, saturación y escala de veta al extenderlo |
| Palmas/rocas/barriles/muelle actuales | Geometría procedural integrada | Punto de partida y fallback; mejorar silueta/material antes de reemplazar todo |
| `SM_SmallWoodeHut` | `.uasset`, miniatura asociada; no GLB comprobado | Casa prefab candidata, no kit modular; inspección mínima si reduce el trabajo |
| `SM_RepairBench` | `.uasset`, miniatura asociada; sin exportación aceptada | Evaluar para taller cuando haya consumidor, no bloquear primer rincón |
| `SM_Rock`, `SM_Logs`, `SM_Torch` | Pistas por nombres/rutas; mallas sin revisión suficiente | Comparar candidato concreto antes de producir definitivo; descartar si estilo/coste no encaja |
| `Noise00` | PNG; prueba A01 aplazada por beneficio insuficiente | Mantener ruido actual; no incorporarlo por estar disponible |
| `Noise10`, salpicadura Niagara, impactos | Textura/referencias parciales; efectos sin portabilidad directa | Inputs opcionales de una prueba concreta; Niagara/material UE se recrean en Three.js |
| Kit modular portuario, barcos, roca tropical/palmas completos | No identificado como kit comprobado en el inventario | Autoría procedural/Blender o adquisición dirigida después de fijar escala y estilo |

El GLB de la caja conserva su paleta propia de exportación; no usa automáticamente el atlas de la balsa.
Aplicar ese atlas a otro modelo requiere UV/remapeo y comparación visual, además de la coherencia de paleta.

No se vuelve a inventariar toda la colección. Antes de cada familia, registrar el candidato elegido o la
razón de descartarlo. Fuentes `C:\Unreal` intactas; trabajar en staging. La presencia de un archivo no
prueba exportabilidad ni que sus materiales vayan a conservarse en nuestro toon.

## 7. Shaders y render: qué conservar, ampliar y comprobar

| Sistema | Trabajo propuesto | Prueba de aceptación |
|---|---|---|
| Toon común | Conservar bandas; ajustar paleta, transición de sombras y detalle por distancia | Roca/madera/hoja/personaje juntos bajo día y golden; colores legibles en low |
| Madera/lona/metal | Máscaras explícitas de material/tinte/humedad; trim y atlas compartidos | Muelle, pared y balsa parecen de la misma biblioteca sin repetir marcas gigantes |
| Terreno | Mezcla macro arena/arena húmeda/piedra/camino por máscaras; controlar tiling; triplanar solo donde aporte | Costa sin costuras o estiramiento, senderos visibles, roca de verticales coherentes |
| Roca | Normales y facetas de geometría seleccionadas, grietas dibujadas y variación amplia | Silueta y caras funcionan aun quitando el normal map; no parece adoquín ni triángulos aleatorios |
| Agua | Calibrar absorción, color de fondo, ruido, destello y frecuencia/ancho de espuma; usar geometría litoral mejorada | Transparencia somera, costa/roca/poste/casco sin halos ni filtración de refracción; low conserva profundidad visual |
| Follaje/telas | Viento por altura/peso de vértice, raíz/amarres inmóviles, color por instancia | No separarse del tronco/poste; pasada de normales, sombra y color coinciden al moverse |
| Tinta | Menos costuras interiores pequeñas, peso que cae con distancia y categorías con detalle controlado | No temblar al mover/zoom; jugador y edificios se leen sin una malla negra de líneas |
| Contacto | Sombra existente, AO local pintado/máscara; ensayo SSAO solo si hace falta | Postes, barriles y aleros se apoyan sin manchón negro/halo; medir coste y fugas |
| Humedad/brillo | Lóbulo especular estilizado limitado para metal/mojado si mejora el look | Un herraje y pie húmedo se diferencian de madera/lona; roughness solo con consumidor verificado |
| Atmósfera | Fondo más frío, bruma por distancia, cielo/calidez coordinados | Panorámica con tres planos, cámara de juego sin velo sobre rutas o proyectiles |
| Emisión/VFX | Reusar pools, fuego/humo/brasas y luces sin sombras existentes | Movimiento suave, bloom contenido y peor caso nocturno medido |
| Oclusión | Reusar dither de props; revisión de techos/palmas/paredes nuevas | Jugador/interacción/proyectiles visibles al cruzar detrás; apuntado y colisión conservados |

El agua actual reconstruye profundidad y refracta color de pantalla; el nombre interno `ssr` no significa
que tengamos reflejos completos de escena. No presupuestar SSR de reflexiones, simulación de fluidos,
GI en tiempo real o un cambio de motor como requisitos de esta dirección artística.

Las modificaciones deben respetar la secuencia actual: normales/profundidad → opacos → tinta → copia para
refracción → agua → FX → bloom/grading/AA. Alpha-test, deformación y dither deben coincidir en las pasadas
pareadas y en sombras. Los detalles normales de superficie no deben convertir el pass de contornos en ruido.

## 8. Rendimiento, descarga y calidad

El presupuesto existente de [DESIGN §11](DESIGN.md#11-render) es **menos de 200 draw calls y 300 k
triángulos**. No asumir que cada prop puede gastar el máximo del importador. Instancing y atlas reducen
cambios/draws, pero las pasadas de sombra, profundidad y postproceso siguen costando.

El terreno ya usa hasta 250 × 250 celdas antes de eliminar mar profundo: aumentar su resolución global
es una mala primera compra de detalle. Añadir roca diseñada y geometría localizada, y medir el resultado.

### Objetivos provisionales para V02, pendientes de baseline V00

| Dimensión | Objetivo inicial, no resultado medido |
|---|---|
| PC de referencia | 60 FPS sostenidos en cámara jugable; registrar frametime p50/p95 y dispositivo |
| Teléfono de referencia | 30 FPS sostenidos con tier documentado; solo un teléfono real acepta este objetivo |
| Contadores de escena | Mantener presupuesto existente; registrar también coste por pasada y delta frente a baseline |
| Arte incremental del primer rincón | Intentar ≤ 5 MB PC / ≤ 2 MB móvil descargados; reutilización incluida sin duplicar cargas |
| Texturas nuevas residentes del primer rincón | Reserva inicial ≤ 32 MiB PC / ≤ 16 MiB móvil, contando mipmaps; aparte de targets y recursos previos |
| Resolución inicial | Color 1024 PC / 512 móvil, mapas de datos según necesidad; una fuente por dispositivo |

Estos números sirven para limitar la primera prueba, no prometen rendimiento del puerto entero ni fijan
el hardware mínimo. V00 registra el equipo y la memoria/coste de la escena actual antes de aceptarlos.
El AUTO actual baja de tier por debajo de 45 FPS: un objetivo móvil de 30 FPS puede terminar en low.
Para ese objetivo, probar low explícito y AUTO; cambiar la política requiere un corte separado y evidencia.

PNG/WebP pequeños no prueban poco consumo GPU. Como referencia de cálculo, un RGBA8 1024² sin compresión
GPU ocupa unos 4 MiB antes de mipmaps, unos 5.33 MiB con cadena completa; 512² ocupa una cuarta parte.
Los render targets, profundidad y supersampling deben contarse aparte. Si se prueba KTX2, medir formato
transcodificado real, descarga y tiempo de preparación, sin atribuirle ahorros automáticos.

Plan de degradación propuesto:

- Conservar siluetas, masas de color, poste/soporte y costa en todos los tiers.
- Reducir microdetalle, partículas, aparejos pequeños y sombras de props secundarios primero.
- En low el agua conserva color/profundidad por heightmap, pero no refracción/espuma de contacto completas.
  Revisar una alternativa barata si la falta de contacto hace flotar los postes.
- Agrupar estáticos por celdas/material; instanciar familias repetidas; LOD de roca/palma/barcos y culling
  por distrito cuando la ampliación lo justifique. No crear un objeto JS/draw por clavo o fibra.
- El manifiesto actual precarga entradas: no registrar toda una biblioteca aún sin consumidor. Carga por
  distrito es una extensión futura con fallback, ownership/dispose y recuperación tras pérdida de contexto.

## 9. Ruta de ejecución y gates

| Corte | Entregable concreto | Dependencia y criterio para avanzar |
|---|---|---|
| **V00 — baseline y contrato visual** | Capturas actuales de costa/aldea/muelle/balsa en cámaras fijas; métricas, carta de materiales y decisión de reuso | [Brief V00](docs/briefs/visual-v00-port-baseline.md). Referencia/evidencia/versiones registradas; ninguna cifra física inventada |
| **V01 — composición gris** | Bahía aislada con playa, dos cotas, plaza, rutas, muelle ramificado, masas de edificios y arco provisional | Siluetas y rutas visuales se leen sin texturas; encuadres panorámico y de juego/móvil. Medidas transitables aún son propuesta |
| **V02 — primer rincón con estilo** | Área aproximada 30 × 30 u: arena seca/húmeda, dos rocas, palma, muelle corto con soporte, puesto/toldo, crate/barril y balsa actual | Materiales comunes, luz, tinta y agua juntos; comparación fija con/ sin HUD y low/high; rendimiento y fuente/resolución verificadas |
| **V03 — kit portuario** | Piezas compartidas con pivotes/UV/sockets, LOD y variantes; un puesto, casa sobre pilotes y torre como prefabs | Ensamblajes sin grietas, coherencia entre tierra/balsa, oclusión/sombras; adquisición solo para huecos concretos |
| **V04 — un distrito completo** | Plaza, edificio protagonista, 3–5 conjuntos de edificios, mercado y muelles; costa/hito refinados | La composición transmite la referencia con áreas libres y rutas legibles; no escalar a toda la isla antes de esta revisión |
| **V05 — embarcaciones y fondo** | Un bote y un velero protagonista; siluetas de fondo, carga y aparejos por distancia | Primero apariencia amarrada/decorativa. Cubierta móvil/pilotaje/interacción solo mediante D08/M6; sin reglas implícitas de flota |
| **V06 — vida del puerto** | Grupos de carga/pesca/mercado, letreros, red/grúa, NPC actuales y animaciones ambientales | Actividad agrupada, contactos y viento; sin multiplicar entidades autoritativas para decorar. Personajes nuevos A09 si hace falta |
| **V07 — integración jugable** | Reemplazos o ampliación de Aldea Coralina aceptados en juego/online | Skins conservan bounds; nueva topología exige heightfield/colliders compartidos, rutas/cámara, persistencia/versionado donde cambie contrato; D14/M8 |
| **V08 — acabado y publicación** | Ajustes finales de HUD, sonido, día/noche, carga/LOD y paquete publicado | Dispositivos, peor caso, fallback/caché/contexto y capturas aceptados; URL y versión pública comprobadas al publicar |

V00→V01→V02 es la ruta crítica inicial. Durante V01 puede prepararse arte de V02 con dueño por archivo;
durante V03 puede hacerse la silueta de barco de V05. La integración V07 depende de los gates de gameplay
que afecte, no del aspecto del barco o edificio. El rendimiento se revisa en **cada corte**, no solo en V08.

### Composición sugerida para el primer distrito

```text
Fondo:    roca/hito distante     terrazas + edificio protagonista
Medio:    casa / taller         plaza abierta       mercado / torre
Costa:    playa + palmas        bajada clara        muelles ramificados
Agua:     roca sumergida        balsa / bote        velero protagonista
```

Es una hipótesis de composición; V01 la compara con la cámara actual y las posiciones/interacciones de
Aldea Coralina. El primer distrito no requiere mover el mapa persistente mientras se ensaya su apariencia.

### V02 por partes, para evitar una entrega demasiado grande

1. **V02a costa:** macroforma, remates de roca, fondo somero y mezcla arena húmeda/seca.
2. **V02b kit mínimo:** poste/viga/piso, puesto/toldo y UV sobre materiales compartidos.
3. **V02c acabado común:** calibrar luz/tinta/agua/hoja; añadir mapas/shaders solo ante un hueco demostrado.
4. **V02d aceptación:** comparación estética, selección real de variantes, rendimiento y fallback.

No producir el pueblo completo mientras todavía no sabemos si estas cuatro familias se ven coherentes.

## 10. Criterios de aceptación y evidencias

Cada corte mantiene semilla, hora, cámaras, zoom, viewport, tier y versión de assets para comparar.
Capturas por lo menos panorámica, cámara jugable y detalle; high PC y low/medium móvil emulado. Día es la
referencia principal, golden y noche verifican que pintura/contacto no oculten errores.

La revisión debe responder con capturas y datos:

- ¿La composición se entiende sin HUD y en miniatura/grises? ¿Hay hito, rutas y áreas de respiro?
- ¿Muelle, pared y balsa comparten paleta y escala de desgaste? ¿Roca y arena mantienen grandes planos?
- ¿Manchas de pincel y bordes irregulares se leen en roca, madera y frondas sin convertirse en ruido fino?
- ¿El agua revela fondos donde corresponde y la costa/postes/casco están anclados sin halo?
- ¿Se distinguen personaje, interacción, proyectiles y salida mientras la cámara gira o se acerca?
- ¿Sombra, color y contornos coinciden con viento, recortes, dither y geometría nueva?
- ¿Faltando GLB/textura aparece un fallback útil? ¿Reabrir/reconectar y cambiar tier libera recursos?
- ¿Se cargó realmente 512 móvil y 1024 PC? Registrar URL/dimensiones; no basta la entrada del manifiesto.
- ¿Contadores, frametime, descarga y memoria cumplen en dispositivo registrado? La emulación/software
  sirve para layout y lógica; FPS de SwiftShader no acepta rendimiento físico.

Registrar un informe `docs/delivery/visual-vNN-*.md` y evidencia con rutas, base commit, hashes relevantes,
candidatos reutilizados/descartados, capturas inspeccionadas y limitaciones. No crear tests que solo repitan
valores de arte. Ejecutar tests pertinentes si cambian contratos de material/LOD/carga; si cambia topología,
verificar rutas/altura/colisión y cliente-servidor en la entrega de gameplay.

## 11. Siguiente trabajo y decisiones aún abiertas

**Herramienta de trabajo:** catálogo de 76 filas en `tools/art-catalog/`, con búsqueda, imágenes,
entregas versionadas y fichas de integración. Avanzar fila por fila desde arena y palmera, cruzando
recursos existentes antes de generar y colocando cada entrega real en su consumidor con evidencia.

**Arena iniciada por el autor:** [S01](docs/briefs/visual-s01-sand-family.md) distingue cinco acabados de
la familia y objetos separados. Lámina local registrada; el autor seleccionó después la arena dorada
con guijarros/conchas en `materials/` sobre v2. Fuente intacta y WebP 1024/512 preparados; 3 × 3 sin unión
brusca evidente, con grupos repetidos reconocibles. No aplicada al juego. Próximo ensayo: escala/luz y
repetición de seca, mezcla húmeda/orilla y después compactada/conchas/rocas.

**Siguiente validación del entorno: V00, seguido de la composición gris V01.** El primer objetivo de arte acabado
es V02, un rincón de puerto que podamos aprobar antes de producir todo el catálogo.

El principal mantiene dirección artística, integración de pipeline/manifiesto, documentos compartidos y
aceptación. Luna puede preparar inventario acotado, especificaciones UV/pivotes y piezas con archivos
exclusivos. Una sola revisión navegador/GPU a la vez; fuentes, render y sim con dueños separados.

Quedan por fijar al ejecutar V00/V01: PC y teléfono físicos de referencia; zoom prioritario; densidad deseada
del primer distrito; cuáles terrazas serán transitables; y si el barco protagonista será decoración inicial
o también una entrega jugable. Mientras tanto, se conserva navegador + PC/móvil, escala actual y pruebas
aisladas, sin cambiar esos contratos ni comprar/generar bibliotecas completas por adelantado.

La entrega de planificación revisó código, inventario y dos capturas existentes. No ejecutó shaders nuevos,
pruebas de juego, benchmark físico, conversión de Unreal, compra de assets ni despliegue.
