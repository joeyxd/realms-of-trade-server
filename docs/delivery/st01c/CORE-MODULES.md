# ST01c — módulos comunes de simulación

2026-10-20. Base: commit `6cd29b4`. Las primitivas de simulación del piloto `NS_Flame_Single`
pasan a `tools/niagara-native-lab/core/`, con firmas que reciben como parámetro lo que la
segunda familia (`NS_BasicHit`) cambiará: número de muestras de la curva, fotogramas de SubUV,
épsilon de muerte. La salida del piloto no cambia ni un bit.

## Qué se movió

| Primitiva | Módulo | Export | Quién la llama |
|---|---|---|---|
| RNG compartido VM/GPU | `core/rng.js` | `random3`, `random4` | `native-simulation.js` (reexportadas para sus tests) |
| Interpolación uniforme | `core/rng.js` | `uniformRange` | `native-simulation.js` (como `range`) |
| Muestreo de la LUT | `core/curve.js` | `sampleCurve` | ambas etapas; `update-simulation.js` la reexporta para conservar su API (hoy nadie la importa de allí) |
| Validación de la LUT | `core/curve.js` | `validateCurve` | ambas etapas: 54 muestras, 0..2, con sus mensajes actuales |
| Acumulador de tasa | `core/spawn-rate.js` | `rateStep`, `rateBirthAge` | `native-simulation.js` (ids, `stopAt` y límite de 512 siguen allí) |
| Paso de tiempo | `core/particle-state.js` | `DT` | ambas; `update-simulation.js` la reexporta |
| Edad normalizada | `core/particle-state.js` | `normalizedAge` (división, VM compilada), `normalizedAgeByReciprocal` (laboratorio de actualización) | `native-simulation.js`; `update-simulation.js` |
| Envejecer y matar | `core/particle-state.js` | `ageParticle(p, dt, killEpsilon)` | `null`: muere en `lifetime` (actualización); `.0001`: `lifetime - .0001` (ParticleState compilado) |
| Integrar posición | `core/particle-state.js` | `integrateVelocity` | ambas |
| Fotograma SubUV | `core/subuv.js` | `subUVFrame` | ambas |

Las dos reglas de edad y de muerte son hechos distintos de cada etapa y se conservan con su nombre.
`NAMES`, `CONTROL_SPEC`, `validate` y las recetas de nacimiento (esfera, cilindro, contadores
1/2/4 y 1/5) siguen en `native-simulation.js`: son las ataduras del piloto, no código común.

## Prueba

- `node tools/niagara-native-lab/verify-core.mjs`: los siete digests (cinco nativos, dos de
  actualización; pasos 0..480 más `seek(37)`) igualan a [core-checkpoint.json](core-checkpoint.json),
  calculado sobre `6cd29b4`; dos corridas dan salida idéntica. Lee la fixture ignorada por git
  `.scratch/unreal/reference11/update-fixture.json`.
- Los 19 tests unitarios existentes pasan sin cambios; `core.test.mjs` añade 10.
- La salida de `verify-native`, `verify-update` y `verify-depth` es idéntica byte a byte a la de la base.

## No aceptado / pendiente

- Lado de render sin extraer: shader del sprite, matemática de UV del SubUV en `particles.js`,
  DepthFade duplicado en `particles.js` y `depth-stage.js`, y `validateFrame` con nombres fijos
  y `subImage` obligatorio.
- Capacidades de BasicHit no añadidas, porque el plan las incorpora solo contra su fuente efectiva:
  ráfaga (burst), arrastre (drag), AddVelocityFromPoint, rotación aleatoria, FaceCameraPosition
  y el material radial.
- Los `codeHashes` de los checkpoints render/update/native/depth/color son instantáneas fechadas que
  ningún comando vuelve a comprobar. Los archivos cambiados aquí las vuelven históricas:
  `tools/niagara-native-lab/native-simulation.js`, `tools/niagara-native-lab/update-simulation.js`
  (y los nuevos `core/*.js`). No se regeneró ninguna.

## BasicHit (T-1021-03)

2026-10-21. Base: commit `f6b87c9`. Primitivas que pide la receta de `NS_BasicHit`
([basichit/RECIPE.md](basichit/RECIPE.md)), usadas por `tools/niagara-native-lab/basichit-simulation.js`
([basichit/SIMULATION.md](basichit/SIMULATION.md)). El piloto no llama a ninguna nueva; su salida no cambia.

| Primitiva | Módulo | Export | Quién la llama |
|---|---|---|---|
| Rango aleatorio plegado | `core/rng.js` | `uniformSpan(min, span, r)` = `min + span*r`, la forma del VM (guarda `Max - Min` plegado); igual a `uniformRange` con `span = f32(max - min)` | BasicHit (tamaño, color, rotación, vida, masa, rapidez) |
| Vector unitario aleatorio | `core/rng.js` | `randomUnitVector(random, min, span)`: φ y cos θ de un float2, `sqrt(1 - c²)`; cos/sin de JS | BasicHit (dirección de respaldo de SimpleBurst) |
| Tiempo de update del spawn | `core/spawn-rate.js` | `spawnUpdateDt(start, interval, i, dt)` = `dt - (start + interval*i)` | `rateBirthAge` (piloto) y `burstBirthAge` |
| EmitterState Once | `core/burst.js` | `emitterStateOnce(state, delta, loopDuration)`: edad del bucle; al cerrarlo, 0 e Inactive para siempre | BasicHit |
| Ventana de la ráfaga | `core/burst.js` | `burstWindow(spawnTime, loopedAge, delta)`: SpawnBurst_Instantaneous, `InterpStartDt` | BasicHit |
| Edad de nacimiento de la ráfaga | `core/burst.js` | `burstBirthAge(interpStartDt, intervalDt, i, dt)`, guarda (0, dt] | BasicHit |
| Arrastre | `core/physics.js` | `dragVelocity(v, drag, dt)` = `v / (max(drag,0)*dt + 1)` (fuerza 0, `DragIgnoreMass`) | BasicHit (SimpleBurst, 0,75) |
| AddVelocityFromPoint | `core/physics.js` | `addVelocityFromPoint(v, p, origen, fuerza, respaldo, umbral²)`: solo la rama de respaldo; otra geometría lanza un error | BasicHit (SimpleBurst) |
| Tamaño desde la masa | `core/physics.js` | `sizeFromMass(masa, densidad, escalaVolumen, exponente)`: `pow(max(0, masa/densidad*escala), exponente)`; `pow` de JS | BasicHit (SimpleBurst, acero 8050) |
| Escalar color y tamaño | `core/particle-state.js` | `scaleColor(inicial, alfa)` (RGB × 1, alfa × curva), `scaleSpriteSize(inicial, factor)` (ambos ejes) | BasicHit (los tres emisores) |

- Por qué `burstBirthAge` es aparte: la ráfaga nace al principio del tick y su pasada de update dura `dt` exacto, y la
  guarda de `rateBirthAge` (`[0, dt)`, la del piloto) lo rechaza. Aflojarla aceptaría en el piloto una edad que nunca se
  probó. Se comparte solo la fórmula, `spawnUpdateDt`: `rateBirthAge` la llama y da los mismos bits (los siete digests de
  `verify-core.mjs` y las salidas de `verify-native`, `verify-update` y `verify-depth` no cambian).
- Sin cambios en `ageParticle`, `normalizedAge`, `sampleCurve`, `validateCurve`, `integrateVelocity`, `subUVFrame`,
  `random3`, `random4` ni `uniformRange`: BasicHit los usa tal cual. Sin `max(vida, 1e-5)`: la receta iguala vida y edad
  sin él.
- `burst.js` importa `spawnUpdateDt` de `spawn-rate.js`: core sigue sin E/S ni imports de fuera de `core/`.
- Tests: 9 nuevos en `core.test.mjs` (19 en total) más 6 de `basichit-simulation.test.mjs`; la suite completa
  pasa de 29 a 44.
- Ningún `codeHashes` fechado (render/update/native/depth/color) fija archivos de `core/`, y `native-simulation.js` y
  `update-simulation.js` no cambian: esos checkpoints no varían con este encargo. `core-checkpoint.json` tampoco.

## Render (T-1021-22)

2026-10-21. Base: commit `2b01a28`. Parte 1 de 2: las primitivas de render del piloto (shader del sprite, UV del
atlas SubUV, DepthFade y validación de frames) pasan a `tools/niagara-native-lab/core/`, con la forma que necesitarán
los tres emisores de `NS_BasicHit` en el próximo encargo. Solo refactor: sin página de BasicHit y sin comportamiento
nuevo en el shader del piloto. La salida del piloto no cambia ni un píxel. Los cuatro módulos son ES puros, sin
Three.js ni E/S: GLSL como cadenas exportadas y funciones JS; el material Three.js se sigue construyendo en
`particles.js`.

| Primitiva | Módulo | Export | Quién la llama |
|---|---|---|---|
| DepthFade, fuente única | `core/depth-fade.js` | `DEPTH_FADE_DISTANCE` (el único valor por defecto: 100 cm = 1,0 unidad de escena), `depthFactor(escena, píxel, distancia)` (JS) y `DEPTH_FADE_GLSL` (uniforms `opaqueDepth`, `depthSize`, `nearFar`, `orthographic`, `depthFadeDistance`; `viewDepth`, `depthFade()`) | `particles.js` (la constante; el GLSL llega por `sprite-shader.js`); `depth-stage.js` reexporta `depthFactor` para `depth-stage.test.mjs` |
| UV del atlas SubUV | `core/subuv-atlas.js` | `SUBUV_ATLAS_UV_GLSL` (`subUVAtlasUv`: floor y clamp a la última celda, filas desde arriba), su gemelo JS `subUVAtlasUv`, `validateGrid` (enteros >= 1; 1x1 permitido) | `sprite-shader.js`; tests |
| Shader del sprite | `core/sprite-shader.js` | `SPRITE_CORNER_GLSL` (rotación con la base Y hacia abajo de UE), `SPRITE_FACING_GLSL` y `SPRITE_FACINGS` (solo `camera-plane`), `SPRITE_VERTEX_SHADER`, `SPRITE_FRAGMENT_SHADER` (`#ifdef SPRITE_TEXTURE`, `#ifdef DEPTH_FADE`), `spriteLayer({ grid, texture, depthFade, facing })` | `particles.js` |
| Validación de frames | `core/frame-spec.js` | `frameSpec({ schemas, emitters: [{ name, subImage }], limit })`, `validateFrame(frame, spec)`, `BASICHIT_FRAME_SPEC` | `particles.js` (su `validateFrame(frame)` es la atadura del piloto); tests |

- Opciones por capa como datos: `spriteLayer` valida la rejilla, la textura (sí/no), el DepthFade (`null` = apagado, o
  la distancia en unidades de escena) y la orientación, y devuelve los `#define` del material. Un único par de shaders
  sirve a todas las capas. Sin textura, el texel es blanco: hueco para SimpleBurst; su material radial no se porta aquí.
- DepthFade: la distancia es un uniform (`depthFadeDistance`) en lugar del `1.0` fijo. El interruptor de ejecución
  `depthFadeEnabled` (hay superficie opaca y la casilla está activa) sigue igual, y solo existe en capas con `DEPTH_FADE`.
- Orientación: sigue el billboard en el plano de la cámara. `SPRITE_FACINGS` y `spriteViewPosition` en
  `SPRITE_FACING_GLSL` son el lugar con nombre donde irá FaceCameraPosition; `spriteLayer` rechaza hoy cualquier otro valor.
- SubUV: la política sigue siendo el clamp actual a `columnas*filas - 1`. Wrap o clamp más allá de la rejilla se decide
  en el próximo encargo (la Flame de BasicHit pasa de 32 en el paso 20 con 40 fotogramas sobre 8x4).

**Lo que sigue siendo del piloto** (`particles.js`): `PILOT_FRAME` (los tres esquemas `st01c-cpu-frame/v1`,
`st01c-update-frame/v1` y `st01c-native-frame/v1`; `NE_Flame_Basic_001` y `NE_Smoke_Basic` con `subImage` obligatorio;
512 partículas), las capas `FLAME` (8x4) y `SMOKE` (10x6) con textura y DepthFade de 100 cm (MI_Flame_2 y MI_Smoke_1
sobre el padre M_Smoke), `toScene`, el paso de tamaño de cm a m, los búferes de 512 y la clase `PilotParticles`. Su API
no cambia: constructor, `setDepth`, `update`, `dispose` y los exports `PilotParticles`, `toScene` y `validateFrame`; la
capa de índice >= 1 sigue usando la rejilla del humo. `lab.js`, `depth-lab.js`, `color-lab.js` y `budget-lab.js` no cambian.

**Spec de BasicHit.** `BASICHIT_FRAME_SPEC`: esquema `st01c-basichit-frame/v1`; `NE_Flame_Basic_001` con `subImage`
obligatorio; `NE_Basic_Flash001` y `NE_SimpleBurst` con `subImage` opcional (puede faltar; si está, finito y >= 0);
límite 512 por emisor. Los nombres son los `emitterNames` de `basichit-source.json` (lo comprueba un test). Acepta todos
los frames de `BasicHitSimulation` con la semilla por defecto, pasos 0..240, y rechaza dos emisores, un nombre o un orden
cambiado, una Flame sin `subImage`, un `subImage` opcional NaN, infinito, null, texto o negativo, 513 partículas y el
esquema del piloto. Vive en `core/` porque aún no existe la atadura de render de BasicHit.

### Prueba

- Tests: `render-core.test.mjs` añade 9; la suite pasa de 44 a 53, sin fallos. La tabla del piloto (4 aceptaciones,
  25 rechazos con su clase de error y su mensaje, y los frames nativos 0..480) se escribió y pasó contra `2b01a28` antes
  del refactor, y pasa igual después.
- Los cinco gates numéricos no cambian: `verify-core` 8d46fe1f, `verify-native` 984ad3fe, `verify-update` 2b3558e2,
  `verify-depth` b2e81759, `verify-basichit` 117f90cf (sha256 de la salida, primeros 8 caracteres).
- Píxeles: `check-pixels.py <carpeta-a> <carpeta-b> [--exclude <glob>]` decodifica cada PNG a RGBA con Pillow y exige
  igualdad exacta; imprime una línea por archivo y `identical N/N`, y sale con 1 ante una diferencia, un archivo que
  falta o nada comparado. Protocolo: copia de la evidencia previa en `.scratch/render-core/pre/`; con el código sin
  cambiar, dos corridas de cada página QA del piloto (`base-a`, `base-b`); con el código final, una (`after`). Cada
  carpeta guarda solo los archivos que escribió esa corrida; las corridas de atlas usan nombres nuevos (`rcore-*`),
  movidos después a `render-core`.

| Familia | Script | PNG comparados (canvas) | base-a vs base-b | after vs base-a |
|---|---|---|---|---|
| browser-lab | `qa.mjs` (reference11) | 16 (3) | 16/16 | 16/16 |
| native-birth | `qa-native.mjs` | 12 (6) | 12/12 | 12/12 |
| native-update | `qa-update.mjs` | 8 (3) | 8/8 | 8/8 |
| depth-lab | `qa-depth.mjs depth02` | 50 (22) | 50/50 | 50/50 |
| color-lab | `qa-color.mjs color07` | 23 (16) | 23/23 | 23/23 |
| atlas | `qa-atlas.mjs`, 8 variantes | 2152 (2144) | 2152/2152 | 2152/2152 |

- Los 2.194 PNG de canvas son idénticos en las dos comparaciones. También lo son las capturas de página completa,
  salvo una clase: `atlas/*/mobile-layout.png` (8) queda excluida porque base-a y base-b difieren en
  `quarter/mobile-layout.png` en 1 píxel (56, 1079), azul 82 frente a 81, dentro del texto de estado «22 partículas»:
  suavizado de texto del navegador, no WebGL. Sin la exclusión, base-a vs base-b y after vs base-a dan 2159/2160, y
  after vs base-b da 2160/2160.
- En el primer intento de la corrida final, `qa-update.mjs` agotó su espera de 30 s al volver al modo observado
  (`qa-update.mjs:57`, 241 frames pedidos a la vez); pasó en dos repeticiones aisladas y en las otras tres corridas, y la
  corrida `after` completa se repitió desde cero. Una corrida intermedia (`after-r1`, el mismo código salvo un comentario
  de `particles.js`) también dio todos los PNG idénticos a `base-a`, con la misma exclusión.
- Corrida nueva reproducible (`qa-depth.mjs` contra `base-a`) en el [README](../../../tools/niagara-native-lab/README.md).
- Las variantes que el piloto no usa (1x1, sin textura, sin DepthFade) solo se compilaron y dibujaron en Chrome headless
  con una comprobación local no versionada: cuatro programas, sin errores de shader. Ningún corpus las cubre todavía.

sha256 de los archivos de este encargo:

| Archivo | sha256 |
|---|---|
| `tools/niagara-native-lab/particles.js` | `fa848316e2e19ee9a23689dbe4647c6e2d88b30cc4c8ad8f1e31959c7278a38a` |
| `tools/niagara-native-lab/depth-stage.js` | `3e349e914598478eb84f8b12fefe76a91a83d0d12195a290bd2d57d450d4fa81` |
| `tools/niagara-native-lab/core/depth-fade.js` | `133024f304b6695c6951fb2ca1fdea18bfcb270f43fe5dbe355c11fec03c4b10` |
| `tools/niagara-native-lab/core/subuv-atlas.js` | `5b6108149362c2bab3daf2ce3e3f645942441bf72af2325fa3e4becb6cf322f1` |
| `tools/niagara-native-lab/core/sprite-shader.js` | `f892de19848d27452a856ce174a83b112bbe4e84450a3c9c2909b235916fce82` |
| `tools/niagara-native-lab/core/frame-spec.js` | `3a62eb522e2129bb4a27e62b67bd11dcf81922531521d0bb8f903a6f9b6534e5` |

### No aceptado / pendiente

- Todo lo anterior está pendiente de aceptación del autor.
- No hecho aquí (próximo encargo): página, QA y comparación de BasicHit; FaceCameraPosition; el material radial de
  SimpleBurst; la política SubUV más allá de la rejilla; el orden de dibujo; los umbrales de BasicHit. El texel blanco sin
  textura es un hueco, no el material de ningún emisor.
- `BASICHIT_FRAME_SPEC` vive en `core/` hasta que exista la atadura de render de BasicHit; `toScene` y el paso de tamaño
  cm a m siguen en `particles.js`.
- Los `codeHashes` de `depth-checkpoint.json` (que fija `particles.js` 1e936b7c y `depth-stage.js` a6882c90),
  `native-checkpoint.json`, `render-checkpoint.json` y `update-checkpoint.json` y las listas de peticiones de los
  checkpoints de color y profundidad quedan como historia: las páginas piden ahora también los cuatro módulos de `core/`
  (por eso `nativeOnlyRequests` de `qa-native` pasa de 23 a 27 y `updateOnlyRequestCount` de `qa-update` de 24 a 28). No
  se regeneró ninguno.
- `qa-depth.mjs` y `verify-depth.mjs` conservan su propio valor esperado (`gap / 100` saturado): es el oráculo de la
  comparación, no el shader.
