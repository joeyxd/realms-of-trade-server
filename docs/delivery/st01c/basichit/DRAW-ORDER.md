# NS_BasicHit: orden de dibujo entre los emisores de un componente (T-1022-32, T-1022-33)

Pendiente de RENDER.md ("el orden de dibujo entre emisores dentro de un mismo componente sigue sin decidirse"). Esta
nota lee el orden en la fuente de UE 5.8 instalada en esta máquina, comprueba las premisas en el asset exportado y mide
los tres órdenes posibles del laboratorio contra `basichit-reference05`. Nada de lo que sigue mueve el gate: el orden
`gate` de `basichit-render.js` sigue siendo el de los emisores hasta que el autor lo decida.

## Resultado

- Unreal no dibuja los tres emisores en el orden del asset (Flame, Flash, SimpleBurst) ni en el inverso: dibuja
  **Flash, SimpleBurst, Flame** (la llama encima). Con los tres `SortOrderHint` a 0, `ComputeRenderersDrawOrder` ordena con
  `TArray::Sort`, que es `Algo::IntroSort`, inestable; su rama de selección para 8 elementos o menos deja tres claves
  iguales como `[1, 2, 0]`.
- Medido en el laboratorio con un tercer orden `engine`: es el de menor error en los 9 encuadres donde los tres órdenes
  difieren (pasos 2, 6 y 12), empata con el inverso en el paso 18 (sin destello) y con todos en el 24 (solo ráfaga). MAE
  media sobre los 15 encuadres: gate 1,089, inverso 1,183, motor 0,912 (/255). En `t0002_side` el error baja de 0,476 a 0,074.
- Dos ejecuciones idénticas (`t1022-33-c` y `-d`: 49/49 lienzos iguales, `comparison.json` byte a byte). El gate y la
  transferencia no cambian: `transfer-check.json` es el mismo byte a byte que el de T-1021-46.

## Lo que dice la fuente de UE 5.8

Rutas bajo `C:/Program Files/Epic Games/UE_5.8/Engine/` (solo lectura; T-1022-32 las citó y el chef releyó las tres
primeras):

- `Plugins/FX/Niagara/Source/Niagara/Private/NiagaraSystem.cpp:2455-2489` `ComputeRenderersDrawOrder`: recorre
  `EmitterHandles` en el orden del asset, salta los deshabilitados, emplaza `(SortOrderHint, índice)` por cada renderer
  habilitado (2466-2476), ordena `RendererSortInfo.Sort([](A, B) { return A.SortHint < B.SortHint; })` (2481) y copia los
  índices a `RendererDrawOrder` (2483-2487).
- `Source/Runtime/Core/Public/Containers/Array.h:3670-3674` `TArray::Sort` llama a `Algo::Sort`;
  `Source/Runtime/Core/Public/Algo/Sort.h:28-30` llama a `IntroSort`; `Algo/IntroSort.h:63-84`: con `Count <= 8` usa
  selección: `Max` empieza en `Min` y solo avanza cuando el predicado es estrictamente cierto; luego
  `Swap(*Max, *Current.Max--)`. Traza con tres claves iguales `[0, 1, 2]`: primera pasada intercambia 0 y 2 -> `[2, 1, 0]`;
  segunda intercambia 0 y 1 -> `[1, 2, 0]`. `RendererDrawOrder = [1, 2, 0]`: Flash, SimpleBurst, Flame.
- `Plugins/FX/Niagara/Source/Niagara/Private/NiagaraSystemRenderData.cpp:238-249` `GetDynamicMeshElements` itera
  `for (int32 RendererIdx : RendererDrawOrder)`; `EmitterRenderers_RT[RendererIdx]` se construye en orden de emisor
  (274-309), así que el índice es el del asset.
- `Plugins/FX/Niagara/Source/Niagara/Private/NiagaraRendererSprites.cpp:1075-1079` cada renderer añade su batch por vista
  con `Collector.AddMesh`; `Source/Runtime/Engine/Private/SceneManagement.cpp:666-667` asigna `MeshIdInPrimitive`
  incremental por vista en el orden de llamada.
- `Source/Runtime/Renderer/Public/MeshPassProcessor.h:1551-1556` clave de ordenación translúcida, de bits bajos a altos:
  `MeshIdInPrimitive` (16), `Distance` (32), `Priority` (16); `BasePassRendering.cpp:299-316` y
  `MeshDrawCommands.cpp:164-220` toman distancia y prioridad del primitivo (el componente entero), y
  `MeshDrawCommands.cpp:1149-1163` ordena ascendente. Dentro de un componente el orden es el del `MeshIdInPrimitive`,
  igual para toda cámara y paso.
- `NiagaraSpriteRendererProperties.h:191, 218, 241` (`SortMode`, `bSortOnlyWhenTranslucent`, `SortPrecision`) y
  `NiagaraRendererSprites.cpp:295, 1065, 1165`: ordenan partículas dentro de un emisor, nunca emisores entre sí.
- Las tres materias son `BLEND_Translucent`, `MSM_Unlit` (RENDER-SOURCES.md:85, RENDER.md:48-57): ninguna pareja conmuta,
  el orden cambia el píxel en cada solape.

## Premisas comprobadas en el asset exportado

`.scratch/unreal/basichit-source/NE_Flame_Basic_001.t3d`, `NE_Basic_Flash.t3d`, `NE_SimpleBurst.t3d`: un solo
`NiagaraSpriteRendererProperties_0` por emisor, ningún `SortOrderHint` exportado (el T3D omite los valores por defecto,
`NiagaraRendererProperties.h:476` `int32 SortOrderHint = 0`), ningún `bIsEnabled=False`. Ningún archivo de
`.scratch/unreal` menciona `SortOrderHint`. Orden de emisores del sistema: Flame, Flash, SimpleBurst (RENDER-SOURCES.md:24).

## Medición: los tres órdenes contra `basichit-reference05`

`DRAW_ORDERS` de `basichit-render.js` (renderOrder por capa Flame, Flash, SimpleBurst): `gate` `[0, 1, 2]`, `reverse`
`[2, 1, 0]`, `engine` `[2, 0, 1]`. `qa-basichit.mjs` guarda ahora 49 lienzos (16 nativos, 3 de transferencia, 15 inversos y
15 del motor) y `compare-basichit.py` añade las filas `engine` a `diagnostics`. Umbrales y referencia sin cambios
(`render-sources.json`, `reference-profiled-checkpoint.json`). IoU de máscara / MAE (/255) / canal máximo:

| caso | gate (Flame, Flash, SimpleBurst) | inverso (SimpleBurst, Flash, Flame) | motor (Flash, SimpleBurst, Flame) | mejor |
|---|---|---|---|---|
| `t0002_front` | 1,0000 / 0,796 / 100 | 1,0000 / 1,210 / 100 | 1,0000 / 0,349 / 100 | motor |
| `t0002_oblique` | 0,9977 / 1,015 / 165 | 0,9977 / 1,418 / 165 | 0,9977 / 0,596 / 165 | motor |
| `t0002_side` | 1,0000 / 0,476 / 25 | 1,0000 / 0,901 / 12 | 1,0000 / 0,074 / 11 | motor |
| `t0006_front` | 0,9983 / 1,401 / 85 | 0,9983 / 1,524 / 85 | 0,9983 / 1,058 / 85 | motor |
| `t0006_oblique` | 0,9978 / 1,428 / 98 | 0,9978 / 1,526 / 98 | 0,9978 / 1,080 / 98 | motor |
| `t0006_side` | 0,9984 / 1,355 / 107 | 0,9984 / 1,500 / 107 | 0,9984 / 1,041 / 107 | motor |
| `t0012_front` | 0,9963 / 1,436 / 86 | 0,9963 / 1,418 / 86 | 0,9963 / 1,348 / 86 | motor |
| `t0012_oblique` | 0,9967 / 1,497 / 86 | 0,9967 / 1,470 / 86 | 0,9967 / 1,410 / 86 | motor |
| `t0012_side` | 0,9966 / 1,480 / 85 | 0,9967 / 1,451 / 84 | 0,9967 / 1,388 / 84 | motor |
| `t0018_front` | 0,9852 / 1,741 / 86 | 0,9852 / 1,706 / 86 | 0,9852 / 1,706 / 86 | inverso = motor |
| `t0018_oblique` | 0,9828 / 1,784 / 73 | 0,9828 / 1,738 / 73 | 0,9828 / 1,738 / 73 | inverso = motor |
| `t0018_side` | 0,9853 / 1,766 / 90 | 0,9853 / 1,721 / 90 | 0,9853 / 1,721 / 90 | inverso = motor |
| `t0024_front` | 1,0000 / 0,066 / 2 | igual | igual | los tres |
| `t0024_oblique` | 1,0000 / 0,045 / 3 | igual | igual | los tres |
| `t0024_side` | 0,9991 / 0,054 / 2 | igual | igual | los tres |

En el paso 18 el destello ya no existe (1, 0, 147 partículas, RENDER.md:183), así que inverso y motor dibujan lo mismo
(ráfaga y luego llama); en el 24 solo queda la ráfaga. El diagnóstico de T-1021-46 (gate mejor en 2 y 6, inverso en 12
y 18, signo mixto) era lo esperable cuando el orden real es una tercera permutación.

## Qué queda establecido y qué no

- Establecido: el orden que calcula el motor para este asset y que ese orden reduce el error en todos los encuadres
  donde el orden importa. La IoU de máscara no cambia con el orden (misma unión de píxeles).
- No movido: el gate. Pasar `gate` a `[2, 0, 1]` es decisión del autor; implica regenerar `render-checkpoint.json`
  (fija el sha256 de `basichit-render.js` y de los lienzos nativos), las filas nativas de RENDER.md y la imagen de
  portada, con dos ejecuciones nuevas. Los umbrales no necesitan cambiar: el orden del motor ya pasa con margen.
- No leído: el orden real de Unreal con una sonda en vivo (`UNiagaraSystem::GetRendererDrawOrder` no es UPROPERTY; haría
  falta el módulo C++ de la sonda). La traza de IntroSort es manual, no ejecutada; vale solo para exactamente un renderer
  habilitado por emisor con hints iguales, que es el caso comprobado.
- Fuera de alcance: el orden de partículas dentro de un emisor (`SortMode`), que el laboratorio no modela.

## Evidencia

| archivo | sha256 |
|---|---|
| `.scratch/basichit-render/t1022-33-c/comparison.json` | `ffd36cdb7282a1c0ccc15372628f586177fc6986b32c570c04751a1697d7a5ec` |
| `.scratch/basichit-render/t1022-33-d/comparison.json` | `ffd36cdb7282a1c0ccc15372628f586177fc6986b32c570c04751a1697d7a5ec` |
| `.scratch/basichit-render/t1022-33-c/transfer-check.json` | `10d11365a17459368940336bdcbbd446f57940deec12262ff27d3e83befa153d` (igual que T-1021-46) |

`t1022-33-a` y `-b` son las primeras corridas: mismos 49 lienzos (49/49 contra `-c`) pero `qa-basichit.mjs` falló en la
comprobación de 390 px porque la etiqueta nueva del selector era demasiado larga; se acortó y se repitió. Tests del
laboratorio 63/63. Chrome 155, Playwright 1.64.1 de `visual-revamp`, servidor `serve.py`.

## Cómo reproducir

```bash
W="C:/DEV/real of trade/st01c-native"
PW="C:/DEV/real of trade/visual-revamp/node_modules/playwright/index.mjs"
python "$W/tools/niagara-native-lab/serve.py" --quiet &
node "$W/tools/niagara-native-lab/qa-basichit.mjs" "$PW" <ejecución-nueva>
python -B "$W/tools/niagara-native-lab/compare-basichit.py" "$W/.scratch/basichit-render/<ejecución-nueva>" --transfer-only
python -B "$W/tools/niagara-native-lab/compare-basichit.py" "$W/.scratch/basichit-render/<ejecución-nueva>"
```

Las filas `engine` están en `diagnostics` de `comparison.json` (`kind` "engine draw order Flash, SimpleBurst, Flame
(diagnostic)"); las `native` siguen siendo las del gate.
