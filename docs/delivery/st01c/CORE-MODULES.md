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
