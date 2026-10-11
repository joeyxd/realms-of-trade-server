# Revisión de tamaño Bucanero

Comparativa del ajuste de tamaño y encuadre del aspecto `char:buccaneer-v1`. Se ejecutó el runner en cuatro sesiones: antes y después, en escritorio 1280×900 y móvil horizontal 844×390. Cada sesión midió cuatro ángulos de la ficha (0, 0.38, 90° y 180°): 16 vistas en total, sin recorte en los bordes.

El manifest pasa de altura 1.89 a 2.12 (+12.17%). El cambio se limita a Bucanero: `figureZoom: 1.1` acerca el modelo importado en la ficha y `portraitFrame: { zoom: 1.6, centerY: 0.44 }` ajusta el recorte del retrato. En el ángulo frontal oblicuo medido, la cobertura vertical de la ficha pasa de 85.4% a 93.9%; ninguna de las cuatro vistas probadas queda cortada. La proyección de altura en mundo pasa de 95.9 a 108.6 píxeles con la misma cámara de comparación.

## Capturas

Cada enlace abre la captura antes/después correspondiente. La toma `fixed-pose` muestra los lienzos de retrato y figura en una comparación directa; `sheet` muestra la ficha dentro de la interfaz.

| Vista | Antes | Después |
|---|---|---|
| Retrato escritorio | [PNG](desktop-before-portrait.png) | [PNG](desktop-after-portrait.png) |
| Retrato móvil horizontal | [PNG](mobile-before-portrait.png) | [PNG](mobile-after-portrait.png) |
| Retrato y figura, escritorio | [PNG](desktop-before-fixed-pose.png) | [PNG](desktop-after-fixed-pose.png) |
| Retrato y figura, móvil horizontal | [PNG](mobile-before-fixed-pose.png) | [PNG](mobile-after-fixed-pose.png) |
| Ficha, escritorio | [PNG](desktop-before-sheet.png) | [PNG](desktop-after-sheet.png) |
| Ficha, móvil horizontal | [PNG](mobile-before-sheet.png) | [PNG](mobile-after-sheet.png) |
| Partida, escritorio | [PNG](desktop-before-game.png) | [PNG](desktop-after-game.png) |
| Partida, móvil horizontal | [PNG](mobile-before-game.png) | [PNG](mobile-after-game.png) |

La cobertura vertical del contorno alpha de la figura en la ficha pasa de 85.4% a 93.9% en el ángulo indicado; es una medida de encuadre, no de calidad del retrato. Se revisaron visualmente el Bucanero en el mundo, la ficha y el icono. También se comprobó el ajuste con armas, herramienta de cosecha y farol; estas capturas documentan tamaño/encuadre y no constituyen una aprobación artística.

## Evidencia y estado

- [acceptance.json](acceptance.json): medidas por sesión, ángulos, resolución del albedo y resultado del control de recorte.
- [Acciones/fallback: evidencia de navegador](actions/browser-evidence.json) y [poses de escritorio](actions/desktop-poses.png).
- [asset-evidence.json](../../../art/buccaneer-v1/asset-evidence.json): hashes de originales y derivados, dimensiones, triángulos, skin y comprobaciones de invariantes. Los originales se conservaron byte por byte; las variantes mantienen los hashes invariantes de geometría, skin y nodos frente a la fuente.
- **36/36 pruebas focales** pasaron. SQL y protocolo 55 no cambian.
- **19/19 comprobaciones de acciones/fallback** pasaron sin errores del navegador; se inspeccionaron las capturas de poses de escritorio y ficha/partida móvil.
- La publicación está pendiente. Esta evidencia local no afirma despliegue ni mediciones de FPS.
