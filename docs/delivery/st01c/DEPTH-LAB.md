# ST01c — desvanecimiento al tocar superficies

2026-10-14. La llama y el humo generados desde fuente ya leen la profundidad de
suelo y paredes en un laboratorio privado. El piloto conserva atlas, colores,
densidad y movimiento. [Abrir la comparación local](http://127.0.0.1:5197/tools/niagara-native-lab/depth.html?run=depth02).

Reutilizamos el padre `M_Smoke` extraído, su clamp de opacidad y **DepthFade de
100 cm**, asignado a ambos renderers efectivos de MyProject `NS_Flame_Single`.
No se recreó arte. Sistema SHA `985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165`.
Este corte sigue fuera del juego y del catálogo; no añade colisión ni modifica
la simulación de partículas. La [ficha textual](effect-description.json) describe
el comportamiento para la futura autoría por agente.

## Fórmula y escena

La implementación instalada UE5.8 emite
`Opacity * saturate((SceneDepth - PixelDepth) / max(FadeDistance, UE_DELTA))`.
Fuente: `MaterialExpressions.cpp:19764`, `MaterialExpressionDepthFade.h:34` y
`Common.ush:1373/1397`. UE convierte su Z invertida a profundidad lineal; el
shader WebGL convierte su Z estándar con near/far del propio navegador. Ambas
profundidades se comparan sobre el eje de cámara, en centímetros/metros según motor.
Los hashes de esas fuentes están en [el checkpoint](depth-checkpoint.json).

El pase opaco tiene un render target separado y una textura de profundidad de
muestreo nearest. Después se dibuja la superficie en el HDR principal para ocluir
y se dibujan las partículas sin escritura de profundidad. Nunca se muestrea una
textura adjunta al framebuffer activo. La conversión del shader contempla ambas
proyecciones, pero la evidencia de este corte acepta **solo ortográfica**.

Unreal creó planos y dos materiales temporales —negro opaco y quad blanco con
DepthFade— en la copia `.scratch`. Ningún paquete se guardó. La captura show-only
conservó ancho 400 cm, 512², cámara a 500 cm, semillas 6371/6372 y estado pausado
a 2 s. Se reutilizaron las utilidades del capturador previo sin programar su prueba.
La matriz UE usa planos de clipping internos por defecto, no exportados por este
probe; el navegador usa near/far 0,01/100 m. La rampa medida valida los rangos
cercanos ensayados, sin afirmar equivalencia de clipping a distancias grandes.

## Evidencia y límites

- `depth02` y `depth03`: **22/22 HDR idénticos** y estado CPU idéntico al tick 120
  de la referencia anterior. El verificador coteja hashes de script/HDR/estado;
  el generador recibe cero estados capturados.
- Calibración: separaciones -25/0/25/50/100/150 cm. RGB lineal UE para las cuatro
  positivas: 0,250977 / 0,501953 / 1,003906 / 1,003906. Navegador: 0,25 / 0,5 /
  0,999512 / 1. Error máximo <0,004, umbral declarado 0,01. El export RGBE conserva
  error de cuantización. Las salidas negras en negativo/cero incluyen **oclusión
  opaca**; por sí solas no prueban la rama negativa del clamp del material.
- Piloto: vacío y paredes -25/0/50/150 cm × frontal/oblicua/lateral, más suelo
  oblicuo: **16/16** pasan el umbral fijado en el brief antes de revisar resultados.
  IoU mínimo 0,982555 y MAE máximo 7,370524/255; máximos por canal hasta 63/255.
  Casos totalmente ocluidos quedan explícitos con unión vacía; no cuentan como
  prueba artística adicional. Es similitud de forma/brillo con **ACES de Three
  aplicado a ambos HDR**, no igualdad por píxel ni color final de Unreal.
- **11/11 CPU**: nueve previas más dos de separación lineal, posición de superficie,
  orden de pases, profundidad independiente y conservación de recursos.
- Chrome local: calibración GPU, 16 casos, toggle de desvanecimiento sin mutación
  de partículas, capas, cámara libre con superficie fija, reset y 390 px. Cero
  errores, solo GET locales y geometrías/texturas a cero tras dispose. Los tres
  modos anteriores pasan sus regresiones de navegador (7/6/6 grupos).
- Fuentes: 51 originales y 51 copias conservan SHA. Seis capturas inspeccionadas:
  [frontal](depth-front.png), [oblicua](depth-oblique.png), [lateral](depth-side.png),
  [suelo](depth-floor.png), [suelo sin fade](depth-floor-hard.png), [móvil emulado](depth-mobile.png).

Esta vista mantiene hasta 22 HDR de referencia en caché para diagnosticar; no es
un presupuesto de juego. Con pared hay cinco draw calls de escena/salida más uno
para presentar la referencia; se añaden color/depth 512² al pase de profundidad.
No se añadieron texturas artísticas al bundle, ni se aceptó FPS móvil por emulación.
El modo nativo previo conserva tres draw calls y carga sus mismas texturas.

Sigue contrastar la presentación final de color de Unreal y preparar/medir variantes
de atlas antes de integración al Taller de habilidades. No ampliar automáticamente
la biblioteca, ni atribuir capacidades de proyectil/entrelazado/aura a este piloto.
Compositor, iconos y UI Workshop conservan su plan posterior.

## Reproducir

Usar el servidor estático del worktree en puerto 5197. Los dos runs UE viven en
`.scratch/unreal/depth02` y `depth03`; las imágenes de QA en `.scratch/depth-lab`.
El repositorio conserva capturas y checkpoint, no todos los HDR temporales.

```powershell
node tools/niagara-native-lab/verify-depth.mjs
node --test tools/niagara-native-lab/lab.test.mjs tools/niagara-native-lab/update-simulation.test.mjs tools/niagara-native-lab/native-simulation.test.mjs tools/niagara-native-lab/depth-stage.test.mjs
node tools/niagara-native-lab/qa-depth.mjs 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs' depth02
python tools/niagara-native-lab/compare-depth.py
```
