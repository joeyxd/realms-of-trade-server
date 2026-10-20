# ST01c — atlas lossless y comparación de presupuesto

2026-10-14. **Descarga optimizada sin cambiar píxeles; memoria GPU móvil pendiente.**
[Laboratorio local](http://127.0.0.1:5197/tools/niagara-native-lab/budget.html),
[checkpoint](atlas-checkpoint.json), [ficha](effect-description.json).

El mismo MyProject `NS_Flame_Single` usa sus dos exportaciones exactas de `reference11`:
`T_FlameUV_2`, 2048×1024, grilla 8×4; `T_Smoke_1`, 2560×1536, grilla 10×6.
Ambos tienen celdas de 256 px, RGB sRGB y alfa A=255; el material usa **R como opacidad**
y RGB como emisión. No sustituirlos por una textura gris ni usar A como máscara.
El intake revisó las herramientas de palmeras/arbustos/balsa: sus recibos y derivados
son precedentes útiles, pero sus recortes/máscaras no corresponden a estos fotogramas.

## Construcción y ahorro

`atlas-build.py` comprueba SHA, dimensiones, layout y tipo antes de generar. La variante
completa conserva **todos** los bytes RGBA decodificados. Los dos candidatos reducidos
resamplean cada celda por separado con Lanczos en luz lineal y la repacan en su grilla;
WebP lossless conserva exactamente esos resultados. No hay cambio de UV, gutters ni
resample de vecinos. La generación de mipmaps conserva el comportamiento previo;
no se presenta como una solución general al bleeding entre celdas.

| Variante | Descarga del par | RGBA8 + mipmaps estimados | Gate visual |
| --- | ---: | ---: | --- |
| PNG original | 1.369.043 B | 30,67 MiB | Referencia |
| WebP completo, 256 px/celda | **552.514 B** | 30,67 MiB | **268/268 exactos** |
| WebP half, 128 px/celda | 210.828 B | 7,67 MiB | Descartado: 49/268 fallan |
| WebP quarter, 64 px/celda | 73.678 B | 1,92 MiB | Descartado: 230/268 fallan |

El resultado admitido reduce descarga **59,6423 %**. WebP cambia el contenedor de
transferencia; el navegador continúa subiendo RGBA8, así que no ahorra memoria GPU.
Los originales y derivados completos quedan en `.scratch`, fuera del bundle jugable.
El repo conserva manifiesto/receta, hashes, métricas y capturas, sin habilitar un efecto nuevo.

## Prueba de fidelidad y decisión

Los umbrales se escribieron en el brief antes de revisar candidatos: lossless completo
pixel exacto; reducidos con IoU ≥0,98, MAE ≤2/255 y P95 ≤6/255 en unión visible.
Además se conserva el gate anterior contra FinalColorLDR UE: IoU ≥0,94 / MAE ≤10/255.

- Cada run produce **268 casos por variante**: diez tiempos de 0 a 8 s, tres cámaras,
  0/+1 EV, capas separadas, pared/suelo y los 32+60 fotogramas aislados en ambas exposiciones.
  El diagnóstico de celdas usa tint blanco y tamaño 153,806 cm; se compara con la textura
  original en nuestro renderer, no se presenta como otra captura de emisores Unreal.
- `budget01`/`budget02`: **2.144 renders**, 1.072 pares de repetición RGBA decodificados
  idénticos. WebP completo coincide exactamente con el PNG original en todos los casos.
  Mantiene las seis comparaciones con UE a 2 s; MAE máximo **7,837088/255**, IoU mínimo
  **0,980176**, como el corte anterior. No vuelve equivalentes por píxel ambos motores.
- Half: MAE máximo 0,881786/255, P95 máximo 3/255, pero IoU mínimo **0,733333**.
  Fallan 48 diagnósticos de celda y una vista de humo solo. Quarter: MAE máximo
  6,402761/255, P95 máximo 20/255, IoU mínimo 0. Cambian contornos tenues y detalle;
  no relajar el gate porque el efecto completo a 2 s todavía pase contra UE.
- Revisión visual: [escritorio](atlas-desktop.png), [390 px](atlas-mobile.png),
  [original/full/half/quarter](atlas-comparison.png). El completo mantiene detalle;
  las diferencias de humo pueden ser pequeñas a simple vista y siguen diagnosticadas.

La selección automática privada conserva **full en escritorio y coarse pointer**.
Los tamaños menores se rotulan diagnóstico y nunca se seleccionan como optimización
admitida. La UI muestra que el presupuesto móvil sigue pendiente. No hay una variante
aceptada que cumpla el objetivo de 8 MiB: esta entrega cierra transferencia, no ese gate.

## Carga, coste y regresión

Cada vista carga solo su par; se verifican URL, SHA, bytes recibidos y dimensiones reales.
El manifiesto está fijado por hash UTF-8/LF, y el verificador liga receta, tool y ocho
imágenes a sus hashes. Un tamaño no soportado rechaza la selección, sin bajar calidad
silenciosamente. Cambiar de atlas recarga la escena y libera el anterior.

A 2 s: 22 partículas, 46 triángulos, **3 draw calls** sin superficie. LUT 256 KiB;
targets HDR/profundidad/escena opaca **5 MiB estimados** adicionales. No se cargan ocho
raw HDR de diagnóstico ni capturas como entradas. El área proyectada de quads es 2,1506
veces la pantalla antes de clipping: proxy de trabajo, **no overdraw medido**.
La asignación real del driver, canvas y buffers tiene costes adicionales.

Chrome/ANGLE D3D11, Intel Iris Xe, WebGL2: las consultas GPU no disjoint y tiempos de
submit/CPU quedan registrados como diagnóstico local. Cada consulta GPU mide un frame;
CPU individual puede quedar bajo la resolución del reloj. No convertirlos en FPS de
teléfono, límite de rendimiento sostenido ni garantía para otra GPU.

**17/17 Node + 5/5 Python**, rebuild byte idéntico y verificación de hashes. QA comprueba
play/pausa/reset, parámetros inválidos, layout a 390 px, selección automática de puntero,
solo GET local/Blob, cero errores normales y cero estados grabados como entradas.
Dispose doble y fallos de inicio (textura corrupta y excepción tras subir GPU) dejan
geometrías/texturas en cero. **51 originales + 51 copias** conservan sus hashes.

## Aprendizaje reutilizado y siguiente corte

`resize_frame_linear`, `build_atlas` y el cálculo entero de mipmaps quedan como funciones
con fixtures de luz lineal, separación de celdas y RGB oculto/alpha. Spec/recibo/versiones,
verificación, corpus y comparación son repetibles. El intake y el loader siguen acotados
al piloto; esto no implementa aún el registro general de ejecución Niagara.

Sigue un experimento de **compresión GPU a resolución completa**, con el mismo corpus
y gate R-opacidad/color. La inspección del stack local encuentra DDS/DXT1 en Pillow y
Three, pero el writer produce solo base mip y exige ensamblar la cadena; además hay que
comprobar la extensión sRGB. Three tiene transcoder KTX2/Basis y selección de formatos
por capacidad, pero aquí no está instalado el encoder. Ninguna ruta está aceptada:
DXT es lossy y puede fallar precisamente en R/contornos tenues. Primero verificar un
derivado y su formato realmente subido; después presupuesto físico y admisión al taller.
No abrir otra familia ni marcar ST01c completo mientras ese contrato siga pendiente.

## Reproducir

Con los exports fuente del probe previo y localhost 5197:

```powershell
python -B tools/niagara-native-lab/atlas-build.py
python -B tools/niagara-native-lab/atlas-build.py --check
python -B tools/niagara-native-lab/atlas_build_test.py
node tools/niagara-native-lab/verify-atlas.mjs
node --test tools/niagara-native-lab/atlas-policy.test.mjs tools/niagara-native-lab/lab.test.mjs tools/niagara-native-lab/update-simulation.test.mjs tools/niagara-native-lab/native-simulation.test.mjs tools/niagara-native-lab/depth-stage.test.mjs tools/niagara-native-lab/film-color.test.mjs
node tools/niagara-native-lab/qa-atlas.mjs 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs' budget01
node tools/niagara-native-lab/qa-atlas.mjs 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs' budget02
python -B tools/niagara-native-lab/compare-atlas.py budget01
python -B tools/niagara-native-lab/compare-atlas.py budget02
python -B tools/niagara-native-lab/check-atlas-repeat.py budget01 budget02
```

## Compresión GPU a resolución completa (KTX2 UASTC)

2026-10-19. **Medido: la variante `ktx2-uastc` sube BC7 a 7,67 MiB, pero NO pasa el gate de
fidelidad (37/268 fallan, todos por IoU de máscara).** Números en
[atlas-gpu-checkpoint.json](atlas-gpu-checkpoint.json). `MOBILE_MEMORY_ACCEPTED` sigue en
`false` a la espera de la decisión del autor; este corte no la cambia ni cambia la selección
automática (`full`/`full`). Es laboratorio: no toca el juego, el catálogo ni registra efectos.

**Encoder.** KTX-Software `toktx v4.4.2` (instalación portable fuera de git; se elige con
`atlas-build.py --toktx <ruta>`). Línea exacta por atlas, también guardada en el manifiesto:

```text
toktx --t2 --encode uastc --uastc_quality 4 --zcmp 3 --genmipmap --lower_left_maps_to_s0t0 --assign_oetf srgb --assign_primaries srgb ktx2-uastc-flame.ktx2 .scratch/unreal/reference11/textures/T_FlameUV_2.png
```

El humo usa las mismas opciones con `ktx2-uastc-smoke.ktx2` y `T_Smoke_1.png`. Resolución
completa (sin escalado), UASTC calidad 4, cadena de mips de 12 niveles dentro del archivo
(filtro por defecto de toktx), transferencia sRGB y primarias BT.709 declaradas, Zstandard
nivel 3, sin RDO. `--lower_left_maps_to_s0t0` voltea el origen porque Three sube las texturas
comprimidas sin `flipY`; el render confirma la orientación. El número de hilos queda en el
valor por defecto: dos codificaciones consecutivas y la regeneración de `--check` producen
**bytes idénticos**, así que `--check` sigue comparando byte a byte (no hizo falta
comparar metadatos ni imágenes decodificadas). `verify-atlas.mjs` ahora también lee la
cabecera KTX2, el índice de niveles y el DFD (UASTC, BT.709, sRGB, Zstandard).
El manifiesto de `.scratch/atlas-build/v1` solo crece (las filas previas se conservan
idénticas); los seis WebP no cambian y su hash fijado sigue verificándose.

| Archivo | PNG original | WebP sin pérdida | KTX2 UASTC |
| --- | ---: | ---: | ---: |
| Llama 2048×1024 | 654.386 B | 277.976 B | 688.923 B |
| Humo 2560×1536 | 714.657 B | 274.538 B | 705.900 B |
| **Par** | 1.369.043 B | **552.514 B** | 1.394.823 B |

UASTC comprimido con Zstandard descarga **más** que el PNG (+1,9 %) y 2,5 veces el WebP:
su ventaja es memoria GPU, no transferencia.

**Navegador.** El mismo lanzamiento de siempre (Chrome 155.0.8059.85 instalado,
`headless: true`, `channel: 'chrome'`, ANGLE D3D11, Intel Iris Xe) ya expone
`EXT_texture_compression_bptc` y `WEBGL_compressed_texture_s3tc`, y no expone
`WEBGL_compressed_texture_astc` ni `_etc`. No hizo falta otro lanzamiento. `KTX2Loader`
(Three 0.160.0, transcodificador local en `node_modules`) elige BC7 y entrega
`texture.colorSpace = SRGBColorSpace` desde el propio archivo. En una GPU solo ASTC o ETC2
el mismo UASTC se transcodificaría a 8 bpp igualmente (cuenta calculada, no medida aquí).

| Variante | Formato subido | bpp | Bytes GPU (suma de mips) | MiB | Niveles |
| --- | --- | ---: | ---: | ---: | --- |
| `full` (WebP) | `RGBAFormat` | 32 | 32.156.324 | 30,67 | 12 / 12 |
| `ktx2-uastc` | `RGBA_BPTC_Format` | 8 | 8.039.200 | **7,67** | 12 / 12 |

Los bytes de KTX2 coinciden exactamente con los de los datos que `KTX2Loader` entrega
(`uploadedBytes`: 2.796.240 + 5.242.960). 7,67 MiB queda 349.408 B por debajo de 8 MiB
(8.388.608 B). Solo cuentan los atlas: la LUT (256 KiB) y los targets (5 MiB estimados)
son aparte, como en el resto del documento. La UI muestra el formato y los MiB medidos
junto a la línea de presupuesto móvil pendiente.

**Gate, mismo corpus de 268 casos y mismos umbrales** (`budget03`, repetido en `budget04`
con resultados idénticos):

| Variante | Aceptada | Fallos | Peor caso |
| --- | --- | ---: | --- |
| `full` | sí | 0/268 | MAE 0, IoU 1 |
| `half` (referencia) | no | 49 | IoU mínimo 0,733333 |
| `quarter` (referencia) | no | 230 | IoU mínimo 0 |
| `ktx2-uastc` | **no** | **37/268** (+0/6 contra UE) | IoU mínimo **0,852941** (humo, celda 12, frontal, 0 EV) |

Para `ktx2-uastc`: MAE máximo 0,664794/255 (llama, celda 17, frontal, +1 EV) y P95 máximo
3/255, ambos dentro del umbral; fallan 36 diagnósticos de celda de humo (de 120) y una vista
de humo solo, siempre por `maskIoU32 < 0,98`, es decir, por pixeles de contorno tenue cerca
del corte de 32/255. Los 10 tiempos del efecto completo, las capas de llama, pared y suelo
pasan, y las seis comparaciones con UE a 2 s pasan (MAE máximo 7,854/255, IoU mínimo
0,981838). No se construyó `ktx2-uastc-rdo`: la variante sin RDO no pasó el gate, y RDO
solo añadiría error. Este resultado no separa el error del códec del de la cadena de mips
(toktx filtra los mips; el camino WebP usa los mips que genera el driver).

Repetición: `check-atlas-repeat.py budget03 budget04` compara 1.340 imágenes (5 variantes
x 268), todas con píxeles decodificados idénticos; `budget01` frente a `budget03` con
`--variants source,full,half,quarter` compara las 1.072 de siempre, idénticas. Las
estadísticas de las variantes previas (0, 49 y 230 fallos) son las de `budget01`.

Falla de carga: además del WebP corrupto, el humo `.ktx2` con cuerpo inválido es rechazado
por el control de hash (`corrupt-ktx2`), y un cuerpo del tamaño correcto con ese control
omitido en la copia servida de la página llega a `KTX2Loader`, que lo rechaza con
`Missing KTX 2.0 identifier` (`corrupt-ktx2-loader`). En ambos casos el error se informa y
texturas y geometrías quedan en cero.

**`MOBILE_MEMORY_ACCEPTED` sigue en `false`, pendiente de la decisión del autor** de si
7,67 MiB con 37 fallos de IoU en diagnósticos de humo cumple el objetivo móvil.

```powershell
python -B tools/niagara-native-lab/atlas-build.py --toktx "C:/DEV/real of trade/realms-of-trade-server/.scratch/tools/ktx-4.4.2/bin/toktx.exe"
node tools/niagara-native-lab/qa-atlas.mjs 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs' budget03
node tools/niagara-native-lab/qa-atlas.mjs 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs' budget04
python -B tools/niagara-native-lab/compare-atlas.py budget03
python -B tools/niagara-native-lab/compare-atlas.py budget04
python -B tools/niagara-native-lab/check-atlas-repeat.py budget03 budget04
python -B tools/niagara-native-lab/check-atlas-repeat.py budget01 budget03 --variants source,full,half,quarter
```

## Cadena de mips frente a códec (descomposición 2x2)

2026-10-20. La etapa anterior midió `ktx2-uastc` con 37/268 fallos de IoU de máscara, pero
sus mips los genera `toktx` (filtro por defecto `lanczos4`) mientras que la ruta WebP (`full`)
usa los mips que genera el driver. Aquí se separan ambos factores con tres variantes
**diagnósticas** nuevas, mismo corpus de 268 casos, mismos umbrales y misma lógica de
comparación. Ninguna entra en la selección automática (sigue `full`/`full`). Es laboratorio:
no toca el juego ni el catálogo. Números en
[atlas-mip-checkpoint.json](atlas-mip-checkpoint.json); corridas `budget07` y `budget08`.

**Las cuatro líneas de `toktx` v4.4.2** (por atlas; la de la llama, la del humo cambia solo
los nombres de archivo y `T_Smoke_1.png`). Las cuatro quedan guardadas en el manifiesto:

```text
ktx2-uastc      toktx --t2 --encode uastc --uastc_quality 4 --zcmp 3 --genmipmap --lower_left_maps_to_s0t0 --assign_oetf srgb --assign_primaries srgb ktx2-uastc-flame.ktx2 .scratch/unreal/reference11/textures/T_FlameUV_2.png
ktx2-uastc-box  toktx --t2 --encode uastc --uastc_quality 4 --zcmp 3 --genmipmap --lower_left_maps_to_s0t0 --assign_oetf srgb --assign_primaries srgb --filter box ktx2-uastc-box-flame.ktx2 .scratch/unreal/reference11/textures/T_FlameUV_2.png
ktx2-rgba8      toktx --t2 --zcmp 3 --genmipmap --lower_left_maps_to_s0t0 --assign_oetf srgb --assign_primaries srgb ktx2-rgba8-flame.ktx2 .scratch/unreal/reference11/textures/T_FlameUV_2.png
ktx2-rgba8-box  toktx --t2 --zcmp 3 --genmipmap --lower_left_maps_to_s0t0 --assign_oetf srgb --assign_primaries srgb --filter box ktx2-rgba8-box-flame.ktx2 .scratch/unreal/reference11/textures/T_FlameUV_2.png
```

`ktx2-uastc` conserva su línea byte a byte (sus dos archivos y las seis WebP no cambian; el
manifiesto solo crece y las filas previas quedan idénticas). Los RGBA8 son
`VK_FORMAT_R8G8B8A8_SRGB` con transferencia sRGB y BT.709; se conservó `--zcmp 3` porque
`KTX2Loader` de Three 0.160.0 descomprime Zstandard también para formatos sin comprimir
(`createRawTexture`), y la carga en Chrome lo confirmó. Dos codificaciones consecutivas de
cada línea son idénticas byte a byte (`atlas-build.py --check` regenera y compara).
Las tres variantes se declaran en `atlas-build.py` (`DIAGNOSTIC_VARIANTS`); `atlas-source.json`
no cambia.

**Tabla 2x2: fallos sobre 268 casos (IoU mínimo de máscara contra la referencia).**

| Mips en el archivo | RGBA8, sin códec | UASTC (calidad 4, zstd 3) |
| --- | --- | --- |
| `toktx` `lanczos4` (por defecto) | `ktx2-rgba8`: **31/268** (0,852941) | `ktx2-uastc`: **37/268** (0,852941) |
| `toktx` `--filter box` | `ktx2-rgba8-box`: **43/268** (0,852941) | `ktx2-uastc-box`: **47/268** (0,852941) |

Referencia de mips del driver: `full` (WebP sin pérdida) 0/268, IoU mínimo 1. Todas las
variantes pasan las 6 comparaciones contra UE (6/6; MAE máximo 7,836 `ktx2-rgba8`, 7,796
`ktx2-rgba8-box`, 7,854 `ktx2-uastc`, 7,807 `ktx2-uastc-box`; umbral 10). El IoU mínimo de
las cuatro variantes es el mismo caso: humo, celda 12, frontal, 0 EV (`case-172`).

| Variante | MAE máx. /255 | P95 máx. /255 | Fallos (todos por `maskIoU32 < 0,98`) |
| --- | ---: | ---: | --- |
| `full` | 0 | 0 | 0 |
| `ktx2-rgba8` | 0,351413 (piloto, tick 30, frontal, 0 EV) | 2 | 31: 30 celdas de humo + 1 capa de humo |
| `ktx2-rgba8-box` | 0,200032 (capa humo, oblicua, +1 EV) | 1 | 43: 41 celdas de humo + 1 capa de humo + 1 piloto |
| `ktx2-uastc` | 0,664794 (celda llama 17, frontal, +1 EV) | 3 | 37: 36 celdas de humo + 1 capa de humo |
| `ktx2-uastc-box` | 0,653966 (piloto, tick 30, frontal, 0 EV) | 3 | 47: 46 celdas de humo + 1 capa de humo |

**Formato subido y memoria (medidos en la página, Chrome 155.0.8059.85, ANGLE D3D11, Intel
Iris Xe).** Todas las variantes KTX2 suben su propia cadena de mips desde el archivo
(`mipSource: file`, `generateMipmaps: false`, 12 / 12 niveles); el driver no la regenera. El
formato interno WebGL se nombra según las reglas de Three r160 (`getInternalFormat`), no se
consulta al driver porque la página no lo expone.

| Variante | Formato Three | Formato interno (derivado) | Color | bpp | Bytes GPU | MiB | Niveles | Archivos (par) |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| `full` (WebP) | `RGBAFormat` | `SRGB8_ALPHA8` | sRGB | 32 | 32.156.324 | 30,67 | 12 / 12 (driver) | 552.514 B |
| `ktx2-rgba8` | `RGBAFormat` | `SRGB8_ALPHA8` | sRGB | 32 | 32.156.324 | 30,67 | 12 / 12 | 2.103.237 B |
| `ktx2-rgba8-box` | `RGBAFormat` | `SRGB8_ALPHA8` | sRGB | 32 | 32.156.324 | 30,67 | 12 / 12 | 2.060.528 B |
| `ktx2-uastc` | `RGBA_BPTC_Format` | `COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT` | sRGB | 8 | 8.039.200 | 7,67 | 12 / 12 | 1.394.823 B |
| `ktx2-uastc-box` | `RGBA_BPTC_Format` | `COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT` | sRGB | 8 | 8.039.200 | 7,67 | 12 / 12 | 1.381.358 B |

Los bytes de los datos entregados por `KTX2Loader` (`uploadedBytes`) coinciden con los
bytes GPU calculados en las cinco variantes. `KTX2Loader` devuelve el RGBA8 sin comprimir
como `DataTexture` con filtros `Nearest`; la página le fija `LinearMipmapLinear` /
`Linear`, como en las otras rutas (la cadena subida sigue siendo la del archivo).

**Repetición.** `check-atlas-repeat.py budget07 budget08` compara 2.144 imágenes (8
variantes x 268), todas con píxeles decodificados idénticos. `check-atlas-repeat.py
budget03 budget07 --variants source,full,half,quarter,ktx2-uastc` compara 1.340 imágenes
(5 x 268), todas idénticas: las variantes anteriores se renderizan igual que en `budget03`
(0, 49, 230 y 37 fallos). Una corrida de `qa-atlas.mjs` tarda unos 58 s.

**Lectura** (solo estas reglas acordadas, aplicadas a los números medidos):

- Efecto de los mips con `lanczos4` = `ktx2-rgba8` frente a `full`: 31/268 frente a 0/268;
  IoU mínimo 0,852941 frente a 1; MAE máximo 0,351413/255 frente a 0.
- Efecto de los mips con `box` = `ktx2-rgba8-box` frente a `full`: 43/268 frente a 0/268.
  Contra la referencia: MAE máximo 0,200032/255 e IoU mínimo 0,852941 (cuánto se acercan los
  mips `box` de `toktx` a los del driver).
- Efecto del códec con `lanczos4` = `ktx2-uastc` frente a `ktx2-rgba8`: 37/268 frente a
  31/268 (+6); MAE máximo 0,664794 frente a 0,351413; IoU mínimo igual (0,852941).
- Efecto del códec con `box` = `ktx2-uastc-box` frente a `ktx2-rgba8-box`: 47/268 frente a
  43/268 (+4); MAE máximo 0,653966 frente a 0,200032; IoU mínimo igual (0,852941).
- Ninguna de las variantes nuevas tiene 0/268; por tanto no se escribe "pasa el gate" para
  ninguna.

**Lo que NO está aceptado.** `MOBILE_MEMORY_ACCEPTED` sigue en `false`. Ninguna variante
(`ktx2-uastc`, `ktx2-uastc-box`, `ktx2-rgba8`, `ktx2-rgba8-box`) está aceptada. El formato
GPU, el presupuesto de 8 MiB (atlases solos o con LUT y targets), la deriva de silueta en
contornos tenues y ASTC/ETC2 (sin medir: este Chrome no los expone) quedan para la decisión
del autor.

```powershell
python -B tools/niagara-native-lab/atlas-build.py --toktx "C:/DEV/real of trade/realms-of-trade-server/.scratch/tools/ktx-4.4.2/bin/toktx.exe"
python -B tools/niagara-native-lab/atlas-build.py --check
node tools/niagara-native-lab/verify-atlas.mjs
node tools/niagara-native-lab/qa-atlas.mjs 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs' budget07
node tools/niagara-native-lab/qa-atlas.mjs 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs' budget08
python -B tools/niagara-native-lab/compare-atlas.py budget07
python -B tools/niagara-native-lab/compare-atlas.py budget08
python -B tools/niagara-native-lab/check-atlas-repeat.py budget07 budget08
python -B tools/niagara-native-lab/check-atlas-repeat.py budget03 budget07 --variants source,full,half,quarter,ktx2-uastc
```

## Decisión del autor (2026-10-20)

El autor decidió que KTX2 UASTC (`ktx2-uastc`) sea la textura automática en escritorio y en
móvil. Esta sección solo registra esa decisión; no reescribe ninguna regla ni checkpoint
anterior (`thresholdsBeforeReview` y las métricas no cambian, y `ktx2-uastc` sigue sin pasar
el gate antiguo: `accepted: false`).

**Lo que SÍ está aceptado.**

- **D1, deriva de silueta.** `ktx2-uastc` se acepta con la deriva medida en `budget07` frente
  a la línea base `source`: exactamente sus 37 casos fallidos (36 celdas aisladas de humo +
  1 vista de capa de humo), cada uno con `max255 <= 3`, y `ueFailures == 0`. Motivo: en la
  línea base los casos que fallan tienen picos de 33-52/255 (celdas 33-47, vista de capa 52)
  y el corte de silueta está en 32, de modo que entre 2 y 26 píxeles por celda (56 en la
  vista de capa) cruzan el corte y rompen el IoU mientras el cambio por píxel es de 1-3
  niveles. La distancia a Unreal apenas cambia (sesgo frontal 0, MAE: `full` 6,912,
  `ktx2-uastc` 6,913) y las seis comparaciones con Unreal pasan. El autor juzgó la deriva
  invisible en juego.
- **D2, presupuesto móvil.** Los 8 MiB (8.388.608 B) cuentan los bytes GPU de los atlases más
  la LUT (262.144 B). Los render targets (unos 5 MiB estimados) son coste compartido del
  renderer y quedan fuera. `ktx2-uastc`: 8.039.200 + 262.144 = 8.301.344 B, margen 87.264 B.
  `full` (32.156.324 B de GPU) no cabe.
- **D3, selección.** `AUTOMATIC_VARIANTS = { desktop: 'ktx2-uastc', mobile: 'ktx2-uastc' }` y
  `MOBILE_MEMORY_ACCEPTED = true` en `atlas-policy.js`. `mobileBudget(manifest, variant,
  lutBytes)` calcula `{limitBytes, atlasGpuBytes, lutBytes, totalBytes, within}`.

**Lo que NO está aceptado.**

- `ktx2-uastc-box`, `ktx2-rgba8`, `ktx2-rgba8-box`, `half` y `quarter`. `ktx2-rgba8` y los
  `-box` siguen siendo solo diagnóstico y nunca son automáticos.
- ASTC/ETC2 y los FPS en un teléfono real siguen sin medir (este Chrome no expone ASTC/ETC2;
  la medición de GPU es de un Intel Iris Xe con BPTC).
- Los render targets quedan fuera de este presupuesto; su coste no se ha aceptado aquí.

**Cómo funciona la guarda de deriva fijada.** `atlas-drift-acceptance.json`
(`st01c-atlas-drift-acceptance/v1`) guarda la variante, la corrida de referencia, la línea
base, `maxFailingMax255: 3`, `ueFailuresAllowed: 0` y la lista ordenada de los 37 archivos
fallidos aceptados. `compare-atlas.py` añade a la entrada de esa variante `driftAccepted` y
`unexpectedFailures`: es un fallo inesperado cualquier caso fallido fuera de la lista, con
`max255 > 3`, o cualquier fallo de Unreal. Cualquier deriva nueva deja `driftAccepted: false`.
Las demás variantes no reciben claves nuevas y los valores ya existentes no cambian.

**Corridas.** `budget13` y `budget14` (mismo código, mismo Chrome) con el automático ya en
`ktx2-uastc`: `qa-atlas.mjs` sale con código 0 en ambas; en escritorio y móvil la variante
automática es `ktx2-uastc`, `mobileMemoryAccepted` es `true` y el presupuesto queda dentro.
`compare-atlas.py` en `budget07`, `budget08`, `budget13` y `budget14` da fallos
full 0, half 49, quarter 230, ktx2-uastc 37, ktx2-uastc-box 47, ktx2-rgba8 31,
ktx2-rgba8-box 43, y para `ktx2-uastc` `driftAccepted: true` y `unexpectedFailures: []`.
`check-atlas-repeat.py` (`budget07` con `budget13`, y `budget13` con `budget14`): 2144
imágenes, todos los píxeles decodificados idénticos. La prueba de fallo `corrupt-texture` de
`qa-atlas.mjs` ahora abre `?variant=full`, porque la página por defecto ya carga KTX2.

```powershell
node --test tools/niagara-native-lab/*.test.mjs
python -B tools/niagara-native-lab/atlas_build_test.py
python -B tools/niagara-native-lab/atlas-build.py --check
node tools/niagara-native-lab/verify-atlas.mjs
node tools/niagara-native-lab/qa-atlas.mjs 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs' budget13
node tools/niagara-native-lab/qa-atlas.mjs 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs' budget14
python -B tools/niagara-native-lab/compare-atlas.py budget13
python -B tools/niagara-native-lab/compare-atlas.py budget14
python -B tools/niagara-native-lab/check-atlas-repeat.py budget07 budget13
python -B tools/niagara-native-lab/check-atlas-repeat.py budget13 budget14
```
