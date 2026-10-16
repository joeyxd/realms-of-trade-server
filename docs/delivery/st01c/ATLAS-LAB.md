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
