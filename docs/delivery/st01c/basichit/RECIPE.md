# NS_BasicHit: receta CPU compilada (T-1020-109)

Receta exacta del VM de CPU de los tres emisores de NS_BasicHit, derivada solo del HLSL compilado, de las tablas de
constantes del VM y de las LUT del T3D, y probada contra `basichit-reference03` sin leer estados capturados como entrada.
No es la simulación nativa: es el contrato para construirla sobre `tools/niagara-native-lab/core/`.

- Probador: `env -C "<worktree>" node .scratch/basichit-recipe/prove.mjs` (git-ignored). Verifica el hash de `report.json`,
  `system.t3d` y `native-values.json` contra [source-export-manifest.json](source-export-manifest.json), cada HLSL contra
  `report.json` y cada `particles/step_NNNN.json` contra [reference-checkpoint.json](reference-checkpoint.json).
  Imprime un JSON (errores por emisor y atributo en pasos 1..36, cuentas y orden de `uniqueId` en 0..240,
  `capturedStatesUsedAsInputs: 0`, citas de cada constante). Dos ejecuciones son idénticas byte a byte.
- Abreviaturas: `NN:l` = `.scratch/unreal/basichit-compiled/NN-*.hlsl` línea l (02/03 Flame, 06/07 Flash, 10/11 SimpleBurst,
  01 sistema; identidad en `report.json` scripts[].path). `T3D:l` = `.scratch/unreal/basichit-source/system.t3d` línea l.
  "VM" = tabla `InternalParameters` del `CachedScriptVM` del script (T3D:3338 Flame, 1762 Flash, 5204 SimpleBurst).

## Veredicto

| emisor | estados comparados | cuentas 0..240 | orden de IDs | atributos | veredicto |
|---|---|---|---|---|---|
| NE_Flame_Basic_001 | 23 | 241/241 | 241/241 | todos dentro de tolerancia; rotación, vida, edad, SubUV, RGB, posición y velocidad exactos | probado |
| NE_Basic_Flash001 | 17 | 241/241 | 241/241 | todos dentro de tolerancia; vida, edad, RGB, rotación, posición y velocidad exactos | probado |
| NE_SimpleBurst | 5.063 | 241/241 | 241/241 | todos dentro de tolerancia; vida, edad, RGB y rotación exactos | probado |

Tolerancias de `verify-native.mjs:19`; rotación y vida exigidas exactas (error 0). Unicidad de contadores en el paso 1
(probador, `counterUniqueness`): de los contadores 1..10 solo coinciden color Flame = 2, rotación Flame = 3, vida
SimpleBurst = 2, masa = 3, (rapidez, dirección) = (6, 7).

## Modelo de tiempo de emisión

1. Sin SpawnRate compilado: 01 solo tiene `EmitterState` y `SpawnBurst_Instantaneous` por emisor (01:775, 1098, 1421).
   El módulo SpawnRate 1 de Flame está deshabilitado (T3D:2969 `EnabledState=Disabled`), por eso no nace nada por tasa.
2. Ráfaga con SpawnTime 0 y cuentas 1 / 1 / 250 (01:1381, 1058, 735). Dispara si `0-(LoopedAge-dt) >= 0` y `0-LoopedAge < 0`
   (01:1372-1380), es decir en el primer tick. `InterpStartDt = 0-(LoopedAge-dt)`, `IntervalDt = 0` (01:1412-1413).
   Con primer delta 0,0001 s (microtick del piloto) o dt da +0 en ambos casos (el probador lo comprueba).
3. Bucle de 1 s (Flame, SimpleBurst; 01:1282, 636) y 0,970833 s (Flash, 01:959); al cumplirse, `EmitterChangeState`
   con NewState 1 (Inactive, modo Once; 01:1302-1303, 1340). No hay segunda ráfaga: 0 partículas de 36 a 240 (probado).
4. `uniqueId = TotalSpawned + ExecIndex` = 0..N-1 (02:1549, 06:1148, 10:1996). Semillas de la fixture 6371/6372/6373
   (`report.json` settings, `Emitter.Determinism_true` 02:597). Tick del RNG = paso - 1 (0 en el paso 1), como el piloto.
5. Nacimiento: el script de spawn interpolado ejecuta los módulos de spawn y después la actualización completa con
   `dt_u = DeltaTime - (InterpStartDt + SpawnInterval*índice)` (02:1242-1243, 1273; 06:904-905, 934; 10:1636-1637, 1666).
   Para la ráfaga `dt_u = DT` exacto: en el paso 1 la edad es `f32(1/60)`, las curvas se muestrean en `DT/vida` y
   SimpleBurst ya aplica arrastre e integra (posición = `v1*DT`). El contador aleatorio se reinicia antes de esa pasada (02:1444).
6. Pasos siguientes: script de actualización con `DT` sobre los vivos, en orden; los muertos salen sin reordenar.
   Sistema en el origen sin rotación (`tools/unreal-niagara-probe/capture_reference.py:269`), `localSpace` false.

## Orden de actualización (03:615-681, 07:599-660, 11:612-680; igual en la pasada dentro del spawn)

- Regla de edad y muerte (03:407-434): `age' = f32(age+dt)`; vive si `age' < f32(max(vida,1e-5) - 0,0001)`;
  `NA = f32(age' / max(vida,1e-5))` (división real). Mismas constantes en 07, 11, 02:1051-1053, 06:720-722, 10:1443-1445.
- Flame: ParticleState → curva alfa → ScaleColor → SolveForces (fuerza 0, arrastre 0, v = 0) → SubUV `f32(NA*40)` →
  curva tamaño → ScaleSpriteSize.
- Flash: ParticleState → curva alfa → ScaleColor → SolveForces (v = 0) → curva tamaño → ScaleSpriteSize. Sin SubUV.
- SimpleBurst: ParticleState → Drag (`PhysicsDrag = 0,75 + 0`, 11:431-438) → curva tamaño → SpriteSizeScale → curva alfa →
  ScaleColor → SolveForces: `v = f32(f32(f32(F/m)*dt) + v)` con F = 0; `DragIgnoreMass` true (11:670) ⇒
  `v' = f32(v / f32(f32(0,75*dt) + 1))` (11:492-512); `p' = f32(f32(v'*dt) + p)` (11:550-551).
- Color: `c = f32(inicial * f32(1 * (1,1,1,alfa)))`: RGB igual al inicial, alfa = curva (03:445-457). Tamaño:
  `s = f32(inicial * f32(curva*1))` en ambos ejes (03:588-594). Rotación: ningún script de update la toca.

## NE_Flame_Basic_001 (02 spawn, 03 update)

| atributo | fórmula f32 (orden del HLSL) | aleatorio (función, contador, comp.) | fuente | error máx. |
|---|---|---|---|---|
| vida | `0,4` = User.LifeTime, `lerp(PREV, actual, SpawnInterp=0)` | — | T3D:5671 ParameterData (205,204,204,62); 02:1272, 1392 | 0 |
| tamaño inicial | `f32(120 + f32(0*r))` = 120 | random3, 1, x | 02:697-698, 1348; VM 0000f042, 00000000 | — |
| tamaño | `f32(120 * f32(curvaTamaño(NA)*1))` | — | 03:571-594; LUT T3D:3401 | 5,34e-5 cm |
| color inicial | `f32(base_i * f32(min_i + f32(rango_i*r_i)))`, base (3470; 468,92; 65,6487; 1), min (0,7;0,7;0,7;1), rango (0,3;0,3;0,3;0) | random4, 2, xyzw | 02:755-756, 785-789, 1361; VM c375ea43 = 468,92 | RGB 0 |
| alfa | `f32(1 * f32(1*curvaAlfa(NA)))` | — | 03:436-457; LUT T3D:3343 | 4,47e-7 |
| rotación | `f32(0,25 + f32(0,25*r))`, constante en la vida | random3, 3, x | 02:794-795, 1385, 1390-1393 | 0 |
| MaterialRandom | `0 + f32(1*r)` (no capturado) | random3, 4, x | 02:1402 | — |
| posición | Owner (0) + SystemLocation offset 0; `f32(f32(0*dt)+p)` | — | 02:1031-1043, 1421; 03:521-522 | 0 |
| velocidad | 0 (AddVelocity deshabilitado) | — | T3D:2703 | 0 |
| edad | nacimiento `DT`; luego `f32(age+DT)` | — | 02:1243; 03:412 | 0 |
| SubUV | `f32(NA * 40)` | — | 03:564-569; VM 00002042 | 0 |

## NE_Basic_Flash001 (06 spawn, 07 update)

| atributo | fórmula f32 | aleatorio | fuente | error máx. |
|---|---|---|---|---|
| vida | `0,3` | — | 06:636; VM 9a99993e (umbral plegado 0,2999 = 7f8c993e) | 0 |
| tamaño | inicial (100,100); `f32(100 * f32(curvaTamaño(NA)*1))` | — | 06:669; LUT T3D:1828 | 4,58e-5 cm |
| color | inicial (37; 6; 0,7; 1); alfa por curva | — | 06:647; LUT T3D:1767 | RGB 0; alfa 8,34e-7 |
| rotación | 0 (`WriteSpriteRotation` false, valor por defecto 0) | — | 06:1018 | 0 |
| MaterialRandom | única llamada aleatoria (no capturada) | random3, 1, x | 06:1009 | — |
| posición / velocidad | Owner (0); v = 0 | — | 06:619-622 | 0 / 0 |
| edad | como Flame | — | 06:905; 07 | 0 |

## NE_SimpleBurst (10 spawn, 11 update)

| atributo | fórmula f32 | aleatorio | fuente | error máx. |
|---|---|---|---|---|
| (tamaño 0,2..0,5) | se calcula y se sobrescribe; solo consume el contador | random3, 1, x | 10:736-758, 1741 | — |
| vida | `f32(0,1 + f32(0,5*r))` | random3, 2, x | 10:760-782, 1755, 1790; VM 0,1 y 0,5 | 0 |
| masa | `f32(0,4 + f32(1,6*r))` (no capturada; probada vía tamaño) | random3, 3, x | 10:784-806, 1768, 1791 | — |
| (rotación 0..1) | descartada, `WriteSpriteRotation` false | random3, 4, x | 10:808-830, 1783, 1793 | — |
| MaterialRandom | no capturado | random3, 5, x | 10:1807 | — |
| tamaño inicial | `e = f32(pow(f32(f32(masa/8050)*1e6), 0,333333f))`; `(f32(1*e), f32(1*e))` (densidad tipo 1 = acero) | — | 10:971-1101, 1824-1838; VM 0090fb45, 00247449, 9faaaa3e | — |
| tamaño | `f32(inicial * f32(curvaTamaño(NA)*1))` | — | 11:440-463; LUT T3D:5209 | 1,28e-5 cm |
| rapidez | `f32(75 + f32(325*r))` | random3, 6, x | 10:1122-1144, 1855, 1858 | — |
| dirección | `φ = f32(0 + f32(6,28319f*u))`, `c = f32(-1 + f32(2*v))`, `s = f32(√f32(1 - f32(c*c)))`, `d = (f32(f32(cos φ)*s), f32(f32(sin φ)*s), c)` | random3, 7, xy (8: círculo descartado) | 10:1267-1302; VM e40fc940 = 6,28319f, no 2π | — |
| velocidad inicial | `f32(0 + f32(rapidez*d))` (rama de respaldo: partícula en el origen) | — | 10:1319-1342, 1403-1435, 1862 | — |
| velocidad | arrastre 0,75 por paso (sección anterior) | — | 10:1466-1473, 1526-1545; 11:431-512 | 3,05e-5 cm/s |
| posición | 0 al nacer; `f32(f32(v'*dt) + p)` | — | 10:1584-1585; 11:550-551 | 3,05e-5 cm |
| color | inicial (36; 7; 0,7; 1); alfa por curva | — | 10:907, 1792; LUT T3D:5310 | RGB 0; alfa 9,54e-7 |
| rotación | 0 | — | 10:1793 | 0 |
| edad | como Flame | — | 10:1637; 11 | 0 |

Cada literal usado existe bit a bit en la tabla VM de su script (el probador falla si no). El VM guarda los literales
redondeados del HLSL: 468,92 (c375ea43), no el valor de iteración rápida 468,919891 (bf75ea43) de `native-values.json`;
6,28319f (40c90fe4), no 2π (40c90fdb). Las constantes muertas (0,2 y 0,3 del tamaño de SimpleBurst) faltan en la tabla,
pero su llamada sigue avanzando el contador.

## Curvas (LUT)

| curva | objeto T3D (LUT) | muestras | minTime | inverseRange | atributo |
|---|---|---|---|---|---|
| Flame `Scale Alpha.FloatCurve001` | 3343 (3345-3398), claves 3344 | 54 | 0 (*) | 1 (*) | alfa |
| Flame `Value.Scale Factor.FloatCurve` | 3401 (3403-3480), claves 3402 | 79 | 0 (*) | 1 (*) | tamaño |
| Flash `Scale Alpha.FloatCurve001` | 1767 (1769-1822) | 54 | -0,004598 | 0,994286 | alfa |
| Flash `Value.Scale Factor.FloatCurve` | 1828 (1830-1907) | 79 | 0 (*) | 1 (*) | tamaño |
| SimpleBurst `Value.Scale Factor.FloatCurve` | 5209 (5211-5304) | 94 | -0,004598 | 0,994286 | tamaño |
| SimpleBurst `Scale Alpha.FloatCurve` | 5310 (5312-5365) | 54 | -0,004598 | 0,994286 | alfa |

- (*) No exportados: valen el defecto de la clase (0 y 1), que coincide con las claves 0..1 de la línea `Curve=`.
  `ShaderLUT(0)` ausente = 0 en las curvas de tamaño 0..2 (lineales). La alfa de Flame (claves 0..1) no es la del piloto,
  Flash y SimpleBurst (claves -0,004598..1,001149, igual que `pilot-source.json`).
- Enlace por `CachedDefaultDataInterfaces` (T3D:3489-3490, 1916-1917, 5377-5378). En SimpleBurst el orden se invierte:
  `_0` = tamaño, `_1` = alfa. Las copias del script de spawn (T3D:3193/3251, 1614/1675, 5037/5138) son idénticas.
- `core/curve.js` `sampleCurve` sirve tal cual con muestras, minTime e inverseRange redondeados a f32 al cargar;
  `validateCurve` sirve con su `sampleCount` por curva (54, 79, 94).

## Primitivas comunes

- Tal cual: `rng.js` random3/random4/uniformRange (los tres; float y float2 usan random3 .x/.xy, float4 random4);
  `curve.js` sampleCurve; `particle-state.js` DT, normalizedAge, ageParticle(p, dt, 0,0001), integrateVelocity
  (Flame y Flash con v = 0; SimpleBurst después del arrastre); `subuv.js` subUVFrame(NA, 40) solo para Flame.
- A generalizar (cambio exacto):
  - `ageParticle` y `normalizedAge`: usar `max(lifetime, f32(1e-5))` como 03:414 y 03:428. Sin efecto en estos datos.
  - `spawn-rate.js` `rateBirthAge`: rechaza `age >= dt`, pero la ráfaga nace con `age == DT` exacto. Cambiar la guarda a
    `age <= 0 || age > dt`, o extraer `spawnUpdateDt(start, interval, i, dt) = f32(dt - f32(start + f32(interval*i)))`
    para tasa y ráfaga.
  - Nacimiento: el piloto hacía `posición + velocidad*edad` y evaluaba curvas; es el caso sin arrastre de la regla general
    "módulos de spawn y luego una pasada completa de update con `dt_u`". El nativo de BasicHit debe usar la regla general.
  - `sampleCurve`: envolver `samples[j] - samples[i]` en f32 si alguna LUT rompe Sterbenz; los cargadores deben dar
    0 y 1 por defecto a minTime e inverseRange ausentes.
- Nuevas:
  - `burst`: SpawnBurst_Instantaneous (cuenta, SpawnTime, ventana de `LoopedAge`, InterpStartDt, IntervalDt 0) más
    EmitterState Once (duración de bucle; Inactive al cerrar el bucle).
  - `solveForcesWithDrag`: `v = f32(f32(f32(F*invMasa)*dt) + v)`, `v = f32(v / f32(f32(arrastre*dt) + 1))` (ignora masa),
    `p = f32(f32(v*dt) + p)`.
  - `randomUnitVector` + `addVelocityFromPoint` (solo la rama de respaldo, ver No resuelto 4), con 6,28319f.
  - `sizeFromMass` (rama sprite de CalculateSizeAndRotationalInertiaByMass): `pow(f32(f32(masa/densidad)*1e6), 0,333333f)`.
  - `scaleColor` (RGB × 1, alfa × curva) y `scaleSpriteSize` (ambos ejes × curva) sobre los valores `Initial`.
  - Rotación inicial uniforme y constante; plan de llamadas aleatorias por emisor que incluya MaterialRandom y descartes.

## Cadenas causales de lo inesperado

- AddVelocity [0,0,48,05644] de Flame no aparece: el nodo está deshabilitado (T3D:2703 `EnabledState=Disabled`), 02 no
  lo llama, la velocidad queda en el defecto 0 (02:1321). `native-values.json` lista los parámetros de iteración rápida
  también de módulos deshabilitados (lo mismo SphereLocation de Flame, T3D:2730).
- SpawnRate 1 no da nacimientos: deshabilitado (T3D:2969) y ausente de 01; solo queda la ráfaga.
- SubUV de 40 cuadros con atlas de 32: `SubUVAnimation.Number Of Frames` = 40 (`native-values.json`; 03:566; VM 00002042)
  mientras el renderer activo usa `SubImageSize` 8x4 (T3D:3520). El índice pasa de 32 con NA ≥ 0,8 (edad ≥ 0,32 s, paso ≥ 20).
  La simulación lo reproduce exacto; qué muestra el atlas a partir del cuadro 32 es cosa del renderer.
- Rotación de Flame distinta de 0: `WriteSpriteRotation` true con UniformRangedFloat001 0,25..0,5 (02:1390-1393), contador 3.
  El piloto no escribía rotación. Niagara la expresa en grados (< 0,5°).
- SimpleBurst: SphereLocation deshabilitado (T3D:4819) y GravityForce deshabilitado (T3D:4754): sin posición ni gravedad.
  El tamaño 0,2..0,5 se sobrescribe porque `CalculateMeshScale` es false (10:1090-1101, 1836) y el sprite toma el lado
  derivado de la masa; aun así consume el contador 1.
- Velocidad de SimpleBurst = `v1` tras arrastre en el paso 1 y posición = `v1*DT`: la pasada de update dentro del spawn
  aplica Drag antes de integrar (10:1895-1903, 1947-1949).

## No resuelto

1. Velocidad y posición de SimpleBurst no son bit a bit: al nacer, 54 de 250 componentes x y 49 de 250 y difieren en
   1-2 ulp; z (sin trigonometría) es exacto en 250/250. Máximo 3,05e-5 cm/s y 3,05e-5 cm (33 y 65 veces bajo tolerancia).
   Hipótesis: el VM usa el seno/coseno SIMD de la plataforma, no redondeado correctamente; ni el redondeo correcto, ni
   sse_mathfun (Cephes) ni el minimax de UE lo reproducen (`.scratch/basichit-recipe/diagnose.mjs`). Lo zanja una sonda
   que evalúe las operaciones `sin`/`cos` del VM sobre los 250 φ y vuelque los bits, o leer `VectorSin`/`VectorCos` de UE 5.8.
2. Residuos de tamaño y alfa (≤ 5,34e-5 cm, ≤ 9,54e-7): el T3D imprime `ShaderLUT`, `LUTMinTime` e `LUTInvTimeRange`
   con 6 decimales. Recalcular en f32 la LUT lineal 0..2 baja el tamaño de Flame de 5,34e-5 a 1,53e-5 (1 ulp,
   `.scratch/basichit-recipe/diagnose-lut.mjs`). En SimpleBurst se suma la `pow` del VM (implementación desconocida).
   Lo zanja una sonda que vuelque en bits `shader_lut`, `lut_min_time` e `lut_inv_time_range` de los seis objetos
   `...Script.NiagaraDataInterfaceCurve_N` y evalúe `pow` del VM sobre las 250 masas.
3. Sin campo en la captura, transcritos sin probar: Mass, MaterialRandom, RotationalInertia (10:1103-1114),
   DistanceTraveled y Previous.*. Haría falta ampliar el esquema `st01c-cpu-frame/v1` en una captura nueva.
4. AddVelocityFromPoint general (partícula fuera del origen, caída por distancia 100, `InvertVelocityFalloff` true,
   10:1347-1401) no se ejercita: este sistema siempre toma el respaldo aleatorio. Lo probaría una captura con
   SphereLocation activo o el actor fuera del origen.
5. Sin ejercitar: el `max(vida, 1e-5)`, `SpawnCountScale` distinto de 1 (01:741) y la interpolación de User.LifeTime
   cuando cambia entre ticks (02:1272). Los probaría una captura con escalabilidad o un parámetro de usuario animado.
