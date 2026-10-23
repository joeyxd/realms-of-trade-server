# S08 — hierba volumétrica, entrega local

2026-10-07. Matas pequeñas, opacas y pintadas integradas como detalle cosmético del terreno. Alcance y reutilización revisada: [brief S08](../briefs/visual-s08-grass-patches.md).

## Implementación

`grassGeometry.js` genera los estilos `tuft`, `fan` y `wild` con 7, 9 y 11 hojas. Cada clump usa tiras estrechas con curvatura, color de vértice, UV y `aFlex`: 28/36/44 triángulos en detalle y 14/18/22 en low. No requiere imágenes, mapas ni alpha. `grassPlacement.js` produce una distribución determinista por semilla/coordenadas y comparte el despeje vegetal de `shrubPlacement.js`. `grassPatches.js` usa instancias, el material toon y el viento existentes.

| Calidad | Máximo de instancias | Radio | Distancia de detalle | Triángulos por clump |
|---|---:|---:|---:|---:|
| High | 600 | 55 | 24 | 28/36/44 cerca; 14/18/22 lejos |
| Medium o móvil | 320 | 38 | 14 | 28/36/44 cerca; 14/18/22 lejos |
| Low | 160 | 28 | 0; todos usan low | 14/18/22 |

Las matas no proyectan sombra propia, reciben la sombra existente y están en `NO_OUTLINE`. No alteran terreno, props, colisiones, RNG de simulación ni gameplay. Los máximos son límites de instancias, no mediciones de FPS.

## Población y lectura de runtime

En seed **99282957** se generan **522 matas en 184 bolsillos**: 199 `tuft`, 140 `fan` y 183 `wild`. El chunk de instanciación mide 24 unidades.

La captura de runtime en foco `(96, 84)` registró 72 instancias activas en high, 23 en medium/móvil y 6 en low. El campo `grass.triangles` de `userData` acumula la geometría de las instancias activas antes del frustum culling (1.684/544/108 triángulos). La diferencia del contador del renderer, comparando grass habilitado/deshabilitado con la misma cámara, muestra los submits realmente visibles en ese frame:

| Caso | Instancias activas en estadísticas | Draw calls adicionales | Triángulos adicionales visibles |
|---|---:|---:|---:|
| Escritorio · high | 72 | 8 | 918 |
| Móvil emulado · medium | 23 | 6 | 464 |
| Low | 6 | 2 | 108 |

Las transiciones high/medium/low y el caso fuera de isla quedaron en el registro; fuera de isla el total activo cae a cero. El caso `disabled` desactiva el gestor de assets del renderer como control de independencia: el pasto procedural sigue activo. En los cuatro casos no hay solicitudes de texturas o modelos de pasto, el material reporta `opaque: true`, `map: false`, `normalMap: false`, `alphaTest: 0`, sin sombras propias y `NO_OUTLINE`.

## QA local

El registro de runtime cubre escritorio, móvil emulado, low y el control con assets desactivados. Los cuatro registraron cero errores de página/juego, `glError: 0` y todos los programas WebGL enlazados. Cada ejecución mostró el 404 local preexistente de `/favicon.ico`; se registra explícitamente y no se cuenta como cero errores de consola.

La suite pertinente reportada para este corte pasó **69/69 pruebas en 12 archivos**, incluidas las seis pruebas nuevas de pasto.

La inspección visual revisó el mapa, el contacto cercano, la galería con tres estilos y los previews individuales en escritorio, además del mapa/galería de móvil y el mapa/contacto de low. Las matas conservan volumen y silueta; el detalle reducido mantiene la lectura del terreno. El par de capturas de viento muestra movimiento suave. No se afirma FPS en dispositivo físico ni despliegue/publicación.

## Capturas y registro

- Escritorio: [mapa](../art/grass/desktop-map-v1.png), [contacto](../art/grass/desktop-close-v1.png), [galería](../art/grass/desktop-gallery-v1.png), [tuft](../art/grass/variant-tuft-preview-v1.png), [fan](../art/grass/variant-fan-preview-v1.png), [wild](../art/grass/variant-wild-preview-v1.png).
- Móvil emulado: [mapa](../art/grass/mobile-map-v1.png), [contacto](../art/grass/mobile-close-v1.png), [galería](../art/grass/mobile-gallery-v1.png).
- Low: [mapa](../art/grass/low-map-v1.png), [contacto](../art/grass/low-close-v1.png), [galería](../art/grass/low-gallery-v1.png).
- Viento: [reloj 0](../art/grass/desktop-wind-0-v1.png), [reloj 2,1](../art/grass/desktop-wind-2-v1.png).
- Control de assets desactivados: [contacto procedural](../art/grass/disabled-close-v1.png), [mapa](../art/grass/disabled-map-v1.png).
- Datos de los cuatro casos y transiciones: [runtime-evidence-v1.json](../art/grass/runtime-evidence-v1.json).

El catálogo recibe una fila nueva `pasto-volumetrico` en Vegetación. La entrada existente `hierbas-algas` conserva su estado y sus variantes no quedan aceptadas por este corte.

Fuentes congeladas del corte: [recibo de nueve snapshots y hashes](../art/source/grass-patches-v1/source-snapshot.json), comprobado con `node tools/prepare-grass-sources.mjs --check`. Cada copia conserva el código de este checkpoint; los snapshots históricos S01–S07 permanecen intactos.

Catálogo verificado: revisión **15**, **83 filas/28 aplicadas**, **28 enlaces HTTP únicos exactos por bytes** para el pasto; la repetición del registro no cambia la revisión. La ficha muestra 10 archivos y 15 imágenes cargadas, sin imágenes rotas: [captura del catálogo](../art/grass/catalog-grass-v1.png).
