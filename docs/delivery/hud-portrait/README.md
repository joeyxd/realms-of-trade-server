# AREA03 — HUD ordinario en pantalla vertical

2026-10-10. Corrige el solapamiento observado durante el [canario de taller alpha.40](../prg01d-starter-workshop/activation/browser-alpha40-20261011-0247/README.md).

El estado del jugador y el minimapa ocupan columnas separadas; los controles de cuenta quedan debajo,
con objetivos de toque de 44 px en los tamaños compactos comprobados. Los avisos de zona y las
notificaciones usan filas propias. El modo horizontal compacto reserva espacio para compañeros
y conserva libres los controles de combate comprobados. El banner de escritorio queda debajo del
encabezado. Los estilos nuevos se limitan al HUD caminando; se conserva el estilo naval existente.

Se reutilizan los componentes y recursos actuales. Cambios en `styles/hud.css` y `styles/minimap.css`;
sin gameplay, SQL, protocolo, escritor ni assets nuevos.

Validación local: **36/36** casos del cliente real con SoloWorker, teclado/ratón y toque emulado,
ES/EN y escala 100/130 %. Pantallas: 320×640, 390×844, 430×932, 844×390 y escritorio 1280×800.
[Geometría y evidencia](local/evidence.json), veinte capturas. El principal inspeccionó portrait táctil
ES, escritorio ES y horizontal táctil ES/ratón EN al 130 %, y ajustó el cruce con el arco de combate.

`tools/qa-hud-portrait.mjs` comprueba límites y cruces entre jugador, controles, minimapa/título,
banner y toast; mide botones esenciales y compara banner/controles con los botones de combate
visibles seleccionados. Muestra el botón real de compañeros y avisos largos mediante fixtures DOM
de presentación. No cambia perfiles/mundo ni emite comandos económicos.

Alcance: estados ordinarios caminando. No acepta party/boss activos, todos los textos posibles,
todos los tamaños, panel de compañeros abierto, gameplay táctil humano ni FPS físicos. La barra
inferior de combate con ratón en una ventana de 390 px sigue fuera de esta corrección.

Publicación y comprobación VPS se añaden después de fijar revisión/imagen y ejecutar el mismo
recorrido por WSS público. La prueba visual no sustituye la evidencia durable histórica del taller.

Siguiente AREA03: [INV02a Carga](../inv02a-carry-contract.md), cálculo preparado sin montar;
[integración pendiente y límites](../../briefs/inv02a-durable-carry.md).
