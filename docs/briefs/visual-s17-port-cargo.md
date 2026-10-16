# S17 — madera pintada en carga del puerto

Extensión visual del acabado S14 a la carga estática que ya aparece en el pueblo y La Caldera. En el mapa fijo con semilla `99282957` hay ocho barriles nativos cerrados y siete cajas abiertas Dreamrise existentes. El cambio adapta sus UV al atlas de madera del pueblo; conserva siluetas y colocación. Es pintura de props existentes, sin carga funcional ni sistema nuevo de almacenamiento.

## Cruce de recursos y decisión

El catálogo Unreal/FAB (`docs/research/unreal-assets/CANDIDATES.csv`, `D06-REUSE.md`) tiene una sola malla de almacenamiento verificada: `SM_StoragePart_03.uasset`, **24.248 B**, en `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_StoragePart_03.uasset`. Ya se exportó y aceptó como `assets/models/prop-storage-crate.glb` (**51.684 B**, 204 triángulos, una parte), con paleta 1024²; el manifiesto `prop:storage-crate` reemplaza `crate`. Su caja abierta aporta la silueta de caja y el runtime puede volver a la caja procedural si el modelo falta.

La búsqueda acotada de nombres en los proyectos también encontró dos paquetes de barril en `MyProject`, pero no aparecen como candidatos revisados en el catálogo: `C:\Unreal\MyProject\Content\Kobo_Dungeon\Meshes\SM-Barrel-01-01.uasset` (**3.846.208 B**) y `SM-Barrel-02-01.uasset` (**4.433.034 B**). Clases, dependencias, geometría, estilo y exportabilidad no están verificados; un albedo relacionado ocupa por sí solo 4.030.052 B. No se exporta ninguno para S17. Se conservan los barriles cerrados procedurales, que ya encajan en el presupuesto de geometría de este acabado. No se crean texturas ni entradas nuevas al manifiesto.

## Aplicación runtime

`src/render/portCargo.js` remapea geometría clonada a los sectores existentes de `tex:town-wood-albedo-v1` y `tex:town-wood-normal-v1`. Se comparten los samplers, el programa toon y el material del pueblo; fuerza del normal **0,18**. Albedo y normal son dos atlas acolchados S14, 2048² en PC y 1024² para puntero táctil, seleccionando una variante por carga. Sin color se conserva la pintura anterior; sin normal se mantiene el nuevo albedo con normales geométricas. El acabado no requiere descargar arte nuevo.

En el barril procedural torneado, la veta corre vertical sobre las duelas. Cada triángulo completo se asigna a su región para evitar interpolar UV a través de los aros o de la costura angular. Los dos aros de hierro usan el recorte del atlas **V 0,835–0,895**; tapa y fondo de caja usan la región de piso. En la caja abierta Dreamrise, la veta se gira para quedar horizontal como los tablones. Solo se clona la geometría de las instancias ajustadas de `prop:storage-crate` y se comparte el material del pueblo; no se modifica el modelo propiedad del registro ni su definición global.

El acabado se aplica a los ocho barriles estáticos fusionados y a las siete instancias de caja existentes del pueblo y La Caldera. No cambia cantidades, posiciones, rotaciones, escalas, normales, índices, matrices de instancia, bounds, sombras, colisiones, RNG ni datos del mapa. Los flotantes, su animación y la balsa quedan fuera de este cambio.

## Revisión y aceptación local

La revisión compara tres vistas antes y después (vista general, barril y caja) en escritorio/móvil/low; nueve contextos finales incluyen noche, noassets, color/normal ausentes, modelo ausente y vertical. Los 36 cambios de calidad `high → low → medium → high` mantienen GL=0 y recursos idénticos. Se comprobaron las URLs/resoluciones reales, material/programa compartido y geometría de posiciones, normales, índices, transformaciones y sombras, además de capturas inspeccionadas.

**122/122 pruebas visuales seleccionadas pasan**, incluidas cuatro nuevas de carga. La [entrega](../delivery/port-cargo-v1.md) documenta recursos, comparaciones, respaldo y limitaciones. Arte fino, variantes adicionales, FPS en dispositivos físicos y publicación pendientes. Las mallas Unreal permanecen intactas.
