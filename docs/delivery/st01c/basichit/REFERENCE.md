# NS_BasicHit: referencia Unreal

Captura de referencia de `NS_BasicHit` (UE 5.8.0, proyecto aislado `.scratch/unreal/ST01c_Pilot.uproject`) con las herramientas por especificación
(T-1020-101). Sistema `/Game/sA_Megapack_v1/sA_StylizedAttacksPack/FX/NiagaraSystems/NS_BasicHit`, SHA-256 de la fuente `97a82bae…18cf`. Especificación
`tools/unreal-niagara-probe/systems/ns-basichit.json` (SHA-256 `955ab039…36f3`). La auditoría legible por máquina es
[reference-checkpoint.json](reference-checkpoint.json) (`python tools/unreal-niagara-probe/check_reference_checkpoint.py` la reverifica; este documento se regenera con
`tools/unreal-niagara-probe/render_reference_md.py`). Las carpetas de ejecución siguen en `.scratch/unreal` (fuera de git) y el checkpoint las fija por hash.

## Comandos
Todas las ejecuciones de Unreal usan la misma línea (UnrealEditor-Cmd por PowerShell, en primer plano, una instancia a la vez) con otro `-CaptureRun`; la consola va a
`.scratch/unreal/<nombre>-console.log`. Los tiempos son de pared, de `Stopwatch` alrededor del comando.

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -d3d11 -RenderOffscreen -unattended -nop4 -nosplash -nosound '-ExecCmds=Automation RunTests Editor.Python.ST01c_Pilot.test_st01c_reference' '-TestExit=Automation Test Queue Empty' -CaptureRun=<nombre> '-SystemSpec=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-basichit.json'
```

Ejecuciones de Unreal, en orden (10):
1. `basichit-ref-probe01` (32.4 s, sondeo): 512², pasos de imagen [2, 6, 12, 18, 30, 60, 120, 240], objetivo [0, 0, 100], distancia 500, ancho 400. Resultado: failed: RuntimeError: Blank reference capture at step 30 / front. Bloque `capture` provisional del borrador (el mismo que el piloto).
2. `basichit-ref-probe02` (32.1 s, sondeo): 512², pasos de imagen [2, 6, 12, 18], objetivo [0.0, 0.0, 100.0], distancia 500, ancho 400. Resultado: complete: 12 image frames, 241 particle steps. Cumple la regla de fotograma en blanco: se quitan el paso que falló y los siguientes. Los 241 estados de partículas sirven para derivar el encuadre.
3. `basichit-ref-probe03` (31.1 s, sondeo): 512², pasos de imagen [2, 6, 12, 18], objetivo [20.0, 0.0, -10.0], distancia 800, ancho 850. Resultado: complete: 12 image frames, 241 particle steps. Con el encuadre recomendado; los archivos de partículas son idénticos a los de probe02 (el encuadre no toca la simulación).
4. `basichit-overlap01` (32.5 s, descartada): 512², pasos de imagen [2, 6, 12, 18], objetivo [20.0, 0.0, -10.0], distancia 800, ancho 850. Resultado: complete: 12 image frames, 241 particle steps. Pensada como la primera del par; por un error de proceso se lanzaron dos instancias de Unreal casi a la vez y los tiempos de pared se solaparon.
5. `basichit-overlap02` (29.9 s, descartada): 512², pasos de imagen [2, 6, 12, 18], objetivo [20.0, 0.0, -10.0], distancia 800, ancho 850. Resultado: complete: 12 image frames, 241 particle steps. Solapada con la anterior; las dos completaron y salieron iguales, pero se descartaron como evidencia (las carpetas se renombraron, sin borrar).
6. `basichit-reference01` (30.9 s, sustituida): 512², pasos de imagen [2, 6, 12, 18], objetivo [20.0, 0.0, -10.0], distancia 800, ancho 850. Resultado: complete: 12 image frames, 241 particle steps. Primer par en serie a 512 px: el efecto ocupaba unos 80 px; se sustituye por el par a 1024 px.
7. `basichit-reference02` (31.8 s, sustituida): 512², pasos de imagen [2, 6, 12, 18], objetivo [20.0, 0.0, -10.0], distancia 800, ancho 850. Resultado: complete: 12 image frames, 241 particle steps. Repetición de la anterior a 512 px; salió igual.
8. `basichit-blank-attempt01` (48.4 s, intento con fotograma en blanco): 1024², pasos de imagen [2, 6, 12, 18, 24, 30], objetivo [20, 0, -10], distancia 800, ancho 850. Resultado: failed: RuntimeError: Blank reference capture at step 30 / front. Primer intento con el nombre `basichit-reference03` (por eso se renombró la carpeta y la consola tras fallar).
9. `basichit-reference03` (44.9 s, final): 1024², pasos de imagen [2, 6, 12, 18, 24], objetivo [20, 0, -10], distancia 800, ancho 850. Resultado: complete.
10. `basichit-reference04` (42.9 s, final): 1024², pasos de imagen [2, 6, 12, 18, 24], objetivo [20, 0, -10], distancia 800, ancho 850. Resultado: complete.

Después de la última ejecución:
1. `python -B tools/unreal-niagara-probe/compare_reference_runs.py --spec tools/unreal-niagara-probe/systems/ns-basichit.json --a .scratch/unreal/basichit-reference03 --b .scratch/unreal/basichit-reference04`
2. `python -B tools/unreal-niagara-probe/frame_from_particles.py --spec tools/unreal-niagara-probe/systems/ns-basichit.json --run .scratch/unreal/basichit-reference03`
3. El pin de `ns-basichit.json` en `source-export-manifest.json` se sustituyó en el sitio por el SHA-256 del spec final y se comprobó byte a byte contra una regeneración con `python -B tools/unreal-niagara-probe/build_export_manifest.py` y los argumentos de EXTRACTION.md (ver Pendiente).
4. `python -B tools/unreal-niagara-probe/build_reference_checkpoint.py --spec tools/unreal-niagara-probe/systems/ns-basichit.json --a .scratch/unreal/basichit-reference03 --b .scratch/unreal/basichit-reference04 --out docs/delivery/st01c/basichit/reference-checkpoint.json`
5. `python -B tools/unreal-niagara-probe/render_reference_md.py --checkpoint docs/delivery/st01c/basichit/reference-checkpoint.json --out docs/delivery/st01c/basichit/REFERENCE.md`
6. `python -B tools/unreal-niagara-probe/check_reference_checkpoint.py docs/delivery/st01c/basichit/reference-checkpoint.json --root .`

Fotogramas en blanco (la compuerta de `capture_reference.py` exige al menos 100 píxeles visibles en cada paso de imagen posterior al 0; no informa el recuento):
- `basichit-ref-probe01`: paso 30 / front a 512²; acción: se quitan ese paso y los siguientes de `capture.imageSteps`.
- `basichit-blank-attempt01`: paso 30 / front a 1024²; acción: se quitan ese paso y los siguientes de `capture.imageSteps`.

## Ventana y semillas
Ventana del spec: dt 1/60 s, `lastStep` 240 (estados 0 a 240, 4 s), estado 0 antes del primer avance (vacío, 0 partículas en los tres emisores).
Imágenes en los pasos [2, 6, 12, 18, 24] (más la base del paso 0 con la primera cámara, 16 PNG), HDR lineal en el paso 12 (3 archivos),
1024², cámaras ortográficas `front` 0/0, `oblique` 45/20, `side` 90/0. Pasos 30, 60, 120, 240 del borrador quedaron fuera (ver Ráfaga y vida y Pendiente).
Semillas (`fixtureSeedBase` 6371, fixture en memoria; los emisores originales tienen determinismo falso y semilla 0): `NE_Flame_Basic_001` 6371, `NE_Basic_Flash001` 6372, `NE_SimpleBurst` 6373. Las dos ejecuciones finales usan las mismas.

## Encuadre
Regla (`frame_from_particles.py`): caja alineada a los ejes de todas las posiciones de partículas de los 241 pasos (5103 registros), ampliada en la mitad
del mayor tamaño de sprite (230.00 cm) en cada eje. Debe caber en el cuadro ortográfico de cada cámara con margen del 10 % (esquinas dentro del 90 % del medio ancho).

- Caja: x -245.5 a 285.0, y -254.1 a 249.3, z -263.3 a 247.9; centro (19.7, -2.4, -7.7); extensión (530.5, 503.4, 511.2) cm.
- Primera pasada (`basichit-ref-probe02`, objetivo [0.0, 0.0, 100.0], distancia 500, ancho 400, límite 180.0 cm): `fits: false`. Máximos |derecha|/|arriba| por cámara: front 254.1/363.3, oblique 381.2/470.6, side 285.0/363.3 cm.
- Recomendación de la herramienta: objetivo [20, 0, -10] (centro redondeado a 10 cm), ancho 850, distancia 800.
  La regla base daba ancho 650 (1.2 x la mayor extensión, múltiplo de 50), pero la cámara oblicua deja esquinas fuera del 90 % con ese ancho
  (máximos 367.1/368.0 cm frente a 292.5 cm). Por eso la herramienta también sube el ancho hasta que toda esquina proyectada cabe en el 90 %: 850 cm.
  La ampliación (el ancho también por esquinas proyectadas) es una decisión confirmada del encargo; la base 1.2 x se conserva en `orthoWidthFromExtent`.
- Aplicado: objetivo [20, 0, -10], distancia 800, ancho 850. Resultado sobre la ejecución final: `fits: true` (front 254.1/257.9, oblique 367.1/368.0, side 265.5/257.9 cm; límite 382.5 cm).
- Resolución: 0.830 cm por píxel (ancho 850 / 1024 px). El efecto visible en el paso 12 ocupa 158x158, 170x157, 171x158 px (ancho x alto, por cámara) de 1024.
- Píxeles visibles (>16) entre los pasos de imagen posteriores al 0: de 845 (frames/t0002_front.png) a 18325 (frames/t0012_oblique.png); el umbral de la compuerta es 100.

## Ráfaga y vida
Lo que muestran los archivos de partículas de `basichit-reference03` (`uniqueId` marca los nacimientos):

| emisor | primer paso con partículas | partículas en ese paso | máximo vivas | último paso vivo | vida mín a máx (s) | tamaño sprite mín a máx (cm) | nacimientos tras el paso 60 |
|---|---|---|---|---|---|---|---|
| `NE_Flame_Basic_001` | 1 | 1 | 1 | 23 | 0.4000 a 0.4000 | 10.00 a 230.00 | no |
| `NE_Basic_Flash001` | 1 | 1 | 1 | 17 | 0.3000 a 0.3000 | 11.11 a 188.89 | no |
| `NE_SimpleBurst` | 1 | 250 | 250 | 35 | 0.1004 a 0.5950 | 0.01 a 6.46 | no |

- Esperado por el script compilado (EXTRACTION.md): ráfagas instantáneas con tiempo 0. Los archivos lo confirman: los emisores nacen en el paso 1 con 1, 1, 250 partículas y el paso 0 tiene 0.
  Nacimientos por emisor: `NE_Basic_Flash001` en los pasos [1]; `NE_Flame_Basic_001` en los pasos [1]; `NE_SimpleBurst` en los pasos [1] (un único paso cada uno; el `SpawnRate` del Flame, de estado desconocido en la extracción, no produjo ningún nacimiento posterior).
- Vidas: Flash 0.3 s y Flame 0.4 s, constantes (el Flame no estaba resuelto en la extracción: ahora observado); SimpleBurst entre 0.1004 y 0.5950 s (aleatoria por partícula).
- El último paso con alguna partícula viva es el 35 (0.583 s); del 36 al 240 no hay partículas, el efecto dura unos 0.6 s de los 4 s capturados.
- Partículas vivas de SimpleBurst en los pasos de imagen y en los pasos que fallaron: paso 2: 250, paso 6: 250, paso 12: 196, paso 18: 147, paso 24: 104, paso 30: 44, paso 35: 9.
- El paso 30 sale en blanco (la compuerta exige 100 píxeles visibles) en `basichit-ref-probe01` y `basichit-blank-attempt01`, aunque en ese paso quedan 44 partículas del SimpleBurst (tamaño máximo de sprite en toda la captura 6.46 cm); el paso 24, con 104 partículas, aún da 1151 píxeles visibles (t0024_front.png).
  Por la regla fijada, `imageSteps` termina en 24; los pasos 25 a 35 solo existen como partículas.

## Dos ejecuciones
`compare_reference_runs.py` sobre `basichit-reference03` y `basichit-reference04` (código de salida 0):

```
particles 241/241 identical
hdr 3/3 identical
png 16/16 within 0 (max difference 0)
textures 4/4 equal
report settings equal, seed_configuration equal, counts equal
RESULT equal
```

Los 241 estados de CPU y los 3 HDR coinciden byte a byte; los 16 PNG coinciden en píxeles decodificados (los bytes PNG pueden diferir por metadatos). El umbral es el del piloto (0).
`capture-report.json` difiere entre ejecuciones por las marcas de tiempo y los sha256 de los PNG; solo se comparan `settings`, `seed_configuration` y `counts`.

## Texturas
Las cuatro exportadas por `TextureExporterPNG` y fijadas (ancho x alto, sRGB, SHA-256 del PNG y del paquete copiado, este último el de [source-copy-audit.json](source-copy-audit.json)):

| textura | tamaño | sRGB | sha256 del PNG | sha256 del paquete copiado |
|---|---|---|---|---|
| `T_FireBall` | 2048x1024 | sí | `6be3a6e443561c262ff7e992758059d01068da88b78254af3a6379d807be0a1c` | `1d5c64ec6742cb1b37e1237b96f4736cce439f661d64ca90467482cfb77288ab` |
| `T_FlameUV_1` | 2048x1024 | sí | `18d1ebcaee3e1898979e8ea80c1423c541b298c683b1dcc7ef71aa87356ee25e` | `4866b9058807eeef9a3da577670e150c6606d5b8d38eaedffc8579bfc36e00d4` |
| `T_Ground_Crack` | 2048x2048 | sí | `048ff832cb6a67a19607059a3dbfe5ebf3da458924947db58ff79ac494585cf9` | `d7e4250127f10753b7e1c34ca62cbf784a96162643909bf25e703a8de6eef343` |
| `T_Hit_Circle` | 2048x2048 | sí | `e8187ccaa8d3733447e635c01cae3f4340204d1e54091a9eec8727a8e287094b` | `0835a472b1ba3d7f9205aec8cd6adf0f64f0b66c908efe3fd731bcc8ddef40b1` |

Cuáles alimentan un renderer activo (según [material-defaults.json](material-defaults.json) y [EXTRACTION.md](EXTRACTION.md)):
- `T_FireBall`: sí. `MI_Fireball` (Flame, 8x4 SubUV) la fija como parámetro (material-defaults.json:154); además es el valor por defecto del padre `M_Smoke` (material-defaults.json:39).
- `T_Hit_Circle`: sí. `MI_Hit_1` (Flash, 1x1) la fija sobre su padre `M_Ground_Crack` (material-defaults.json:184).
- `T_FlameUV_1`: no. La fija `MI_Flame_1` (material-defaults.json:169), que ningún renderer activo usa (EXTRACTION.md:16-18; solo aparece en system.t3d:2493).
- `T_Ground_Crack`: no. Es el valor por defecto del padre `M_Ground_Crack` (material-defaults.json:120) y `MI_Hit_1` lo sustituye por `T_Hit_Circle`.
- `MI_Radial_2` (SimpleBurst) no tiene textura: sus 250 partículas no usan ninguna de las cuatro.

## Aceptado y no aceptado
Aceptado:
- La igualdad de las dos ejecuciones finales en la ventana, semillas y encuadre del spec (partículas, HDR, PNG por píxeles, texturas, claves del informe).
- Los pins: SHA-256 de 265 archivos de `basichit-reference03`, de las 4 texturas y sus paquetes copiados, de los 6 archivos de código y del spec (`check_reference_checkpoint.py`), y el pin de `ns-basichit.json` en `source-export-manifest.json`.
- Los hechos de ráfaga y vida de la tabla anterior, como observación de esta captura.

No aceptado:
- Nada sobre fidelidad visual: `visual_acceptance` sigue en falso; los PNG son FinalColorLDR y los HDR descartan alfa.
- El encuadre como arte final: sale de una regla sobre cajas y deja el efecto pequeño.
- El port nativo, su simulación y cualquier comparación con el laboratorio de Three.js.
- Las imágenes después del paso 24 (la cola del efecto, pasos 25 a 35, no tiene PNG de referencia).

## Pendiente
- El hash de `ns-basichit.json` se calcula sobre el archivo de trabajo, con CRLF en este checkout (`core.autocrlf`); en otro checkout con LF el hash del spec no coincidiría hasta renormalizar.
- El encuadre no es arte final: la regla usa todas las partículas de todos los pasos y, con la ráfaga de 250 partículas dispersas, la caja resulta mucho mayor que el cuerpo visible. Decidir si se quiere un encuadre por percentiles o por pasos de imagen.
- Los pasos posteriores al 24 no tienen imagen: el paso 30 sale en blanco a 1024² con el encuadre final (ver Ráfaga y vida). Cubrirlos exigiría un encuadre propio de la cola; la regla del encargo los deja fuera.
- Los pasos 36 a 240 no tienen partículas (el efecto termina en el paso 35): no se capturan imágenes ahí, serían negras y la compuerta las rechazaría.
- `frame_from_particles.py` amplía la regla base (ancho también por esquinas proyectadas); está confirmada en el encargo, pero queda por fijarla en la documentación del flujo común.
- `SpawnRate` del Flame: sin nacimientos tras el paso 1 en esta captura; el estado habilitado del módulo sigue sin confirmar en la fuente.
- Los 3 HDR del paso 12 son la única referencia lineal; no hay HDR de otros pasos.
- Texturas `T_FlameUV_1` y `T_Ground_Crack` exportadas pero sin uso activo; la tarea 05 (primitivas comunes) decide si se necesitan.
- Las carpetas de las ejecuciones sustituidas (a 512 px) y descartadas siguen en `.scratch/unreal` sin pin; solo `basichit-reference03` y `basichit-reference04` son la evidencia.
