# D08b.4a — HUD de la nueva referencia y vista de navegación

2026-10-06. El autor acepta el aspecto del primer HUD B4 («se ve excelente») y pide acercarlo
al nuevo encuadre: paneles oscuros, iconos blancos, radar sobrio y velocímetro naranja segmentado.
Autoriza crear arte alpha si hace falta. Esta pasada usa SVG/CSS fijo, sin necesidad de raster nuevo.

## Dirección y alcance

- Navegación a pantalla completa por defecto; Ajustes abre el laboratorio y Volver a navegar lo cierra.
- Negro translúcido, filetes de metal gastado y blanco marfil; menos papel dorado en las tarjetas.
- Iconos dibujados de viento y caja, tecla en la esquina, estados reales visibles y zonas táctiles ≥44 px.
- Dial con segmentos amarillo/naranja/rojo, cristal oscuro y llama discreta durante el boost real.
- Brújula oscura con anillos finos, proa blanca, viento dorado y flujo cyan. Mantener 0° = +Z.
- Avisos blancos inclinados sobre placas oblicuas, acento de color según captura/boost/corriente.

Conservar velocidad en u/s, carga/lastre experimental, timing, acciones y adaptación de B4. El centro
queda para la balsa y el trayecto. No copiar las barras de rival, radar de enemigos ni combo de la
referencia sin sus mecánicas. No cambiar simulación, fuerzas, cámara, audio o iluminación en este corte.

En vistas estrechas se reserva un pie de 165 px; en horizontal corto, 100 px. Medir el canvas útil,
los botones y sus solapes. Ajustes debe entrar en pantalla también cuando el panel pasa debajo del mar.
Evitar que Espacio/J/W/R sobre controles del laboratorio disparen navegación; liberar teclas al cambiar
foco y mantener Escape. Devolver el foco al canvas al reanudar o cerrar Ajustes.

## FAB y equipo

Antes de dibujar, Luna revisó los candidatos `T_SlotFrame.uasset` (6129 B) y `T_SlotBackG.uasset`
(6459 B) de `ActionRPGMultiplayerStart/.../JigSaw/Widgets/Images`. Existen empaquetados, sin exportación
ni preview portable revisado; no hay un icono naval listo que ahorre este dibujo. No se modifican fuentes
Unreal. Sustituir el mastbolt de B4 por curvas de viento; caja, brújula y dial quedan en SVG local fijo.
Sin fuentes web, texturas adicionales ni importación del HUD general/GSAP.

GPT-6 Luna realiza lectura acotada, revisión de contratos, arreglo de input/prueba y evidencia mecánica.
El principal conserva dirección visual, HTML/CSS, integración, revisión de capturas y aceptación.
Un escritor por archivo y un navegador/GPU a la vez; preservar trabajo concurrente de M5/arena/puerto.

## Verificación

Revisar escritorio 1280×800, vertical 390×844, horizontal 844×390, ancho 320 y tamaño nativo restaurado.
Capturar una ráfaga mediante la tarjeta real, soltar lastre real, abrir/cerrar ajustes y comprobar el foco
con teclado. Medir zonas táctiles, SVG fijos y URLs de madera 1024/512 realmente cargadas. Guardar
snapshots y JPEG originales con hashes; declarar la versión de cada captura.

El autor acepta visualmente esta pasada el 2026-10-06 («quedó muy bien»). Las pruebas y esa reacción
no cierran teléfono/mando físicos ni FPS. Q1 de luz/reflejos sigue separado y propuesto. B5 espera gameplay/autoridad.
[Entrega y evidencia](../delivery/d08b4a-reference-hud.md).
