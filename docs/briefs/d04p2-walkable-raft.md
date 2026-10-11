# D04 P2 — caminar del muelle a la cubierta

Estado: **implementado y aceptado localmente en software, 2026-10-05**.
[Resultado, pruebas y límites](../delivery/d04p2-raft-walk.md). Este brief conserva el alcance de la misión;
no acredita publicación, teléfono físico ni navegación. Referencias: [PLAN M6](../../PLAN-M6.md),
[entrega P1 y preparación técnica](../delivery/d04p1-raft.md). Confirmar HEAD/dueños al retomar;
la continuación es D05, sin repetir P2 ni pisar trabajo M5 concurrente.

## Objetivo

Permitir que un jugador recorra a pie el tramo playa/isla → muelle → balsa amarrada y camine por su cubierta.
Pisos elevados se alcanzan por las escaleras del plano de prueba. El servidor y la predicción local deben acordar
suelo, nivel y bloqueos; el recorrido no cambia la pose ni zarpa la balsa.

## Contrato de movimiento

- Antes de editar, inspeccionar `World.applyCommand → stepMover → moveWithCollision`, `walkStep`/`canStand`,
  `map.groundAt`, `onDock`, los colliders estáticos y el orden de snapshots/replay en la base actual.
- Elegir la intervención más pequeña que alimente el recorrido existente con superficies y bloqueos deterministas
  de la balsa pública. La misma consulta debe servir a autoridad y predicción y estar disponible antes de simular
  o reproducir comandos; no crear una segunda simulación de movimiento.
- El nivel transitable debe derivarse de la posición/colisión y transiciones válidas del plano. Definir y probar
  cómo se entra desde el muelle, cómo las escaleras conectan niveles y cómo puertas, barandillas y paredes bloquean
  el paso. No escoger simplemente el piso más alto ni inferir un nivel por un hash estático sin verificarlo.
- Cubierta/pisos transitables aportan suelo; los huecos y el agua no. Paredes, puertas cerradas, bordes y
  barandillas bloquean conforme al plano. Dash y colisión usan la misma regla: no permiten atravesar paredes,
  salir por huecos ni aterrizar sobre una superficie no conectada.
- Mantener el cálculo geométrico compartido y agregado por plano; no añadir física independiente por tablón,
  integración por pieza cada frame ni estado de navegación a 60 Hz.
- Reusar el snapshot `rafts` de P1 si basta. No replicar bodega, perfil ni identidad de cuenta. Cambiar protocolo,
  persistencia o pose solo si la inspección demuestra que son imprescindibles; explicar el contrato y la migración
  antes de ampliar esos datos.

## Fixture y aceptación

Usar como fixture la starter amarrada de P1, con las piezas de cubierta y una escalera que necesite el recorrido.
Puede prepararse desde datos de prueba/fixture; no exponer todavía un editor ni presentar piezas adicionales como
construibles por el jugador. No añadir cifras de balance ni ampliar dimensiones o límites del plano.

- Pruebas deterministas comprueban suelo continuo desde el lado de isla/muelle a cubierta, permanencia de pie en
  la cubierta, transición por escalera al piso superior y regreso. Casos separados verifican pared, puerta,
  barandilla, hueco/agua y borde sin salida inválida.
- Probar marcha y dash contra cada borde/bloqueo: no atravesar colisionadores, no cruzar huecos y no quedar
  suspendido sobre agua. Repetir consultas con el mismo plano/posición produce el mismo suelo y bloqueo.
- En una sesión cliente-servidor, recorrido de autoridad y predicción coinciden al entrar, subir, bajar y chocar;
  snapshot tardío/replay no cambia de piso, no teletransporta ni deja colisión obsoleta.
- Un recorrido de UI en cámara demuestra muelle → cubierta → escalera → cubierta y vuelta, con
  teclado y móvil emulado. Revisar visualmente pies/suelo, paredes y barandillas; reportar por separado errores
  de página/juego y limitaciones de dispositivo. Emulación no acredita FPS ni teléfono físico.
- Mantener la caja FAB, el fallback procedural y el atlas de P1. Escritorio conserva WebP 1024; móvil carga solo
  su variante WebP 512. No importar nuevos assets ni subir resolución para resolver una colisión. Verificar que el
  renderer actual sigue mostrando el mismo plano y que el fallo de asset no elimina el recorrido.

## Fuera de P2

No implementar el editor D05 (fantasma, rotación, colocar/quitar), bodega/UI/producción/comercio D06, viaje
abstracto, navegación en tiempo real, viento, combate, abordaje, daño/pérdida/recuperación ni cambios de balance
naval. La dirección sobre carga, peso, materiales, distribución y navegación queda intacta, pero sus fórmulas y
controles no se fijan en este brief. M5 continúa con su dueño y conserva la puerta de bienes persistentes en riesgo.

P2 aceptado: base, geometría compartida, pruebas y recorrido visual registrados en el informe enlazado.
Siguiente corte: D05. La revisión humana de sensación y rendimiento en dispositivo físico sigue pendiente.
