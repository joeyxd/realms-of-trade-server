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
