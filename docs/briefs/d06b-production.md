# D06b — primera producción de la balsa

Preparado 2026-10-05; pendiente de implementar y aceptar. Depende de D06a bodega/comercio.
No convierte M6 P4 completo en una entrega aceptada.

## Camino del siguiente corte

1. Revisar candidatos del inventario antes de añadir arte. `SM_RepairBench` Dreamrise es el primer canario
   propuesto: copiar solo dependencias necesarias fuera de `C:\Unreal`, exportar y comprobar escala, pivote,
   UVs, estilo toon y coste móvil. Fuentes intactas. No hay GLB listo; el banco no demuestra recetas funcionales.
   Ver [revisión D06](../research/unreal-assets/D06-REUSE.md). No sustituir red/parrilla por el banco solo por tenerlo.
2. Elegir una cadena pequeña de piezas ya definidas (red → pescado → parrilla, o agua → huerto).
   Ampliar la lista del editor únicamente con las piezas necesarias; conservar costes, soporte y capacidad.
3. Conectar producción al reloj autoritativo para balsas de jugadores conectados. Mostrar tasa, insumos,
   resultado y motivo de parada en el panel; no calcular producción desde frames del cliente.
4. Guardar progreso fraccionario saneado, confirmar consumo/producto/capacidad juntos y probar reentrada.
   Luego recorrido real por UI en Worker, PC/móvil horizontal/vertical y capturas inspeccionadas.

## Problemas actuales que deben resolverse antes de activar

- `stepRaft` existe, pero no se llama en el mundo jugable. `sanitizeRaft` descarta su `acc`; activar el reloj
  sin cambiar ese contrato perdería progreso al guardar. Las recetas usan índices de piezas para el acumulador:
  retirar/reordenar una pieza no debe mover progreso a otra.
- El motor actual pierde producción que no cabe y puede consumir insumos antes de descubrir que el resultado
  no cabe. El corte debe tener una regla explícita y visible para bodega llena, con preflight del lote y pruebas
  de conservación. No introducir pérdida silenciosa de bienes comprados ni acumulación ilimitada.
- Resolver tamaño del save firmado y perfil candidato antes de mutar. Un tick, reintento o reconexión no puede
  repetir un lote. No prometer transacción durable conjunta mercado/perfil por los recibos de sesión de D06a.
- La velocidad mostrada en bodega sigue siendo teórica. Este corte no entrega timón, viento, zarpar ni pérdidas.

## Delegación y aceptación

Luna: revisión/exportación acotada del candidato, implementación delimitada y pruebas independientes.
Principal: regla de producción, contrato de persistencia, integración, revisión de evidencias y aceptación.
Un escritor por archivo y una prueba GPU/navegador a la vez. D08 manejo naval viene después; reservas y
movimientos expuestos con durabilidad requieren D09. Hamaca, reaparición y faroles no se cierran por este brief.
