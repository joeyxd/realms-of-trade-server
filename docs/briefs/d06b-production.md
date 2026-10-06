# D06b — primera producción de la balsa

Implementación local 2026-10-05, sobre D06a y el diario M5. Versión `0.6.0-alpha.4`, protocolo 16.
Aceptación y evidencia en [la entrega](../delivery/d06b-production.md).
M6 P4 sigue parcial: agua/huertos, hamaca, reaparición y faroles no entran en este corte.

## Decisión y contrato

- Cadena existente: red → pescado salado → parrilla → galleta de barco. Se conservan cifras y mercancías
  de `RAFT_PARTS`; receta y balance/crafting final siguen como prototipo.
- El editor ofrece nueve piezas, añadiendo red y parrilla. Red: cubierta en borde y nivel 0. Conserva costes,
  propiedad, soporte, seguridad de ocupantes, capacidad y preflight del guardado de D05.
- Solo las balsas primarias activas amarradas en Aldea producen mientras el dueño está conectado.
  Una llamada por paso económico de cinco segundos; día de juego = 960 segundos de simulación.
  Pausar solo detiene el mundo; desconectar no genera trabajo ni recuperación de tiempo offline.
- Red: un pescado por lote, seis lotes/día. Parrilla: dos pescados → dos galletas, seis lotes/día.
  Comienza cuando existen los ingredientes; no reserva ni consume al comenzar la fracción.
- Cada módulo guarda `grid.work[JSON.stringify([id,x,z,nivel,dirección])]`, una fracción entre 0 y 1.
  Saneado: claves de módulos existentes y números finitos válidos. Reordenar no mueve progreso;
  retirar borra la clave, volver a construir comienza desde cero. No se usan índices del array.
- Un lote comprueba ingredientes y peso de todos los resultados después de retirar insumos en un clon.
  Si falta material/espacio congela su fracción; tiempo detenido no se acumula. No destruye bienes ni
  guarda lotes completos invisibles. El tick candidato completo comprueba tamaño de save antes de mutar.
- Lotes confirmados aumentan `ship.rev` y `eco.tradeRev` una vez por tick y solicitan guardado inmediato.
  Fracciones marcan perfil sucio y usan el guardado ordinario. Revisión agotada/save demasiado grande detienen
  el trabajo de esa balsa con motivo privado; se vuelve a comprobar en el siguiente paso.
- Evento privado `raftProduction`: identidad/revisiones, filas, motivo, duración del día y unidades hechas/usadas.
  Consulta `commerce cargo` incluye ese estado. Snapshots públicos: plano/aspecto/pose, sin carga ni fracciones.
  Perfil completo confirma la UI.
- H/botón Bodega → Producción: receta, tasa, fracción y tiempo simulado restante o motivo de espera.
  No produce desde frames del cliente. G conserva perla; B/R los controles del editor.

## Assets y límites

Revisión previa con Luna: [D06B-REUSE](../research/unreal-assets/D06B-REUSE.md).
No apareció una red/parrilla portátil lista. Se reutilizan modelos procedurales y atlas cómic existente;
el banco Dreamrise no sustituye estas piezas. Sin nuevas texturas/exportaciones ni cambios en `C:\Unreal`.
Revisiones privadas de carga/trabajo reutilizan mallas GPU; solo plano/aspecto las reconstruyen.

El motor vivo es `stepRaftProduction`, separado del antiguo `stepRaft` de laboratorio, sin llamador en runtime.
Purificador, huertos, alambique, combustible y `acc` antiguo no se activan ni migran. Llamadas directas del nuevo
motor limitadas a un día, descartando exceso; pruebas adelantan en pasos de cinco segundos, como runtime,
manteniendo orden de trabajo. No es contrato de travesía.

Velocidad de bodega sigue teórica. Sin timón, viento propulsor, navegación libre, pérdida naval ni reserva
durable de puerto. Saves anónimos firmados: límite 32 KiB y replay histórico. No promete transacción durable
entre mundo y perfil ni custodia pública de carga.

## Equipo y aceptación

Luna: revisión acotada de assets, motor puro, UI y pruebas independientes de servidor.
Principal: decisiones, integración del reloj/persistencia/editor, revisión, navegador y aceptación.
Un escritor por archivo y una prueba GPU a la vez. Conservación, pausa/reentrada, rechazo del save,
privacidad, retirada/reordenación y revisión; controles reales PC/móvil emulado y capturas inspeccionadas.

Siguiente: cerrar la aceptación móvil D06b horizontal/vertical con capturas inspeccionadas.
Después [D08 manejo naval](d08-navigation-feel.md), bahía de ensayo y comparación de carga.
Revisar candidatos Unreal/FAB para ese corte. Fórmulas de tier/navegación, viento y balance siguen abiertas:
primero un prototipo medible. D09 precede riesgo persistente y publicación de bienes expuestos.
