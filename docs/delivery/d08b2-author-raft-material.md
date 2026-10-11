# D08b.2 — material de madera del autor

2026-10-06. **Candidato integrado y revisado en la bahía local; calibración y aceptación humana pendientes.**
Fuente guardada en `b2bd366579465a4892552d51627eed416b49dac7`.
Destino: <http://127.0.0.1:5180/>. Selector «Acabado de la balsa»: madera del autor / atlas anterior.
El cambio de acabado conserva el estado de movimiento y carga. El normal de escritorio permite comparar
plano, suave y suave invertido. La simulación, timing, corrientes y audio no se modifican.

## Evaluación y resultado

Las dos láminas aportadas se inspeccionaron con `view_image`. La madera marrón grisácea, clavos y grietas
de tinta encajan con la referencia naval fría y envejecida. No es un albedo repetible: hay piezas verticales
y horizontales separadas por huecos negros. Se seleccionaron cuatro regiones horizontales interiores para
los tablones, con veta a lo largo de la pieza. Albedo y normal comparten UV. Troncos/mástiles mantienen
geometría procedural; este corte no crea anillos de sección nuevos ni geometría de daño.

La cuerda, hierro y lona reutilizan el atlas aprobado. La lona conserva costuras/remiendos y se gradúa
localmente hacia gris verdoso. La caja Dreamrise y aparejo existente se reutilizan; no se encontró un
export de lona distinto listo para esta sustitución en la revisión acotada. No se alteran fuentes Unreal.

El manifiesto global permanece sin cambios. Hooks optativos en `RaftLayer` y `mapRaftUV` permiten el estudio
por instancia; las pruebas del atlas original siguen pasando. El layer libera materiales/geometrías,
el estudio libera sus texturas después. La isla principal conserva el acabado actual.

## Derivados y fuentes

| Mapa | Escritorio | Móvil | Uso actual |
|---|---|---|---|
| Color WebP | 1024², 302.458 B | 512², 79.054 B | Una variante elegida por dispositivo |
| Normal WebP lossless RGB | 1024², 1.138.930 B | 512², 297.964 B | Solo escritorio; móvil preparado, sin petición runtime |

Fuentes JPEG 2048²: 3.909.415 B de color + 2.882.809 B de normal, intactas en `materials/` y fuera del
bundle público. Herramienta: FFmpeg 8.1/libwebp. Generador reproducible:
`node tools/prepare-raft-board-material.mjs`; comprobación sin escrituras: mismo comando con `--check`.
Hashes/dimensiones/settings en [receipt](../art/raft-wood-boards-v2.json).

El normal se reduce en valores RGB de datos, sin conversión gamma adicional, se renormaliza y se codifica
sin pérdida adicional. La fuente ya es JPEG; esto no recupera precisión perdida anteriormente.
El mapa es `NoColorSpace`, el color `SRGBColorSpace`, normalScale suave 0,28. El canal verde no viene
etiquetado como OpenGL/DirectX: su signo se conserva y el selector permite comparar, sin asumir certeza.

El color móvil nuevo ocupa aproximadamente 1,33 MiB RGBA con mipmaps, además del atlas base compartido.
Es una estimación; no representa memoria GPU ni rendimiento medidos en teléfono. El normal móvil no se
carga ni se decodifica automáticamente. Los originales no se sirven desde el servidor de la bahía.

## Verificación y límite

- 73/73 tests pertinentes sobre el código del corte: manejo/corrientes/ráfagas, reloj/entrada,
  feedback/velocidad, servidor local, cámara/look/escenario, renderer/materiales de balsa y perfil nuevo.
- `--check` verifica dimensiones y hashes de las dos fuentes y cuatro derivados.
- Material móvil 512 inspeccionado como imagen: veta/clavos/tinta conservados. HTTP 200 del derivado
  desde el servidor local. Esto no demuestra que la textura se cargue o se lea bien dentro del render.
- Luna revisó defaults, UV, caché/ownership y aislamiento; el principal revisó código, láminas y pruebas.

La primera sesión perdió la conexión de Chrome. **Revisión posterior completada durante B3**, con
capturas guardadas e inspeccionadas: escritorio 1280×800, retrato 390×844 y paisaje 844×390; balsa inicial,
casa 4×4, comparación del atlas y relieve plano/suave/invertido. Escritorio carga color/normal 1024²;
móvil carga efectivamente `wood-boards-v2-mobile.webp` 512² sin solicitar normal. La lona remendada
y la veta se leen en las vistas revisadas. Los registros de error de la pestaña quedaron vacíos.
Cambiar autor/atlas anterior en pausa conservó exactamente el estado de pilotaje, no solo su velocidad.

El relieve es sutil bajo esta luz difusa: no se determinó con certeza el signo del canal verde;
«suave» sigue como candidato comparable. En la vista isométrica no apareció un borde negro evidente,
pero falta revisar una gama amplia de distancias/ángulos para cerrar mezcla de gutters con mipmaps.
Las regiones tienen márgenes, sin padding dedicado por nivel de mip.

La casa tenía techo separado por paredes en otro nivel. B3 corrigió el fixture y revalidó su encuadre
en los tres formatos; el cambio de altura/estabilidad se documenta en [la entrega B3](d08b3-foam-current-ink.md).
Ahí constan 80/80 pruebas posteriores, capturas/hashes, peticiones reales y reset del viewport confirmado.
Las capturas revisan el material B2 con los efectos B3; no son una captura pura del commit B2 anterior.

B3 implementa estela/spray, corriente cyan fragmentada y tinta periférica. B4 HUD real y B5 persecución
conservan sus dependencias. Accesorios, normal/mipmaps, aceptación humana y FPS físicos siguen abiertos.
Sin despliegue público en estos cortes.
