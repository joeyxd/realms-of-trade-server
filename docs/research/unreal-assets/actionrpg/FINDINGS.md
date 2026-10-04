# ActionRPGMultiplayerStart: hallazgos para MAREA NEGRA

## Resultado ejecutivo

C:\Unreal\ActionRPGMultiplayerStart es un proyecto Unreal asociado a **5.8**. El descriptor habilita **EnhancedInput**; **MagicLeap**, **MagicLeapMedia** y **PlasticSourceControl** aparecen deshabilitados. No encontré carpeta **Source/**, plugins propios, archivos **.cpp/.h/.cs** ni documentación de proyecto en el árbol inspeccionado. La lógica está empaquetada en **.uasset**; no se abrió Unreal ni se ejecutó código del proyecto.

El inventario completo de **Content/** registra **1.086 archivos / 524.074.501 bytes (≈500 MiB)**: 1.078 **.uasset** (522.021.607 B), 6 **.umap** (2.040.644 B) y dos PNG de Slate (12.250 B). **files.csv** enumera todas las rutas; **inventory.json** agrupa extensión, pack y categoría. La categoría se asignó mediante carpeta/nombre, no es clase confirmada de Unreal.
La clasificación automática orientativa da 214 archivos de Blueprint/sistema (73,6 MB), 121 de modelo/arte (116,9 MB), 99 de rig/animación (36,3 MB), 89 texturas (162,6 MB), 73 materiales (9,6 MB), 203 UI/íconos (47,3 MB), 50 audio/mixers (3,4 MB) y 15 VFX (6,7 MB). inventory.json conserva los agregados completos, incluidos demos y categorías residuales.

**Lo más aprovechable es la estructura de inventario, equipo, contenedores, intercambio, crafting, vendedores y guardado como referencia de diseño.** Los paquetes muestran nombres de flujo cliente/servidor, pero no permiten aceptar autoridad, seguridad, persistencia ni comportamiento. Hay candidatos de arte, VFX, audio y UI. **No encontré kit de construcción de casas, barcos modulares ni control naval.**

## Alcance y evidencia

- **Content/** solo tiene archivos bajo **ActionRPGStarterSystem/** y **Slate/**; **Collections/** y **Developers/** no aportan archivos.
- Leí prefijos binarios de paquetes seleccionados: **2.038.828 bytes acumulados**, bajo el tope de 2 MiB. El apéndice [metadata_clues.md](metadata_clues.md) conserva cadenas legibles. Son referencias para orientar una inspección posterior, no una descompilación completa ni validación de grafos.
- Revisé visualmente **Content/Slate/T_KaiCursor.png** y **Content/Slate/T_KaiTargetCursor.png**. Son cursores pequeños con motivo dorado/metal, no arte de mundo. No previsualicé paquetes .uasset/.umap.
- No se exportó/importó ningún paquete. No hay GLB/GLTF, FBX, OBJ ni WAV suelto en Content/**: modelos, texturas, efectos y sonidos permanecen empaquetados.
- Excluí **DerivedDataCache/**, **Intermediate/**, **Saved/** (incluidos logs), metadatos Git y módulos/binarios del motor. No apareció **Binaries/** ni **Plugins/**. **Assets/StarterContent/** se cuenta pero se separa como muestra del motor: 13 paquetes, 42.668.168 B. **Assets/DemoRoom/** (29 paquetes, 7.380.884 B) y mapas de prueba/demo tampoco son candidatos de producción.
- La presencia de un archivo no prueba compra/procedencia, licencia, clase interna, calidad, rig compatible ni exportabilidad. No hice auditoría de licencias.

## Shortlist accionable

| Prioridad | Rutas y evidencia | Valor para MAREA NEGRA | Límite y trabajo |
|---|---|---|---|
| **Alta: referencia de sistemas** | **InventorySystem/Components/BP_InventoryComponent.uasset**; **InventorySystem/MPContainers/Data/ServerSlotInfoArray.uasset**, **MpContentRep.uasset**; **InventorySystem/SaveSystem/BP_JigServerSave.uasset**; **InventorySystem/MPContainers/BP_WorldContainerSave.uasset** | Referencia para UID de ítem/contenedor, equipo, bodegas y guardado al diseñar M5 persistente, carga/viajes M6 y comercio M7. | No se ejecutan en JS. Reimplementar en **src/sim/**/servidor con propiedad, validación, saneado, operaciones idempotentes y política propia de carga. Nombres de guardado no prueban durabilidad ni anti-duplicado. |
| **Alta: economía/UI futura** | **InventorySystem/JigSaw/Widgets/BP_TradeWindow.uasset**; **InventorySystem/Vendor/BP_VendorMain.uasset**, **Vendor/Data/VendorItems.uasset**; **InventorySystem/Crafting/Blueprint/BP_CraftingMain.uasset**, **Blueprint/Data/CraftingItems.uasset**, **Data/CraftingResource.uasset**, **Data/CraftingResult.uasset** | Lo más cercano a futura UI de M7 y recetas/talleres M8. | Rutas identifican candidatos, no su lógica. Extraer el esquema solo después de previsualizar; rehacer contratos de servidor, precios, acceso y persistencia. |
| **Alta-media: combate, stats y misiones** | **Character/Blueprints/BP_ARPG_Character.uasset**, **BP_ARPG_PlayerController.uasset**; **Skills/Blueprint/BP_MainSkill.uasset**, **Skills/Blueprint/SkillComponent/BP_SkillEffectsComponent.uasset**; **Skills/S_PlayerStats.uasset**, **S_SimulatedRepStats.uasset**; **QuestSystem/BP_PlayerQuestComponent.uasset**, **DT_Quests.uasset** | Referencias de stats, habilidades y misiones para contrastar con la simulación determinista y autoridad del servidor. | Usar como referencia; los nombres encontrados no validan condiciones del grafo. |
| **Media: enemigos** | **Assets/BasicEnemy/BasicEnemy.uasset** con **BasicEnemy_Attack.uasset**, **BasicEnemy_Idle.uasset**, **BasicEnemy_Spinattack.uasset**; **Assets/Spider/SK_Spider.uasset** con **SpiderAnim_Attack1.uasset**, **SpiderAnim_IDle.uasset**, **SpiderAnim_WalkF.uasset** y otros **SpiderAnim_*** | Arte candidato para comparar/crear enemigos después de previsualizar. Spider incluye malla/animaciones y mapas de textura grandes. | Clase/rig no confirmados por nombre. MAREA NEGRA anima humanoides con un rig propio de 15 huesos; cuadrúpedos requerirían render/animación propia o quedarse rígidos. |
| **Media: armas/objetos** | **Assets/PickupMeshes/O_Potion/SM_Potion.uasset**; **Assets/PickupMeshes/OneH_Sword/SkeletalMesh/SK_ShortSword.uasset** y **Materials/Textures/**; carpetas OneH_Axe, OneH_Dagger, OneH_Shield, OneH_Spear, TwoH_Bow, TwoH_Hammer y TwoH_LongSword | La poción es una primera prueba compacta de modelo estático; armas/armaduras pueden aportar arte de botín. | Armas SK_* pueden requerir exportar pose, rig y materiales a GLB. El juego hoy dibuja armas proceduralmente; el modelo no implementa inventario. |
| **Media: iconos** | **Widgets/Images/ItemImages/T_SwordImage.uasset**, **T_ShieldImage.uasset**, **T_HPBottle.uasset**, **T_ArmorImage.uasset**; **Skills/Images/T_BasicAttack.uasset**, **T_Beam.uasset**, **T_ArrowAttack.uasset**; **InventorySystem/JigSaw/Widgets/Images/T_SlotFrame.uasset**, **T_SlotBackG.uasset** | Posible fuente de iconos de objetos/habilidades para paneles futuros. | Exportar a PNG y revisar tamaño/transparencia. Estilo visual no verificado y podría chocar con el toon pintado a mano actual. |
| **Media-baja: audio** | **VFX/Sounds/WAV_Hit.uasset**, **WAV_Hit2.uasset**, **WAV_Whoosh.uasset**; **QuestSystem/Audio/WAV/Welcome.uasset**, **ThankYou.uasset**, **EndConvo.uasset** | Candidatos de efectos de combate/diálogo; podrían enriquecer el audio sintético actual. | Aunque el nombre diga WAV, son .uasset, no WAV sueltos. Exportar, escuchar e integrar carga/buses/eventos en **src/audio/**. |
| **Baja: VFX de referencia** | **VFX/Weapons/NS_Electric.uasset**, **NS_Electric2.uasset**, **NS_LaserBeam.uasset**, **NS_ShieldEffect.uasset**, **NS_WeaponTrail.uasset**; **VFX/NS_LocationEffect.uasset** | Referencias visuales para rayos, impactos y estelas. | El prefijo sugiere Niagara, no confirma clase. No porta grafos: recrear en **src/render/vfx/** con Three.js. |
| **Descartar como arte naval** | **Assets/SmallPlane/SK_SmallPlane.uasset**, **Anim_Plane.uasset**; **Mounts/BP_FlyingMount.uasset**, **BP_Mount.uasset** | A lo sumo referencia aérea futura. | Avión/montura no equivalen a barcos ni construcción modular; no resuelven casas, bodegas o timón. |

## Pistas de lógica (nombres serializados, no comportamiento confirmado)

La muestra de **InventorySystem/Components/BP_InventoryComponent.uasset** contiene **AddNewInventoryItem**, **ServerFunc_AddItemToInventory**, **Server_AddNewItem**, **DeepFindItemByUID**, **CanStackSingleSlot**, **EquipItemBySlot**, **TransferItems**, **GetAllMainContainers**, **CheckIfCanAddTradeItems**, **CheckTradeItemsAvailability**, **CheckTradingDistance**, **ClientRequestCraft**, **CraftItem**, **AddCurrency**, **CheckGold**, **CreateSaveGameObject** y **LoadSaves**. También hay respuestas **CLIENT_TradeConfirmed**, **CLIENT_TradeCanceled**, **CLIENT_ItemBought**, **CLIENT_ItemSold** y **CLIENT_SetContainerData**. **ServerSlotInfoArray.uasset** expone **ContainerUID** y **ContainerSlots**.

En **QuestSystem/BP_PlayerQuestComponent.uasset** aparecen **bReplicates**, **COND_OwnerOnly**, **OnRep_PlayerQuests**, **AddNewQuest**, **CheckForCompletedQuests**, **ClaimRewards**, **ServerFunc_ConsumeItems**, **CLIENT_OnQuestCompleted**, **PlayerQuests** y **QuestDataNonRep**. En **Skills/Blueprint/BP_MainSkill.uasset**: **HasAuthority**, **IsDedicatedServer**, **ApplyDamage**, **ApplySkillEffects**, **DamageMultipleEnemies**, **DamageSingleEnemyByInfo**. En **Character/Blueprints/BP_ARPG_Character.uasset**: **CalculateDamage**, **CalculateDamageReceived**, **AttackSpeedToMontageLen**, referencias a **S_PlayerStats** y **S_SimulatedRepStats**. En **AI/BP_AI_Main.uasset**: **AddAggroTarget**, **BindPerceptionEvents**, **CalculateDamageTaken**, **CanAttack**, **AttackRange**, **AvailableSkills**.

Esto orienta el diseño y qué abrir en Unreal después. Un nombre **Server*** o **CLIENT_*** no demuestra validación de propiedad/precio, atomicidad o seguridad. No importar grafos ni usarlos como autoridad económica.

## Ausencias y compatibilidad

- **Construcción:** no hay rutas/nombres de piezas colocables, casas, estructuras o constructor modular. Crafting de objetos no es vivienda.
- **Naval:** no surgieron rutas/nombres de casco, barco, vela, timón, bodega naval, cañón naval o control de barco. **No se encontró kit naval.** Es un barrido de nombres/rutas, no prueba semántica de todos los grafos.
- **Código:** no hay Source/, .cpp/.h/.cs ni JS/TS de gameplay visible; Blueprints están en paquetes Unreal.
- **Exportables:** los 1.078 .uasset requieren exportación; los seis .umap son mapas Unreal. Solo los dos cursores son PNG externos.
- **Persistencia:** BP_JigServerSave, S_ServerSave y SaveData son candidatos por nombre, no evidencia de durabilidad tras reinicio, migración o anti-duplicados.

## Ruta de portabilidad existente

MAREA NEGRA recibe modelos/texturas mediante [docs/ASSETS.md](../../../ASSETS.md), [tools/import-asset.mjs](../../../../tools/import-asset.mjs), [src/render/assets/manifest.js](../../../../src/render/assets/manifest.js) y [src/render/assets/registry.js](../../../../src/render/assets/registry.js): tipos char/prop/model/tex, GLTF/GLB o textura raster, fallback procedural y materiales toon. Los personajes se adaptan al rig propio de 15 huesos; modelos de edificio/barco irían como modelo estático y cada pieza necesitaría su hook de render. El importer no admite .uasset, .umap, Niagara ni audio. **src/audio/engine.js** sintetiza mediante Web Audio y no carga clips externos.

## Siguientes pruebas de exportación (otra fase)

1. Exportar **Assets/PickupMeshes/O_Potion/SM_Potion.uasset** y dependencias a GLB; revisar geometría/materiales y probarlo mediante **assets.model(...)**.
2. Exportar **Widgets/Images/ItemImages/T_SwordImage.uasset** a PNG y revisar estilo/transparencia antes de conectarlo a UI.
3. Previsualizar **Assets/BasicEnemy/BasicEnemy.uasset** más su rig/clips. Medir spider solo si se acepta desarrollar animación/render cuadrúpedo.
4. Escuchar **VFX/Sounds/WAV_Hit.uasset**; convertir a WAV solo si aporta valor e integrar con el bus SFX.
5. En Unreal, inspeccionar **BP_InventoryComponent.uasset** y **VFX/Weapons/NS_Electric.uasset** para documentar estados/dependencias; destino: reimplementación.

## Comparación con MyProject: tres archivos, no un barrido

Comparé solo tres rutas relativas idénticas bajo **Content/ActionRPGStarterSystem/**; no recorrí otros assets de MyProject. Ningún par coincide byte por byte por SHA-256. Tamaños próximos no prueban equivalencia; puede haber cambios de serialización/editor o de contenido.

| Ruta relativa | Bytes ActionRPG | SHA-256 ActionRPG | Bytes MyProject | SHA-256 MyProject | Igual |
|---|---:|---|---:|---|---|
| InventorySystem/Components/BP_InventoryComponent.uasset | 24.878.603 | 73244A3094165C029684DA9CFB1531CB834AB7692F3F03B3A0D60B8E1EEFF482 | 24.922.122 | E4BFEBA269B79F0977C88E8F9EEF432FF13C5533CCEA986E033F8D95D32A84D5 | No |
| QuestSystem/BP_PlayerQuestComponent.uasset | 1.591.348 | 1A009E7DB9E31ADCBD824754BC02D3A7F92375D8B878AAEBC9DF4E23107EA625 | 1.596.551 | B53E847C02D990A9C8A25B62AE11AA6B968909AAA4CB2838FCE6B2591884FEB9 | No |
| Assets/Mannequin/Character/Mesh/UE5Char/SKM_Manny_Simple.uasset | 15.267.278 | 78029145D6A550A62514147C9074EF3550BD5B3019C24A7B58121CD12E315E41 | 15.264.210 | C3A21E4DA2FD7C8D666589E59E23F2A7C8D75D914401B6DF470DA69095E828FA | No |

## Entregables

- [files.csv](files.csv): rutas relativas a Content/, extensión, bytes, pack, categoría y confianza de clase.
- [inventory.json](inventory.json): agregados por extensión, pack y categoría.
- [metadata_clues.md](metadata_clues.md): muestras binarias acotadas y cadenas de referencia.
