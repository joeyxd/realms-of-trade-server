# C:\Unreal — qué aporta a MAREA NEGRA

Investigación del 2026-10-04. Tres agentes GPT-6 Luna inventariaron los proyectos; el agente principal revisó
los hallazgos, el runtime de destino y muestras visuales. Esta es una evaluación para seleccionar trabajo,
no una importación ni un cambio de las mecánicas navales propuestas.

## Dictamen

La biblioteca es especialmente fuerte en **VFX, combate y patrones de inventario/crafting**. Hay un conjunto
pequeño de arte de supervivencia útil para vivienda y talleres. No identificamos por rutas/nombres un kit
completo de construcción modular ni de barcos/puertos: esos siguen siendo huecos de contenido.

La primera oportunidad con menos fricción está en texturas PNG sueltas de `sA_Megapack_v1` y, tras una prueba
de exportación, los props de `Dreamrise_SMSK`. Para la joya del juego —habitar tierra/barcos modulares— el
mayor aporte de estos proyectos es el flujo de construcción y su arte auxiliar, no un sistema naval terminado.

## Proyectos y evidencia

| Proyecto | Informe | Alcance |
|---|---|---|
| `ActionRPGMultiplayerStart` | [RPG](actionrpg/FINDINGS.md) | RPG, inventario, crafting, contenedores, vendedores, equipo, UI y arte de demo |
| `MyProject` | [Colección](myproject/FINDINGS.md) | Mayor variedad de packs VFX, RPG, supervivencia y herramientas de editor |
| `survival project/SimpleMultiplayerSurvival` | [Supervivencia](survival/FINDINGS.md) | Dreamrise, packs VFX compartidos y texturas raster sueltas |

Cada carpeta tiene `files.csv` e `inventory.json`. El inventario registra rutas, tamaños y categorías con
confianza; no convierte convenciones de nombres en clases Unreal confirmadas. [PACKS.csv](PACKS.csv) reúne los
packs por proyecto; [DUPLICATES.md](DUPLICATES.md) documenta solapamientos y comparación selectiva por hash.
La shortlist estructurada para próximos agentes está en [CANDIDATES.csv](CANDIDATES.csv); exportaciones
y pruebas de runtime pendientes se marcan explícitamente.

| Inventario reconciliado | Archivos | Bytes |
|---|---:|---:|
| ActionRPGMultiplayerStart (Content) | 1.086 | 524.074.501 |
| MyProject (Content + plugin fuente de editor) | 4.541 | 3.848.866.718 |
| SimpleMultiplayerSurvival (Content) | 1.779 | 2.561.311.525 |
| Total inclusivo, con repeticiones | **7.406** | **6.934.252.744** |

El total es 6,458 GiB y cuenta cada copia por proyecto. Content aporta 7.113 archivos; el plugin VibeUE,
293 archivos fuente/documentales. Las reconciliaciones CSV/JSON pasaron; 18 comparaciones selectivas SHA-256
contrastaron copias de seis packs. NiagaraExamples y SwordTrailVFX coinciden en sus tres muestras cada uno;
los otros cuatro packs difieren en las muestras. No deducimos de eso equivalencia completa ni cambios de
gameplay: diferencias de serialización/editor también pueden cambiar los bytes.

`ActionRPGMultiplayerStart` y `SimpleMultiplayerSurvival` declaran asociación `5.8`; `MyProject` declara un GUID
de instalación. El descriptor de VibeUE apunta a 5.8, pero no prueba la versión efectiva del proyecto.
No se examinó contenido de instalación del Engine ni módulos base. DDC, compilados, logs y metadatos privados
de herramientas quedaron fuera del inventario. El código de VibeUE se distingue como herramienta de editor.

## Candidatos priorizados

Prioridad describe utilidad para nuestro diseño y coste probable de adaptación; no calidad o rendimiento
comprobados. Los ganchos `part:<id>` y `build:<tipo>` son previstos en M6/M8, todavía por conectar.

| Candidato / evidencia | Mejora propuesta | Cómo entra y cuánto falta | Prioridad |
|---|---|---|---|
| `sA_Projectilevfx/Vfx/Materials/Textures/Noise00.png`, Survival; PNG 1024×1024 RGBA, visto directamente | Ruptura de formas en humo, fuego o agua para tatuajes/perlas | Imagen lista como fuente; asignar a shader/partículas y comparar con ruido procedural. No es un efecto completo | Alta, primera prueba de bajo coste |
| `.../Noise10.png`, Survival; PNG 2048×2048 RGB, visto directamente | Turbulencia de agua/energía | Reducir resolución si procede y adaptar UV/interpretación en VFX; revisar espacio de color de dato | Media/alta |
| `Dreamrise_SMSK/Assets/Meshes/SM_SmallWoodeHut.uasset`; miniatura de hut revisada | Primera vivienda terrestre visible, ambientación de pueblo | Exportar GLB/materiales; revisar escala, pivote y estilo; es una casa completa, no piezas modulares | Media para M8; no sustituye M6 |
| `Dreamrise_SMSK/Assets/Meshes/SM_RepairBench.uasset`; miniatura del BP asociado revisada | Taller visible, mobiliario doméstico | GLB + `assets.model`; recetas, reparación y producción requieren reglas propias. El nombre no confirma un sistema de reparación | Alta para prototipo de taller |
| `Dreamrise_SMSK/Assets/Meshes/SM_StoragePart_03.uasset`; miniatura del BP de loot revisada | Cajas, bodega visual, almacenamiento doméstico | Prop exportable en principio; el tipo procedural `crate` admite reemplazo por asset. Crear su entrada en manifiesto; permisos, contenido y persistencia no viajan con el mesh | Alta para prop; sistema pendiente |
| `Dreamrise_SMSK/Assets/Meshes/SM_Torch.uasset`, logs/rock/build plan/hammer | Iluminación, recursos y herramientas visibles | Exportar modelos; luz/llama/interacción se conectan aparte. Revisar coste y tono | Media |
| `Dreamrise_SMSK/Blueprints/BP_Holdable_BuildHammer.uasset`; cadenas de ghost, requisitos, rotación y petición de build | Flujo de construcción comprensible para casa/barco | Referencia de interacción: traducir al editor del cliente y a validaciones existentes de `raft.js`; no portar Blueprint | Alta como referencia M6/M8 |
| `ActionRPGStarterSystem/InventorySystem`: crafting/vendor/MPContainers/save y sus datos | Recetas, almacenes, comercio y UI de talleres | Estudiar esquemas/flujos y reimplementar selectivamente. Nombres/cadenas de servidor no prueban validación o persistencia robusta | Alta como referencia M6/M7/M8 |
| `SlashTrailElemental`, `ArrowTrail`, `SwordTrailVFX` | Golpes, proyectiles, impactos y variantes elementales de M4.8 | Elegir pocos efectos, exportar mapas/meshes útiles y recrear Niagara/temporización en Three.js | Alta para pulido; adaptación media/alta |
| `BigNiagaraBundle/NiagaraWeather/Effects`, MyProject | Lluvia/viento/clima de rutas y puertos | Recrear sistemas ligeros con shaders/partículas; no cargar el pack entero. Miniatura de lluvia revisada | Media, posterior a vivienda/combate legible |
| `NiagaraExamples/FX_Weapons/Impacts` y `FX_Smoke`; `_SplineVFX` | Impactos de madera/metal, humo de taller, salpicaduras/estelas | Referencia visual y mapas exportables; implementación VFX específica. Una miniatura no prueba animación | Media para naval futuro |
| `SlashTrailElemental/Resource/Audio/Water/SW_Water_Slash_01.uasset` y familias de audio RPG/Dreamrise | Mejor sonido de habilidades, impactos e interacción | Exportar audio y crear carga/reproducción por eventos. SoundCue/MetaSound requieren traducción de su lógica | Media |
| Héroes Paragon Kwang/Wukong en demos, Spider, Zombie | Posible variedad de NPC/enemigos | Geometría/rig/estilo sin evaluar. Humanoides pueden adaptarse; arañas/cuadrúpedos necesitan soporte específico. Clips no se usan hoy | Baja hasta verificar rig/peso/encaje |
| `ActionRPGStarterSystem/Assets/PickupMeshes/O_Potion/SM_Potion.uasset` y familia de armas | Poción y armas visibles en loot/equipo | Exportar GLB, verificar materiales/peso; armas SK_* pueden necesitar pose/rig; no portan comportamiento | Media |
| `ActionRPGStarterSystem/Widgets/Images/ItemImages` y `Skills/Images` | Iconos de objetos/habilidades y paneles | Exportar PNG, revisar alpha/estilo; UMG y widgets requieren UI propia | Media |

Las rutas abreviadas de `sA_Projectilevfx` se expanden desde
`C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\sA_Megapack_v1\`.
Las rutas de los demás packs aparecen completas en los informes/CSV por proyecto.

## Qué significa «portable» aquí

- **Fuente raster directa:** PNG/JPG/WebP que podemos cargar. TGA necesita conversión o un loader adicional.
  Incluso una imagen válida requiere integración, revisión visual y presupuesto de descarga/GPU.
- **Arte potencialmente exportable:** modelos/texturas empaquetados en `.uasset`, sin GLB/FBX listo. Exportación
  y dependencias pendientes; no conocemos aún polígonos, pivotes, LODs ni resultados de materiales en el juego.
- **Lógica para estudiar y recrear:** Blueprint/C++, Niagara, SoundCue/MetaSound y grafos de materiales no
  se ejecutan en el navegador/Node. Conservar ideas/datos seleccionados, no reemplazar nuestro servidor por esos sistemas.
- **Demo o herramienta:** maniquíes, escenarios de galería y VibeUE/editor sirven de referencia, con menor
  prioridad. No confundir sus archivos con arte nuevo para la isla o un módulo de gameplay portable.

El runtime actual carga GLB y texturas, adapta al toon e instancia props. Personajes humanoides se re-skinnean
a 15 huesos procedurales; los clips importados no se reproducen. No existe puente de audio externo ni cargador
de Niagara. El importador genérico convierte transparencias de modelos a recortes alpha-test: humo/fuego suaves
deben entrar por VFX específicos, no por ese camino. Ver [matriz técnica](PORTABILITY.md).

## Inspección visual realizada

El principal revisó miniaturas de hut, banco, caja y árbol de Dreamrise, además de agua/salpicadura y lluvia
de los packs VFX. También abrió directamente `Noise00.png` y `Noise10.png` en el proyecto fuente.

| Evidencia de inspección | Qué acredita |
|---|---|
| [Hut](survival/previews/BP_Building_Base_1.jpg) | Una estructura completa elevada, con techo inclinado y rampa |
| [Banco](survival/previews/BP_Building_Bench_1.jpg) | Forma de mesa de trabajo/mobiliario |
| [Caja](survival/previews/BP_LootBox_1.jpg) | Forma de cajón abierto; no su contenido o propiedad |
| [Árbol](survival/previews/BP_Harvestable_1.jpg) | Vegetación arbórea; no es evidencia de palmeras tropicales |
| [Mapa de agua](myproject/previews/T_water.png) | Miniatura de textura de salpicadura; no resolución/textura exportada completa |
| [Lluvia](myproject/previews/NS_Rain.png) | Miniatura de líneas de lluvia; no rendimiento ni temporización del sistema |

Las miniaturas son evidencia de inspección, no assets finales de producción ni renders en nuestro juego.

## Huecos que siguen abiertos

1. Kit modular de casco/cubierta, velas, timón, mástil, ancla y arquitectura de puerto no identificado por
   nombres/rutas. La ausencia de coincidencias no descarta objetos dentro de mapas o nombres distintos.
2. No se identificó un kit doméstico completo de cimientos/paredes/techo/escaleras con uniones verificadas.
   Geometría de galería en Niagara no constituye por sí sola un kit para habitar/construir.
3. No se identificó un kit modular de naves habitables aéreas.
   ActionRPG sí contiene `Assets/SmallPlane/SK_SmallPlane` y monturas voladoras: candidatos de avión/montura,
   todavía sin inspección geométrica, no un sistema de vivienda aérea modular.
4. No tenemos verificación de rig/animación/polígonos para personajes nuevos ni de portabilidad de sus clips.
5. Cofres persistentes, propiedad, daño y rescate de barcos siguen siendo trabajo de nuestro gameplay; ningún
   mesh ni nombre de Blueprint los resuelve automáticamente.

Estos huecos no obligan a comprar nada ni impiden avanzar con piezas procedurales. El inventario orienta qué
assets conviene buscar en la colección del autor y qué trabajo tiene sentido hacer ahora.

La documentación de `MyProject/context` menciona **Advanced Village Pack**, **Interactive Pandanus Plants**,
**Project Titan** y **Narrative Interaction** como dependencias previstas, pero no identificamos esos packs
por sus nombres exactos en este inventario. Son pistas para explorar la colección del autor, no assets
presentes o ya integrados. Ver [suplemento de contexto](myproject/context_supplement.md). El plan de ese
prototipo no sustituye las decisiones actuales de MAREA NEGRA.

## Siguiente prueba propuesta

1. Probar **una textura suelta** en un efecto aislado y comparar con la versión procedural: calidad, legibilidad
   durante combate, descarga y coste de GPU. Registrar como textura de datos si no es albedo.
2. Exportar **banco + caja** como dos props opacos pequeños; revisar GLB con `import-asset --dry`, materiales,
   escala y capturas. Fuente original intacta; archivos de trabajo/exportación separados.
3. Ensayar la hut solamente para vivienda terrestre. Para construir por piezas, desarrollar el editor/colisiones
   y seleccionar un kit compatible o usar geometría procedural; no cortar arbitrariamente la hut como si ya fuera modular.
4. Seleccionar dos VFX elementales y uno o dos sonidos para M4.8 después de cerrar su mecánica. Reusar recursos
   pequeños y recrear el comportamiento. No incorporar todos los megapacks a la descarga del cliente.

No se realizó ninguna de estas integraciones/exportaciones en la investigación. Las decisiones navales siguen
abiertas en [su discusión](../../NAVAL-HOUSING-DISCUSSION.md).
