# BasicHit nativo en el Taller — T-1023-15

Implementación local, sin commit ni publicación. Solo `niagara-97a82bae61b29237`,
MyProject, queda listo mediante `niagara-native-v1` / `basichit-v1`.
No cambia gameplay, protocolo, SQL, versión ni los catálogos generados.

## Reutilización y contrato

Se reutilizan la simulación medida, las tres capas y el Filmic del laboratorio,
además de los PNG Unreal fijados por `reference-profiled-checkpoint.json`.
No se crea arte nuevo. `assets:find -- basichit` no encontró una pieza registrada;
`assets:check` reconoce las rutas del registro en código y no pidió una fila adicional.
Los dos WebP lossless conservan todos los bytes RGBA de los PNG: FireBall 2048×1024,
HitCircle 2048×2048. Escritorio carga estos dos archivos; el móvil carga sus gemelos KTX2 (sección «Variante móvil»).

Los documentos v3 exigen la identidad nativa y semilla entera 0–65533; conservan
los límites de presentación de flipbook. v1/v2 conservan sus contratos y sus
pruebas existentes no requirieron cambiar ninguna expectativa.

El tiempo se convierte con `nativeStep(t, impactAt, parameters)`, sin reloj:
antes del impacto devuelve -1; después floor((t-impactAt)×60×speed/duration+1e-6),
limitado a 480. La simulación se mueve mediante seek; el final por semilla se
calcula y almacena en caché. Para 6371 el primer paso vacío es 36.

## Cadena de imagen y recursos

Tras dibujar el escenario, se captura su geometría opaca con material de
profundidad sin escritura de color. Otro target RGBA16F transparente recibe la
misma profundidad y las tres capas con orden engine: Flash, SimpleBurst, Flame.
La llama conserva DepthFade 100 cm. La única modificación en los archivos
trasladados es el opt-in explícito de cámara perspectiva en `setDepth`.

Los shaders de sprites toman centros en coordenadas mundiales directamente:
el adaptador transforma sus atributos de instancia después del upload.
Multiplica X/Z por scale, Y por scale×height y añade 1 m a Y; multiplica ancho
por scale y alto de sprite por scale×height. No altera snapshots ni simulación.

NormalBlending acumula cobertura A como a + (1-a)×A y color HDR premultiplicado.
El composite devuelve opacity×film(brightness×tint×C), opacity×A y mezcla
ONE / ONE_MINUS_SRC_ALPHA sobre el escenario. Su fragmento deriva de
`filmFragment` por sustituciones con ancla única; una prueba reconstruye el
fragmento original y exige igualdad. `film-color.js` permanece intacto.
Los targets usan los píxeles del viewport del dispositivo y se redimensionan.

La carga verifica SHA-256 de los cuatro archivos antes de usarlos; epoch y
AbortController impiden publicar cargas canceladas. Al cambiar/cerrar se
liberan targets, LUT, texturas, bitmaps, geometrías y materiales. La QA observa
los eventos dispose de cada recurso GPU y el cierre de cada ImageBitmap,
además de cero recursos registrados y ninguna capa restante: 16/16 liberados
tanto al cambiar al flipbook como al cerrar. Es una comprobación de propiedad
y liberación, no una estimación de memoria del controlador GPU.

## Evidencia local

- `python tools/niagara-native-lab/build-native-assets.py --check`: exit 0,
  ambos `decodedRGBAIdentical: true`.
- Selección de cinco archivos de pruebas del ticket: exit 0, 29 pass / 0 fail.
- `npm run assets:check`: exit 0, 2792 archivos, 154 piezas, 114 problemas heredados.
- `node --test --test-concurrency=1 tools/niagara-native-lab/*.test.mjs`:
  exit 0, 66 pass / 0 fail.
- `node tools/niagara-native-lab/verify-basichit.mjs`: exit 0, 241 frames,
  5103 estados, checkpoint match true; digest default
  `edf4115394be6f61bca9da3a9c9dd5fe79a632254c14a9afb3b09e336b945139`.
- Prueba nueva en fixture sin docs/, tools/ ni node_modules/ propios:
  exit 0, 5 pass / 0 fail. Se añadió únicamente esta prueba a TESTS del actualizador.
- QA nativa `t1023-15-c`: exit 0, cinco comprobaciones; cero errores,
  escrituras GM y comandos de gameplay. Pasos 6/12: conteos 1/1/250 y
  1/1/196, 1039/3747 píxeles distintos del fondo; targets 878×722,
  iguales al viewport. También reproduce semilla 12345 con calidad móvil.
  Se inspeccionaron las capturas ES/EN. El fixture usa fuentes del sistema,
  sustituyendo solamente la hoja externa de Google Fonts por CSS vacío.

Evidencia: `.scratch/native-studio/t1023-15-c/evidence.json`, SHA-256
`294bff54dc1fe8885f9f8d281ba11710b6606fe75b2e9b0687c8e84c0e4c03af`.
Capturas: `native-step-6-6371-desktop.png`, `native-step-12-6371-desktop.png`,
`native-step-12-12345-mobile.png`, `native-en-mobile-quality.png`, en ese directorio.

Los runs previos se conservan: `t1023-15-a` falló por faltar signUp en el
fixture nuevo; `t1023-15-b` pasó imagen/conteos/liberación pero detectó
`net::ERR_NETWORK_ACCESS_DENIED` de un recurso externo. No se sobrescribieron.

## Pendiente y límites de aceptación

Comprobaciones del chef fuera del sandbox (T-1023-15, 2026-10-24):

- `tools/qa-niagara-studio.mjs`: su recorrido de derivados trataba toda entrada lista como flipbook;
  el chef lo limitó al adaptador `flipbook-v1` (una línea). Pasa 9/9.
- `tools/qa-native-studio.mjs t1023-15-chef`: 5/5, cero escrituras GM y cero comandos de juego.
- Laboratorio tras la opción de perspectiva de `setDepth`: gate de BasicHit `comparison.json`
  ffd36cdb y conjunto depth 292bfcef, iguales a los anteriores; pruebas del laboratorio 66/66.
- `tools/qa-skill-studio.mjs` (Tromba) falla igual sin este corte (exit 1 sobre el commit
  7cf33b4, con el trabajo apartado): el botón del Taller no llega a habilitarse en su fixture.
  Es un fallo previo de ese harness, no de la entrada nativa; queda abierto.

No se declara equivalencia con UE de los controles de presentación, del DepthFade en perspectiva,
de la composición sobre el escenario ni de la variante móvil; tampoco FPS físicos ni la aceptación
del autor.

## Variante móvil (T-1024-20)

Decisión de Joi (2026-10-24): KTX2 UASTC solo en móvil; el escritorio conserva los WebP sin
pérdida con sus pins, sin cambio de bytes. Resolución completa (sin reducir), calidad primero.
Con la calidad «Móvil» del Taller (o puntero grueso, o escenario de menos de 760 px) el efecto
carga `fireball-v1.ktx2` y `hit-circle-v1.ktx2` (`assets/vfx/niagara/native/basichit-v1/`) en lugar de los WebP; cambiar el selector recarga el efecto con el otro juego y
libera las texturas anteriores.

- **Tope de GPU:** 12 MiB = 12.582.912 B por efecto = las texturas del efecto con la cadena
  completa de mips + la LUT de film (32³ × 4 × 2 B = 262.144 B). Los render targets quedan fuera.
- **Fórmula:** 16 B por bloque 4×4 en cada nivel hasta 1×1, `sum(ceil(w/4) × ceil(h/4) × 16)`
  (la misma de `atlas-policy.js`). FireBall 2048×1024: 2.796.240 B; HitCircle 2048×2048: 5.592.432 B; total 8.388.672 B + LUT = **8.650.816 B** (68,8 % del tope; descarga 1.266.357 B frente a 486.256 B de los WebP).
  Una prueba del gate (`tests/niagara-native-studio.test.mjs`) lee la cabecera de cada KTX2
  en `assets/`, calcula esa suma y exige el total ≤ 12.582.912 B; otra fija el juego de escritorio.
- **Codificador:** `toktx v4.4.2`, receta `ktx2-uastc` de T-1020-66 (`atlas-build.py`):
  `--t2 --encode uastc --uastc_quality 4 --zcmp 3 --genmipmap --lower_left_maps_to_s0t0
  --assign_oetf srgb --assign_primaries srgb`, desde los mismos PNG que los WebP. Es
  reproducible: dos corridas de `python tools/niagara-native-lab/build-native-assets.py --toktx <toktx.exe>`
  dan los mismos cuatro sha256 (`--check` con el mismo `--toktx` los compara byte a byte).
  KTX2 (sha256): fireball `aff46550…98f`, hit-circle `01f395bc…5be`.
- **Carga:** `NativeEffect.setEffect(effect, { quality, renderer })`; con `quality: 'mobile'` descarga
  los `.ktx2`, comprueba su SHA-256 contra el pin y pasa los mismos bytes a `KTX2Loader`
  (three 0.160, transcoder `basis` del mismo CDN que three) que transcodifica a ASTC, ETC2 o BC7
  según la GPU y usa la cadena de mips guardada. Origen abajo-izquierda en la codificación, sin
  voltear en ejecución; sRGB. Si el KTX2 o el transcoder falla, el efecto pasa a su estado de
  error con el mensaje `KTX2 mobile texture failed: <url>: <causa>`: nunca vuelve en silencio a los WebP.
- **Evidencia (QA del Taller, Chrome headless con ANGLE):** cuatro corridas 5/5,
  `t1024-20-basichit-desktop` y `t1024-20-basichit-mobile` en `.scratch/native-studio/`. En escritorio
  las URL y los hash descargados son los WebP del registro y las muestras de calidad de
  escritorio son idénticas a T-1024-14. En móvil descarga los dos `.ktx2` de arriba más
  `basis_transcoder.js/.wasm`; el formato de GPU que eligió `KTX2Loader` en ese navegador fue
  `RGBA_BPTC_Format` (BC7), 12 niveles, 16 B por bloque: 2.796.240 B + 5.592.432 B (igual a la fórmula, sin la LUT).
  Sin errores de página ni peticiones fallidas.
- **Deriva escritorio-móvil** (mismo paso y semilla; RGB 0-255 por canal; «región» = píxeles que
  el efecto toca en cualquiera de las dos capturas, «viewport» = toda la vista previa;
  `compare-native-drift.py`, también en `drift.json` y `drift.md` de la corrida móvil). El control es el
  paso que ambas corridas capturan en móvil (debe ser idéntico):

| comparison | step | seed | effect px | region MAE | region P95 | region max | viewport MAE | viewport P95 | viewport max |
|---|---|---|---|---|---|---|---|---|---|
| desktop vs mobile | 6 | 6371 | 1075 | 0.7631 | 4.0 | 48 | 0.0013 | 0.0 | 48 |
| desktop vs mobile | 12 | 6371 | 3796 | 0.5836 | 3.0 | 49 | 0.0035 | 0.0 | 49 |
| control (mobile vs mobile) | 12 | 12345 | 3800 | 0.0 | 0.0 | 0 | 0.0 | 0.0 | 0 |

- **Sin medir:** un teléfono real; el tiempo de decodificación ASTC/ETC2 (aquí BC7 en escritorio); FPS.
  En una GPU sin ASTC, ETC2 ni BC7 el transcoder cae a RGBA8 sin comprimir (más de 30 MiB para
  BasicHit, por encima del tope): ese caso no se midió ni se cubre.
