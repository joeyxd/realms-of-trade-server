# NS_BasicHit: referencia Unreal con el perfil de color controlado

Recaptura de `NS_BasicHit` (UE 5.8.0-55116800+++UE5+Release-5.8, proyecto aislado `.scratch/unreal/ST01c_Pilot.uproject`) bajo el perfil SDR
controlado del laboratorio de color del piloto (`controlled-sdr/v1`, el de `capture_color.py` y [COLOR-LAB.md](../COLOR-LAB.md)), con un HDR
crudo RGBA16F junto a cada imagen LDR (T-1022-10). Mismo sistema (SHA-256 de la fuente `97a82bae…18cf`), mismo spec
`tools/unreal-niagara-probe/systems/ns-basichit.json` (SHA-256 `955ab039…36f3` tal como está en disco, con CRLF; texto con LF `5e9c4cf4…327a`),
misma ventana, semillas, cámaras y encuadre que [REFERENCE.md](REFERENCE.md). La auditoría legible por máquina es
[reference-profiled-checkpoint.json](reference-profiled-checkpoint.json); `python tools/unreal-niagara-probe/check_profiled_checkpoint.py` la
reverifica entera. `basichit-reference03`/`04` y su [checkpoint](reference-checkpoint.json) no cambian y siguen siendo la referencia de las
compuertas de simulación. Las carpetas de ejecución están en `.scratch/unreal` (fuera de git) y el checkpoint las fija por hash.

## Por qué
La atadura de render (T-1021-46) se detuvo en la precondición de transferencia: el HDR de Unreal (RGBE `.hdr` del paso 12) pasado por el Filmic del
laboratorio contra el `FinalColorLDR` del mismo paso daba MAE 24,77/25,26/25,16 y P95 71 (front/oblique/side). La exploración T-1022-07 encontró la
causa: `capture_reference.py` captura sin el perfil controlado de `capture_color.py` (cvars, `target_gamma` 2,2 del RT LDR, estado de vista
persistente, AntiAliasing apagado, Filmic y grading neutros, volúmenes de postproceso del mundo apagados, capturas de calentamiento y HDR crudo).
Con ese perfil el piloto ya pasaba la transferencia (MAE máximo 0,042/255, P95 0; COLOR-LAB.md).

## Herramientas
- `tools/unreal-niagara-probe/capture_profile.py`: el perfil como funciones importables, copiadas de `capture_color.py`; cada pieza nombra su
  rango de origen: cvars `:166-173`, volúmenes `:161-164`, render targets `:186-190` (con el tamaño del spec en vez de 512), captura de un
  disparo, estado persistente y show flags `:195-202`, `profile()` `:67-102` (cuerpo sin cambios), calentamiento `:120-124`, empaquetado RGBA16F
  `:131-141` (por filas en vez de por píxel; mismos bytes). `capture_color.py` no cambia ni importa este módulo.
- `tools/unreal-niagara-probe/capture_reference_profiled.py`: el driver. Usa `capture_reference.py` como biblioteca (como
  `capture_color.py:13-14`): su `run()` carga el spec con `load_capture_spec`, aplica las mismas negativas (proyecto aislado, nombre fresco bajo
  `.scratch/unreal`, `-SystemSpec` obligatorio), configura las semillas, exporta las texturas, avanza la simulación y lee las partículas sin
  cambios. El driver solo aplica el perfil en el primer fotograma de espera de `run()`, antes de activar el efecto, y sustituye su captura por pose
  (`_capture_pose`, `capture_reference.py:178-226`); de ella copia solo la colocación de la cámara (`:179-188`), la compuerta de fotograma en
  blanco (`:196-201`, mismo mensaje) y las claves de fila (`:218-226`). No hay copia del bucle de simulación.
- `tools/unreal-niagara-probe/capture_profile_test.py`: analiza `capture_color.py` (ast) y falla si una constante copiada, el bucle de
  calentamiento, los bucles de cvars y volúmenes o el cuerpo de `profile()` se separan del original; prueba el empaquetador contra el de
  `capture_color.py:134-136` y las funciones con un `unreal` simulado.
- `tools/unreal-niagara-probe/build_profiled_checkpoint.py` y `check_profiled_checkpoint.py`: usan como bibliotecas
  `compare_reference_runs.py`, `build_reference_checkpoint.py` y `check_reference_checkpoint.py`, sin editarlos.
- `tools/niagara-native-lab/transfer-basichit.mjs`: la transferencia fuera del navegador (ver Transferencia).

## Comandos
Wrapper local (fuera de git) `.scratch/unreal/Content/Python/test_st01c_reference_profiled.py`:

```python
import runpy
runpy.run_path('C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/capture_reference_profiled.py')
```

Cada ejecución de Unreal (PowerShell, en primer plano, una instancia a la vez; consola en `.scratch/unreal/<nombre>-console.log`; tiempo de pared
con `Stopwatch` alrededor del comando):

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -d3d11 -RenderOffscreen -unattended -nop4 -nosplash -nosound '-ExecCmds=Automation RunTests Editor.Python.ST01c_Pilot.test_st01c_reference_profiled' '-TestExit=Automation Test Queue Empty' -CaptureRun=<nombre> '-SystemSpec=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-basichit.json'
```

Ejecuciones de Unreal, en orden (2; ningún intento fallido, ningún fotograma en blanco):
1. `basichit-reference05` (100,9 s de pared, 40,9 s dentro del test; final): complete, 15 imágenes más la base, 16 HDR crudos, 241 estados.
2. `basichit-reference06` (102,7 s de pared, 74,1 s dentro del test; final): complete, igual que la anterior.

Antes de Unreal, el driver se ejecutó en seco con un módulo `unreal` simulado, en una copia del árbol de herramientas en el directorio temporal
(sin tocar `.scratch/unreal`): 128 capturas, informe completo, y la negativa de un nombre usado sin escribir `capture-error.txt` en esa carpeta.
El driver sube el límite de los comandos latentes del plugin de 300 a 540 s (`PythonAutomationTest.cpp:19`); ninguna ejecución se acercó.

Después de la última ejecución (desde la raíz del worktree):
1. `python -B tools/unreal-niagara-probe/compare_reference_runs.py --spec tools/unreal-niagara-probe/systems/ns-basichit.json --a .scratch/unreal/basichit-reference05 --b .scratch/unreal/basichit-reference06`
2. `python -B tools/unreal-niagara-probe/build_profiled_checkpoint.py --spec tools/unreal-niagara-probe/systems/ns-basichit.json --a .scratch/unreal/basichit-reference05 --b .scratch/unreal/basichit-reference06 --base .scratch/unreal/basichit-reference03 --out docs/delivery/st01c/basichit/reference-profiled-checkpoint.json`
3. `python -B tools/unreal-niagara-probe/check_profiled_checkpoint.py`
4. `node tools/niagara-native-lab/transfer-basichit.mjs --run basichit-reference03` (calibración) y `--run basichit-reference05`

## Perfil leído de vuelta
Lo que Unreal devuelve tras aplicarlo (`capture_profile` en `capture-report.json`, igual en las dos ejecuciones y fijado en el checkpoint):
- cvars (pedido = leído): `r.EyeAdaptation.PreExposureOverride` 1, `r.TonemapperGamma` 0, `r.Tonemapper.Sharpen` 0, `r.LUT.Size` 32,
  `r.LUT.Shaper` 0, `r.LUT.TonemappingMethod` 0, `r.LUT.TonemappingSDRInvEOTF` 0, `r.BackbufferQuantizationDitheringOverride` 32.
- Render targets 1024x1024: LDR `RTF_RGBA8` con `target_gamma` 2,2 (leído 2,200000047683716, el float32 de 2,2); HDR `RTF_RGBA16F`
  (`target_gamma` 0). Estado de vista persistente activo; peso de mezcla de postproceso 1.
- Show flags apagados: Atmosphere, Fog, VolumetricFog, Cloud, DeferredAtmospherePass, SkyLighting, MotionBlur, Vignette y AntiAliasing.
- Postproceso: exposición manual (`AEM_MANUAL`) a 0 EV, exposición física de cámara apagada; bloom, viñeta, grano, fringe e intensidad de
  grading 0; balance de blancos 6500 K y tinte 0; Filmic `FILMIC` con slope 0,88, toe 0,55, shoulder 0,26, black clip 0, white clip 0,04,
  blue correction 0,6, expand gamut 1, tone curve 1 (leídos como float32); grading neutro (saturación, contraste, gamma y ganancia 1, offset 0, en
  los cuatro grupos); tinte de escena blanco; sin LUT externa.
- Volúmenes de postproceso del mundo: ninguno en el nivel del editor (lista vacía).

## Archivos de una ejecución
281 archivos, todos fijados por SHA-256 en el checkpoint para las dos ejecuciones: 16 PNG `frames/tNNNN_<cámara>.png` (pasos 2, 6, 12, 18 y 24 por
tres cámaras, más la base del paso 0 con `front`), 16 HDR crudos `frames/tNNNN_<cámara>_hdr.rgba16f` (8.388.608 bytes cada uno: RGBA float16
little-endian, primera fila arriba), 3 Radiance `frames/t0012_<cámara>_linear.hdr` (diagnóstico), 241 estados `particles/step_NNNN.json`,
4 texturas `textures/*.png` y `capture-report.json`. El checker exige que la carpeta tenga exactamente esos archivos.
Píxeles visibles (>16) del LDR: de 808 (`t0002_front`) a 19351 (`t0012_side`); la compuerta pide 100. Son distintos de los de `basichit-reference03`
porque el LDR ahora sale con el perfil.

## Dos ejecuciones
`check_profiled_checkpoint.py` recalcula la identidad del par desde los archivos:

```
pair: basichit-reference05 vs basichit-reference06: png 16/16 with 0 differing pixels (0 differing pixels in total, 1 byte-identical files); rgba16f 16/16 byte-identical; rgbe 3/3 byte-identical; particles 241/241 identical; textures 4/4; report keys settings equal, seed_configuration equal, counts equal, capture_profile equal OK
```

Los PNG coinciden en píxeles RGBA decodificados (15 de los 16 difieren en bytes por el flujo del codificador, como en el piloto); los HDR crudos, los
Radiance, los estados y las texturas coinciden byte a byte. `compare_reference_runs.py` sobre el par da `RESULT equal` (241/241, 3/3, 16/16 a 0, 4/4).

## La simulación no cambia
Los 241 estados de partículas de `basichit-reference05` son idénticos byte a byte a los de `basichit-reference03`, y las 4 texturas exportadas
también; el checker comprueba antes que esos archivos de `basichit-reference03` siguen coincidiendo con [reference-checkpoint.json](reference-checkpoint.json).
El perfil solo cambia cómo se captura la imagen. Semillas: `NE_Flame_Basic_001` 6371, `NE_Basic_Flash001` 6372, `NE_SimpleBurst` 6373.

## Transferencia
`transfer-basichit.mjs` hace fuera del navegador lo que hacía el modo "aislar color" de la página: HDR de Unreal → `max(0, x)` → la transformación
Filmic exacta de `film-color.js` (la fuente del LUT del laboratorio, sin LUT ni GPU) → `round(clamp01 * 255)`, contra el PNG `FinalColorLDR` del
mismo paso y cámara. La métrica es la de las filas de transferencia de `compare-basichit.py` (= `compare-color.py:28-37`): unión = canal máximo > 8
en cualquiera de las dos imágenes; error absoluto por canal sobre los píxeles de la unión (3 canales cada uno); MAE = media; P95 = percentil lineal de
numpy. Umbrales leídos de [render-sources.json](render-sources.json): MAE ≤ 2/255 y P95 ≤ 4/255 en el paso 12, tres cámaras. Comprueba cada archivo
contra el checkpoint que fija la ejecución. Salida: `.scratch/basichit-render/transfer-<ejecución>/transfer.json`.

Calibración sobre `basichit-reference03` (RGBE decodificado como el laboratorio, `RGBELoader` de three a half-float), contra T-1021-46 (GPU):

| paso 12 | MAE/255 | P95/255 | T-1021-46 MAE | T-1021-46 P95 | píxeles de la unión |
|---|---|---|---|---|---|
| front | 24,674 | 70 | 24,77 | 71 | 19561 |
| oblique | 25,160 | 71 | 25,26 | 71 | 19788 |
| side | 25,061 | 71 | 25,16 | 71 | 19854 |

La diferencia (0,10/255 de MAE en las tres cámaras, 1 de P95 en front) es la del LUT de la GPU frente a la transformación exacta (T-1021-46 la midió
en 0,26/255 como máximo). Error medio con signo (transferencia − Unreal) R/G/B: +9,8/+23,0/+39,5 en front: la imagen de Unreal sin perfil era más
oscura y menos azul de lo que da el Filmic sobre su HDR.

`basichit-reference05`, HDR crudo RGBA16F (la compuerta usa el crudo; el Radiance del paso 12 va como diagnóstico):

| paso | cámara | fuente | MAE/255 | P95/255 | máx | píxeles de la unión | error medio con signo R/G/B | compuerta |
|---|---|---|---|---|---|---|---|---|
| 2 | front | rgba16f | 0,052 | 0 | 2 | 809 | 0,00/0,01/0,02 | |
| 2 | oblique | rgba16f | 0,051 | 0 | 2 | 859 | 0,00/0,02/0,01 | |
| 2 | side | rgba16f | 0,054 | 0 | 2 | 900 | 0,00/0,01/0,01 | |
| 6 | front | rgba16f | 0,103 | 1 | 2 | 5256 | 0,00/0,03/−0,02 | |
| 6 | oblique | rgba16f | 0,101 | 1 | 2 | 5458 | 0,00/0,04/−0,02 | |
| 6 | side | rgba16f | 0,104 | 1 | 3 | 5522 | 0,00/0,04/−0,02 | |
| 12 | front | rgba16f | 0,121 | 1 | 3 | 19279 | 0,00/−0,01/0,02 | PASA |
| 12 | oblique | rgba16f | 0,126 | 1 | 3 | 19458 | 0,00/−0,01/0,02 | PASA |
| 12 | side | rgba16f | 0,122 | 1 | 3 | 19549 | 0,00/−0,01/0,02 | PASA |
| 12 | front | rgbe | 2,881 | 15 | 19 | 19279 | 0,01/0,21/−7,82 | diagnóstico |
| 12 | oblique | rgbe | 2,861 | 15 | 19 | 19458 | 0,02/0,17/−7,75 | diagnóstico |
| 12 | side | rgbe | 2,845 | 15 | 19 | 19549 | 0,01/0,19/−7,72 | diagnóstico |
| 18 | front | rgba16f | 0,199 | 1 | 3 | 12557 | −0,03/−0,04/0,15 | |
| 18 | oblique | rgba16f | 0,200 | 1 | 3 | 12675 | −0,04/−0,03/0,16 | |
| 18 | side | rgba16f | 0,201 | 1 | 3 | 12612 | −0,04/−0,04/0,15 | |
| 24 | front | rgba16f | 0,185 | 1 | 2 | 1125 | 0,02/0,00/−0,30 | |
| 24 | oblique | rgba16f | 0,192 | 1 | 1 | 1126 | 0,03/0,01/−0,30 | |
| 24 | side | rgba16f | 0,178 | 1 | 2 | 1117 | 0,02/0,00/−0,30 | |

La precondición pasa en el paso 12 con las tres cámaras, con margen (MAE 0,12 a 0,13 frente a 2; P95 1 frente a 4), y también en los pasos de
diagnóstico. El Radiance del mismo paso y la misma ejecución daría MAE 2,85 a 2,88 y P95 15 (falla), casi todo en azul (−7,7/255 de media): el
exponente compartido pierde precisión en los canales menores, como ya se vio en el piloto. El HDR para la transferencia es el crudo.

## Aceptado y no aceptado
Propuesto para aceptación del autor (nada se declara aceptado sin su palabra):
- La igualdad de las dos ejecuciones finales bajo `controlled-sdr/v1` (PNG por píxeles decodificados, HDR crudos y Radiance byte a byte, estados,
  texturas y claves del informe, incluido el perfil leído).
- La igualdad de la simulación con `basichit-reference03` (241/241 estados, 4/4 texturas).
- Los pins del checkpoint: 281 archivos por ejecución, el spec, el perfil leído, 13 archivos de código (texto con LF) y el binario del plugin.
- La precondición de transferencia medida sobre `basichit-reference05`: pasa en el paso 12 en las tres cámaras.

No aceptado:
- Nada sobre fidelidad visual del port: `visual_acceptance` sigue en falso y la primera comparación nativa (`compare-basichit.py`) sigue sin usarse.
- El perfil como aspecto del juego: es el perfil de laboratorio del piloto (sin bloom ni grading), elegido para aislar el color.
- El Radiance `.hdr` como evidencia de transferencia (solo diagnóstico).
- El encuadre como arte final y las imágenes después del paso 24 (como en REFERENCE.md).

## Pendiente
- La atadura de render (T-1021-46, retrabajo) debe pasar a esta referencia: `basichit-lab.js` y `compare-basichit.py` leen hoy
  `basichit-reference03` y su HDR Radiance; el retrabajo los apunta a `basichit-reference05`, al HDR crudo y a este checkpoint (fuera del alcance
  de este ticket).
- `compare_reference_runs.py` tenía CRLF en el disco de este worktree (en git es LF, con `eol=lf`) y `reference-checkpoint.json` fallaba su
  `codeHashes`; se restauró desde git (SHA-256 `dfbcb9f8…`, igual al pin) y su checker vuelve a pasar. Este checkpoint fija el código como texto
  con LF para no depender de los finales de línea del checkout.
- `capture_color.py` no importa `capture_profile.py` (fuera del alcance); el test de deriva los mantiene iguales.
- Las carpetas `basichit-reference05`/`06` y los registros de consola siguen en `.scratch/unreal`, fuera de git.
