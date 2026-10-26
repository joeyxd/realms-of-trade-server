# Cruce de packs y posibles duplicados

Los cruces usan ruta relativa exacta dentro del mismo pack después de normalizar a `Content/<pack>/...`. Las fuentes se leyeron en solo lectura. Los tamaños provienen de los CSV reconciliados y se contrastaron con disco para cada muestra SHA-256. No se eliminó ningún archivo.

## Inventarios reconciliados y suma combinada

| Proyecto | Filas CSV | Bytes CSV | Filas JSON | Bytes JSON | Resultado |
|---|---:|---:|---:|---:|---|
| ActionRPG | 1,086 | 524,074,501 | 1,086 | 524,074,501 | filas y bytes coinciden |
| Survival | 1,779 | 2,561,311,525 | 1,779 | 2,561,311,525 | filas y bytes coinciden |
| MyProject | 4,541 | 3,848,866,718 | 4,541 | 3,848,866,718 | filas y bytes coinciden |

Suma inclusiva de las tres tablas: **7,406 filas, 6,934,252,744 bytes (6.458 GiB)**. Es una suma que cuenta packs compartidos en cada proyecto otra vez; no es almacenamiento único deduplicado.

Solo `Content/`: 7,113 filas / 6,929,763,225 bytes. `Plugins/`: 293 filas / 4,489,519 bytes, todos en MyProject/VibeUE. `Source/` raíz: 0 filas / 0 bytes reportados. ActionRPG y Survival publicaron inventario solo de Content; esos ceros fuera de alcance no implican ausencia de carpetas fuente.

## Packs y coincidencias de ruta

`PACKS.csv` tiene una fila por proyecto y pack superior dentro de Content, con el rol de revisión candidato/demo/externo. Ese rol no atribuye procedencia ni licencia.

| Pack | Proyecto y rutas compartidas | Mismo tamaño | Tamaño distinto |
|---|---|---:|---:|
| `ActionRPGStarterSystem` | ActionRPG vs MyProject: 1,077 | 179 | 898 |
| `BigNiagaraBundle` | Survival vs MyProject: 67 | 0 | 67 |
| `Dreamrise_SMSK` | Survival vs MyProject: 334 | 0 | 334 |
| `NiagaraExamples` | Survival vs MyProject: 669 | 669 | 0 |
| `SwordTrailVFX` | Survival vs MyProject: 98 | 98 | 0 |
| `sA_Megapack_v1` | Survival vs MyProject: 563 | 8 | 555 |

No hay un pack superior común a los tres inventarios. El resumen cubre rutas con pack + ruta relativa idénticos; no empareja assets solo por parecido de nombre. Un mismo nombre, ruta y tamaño no prueba igualdad de contenido.

## Muestras SHA-256

Hasta tres archivos por pack compartido, elegidos por menor tamaño y limitados a copias de hasta 20 MiB. Las rutas están debajo de `Content/<pack>/`. Digest completo por copia:

| Pack / ruta relativa | Proyecto | Bytes (inventario/disco) | SHA-256 |
|---|---|---:|---|
| `ActionRPGStarterSystem/Inputs/Actions/IA_ALT.uasset` | ActionRPG | 1,232/1,232 | `432e4d6425501547ec61d43c1f7129589b9bc0412d1ff4d6a594965f8a2bc798` |
| `ActionRPGStarterSystem/Inputs/Actions/IA_ALT.uasset` | MyProject | 1,150/1,150 | `53c0f0ae04ea34521d6b5436d8a08359499c485e4b6412fff01a1d77350afb88` |
|  |  |  | **Muestra: tamaños distintos; SHA-256 difiere** |
| `ActionRPGStarterSystem/Inputs/Actions/Turn.uasset` | ActionRPG | 1,418/1,418 | `4c5e19643c429023394c44be06995ab3014e665ba6a9deb3ba0a8fb6281e13d9` |
| `ActionRPGStarterSystem/Inputs/Actions/Turn.uasset` | MyProject | 1,338/1,338 | `326a88de1689dc0f3ac06864b2f551dee26d2ac5e5af617d03373adfcba8f34f` |
|  |  |  | **Muestra: tamaños distintos; SHA-256 difiere** |
| `ActionRPGStarterSystem/Inputs/Actions/LookUp.uasset` | ActionRPG | 1,428/1,428 | `037a76b0e344008f1b6780561187055afd95b3fc6e9710cc1bddbc48480b217b` |
| `ActionRPGStarterSystem/Inputs/Actions/LookUp.uasset` | MyProject | 1,346/1,346 | `0a1933716ad2990254c09eb28fb2d19732097e8afba7f826dfc2864de3f51f93` |
|  |  |  | **Muestra: tamaños distintos; SHA-256 difiere** |
| `BigNiagaraBundle/NiagaraBlackAndWhite/Materials/M_DefaultSpriteMaterialBlack.uasset` | MyProject | 89,309/89,309 | `4b36700b63083c99cf3e61b8180dbd3df1802f84685babe68d8b2a98477889fc` |
| `BigNiagaraBundle/NiagaraBlackAndWhite/Materials/M_DefaultSpriteMaterialBlack.uasset` | Survival | 88,116/88,116 | `7703d4d02650b6be69cf4a1983e449d18d8e7459417ec3d2df245c583fd16498` |
|  |  |  | **Muestra: tamaños distintos; SHA-256 difiere** |
| `BigNiagaraBundle/NiagaraHologramPack/Meshes/SM_Octagon.uasset` | MyProject | 97,397/97,397 | `cdc78c9c1e80d9906fd341e968e1418753f55734f34fac797d671d298d2f83cd` |
| `BigNiagaraBundle/NiagaraHologramPack/Meshes/SM_Octagon.uasset` | Survival | 95,679/95,679 | `5a450666df89dd87bca8db0da12082034cc6dfdfbcc713f9ef48c3bb3b5da7f0` |
|  |  |  | **Muestra: tamaños distintos; SHA-256 difiere** |
| `BigNiagaraBundle/NiagaraHologramPack/Meshes/SM_City.uasset` | MyProject | 145,732/145,732 | `b62cd003a077b467997b579898a1e200822b388bea765d4939b24d291660b871` |
| `BigNiagaraBundle/NiagaraHologramPack/Meshes/SM_City.uasset` | Survival | 146,162/146,162 | `3ea81a6f6fad282467772c407db53a0e70d0f1ab9180771c547efdb1f931b3ef` |
|  |  |  | **Muestra: tamaños distintos; SHA-256 difiere** |
| `Dreamrise_SMSK/Levels/Dirt_LayerInfo.uasset` | MyProject | 1,560/1,560 | `240ab133a121a8023fc3809d4b10c0cfbadacad901339a2ce003f4f1464ef35c` |
| `Dreamrise_SMSK/Levels/Dirt_LayerInfo.uasset` | Survival | 1,584/1,584 | `df795fe492200a080f1455dd660c299af01c45d07725590ec2dda2880e097ca4` |
|  |  |  | **Muestra: tamaños distintos; SHA-256 difiere** |
| `Dreamrise_SMSK/Input/Actions/IA_Look.uasset` | MyProject | 1,332/1,332 | `208d95a5df425ed820adb7f81ef025a2415915e8c5eb01e13fa5940d43c94c54` |
| `Dreamrise_SMSK/Input/Actions/IA_Look.uasset` | Survival | 1,590/1,590 | `65b62f920029413f98b67346d6ec7a8dc30d7fe9ea55df32906bca3a44b1697a` |
|  |  |  | **Muestra: tamaños distintos; SHA-256 difiere** |
| `Dreamrise_SMSK/Input/Actions/IA_Move.uasset` | MyProject | 1,332/1,332 | `173df904bce18198a7b820493707192621f7efbe49f0d556da2b2ab3c79c2bc1` |
| `Dreamrise_SMSK/Input/Actions/IA_Move.uasset` | Survival | 1,590/1,590 | `79da61f7251bf658d0bbb2b0a8cdc5b3dcd1429fcdfa9b13a512922194bb57c5` |
|  |  |  | **Muestra: tamaños distintos; SHA-256 difiere** |
| `NiagaraExamples/Gallery/Inputs/Actions/IA_Aim.uasset` | MyProject | 1,195/1,195 | `3def21f3210ff515a2e54236733e2fbb0969ce90f58993fddf3ba896b302be54` |
| `NiagaraExamples/Gallery/Inputs/Actions/IA_Aim.uasset` | Survival | 1,195/1,195 | `3def21f3210ff515a2e54236733e2fbb0969ce90f58993fddf3ba896b302be54` |
|  |  |  | **Muestra: tamaños iguales; SHA-256 coincide** |
| `NiagaraExamples/Gallery/Inputs/Actions/IA_Ping.uasset` | MyProject | 1,200/1,200 | `a2a007284acb9426689027c6d03bc99c5c3cd2ee0affb05e7c7c7f07a3345f1f` |
| `NiagaraExamples/Gallery/Inputs/Actions/IA_Ping.uasset` | Survival | 1,200/1,200 | `a2a007284acb9426689027c6d03bc99c5c3cd2ee0affb05e7c7c7f07a3345f1f` |
|  |  |  | **Muestra: tamaños iguales; SHA-256 coincide** |
| `NiagaraExamples/Gallery/Inputs/Actions/IA_Interact.uasset` | MyProject | 1,220/1,220 | `e7d0bdc0b174584194ec040ec49ab12db0b879a7484f8bef2c537bd0380cc1b2` |
| `NiagaraExamples/Gallery/Inputs/Actions/IA_Interact.uasset` | Survival | 1,220/1,220 | `e7d0bdc0b174584194ec040ec49ab12db0b879a7484f8bef2c537bd0380cc1b2` |
|  |  |  | **Muestra: tamaños iguales; SHA-256 coincide** |
| `SwordTrailVFX/Textures/RT_Draw.uasset` | MyProject | 4,042/4,042 | `caad8c2ebd7f6dabcddf9049265918b53b6a3df1b2339044f0c2c6c82e173484` |
| `SwordTrailVFX/Textures/RT_Draw.uasset` | Survival | 4,042/4,042 | `caad8c2ebd7f6dabcddf9049265918b53b6a3df1b2339044f0c2c6c82e173484` |
|  |  |  | **Muestra: tamaños iguales; SHA-256 coincide** |
| `SwordTrailVFX/Textures/T_Base_LC.uasset` | MyProject | 4,531/4,531 | `ea293f615b03b577f7a334e61af68f5324173196c07538c5e061db3f3d8a8ed2` |
| `SwordTrailVFX/Textures/T_Base_LC.uasset` | Survival | 4,531/4,531 | `ea293f615b03b577f7a334e61af68f5324173196c07538c5e061db3f3d8a8ed2` |
|  |  |  | **Muestra: tamaños iguales; SHA-256 coincide** |
| `SwordTrailVFX/Demo/M_Base.uasset` | MyProject | 8,479/8,479 | `06d20f92ef76f08e1b8e565a178e4bdde9b31033344c564e25fd446c827ded6d` |
| `SwordTrailVFX/Demo/M_Base.uasset` | Survival | 8,479/8,479 | `06d20f92ef76f08e1b8e565a178e4bdde9b31033344c564e25fd446c827ded6d` |
|  |  |  | **Muestra: tamaños iguales; SHA-256 coincide** |
| `sA_Megapack_v1/sA_Projectilevfx/Vfx/Blueprints/BP_CameraShake01.uasset` | MyProject | 6,671/6,671 | `9dcbceb79e47a2502380d744dcf6c8581267025778da3dc9324ab5d28a948ac2` |
| `sA_Megapack_v1/sA_Projectilevfx/Vfx/Blueprints/BP_CameraShake01.uasset` | Survival | 5,307/5,307 | `eeece82269aa9c336dc6a3aca5afa8f11b30780cb355a330570f58dfbf0afc74` |
|  |  |  | **Muestra: tamaños distintos; SHA-256 difiere** |
| `sA_Megapack_v1/sA_StylizedAttacksPack/BluePrints/GM_TestGamemode.uasset` | MyProject | 20,895/20,895 | `3c39c7e3faa80cf6f656c769081286cc7cb1cc404bf1cf14ca78410a8b7ae124` |
| `sA_Megapack_v1/sA_StylizedAttacksPack/BluePrints/GM_TestGamemode.uasset` | Survival | 17,272/17,272 | `d0d9d5a0b9de77c4c839a5143c5d3fd52d4b34a26e22a67fdb724586a0118470` |
|  |  |  | **Muestra: tamaños distintos; SHA-256 difiere** |
| `sA_Megapack_v1/sA_StylizedAttacksPack/Materials/Textures/T_Gradient_Vertical.uasset` | MyProject | 15,792/15,792 | `e62747376f8d5f731b11d71f2f5d818804724e5b391a6599ad6d407104d06418` |
| `sA_Megapack_v1/sA_StylizedAttacksPack/Materials/Textures/T_Gradient_Vertical.uasset` | Survival | 24,123/24,123 | `f6e62024f7bf708664e61b75336b5c2fc93665d9d6e688cab7629f88fa5e34ee` |
|  |  |  | **Muestra: tamaños distintos; SHA-256 difiere** |

Los archivos muestreados de `NiagaraExamples` (3) y `SwordTrailVFX` (3) tienen SHA-256 idéntico entre Survival y MyProject; es evidencia para priorizar verificación de esos packs. Las tres muestras de `ActionRPGStarterSystem`, `BigNiagaraBundle`, `Dreamrise_SMSK` y `sA_Megapack_v1` difieren. En los muestreos, todas las rutas existen y los tamaños de disco coinciden con los manifiestos.

Las muestras no prueban que un pack completo sea equivalente ni que sus dependencias/clases sean iguales. Los metadatos de ruta/tamaño tampoco validan semántica de Unreal. No recomiendo borrar o sustituir nada a partir de esta comparación; cualquier deduplicación requeriría hash completo del pack elegido, referencias/dependencias y aceptación explícita del owner.
