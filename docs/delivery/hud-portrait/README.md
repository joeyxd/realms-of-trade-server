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
de presentación. Los fixtures no editan perfiles ni mundo y no emiten comandos económicos.

Alcance: estados ordinarios caminando. No acepta party/boss activos, todos los textos posibles,
todos los tamaños, panel de compañeros abierto, gameplay táctil humano ni FPS físicos. La barra
inferior de combate con ratón en una ventana de 390 px sigue fuera de esta corrección.

Comprobación pública: **36/36** por WSS como invitado, veinte capturas y ninguna incidencia de
geometría o error de página registrado. [Resultado](public/evidence.json),
[autoridad antes/después](public/authority.ndjson) y [fuentes servidas](public/source-hashes.json).
El principal inspeccionó las capturas públicas vertical táctil ES, horizontal táctil EN y escritorio
ES al 130 %. Los cuatro archivos de HUD/contrato consultados por HTTP coincidieron con sus blobs Git.

Aceptación en `6c42e849a05a140296751daf88110c536eb4b07e`, alpha.41/protocolo 47, imagen
`sha256:874a1ec2c92a9c4e52e102971d608390fef2b1da70813c1b712f4fb9d02c2b4c`.
Revisión e imagen fijas entre 03:22:07 y 03:24:07 UTC del 2026-10-11, bajo los locks existentes del
actualizador y del cambio de contenido. Health público 200; una autoridad, cero errores, escrituras
pendientes o datos sin guardar antes/después, y temporizador de actualización activo al terminar.
La versión del mundo pasó de 2090 a 2092 durante la prueba con conexiones ordinarias de invitado;
no se crearon cuentas Auth ni se emitieron operaciones económicas. Esta prueba visual no repite ni sustituye la evidencia durable
histórica del taller. El contrato de Carga está publicado, pero sigue sin imports de gameplay.

Siguiente AREA03: [INV02a Carga](../inv02a-carry-contract.md), cálculo preparado sin montar;
[integración pendiente y límites](../../briefs/inv02a-durable-carry.md).
