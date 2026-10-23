# Cocina: iconos con alfa y referencias para Tripo

**Índice y entrega de meshes:** [galería única](../../../ARTE-Y-MODELOS.html) ·
[guía de objetos](../ITEMS.md). Deja los modelos de cocina en
`docs/art/source/cooking-items-v1/<id>/`. Antorcha/resina/coco tienen su entrega
única en `docs/art/source/torch-resin-coconut-v1/`; sus imágenes de este pack son reutilizadas.

**17 PNG individuales transparentes: 14 referencias actuales y 3 ingredientes propuestos.** Se generaron 14 objetos nuevos mediante la herramienta integrada `image_gen` y se reutilizaron las referencias existentes de coco, resina y antorcha. Los PNG individuales conservan su resolución de origen; el atlas externo usa celdas de 512 px como derivado. El recorte se comprobó sobre alfa real, sin quitar fondos por color ni repintar.

- [Descargar paquete ZIP](cooking-tripo-pack-v1.zip): PNG individuales, conceptos, atlas, vista de conjunto, manifiesto y prompts.
- [Vista de todos los objetos](contact-sheet.jpg): solo para elegir; su fondo azul no forma parte de los PNG.
- [Atlas transparente](cooking-atlas-alpha.png): 4 columnas × 5 filas, orden exacto en `manifest.json`.
- [PNG individuales](singles/), [ingredientes propuestos](proposals/), [prompts exactos](prompts.json), [manifiesto y hashes](manifest.json).

## Comida e ingredientes actuales

| Archivo | Uso |
|---|---|
| `singles/pescado.png` | Pescado entero; ingrediente del asado. El catálogo conserva su nombre «Pescado salado». |
| `singles/fruta.png` | Fruta tropical representada por un mango individual. |
| `singles/harina.png` | Harina; ingrediente, no un alimento consumible por sí solo. |
| `singles/galleta.png` | Galleta de barco normal. |
| `singles/ron.png` | Ron en botella verde. |
| `singles/agua.png` | Provisiones de agua en frasco azul; no crea un recipiente reutilizable. |
| `singles/cana.png` | Caña de azúcar, mercancía existente; aún no es requisito de las comidas especiales. |
| `singles/especias.png` | Especias, mercancía existente; aún no son requisito de las comidas especiales. |
| `singles/coco.png` | Coco; arte reutilizado del corte SQL037. |
| `singles/resina.png` | Resina; material de antorchas, no ingrediente comestible. |
| `singles/antorcha.png` | Referencia extra de antorcha apagada para Tripo; la llama se añade como efecto separado. |

## Resultados especiales

| PNG | Receta actual | Preparación |
|---|---|---|
| `singles/meal_roastFish.png` | 1 pescado | Fogata/parrilla propia encendida y cercana |
| `singles/meal_grog.png` | 1 ron + 1 agua | Sin fuego |
| `singles/meal_heartyBiscuit.png` | 1 galleta + 1 harina | Fogata/parrilla propia encendida y cercana |

Estos resultados se preparan y consumen al momento en el sistema actual. Su arte no los convierte en mercancías almacenables. Se conservaron costes, efectos, temporizadores y comandos; este corte modifica presentación.

## Ingredientes sugeridos

| Concepto | Aporte propuesto |
|---|---|
| `proposals/sal_marina.png` | Conservas y pescado curado; conecta provisiones con la costa. |
| `proposals/lima.png` | Ceviche y bebidas tropicales; otra opción para cocinar sin fuego. |
| `proposals/hierbas_aromaticas.png` | Caldos y pescado aromático; recompensa explorar tierra firme. |

Propuestas posteriores: **ceviche** (pescado + lima + sal) y **pescado al coco** (pescado + coco + hierbas, con fuego). Requieren su propio diseño de obtención, cantidades, efectos y autoridad. No están añadidas al catálogo, SQL, botín o recetas.

## Usar en Tripo

Sube **un PNG de `singles/` por objeto**, no la hoja completa ni `contact-sheet.jpg`. Los objetos no llevan contorno negro, texto, plato decorativo ni manos. Los conceptos opcionales están separados en `proposals/`. Frascos, jarra y sacos se modelan como una pieza junto con su contenido visible; no generes el fondo ni una superficie bajo el objeto.

Objetivo inicial del proyecto: **500–800 triángulos** por alimento/recogible; aproximadamente **1.000** para jarra o antorcha si lo necesitan. Exportar GLB autocontenido; guardar el original y preparar texturas 512/256 para escritorio/móvil. Son presupuestos del proyecto, pendientes de medir en escena; las referencias 2D no acreditan una malla integrada. Ver [guía de objetos](../tripo-items-v1.md).

## Reproducir y revisar

`python tools/crafting-ui/cooking_icons.py .` recorta los originales conservados en `source/`, exporta los PNG, el paquete y los atlas WebP. Los cuadros de recorte explícitos conservan las colas de los peces que atraviesan la división nominal de la hoja generada. Las propuestas no entran en el atlas del runtime.

El juego usa `assets/ui/kit/foods-v1.webp` (512×512, 81.228 bytes) o `foods-v1-mobile.webp` (256×256, 26.764 bytes), con celdas 128/64. Una variante por dispositivo. Los originales y referencias grandes permanecen fuera del bundle de UI. La selección de iconos actualiza los alimentos en paneles que ya usan el kit; las tarjetas de cocina muestran ingredientes con cantidades y su resultado propio.

Fuente de las tres referencias reutilizadas: `gm-editor-first/docs/art/torch-resin-coconut-v1/`, copiadas sin alterar sus originales. [Prompts y procedencia original](source/reused-provenance.md). El trabajo SQL037 de ese checkout permanece separado; este corte no afirma que esa migración esté publicada ni altera sus archivos.

La verificación local de presentación y sus capturas quedan en `qa/accepted/`: seis configuraciones (ES/EN, escritorio, móvil vertical y stage rotado), 18 capturas, tres resultados, cinco iconos de ingredientes y cinco alimentos consumibles. Se comprobó que cada dispositivo pide solo su variante del atlas y su resolución real. Los diez tests existentes de agua/comidas conservan comandos, costes, guards y retry. Publicación y mallas Tripo se aceptan aparte.
