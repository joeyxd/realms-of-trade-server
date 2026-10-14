# Laboratorio privado ST01c

Este corte reproduce **atributos de partículas observados en Unreal** y traduce el
material del piloto MyProject `NS_Flame_Single` a Three.js. No ejecuta Niagara, no
reconstruye todavía su generador y no registra un efecto listo en el juego.

**Modo adicional, 2026-10-13:** evolución local de vida/muerte, movimiento, alfa y atlas
desde 50 nacimientos observados. Los estados posteriores se calculan aquí; los tiempos
y estados iniciales aún son una fixture de Unreal. [Resultados](../../docs/delivery/st01c/UPDATE-LAB.md).

Primero ejecutar [la captura aislada](../unreal-niagara-probe/README.md). Instalar las
dependencias existentes con `npm.cmd ci --ignore-scripts --no-audit --no-fund` y servir
esta carpeta de trabajo solo en localhost:

```powershell
python -m http.server 5197 --bind 127.0.0.1
```

Abrir `http://127.0.0.1:5197/tools/niagara-native-lab/index.html?run=reference11`.
`run` es el nombre de la captura bajo `.scratch/unreal`; no se aceptan rutas arbitrarias.
Se necesitan 241 muestras, los dos atlas originales y las referencias del mismo piloto.
Los assets completos permanecen fuera del bundle. No hay endpoints de escritura.

Para el modo de evolución local, preparar una vez la fixture del mismo run y abrir
`http://127.0.0.1:5197/tools/niagara-native-lab/index.html?run=reference11&mode=update`:

```powershell
python tools/niagara-native-lab/prepare-update-fixture.py reference11
node tools/niagara-native-lab/verify-update.mjs reference11
node --test tools/niagara-native-lab/lab.test.mjs tools/niagara-native-lab/update-simulation.test.mjs
node tools/niagara-native-lab/qa-update.mjs 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs'
```

La preparación requiere el export exacto `.scratch/unreal/probe01/system.t3d` para
extraer la LUT del dueño activo. Repetir con `reference12` contrasta la segunda ejecución.
El simulador no lee frames posteriores; `verify-update.mjs` los usa como comparación
independiente. Solo simula el subconjunto de actualización conocido, sin fuerzas.
Los controles experimentales tienen unidad, rango y efecto explicado; ni este corte
ni su ficha descriptiva ejecutan un compositor/agente o habilitan habilidades del juego.

- Reproducción de cuatro segundos, vistas frontal/oblicua/lateral y cámara giratoria.
- Llama y humo independientes; se puede ocultar cada capa sin modificar la captura.
- Los quads conservan posición, tamaño, color, rotación y fotograma por partícula.
- RGB de textura por RGB de partícula; opacidad R por alfa, clamp 0–1, sin interpolación
  entre celdas. Texturas fuente sRGB; partículas mezcladas en un target lineal RGBA16F,
  seguido por una sola conversión de presentación. El DepthFade no se ejercita aquí.
- La referencia normal conserva el color final de Unreal. La casilla de comparación
  carga su SceneColor HDR a 2 segundos y aplica a ambos lados el mismo color de salida;
  aísla el material, **no demuestra que reproduzcamos el tonemapper de Unreal**.
- El preset ACES de Three es una aproximación. Exposición cambia solo la presentación.

## Verificación

```powershell
node --test tools/niagara-native-lab/lab.test.mjs
node tools/niagara-native-lab/qa.mjs 'C:/DEV/real of trade/realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs'
python tools/niagara-native-lab/compare.py
```

QA usa Chrome instalado mediante Playwright, captura las tres vistas, prueba cámara,
capas, reproducción, layout de 390 px, tráfico GET local y liberación de GPU. `compare.py`
requiere Pillow/NumPy y genera métricas diagnósticas; no convierte un umbral de píxeles
en aceptación artística. Sus salidas quedan en `.scratch/browser-lab`.

El piloto usa los atlas completos de 2048×1024 y 2560×1536: ~30,7 MiB estimados RGBA8
con mipmaps, antes del target HDR y las referencias. No es una variante móvil lista.
La emulación prueba controles/layout, no FPS o coste en un teléfono. La semilla de
Unreal está fijada solo en memoria para comparar; el asset fuente no era determinista.

Sigue la simulación propia (spawn, ubicación, vida, curva y movimiento), la comparación
temporal completa, DepthFade con escena, color final y presupuesto por dispositivo.
