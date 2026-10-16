# S07 — arbustos tropicales, entrega local

2026-10-07. Tres variantes del arbusto tropical independiente quedaron integradas en el renderer local. Se conserva la prueba de arte v1, su concepto y procedencia; no se modifica la integración de plantas al pie de palmera S06. Alcance y reutilización: [brief S07](../briefs/visual-s07-shrubs.md).

## Modelos y atlas

| Variante | Triángulos | GLB |
|---|---:|---:|
| Redonda | 424 | 24.720 B |
| Baja | 512 | 28.832 B |
| Alta | 440 | 25.656 B |
| **Total** | **1.376** | **79.208 B** |

Cada modelo queda bajo el presupuesto de 700 triángulos y 102.400 B. No contiene imágenes embebidas. La geometría separa tallos rígidos y hojas, usa UV y winding hacia fuera; las hojas apicales y su recorte se ajustaron para preservar la silueta. El detalle por modelo y sus hashes constan en el [recibo de geometría](../art/source/shrub-runtime-v1/geometry-receipt.json).

El atlas 2×2 usa color y normal por dispositivo. Color PC 512×512 y móvil 256×256; normal con las mismas dimensiones. Los recortes fuente tienen 6 px de margen y el atlas añade gutters de 8 px en PC y 4 px en móvil, con padding de aspecto. El alpha del color controla ambos mapas, conserva los huecos interiores y mantiene cero discrepancias de alpha en las comprobaciones del recibo. Los huecos de tiles B/D midieron 325/136 px en PC y 85/30 px en móvil; no hubo componentes Z negativos en texels con alpha superior a 0,35. El normal se renormaliza después del resize, tiene fuerza 0,16 y no se certifica como bake tangente.

| Variante cargada | Par de texturas | Modelos + par |
|---|---:|---:|
| PC | 170.924 B | **250.132 B** |
| Móvil | 59.020 B | **138.228 B** |

Las cuatro texturas derivadas ocupan 229.944 B en disco; un cliente carga solo un par. Color WebP con pérdida y normal WebP sin pérdida. Ver tamaños, recortes y hashes en el [recibo de texturas](../art/source/shrub-runtime-v1/textures-receipt.json). Las imágenes y prompts originales permanecen fuera del bundle.

La herramienta de generación integrada no expone backend ni modelo verificable. Se conserva esa limitación en los recibos. No se afirma bake tangente certificado.

## Integración y distribución

En el seed local **99282957** hay **784 arbustos**: 330 redondos, 290 bajos y 164 altos. De ellos, 262 sustituyen vegetación arbustiva anterior y 522 son dispersión adicional; el límite es 900. En 80 anclajes anteriores inseguros se conserva la apariencia procedural para dar feedback visual a las colisiones existentes. Las reglas de sitio y terreno están en `shrubPlacement.js`; no mutan RNG, props ni colliders.

Los tallos usan pintura geométrica y permanecen rígidos. Las hojas comparten el alpha 0,35, normal suave, contorno, sombra y viento con los pases de vegetación. Se desactiva el contorno comic adicional para la hoja porque el arte ya lleva tinta. Cuando falta o falla un modelo, se usa geometría procedural; sin color las hojas conservan silueta geométrica sin rectángulos opacos; sin normal mantienen el color. `disabled` deja el arbusto procedural y evita depender de los assets S07.

## Verificación local

La evidencia de runtime registra ocho casos: escritorio, móvil y low, además de modelo ausente, modelo inválido, color ausente, normal ausente y recursos desactivados. Los ocho casos no reportaron errores de página, juego ni WebGL; todos los programas enlazaron. Los positivos cargaron el atlas PC a 512×512 o móvil a 256×256 según el dispositivo. El único 404 de consola en positivos fue `favicon.ico` de la preview local; los fallos inyectados en los casos de fallback son esperados y quedan registrados en [runtime-evidence-v1.json](../art/shrubs/runtime-evidence-v1.json).

Las **63/63 pruebas pertinentes** en 11 archivos pasaron sin omisiones, incluidos los ocho casos de arbustos. Los chequeos de generación de modelos/texturas y los seis snapshots de integración pasaron con `--check`; los snapshots históricos mantienen sus bytes.

La revisión visual inspeccionó los previews finales de las tres variantes, la galería móvil, el mapa low, el contacto sin color, las capturas de viento en reloj 0 y 2,1, y la comparación con normal apagado. La verificación independiente confirmó alpha pareado en PC/móvil y ausencia de Z negativo en texels con alpha superior a 0,35. Capturas inspeccionadas del juego local:

- [Mapa de escritorio](../art/shrubs/desktop-map-v1.png), [contacto](../art/shrubs/desktop-close-v1.png) y [galería](../art/shrubs/desktop-gallery-v1.png)
- [Mapa móvil emulado](../art/shrubs/mobile-map-v1.png)

Material adicional registrado para viento, normal y fallbacks:
[reloj 0](../art/shrubs/desktop-wind-0-v1.png), [reloj 2,1](../art/shrubs/desktop-wind-2-v1.png), [normal apagado](../art/shrubs/desktop-normal-off-v1.png), [modelo ausente](../art/shrubs/missing-model-close-v1.png), [modelo inválido](../art/shrubs/invalid-model-close-v1.png), [color ausente](../art/shrubs/missing-color-close-v1.png), [normal ausente](../art/shrubs/missing-normal-close-v1.png), [assets desactivados](../art/shrubs/disabled-close-v1.png). Previews de [redondo](../art/shrubs/variant-round-preview-v1.png), [bajo](../art/shrubs/variant-low-preview-v1.png) y [alto](../art/shrubs/variant-tall-preview-v1.png).

La galería es un muestrario temporal y no representa una escena publicada. La emulación no mide FPS físicos. Ajuste artístico final, FPS en dispositivo real, bake certificado, identidad del backend y publicación quedan pendientes.

## Registro

La fila `arbusto-tropical` conserva los enlaces de concepto y procedencia existentes. La herramienta de registro solo la promueve de Referencia a Aplicado cuando encuentra los modelos, atlas, recibos, snapshots, capturas y esta entrega; verifica concurrencia por comparación de bytes antes de reemplazar el catálogo. La herramienta de verificación compara enlaces del servicio local con los bytes del proyecto y la revisión activa.

Registro verificado: **revisión 14, 82 filas y 27 aplicadas**, 53 enlaces únicos exactos por bytes.
Repetir el registro conserva la revisión 14. La ficha HTML cargó sus 29 imágenes y mostró 29 archivos,
estado Aplicado, con las tres previews reales primero y sin imágenes rotas. [Captura inspeccionada del
catálogo](../art/shrubs/catalog-applied-v1.png). Los originales y sus dos juegos de copias coinciden por bytes.


