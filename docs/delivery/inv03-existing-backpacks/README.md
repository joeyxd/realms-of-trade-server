# INV03 — aceptación de mochilas existentes

Inicio del corte, 2026-10-11. [Alcance e inventario](../../briefs/inv03-existing-backpacks.md). No cambia costes, capacidades ni gameplay; no agrega SQL.

## Primera comprobación

[Prueba SQL actual](sql036.json), [salida](sql036.tap): **11/11** en `tests/starter-workshop-sql.test.mjs`. El caso nuevo aplica la cadena completa **001–036** y usa una mochila válida de tier 1 con Carga 4 ya adoptada. Los demás casos conservan sus fixtures históricos.

Comprueba denegación durable sin cambios con materiales insuficientes, mejora pagada **30→42**, coste exacto **4 tablas + 5 lonas**, piedra ajena al pago conservada, atributos y techo de masa 70 intactos. La lectura durable coincide con el perfil confirmado y repetir el mismo recibo conserva perfil, versión y recibo sin volver a gastar.

Esta prueba no asigna puntos de Carga ni acredita interfaz o partida pública. La prueba histórica PRG01d ya comprobaba una mejora pagada 18→30 con otra versión del juego. El [primer recheck](sql029.json) usó SQL029 sobre SQL024 y pasó 11/11; el actual amplía esa misma comprobación a la cadena completa. Conteos solapados.

## Por completar

Aceptar ambos tiers mediante los botones del taller público: Carga adoptada, mercancía ajena al coste, replay, materiales insuficientes, recarga/reentrada y presentación ES/EN en escritorio/móvil. Mantener el volumen 18/30/42 y el modelo de sobrepeso existente. Las bolsas equipables y el cinturón necesitan su diseño aparte.

## Revisión pública y corrección móvil, 2026-10-13

Sobre alpha.67, el botón real pagó 18→30; coste exacto, Carga 4, techo de masa 70 y
piedra ajena al pago conservados. Replay histórico sin gasto repetido y rechazo durable
por faltar una tabla para 30→42. Los recibos se conservaron; cuentas y perfiles temporales
se eliminaron. La ejecución se detuvo antes de la segunda compra al encontrar el taller
recortado en móvil girado: [evidencia del fallo](browser-20261013-b/browser-0283eea2-8631-4bcd-8882-5a953b2569d3.json).

`styles/workshop.css` ahora limita la altura según el espacio lógico del escenario girado.
**4/4 configuraciones locales** ES/EN escritorio/móvil girado; cabecera, compra y acciones
accesibles mediante scroll, sin desbordamiento: [evidencia](layout/evidence-2026-10-13T06-21-29-121Z.json).
Falta repetir la compra móvil y la reentrada sobre la corrección publicada.

El primer intento también ajustó el recorrido del harness: debía detenerse dentro del
radio real de interacción (3), en lugar de 3,1. No cambió el alcance del juego.
