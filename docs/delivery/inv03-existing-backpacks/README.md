# INV03 — aceptación de mochilas existentes

Inicio del corte, 2026-10-11. [Alcance e inventario](../../briefs/inv03-existing-backpacks.md). No cambia costes, capacidades ni gameplay; no agrega SQL.

## Primera comprobación

[Prueba SQL actual](sql036.json), [salida](sql036.tap): **11/11** en `tests/starter-workshop-sql.test.mjs`. El caso nuevo aplica la cadena completa **001–036** y usa una mochila válida de tier 1 con Carga 4 ya adoptada. Los demás casos conservan sus fixtures históricos.

Comprueba denegación durable sin cambios con materiales insuficientes, mejora pagada **30→42**, coste exacto **4 tablas + 5 lonas**, piedra ajena al pago conservada, atributos y techo de masa 70 intactos. La lectura durable coincide con el perfil confirmado y repetir el mismo recibo conserva perfil, versión y recibo sin volver a gastar.

Esta prueba no asigna puntos de Carga ni acredita interfaz o partida pública. La prueba histórica PRG01d ya comprobaba una mejora pagada 18→30 con otra versión del juego. El [primer recheck](sql029.json) usó SQL029 sobre SQL024 y pasó 11/11; el actual amplía esa misma comprobación a la cadena completa. Conteos solapados.

## Alcance de aceptación pública

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
La repetición sobre la corrección publicada se cerró con el resultado siguiente.

El primer intento también ajustó el recorrido del harness: debía detenerse dentro del
radio real de interacción (3), en lugar de 3,1. No cambió el alcance del juego.

## Cierre público

**22/22 comprobaciones**, cuatro capturas revisadas ES/EN escritorio/móvil girado,
en **`a21c47f0fe6acbc3c63682b1aaa3b87acbeb4ccf`**, alpha.67/protocolo 60:
[evidencia completa](browser-20261013-final/browser-4d9c5b94-9d3d-4272-8a7e-7c2650d92014.json).

- Login normal y recorrido al banco con inputs de cliente; ambas compras por botones reales.
- **18→30 por 2 tablas + 3 lonas**; **30→42 por 4 tablas + 5 lonas**.
- Carga 4, revisión de atributos, techo de masa 70 y una piedra conservados.
- Cada compra tiene recibo M5 y replay histórico sin segundo gasto ni segunda mejora.
- Una tabla menos: botón deshabilitado y solicitud directa rechazada con recibo durable,
  sin cambio de mochila/materiales. Esta solicitud solo verifica el rechazo del servidor.
- Recarga y reentrada autenticada restauran mochila 42, Carga y piedra; máximo visible.
- Cero errores de página, consola, HTTP o solicitudes inesperadas; transporte WSS.
- Cuenta y perfil temporales eliminados y comprobados. Tres recibos inmutables conservados.

La preparación de cada fase usa un perfil temporal marcado y CAS solamente desconectado,
con el host drenado; no se conceden materiales a cuentas reales. La masa/volumen y el
sobrepeso existentes no cambian. No acredita tacto/rendimiento en teléfono físico.

INV03 cierra las mejoras existentes. Siguiente dirección aprobada:
[plantas → fibra → lona; palmeras → techumbre; animales → cuero](../../briefs/plant-fiber-thatch-leather.md).
