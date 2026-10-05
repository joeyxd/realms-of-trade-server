# Balsa cómic — material y optimización móvil

Solicitud del autor, 2026-10-05. Base `0aaae7117f27bdaa7e1c6de374dcf0c5c208e157`,
`0.6.0-alpha.1`, protocolo 13. Cambio visual sobre D04 P1; D04 P2 sigue siendo el siguiente corte jugable.

## Resultado

Atlas original inspirado en la referencia del autor: madera ámbar con pintura turquesa descascarada,
hierro carbón oxidado, cuerda dorada y lona marfil con parche rojo y puntadas grandes.
Dos pasadas de image_gen; se descartó la primera por exceso de trama fina en la cámara isométrica.
[Prompt, modo y procedencia](../art/raft-comic-v1-prompt.md).

Se aplica a las piezas de la balsa real, no a una escena de presentación. UVs por superficie,
veta a lo largo de tablones/mástiles y variación determinista; una textura compartida para cuatro materiales.
El sombreado conserva la luz/toon/contorno del mundo, reduce la segunda trama procedural y gradúa el color.
Tablones más estrechos, cinchos/remaches, anillas, cabos y lona ligeramente abombada completan la lectura.
Los cinchos de la caja siguen las dimensiones reales de su modelo ajustado.

La caja FAB se viste solo en esta instancia: geometría clonada antes de cambiar UVs y material.
El recurso compartido y las cajas de la isla se conservan. Geometría propia se libera al cambiar revisión,
retirar una vista o cerrar la capa; atlas/materiales del registro nunca se destruyen desde una balsa.
Las piezas usan el mismo sistema semántico; plantas/fuego conservan colores específicos.

## Texturas servidas

| Uso | Archivo | Tamaño | Descarga | RGBA con mipmaps, estimación |
|---|---|---:|---:|---:|
| Fuente, fuera del bundle | `docs/art/source/raft-comic-v1.png` | 1254² | 3.032.353 B | 8.386.752 B |
| Escritorio | `assets/textures/raft/comic-materials-v1.webp` | 1024² | 308.536 B | 5.592.406 B |
| Dispositivo táctil | `assets/textures/raft/comic-materials-v1-mobile.webp` | 512² | 82.878 B | 1.398.102 B |

La versión móvil reduce la descarga **97,3 %** y la estimación RGBA+mipmaps **83,3 %** frente a la fuente.
WebP reduce transferencia; la reducción de resolución es la que reduce memoria decodificada.
Estas cifras son cálculos de almacenamiento de texels, no mediciones de VRAM ni una promesa de FPS.
El PNG fuente queda fuera de `assets/` para que el builder no lo incluya en el bundle.

`mobileSrc` es opcional en el manifiesto: el registro elige una sola URL al arrancar por puntero táctil,
con opción explícita `mobileTextures` para consumidores/pruebas. No carga ambas resoluciones ni las cambia
cada vez que fluctúa la calidad automática. Sin variante móvil se usa `src`. Un fallo mantiene el material
procedural, y no bloquea el modelo de caja. `?raftskin=0` permite comparar la misma geometría sin atlas;
`?noassets` comprueba el fallback global.

Reproducir derivados: `node tools/optimize-raft-texture.mjs` con FFmpeg/libwebp instalado (solo herramienta
de desarrollo). Lanczos, WebP calidad 85/82, compresión 6. Fuente, hashes y ajustes en
[metadatos de optimización](../art/raft-comic-optimization.json).

## Aceptación

Aceptado localmente: **340/340 pruebas** (338 de regresión, 52.175 ms; 2 de red, 7.319 ms),
con los cambios de cuentas de `f0b74a7` y este material. No acepta el host para amigos que se desarrolla
en paralelo. Casos nuevos cubren UVs/regiones, orientación de veta, recursos compartidos, eliminación/revisión
de vistas y selección/validación de variantes. Importador verifica ambos WebP y el optimizador confirma hashes.

Ocho casos completados; **26 capturas inspeccionadas** por el principal. [Evidencia y hashes](raft-comic-evidence.json).

| Caso | Resultado |
|---|---|
| High día 1024 + foto oblicua | Cuatro superficies aplicadas; grietas/pintura/costuras legibles |
| High día sin skin, misma geometría | Comparación de material; modelo FAB conserva su material original |
| High noche 1024 | Luz del mundo conservada, sin emisión falsa para blanquear la lona |
| Low móvil día/noche 512 | Solo solicita el WebP móvil; detalle legible cerca y en overview |
| 404 del atlas de escritorio | Material procedural; caja FAB sigue cargada |
| Bytes corruptos del atlas móvil | Mismo fallback al entrar y recargar |
| Sin assets móvil | Caja procedural y resto de piezas completos |

Ningún error de página/juego; dos fallos de fuentes externas bloqueadas en QA son esperados,
y el caso 404 registra además los dos fallos deliberados de imagen. No se aprecia mezcla de cuadrantes
en las distancias capturadas; UV inset y mipmaps siguen requiriendo revisión si cambia mucho la escala del editor.

El harness `tools/look-raft.mjs` entra por Worker normal, espera SAVE, fotografía el snapshot real y recarga:
misma identidad, piezas y bodega; prueba reutilización, baja y restitución de la vista.
`HERO=1` añade una toma oblicua sin HUD, manteniendo también overview/close de la cámara de juego.
Los casos de 404/WebP corrupto se limitan al atlas; `noassets` es un caso separado.

La comparación `raftskin=0` incluye los nuevos tablones/herrajes; aísla el material y no pretende ser una
foto del renderer anterior a este trabajo. Una URL distinta por variante y resolución decodificada se
verifican mediante eventos de petición y dimensiones de `Texture.image`, también tras recargar.

Revisión visual con SwiftShader y teléfono emulado. GPU real, teléfono físico y rendimiento quedan por medir.
No modifica simulación, almacenamiento, balance, protocolo, navegación ni colisiones de cubierta.
No acepta un kit FAB modular A05 y no habilita editor o piratería. Próximo trabajo: D04 P2, playa→muelle→balsa,
suelo/bloqueos y escaleras compartidos entre servidor y predicción. Publicación sigue siendo una fase aparte.
