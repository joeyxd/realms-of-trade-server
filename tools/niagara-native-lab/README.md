# Laboratorio privado ST01c

**Color controlado, 2026-10-14:** [entrega](../../docs/delivery/st01c/COLOR-LAB.md).
Abrir `color.html?run=color07`: Filmic SDR de UE5.8 desde fórmulas y LUT generada,
carta HDR y piloto a 0/+1 EV. Referencia FinalColorLDR con gamma 2,2 explícita;
raw RGBA16F para aislar la transformación sin pérdida RGBE. No es bloom/grading libre,
FPS móvil ni integración del juego. `verify-color.mjs`, `qa-color.mjs` y
`compare-color.py` reproducen los controles. El preparador requiere fuentes del motor
y `color05/color-platform.json` fijados, que solo contiene capacidades/gamma.

El laboratorio traduce el material del piloto MyProject `NS_Flame_Single` a Three.js.
Tiene tres modos: atributos observados, actualización desde nacimientos observados y
generador local desde fuente/semilla. Este último cubre las ramas efectivas del piloto;
no ejecuta Niagara ni registra un efecto listo en el juego.

**Generador local, 2026-10-13:** [resultado](../../docs/delivery/st01c/NATIVE-LAB.md).
Abrir `http://127.0.0.1:5197/tools/niagara-native-lab/index.html?run=reference11&mode=native`.
`pilot-source.json` contiene constantes del HLSL efectivo y LUT, sin estados de partículas.
Su hash está fijado en el cargador; fórmulas y semilla producen los nacimientos nuevos.
Conserva las referencias/atlas del run para verlos, pero no solicita los 241 estados ni
`update-fixture.json`. Puede emitir hasta 8 s, con semilla y controles experimentales.

```powershell
node tools/niagara-native-lab/verify-native.mjs reference11
node tools/niagara-native-lab/verify-native.mjs reference12
node --test tools/niagara-native-lab/lab.test.mjs tools/niagara-native-lab/update-simulation.test.mjs tools/niagara-native-lab/native-simulation.test.mjs
node tools/niagara-native-lab/qa-native.mjs 'C:/DEV/real of trade/visual-revamp/node_modules/playwright/index.mjs'
```

`prepare-native-source.py compiled02` reproduce el preset desde los exports fijados por
hash. Requiere el [nuevo probe compilado](../unreal-niagara-probe/README.md); una fuente
distinta exige revisión explícita del contrato y de sus hashes, no un cambio automático.

**Modo adicional, 2026-10-13:** evolución local de vida/muerte, movimiento, alfa y atlas
desde 50 nacimientos observados. Los estados posteriores se calculan aquí; los tiempos
y estados iniciales aún son una fixture de Unreal. [Resultados](../../docs/delivery/st01c/UPDATE-LAB.md).

Primero ejecutar [la captura aislada](../unreal-niagara-probe/README.md). Instalar las
dependencias existentes con `npm.cmd ci --ignore-scripts --no-audit --no-fund` y servir
la raíz del worktree solo en localhost con el servidor del laboratorio:

```powershell
python tools/niagara-native-lab/serve.py
```

`serve.py` es el mismo `SimpleHTTPRequestHandler` de `python -m http.server` (solo GET y HEAD,
127.0.0.1:5197, sirve la raíz del worktree desde cualquier carpeta) con cola de escucha 128 en vez
de la 5 por defecto de `socketserver`. Las páginas del piloto piden 241 estados a la vez al pasar al
modo observado; con `python -m http.server` el sistema rechaza el exceso (`WinError 10061`) y
`qa-native.mjs` y `qa-update.mjs` agotan su espera de 30 s (RENDER.md de BasicHit, sección
"Regresión de píxeles del piloto"). Los bytes servidos no cambian. `--quiet` calla el registro
por petición; `--port` y `--root` existen para pruebas.

Abrir `http://127.0.0.1:5197/tools/niagara-native-lab/index.html?run=reference11`.
`run` es el nombre de la captura bajo `.scratch/unreal`; no se aceptan rutas arbitrarias.
Se necesitan 241 muestras, los dos atlas originales y las referencias del mismo piloto.
Los assets completos permanecen fuera del bundle. No hay endpoints de escritura.

Para el modo de evolución local, preparar una vez la fixture del mismo run y abrir
`http://127.0.0.1:5197/tools/niagara-native-lab/index.html?run=reference11&mode=update`:

```powershell
python tools/niagara-native-lab/prepare-update-fixture.py reference11
node tools/niagara-native-lab/verify-update.mjs reference11
node --test tools/niagara-native-lab/lab.test.mjs tools/niagara-native-lab/update-simulation.test.mjs
node tools/niagara-native-lab/qa-update.mjs 'C:/DEV/real of trade/visual-revamp/node_modules/playwright/index.mjs'
```

La preparación requiere el export exacto `.scratch/unreal/probe01/system.t3d` para
extraer la LUT del dueño activo. Repetir con `reference12` contrasta la segunda ejecución.
El simulador no lee frames posteriores; `verify-update.mjs` los usa como comparación
independiente. Solo simula el subconjunto de actualización conocido, sin fuerzas.
Los controles experimentales tienen unidad, rango y efecto explicado; ni este corte
ni su ficha descriptiva ejecutan un compositor/agente o habilitan habilidades del juego.

- Reproducción de cuatro segundos, vistas frontal/oblicua/lateral y cámara giratoria.
- Llama y humo independientes; se puede ocultar cada capa sin modificar la captura.
- Los quads conservan posición, tamaño, color, rotación y fotograma por partícula.
- RGB de textura por RGB de partícula; opacidad R por alfa, clamp 0–1, sin interpolación
  entre celdas. Texturas fuente sRGB; partículas mezcladas en un target lineal RGBA16F,
  seguido por una sola conversión de presentación. El DepthFade no se ejercita aquí.
- La referencia normal conserva el color final de Unreal. La casilla de comparación
  carga su SceneColor HDR a 2 segundos y aplica a ambos lados el mismo color de salida;
  aísla el material, **no demuestra que reproduzcamos el tonemapper de Unreal**.
- El preset ACES de Three es una aproximación. Exposición cambia solo la presentación.

## Verificación

```powershell
node --test tools/niagara-native-lab/lab.test.mjs
node tools/niagara-native-lab/qa.mjs 'C:/DEV/real of trade/visual-revamp/node_modules/playwright/index.mjs'
python tools/niagara-native-lab/compare.py
```

QA usa Chrome instalado mediante Playwright, captura las tres vistas, prueba cámara,
capas, reproducción, layout de 390 px, tráfico GET local y liberación de GPU. `compare.py`
requiere Pillow/NumPy y genera métricas diagnósticas; no convierte un umbral de píxeles
en aceptación artística. Sus salidas quedan en `.scratch/browser-lab`.

El piloto usa los atlas completos de 2048×1024 y 2560×1536: ~30,7 MiB estimados RGBA8
con mipmaps, antes del target HDR y las referencias. No es una variante móvil lista.
La emulación prueba controles/layout, no FPS o coste en un teléfono. La semilla de
Unreal está fijada solo en memoria para comparar; el asset fuente no era determinista.

Sigue DepthFade con escena, color final y presupuesto por dispositivo, antes de integrar
el piloto al taller. El generador está cotejado para la fixture; otras semillas y otros
sistemas necesitan sus comparaciones específicas.
# Núcleo común de simulación, 2026-10-20

**Ruta (T-1023-14):** el cierre de ejecución de `NS_BasicHit` (`core/`, `basichit-simulation.js`, `basichit-render.js`, `particles.js`, `film-color.js`, `film-identity.js`, `depth-stage.js`, `basichit-source.json`, `film-source.json`) vive ahora en `src/render/vfx/niagara/` para que el cliente lo incluya; el laboratorio lo importa desde allí. Los nombres de este README sin ruta se refieren a esa carpeta.

`core/` reúne las primitivas de simulación del piloto para reutilizarlas en la segunda
familia: `rng.js` (`random3`, `random4`, `uniformRange`), `curve.js` (`sampleCurve`,
`validateCurve`), `spawn-rate.js` (`rateStep`, `rateBirthAge`), `particle-state.js` (`DT`,
edad normalizada, `ageParticle`, `integrateVelocity`) y `subuv.js` (`subUVFrame`). Son módulos
ES puros, sin imports externos. `verify-core.mjs` recalcula los digests del piloto y los compara
con `docs/delivery/st01c/core-checkpoint.json`; sale con código 1 si alguno difiere.
Ver [entrega](../../docs/delivery/st01c/CORE-MODULES.md).

```powershell
node tools/niagara-native-lab/verify-core.mjs
node --test tools/niagara-native-lab/core.test.mjs
```

# Núcleo común de render, 2026-10-21

`core/` reúne también las primitivas de render del piloto: `depth-fade.js` (DepthFade en JS y GLSL, distancia por
defecto 100 cm), `subuv-atlas.js` (UV del atlas SubUV), `sprite-shader.js` (shaders del sprite y opciones por capa:
rejilla, textura, DepthFade) y `frame-spec.js` (`validateFrame(frame, spec)` y `BASICHIT_FRAME_SPEC`). `particles.js`
construye el material Three.js con ellas; su API no cambia. `check-pixels.py` compara dos carpetas de corridas PNG a PNG
sobre píxeles RGBA decodificados (Pillow): una línea por archivo, `identical N/N` al final y código 1 ante cualquier
diferencia o archivo ausente; `--exclude <glob>` aparta capturas no deterministas. Ver
[entrega](../../docs/delivery/st01c/CORE-MODULES.md), sección Render.

```powershell
node --test tools/niagara-native-lab/render-core.test.mjs
python -B tools/niagara-native-lab/check-pixels.py .scratch/render-core/base-a/depth-lab .scratch/render-core/after/depth-lab
```

Corrida nueva de profundidad contra la base, desde la raíz del worktree en Git Bash (servidor propio, parado por su PID):

```bash
PW="C:/DEV/real of trade/visual-revamp/node_modules/playwright/index.mjs"
python tools/niagara-native-lab/serve.py --quiet > /dev/null 2>&1 &
SERVER=$!
until curl -s -o /dev/null http://127.0.0.1:5197/; do sleep 0.2; done
node tools/niagara-native-lab/qa-depth.mjs "$PW" depth02
FRESH=".scratch/render-core/verify-$(date +%Y%m%d-%H%M%S)"
mkdir "$FRESH" && cp .scratch/depth-lab/depth02/*.png "$FRESH"/
python -B tools/niagara-native-lab/check-pixels.py .scratch/render-core/base-a/depth-lab "$FRESH"
kill $SERVER
```

# NS_BasicHit nativo, 2026-10-21

`basichit-simulation.js` simula los tres emisores de `NS_BasicHit` sobre `core/` (ráfaga única,
EmitterState Once) con la fuente versionada `basichit-source.json`, que escribe
`prepare-basichit-source.mjs` desde las tablas VM y las LUT del T3D fijados por hash.
`verify-basichit.mjs` lo compara con `basichit-reference03` (241 pasos, tolerancias de
`verify-native.mjs`) y con los digests de `docs/delivery/st01c/basichit/simulation-checkpoint.json`;
sale con código 1 ante cualquier fallo. Ver [entrega](../../docs/delivery/st01c/basichit/SIMULATION.md).

```powershell
node tools/niagara-native-lab/prepare-basichit-source.mjs
node tools/niagara-native-lab/verify-basichit.mjs
node --test tools/niagara-native-lab/basichit-simulation.test.mjs
```

# Render nativo de NS_BasicHit, 2026-10-22

`basichit.html` dibuja los tres emisores desde `BasicHitSimulation` con la cadena de color del piloto: capas instanciadas
de `basichit-render.js` (una por emisor; orden de dibujo del gate Flame, Flash, SimpleBurst, con los órdenes `reverse` y
`engine` como diagnóstico: el del motor es Flash, SimpleBurst, Flame, ver
[DRAW-ORDER.md](../../docs/delivery/st01c/basichit/DRAW-ORDER.md)) -> destino HDR de media precisión ->
LUT Filmic de `film-color.js` -> lienzo de 1024 px, con las cámaras de `basichit-reference05` (perfil `controlled-sdr/v1`).
Cada archivo de la referencia se comprueba contra `docs/delivery/st01c/basichit/reference-profiled-checkpoint.json`. La
casilla "Aislar color" pasa el HDR crudo RGBA16F de Unreal del paso 12 por la misma LUT (precondición de transferencia).
`qa-basichit.mjs` guarda 49 lienzos en una carpeta nueva de `.scratch/basichit-render/` (se niega si ya existe) y
`compare-basichit.py` aplica el gate de `render-sources.json`. Ver [entrega](../../docs/delivery/st01c/basichit/RENDER.md).
Las opciones nuevas de `core/` (`facing: 'camera-position'`, `subUV: 'wrap'`, `opacity: 'radial-gradient-exponential'` en
`spriteLayer`) son opt-in: el piloto sigue con sus valores por defecto y sus píxeles
([CORE-MODULES.md](../../docs/delivery/st01c/CORE-MODULES.md), sección Render).

Desde cualquier shell de Git Bash, con el servidor de arriba en 127.0.0.1:5197 (servido desde la raíz del worktree):

```bash
W="C:/DEV/real of trade/st01c-native"
PW="C:/DEV/real of trade/visual-revamp/node_modules/playwright/index.mjs"
node "$W/tools/niagara-native-lab/qa-basichit.mjs" "$PW" <ejecución-nueva>
python -B "$W/tools/niagara-native-lab/compare-basichit.py" "$W/.scratch/basichit-render/<ejecución-nueva>" --transfer-only
python -B "$W/tools/niagara-native-lab/compare-basichit.py" "$W/.scratch/basichit-render/<ejecución-nueva>"
python -B "$W/tools/niagara-native-lab/check-pixels.py" "$W/.scratch/basichit-render/<ejecución-a>" "$W/.scratch/basichit-render/<ejecución-b>"
node --test "$W/tools/niagara-native-lab/basichit-render.test.mjs" "$W/tools/niagara-native-lab/render-core.test.mjs"
```

`--transfer-only` escribe `transfer-check.json` (identidad de la transferencia de la GPU frente a la transformación
exacta de `film-color.js`, calculada con `node`, y las tres filas de transferencia) sin mirar ningún lienzo nativo; el modo
completo escribe `comparison.json` y solo calcula las filas nativas si las tres de transferencia pasan.

Conjunto `wrap` (T-1022-35): `basichit.html?reference=wrap` usa `basichit-reference10` y
`docs/delivery/st01c/basichit/wrap-reference-checkpoint.json` (pasos 20 a 23, la llama más allá de su rejilla 8x4; paso de
transferencia 20). Los pasos y el paso de transferencia de cada conjunto salen de los `settings` de su checkpoint. El
selector "SubUV de la llama" cambia la llama a `clamp` como diagnóstico. `qa-basichit.mjs "$PW" <ejecución> wrap` guarda
52 lienzos (añade los `clamp`) y `compare-basichit.py <ejecución> --reference wrap` los compara; sin argumento, las dos
herramientas siguen en el gate y su `comparison.json` no cambia. Ver
[WRAP.md](../../docs/delivery/st01c/basichit/WRAP.md).

Conjunto `depth` (T-1023-06): `basichit.html?reference=depth` usa `basichit-reference12` y
`docs/delivery/st01c/basichit/depth-reference-checkpoint.json` (pasos 6 y 12; 3 controles y 13 planos opacos negros por
paso). `basichit-depth.js` construye el plano de cada fila (`planeFromSurface`) y lo dibuja en un destino propio con textura
de profundidad, luego en el destino HDR para que oculte; la llama usa `BASICHIT_DEPTH_LAYERS` (DepthFade 100 cm) y solo en
este conjunto. `qa-basichit.mjs "$PW" <ejecución> depth` guarda 75 lienzos (nativos, 26 con el DepthFade apagado como
diagnóstico y 16 de transferencia) y `compare-basichit.py <ejecución> --reference depth` los compara y comprueba la
profundidad de Unreal contra el plano analítico. Ver [DEPTH.md](../../docs/delivery/st01c/basichit/DEPTH.md).

# Profundidad del piloto

`depth.html?run=depth02` compara las partículas nativas a 2 s con el mismo piloto
Unreal en paredes/suelo opacos. Shader de profundidad en target independiente;
referencias temporales `depth02`/`depth03`, sin capturas de partículas como entradas.
Solo ortográfica privada: color final UE, texturas optimizadas y FPS físico pendientes.
Ver [entrega](../../docs/delivery/st01c/DEPTH-LAB.md), `qa-depth.mjs`,
`verify-depth.mjs` y `compare-depth.py` para evidencia y reproducción.

# Atlas y presupuesto, 2026-10-14

`budget.html` prueba el par de atlas original y tres derivados lossless, solo una
variante cargada por vista. `atlas-build.py --check` reproduce por celda, con fuente
y receta fijadas; `qa-atlas.mjs`, `compare-atlas.py` y `check-atlas-repeat.py` contrastan
secuencia/capas/profundidad y todos los fotogramas. [Entrega](../../docs/delivery/st01c/ATLAS-LAB.md).
WebP completo ahorra 59,64 % de descarga con renders exactos; 128/64 px fallaron el
gate de silueta y no se admiten. La memoria GPU sigue en 30,67 MiB estimados; selección
automática conserva full y lo indica. Próximo experimento: compresión GPU a resolución
completa, antes de presupuesto móvil físico y admisión al taller.

**Compresión GPU, 2026-10-19:** variante `ktx2-uastc` (KTX2 UASTC a 256 px por celda, 7,67 MiB
BC7 medidos; falla el gate: 37/268, solo IoU de máscara). Resultado en la
[entrega](../../docs/delivery/st01c/ATLAS-LAB.md) y `atlas-gpu-checkpoint.json`;
`MOBILE_MEMORY_ACCEPTED` sigue en `false`. Comandos nuevos:

```powershell
python -B tools/niagara-native-lab/atlas-build.py --toktx "C:/DEV/real of trade/realms-of-trade-server/.scratch/tools/ktx-4.4.2/bin/toktx.exe"
node tools/niagara-native-lab/qa-atlas.mjs 'C:/DEV/real of trade/visual-revamp/node_modules/playwright/index.mjs' budget03
node tools/niagara-native-lab/qa-atlas.mjs 'C:/DEV/real of trade/visual-revamp/node_modules/playwright/index.mjs' budget04
python -B tools/niagara-native-lab/compare-atlas.py budget03
python -B tools/niagara-native-lab/check-atlas-repeat.py budget03 budget04
python -B tools/niagara-native-lab/check-atlas-repeat.py budget01 budget03 --variants source,full,half,quarter
```

`--toktx` apunta al encoder KTX-Software 4.4.2 (portable, fuera de git); su versión y la línea
de comandos quedan en el manifiesto. `budget.html?variant=ktx2-uastc` carga el par con
`KTX2Loader` y muestra el formato GPU subido y sus MiB; `qa-atlas.mjs` guarda `gpu`,
`extensions` y el lanzamiento del navegador en `browser.json`. `--variants` de
`check-atlas-repeat.py` compara solo las variantes indicadas (por defecto, las presentes
en ambas corridas).

**Cadena de mips frente a códec, 2026-10-20:** tres variantes diagnósticas (`ktx2-uastc-box`,
`ktx2-rgba8`, `ktx2-rgba8-box`) forman con `ktx2-uastc` una descomposición 2x2 (mips de
`toktx` por defecto o `--filter box`; RGBA8 sin códec o UASTC). Nunca entran en la selección
automática. Resultado en la [entrega](../../docs/delivery/st01c/ATLAS-LAB.md) y
`atlas-mip-checkpoint.json` (corridas `budget07` y `budget08`); `MOBILE_MEMORY_ACCEPTED` sigue
en `false`. `qa-atlas.mjs` recorre ocho variantes y `check-atlas-repeat.py` compara por
defecto las presentes en ambas corridas.
