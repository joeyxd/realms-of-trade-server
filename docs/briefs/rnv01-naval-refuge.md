# RNV01 — Primer refugio naval construible

Siguiente entrega de [AREA07](area07-naval-action-plan.md), después de PRG02b. Aprobada por el autor al
continuar la secuencia barco hogar. El farol y la noche oscura son el corte siguiente, con fuentes utilizables
antes de reducir la luz ambiente. No se añaden pérdidas, cerraduras ni recetas regionales en este corte.

## Resultado jugable

El editor B ofrece puerta y techo junto a paredes/pilares/pisos existentes. Techo de lona inclinado sobre
marco de madera: requiere pared/pilar en la misma casilla o un vecino de techo directamente soportado para
una casilla de voladizo. Retirar soporte sigue pasando la validación estructural. No es otro piso caminable.
Al estar bajo techo se oculta su lote visual para ver al personaje; salir restaura la cubierta.

Puerta: hoja abatible 90° y marco fijo; cerrada bloquea, abierta conserva jambas y la hoja lateral como
obstáculos reales. Cualquier personaje vivo cercano, dueño o visitante, puede abrirla desde ambos lados.
Son puertas **sin cerradura**: no conceden privacidad, permisos ni protección contra robo. V/botón contextual
opera la puerta; F/G/E y las acciones navales existentes se conservan. La UI nueva está en ES/EN.

## Autoridad y conservación

- `raftDoor` envía ID de nave, ID estable de pieza, revisión del plano, estado esperado y estado deseado,
  además de `opId`. Nunca envía pose, perfil, materiales o HP. Repetir la misma intención no alterna la puerta.
- Guardar `ship.openDoors` opcional con IDs de instancias vivas. Legacy cerrado y forma anterior intacta
  cuando no hay puertas abiertas. Retirar/reponer no hereda apertura; daño/destrucción retira estado inválido.
- Usar la misma autoridad `GameHost`/perfil CAS M5. Una acción de visitante valida las reservas de ambos
  personajes y guarda el perfil del dueño. No hay tablas, recibos durables ni writer nuevos.
- Apertura no cambia revisión del plano ni rig: no invalida cubierta móvil. Snapshot público contiene solo
  tuples de puertas abiertas; colisión terrestre, navegación de cubierta y replay cliente usan ese estado.
- No admitir un nuevo blocker sobre un cuerpo/aterrizaje reservado. El interior cerrado conserva salida
  interactuable; la comprobación de construcción puede recorrer puertas desbloqueadas.
- Feedback de acción no equivale a commit durable. Se fuerza el save por la ruta existente; una caída antes
  de confirmarlo puede perder el último cambio, igual que otras mutaciones ordinarias de perfil.

## Reutilización de arte

El inventario Unreal/FAB ya revisado identifica `Dreamrise_SMSK/Assets/Meshes/SM_SmallWoodeHut.uasset`:
prefab terrestre, sin mesh exportado/verificado ni modularidad naval. Las puertas de Gallery/Niagara y
LevelPrototyping son demo/template sin encaje confirmado. Se reutilizan atlas, materiales y geometría
procedural actuales; ninguna fuente Unreal se modifica, ninguna textura o dependencia nueva. Puerta cambia
geometría solo al cambiar su estado; techo usa lotes separados para ocultación sin mutar materiales compartidos.

## Aceptación

Construir habitación con materiales reales; rechazo de techo flotante/retirada de soporte, puerta abierta
transitable y cerrada bloqueante en varias orientaciones/niveles, visitantes y cuerpos protegidos, daño y
reparación existentes, guardado/reentrada del dueño, cubierta/predicción sin expulsión, reintento sin toggle,
PC/táctil/vertical con capturas inspeccionadas. Verificar nuevo protocolo y regresión M5/naval/recursos antes
de enviar. Publicación Git y revisión realmente activa del VPS se registran aparte en la entrega.

No acredita lluvia, temperatura, descanso, luz, natación, FPS físico ni prueba multijugador humana.
