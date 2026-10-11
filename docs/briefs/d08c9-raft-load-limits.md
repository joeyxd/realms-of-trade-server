# D08c.9 — porte operativo y cimientos reforzados

Contrato de implementación local, 2026-10-07. Continúa D08c.8; no SQL, publicación ni pérdida durable.

- Límite total = mínimo entre capacidad estructural acumulada y 90% de flotación viva.
  Cimiento básico: 10 uM estructurales, 4 uM propias, 60 HP, 14 uM de flotación.
  Cimiento reforzado: 14 uM estructurales, 5 uM propias, 90 HP, la misma flotación.
- Se reserva 3 uM por navegante; piloto e invitados consentidos cuentan una vez. Mochilas de invitados
  también pesan. Su lastre se agrega en el centro de las cajas; mover al tripulante no recalcula su posición
  de lastre en este corte. Distribución dinámica de tripulación queda posterior.
- Porte de bienes = máximo(0, límite total − nave equipada − masa corporal). Carga = bodega + mochilas.
  Masa y espacio son límites independientes; cajas dan espacio, no flotación. Aviso pesado desde 85%.
- Reforzar sustituye un cimiento básico 1:1 por `reinforcedFoundation`, sin moverlo ni duplicarlo.
  Cuesta **1 madera + 1 hierro**, de bodega primero y mochila después. Operación `reinforce`, tuple/index,
  expectedRev/opId, clones, preflight y recibo existentes. Costo total de pieza: 5 madera + 1 hierro.
  Repetición idéntica devuelve recibo; repetir con otro ID no vuelve a reforzar. Retiro usa reembolso normal.
- Zarpe nuevo bloqueado si excede el límite, antes de crear viaje. Invitado adicional no entra si excede
  el porte; invitados a bordo quedan cercados para mutaciones económicas como el piloto.
- Depósito/producción no pueden aumentar exceso de bodega sobre su límite con reserva del piloto.
  Redistribuir bienes no reduce el peso de zarpe. Compras personales y recolección en tierra siguen permitidas.
  Suministros del editor usan bodega hasta su límite de masa/espacio y luego mochila.
- Guardados antiguos se conservan completos. Construcción/refuerzo, retirada y descarga permiten corregir
  exceso; ninguna normalización elimina bienes. Reembarque/atraque/recuperación siguen posibles tras daño
  o recolección en tierra; mostrar exceso y mantener penalización física existente.
- Capacidad privada añade estructura, desplazamiento seguro, tripulación, masa de invitados y estado
  `ready/heavy/overloaded`. Protocolo 24 / alpha.9; no datos de bienes de invitados en proyección pública.

## Reutilización

Revisados D06-REUSE/D08-REUSE y candidato Dreamrise (51.684 bytes, 204 triángulos): es caja, no refuerzo.
Las bandas, pernos y material de hierro de `src/render/rafts.js` sí encajan. Reutilizarlos con una abrazadera
adicional distinguible; cero texturas/modelos nuevos y fuentes `C:\Unreal` intactas.

## Aceptación

Pruebas: masa/espacio, cimiento básico/reforzado, cuello de botella de flotación, atomicidad/costes/recibo,
save legacy, invitados, depósito/producción, zarpe bloqueado y regreso sobrecargado. Browser: PC y dos vistas
móviles emuladas con operaciones reales, revisión visual de refuerzo/lecturas y reentrada firmada.
Números iniciales, sin afirmar balance, dispositivo/FPS real ni demo pública actualizada.
