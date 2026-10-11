# AREA03 — revisión de sobrepeso existente

Fecha: 2026-10-11. Base revisada: `f26aae2`, alpha.52/protocolo 55.

El autor pidió comprobar el trabajo de las otras sesiones antes de continuar. La rama
`claude/loving-lovelace-ptbif7` ya contiene INV02d, incorporado en `448f4a2` y publicado
como alpha.49 en `8c9743a`. Esta revisión conserva esa implementación y añade una
corrección acotada de compatibilidad. No necesita SQL ni cambios de protocolo.

## Qué ya existe

- [Carga durable y controles](inv02c-attribute-controls.md): adopción explícita,
  puntos, reasignación y capacidades independientes de volumen/masa.
- [INV02d](inv02-survival.md): con Carga adoptada, cómodo `40 + 4 × puntos`, techo
  `50 + 5 × puntos`; hasta el cómodo, movimiento normal; por encima y hasta el
  techo, 70 % sin iniciar dash; por encima del techo, 40 %. Nunca inmoviliza.
- [Cálculo compartido](../../src/sim/economy/carry.js) y
  [movimiento](../../src/sim/systems/movement.js): la autoridad calcula `load` en
  cada comando. El snapshot lo transporta para predicción/reconciliación.
- [Capacidad de carga](../../src/sim/economy/cargo.js): compras, recogida y
  retiradas de bodega ya comprueban masa y volumen antes de añadir mercancías.
  El agua y sus recipientes cuentan en la masa. Natación mantiene su modelo propio;
  el multiplicador terrestre se descarta al nadar.
- Ficha de personaje y HUD ES/EN, con indicadores de carga, fabricación a mano y
  supervivencia de RNV07b. Se reutilizan los controles y assets existentes;
  esta corrección no requiere crear o importar arte Unreal/FAB.

## Corrección concreta

La entrega de INV02d establece que los perfiles sin Carga adoptada conservan su
movimiento. Sin embargo, una mochila antigua con masa 24 y techo 18 obtenía tier 2:
40 % de velocidad y bloqueo de dash. La nueva regresión reprodujo el fallo antes
de cambiar código.

`packLoadTier` ahora exige el estado `attr` adoptado y válido para activar
penalizaciones. Los límites de capacidad siguen operando: conservar mercancías
antiguas no permite comprar o recoger por encima del techo. Movimiento no adopta
atributos, no gasta puntos y no modifica el perfil ni los recibos.

## Validación y publicación

Pruebas locales: **83/83** en 14 archivos, con [salida completa](inv02d-audit/local-tests.txt).
Incluyen el fallo legacy corregido, límites exactos de niveles 1/10, replay de
movimiento con cada tier, cambios de carga/puntos, agua, natación sin doble castigo
y denegaciones de recogida/compra con controles positivos al techo. Se conserva
la regresión de atributos, comercio, herramientas, agua, cantimplora y parada costera.
Los casos de replay usan `World` de predicción y snapshots reales, sin navegador
ni escritura SQL; los límites de nivel 10 se aíslan del volumen en el helper.

La evidencia pública y la revisión activa se incorporan tras el relevo seguro.
La lectura inicial del VPS confirmó `f26aae2`, alpha.52, sin jugadores, errores,
escrituras pendientes o fallos económicos; no acredita por sí sola todas las
interacciones de sobrepeso.

## Continuidad

No volver a implementar INV02d desde el checkpoint histórico de INV02c.
El dash que ya estaba en curso termina con la regla existente; este corte solo
conserva el bloqueo de nuevos dash, sin introducir otra decisión de balance.

Pendientes separados: comidas especiales SRV02 con operación durable y validación
SQL; mejoras de bolsas INV03 conservando volumen; claridad de la etiqueta antigua
«Fuerza» en el inventario (no representa los puntos invertidos de Carga).
Sensaciones y balance en un teléfono físico siguen requiriendo playtest.
