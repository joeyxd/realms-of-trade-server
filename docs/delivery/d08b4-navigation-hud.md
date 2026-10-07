# D08b.4 — dial, brújula, timing y maniobras

2026-10-06. Fuente: `a58ed804f8c25bfccfd8a1c8e80d62b617db9f0c`.
Bahía local: <http://127.0.0.1:5180/>. Primer corte del HUD inspirado en la referencia.

## Resultado

El dial naranja muestra la velocidad real en unidades por segundo; el arco verde indica cuánto
boost queda. La brújula de latón separa proa verde, viento dorado y flujo cyan. Usa grados del mundo,
0° = +Z; no presupone norte geográfico. Las flechas desaparecen en calma o sin corriente local.
El peso muestra lastre de prueba y carga total del casco respecto de su flotación.

La barra de ráfaga sitúa la ventana verde y la banda dorada del perfecto desde las constantes reales
de navegación. Las tarjetas conservan los controles existentes: Espacio/A/táctil para capturar y
J/táctil para soltar lastre. La nueva tarjeta llama a la misma función del botón lateral. Pausa,
reinicio, lastre y cambios de opciones actualizan la lectura inmediatamente. Los avisos «¡PERFECTO!»,
«¡RÁFAGA CAZADA!», «VELA CARGADA» y «CORRIENTE ACTIVA» salen del estado actual; no declaran que toda
corriente favorezca el rumbo. Las reglas de manejo, timing, fuerzas y audio permanecen iguales.

En escritorio amplio se distribuyen los controles por el borde inferior. Las vistas estrechas reservan
180 px para el pie; las vistas horizontales de hasta 1000 px de ancho reservan 110 px y desplazan la
preparación debajo. El canvas 3D se mide y renderiza con su altura útil, preservando la balsa y la
lectura de controles. Es una adaptación del laboratorio, no el HUD final del cliente de partida.

Hay cuatro SVG de arte fijo: brújula, dial y dos tarjetas; junto a la tinta previa son cinco SVG en la
bahía. Sin fuentes web, raster nuevo, audio nuevo ni importaciones pesadas del HUD principal. Nodos
reutilizados; textos/atributos se escriben cuando cambian. Los presupuestos B3 y material B2 continúan.

## Verificación

**88/88 pertinentes en 15 archivos**, Node v24.14.0, exit 0; duración 1020,4726 ms. Ocho casos nuevos
del modelo puro cubren grados/signos, wrap 360→0, arco acotado manteniendo velocidad real, expiración,
estados de captura, marcas de timing, entrada inmutable y corriente en contra. No se repitió M5 global.

Chrome: escritorio 1280×800 y móvil emulado 390×844 / 844×390. Se inspeccionaron imágenes guardadas,
casa flotante y tamaño nativo restaurado. La captura perfecta se ejecutó con el botón real, sin mutar
la simulación: tick 420, resultado `perfect`, velocidad 8,59584 u/s y 5,25 s de boost restantes; lectura
redondeada 8,6 / 5,3. La vista móvil horizontal reprodujo los mismos valores. El primer intento de
escritorio fue una captura normal y también mostró el aviso correcto.

En vertical, soltar el bulto de 24 de lastre pasó masa/HUD de 24 a 0 y carga de 80% a 38%; tick 0
conservado, tarjeta deshabilitada después. Pausa conservó estado y HUD al observarlos separados por
500 ms. Cambiar a calma/apagar corrientes conservó movimiento, retiró flechas y limpió el boost/aviso.
Los controles medidos son ≥44×44 px; las tarjetas verticales son 80×77,91 px y horizontales 75×70 px.
La casa permanece legible en vertical con la barra compacta. Logs de errores de juego vacíos en las
vistas revisadas. Madera realmente cargada: escritorio 1024²; móvil solo color 512², sin normal runtime.

[Evidencia estructurada](d08b4-navigation-hud-evidence.json): hashes de seis fuentes, imágenes JPEG,
dimensiones reales, metadata y snapshots esenciales. Imágenes/raw snapshots locales en
`shots/naval-hud-20261006/`, ignorados por Git. La captura final de escritorio y casa corresponden a
la fuente commiteada; capturas intermedias se identifican como tales. El checkout comparte cambios
concurrentes de arena/manifest/toon, fuera de este corte; no afirmar un árbol completo aislado.

## FAB y siguiente

Confirmados en `C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\InventorySystem\JigSaw\Widgets\Images`:
`T_SlotFrame.uasset` (6129 B) y `T_SlotBackG.uasset` (6459 B). Sin exportación ni preview portable
revisado; no se integran. Los cursores PNG disponibles tampoco sirven como arte naval. Se reutiliza
la forma SVG de `mastbolt` de `src/ui/hud.js` con tinta local, sin importar GSAP/renderer del HUD general.
Luna realizó búsqueda, modelo/pruebas y revisión; el principal diseñó, integró y comprobó las vistas.

El autor pidió después luz general y reflejos de mayor presencia en gráficos altos: **Q1 propuesto**,
ensayo A/B de iluminación y SSR/bloom/grading existentes. B4 no cambia iluminación ni posprocesado.
El feedback favorable recibido corresponde al look B3; aceptación humana del HUD, FPS/teléfono/mando
físicos y calibración de normal/mipmaps siguen abiertos. B5 necesita encuentro/daño/huida/autoridad real;
continúan las dependencias M5/D09/D10. Sin push ni despliegue público en este corte.
