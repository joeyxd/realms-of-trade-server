# ST01c — color Filmic SDR del piloto

2026-10-14. El piloto nativo ya tiene una presentación de color derivada de UE5.8,
contrastada con **FinalColorLDR** bajo un perfil controlado. Se conserva la
aproximación ACES anterior para comparar. [Abrir laboratorio local](http://127.0.0.1:5197/tools/niagara-native-lab/color.html?run=color07).

Es el mismo MyProject `NS_Flame_Single`, SHA
`985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165`.
No se cambió arte ni nacimientos, trayectorias, tamaños, densidad o atlas. Reutilizamos
el material ya extraído y la cadena instalada de Filmic SDR, en vez de ajustar colores
a una captura. El port sigue privado y no convierte las otras identidades Niagara.

## Perfil y fuente

`prepare-film-source.py` comprueba hashes de once archivos del motor, incluido
`Build.version`, antes de extraer matrices/defaults. Lee por separado una consulta
de capacidades/gamma del render target, **sin píxeles ni partículas**. El preset y
su identidad están fijados; modificarlos hace fallar el cargador/constructor.
La regeneración produjo los mismos bytes. La [ficha](effect-description.json)
registra el perfil y las consecuencias de cambiar exposición para el futuro agente.

La transformación conserva sRGB D65 → AP1, expansión de gamut, corrección azul,
AP1 → AP0, glow y red modifier, predesaturación, toe/straight/shoulder, desaturación
final, corrección azul inversa y AP1 → sRGB. Los valores fuente son slope 0,88,
toe 0,55, shoulder 0,26, black clip 0, white clip 0,04, blue correction 0,6 y
expand gamut 1. White balance 6500 K/0 tint y grading identidad; sin LUT externa.
Fuentes principales: `TonemapCommon.ush:110`, `PostProcessCombineLUTs.usf:160/344`,
`ACESCommon.ush:140/234` y `GammaCorrectionCommon.ush:16/88`.

El perfil configura explícitamente una LUT logarítmica **32³**, rango 14 stops,
gris 0,18 / código 444 de 1023 y normalización 1,05. Las capacidades RHI consultadas
confirman el formato SDR preferido de UE, 10 bits; el navegador guarda esos valores
cuantizados en un contenedor RGBA16F de **262.144 bytes** y usa interpolación trilineal.
No exporta ni copia una LUT renderizada de Unreal. Es una sustitución del contenedor,
no una textura nativa `PF_A2B10G10R10` en WebGL. Dispositivos con fallback de 8 bits
requieren su comparación propia antes de ampliar esta aceptación.

La salida del shader ya está codificada para pantalla: no aplicar otra conversión
gamma. Exposición es `2^EV` antes del lookup; los controles privados aceptan 0/+1 EV.
Este perfil no porta ACES 2 ni grading/bloom arbitrarios.

## Captura que permite distinguir causas

El helper recompilado lee gamma real, formato, flags y valores heredados de
`FRenderTarget`, además de la capacidad que decide el formato SDR de LUT.
La captura registra overrides/CVars, volúmenes de postproceso deshabilitados,
pausa, semillas, cámaras y settings. No guarda assets o configuraciones del proyecto.

Se corrigieron dos supuestos del setup anterior: `RTF_RGBA8` fuerza gamma lineal y,
sin `TargetGamma`, `GetDisplayGamma()` devuelve 1; eso altera `InverseGamma.y` en
el tonemapper. Ahora se fija **TargetGamma=2,2** y se comprueba su lectura real.
Además, una captura one-shot sin view state ignoraba +1 EV en la salida; se mantiene
estado de render persistente para que exposición manual tenga buffer válido.
AntiAliasing, bloom, fringe y grain artístico quedan desactivados para aislar color.
La cuantización temporal se configura a 32 bits (amplitud <2,4×10⁻¹⁰), fuera del
presupuesto de un byte. No se usó este ajuste para modificar la curva o los umbrales.

Cada caso conserva PNG final, HDR RGBE diagnóstico y **RGBA16F raw** de lectura GPU.
RGBE comparte exponente entre canales y perdía precisión azul/verde en llama intensa;
el test de transformación usa el raw para no atribuir esa pérdida al shader.
El PNG puede variar en compresión lossless entre runs; los bytes RGBA **decodificados**
y los float raw sí se comparan exactamente. Cada contenedor conserva su propio SHA.

## Resultado y límites

- Dos runs `color07`/`color08`: ocho casos cada uno (carta y tres cámaras × dos
  exposiciones), 16 HDR/RGBA16F idénticos y ocho PNG RGBA decodificados idénticos.
  Readbacks y perfiles iguales; todas las imágenes finales tienen alfa 255.
  Mismo estado CPU a 2 s que la referencia anterior; cero estados como entrada del generador.
- Carta: **96/96 muestras** centrales pasan. Máximo error RGB 1/255; medias
  0,027778/255 y 0,034722/255. Los bytes raw del target coinciden con PNG decodificado.
  Umbrales previos: máximo 4/255 y media ≤2/255 por exposición.
- Color aislado, mismo raw de Unreal: las seis combinaciones pasan. MAE máximo
  **0,042110/255**, percentil 95 de error de canal **0**; gate MAE ≤2/255/P95 ≤4/255.
- Piloto nativo completo: **6/6** pasan. IoU mínimo 0,980176; MAE máximo 7,837088/255
  en la unión visible, máximo por canal 67/255. Gate previo IoU ≥0,94 / MAE ≤10/255.
  Estas diferencias de material/textura/rasterizado permanecen: no afirmar igualdad
  por píxel del efecto completo ni una conversión universal de Niagara.
- **14/14 CPU** (11 previas + 3 de fuente/LUT): finitud, grises, HDR cromático,
  repetibilidad, invariancia de inputs, límites y liberación. Chrome local: ocho
  casos, modos Filmic/ACES/lineal, exposición, fuente raw aislada, reset y 390 px;
  solo GET, cero estados capturados para simulación y cero errores. Geometrías/texturas
  a cero tras dispose; profundidad/nativo anteriores pasan sus regresiones.
- 51 originales y 51 copias conservan hashes. Capturas revisadas: [frontal](color-front.png),
  [oblicua](color-oblique.png), [lateral](color-side.png), [carta 0 EV](color-chart-EV0.png),
  [carta +1 EV](color-chart-EV1.png), [ACES anterior](color-previous-aces.png), [390 px](color-mobile.png).

El piloto usa tres draw calls, incluido output; LUT de 256 KiB más dos atlas originales.
La vista de diagnóstico mantiene ocho raw HDR de referencia en caché; ese coste no es
el presupuesto de juego. No hay texturas artísticas nuevas en el bundle. FPS físico,
atlas móviles optimizados, bloom, perspectiva y grading libre no se aceptan aquí.

Sigue **presupuesto y variantes de atlas**, manteniendo cantidad/movimiento/calidad,
antes del Taller de habilidades. El compositor por agente, iconos y UI Workshop
conservan su plan; no hay nueva habilidad, SQL, protocolo o activación de juego.

## Reproducir

Motor UE5.8 y proyecto privado de los probes anteriores. Runs e imágenes completas
quedan en `.scratch`; el repositorio conserva checkpoint y capturas inspeccionadas.

```powershell
python tools/niagara-native-lab/prepare-film-source.py
node tools/niagara-native-lab/verify-color.mjs
node --test tools/niagara-native-lab/lab.test.mjs tools/niagara-native-lab/update-simulation.test.mjs tools/niagara-native-lab/native-simulation.test.mjs tools/niagara-native-lab/depth-stage.test.mjs tools/niagara-native-lab/film-color.test.mjs
node tools/niagara-native-lab/qa-color.mjs 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs' color07
python tools/niagara-native-lab/compare-color.py
```
