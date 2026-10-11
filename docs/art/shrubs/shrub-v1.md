# Arbusto tropical v1 — prueba de arte

La integración posterior del arte aprobado está en [S07 — arbustos tropicales](../../delivery/shrubs-v1.md).
Este documento conserva la evidencia de la prueba de imágenes original.

Solicitud del autor: dibujar un arbusto independiente y generar textura y normal, con el estilo tropical
pintado y entintado de las palmeras. Este corte entrega imágenes; la integración en el mapa está pendiente.

- [Concepto](../source/shrub-art-v1/concept.png): tres brotes, hojas anchas,
  verde lima/oliva, sombras verdes frías y tallos cálidos. PNG RGBA, 1244×1265.
- [Albedo de cuatro hojas](../source/shrub-art-v1/albedo.png): atlas 2×2,
  con puntas hacia arriba y pecíolos hacia abajo. PNG RGBA, 1254×1254.
- [Normal generado a partir del albedo](../source/shrub-art-v1/normal.png):
  mismo tamaño y distribución, con relieve sugerido para nervaduras y pliegues. PNG RGBA, 1254×1254.
- [Prompts exactos y modo de generación](../source/shrub-art-v1/prompts.json).
- [Procedencia, hashes y mediciones](../source/shrub-art-v1/receipt.json).

Se usó la herramienta integrada `image_gen.imagegen`, con transparencia solicitada. El modelo pedido
por el autor es **GPT Image 2**; la respuesta de la herramienta no expone un identificador de modelo,
por lo que esa identidad queda sin verificar. El concepto y albedo son generaciones independientes;
el normal es una edición que toma el albedo exacto como referencia. Los originales generados se copiaron
al proyecto sin modificar y permanecen también en la carpeta de salida del generador.
Las imágenes y prompts están en `materials/generated/tropical-shrub-v1`; el catálogo sirve copias
idénticas en `docs/art/source/shrub-art-v1`, dentro de sus rutas admitidas.

Las tres imágenes tienen alfa real. En las máscaras con alfa >127, el albedo y normal tienen IoU
**0,9853** y el normal cubre **99,58 %** del color opaco. Hay pequeños cambios de borde: no comparten
una máscara idéntica. Es una pareja generada para probar; no se certifica un bake ni la orientación
de sus canales sobre una malla. La revisión visual encontró las cuatro hojas y sus huecos en ambos mapas.

Reutilización revisada, solo lectura: `C:\Unreal\MyProject\Content\BigNiagaraBundle\NiagaraWeather\StatickMesh\SM_Leaf.uasset`
(101.110 B), del inventario existente. No tiene preview asociado ni clase/dependencias de arbusto verificadas;
se difiere. Los materiales del autor existentes son de palmera/terreno; no había un arbusto independiente
preparado en el registro. Se genera arte dedicado para esta prueba.

Siguiente trabajo: preparar derivados con gutters y menor resolución para móvil, usar el alfa del color
como autoridad del recorte, montar hojas con volumen y tallos, y revisar normal suave, viento y sombra
en el mapa real. Estas imágenes fuente quedan fuera del bundle. El catálogo muestra esta ficha como
**Referencia**, con los archivos descargables; todavía no figura como aplicado en juego.

Registro comprobado: revisión 13, 82 filas y 26 aplicadas. Los siete enlaces de la ficha coinciden por
bytes con el proyecto; las cinco copias servidas coinciden con los originales de `materials`.
El HTML abrió la ficha, cargó las tres imágenes a su resolución original y mostró cinco archivos,
sin errores JS. [Captura inspeccionada del catálogo](catalog-v1.png). Repetir el registro conserva la revisión 13.
