# S11 — claridad del agua y lectura del fondo

Fecha: 2026-10-07. Ajuste visual acotado del agua existente para que espuma y cáusticas dejen leer las algas de S10 desde la cámara normal. Reutiliza `src/render/water.js`, sus rutas SSR/simple, las olas y el ruido ya cargados, y las posiciones del terreno existentes. Incluye la corrección de tamaño del depth existente al alternar calidad; no añade assets, entradas de textura, pases, geometría de juego ni cambios de simulación, persistencia o SQL.

## Reutilización revisada

La escena ya dispone de agua SSR para calidad media/alta y agua simple para calidad baja. Ambas comparten las olas y los controles visuales; SSR toma profundidad/escena para refracción, mientras simple usa la textura de altura del mapa. El terreno ya dibuja cáusticas en baja calidad. Este corte ajusta parámetros de material compartidos entre esas rutas y mantiene la puerta existente que evita dibujar cáusticas de terreno cuando el agua SSR ya las dibuja.

Se revisaron dos candidatos concretos del inventario Unreal, sin abrir ni exportar sus fuentes:

- `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Materials\M_Water.uasset` (10.512 B): el inventario registra un paquete de material de agua; su lógica y dependencias no se inspeccionaron. No demuestra portabilidad al shader Three.js existente.
- `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\sA_Megapack_v1\sA_PickupSet_1\Materials\Textures\T_Noise_DistortedCaustic.uasset` (509.646 B): paquete de textura candidato; se comprobó el archivo de esta ruta. No se verificaron píxeles, canales, dependencias ni encaje con las dos texturas procedurales actuales.

Ambos quedan diferidos. No se importan ni se consideran portables. `sA_Megapack_v1` contiene copias/rutas de distintos proyectos cuya igualdad no se deduce por nombre; este corte se limita a la ruta Survival citada arriba. No se exportaron paquetes ni se modificaron fuentes Unreal.

## Contrato de implementación

- Mantener `createWater(map, heightTex)` y las dos variantes de material existentes.
- Hacer que los controles de cáustica, espuma y luz de superficie se compartan entre SSR/simple, y que la intensidad/ancho de cáustica llegue también al shader del terreno.
- Conservar controles de ola y refracción durante alternancias de calidad. Las entradas siguen siendo el ruido/olas compartidos; SSR conserva escena/depth/refracción y simple conserva ruido/olas/altura. La altura del mapa y el depth de escena son entradas distintas.
- Reutilizar una máscara de cáustica antialiasada por derivadas en agua y terreno. El control existente de calidad sigue decidiendo cuándo se muestra la ruta del terreno; no duplicar el efecto SSR.
- Mantener profundidad, transparencia, alfa y superficie indexada de dos triángulos como contrato de las rutas actuales. No alterar posiciones, normales, máscaras ni índices del terreno al variar parámetros de material.

## Aceptación y límites

Las cinco pruebas de `tests/water-clarity.test.mjs` cubren contratos de materiales y alternancia, identidad de bindings compartidos, propagación del control de cáustica al terreno, estabilidad de la geometría y resize del depth antes de usar su framebuffer. La batería pertinente completa pasa **88/88**. La [entrega S11](../delivery/water-clarity-v1.md) reúne las capturas y los resultados de navegador/GPU, con el fallo histórico de transición conservado. FPS en dispositivo físico, balance visual final del autor y publicación son gates separados.

El cambio no demuestra todavía aceptación artística del fondo marino ni rendimiento en hardware físico. No cambia terreno, algas, simulación determinista, protocolo, SQL, assets ni la activación de cáusticas definida por calidad.
