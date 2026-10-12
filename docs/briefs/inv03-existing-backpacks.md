# INV03 — partir de las mochilas existentes

Revisión de continuidad del 2026-10-11, sobre alpha.59/protocolo 58. Este documento es un inventario del estado y una propuesta de alcance; no activa recetas ni capacidades nuevas. SRV02 se cierra por separado en [su entrega](../delivery/srv02-special-meals/README.md).

## Lo que ya existe

- Tres capacidades de mochila: **18 / 30 / 42 unidades de volumen**, en [`CARRY.backpacks`](../../src/data/carry.js). Las mercancías tienen volumen y masa independientes.
- El taller ya permite las dos mejoras mediante `artisan/upgradePack`: **2 tablas + 3 lonas**, después **4 tablas + 5 lonas**. [`workshopOperation.mjs`](../../server/workshopOperation.mjs) valida el coste, la revisión y la capacidad resultante; el recibo M5 guarda el cambio. La [UI del taller](../../src/ui/workshop.js) muestra las mejoras.
- Con Carga adoptada, el peso cómodo es **40 + 4 por punto** y el techo **50 + 5 por punto**. La mochila amplía volumen; Carga gobierna el peso. Sobrepeso y movimiento ya existen.
- La bolsa de equipo de 24 posiciones sigue separada. Hacha y pico tienen su espacio de herramientas; todavía no hay cinturón ampliable.

`PLAN-PROGRESSION.md` §15.7 del checkout compartido confirma la mezcla aprobada: conservar volumen 18/30/42 y atribuir el peso a Carga. Los 16 huecos con pilas quedaron aplazados. No volver a implementar esos sistemas ni borrar excedentes.

## Siguiente corte recomendado

Primero aceptar el flujo existente de mejora de mochila con el sistema actual: coste exacto, cambio de volumen, Carga y mercancías conservadas, replay, denegación sin cambio y reentrada; presentación ES/EN escritorio y móvil. Comprobar la evidencia previa antes de repetir canarios. Las capacidades/costes anteriores describen el código; balance definitivo y sensaciones requieren playtest.

La [aceptación pública PRG01d de alpha.39](../delivery/prg01d-starter-workshop/activation/public-4e926d4b-bc17-4c9b-b2a1-7924dac83d94.json) ya incluye una mejora pagada 18→30 dentro de su canario de 36 comprobaciones. El [harness](../../tools/qa-workshop-public.mjs) entrega solo 2 tablas y 3 lonas, comprueba su consumo, el aumento de tier y el recibo. No acredita 30→42, conservación de otra mercancía, replay/reentrada de esa mejora ni Carga adoptada. El navegador de aquella entrega muestra la oferta, sin completar una mejora pagada.

Por tanto, INV03 debe completar esas lagunas sobre el taller existente: ambos tiers con Carga adoptada y mercancía ajena al pago, replay idéntico, denegación por materiales insuficientes, persistencia al volver y botones reales ES/EN en escritorio/móvil. La prueba SQL existente cubre el primer tier; ampliar esa comprobación al segundo antes del canario público. No hace falta diseñar otro sistema de mochilas para este corte.

Primer avance local: [SQL029 11/11](../delivery/inv03-existing-backpacks/README.md), incluido el segundo tier con Carga conservada, coste exacto, otra mercancía, denegación y replay durable. La cadena SQL actual completa y la aceptación pública permanecen pendientes.

Una bolsa como objeto que se posee y equipa sería una ampliación distinta. Antes de implementarla hay que cerrar su relación con las mejoras ya pagadas, la ranura, el origen/receta, la capacidad y qué ocurre al quitarla con mercancías dentro. No introducir un segundo modificador de volumen ni reiniciar las mejoras existentes. Cinturones y nuevos tiers se coordinan con PRG04.

## Referencias y reutilización

- `PLAN-PROGRESSION.md` §15.2–15.7, `PLAN-MASTER.md` AREA03 del checkout compartido.
- [Carga y límites](../../src/sim/economy/carry.js), [taller](../../server/workshopOperation.mjs), [UI](../../src/ui/workshop.js).
- [Inventario Unreal de supervivencia](../research/unreal-assets/survival/FINDINGS.md): `BPC_SimpleInventorySystem` y su tabla de ítems sirven de referencia de flujo; no contienen un contrato portable de peso/pilas demostrado. Este corte no necesita exportar arte ni tocar las fuentes Unreal.

Las decisiones sobre flotabilidad, bodegas y peso naval conservan su plan y autoridad propios.
