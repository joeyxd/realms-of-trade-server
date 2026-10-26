# NS_Flame_Single nativo en el Taller — T-1024-14

Implementación local, sin commit ni publicación. `niagara-985a431dc6c0d1ca`,
MyProject, queda listo mediante `niagara-native-v1` / `flame-single-v1`, igual que
BasicHit desde alpha.102. La otra "Flame Single" (`niagara-4e2ad705daafa1bf`,
SimpleMultiplayerSurvival) no se toca. No cambia gameplay, protocolo, SQL, versión
ni los catálogos generados.

## Contrato

Se reutilizan la simulación medida del piloto (`NativeSimulation`), sus dos capas
(`PilotParticles`: NE_Flame_Basic_001 8×4 y NE_Smoke_Basic 10×6, DepthFade 100 cm)
y el Filmic del laboratorio. El film es el mismo `film-source.json` (SHA-256
`df3b1ba1…74c0`) que usa la prueba de color del piloto y que ya fija BasicHit.
Los PNG Unreal fijados por `atlas-source.json` (T_FlameUV_2 2048×1024,
T_Smoke_1 2560×1536, sRGB) pasan a WebP lossless con RGBA idéntico:
`flame-v1.webp` y `smoke-v1.webp` en `assets/vfx/niagara/native/flame-single-v1/`
(`build-native-assets.py` rechaza un PNG cuyo SHA-256 difiera del pin y su `--check`
cubre los cuatro WebP). Escritorio carga estos dos archivos; el móvil carga sus gemelos KTX2 (sección «Variante móvil»).

Ventana de 8 s como BasicHit: `nativeStep` sin cambios (pasos 0–480), la simulación
se mueve con seek, el tope de 480 pasos y `stopAt` (8 s) no cambian, y el bucle es el
reinicio de toda la vista previa. Sin prewarm ni emisión periódica. `nativeEndStep`
del piloto devuelve 480: emite durante toda la ventana y nunca se vacía antes. Para
eso `nativeEndStep` busca el primer paso vacío *después* de las primeras partículas
(la llama está vacía antes de su primer nacimiento); para BasicHit el resultado es el
mismo para las semillas comprobadas (0, 1, 7, 99, 6371, 12345, 40000, 65533).

Los documentos v3 son los mismos (semilla entera 0–65533, defecto 6371 = el de
`CONTROL_SPEC`; los controles de presentación son los de BasicHit). Despacho por
`effect.recipe`: `NATIVE_SIMULATIONS` (niagaraNative.js) elige la simulación y
`RECIPES` (nativeEffect.js) el número de texturas, de ranuras de conteo y la clase
de capas; el camino `basichit-v1` es el mismo de antes. Resumen del registro:
`drawOrder: 'index'` (orden del piloto: llama 0, humo 1), `simulationDigest`
`0d417fde9bbfba5552d6b720fe446369ca46b19da7889a208ebf50c446566255` (SHA-256 de
`JSON.stringify(seek(paso))` de los pasos 0..480 con la semilla 6371, más `seek(12)`,
el mismo método de BasicHit), archivos con SHA-256 (WebP también `decodedSha256`).

El módulo de simulación, `source-identity.js`, `update-simulation.js` y
`pilot-source.json` se movieron sin cambios de contenido (solo los especificadores de
importación) de `tools/niagara-native-lab/` a `src/render/vfx/niagara/`: el runtime del
juego ya no depende de `tools/` ni `docs/`. Los importadores del laboratorio solo
cambiaron sus rutas; los checkpoints del piloto solo cambiaron campos de ruta.

## Cadena de imagen y recursos

Idéntica a BasicHit (STUDIO.md de basichit): geometría opaca con material de
profundidad sin escritura de color, target RGBA16F transparente con las dos capas,
`setDepth` con opt-in explícito de perspectiva (`{ perspective: true }`; sin la opción
el camino del laboratorio no cambia), composite Filmic con `tintColor`/`opacity` sobre
el escenario, targets del tamaño del viewport del dispositivo. Transformación de
instancias como BasicHit: X/Z por scale, Y por scale×height más 1 m, ancho por scale,
alto por scale×height. La carga verifica el SHA-256 de los cuatro archivos y libera
todo al cambiar o cerrar.

Honestidad en la interfaz: la entrada lleva su propio texto (`limitation` en el
registro para el catálogo y `nativeFlameLimit` ES/EN en el Taller). No presenta como
medidos el DepthFade en perspectiva, la composición sobre el escenario, el orden de
dibujo llama/humo en perspectiva, los controles de presentación ni la variante móvil.
El texto de BasicHit no cambia.

## Evidencia local

- `python tools/niagara-native-lab/build-native-assets.py --check`: exit 0, los cuatro
  `decodedRGBAIdentical: true`. flame-v1 `cc80a1d6…58a0d` (decodificado `ef5c1922…555b`),
  smoke-v1 `b9890532…1ec1` (decodificado `e8f683fa…d182`).
- Seis archivos de pruebas del ticket: 41 pass / 0 fail (la prueba nativa cubre las dos
  entradas: claves exactas, pins, digest del piloto, recetas, texto por entrada).
- `node --test --test-concurrency=1 tools/niagara-native-lab/*.test.mjs`: 66 pass / 0 fail.
- Cinco verify del laboratorio (native reference11 y reference12, update reference11,
  core, basichit): exit 0, salida idéntica a la de antes del movimiento.
- Regresión de píxeles del piloto, seis familias (`.scratch/render-core/t1024-14/`) contra
  `base-a` con `--exclude 'atlas/*/mobile-layout.png'`: `identical 2261/2261`. La primera
  corrida de `native-birth` difirió en `native-continuous.png` (11936 px); dos repeticiones
  de esa familia fueron idénticas a `base-a` y la primera se conserva aparte en
  `.scratch/render-core/native-birth-firstrun-t1024-14/` (no reproducible).
- QA `t1024-14-basichit`: 5/5, mismos conteos que antes (paso 6: 1/1/250, paso 12: 1/1/196),
  evidencia con el mismo SHA-256 que `t1023-15-c`.
- QA `t1024-14-flame` (`qa-native-studio.mjs <run> niagara-985a431dc6c0d1ca`): 5/5; cero
  errores, escrituras GM y comandos de gameplay. Pasos 60, 240 y 479 con semilla 6371:
  conteos [2, 9], [3, 20] y [3, 20] iguales a la simulación, ambos emisores con partículas,
  1736/1861/1970 píxeles distintos del fondo, targets 878×722 iguales al viewport, 15
  draw calls. Semilla 12345 con calidad móvil en el paso 240: [3, 20]. Liberación de 14/14
  recursos al cambiar al flipbook y al cerrar. Capturas ES y EN revisadas.
  Evidencia: `.scratch/native-studio/t1024-14-flame/evidence.json`, SHA-256
  `fdcdca2182c81bbe7f39f455c7c6541bb356da7a553be68a92e1512388135367`.
- `tools/qa-niagara-studio.mjs`: 9/9. Selección del actualizador: 392 pass / 0 fail.
  `npm run assets:check`: exit 0, 2794 archivos, 154 piezas, 114 problemas heredados
  (los mismos 114 de antes).

## Límites de aceptación

No se declara equivalencia con UE del DepthFade en perspectiva, de la composición sobre
el escenario, del orden llama/humo en perspectiva, de los controles de presentación ni
de la variante móvil; tampoco FPS físicos ni la aceptación del autor. El bucle reinicia
toda la vista previa (sin continuidad de la emisión entre vueltas).

## Variante móvil (T-1024-20)

Decisión de Joi (2026-10-24): KTX2 UASTC solo en móvil; el escritorio conserva los WebP sin
pérdida con sus pins, sin cambio de bytes. Resolución completa (sin reducir), calidad primero.
Con la calidad «Móvil» del Taller (o puntero grueso, o escenario de menos de 760 px) el efecto
carga `flame-v1.ktx2` y `smoke-v1.ktx2` (`assets/vfx/niagara/native/flame-single-v1/`) en lugar de los WebP; cambiar el selector recarga el efecto con el otro juego y
libera las texturas anteriores.

- **Tope de GPU:** 12 MiB = 12.582.912 B por efecto = las texturas del efecto con la cadena
  completa de mips + la LUT de film (32³ × 4 × 2 B = 262.144 B). Los render targets quedan fuera.
- **Fórmula:** 16 B por bloque 4×4 en cada nivel hasta 1×1, `sum(ceil(w/4) × ceil(h/4) × 16)`
  (la misma de `atlas-policy.js`). Flame 2048×1024: 2.796.240 B; Smoke 2560×1536: 5.242.960 B; total 8.039.200 B + LUT = **8.301.344 B** (66,0 % del tope; descarga 1.394.823 B frente a 552.514 B de los WebP).
  Una prueba del gate (`tests/niagara-native-studio.test.mjs`) lee la cabecera de cada KTX2
  en `assets/`, calcula esa suma y exige el total ≤ 12.582.912 B; otra fija el juego de escritorio.
- **Codificador:** `toktx v4.4.2`, receta `ktx2-uastc` de T-1020-66 (`atlas-build.py`):
  `--t2 --encode uastc --uastc_quality 4 --zcmp 3 --genmipmap --lower_left_maps_to_s0t0
  --assign_oetf srgb --assign_primaries srgb`, desde los mismos PNG que los WebP. Es
  reproducible: dos corridas de `python tools/niagara-native-lab/build-native-assets.py --toktx <toktx.exe>`
  dan los mismos cuatro sha256 (`--check` con el mismo `--toktx` los compara byte a byte).
  KTX2 (sha256): flame `fc901aae…5f1`, smoke `aa4757a1…347`.
- **Carga:** `NativeEffect.setEffect(effect, { quality, renderer })`; con `quality: 'mobile'` descarga
  los `.ktx2`, comprueba su SHA-256 contra el pin y pasa los mismos bytes a `KTX2Loader`
  (three 0.160, transcoder `basis` del mismo CDN que three) que transcodifica a ASTC, ETC2 o BC7
  según la GPU y usa la cadena de mips guardada. Origen abajo-izquierda en la codificación, sin
  voltear en ejecución; sRGB. Si el KTX2 o el transcoder falla, el efecto pasa a su estado de
  error con el mensaje `KTX2 mobile texture failed: <url>: <causa>`: nunca vuelve en silencio a los WebP.
- **Evidencia (QA del Taller, Chrome headless con ANGLE):** cuatro corridas 5/5,
  `t1024-20-flame-desktop` y `t1024-20-flame-mobile` en `.scratch/native-studio/`. En escritorio
  las URL y los hash descargados son los WebP del registro y las muestras de calidad de
  escritorio son idénticas a T-1024-14. En móvil descarga los dos `.ktx2` de arriba más
  `basis_transcoder.js/.wasm`; el formato de GPU que eligió `KTX2Loader` en ese navegador fue
  `RGBA_BPTC_Format` (BC7), 12 niveles, 16 B por bloque: 2.796.240 B + 5.242.960 B (igual a la fórmula, sin la LUT).
  Sin errores de página ni peticiones fallidas.
- **Deriva escritorio-móvil** (mismo paso y semilla; RGB 0-255 por canal; «región» = píxeles que
  el efecto toca en cualquiera de las dos capturas, «viewport» = toda la vista previa;
  `compare-native-drift.py`, también en `drift.json` y `drift.md` de la corrida móvil). El control es el
  paso que ambas corridas capturan en móvil (debe ser idéntico):

| comparison | step | seed | effect px | region MAE | region P95 | region max | viewport MAE | viewport P95 | viewport max |
|---|---|---|---|---|---|---|---|---|---|
| desktop vs mobile | 60 | 6371 | 2186 | 0.6296 | 3.0 | 22 | 0.0022 | 0.0 | 22 |
| desktop vs mobile | 240 | 6371 | 2987 | 0.5504 | 3.0 | 19 | 0.0026 | 0.0 | 19 |
| desktop vs mobile | 479 | 6371 | 3073 | 0.5324 | 3.0 | 19 | 0.0026 | 0.0 | 19 |
| control (mobile vs mobile) | 240 | 12345 | 3210 | 0.0 | 0.0 | 0 | 0.0 | 0.0 | 0 |

- **Sin medir:** un teléfono real; el tiempo de decodificación ASTC/ETC2 (aquí BC7 en escritorio); FPS.
  En una GPU sin ASTC, ETC2 ni BC7 el transcoder cae a RGBA8 sin comprimir (más de 30 MiB para
  NS_Flame_Single, por encima del tope): ese caso no se midió ni se cubre.

## Lectura de dispositivo en el Taller (T-1024-30)

Para medir en un teléfono real sin herramientas: con un efecto nativo listo, la línea «Coste
visual estimado» del Taller muestra lo que este dispositivo tiene en la GPU y cómo corre la página.

- `GPU: <formato> · <MiB>[ / 12 MiB]`: el formato que eligió `KTX2Loader` en este navegador
  (ASTC 4x4, BC7, ETC2, BC3 o PVRTC; RGBA8 si la GPU no tiene ninguno) o RGBA8 para los WebP de
  escritorio. La memoria es cada textura con su cadena de mips tal como quedó en este dispositivo
  (`nativeTextureBytes` en `src/editor/niagaraNative.js`) más la LUT de film (262.144 B). Con la
  calidad «Móvil» muestra el tope de 12 MiB y, si lo pasa, «Sobre el tope de GPU móvil»: el caso
  RGBA8 sin compresión ahora se ve, pero sigue sin manejarse.
- `Decodificación: <ms>`: `createImageBitmap` de los WebP o la transcodificación KTX2 de las dos
  texturas, desde que llegan los bytes ya verificados. «(primera carga)» incluye cargar el
  transcoder (`basis_transcoder.js/.wasm`) y arrancar su worker. La descarga con su SHA-256 queda
  aparte en `metrics.load.fetchMs`.
- `<n> FPS · peor cuadro: <ms>`: cuadros reales de la página en los últimos 2 s
  (`SkillPreview.frameRate`); el peor cuadro arrastra el tirón de la carga durante esos 2 s.

Cómo medir en un teléfono: abrir el Taller en el sitio en vivo (https; por http de LAN no existe
`crypto.subtle` y el efecto queda en error), elegir el efecto, dejarlo en bucle más de 2 s y anotar
la línea. Para la decodificación en caliente, elegir el otro efecto nativo y volver: la segunda
carga ya no dice «primera carga».

Evidencia en Chrome headless con ANGLE en esta máquina (no es un teléfono), cuatro corridas 5/5
`t1024-30-{bh,bh-m,fl,fl-m}` en `.scratch/native-studio/`. `qa-native-studio.mjs` ahora exige que
la lectura coincida con la GPU: el formato es el de las texturas cargadas, los bytes son la suma
de los mips transcodificados más la LUT y, con bloques de 16 B, los 8.650.816 / 8.301.344 B fijados
por la prueba del gate; el tope solo aparece en móvil; el texto muestra formato, MiB,
decodificación y FPS.

| efecto | calidad | formato | GPU (B) | decodificación primera / en caliente (ms) |
|---|---|---|---|---|
| BasicHit | escritorio | RGBA8 | 33.816.576 (32,25 MiB) | 95 / 244 (WebP, sin transcoder) |
| BasicHit | móvil | BC7 | 8.650.816 (8,25 MiB) | 654 / 328 |
| Flame | escritorio | RGBA8 | 32.418.468 (30,92 MiB) | 66 / 80 (WebP, sin transcoder) |
| Flame | móvil | BC7 | 8.301.344 (7,92 MiB) | 286 / 177 |

Los FPS de Chrome headless no significan nada (5 a 135, sin vsync real) y no se reportan como
medida. Sigue sin medir el teléfono mismo: esta lectura es el instrumento, y sus números van aquí
cuando Joi los tome.
