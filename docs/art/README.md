# Arte del puerto

Este índice reúne los cortes locales de autoría visual. El plan general y sus gates están en
[PLAN-VISUAL-PORT.md](../../PLAN-VISUAL-PORT.md); el catálogo operativo está en
[tools/art-catalog/README.md](../../tools/art-catalog/README.md).

## Familias aplicadas localmente

### Checkpoint S21 - terreno de isla

[Informe](../delivery/map-revamp-v1.md), pase autorizado por el autor el 2026-10-08 para cambiar solo terreno. Conserva base/colocaciones/RNG legacy 400/N401 y amplía por postpass determinista a 560/N561, resolución 1; suelo seco muestreado +63,148347 % (paso 2, umbral >0,65). Dos conexiones suaves de terreno permiten llegar caminando a puntos interiores (171 y 109 aristas; ascenso máximo 0,1412 y 0,1377 por paso, límite 0,15); se conservan los núcleos húmedos, sin puentes ni assets nuevos. Pueblo en cotas 2,4/6,4/10,4, rampas y seis pads planos de huts existentes. Mantiene orden/identidad/XZ de 1.259 props y 176 recursos; Y se proyecta al suelo. Volcán/boss, PvP, llegada y muelle protegidos. Sin pueblo, gameplay, colisiones, recursos o assets nuevos. No mueve anclajes de Puerto Sol/Ceniza ni entrega el corredor A3. 0.1.0-alpha.15/protocolo 31 requiere recargar host/peers. 220 pruebas, 30 capturas de escena + 2 del panel M, cinco contextos emulados, 20 chequeos de datos de calidad, geometría reutilizada; catálogo rev. 37 (110 filas, 54 aplicadas); fuentes y enlaces HTTP comprobados. Local, no publicado; FPS físico y multijugador humano pendientes.


- [S01 arena](../delivery/sand-family-v1.md)
- [S02 rocas de playa](../delivery/coast-rocks-v1.md)
- [S03 suelos y transiciones](../delivery/ground-family-v1.md)
- [S04 conchas y cantos](../delivery/beach-details-v1.md)
- [S05 palmeras](../delivery/palm-family-v1.md): tres modelos y atlas compartidos del autor. La integración y
  ocho casos visuales (tres modos y cinco fallos) sin errores JS/shader; snapshots de seis fuentes verificados con --check.
  Catálogo revisión 10: 80 filas, 24 aplicadas y 52 enlaces de palma exactos por bytes; S01/S03/S02/S04 pasan
  la revisión y una repetición idempotente conservó la revisión. Revisión artística fina, FPS físicos y publicación pendientes.

- [S06 raíces y plantas bajas de palmera](../delivery/palm-bases-v1.md): dos modelos y atlas compartido de hojas;
  seis snapshots exactos verificados. **62/62** pruebas sin omisiones; ocho QA (PC/móvil/low y cinco fallos),
  sin errores JS de juego ni GL, programas enlazados. Catálogo revisión 11: 82 filas/26 aplicadas y 47 enlaces
  HTTP únicos exactos; conjuntos S01/S03/S02/S04/S05 (47/44/13/33/52) también pasan.
  [Captura del catálogo](palm-bases/catalog-bases-v1.png): previews 1×, referencia, fuentes y atlas PC cargados;
  ficha con 21 archivos. Galería temporal y contacto real con dither S05 documentados. Arte fino, FPS físicos
  y publicación pendientes. El arbusto tropical independiente avanzó después en S07.

- [S07 arbustos tropicales](../delivery/shrubs-v1.md): tres variantes de hojas pintadas con viento,
  alfa compartido en color/contorno/sombra y texturas PC/móvil. En la isla local hay 784 arbustos nuevos
  (262 sustituciones y 522 adicionales), con caminos y accesos libres. **63/63** pruebas pertinentes y
  ocho casos de navegador sin errores JS de juego ni GL. Fuentes, modelos y capturas en la ficha del catálogo.
  Catálogo revisión 14, 82 filas/27 aplicadas, 53 enlaces exactos; ficha con 29 archivos e imágenes cargadas.
  [Muestrario 1×](shrubs/desktop-gallery-v1.png). FPS físicos y publicación pendientes.

- [S08 pasto volumétrico](../delivery/grass-patches-v1.md): 522 matas en 184 pequeños grupos, tres formas
  geométricas pintadas y viento. Material opaco compartido, instancing, LOD y distancia/densidad por calidad;
  sin texturas nuevas. **69/69** pruebas y cuatro casos PC/móvil/low/noassets; capturas inspeccionadas.
  [Muestrario](grass/desktop-gallery-v1.png). Catálogo revisión 15, 83 filas/28 aplicadas.
  FPS físicos y publicación pendientes.

- [S09 madera varada](../delivery/beach-debris-v1.md): 34 conjuntos de ramas, troncos y tablones;
  tres GLB de 18.740 B juntos, pintura y vetas compartidas, sin texturas nuevas. Tablones reutilizados
  de `SM_Logs` tras inspección visual. **77/77** pruebas y seis casos PC/móvil/low/fallback revisados.
  [Muestrario](beach-debris/desktop-gallery-v1.png). Fila `restos-playa` con modelos, fuentes y capturas.
  FPS físicos y publicación pendientes.

- [S10 algas someras](../delivery/seaweed-v1.md): 197 matas en posiciones submarinas existentes,
  tres formas pintadas con oscilación y LOD de 16 triángulos. Un material opaco, sin texturas nuevas.
  **83/83** pruebas y cuatro contextos PC/móvil/low/noassets revisados; [muestrario](seaweed/desktop-gallery-v1.png).
  La fila `hierbas-algas` reúne el pasto costero S08 y las algas S10. FPS físicos y publicación pendientes.

- [S11 claridad del agua](../delivery/water-clarity-v1.md): espuma más fina y fragmentada,
  cáusticas suaves y refracción contenida para leer fondo y algas. Calibración compartida SSR/simple,
  sin imágenes/pases nuevos; corrige el depth al alternar calidad. **88/88** pertinentes y seis
  contextos finales con 24 cambios de calidad sin errores GL. Comparación de 27 capturas y once
  fuentes finales congeladas. Catálogo revisión 18, 83 filas/32 aplicadas, 44 enlaces exactos;
  filas `m11-mar-espuma` y `fondo-marino`. FPS físicos, arte fino del autor y publicación pendientes.

- [S12 roca natural ilustrada](../delivery/rock-faces-v1.md): pintura compartida sobre 33 rocas existentes
  de playa/interior, con fracturas escogidas y pie húmedo. Las 35 volcánicas/arena de combate/lava conservan
  su material; geometría, colocación y colisiones sin cambios. **92/92** pertinentes y seis QA finales con
  24 cambios de calidad, 27 comparaciones y nueve fuentes finales congeladas. Catálogo revisión 20,
  85 filas/34 aplicadas; 43 enlaces HTTP exactos. Remates/arcos, arte fino, FPS físicos y publicación pendientes.

- [S13 tablones del muelle](../delivery/dock-wood-v1.md): 67 tablas y dos vigas de cubierta reutilizan
  el atlas de balsa 1024/512, con cuatro recortes y sus espejos. Misma geometría/posición y fallback;
  cero imágenes nuevas, 19.872 B de UV y un material de color propio. **105/105** pertinentes, siete casos
  finales/28 cambios de calidad sin errores GL, 20 comparaciones y ocho fuentes congeladas.
  Catálogo revisión 22, 86 filas/35 aplicadas; 37 enlaces exactos. M01 extendida y `muelle-tablones`
  aplicada; soportes, paredes, kit modular, arte final, FPS físicos y publicación pendientes.

- [S14 madera del pueblo](../delivery/town-wood-v1.md): nueve pares del autor en seis casas, un puesto
  y ocho postes, dos atlas 2048/1024 y normales suaves. Misma geometría/mapa; +1.350.720 B UV/máscara.
  **109/109** pertinentes, ocho casos finales / 32 cambios de calidad GL=0, 44 capturas y doce fuentes
  congeladas. Catálogo revisión 24, 97 filas / 44 aplicadas, 101 enlaces exactos; 88 filas previas intactas.
  [Ficha con color, normal y archivos](town-wood/catalog-door-v1.png). Techos/toldos, kit modular/huecos,
  arte fino, FPS físicos y publicación pendientes.

- [S15 paja y toldo](../delivery/town-covers-v1.md): pintura local sobre seis techos y el puesto del
  mercado, tela del atlas existente 1024/512 y fallback nativo. Sin imágenes, mallas ni pasadas nuevas;
  mismo mapa/atributos anteriores, +1.350.720 B de coordenadas/máscara. **113/113** pertinentes,
  siete casos finales y 28 cambios de calidad GL=0; 40 capturas y ocho fuentes finales congeladas.
  Catálogo revisión 28, 101 filas / 46 aplicadas; 55 enlaces exactos, 99 filas previas intactas.
  [Ficha del toldo](town-covers/catalog-awning-v1.png). Kit modular, techo irregular, telas animadas,
  arte fino, FPS físicos y publicación pendientes; siguen cuerdas/amarres.

- [S16 cuerdas del muelle](../delivery/dock-ropes-v1.md): ocho postes con vueltas y dos rollos laterales,
  atlas de balsa compartido 1024/512 y fallback nativo. +1 malla/material, 4.160 triángulos y 108.672 B
  de buffers; cero imágenes nuevas. **118/118** pertinentes, siete contextos finales / 28 cambios de
  calidad GL=0, 30 capturas y ocho fuentes congeladas. Catálogo revisión 29, 102 filas / 47 aplicadas,
  44 enlaces exactos; 101 filas anteriores intactas. [Ficha revisada](dock-ropes/catalog-ropes-v1.png),
  32 imágenes / 77 enlaces sin fallos. Cuerda física/conexión a barcos/nudos complejos, arte fino,
  FPS físicos y publicación pendientes.

- [S17 barriles y cajas](../delivery/port-cargo-v1.md): atlas existente del pueblo sobre ocho barriles
  cerrados y siete cajas abiertas. Sin imágenes/descargas/mallas/pasadas nuevas; mapa conservado.
  **122/122** pertinentes, tres contextos previos y nueve finales; 36 capturas / 36 cambios de calidad
  finales GL=0 y ocho fuentes congeladas. Catálogo revisión 31, 104 filas / 48 aplicadas, 58 enlaces
  HTTP exactos; otras 102 filas intactas. [Barril](port-cargo/catalog-barril-v1.png), 40 imágenes / 96
  enlaces, y [caja](port-cargo/catalog-crate-integrada-v1.png), 41 / 99; todas las imágenes decodifican.
  Variantes, almacenamiento funcional, arte fino/FPS físicos/publicación pendientes.

- [S19 banco y mobiliario](../delivery/town-furniture-v1.md): banco de carpintero y madera ilustrada
  en mesa/taburete/postes/caja de agujas de Doña Sepia. Atlas S14 compartidos 2048/1024, cero descargas nuevas.
  Banco 6 → 2 mallas con gema, +96 triángulos; ancla/nodos/crafting conservados. **147/147**, un PC previo
  y siete finales / 24 capturas / 28 cambios finales de calidad GL=0; nueve fuentes congeladas.
  Catálogo revisión 33, 108 filas / 52 aplicadas, 106 anteriores intactas; 43 rutas HTTP exactas,
  dos fichas con 28 imágenes / 76 enlaces sin errores. Arte fino/FPS físicos/publicación pendientes.
  Continuado visualmente por S20; composición funcional y kit de obra siguen coordinados con A0/A1.

- [S20 fachada Salty Shore](../delivery/town-hall-v1.md): tela roja con ancla/letras, soportes de
  madera y mástil en una hut existente. Atlas compartidos 2048/1024 y canvas 256², cero descargas nuevas.
  +218 triángulos / 28.376 B de buffers / una malla; mapa, recursos, colisiones y Capitana Brea intactos.
  **152/152**, un PC previo y siete finales / 24 capturas / 28 cambios de calidad GL=0;
  siete fuentes congeladas. Catálogo revisión 34, 109 filas / 53 aplicadas, 108 previas intactas;
  42 rutas HTTP y ficha con 28 imágenes / 76 enlaces exactos. Capitanía funcional, kit de obra,
  FPS físicos y publicación pendientes.

- [S18 faroles y señalización](../delivery/town-fixtures-v1.md): ocho faroles con jaula/madera y dos
  letreros con tablones horizontales/letras frontales. Color/normal compartidos 2048/1024; dos canvas
  256² reemplazan los anteriores, cero descargas nuevas. +640 triángulos / 117.840 B, sin mallas,
  pasadas o luces nuevas. **127/127**, un QA previo y ocho finales / 36 capturas / 32 cambios de
  calidad finales GL=0; siete fuentes `final-v2`. Catálogo revisión 32, 106 filas / 50 aplicadas,
  104 filas anteriores intactas, 53 enlaces HTTP exactos. Ambas fichas: 40 imágenes / 98 enlaces,
  sin fallos. Arte fino/FPS físicos/publicación pendientes.

Estos cortes no publican el juego ni alteran la prioridad o dependencias de M5/D08.

## Pruebas de arte

**Estado de personajes, 2026-10-08:** el autor rechazó visualmente todas las bases procedurales existentes
y las mallas de apariencia por feas y muy alejadas de la referencia más reciente de Horizon Tides. Los
modelos y capturas históricos permanecen como prototipos técnicos, sin aprobación visual ni integración.

- [Kit ilustrado alpha v1](../delivery/character-alpha-v1.md): nueva dirección 2D con QA técnica local
  aprobada (13/13 aserciones, 8 capturas, 26 PNG móviles y 62 recursos HTTP). De 29 originales se eligieron
  27 (26 alpha y 1 puerto opaco); dos descartes documentados. La aceptación visual final del autor y
  registro global siguen pendientes; no cierra gates 3D P02/P03 ni integra al juego.

- [Apariencia de personajes v1](../delivery/character-appearance-v1.md): P03a conserva evidencia técnica
  de contratos y exportación. CPU histórico: 13/13; navegador: falló (error de red en escritorio y cierre
  durante móvil); HTTP: pendiente. Catálogo revisión 31 sin filas `char-appearance-*`. Las mallas/capturas
  fueron rechazadas visualmente; lógica modular útil, gates artísticos P02/P03 e integración pendientes.

- [Bases de personajes v3](../delivery/characters-base-v3.md): P02c de rostro y extremidades, dedos/pulgar
  estáticos conectados y guía de cabezas alpha con prompt/origen. Cuatro GLB 1024/512, 10.216 tris,
  acercamientos de mano/pie, auditor CPU y QA escritorio/móvil emulado. Filas `char-base-male-v3` /
  `char-base-female-v3` preparadas; atlas/pintura artística e integración pendientes.

- [Bases de personajes v2](../delivery/characters-base-v2.md): corte P02b de superficies por anillos/parches,
  uniones y atlas corporal regional, 7.080 triángulos por base. Cuatro GLB 1024/512, seis fuentes,
  auditor CPU y QA escritorio/móvil emulado. Filas `char-base-male-v2` / `char-base-female-v2` preparadas;
  acabado artístico y aplicación en juego pendientes. El visor conserva comparación v0/v1/v2.

- [Bases de personajes v1](../delivery/characters-base-v1.md): iteración P02a de anatomía continua,
  relieve facial, UV cilíndrica y material. Variantes GLB con mapas 1024/512, comparación v0/v1,
  cuadrícula UV y poses en el visor. Las filas `char-base-male-v1` y `char-base-female-v1` son prototipos
  preparados; la continuación por superficies y atlas regional está en v2. El acabado de producción sigue abierto.

- [Bases de personajes v0](../delivery/characters-base-v0.md): láminas masculina/femenina con frente,
  perfil, espalda y rostro; dos GLB articulados de prueba y un [visor local](../../tools/character-lab/README.md).
  Las filas `char-base-male` y `char-base-female` conservan fuentes, modelos y QA. Estado de prototipo;
  anatomía y acabado de producción siguen en [P02](../../PLAN-CHARACTER-CREATOR.md).

- [Prueba original del arbusto v1](shrubs/shrub-v1.md): concepto, atlas de cuatro hojas, color/normal
  generados y prompts conservados. La preparación móvil y aplicación posterior están en S07.
  GPT Image 2 solicitado; la herramienta integrada no devuelve el modelo exacto.
