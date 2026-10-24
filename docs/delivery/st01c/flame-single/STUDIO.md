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
cubre los cuatro WebP). Escritorio y móvil cargan los mismos dos archivos.

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
