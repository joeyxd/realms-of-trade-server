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
HitCircle 2048×2048. Escritorio y móvil cargan los mismos dos archivos.

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
