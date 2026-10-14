# ST01c — referencia ejecutada y laboratorio de material

**2026-10-13. Checkpoint privado; simulación propia y efecto del juego pendientes.**

El piloto exacto MyProject `NS_Flame_Single` ya se ejecuta en Unreal 5.8 y sus partículas
se dibujan por separado en Three.js. El laboratorio conserva los dos atlas originales,
posiciones 3D, tamaños, color, rotación y fotograma SubUV. Permite reproducir cuatro
segundos, girar la cámara, cambiar exposición y aislar llama/humo.

Esto es **reproducción de atributos observados**, no ejecución de Niagara ni port de su
simulación. Sirve para aislar y comprobar el material antes de implementar el generador.
No incorpora un efecto listo al Taller de Habilidades, ni altera gameplay, SQL o protocolo.

## Referencia y repetibilidad

El helper C++ lee los buffers CPU efectivos a 1/60 s. Una activación, 240 pasos y 241
estados; pausa restaurada antes de toda espera/captura. Las semillas 6371/6372 son una
configuración de comparación en memoria: ambos emisores fuente tenían determinismo
desactivado. No se guardaron assets. Los 51 originales y sus 51 copias conservaron hashes.

Se capturan cinco tiempos (0,5 / 1 / 2 / 3 / 4 s), tres cámaras ortográficas y una referencia
vacía inicial, a 512² con ancho de 400 cm. A 2 s se añade SceneColor HDR para separar el
material de la presentación final. Los PNG FinalColorLDR conservan el procesamiento de
color de Unreal; los archivos Radiance contienen RGB y descartan alfa. No prueban una
exportación transparente equivalente.

Los primeros intentos expusieron dos fallos del instrumento: proxy/render resources sin
preparar y atlas todavía en mips reducidos. Se espera compilación, se fuerza residencia
de las dos texturas y se envían/esperan las actualizaciones de render. Además, una captura
oblicua inicial salió vacía en una repetición: ahora se cerca la lectura GPU, se verifica
contenido visible y se reintenta como máximo tres veces **sin avanzar la simulación**.
Un archivo generado o un proceso UE con código 0 no cuentan como prueba visual.

La evidencia final está en [render-checkpoint.json](render-checkpoint.json). Los datos
completos, logs, referencias y atlas permanecen en `.scratch/unreal`, fuera del bundle.
Las ejecuciones finales `reference11`/`reference12` coinciden en los 241 estados CPU,
los tres HDR byte por byte y los píxeles decodificados de los 16 PNG (15 vistas y fondo).
Los bytes PNG pueden diferir por metadatos; la comparación visual usa sus píxeles.

## Qué se tradujo y qué se observó

- Dos renderers: llama `MI_Flame_2`, 8×4, y humo `MI_Smoke_1`, 10×6. Se excluyen copias
  heredadas y el material de llama alternativo del censo anterior.
- Material unlit/translúcido: emisión `texture.RGB × particle.RGB`; opacidad
  `clamp(texture.R × particle.A, 0, 1)`. Ambas texturas tienen sRGB activado.
- `bSubImageBlend=false`: no se mezclan celdas. El atlas fuente se conserva, no es una
  grabación plana de todo el efecto. Cada partícula tiene su posición y orientación.
- Un target lineal RGBA16F mezcla las capas; un pase final aplica presentación y sRGB.
  Aplicar esos pasos por partícula antes de mezclar producía un orden incorrecto.
- La escena aislada no ejerce DepthFade (100 cm en la fuente), colisión o iluminación
  del mundo. La orientación de ambos modos coincide para estas cámaras ortográficas.
- La llama observada tiene vida de 1 s, ligada al default de `User.LifeTime`, y velocidad
  cero; el humo tiene vida de 2 s y asciende a ~81,2634 cm/s. A 2 s hay 3 llamas y 19
  partículas de humo; a 3–4 s hay 3 y 20. SpawnRate es 3/s y 10/s. No interpretar la
  etiqueta `Loop Once` como una duración finita: el modo de duración es `Infinite`.
- Las entradas de distribución y flags/defaults de los módulos de ubicación aún
  necesitan cierre semántico antes de reconstruir el spawn; los valores de copias
  heredadas no son entradas efectivas.

## Comparación visual acotada

[Color final original](render-original.png) conserva una diferencia visible de color
y humo entre UE y Three. [Frontal](render-linear-front.png), [oblicua](render-linear-oblique.png)
y [lateral](render-linear-side.png) aplican **el mismo ACES de Three** a ambos RGB lineales
a 2 s. Estas últimas comparaciones muestran siluetas y capas cercanas, pero no prueban
equivalencia con el tonemapper final de Unreal.

[Métricas](material-comparison.json), calculadas con el script versionado `compare.py`:

| Vista | IoU de máscara >32/255 | Error RGB medio en unión >8/255 |
|---|---:|---:|
| Frontal | 0,9830 | 6,03/255 |
| Oblicua | 0,9841 | 7,37/255 |
| Lateral | 0,9867 | 6,45/255 |

No son porcentajes de “fidelidad AAA”. Son medidas diagnósticas sobre este instante,
con los mismos atributos observados y transformación de salida. Hay diferencias
locales de hasta 63/255; quedan filtro/LOD, bordes y color final por estudiar. No se
fijó un umbral retroactivo para declarar aceptado el port.

## Pruebas y coste

El helper compiló con UE5.8, MSVC 14.51 y SDK Windows; se conserva el aviso del engine
sobre una versión de compilador posterior a la preferida. Pruebas focales de atributos,
límites y liberación: 2/2. Chrome local: tres vistas, giro de cámara, capas, reproducción,
390 px sin overflow, cero errores, solo GET a localhost y cero texturas/geometrías
retenidas tras `dispose`. [Captura móvil de interfaz](render-mobile.png).

El modo normal usa dos dibujos de partículas y un pase de salida; la comparación HDR
añade un cuarto dibujo para la referencia. Se cargan los atlas completos de 2048×1024
y 2560×1536: ~30,7 MiB estimados RGBA8 con mipmaps, además de targets/referencias.
No hay variantes móviles aceptadas ni medida de FPS en dispositivo físico. No se ejecutó
la suite general del juego porque este corte no modifica su runtime.

## Decisión

Continuar con este piloto: la comparación del material justifica probar la simulación
propia. Cerrar entradas/curvas de spawn, generar partículas sin usar la grabación y
comparar la secuencia completa. Después resolver DepthFade, color final y presupuesto
antes de llevarlo al Taller. El resto de Niagara y el UI Workshop conservan su estado
anterior. No se extrapola el esfuerzo de este piloto a toda la biblioteca.

[Cómo reproducir el laboratorio](../../../tools/niagara-native-lab/README.md).
