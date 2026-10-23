# Inventario Unreal: SimpleMultiplayerSurvival

## Dictamen para Marea Negra

El candidato con valor directo para vivienda es el kit Dreamrise (`Content/Dreamrise_SMSK`): una casa/hut completa, un banco de trabajo/repair bench, una antorcha, martillo de construcción y metadatos de una colocación con fantasma y requisitos de recursos. No es un kit modular de paredes/pisos ni un kit naval. Los nombres de paquete y ocho miniaturas embebidas ayudan a reconocer objetos, pero no se revisó una escena en Unreal ni se probaron los grafos, colisiones, exportación o rendimiento.

Para M6, no encontré cascos, tablones de cubierta, módulos, vela, ancla, timón, mástil, muelle ni puerto por nombre en el inventario completo de `Content`. La hut monolítica no cubre la necesidad de piezas intercambiables ni debe tratarse como evidencia de un barco modular. Para M8, la hut puede servir como referencia/candidato visual de casa terrestre; hay algunos meshes de piso/puerta/pared dentro de una galería de demostración, pero no evidencian un kit de vivienda listo para producción.

## Alcance, método y confianza

- Proyecto `C:\Unreal\survival project\SimpleMultiplayerSurvival`, `EngineAssociation` 5.8 en `SimpleMultiplayerSurvival.uproject` (92 bytes). El `DefaultGame.ini` identifica el proyecto como “Simple Multiplayer Survival Kit | Dreamrise Studios”.
- Incluí todos los 1,779 archivos regulares bajo `Content/` (2,561,311,525 bytes; 2.385 GiB), incluidos mapas y el único external actor. Excluí `DerivedDataCache`, `Intermediate`, `Saved`, `Binaries`, `.git` y módulos base de Unreal. No hay directorios `Source`, `SourceArt`, `SourceFormats`, `Raw` o `RawAssets`, ni carpeta `Plugins`, ni plugins declarados en el `.uproject`; el muestreo no encontró código fuente del proyecto.
- `files.csv` clasifica por extensión, ubicación y convenciones de nombre. `.uasset` y `.umap` son paquetes Unreal; en general su categoría/clase indicada es una inferencia por ruta/nombre, no una decodificación completa del tipo. Solo traté como clase fuerte las extensiones de imagen comunes y los mapas `.umap`; la apariencia de los ocho objetos abajo se revisó desde miniaturas JPEG válidas embebidas en paquetes Blueprint.
- Se extrajeron cadenas imprimibles de paquetes candidatos con una muestra acumulada máxima de 2 MiB. Los nombres de funciones, variables y referencias citados son metadatos/cadenas presentes en esos paquetes; no prueban que los grafos funcionen, que el servidor valide solicitudes, ni que una propiedad se replique correctamente.
- No se abrió Unreal, no se ejecutó código o scripts del proyecto, no se instaló nada, ni se exportó o importó una malla. Las miniaturas no demuestran calidad del modelo en escena, escala, colisión, número de polígonos, materiales finales ni compatibilidad de exportación.
- Se identificaron tres SHA-256 representativos para comparación posterior, sin hashear masivamente otros packs: ver `inventory.json` y la tabla de hashes abajo.

## Inventario agregado

| Carpeta de contenido | Archivos | Bytes | Lectura de alcance |
|---|---:|---:|---|
| `Dreamrise_SMSK` | 334 | 455,387,294 | Kit de supervivencia/multijugador que incluye blueprints, meshes, materiales, personaje, UI, audio y mapa demo. |
| `NiagaraExamples` | 669 | 1,278,142,521 | Ejemplos/galería de Niagara; contiene una escena `Gallery/DemoPlatform`, props de muestra y VFX. Su carpeta y nombres indican material de demostración. |
| `sA_Megapack_v1` | 608 | 524,607,344 | Seis subpacks de pickup, projectile, ray, shooting, skill y stylized attacks; principalmente VFX/ataques. |
| `SwordTrailVFX` | 98 | 172,586,250 | VFX de estelas de espada, demo, mapas, materiales, texturas y animaciones asociadas. |
| `BigNiagaraBundle` | 67 | 129,188,757 | Sistemas/efectos Niagara abstractos y holográficos; sin señales de construcción/hábitat. |
| `Splash` | 2 | 1,398,510 | Dos imágenes PNG de splash; no son piezas de construcción. |
| `__ExternalActors__` | 1 | 849 | Actor serializado de `ThirdPerson/Maps/ThirdPersonMap`; material de mapa/proyecto, no candidato portátil identificado. |

El desglose completo por extensión, carpeta y categoría inferida está en [files.csv](files.csv); las estadísticas reproducibles se guardan en [inventory.json](inventory.json). En `Content` hay 1,719 `.uasset`, 13 `.umap`, 46 `.png` y 1 `.tga`. El tamaño elevado está concentrado en los paquetes Unreal (aprox. 2.52 GB); no presupone el tamaño de una exportación GLB.

## Candidatos concretos y prioridad

### P1 — Casa terrestre para M8: candidato de arte, conversión pendiente

- `Dreamrise_SMSK/Assets/Meshes/SM_SmallWoodeHut.uasset` (70,989 B). La miniatura extraída desde `Blueprints/BP_Building_Base.uasset` muestra una pequeña estructura elevada, con techo inclinado y acceso/rampa. Es evidencia de miniatura, no de inspección del mesh en escena. La ortografía `Woode` forma parte del nombre real.
- `Dreamrise_SMSK/Blueprints/BP_Building_Base.uasset` (76,877 B) incluye referencias serializadas a `SM_SmallWoodeHut` y `Assets/Materials/M_BuildingGhost`; las cadenas muestran `Health`, `SetReplicates`, `bReplicates`, evento de daño y `K2_DestroyActor`. La miniatura asociada es `previews/BP_Building_Base_1.jpg`.
- Encaje: si supera conversión y dirección artística, puede alimentar el aspecto de `build:house`/vivienda del plan M8 P1. El gancho de manifiesto citado en el plan es una tarea prevista, no se afirma que ya esté conectado. Es una sola casa prefabricada, no un set de cimientos, paredes, puertas y techo componibles.
- Trabajo: exportar a GLB en una fase autorizada, verificar orientación/escala/partes/materiales, ajustar materiales PBR al render toon y registrar en el manifiesto. El `.uasset` no se carga directamente con el runtime del navegador.
- Dependencias señaladas por cadenas: `BP_Building_Base` → `SM_SmallWoodeHut`, `M_BuildingGhost` y actores del Engine. No se verificó el grafo completo.
- Prioridad **media** para M8 (una vivienda aislada aporta una forma visible); **baja/nula** para M6 (no es modular ni naval). Confianza **media** en identidad/hut por nombre más miniatura; **baja** en exportabilidad y ajuste visual.

### P2 — Interacción de construir como referencia de producto; recrear en el servidor

- `Dreamrise_SMSK/Blueprints/BP_Holdable_BuildHammer.uasset` (221,114 B), con variantes `BP_Holdable_BuildHammer_Bench.uasset` (36,800 B) y `BP_Holdable_BuildHammer_Torch.uasset` (38,354 B). La miniatura está en `previews/BP_Holdable_BuildHammer_1.jpg`; las variantes muestran la misma familia de martillo en sus miniaturas.
- Cadenas visibles del blueprint base: `Can Build`, `Try to Build`, `Spawn Building Ghost on Local for Building`, `Adjust local building actor transform`, `Destroy Building Ghost`, `Build Rotation Z`, `bCanBuild`, `Building Class`, `Recipe`, `Requirement Widget` y `SEVRER Request Build` (así aparece escrito en el paquete). También aparecen la estructura `S_InventorySystem_InventoryItemShort` y `W_BuildingRequirement`.
- Esto es una referencia útil de flujo: previsualización local, orientación y requisitos. El nombre `SEVRER Request Build` sugiere una petición al servidor, pero las cadenas no acreditan validación autoritativa, anti-cheat, propiedad, snap, límites ni resultado en red. Marea Negra debe traducir las reglas de construcción al simulador/servidor y tratar al cliente como visualización/solicitud, acorde con M6/M8.
- No aparecen nombres de función/variable de cimiento, grilla, socket, snap modular, ownership/claim, deed o solar en la muestra. La ausencia solo cubre cadenas muestreadas y rutas analizadas; no es una decodificación completa del proyecto.

### P3 — Banco y antorcha como piezas secundarias, no sistema completo de crafting

- `Dreamrise_SMSK/Blueprints/BP_Building_Bench.uasset` (35,058 B) referencia `Assets/Meshes/SM_RepairBench.uasset` (101,896 B) y `BP_Building_Base`; miniatura `previews/BP_Building_Bench_1.jpg` muestra una mesa de trabajo.
- `Dreamrise_SMSK/Blueprints/BP_Building_Torch.uasset` (35,153 B) referencia `Assets/Meshes/SM_Torch.uasset` (21,751 B) y el padre de construcción; miniatura `previews/BP_Building_Torch_1.jpg` muestra una antorcha.
- `W_BuildingRecipe.uasset` y `W_BuildingRequirement.uasset` contienen referencias a requisitos, inventario, IDs y cantidades de ítems. Son UI/Blueprint de Unreal; la muestra no demuestra recetas de producción del tipo taller→producto de M8, ni una estación de cocina/oficio lista para reutilizar.
- Puede servir como arte de taller/iluminación para M8 si la conversión y el tono lo permiten. Las interacciones, recetas, costos, mantenimiento y producción deben implementarse en los sistemas económicos del servidor.

### P4 — Árbol, roca, inventario e ítems como referencia para recolección

- `Dreamrise_SMSK/Blueprints/BP_Harvestable.uasset` (100,275 B), `BP_Harvestable_Stone.uasset` (31,878 B), `Assets/Meshes/SM_Tree_Green_01.uasset` (289,283 B) y `SM_Rock.uasset` (22,059 B); miniatura del árbol: `previews/BP_Harvestable_1.jpg`.
- Las cadenas de `BP_Harvestable` incluyen `Health`, `Item ID`, `Item Count`, `Item to Give`, `Wood`, `Add Item`, `BPC_SimpleInventorySystem` y `BPI_SimpleInventorySystem`; la clase de piedra refiere `SM_Rock` y la etiqueta `Stone`. Esto apoya que existen patrones/recursos visuales de tala/minería en el kit, sin certificar el ciclo de daño/respawn o su red.
- Reutilidad directa como lógica: ninguna en Three.js/servidor. Reutilidad de arte: potencial tras exportación. Recrear recolección, herramienta, rendimiento, persistencia y autoridad en `src/sim/**` si se adopta el diseño.

### P5 — Caja e interfaz de interacción; no confundir con bodega persistente

- `Dreamrise_SMSK/Blueprints/BP_LootBox.uasset` (53,960 B) referencia `Assets/Meshes/SM_StoragePart_03.uasset` (24,248 B), `BPC_SMSK_LootComponent` y `BPI_InteractionSystem`; cadenas: `Can Interact`, `Open Loot Box`, `GetPrompt`, `Interact`. Miniatura `previews/BP_LootBox_1.jpg` muestra una caja/cajón cuadrado.
- `Blueprints/Components/BPC_SMSK_LootComponent.uasset` y `BPC_SimpleInventorySystem.uasset` exponen nombres como `Generate Random Items`, `Add Item`, `Drop Item`, `CLIENT Open LootBox`, `CLIENT Close Lootbox` y `IsDedicatedServer`. Esto señala componentes de inventario/loot con nombres de eventos de cliente/dedicado, no prueba almacenamiento seguro por jugador, persistencia, sincronización correcta o autoridad.
- Sirve como referencia de interacción/loot y potencial prop de caja, pero no satisface por sí sola cofres de la balsa, bodegas persistentes ni el `hold` de M6. No hay nombre `Chest` en rutas completas; hay `LootBox`/`StoragePart`.

### Candidato secundario solo para inspección posterior: geometría de demo

`NiagaraExamples/Gallery/DemoPlatform/Meshes/Floor_Corner.uasset`, `Floor_Edge.uasset`, `SM_Door.uasset`, `Splitter_Wall.uasset`, `Splitter_Wall2.uasset` y `Tile_10MWall.uasset`, junto con materiales homónimos bajo `Gallery/DemoPlatform/Materials/`, son nombres de meshes de piso/pared/puerta en una plataforma de demostración. Miniaturas no revisadas. Pueden contener geometría útil como bloque de prototipo, pero su contexto y nombres apuntan a set de galería; no hay prueba de encaje, escala, modularidad de unión ni calidad para vivienda final. No vi malla de escalera, cimiento o techo dentro de esos nombres.

## Ausencias relevantes y clasificación de packs

| Necesidad | Evidencia de rutas/nombres completos | Resultado para el plan |
|---|---|---|
| Cimiento, piso, pared, techo, puerta y ventana modulares | No hay conjunto Dreamrise de esos nombres; hay una hut completa y objetos sueltos. Piso/puerta/pared solo aparecen en `NiagaraExamples/Gallery/DemoPlatform/`. | No se encontró kit de vivienda modular listo para M8. La galería queda como exploración secundaria. |
| Escalera o módulo de cubierta | No hay ruta/nombre de mesh de escalera o escalón en el inventario. | M6 sigue sin arte modular identificado. |
| Cofre de jugador / almacenamiento persistente | `BP_LootBox` y `SM_StoragePart_03` indican caja/loot; no aparece `Chest` y no se validó persistencia. | No sustituye bodega/cofre de M6 ni almacén de M8. |
| Estación de crafting/producción con receta operativa | Un `BP_Building_Bench`/`SM_RepairBench` y widgets de recipe/requirement; no se encontró una cadena de producción confirmada. | Solo candidato visual y referencia de requisitos de construcción. |
| Ownership, solar, claim, propiedad de barco | Sin coincidencias de rutas/nombres de assets; no se inspeccionaron íntegramente todos los grafos. | No reutilizable como sistema de propiedad según evidencia disponible. |
| Barco, balsa, casco, cubierta, vela, ancla, mástil, timón, muelle, puerto | No se identificaron candidatos navales por nombres/rutas en los 1,779 paths de `Content`; términos como `port` producen falsos positivos (`Portal`, `Projectile`), no evidencia de puertos. `M_Water` es solo un material cuyo comportamiento no se inspeccionó. | No hay kit de barco ni puerto identificado. No derivar arquitectura naval del contenido. |
| Transporte aéreo | Sin rutas/nombres de aeronavío o nave; portales y jets de Niagara son VFX abstractos. | Sin candidato utilizable identificado; interés futuro solamente. |

No se identificó ningún pack de contenido de construcción comparable entre las carpetas; Dreamrise es el único con un sistema nombrado de building. `NiagaraExamples` se separó como material de ejemplo/galería por el propio árbol de carpetas. Las otras carpetas son packs nombrados de VFX; sus nombres no prueban origen/condición comercial y no se les atribuye procedencia más allá de la ruta.

## Portabilidad: arte vs. lógica

- **Mallas estáticas** (`SM_SmallWoodeHut`, `SM_RepairBench`, `SM_Torch`, `SM_StoragePart_03`, árbol/roca): requieren exportación/conversión a GLB y verificación, integración por el registro/manifiesto de assets y ajuste visual toon. No portan colisiones, reglas de colocación ni interacción. Ganchos conceptuales del plan: `build:<tipo>` M8 P1 o `part:<id>` M6 P3; este inventario no registra integración.
- **Materiales** (`M_BuildingGhost`, `M_Water`, materiales de malla): no ejecutables como materiales Unreal en Three.js. Hay que recrear/bakear mapas y ajustar PBR/toon; el ghost de colocación se implementa como material/overlay del cliente existente.
- **Blueprints/UI/datos** (martillo, harvestable, loot, interfaces, widgets, structs): no se ejecutan en el navegador ni en Node. Sirven como referencias de nombres/flujo; reconstruir reglas y persistencia en `src/sim/**`, y UI en cliente. El servidor debe decidir costos, colocación, ownership, loot/recolección e inventarios, nunca aceptar como autoridad el cliente.
- **Niagara/sistemas de partículas** (`BigNiagaraBundle`, `NiagaraExamples`, `sA_Megapack_v1`, `SwordTrailVFX`): no hay cargador de Niagara en el runtime. Recrear visualmente en `src/render/vfx/**` con los pocos elementos que sumen al combate; evitar traer megapacks completos al navegador.
- **Audio/animaciones/personajes**: Dreamrise tiene 31 paquetes de audio y varias animaciones/personajes, pero no se priorizaron para casa/raft/puerto. Requieren exportación/reproducción o rig/adaptación según el runtime; no se probaron.

## Shortlist de texturas raster sueltas para VFX

Revisión directa de cinco archivos sueltos bajo `sA_Megapack_v1/sA_Projectilevfx/Vfx/Materials/Textures/`. Las dimensiones/canales se leyeron del encabezado PNG/TGA; cuatro PNG se inspeccionaron como imagen. Son texturas de entrada, no efectos completos. El uso sugerido es una inferencia por su forma/nombre/contexto del subpack; el runtime Three.js no se probó.

| Archivo fuente | Bytes; tamaño/canales | Revisión y posible uso en Marea Negra |
|---|---:|---|
| `sA_Megapack_v1/sA_Projectilevfx/Vfx/Materials/Textures/Beam01.png` | 496,469; 2048×2048, 8-bit RGBA | La miniatura se renderiza blanca en el visor (no analicé su canal alpha); el nombre y subpack `Projectilevfx` lo hacen candidato a máscara de rayo/trazo. Podría alimentar un trail de proyectil, rayo o estela de agua si el shader construye color/alpha; no incluye un efecto listo. |
| `sA_Megapack_v1/sA_Projectilevfx/Vfx/Materials/Textures/Noise00.png` | 287,022; 1024×1024, 8-bit RGBA | Nube suave gris; candidato genérico para breakup de humo/niebla/fuego o turbulencia de agua en un shader. No es fuego por sí sola. |
| `sA_Megapack_v1/sA_Projectilevfx/Vfx/Materials/Textures/Noise06.png` | 3,739,532; 2048×2048, 8-bit grayscale | Ruido fractal de alto contraste; candidato a máscara de impacto/dissolve/humo. Pesa 3.74 MB, así que requiere medir/optimizar antes de llevarla al cliente web. |
| `sA_Megapack_v1/sA_Projectilevfx/Vfx/Materials/Textures/Noise10.png` | 1,210,487; 2048×2048, 8-bit RGB | Nubes turbulentas con remolinos; podría servir para distorsión o breakup de energía/agua. El RGB no prueba una interpretación de color concreta. |
| `sA_Megapack_v1/sA_Projectilevfx/Vfx/Materials/Textures/Noise03.TGA` | 786,476; 512×512, 24-bit RGB sin compresión (header tipo 2) | El nombre y carpeta sugieren mapa genérico de ruido. El visor local no decodificó este TGA, así que solo registro formato/dimensiones, sin descripción visual; convertirlo a PNG/WebP sería trabajo posterior. |

Las rutas listadas se expanden desde `sA_Megapack_v1/sA_Projectilevfx/Vfx/Materials/Textures/`. El pack también trae `NE_Trail.uasset`, `NS_Projectile*.uasset`, `NS_Hit*.uasset` y materiales `MI_Beam01_*`/`MI_Tail_*`; sus nombres y subcarpeta solo indican posibles relaciones. Ni el grafo de dependencias ni el resultado de Niagara se exportaron. No hay textura suelta con nombre `Ice`, `Water`, `Lightning` o `Fire` en esta shortlist: se podrían teñir/reusar genéricamente, pero no se atribuyen como assets elementales específicos. Una implementación requiere shaders/partículas Three.js y asociación a eventos de combate; nada queda integrado automáticamente.
## Dependencias y validación pendiente

Las referencias de paquete muestran dependencias dentro de `Dreamrise_SMSK` hacia materiales, meshes, interfaces, widgets, structs, enums y componentes propios; los Blueprints usan clases del Engine (`Actor`, `ActorComponent`, `DataTableFunctionLibrary`). Exportar una malla sin sus materiales/texturas puede dejarla incompleta. El proyecto está asociado a UE 5.8 y configura Enhanced Input; no se halló plugin separado declarado ni código C++ del producto. La referencia de paquete no acredita autosuficiencia de los assets ni que puedan abrirse en otra versión/proyecto.

Si el autor decide probar assets, limitar la siguiente fase a un canario con `SM_SmallWoodeHut` y, si la casa pasa, `SM_RepairBench`: verificar exportación GLB, texturas, ejes/escala, aspecto toon, carga en el destino del manifiesto y peso en navegador. Para M6, primero localizar/adquirir un kit realmente modular naval (casco/cubierta/piezas repetibles) antes de ensayar módulos; no usar la hut ni la galería de Niagara como sustituto.

## Miniaturas revisadas y hashes de comparación

Las ocho miniaturas JPEG se extrajeron de los paquetes indicados tras comprobar delimitadores JPEG completos. Cada preview mantiene el nombre de su paquete fuente; las rutas exactas del asset fuente son:

| Preview local | Paquete fuente |
|---|---|
| `previews/BP_Building_Base_1.jpg` | `Dreamrise_SMSK/Blueprints/BP_Building_Base.uasset` |
| `previews/BP_Building_Bench_1.jpg` | `Dreamrise_SMSK/Blueprints/BP_Building_Bench.uasset` |
| `previews/BP_Building_Torch_1.jpg` | `Dreamrise_SMSK/Blueprints/BP_Building_Torch.uasset` |
| `previews/BP_Holdable_BuildHammer_1.jpg` | `Dreamrise_SMSK/Blueprints/BP_Holdable_BuildHammer.uasset` |
| `previews/BP_Holdable_BuildHammer_Bench_1.jpg` | `Dreamrise_SMSK/Blueprints/BP_Holdable_BuildHammer_Bench.uasset` |
| `previews/BP_Holdable_BuildHammer_Torch_1.jpg` | `Dreamrise_SMSK/Blueprints/BP_Holdable_BuildHammer_Torch.uasset` |
| `previews/BP_Harvestable_1.jpg` | `Dreamrise_SMSK/Blueprints/BP_Harvestable.uasset` |
| `previews/BP_LootBox_1.jpg` | `Dreamrise_SMSK/Blueprints/BP_LootBox.uasset` |

| Archivo fuente | Bytes | SHA-256 |
|---|---:|---|
| `Dreamrise_SMSK/Blueprints/BP_Building_Base.uasset` | 76,877 | `1083908b5e3a21b77c5ac7c90755d23851982410b05d288a8b5389152989597b` |
| `Dreamrise_SMSK/Blueprints/Components/BPC_SimpleInventorySystem.uasset` | 902,528 | `d6eabfe3788a0d6b6dce12e163f7c89a4ff112f880d8980af97ca501c0bae55f` |
| `Dreamrise_SMSK/Assets/Meshes/SM_SmallWoodeHut.uasset` | 70,989 | `0b83f833d62b0bf7dfe81f3bdf9e8a115af73cee0232f1f7168998ed37784c5a` |

Los hashes permiten comparación entre proyectos, pero no se calcularon para todos los packs ni demuestran duplicación por sí solos.
