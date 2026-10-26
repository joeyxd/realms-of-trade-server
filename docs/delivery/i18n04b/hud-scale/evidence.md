# QA de escala del HUD y minimapa

Matriz repetida en Chrome 154.0.8037.99 después del intro real. En cada viewport la fixture montó los módulos reales `Hud`, `MiniMap` y `PersonalLanternActions`; la linterna se añadió a su padre de producción `#ui`. Esperó `Hud.show()`, cambió el idioma y el título ES↔EN, esperó la transición GSAP, aplicó la escala solicitada y midió los rectángulos finales. La regla real de reserva `#ui:has(.personal-lantern:not([hidden])) #hud` estuvo activa. `src/main.js` se interceptó como módulo vacío: escena 3D, WebGL y red del juego ausentes; Three y GSAP locales.

| Viewport / escala / idioma | Tracker (x, y → derecha, abajo) | Caption | Antorcha | Barra de acciones | Tracker sin solapes | Scroll / filas visibles | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1280×800 / 1 / EN | 1016, 194 → 1266, 462 | 1101, 162 → 1273, 174 | 1148, 608 → 1262, 656 | 367, 704 → 913, 786; 82 px | Sí: caption, antorcha y barra | 264/264 px; 5 filas | Pasa |
| 1280×800 / 1 / ES | 1016, 194 → 1266, 462 | 1101, 162 → 1273, 174 | 1126, 608 → 1262, 656 | 367, 704 → 913, 786; 82 px | Sí: caption, antorcha y barra | 264/264 px; 5 filas | Pasa |
| 1280×500 / 1.3 / EN | 941, 194 → 1266, 296 | 1101, 162 → 1273, 174 | 1148, 308 → 1262, 356 | 285, 379 → 995, 486; 106.6 px | Sí; 12 px sobre antorcha | 264/74 px; rueda llega a 190, última fila completa | Pasa |
| 1280×500 / 1.3 / ES | 941, 194 → 1266, 296 | 1101, 162 → 1273, 174 | 1126, 308 → 1262, 356 | 285, 379 → 995, 486; 106.6 px | Sí; 12 px sobre antorcha | 264/74 px; rueda llega a 190, última fila completa | Pasa |
| 844×390 / 1 / EN | 10, 118 → 260, 149 | 665, 162 → 837, 174 | 721, 111 → 835, 159 | 149, 294 → 695, 376; 82 px | Sí | Solo la fila activa `attack`, dentro del tracker plegado | Pasa |
| 844×390 / 1 / ES | 10, 118 → 260, 149 | 665, 162 → 837, 174 | 699, 111 → 835, 159 | 149, 294 → 695, 376; 82 px | Sí | Solo la fila activa `attack`, dentro del tracker plegado | Pasa |

En las seis combinaciones el ancho observado del tracker fue `250 × escala` (250 o 325 px) y la altura observada de la barra fue `82 × escala` (82 o 106.6 px). Después de las transiciones, los transforms inline del tracker y de la barra estaban vacíos. En 500 px, el tracker termina en y≈296: deja 12 px antes de la linterna y 83 px antes de la barra. Caption y tracker conservan 20 px de separación. La rueda de ratón mostró completa la quinta fila en EN y ES. A 390 px el tracker está plegado y expone la fila activa del tutorial, conforme a ese modo compacto.

- [Captura de 500 px EN](./500-en.png)
- [Captura de 500 px ES](./500-es.png)
- [Métricas completas de las seis combinaciones](./layout-metrics.json)
- [Regresión focalizada del cambio de escala tras intro, locale y título](./post-intro-metrics.json)
- [Captura de esa regresión](./post-intro-500-en.png)

La regresión focalizada verifica 250→325 px para el tracker y 82→106.6 px para la barra tras `Hud.show()`, cambio ES→EN con animación del título y mutación de `--ui-scale` en caliente. También conserva la comprobación de `clearProps` y el scroll hasta la última fila.

El [chip de red](./network-locale.json) actualiza singular/plural y título de latencia al cambiar ES/EN, sin requerir otro setNet ni frame de render. Mantiene 42 ms y el contador confirmado.
