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
