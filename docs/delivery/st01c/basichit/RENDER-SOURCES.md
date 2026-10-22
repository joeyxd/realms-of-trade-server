# NS_BasicHit: fuentes de render (T-1021-41)

Solo datos de motor UE 5.8.0 leídos con el proyecto aislado `ST01c_Pilot`: la función de material
`RadialGradientExponential` (y `ExponentialDensity`, que ella llama) exportadas a T3D, y los campos de muestreo de las
cuatro texturas de BasicHit. No hay atadura de render ni comparación de píxeles. Datos legibles por máquina:
[render-sources.json](render-sources.json). Sondeo: `tools/unreal-niagara-probe/probe_engine_assets.py`, consulta
`tools/unreal-niagara-probe/queries/basichit-render.json`.

## Umbrales del binding BasicHit (decisión del autor, 2026-10-21)

Escritos antes de la primera ejecución del binding. Se reutiliza el precedente del piloto
(`docs/briefs/st01c-niagara-native-fidelity.md`, líneas 88 y 103-104):

- IoU de máscara >= 0,94 contra la imagen final de Unreal.
- Diferencia RGB media <= 10/255 sobre la unión visible.
- Mismas definiciones de máscara y unión que el gate del piloto: máscara = canal máximo > 32 en cada imagen; unión
  visible = canal máximo > 8 en cualquiera de las dos; 512 px; misma presentación ACES para ambas
  (`tools/niagara-native-lab/compare-depth.py` líneas 15-24 y `compare-color.py` líneas 28-37).
- Dos ejecuciones idénticas.

No se ajusta ningún umbral después de ver resultados.

## RadialGradientExponential

Origen: `.scratch/unreal/engine-assets01/RadialGradientExponential.t3d` (RGE) y `ExponentialDensity.t3d` (ED); las
dos ejecuciones son idénticas byte a byte. Citas `archivo:línea` del T3D exportado; reglas de motor en
`Engine/Source/Runtime/Engine`.

### Entradas

| entrada | tipo | por defecto | evidencia |
|---|---|---|---|
| UVs | Vector2 | TexCoord[0] (tiling 1, 1) | RGE:154-161; TexCoord_7 en RGE:300-304 sin propiedades |
| CenterPosition | Vector2 | (0,5; 0,5) | RGE:128-134 |
| Radius | Scalar | 0,5 | RGE:141-147 |
| Density | Scalar | 2,333 | RGE:167-172 |
| Invert Density | StaticBool | falso | RGE:179-184; StaticBool_3 sin Value (RGE:277-282) |
| Use Exp2 (de ExponentialDensity) | StaticBool | verdadero | ED:134-139, StaticBool_0 `Value=True` en ED:213 |

Regla para entradas sin cablear: `UMaterialExpressionFunctionInput::Compile` con `bUsePreviewValueAsDefault`
verdadero compila el Preview (si está conectado: TexCoord_7, StaticBool_3, StaticBool_0) o, si no, `PreviewValue`
(`MaterialExpressions.cpp:16545-16613` y `CompilePreviewValue` 16484-16543).

### Grafo (a) forma cerrada

- Salida RGE:193 = StaticSwitch_3 (RGE:283-286): `Value` = Invert Density; True = A = llamada 37, False = B = OneMinus_5
  (`UMaterialExpressionStaticSwitch::Compile`, `MaterialExpressions.cpp:8889-8912`).
- Distancia: Distance_9 (RGE:97-99) A = UVs, B = CenterPosition; con dos Vector2 usa `length(A - B)`
  (`CompileHelperLength`, `MaterialExpressions.cpp:18522-18530`). Multiply_28 (RGE:224-225) tiene B sin cablear: `ConstB`
  = 1,0 (`MaterialExpressionMultiply.h:31`), así que no cambia el valor. Divide_1 (RGE:113-115) = Multiply_28 / Radius.
- Llamada 37 (RGE:200-204): Depth = Divide_1, Density = Density, Use Exp2 sin cablear. Llamada 38 (RGE:212-216): Depth =
  OneMinus_0 (RGE:249-250) = 1 - Divide_1; salida OneMinus_5 = 1 - llamada 38 (RGE:263-264).
- ExponentialDensity (ED:168-186): If_0 con A = Depth, B = Constant_2 (sin R, es 0), A>B = Divide_0 = Constant_1 (1) /
  Power_0, A=B y A<B = Constant_24 (1). Power_0 (ED:204-206): base Constant_0 = 2,718282, exponente StaticSwitch_0 (ED:219-222):
  con Use Exp2 verdadero = Multiply_13 = (Depth * Density)^2 (ED:188-198). El nodo If se compila como
  `select(abs(A-B) > 1e-5, select(A >= B, mayor, menor), igual)` (`HLSLMaterialTranslator.cpp:6614`, umbral
  `MaterialExpressionIf.h:36`).
- Por tanto `ED(t, k) = t > 1e-5 ? 1 / pow(2.718282, (t*k)^2) : 1`. El texto de descripción de ED (ED:231) dice que
  devuelve 0 con profundidad 0; el grafo devuelve 1: se usa el grafo.
- Nodos sin uso en la salida: Clamp_7 (RGE:63-64), Divide_0, Divide_14, Multiply_29, Multiply_30, Subtract_8, SquareRoot_8,
  OneMinus_4: ninguno llega a la salida (Multiply_29, Multiply_30 y Subtract_8 solo alimentan a SquareRoot_8, RGE:271 y
  293-294, y nada usa SquareRoot_8 ni los demás).

Forma cerrada, con `d = length(UVs - CenterPosition) / Radius`:

```
ED(t, k) = (t > 1e-5) ? 1 / pow(2.718282, (t*k)^2) : 1
salida   = InvertDensity ? ED(d, Density) : 1 - ED(1 - d, Density)
```

### (b) Instancia en M_Master_RadialBeam

`M_Master_RadialBeam.t3d` (fuente solo lectura en `.scratch/unreal/basichit-source/`) cablea solo Radius, a un
ScalarParameter `Radius` con `DefaultValue=0.5` (líneas 24, 47-48); ninguna instancia lo cambia
([material-defaults.json](material-defaults.json): `MI_Radial_2` sin escalares). UVs, CenterPosition, Density e Invert Density
(líneas 22, 23, 25, 26) quedan sin cablear: TexCoord[0], (0,5; 0,5), 2,333 y falso. Opacidad = `ParticleColor.a *
RadialGradientExponential` (líneas 16, 35-36); emisivo = `ParticleColor.rgb` (línea 15); `BLEND_Translucent`, `MSM_Unlit`
(líneas 58-59). Con esos valores: `salida = 1 - ED(1 - length(uv - 0.5) / 0.5, 2.333)`.

### (c) Línea GLSL

```glsl
float x = 1.0 - length(uv - vec2(0.5)) / 0.5;      // uv = TexCoord[0], 0..1
float tk = x * 2.333;
float grad = 1.0 - (x > 1e-5 ? 1.0 / pow(2.718282, tk * tk) : 1.0);   // sin saturate ni clamp: el grafo no los usa
float opacity = color.a * grad;
```

No hay `saturate` en el grafo (el Clamp_7 está desconectado), así que no se añade `clamp`. Muestras de `grad` según la
distancia al centro en UV: 0 = 0,995673; 0,1 = 0,969299; 0,2 = 0,859063; 0,25 = 0,743525; 0,3 = 0,581410; 0,4 = 0,195646;
0,45 = 0,052974; 0,5 y más = 0.

### (d) Casos límite

- Fuera del radio (`d >= 1`): x <= 0, ED = 1, salida 0 exacta; continua en x = 0.
- Base de `pow`: es la constante 2,718282 (ED:98), siempre positiva; `PositiveClampedPow` (`HLSLMaterialTranslator.cpp:9884`)
  no puede ver base 0 ni negativa. Un exponente grande desborda a infinito, `1/inf = 0`, salida 1.
- Radius = 0: `length/0` es +inf (o NaN en el centro); x = -inf o NaN; el `If` devuelve la rama 1 (con comparaciones IEEE, NaN falla `abs() > umbral`; la GPU no lo garantiza),
  salida 0 en todo el sprite.
- Radius < 0: x = 1 + length/|Radius| >= 1, salida cercana a 1 en todo el sprite (>= 0,9957); no se da con el valor 0,5 del material.

## Modo de direccionamiento de las texturas

Los dos muestreos de BasicHit usan `SSM_FROM_TEXTURE_ASSET` (material-defaults.json líneas 41 y 122), así que decide el
modo de la propia textura. Lectura con `get_editor_property` en `engine-assets01/textures.json` (idéntico en la segunda ejecución):

| textura | AddressX | AddressY | filtro | sRGB | tamaño fuente |
|---|---|---|---|---|---|
| T_FireBall | TA_WRAP | TA_WRAP | TF_DEFAULT | sí | 2048 x 1024 |
| T_FlameUV_1 | TA_WRAP | TA_WRAP | TF_DEFAULT | sí | 2048 x 1024 |
| T_Ground_Crack | TA_WRAP | TA_WRAP | TF_DEFAULT | sí | 2048 x 2048 |
| T_Hit_Circle | TA_WRAP | TA_WRAP | TF_DEFAULT | sí | 2048 x 2048 |

Las cuatro: compresión `TC_DEFAULT`, grupo `TEXTUREGROUP_WORLD`, mips `TMGS_FROM_TEXTURE_GROUP`. Con Wrap en ambos ejes, el
SubUV de Flame (8 x 4 = 32 celdas sobre `T_FireBall`) que pase de la última fila no se sujeta al borde: la V se envuelve a la
primera fila, es decir, la celda `idx` se muestrea como `idx mod 32`; el filtrado en el borde (TF_DEFAULT, que resuelve el grupo
TEXTUREGROUP_WORLD; el filtro efectivo y los mips no se leyeron aquí) también lee del lado opuesto.

## Cómo reproducir

Desde cualquier shell (cada ejecución dura 30-50 s; una instancia de Unreal a la vez; la carpeta de salida no debe existir):

```powershell
$ue = 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe'
$proj = 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject'
$q = 'C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/queries/basichit-render.json'
& $ue $proj -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/probe_engine_assets.py' "-AssetQuery=$q" -ProbeRun=engine-assets01 -unattended -nop4 -nosplash -nosound -NullRHI
& $ue $proj -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/probe_engine_assets.py' "-AssetQuery=$q" -ProbeRun=engine-assets02 -unattended -nop4 -nosplash -nosound -NullRHI
python tools/unreal-niagara-probe/compare_t3d.py .scratch/unreal/engine-assets01 .scratch/unreal/engine-assets02
```

`textures.json` de las dos ejecuciones se compara con `cmp`. Una tercera ejecución con `-ProbeRun=engine-assets01` debe
fallar con `... already exists` y no tocar la carpeta (consola `engine-assets-refuse-console.log`). Resultado: las dos
ejecuciones son idénticas byte a byte, antes de enmascarar los ChangeId (no había ninguno); sha256 en
[render-sources.json](render-sources.json). Unreal eligió el exportador por el nombre de archivo `.t3d` (el texto es el
T3D de objeto, `Begin Object Class=/Script/Engine.MaterialFunction`); `AssetExportTask.exporter` no queda rellenado tras la
llamada, no se leyó el nombre de clase.

## Qué no se acepta aquí

- No hay atadura de render de BasicHit ni cambio en `tools/niagara-native-lab`.
- No hay comparación de píxeles ni captura de referencia nueva; los umbrales de arriba solo quedan fijados.
- La fórmula no está contrastada contra una imagen de Unreal: viene solo del grafo exportado y del código del motor.
- Nada se guardó en ningún asset; el sondeo solo escribió dentro de `.scratch/unreal/<ejecución>` (los registros de consola
  `engine-assets0N-console.log` y los de Unreal quedan en `.scratch/unreal/`).
