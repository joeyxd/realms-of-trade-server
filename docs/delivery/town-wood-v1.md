# S14 — texturas del autor aplicadas al pueblo

Entrega local del 2026-10-07. Nueve pares de color y normal recibidos en `materials/references`
se aplican a **seis casas, un puesto y ocho postes del muelle**. Las paredes muestran tablones con
tinta, las puertas y ventanas tienen sus recortes propios, los pisos conservan clavos/desgaste y el
puesto usa madera parchada y refuerzos. [Brief y aplicación por par](../briefs/visual-s14-town-wood.md).

## Integración y coste

`townMaterials.js` calcula UVs antes del bake local de las primitivas. `props.js` conserva los mismos
chunks: añade UV y máscara de superficie; no divide mallas ni crea piezas. Colores originales quedan
intactos en los buffers. El shader toma la pintura solo en las superficies seleccionadas y conserva
el acabado procedural en techo/tela/metal y otros props. La normal tiene intensidad 0.18 y solo afecta
la luz de las piezas pintadas; la pasada de contorno conserva sus normales geométricas.

| Medida de props actuales | Antes | Después |
|---|---:|---:|
| Meshes de props | 27 | 27 |
| Chunks estáticos | 8 | 8 |
| Triángulos totales de props | 42.034 | 42.034 |
| Triángulos de chunks | 37.520 | 37.520 |
| UV nuevas en chunks | 0 B | 900.480 B |
| Máscara nueva en chunks | 0 B | 450.240 B |
| Nuevos materiales de color | 0 | 1 compartido |
| Nuevas texturas por arranque | 0 | 2 |

PC carga color 578.874 B + normal 2.834.816 B = **3.413.690 B**, ambos 2048².
Táctil carga color 171.306 B + normal 774.780 B = **946.086 B**, ambos 1024².
Las cuatro variantes suman 4.359.776 B en disco; cada arranque carga solo su pareja.
Estimación RGBA8 con mipmaps para ambas texturas: 42,7 MiB PC / 10,7 MiB táctil; no mide VRAM
física total ni FPS. Conservamos 18 PNG originales exactos (37.887.812 B) fuera del bundle y previews
512² para el catálogo. [Receta, distribución y hashes](../art/town-wood/material-receipt-v1.json).

Sin color/noassets se recupera el material procedural anterior. Sin normal se mantiene la pintura.
No se cambia el atlas/pintura S13 de la cubierta ni la geometría, mapa, colisiones o autoridad.
Los kits de construcción con huecos/soportes siguen pendientes; la esquina recibida se usa como
superficie de los apoyos actuales, no como nueva pieza modular.

## Verificación

**109/109 pruebas pertinentes** pasan, sin omisiones. Cubren geometría, UV/máscara, materiales compartidos,
fallos independientes, mapa/RNG y regresión de familias visuales/atlas de balsa/catálogo.

**Ocho casos finales de navegador**: PC high, táctil medium, táctil low, noche, noassets, 404 del color,
404 de normal y vertical rotado. Cuatro encuadres reales por caso: pueblo, casa, puesto, muelle.
Tres comparaciones before/after PC/móvil/low con cámaras idénticas; **44 capturas**, inspección de las
vistas representativas y fallbacks. **32 cambios de calidad finales** reutilizan materiales y geometrías.
Sin errores JS de juego, WebGL 0 y programas enlazados en todas las vistas/transiciones. Los 404
deliberados producen exclusivamente el error de asset esperado; favicon 404 se identifica por separado.

Posición/normal/color/índice/matriz local y conteos de los props estáticos son idénticos por SHA-256,
incluida cubierta S13. Banderas animadas se excluyen de atributos/matriz; conservan índices/conteos/shaders.
Los nueve tiles tienen vértices pintados reales. `map.props` conserva **1.259 registros / 220.024 B**
de JSON, hash `cbfcf7c7c00dcacd2bf241805951524f1cf7cc97c8debc42fce46198ee84674c`;
también se verificó con `crypto.subtle` en navegador. La evidencia conserva este hash compacto,
el muelle y los hashes reales de buffers/cámaras/carga: [runtime](../art/town-wood/runtime-evidence-v1.json).

Doce copias inmutables: props antes y once fuentes finales de renderer, manifest, pruebas y herramientas.
[Recibo de fuentes](../art/source/town-wood-v1/runtime-source-snapshot.json); `--check` valida copias
históricas sin reescribirlas si después evoluciona el checkout.

## Catálogo y continuidad

Se añaden nueve filas `town-wood-*` con preview de color/normal, PNG original, atlas PC/táctil,
copias de código y capturas before/after. **Catálogo revisión 24: 97 filas / 44 aplicadas**.
Los 88 registros previos de revisión 23 se conservaron completos, incluidos los personajes añadidos
en paralelo. Registro repetido idempotente; **101 enlaces HTTP únicos coinciden por SHA-256**.
Ficha de puerta revisada: 52 imágenes de la ficha decodificadas, 126 enlaces y cero errores JS.
[Captura del catálogo](../art/town-wood/catalog-door-v1.png). No se guardan cambios desde la UI.

Ver el [mapa local](http://127.0.0.1:5192/?solo&debug&q=high&tod=day) y el
[catálogo local](http://127.0.0.1:5190). FPS/dispositivos físicos, ajuste artístico fino y publicación
pendientes. Siguiente pieza visual sugerida: textura/silueta de techos y toldos para acompañar esta madera.
