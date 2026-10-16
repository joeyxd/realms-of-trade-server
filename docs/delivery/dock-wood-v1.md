# S13 — madera ilustrada en el muelle

Implementación local del 2026-10-07. **67 tablones y dos vigas de la cubierta** del muelle existente
usan el atlas pintado de la balsa: veta longitudinal, grietas y restos turquesa. Cuatro recortes dentro
de tablas individuales y sus cuatro espejos evitan repetir el mismo nudo en una única columna.
El lavado de color es moderado; la luz, sombras y tinta del mundo siguen dibujando el volumen.

[Brief y decisión de reutilización](../briefs/visual-s13-dock-wood.md). Los candidatos Unreal revisados
son casa/banco/caja y piezas de galería, sin prueba de un kit de muelle portable. Se reutiliza la pareja
WebP ya integrada; fuentes Unreal intactas. No se generan imágenes ni se modifica el manifiesto.

## Integración y coste

`dockWood.js` conserva UVs de cada primitiva antes de que `part()` las retire y aplica el recorte en
espacio local antes de trasladar/unir las tablas. `props.js` cambia únicamente el material de la cubierta.
El registro aporta el mismo objeto `tex:raft-comic-v1` que usa la balsa. Sin atlas, conserva exactamente
el material procedural y los colores anteriores. La pintura forma parte del albedo existente; no activa
una máscara editable de pintura, normal map ni nuevo sistema de humedad.

| Recurso de cubierta | Antes | Después |
|---|---:|---:|
| Meshes | 1 | 1 |
| Triángulos | 828 | 828 |
| Buffer UV | 0 B | 19.872 B |
| Material de color propio | 0, compartía el de props | 1 |
| Imágenes/pases nuevos | 0 | 0 |
| Atlas PC seleccionado | 1024² · 308.536 B | mismo recurso compartido |
| Atlas táctil seleccionado | 512² · 82.878 B | mismo recurso compartido |

No se añaden llamadas de dibujo por una malla adicional; el shader mapeado tiene una variante propia.
Ese presupuesto y los contadores no miden FPS físicos. No se cambia la pareja de atlas al alternar calidad.

## Verificación

**105/105 pruebas pertinentes**: 96 de las familias visuales/catálogo y nueve del atlas/renderer de balsa.
Las cuatro pruebas de muelle cubren UVs por eje local, ocho orientaciones/variantes negativas,
igualdad de posiciones/normales/colores, preservación del recurso compartido, fallback y RNG prohibido.

Tres comparaciones antes/después: PC high, táctil medium y táctil low. En cada pareja coinciden datos del
muelle y `map.props`, los 27 meshes de props, geometría/matrices locales/materiales de props estáticos y
posición/normal/color/índice/matriz/sombras de la cubierta. SHA-256 de los buffers capturados, no solo conteos.
Las banderas animadas se excluyen de comparación de atributos/matriz porque su fase avanza durante la
entrada; se conservan conteo/índice/shader/sombras. La UV es el único buffer añadido a la cubierta.

**Siete casos finales**, dos encuadres por caso: PC, móvil horizontal, low, noassets, noche, viewport
vertical con stage rotado y 404 deliberado del atlas. **28 cambios de calidad** high→low→medium→high
con reutilización de geometría/material, GL=0 y todos los programas enlazados. Sin errores de página/juego.
El caso 404 registra únicamente el fallo deliberado del atlas y recupera el material anterior; los demás
no tienen errores de assets. Favicon local 404 se permite cuando aparece y queda registrado.

Son **20 capturas de comparación**; se inspeccionaron vistas de detalle/general PC/móvil, low, noche,
vertical y ambos fallbacks. La cámara se fija sobre el muelle real; no hay galería ni geometría de muestra
en el mapa. Antes se inyecta únicamente la copia pre-S13 de `props.js` sobre el checkout actual.

- [Runtime y hashes de buffers](../art/dock-wood/runtime-evidence-v1.json).
- [Fuentes finales congeladas antes/después](../art/source/dock-wood-v1/final/source-snapshot.json): ocho entradas.
- [Detalle PC](../art/dock-wood/desktop-detail-after-v1.png),
  [móvil](../art/dock-wood/mobile-detail-after-v1.png),
  [general PC](../art/dock-wood/desktop-overview-after-v1.png).

Reproducir checks históricos y catálogo con:

```text
node tools/prepare-dock-wood-sources.mjs --check
node tools/register-dock-wood-catalog.mjs
node tools/verify-dock-wood-catalog.mjs
```

El recibo se congela una sola vez: los checks no lo refrescan desde cambios futuros. La fila M01 conserva
sus archivos/evidencia de balsa y añade este uso; `muelle-tablones` registra la cubierta existente.
Piso modular, poste, viga/diagonal y soporte inferior conservan su aceptación independiente.

La primera congelación bajo `source/dock-wood-v1/source-snapshot.json` se conserva como diagnóstico:
la revisión UI detectó `kind: prop`, que el catálogo no traduce. Se corrigió a `object` y se congelaron
los tools finales en `final/`; no se reescribe el recibo anterior ni cambia el runtime de las capturas.

Catálogo revisión **22**, 86 filas/35 aplicadas; registrar de nuevo conserva la revisión. **37 enlaces HTTP**
coinciden por SHA-256 y el JSON completo de ambas filas coincide con el servido. Ficha M01 revisada en
navegador: 23 imágenes decodificadas, 63 enlaces y cero errores de página. Ficha final de tablones:
20 imágenes decodificadas, 55 enlaces y etiqueta «Objeto» correcta, sin errores de página.
[Mapa local](http://127.0.0.1:5192/?solo&debug&q=high&tod=day)
y [catálogo](http://127.0.0.1:5190); el muelle está junto al punto de llegada de la playa.

Arte final del autor, repetición a otras escalas y FPS en equipos físicos pendientes. Postes/soportes,
paredes y kit modular siguen pendientes. No publica la demo ni modifica M5/SQL, recursos, navegación,
chat, personajes o prioridades de esas líneas.
