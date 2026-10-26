# NS_BasicHit: simulación nativa (T-1021-03)

2026-10-21. Base: commit `f6b87c9`. Simulación CPU nativa de los tres emisores de `NS_BasicHit` sobre
`tools/niagara-native-lab/core/`, construida desde la receta probada [RECIPE.md](RECIPE.md). Sustituye como
evidencia versionada al probador `.scratch/basichit-recipe/prove.mjs` (git-ignored), que queda intacto:
la salida del binding es idéntica bit a bit a la del probador en los 241 pasos (comparación en `.scratch/t1021-03/`).
El piloto `NS_Flame_Single` no cambia: `verify-native`, `verify-update`, `verify-depth` y `verify-core` dan la misma
salida byte a byte que en `f6b87c9`.

## Qué se construyó

| archivo | papel |
|---|---|
| `tools/niagara-native-lab/prepare-basichit-source.mjs` | lee las entradas fijadas y escribe la fuente; nunca lee partículas capturadas |
| `tools/niagara-native-lab/basichit-source.json` | fuente versionada (44.617 bytes, sha256 `6388736b01d507edeeb18db23193be9ba4646185f3362332be2778d62f49950b`, bytes LF del árbol de trabajo, regla `eol=lf`) |
| `tools/niagara-native-lab/basichit-simulation.js` | binding de BasicHit sobre core; no lee `.scratch`, ni el T3D, ni el HLSL |
| `tools/niagara-native-lab/verify-basichit.mjs` | (a) comparación con `basichit-reference03`; (b) digests contra [simulation-checkpoint.json](simulation-checkpoint.json) |
| `tools/niagara-native-lab/basichit-simulation.test.mjs` | 6 tests del binding (solo leen la fuente versionada) |
| `tools/niagara-native-lab/core/` | primitivas nuevas: ver [CORE-MODULES.md](../CORE-MODULES.md), sección BasicHit; 9 tests nuevos en `core.test.mjs` |

### La fuente (`basichit-source.json`)

- Entradas leídas, cada una con su sha256 sobre los bytes en disco: `source-export-manifest.json` (fija el hash de
  `report.json` y de `system.t3d`), `basichit-compiled/report.json` (fija el hash de cada HLSL), los HLSL 01, 02, 03, 06, 07, 10
  y 11, y `basichit-source/system.t3d`. Falla si un hash no coincide.
- Constantes (47 registros en `constants`): el valor es la entrada de la tabla VM (`CachedScriptVM` `InternalParameters`)
  cuyos bits igualan al f32 del literal HLSL que nombra su papel. Cada registro guarda bits, nombre `InternalConstant_N`,
  línea del T3D de la tabla y líneas HLSL. Los rangos aleatorios se guardan como el VM: `min` y `span` = `max - min` plegado
  (0,5; 1,6; 325; 0,3; 0,25; 6,28319f y 2). 468,92 es `c375ea43`; el umbral de AddVelocityFromPoint es `fee6db2e`
  (`f32(1e-5)²`). `native-values.json` y los valores de iteración rápida no se leen.
- Única constante fuera de las tablas VM: `User.LifeTime` 0,4 de Flame, de `ExposedParameters` `ParameterData`
  (205,204,204,62), T3D:5671.
- Ráfaga y estado por emisor desde el script de sistema (01): cuenta 1 / 1 / 250 (float del VM, `SpawnCountScale` 1),
  `SpawnTime` 0, `IntervalDt` 0, bucle 1 / 0,970833 / 1 s, modo Once (`EmitterChangeState` con NewState 1 al cerrar el bucle).
- LUT: las seis curvas como f32 exactos de `ShaderLUT(i)` (54/79, 54/79, 54/94 muestras), con `minTime` e `inverseRange`
  (0 y 1 por defecto cuando el T3D no los exporta y las claves van de 0 a 1); la copia del script de spawn debe ser idéntica.
- Plan de llamadas aleatorias por emisor (contador, función, componente, papel, línea HLSL), con MaterialRandom y descartes;
  el orden de las llamadas de nivel superior en `SimulateMapSpawn` se comprueba.
- Nodos deshabilitados del grafo (AddVelocity, SphereLocation y SpawnRate de Flame; GravityForce y SphereLocation de
  SimpleBurst) con su línea `EnabledState=Disabled`; el script falla si alguno aparece compilado. No hay SpawnRate en 01.
- Determinista: dos ejecuciones dan bytes idénticos.

## API del binding

```js
import { BasicHitSimulation, CONTROL_SPEC, MAX_STEP, NAMES } from './basichit-simulation.js';
const sim = new BasicHitSimulation(source, { seed: 6371 }); // valida la fuente; `source` no se modifica
sim.seek(step);   // 0..480: avanza o reinicia y devuelve snapshot(); un paso inválido lanza
sim.advance();    // un paso fijo de f32(1/60); lanza al pasar de 480 (8 s)
sim.snapshot();   // copia profunda del estado público
sim.configure({ seed }); sim.reset();
```

- Igual que el piloto donde el concepto aplica: constructor con fuente y controles, `configure`, `reset`, `advance`, `seek`,
  `snapshot`, `CONTROL_SPEC`, límite de 480 pasos. Sin `smokeSpeed`, `smokeLife` ni `stopAt`: el efecto es una ráfaga única.
- `seed` (entero 0..65533, por defecto 6371): el emisor i usa `seed + i`, como `fixtureSeedBase + índice` de la referencia.
- Snapshot `st01c-basichit-frame/v1`: `{ systemAge, emitters: [{ name, particles }] }`, emisores en el orden de `NAMES`.
  Cada partícula: `uniqueId, position, velocity, size, color, rotation, age, lifetime` y `subImage` solo en Flame.
  `Initial.*` y la masa quedan internas. Posiciones en espacio de mundo relativas al origen del sistema, sin rotación.
- Un paso: (1) script de update con DT sobre los vivos, en orden; los muertos salen sin reordenar. (2) Por emisor,
  `emitterStateOnce` y `burstWindow`; si dispara, cada nacimiento ejecuta los módulos de spawn y una pasada de update con
  `burstBirthAge` (= DT). Tick del RNG = paso - 1.

## Comandos

```bash
node tools/niagara-native-lab/prepare-basichit-source.mjs [--out <ruta>]
node tools/niagara-native-lab/verify-basichit.mjs [--checkpoint <ruta>]
node tools/niagara-native-lab/verify-basichit.mjs --write-checkpoint   # regenera el checkpoint; solo si (a) pasa
node --test tools/niagara-native-lab/core.test.mjs tools/niagara-native-lab/basichit-simulation.test.mjs
```

`verify-basichit.mjs` sin opciones no escribe nada: imprime una línea JSON (sin tiempos ni rutas absolutas) y sale con 1 ante
cualquier fallo, también si el checkpoint falta, no es JSON o difiere. Lee la fuente versionada,
[reference-checkpoint.json](reference-checkpoint.json) y la ejecución `.scratch/unreal/basichit-reference03`
(`capture-report.json` y los 241 `particles/step_NNNN.json`, cada uno contra su hash fijado). Semillas: `fixtureSeedBase` 6371 más
el índice de cada handle (6371, 6372, 6373), comprobadas contra `capture-report.json` y el checkpoint de referencia.

## Resultados

`basichit-reference03`: 241 fotogramas, 5.103 estados comparados (Flame 23, Flash 17, SimpleBurst 5.063), cuentas y orden
de `uniqueId` iguales en los 241 pasos de los tres emisores, 0 estados capturados como entrada. Dos ejecuciones del
verificador dan salida idéntica byte a byte (sha256 de stdout `117f90cf28fe8266a0757fc2b45d54cfa80a134d8ba7fd88dc320d36bba308c9`).

| atributo | tolerancia (`verify-native.mjs`) | NE_Flame_Basic_001 | NE_Basic_Flash001 | NE_SimpleBurst |
|---|---|---|---|---|
| posición (cm) | 0,002 | 0 | 0 | 3,05e-5 (paso 33) |
| velocidad (cm/s) | 0,001 | 0 | 0 | 3,05e-5 (paso 1) |
| tamaño (cm) | 0,001 | 5,34e-5 (paso 5) | 4,58e-5 (paso 4) | 1,28e-5 (paso 31) |
| RGB | 0,00001 | 0 | 0 | 0 |
| alfa | 0,00001 | 4,47e-7 (paso 14) | 8,34e-7 (paso 7) | 9,54e-7 (paso 4) |
| SubUV | 0,001 | 0 | — | — |
| edad (s) | exacta (límite 0,00001) | 0 | 0 | 0 |
| rotación | exacta | 0 | 0 | 0 |
| vida (s) | exacta | 0 | 0 | 0 |

Checkpoint ([simulation-checkpoint.json](simulation-checkpoint.json)): sha256 de la fuente y cuatro digests (semilla por defecto,
0, 12345 y 65533) de `JSON.stringify` de cada snapshot de los pasos 0..480 más `seek(12)` hacia atrás. Lo escribió
`--write-checkpoint` sobre este árbol; la ejecución por defecto lo compara entero.

## Residuos aceptados

1. Velocidad y posición x/y de SimpleBurst a 1-2 ulp: el VM no usa el seno/coseno de JS (RECIPE.md, No resuelto 1). Sin
   emulación del seno/coseno del VM.
2. Tamaño y alfa: el T3D imprime `ShaderLUT`, `LUTMinTime` y `LUTInvTimeRange` con 6 decimales; en SimpleBurst se suma la
   `pow` del VM (No resuelto 2).
3. `core/curve.js` `sampleCurve` resta muestras en doble precisión; `FMath::Lerp` resta en f32. En estas LUT la resta solo es
   inexacta en f32 en 1 de los 93 intervalos de la curva de tamaño de SimpleBurst. Sin cambio: `sampleCurve` es la del piloto
   y el error queda bajo tolerancia.

## No aceptado / pendiente

- Lado de render (shaders, SubUV en el atlas 8x4, DepthFade, `validateFrame`, QA en navegador): fuera de este encargo.
  El índice SubUV de Flame pasa de 32 desde el paso 20 (40 cuadros); qué muestra el atlas allí es cosa del renderer.
- Sin probar con captura (RECIPE.md, No resuelto 3-5): masa, MaterialRandom (no se calcula: el RNG va por contador),
  RotationalInertia, la rama general de AddVelocityFromPoint (falla con un error), una fuerza distinta de 0, el
  `max(vida, 1e-5)` (no se aplica: vida y edad ya son exactas sin él), `SpawnCountScale` distinto de 1 y `User.LifeTime` animado.
- Pasos 241..480: no hay referencia (la captura da 0 partículas de 36 a 240). El modelo Once no vuelve a emitir. Sin probar
  qué hace UE cuando se cierra el bucle de 5 s del sistema (01:390) en el paso 300; lectura del HLSL: tras cerrar su bucle el
  emisor queda con fuente de estado 1 (01:693) y `EmitterChangeState002` solo lo cambia si su fuente es <= la del sistema
  (01:470, 691). Lo probaría una captura de más de 5 s.
- El primer delta de activación de UE (0,0001 s del piloto) no se modela: con él o con DT, `InterpStartDt` es +0 y la ráfaga
  nace igual (test de `burstWindow`); solo movería el cierre del bucle, que no tiene efecto visible.
- Transformación del actor: el binding simula en el origen sin rotación; el juego debe trasladar las posiciones.
