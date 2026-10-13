# Centro de iconos, referencias y meshes

**Modelos recibidos, 2026-10-12:** 12 GLB del autor archivados y derivados 512/256
preparados. Antorcha/resina/coco conectados al juego; nueve piezas disponibles como
decoración en la biblioteca GM, con carga bajo demanda. [Entrega y pruebas](../delivery/item-models-v1/DELIVERY.md).
Descargas conserva los originales; las versiones del juego están en `assets/models/items-v1/`.

Abre **[ARTE-Y-MODELOS.html](../../ARTE-Y-MODELOS.html)** desde la raíz del proyecto.
Es la galería única para buscar, ver el PNG, descargarlo para Tripo y localizar su carpeta de entrega.
Las fuentes originales conservan sus rutas; la galería elige una referencia por objeto y evita repetir
antorcha, resina y coco, que también estaban incluidos en el paquete de cocina.

## Entrega que estás generando

Dentro de `gm-editor-first`, guarda los modelos aquí:

| Objeto | Archivo sugerido | Referencia elegida |
|---|---|---|
| Antorcha | `docs/art/source/torch-resin-coconut-v1/antorcha/antorcha-v1.glb` | [PNG apagado](torch-resin-coconut-v1/torch-tripo-reference.png) |
| Resina | `docs/art/source/torch-resin-coconut-v1/resina/resina-v1.glb` | [PNG limpio](torch-resin-coconut-v1/resin-tripo-reference.png) |
| Coco | `docs/art/source/torch-resin-coconut-v1/coco/coco-v1.glb` | [PNG entero](torch-resin-coconut-v1/coconut-tripo-reference.png) |

Si ya exportaste otro nombre, déjalo tal cual. Preferimos GLB con texturas incluidas; si hay ZIP o texturas
externas, guárdalos junto al modelo. Para nuevas versiones usa `-v2`, `-v3`, sin sobrescribir el original.
La antorcha va apagada: su fuego es un efecto separado. Aproximadamente 1.000 triángulos para la antorcha
y 500–800 para resina/coco. Conservamos el original aunque salga más pesado y revisamos el derivado después.

Estas carpetas son entregas fuente, pendientes de revisión. Cuando lleguen los modelos comprobaremos
forma, escala, pivote, materiales, triángulos y texturas, prepararemos los derivados y conectaremos cada
pieza a su uso visual. Poner un GLB aquí no modifica el juego ni su manifiesto automáticamente.

## Cocina: qué estaba preparado

Los iconos y PNG ya existen; **no hace falta pedir otra imagen** para estas piezas.
El paquete tiene 17 referencias: 3 de la entrega actual, 11 de cocina y 3 propuestas.

| Piezas | PNG individuales | Entrega de modelos | Estado y utilidad |
|---|---|---|---|
| Pescado, fruta, harina, galleta, ron, agua | [Carpeta de PNG](cooking-icons-v1/singles/) | `docs/art/source/cooking-items-v1/<id>/` | Bienes existentes; referencias listas, meshes por recibir si necesitan representación 3D. |
| Caña, especias | [Carpeta de PNG](cooking-icons-v1/singles/) | Misma carpeta, ids `cana`, `especias` | Bienes existentes; todavía no son requisitos de las comidas especiales. |
| Pescado asado, grog, galleta reforzada | [Carpeta de PNG](cooking-icons-v1/singles/) | Ids `meal_roastFish`, `meal_grog`, `meal_heartyBiscuit` | Se preparan y consumen al momento. Modelos opcionales para animación/presentación; no son mercancías almacenables. |
| Sal marina, lima, hierbas | [Propuestas](cooking-icons-v1/proposals/) | Ids `sal_marina`, `lima`, `hierbas_aromaticas` | Arte de conceptos; obtención, efectos y recetas aún por diseñar. Menor prioridad. |

Antorcha/resina/coco ya están recibidos. Después podemos priorizar botellas, alimentos y otros objetos
que vayan a verse sostenidos, sobre mesas o en el mundo; tener icono no obliga a crear un mesh para todos.
[Vista conjunta](cooking-icons-v1/contact-sheet.jpg) · [ZIP de cocina](cooking-icons-v1/cooking-tripo-pack-v1.zip)
· [Detalle de recetas y prompts](cooking-icons-v1/README.md).

## Dónde queda cada clase de archivo

| Archivo | Lugar |
|---|---|
| PNG elegido para modelar, prompts y originales | `docs/art/<pack>/`; enlazados desde la galería |
| GLB/ZIP/texturas exportados por el autor | `docs/art/source/<pack>/<id>/` |
| Iconos comprimidos que ya usa el juego | `assets/ui/kit/` |
| Modelos optimizados e integrados | `assets/models/`, con su consumidor y manifiesto revisados |
| Capturas e informes de aceptación | `docs/delivery/<entrega>/` o `docs/art/<pack>/qa/` |

Las referencias antiguas de herramientas, armas y ropa están descritas en
[tripo-items-v1.md](tripo-items-v1.md). Sus PNG sueltos eran una exportación temporal en
`.scratch/tripo-icons`, actualmente ausente en este checkout; las hojas originales sí se conservan.
No confundir esa lista de iconos con modelos encargados o recibidos.
El [catálogo de arte general](../../tools/art-catalog/README.md) sigue sirviendo para terreno, pueblo,
palmeras, materiales y otras familias. Esta galería reúne el trabajo inmediato de objetos y cocina.

El índice editable es [items-index.json](items-index.json). Para actualizar la galería después de dejar
modelos: `node tools/art-catalog/build-items-index.mjs`; detecta entregas en las carpetas y las marca
como recibidas, todavía por revisar.
