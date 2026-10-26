# S09 — madera varada y restos de playa

Fecha: 2026-10-07. Integración local de la fila `restos-playa`: ramas torcidas, troncos cortos y pequeños grupos de tablones. Mantiene el acabado ilustrado del puerto, con planos de color y vetas oscuras. Es decoración del renderer, con caminos y accesos despejados; no añade recursos recolectables, colisiones ni cambios de simulación.

## Reutilización y resultado visual

Se verificó y exportó `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_Logs.uasset` (23.471 B) desde una copia aislada con UE 5.8/NullRHI. La dependencia completa de `/Game` consta de cuatro paquetes: malla, `MI_Base_Normal`, `M_Base`, `T_ColorPalette`; sus hashes antes/después coinciden. El export contiene 132 triángulos, una sección y ningún mapa de imagen; [informe](../art/source/beach-debris-v1/SM_Logs.unreal-report.json) y [evidencia](../art/source/beach-debris-v1/stage-evidence.json).

La inspección de la forma en el navegador mostró tablones apilados pese al nombre `SM_Logs`. Por eso el modelo adaptado alimenta `planks`; `branch` y `log` son siluetas nativas. Se centra la fuente, orienta su eje largo y entierra ligeramente el apoyo. Se conserva su topología y se añade pintura por vértice. El primer ensayo, demasiado liso y asignado al tronco, se conserva en `docs/art/source/beach-debris-v1/trial-01/`; no es el modelo final registrado.

| Modelo final | Triángulos | Bytes GLB |
|---|---:|---:|
| Rama con bifurcaciones | 208 | 6.612 |
| Tronco corto | 96 | 3.696 |
| Tablones varados, derivados de SM_Logs | 132 | 8.432 |
| Total | 436 | 18.740 |

Un único material toon opaco compartido pinta las vetas con coordenadas locales y derivadas para suavizarlas con distancia; no carga texturas ni normales nuevos. La sombra recibida procede del sistema existente. Se omiten sombra propia y pase de contorno en estas piezas pequeñas; las facetas y vetas describen su volumen. Los modelos se cargan desde el manifiesto con `fit: none`; datos inválidos, 404 o `noassets` conservan siluetas nativas. Los tablones de fallback son dos piezas estrechas diferentes de la pila importada.

## Distribución y presupuesto

La semilla `99282957` tiene **34 conjuntos**: 19 ramas, ocho troncos y siete pilas de tablones. Un hash propio elige coordenadas, giro y escala; no consume RNG de simulación ni muta `map.props`. Comprueba arena expuesta, pendiente y planitud, ocho muestras del contorno, máscaras de camino/volcán/arena/lava, muelles, spawn, pueblo, NPC, enemigos, tutorial, rocas y plantas S07/S08. También separa conchas/cantos S04 y otros conjuntos de madera.

Instancias agrupadas en celdas de 32 m y geometría compartida. La calidad modifica cantidad/distancia: high/ultra hasta 96 y 65 m; medium o móvil hasta 64 y 45 m; low hasta 32 y 32 m. Solo repuebla matrices cuando cambia calidad o el foco se mueve dos metros. Los cambios reutilizan geometrías/material y las piezas lejanas dejan de dibujarse.

## Verificación

**77/77 pruebas pertinentes**, 13 archivos, sin omisiones: la familia nueva incluye ocho pruebas de geometría, carga y adaptación, distribución independiente del RNG, despejes, límites, cambios de calidad y recursos compartidos. Los GLB preparados se parsean y validan en el mismo formato que entrega el registro de assets; la adaptación no modifica la fuente exportada.

Seis casos de navegador: PC high, móvil emulado medium, low, `noassets`, GLB ausentes y GLB inválidos. Todos iniciaron la partida ordinaria con cero errores JS de juego, cero error GL y programas enlazados. La consola registra el favicon 404 habitual y los 404 inducidos en el caso ausente. [Datos completos](../art/beach-debris/runtime-evidence-v1.json).

| Vista real de costa, foco (114,84; 70,37) | Instancias activas antes de frustum | Llamadas extra medidas | Triángulos extra medidos |
|---|---:|---:|---:|
| PC high | 7 | 3 | 568 |
| Móvil emulado medium | 5 | 4 | 664 |
| Low | 4 | 3 | 568 |

La diferencia activado/desactivado usa la misma cámara y todos los pases del renderer; no equivale a FPS ni compara velocidad entre dispositivos. La galería es temporal, a escala 1×, con la vegetación oculta solo para inspección. Las capturas de mapa muestran distribución real; los previews separan las tres piezas. Tras cada caso se cierra su contexto. Se revisaron las capturas PC/móvil/low y fallback.

El primer smoke detectó una colisión de nombre con `GameScene.debris`, usado por los restos de combate; se corrigió usando `GameScene.beachDebris` y las seis comprobaciones finales parten de una carga nueva. No se altera el sistema de restos del combate.

Los once snapshots de integración se conservan en `docs/art/source/beach-debris-runtime-v1/`; `--check` valida sus bytes históricos sin refrescar las entregas S01–S08. El catálogo conserva referencias del autor, añade previews, GLB, fuentes y capturas y pasa comprobación HTTP de bytes.

Revisión artística final del autor, FPS en teléfono físico y publicación pendientes. M5, chat/agentes y navegación conservan sus entregas independientes.
