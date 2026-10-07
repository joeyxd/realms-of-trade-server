# D08b.4 — HUD de navegación con datos reales

2026-10-06. Continuación visual autorizada tras la reacción positiva del autor a B3.
Bahía aislada `tools/naval-lab/`; principal conserva diseño, integración y aceptación.

## Corte

- Dial naranja: velocidad real en u/s, arco sobre el tope experimental de 13 u/s, aro verde del boost.
- Brújula de grados: proa, dirección del viento y corriente local; 0° corresponde a +Z del mundo.
- Lectura de lastre y peso total/flotación, sin convertir peso de laboratorio en mercancías.
- Barra de ráfaga: progreso, ventana verde y banda dorada de perfecto derivados de los ticks actuales.
- Dos tarjetas: cazar ráfaga mediante Espacio/A/táctil y soltar lastre de prueba con J/táctil.
- Avisos breves de perfecto, captura, boost y corriente activa, con duración/flujo reales.

Reservar el centro de la escena. En escritorio amplio, tarjetas abajo, pilotaje a la izquierda y dial
a la derecha. En vistas estrechas/cortas, reservar un pie para controles y reducir el viewport 3D real;
en horizontal pequeño el panel de preparación pasa debajo de la bahía. Mantener botones de al menos
44 px y mostrar el estado aun sin animaciones. El laboratorio no necesita nuevos enemigos ni perfiles.

## Reutilización y equipo

Luna revisa candidatos FAB, implementa el modelo puro acotado y revisa contratos; el principal integra
HTML/CSS/DOM y revisa el navegador. Un escritor por archivo. Verificar `T_SlotFrame` / `T_SlotBackG`
del proyecto ActionRPG: empaquetados, sin exportación/preview portable aprobado. Reutilizar el SVG de
`mastbolt` existente sin importar el HUD principal con GSAP y sus dependencias. SVG/CSS fijo para el
marco, caja, dial y brújula; ninguna textura adicional. Fuentes Unreal intactas.

## Aceptación

Pruebas de signo/wrap de rumbo, velocidad real con arco acotado, expiración por tick, pausa, estados
de captura, marcas de timing, entradas inmutables y corriente que puede ir en contra. Revisar imágenes
desktop 1280×800, vertical 390×844 y horizontal 844×390; captar una ráfaga con UI real, soltar lastre,
probar calma/corrientes apagadas y restablecer viewport. Conservar imágenes y metadata reproducible.

La aceptación del corte es local en navegador/emulación. Teléfono/mando físicos, FPS, afinado humano
y pilotaje online conservan sus puertas. [Entrega](../delivery/d08b4-navigation-hud.md).
Q1 de luz/reflejos queda propuesto después del HUD, separado de la persecución real B5.
