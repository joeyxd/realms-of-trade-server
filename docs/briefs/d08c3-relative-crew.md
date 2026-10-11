# D08c.3 — caminar a bordo y pasajeros

2026-10-07. Continúa [D08c.2](d08c2-pilot-deck.md) en el mismo laboratorio local.
La partida ordinaria no activa viajes. Plano, bodega y HP guardados conservan su autoridad anterior.
El autor mantiene pendiente su playtest conjunto; cada corte conserva verificación automática y visual.

## Contrato

El puesto del propietario puede alternar entre timón y caminata. Soltar el timón cancela empuje pendiente;
caminar mantiene la nave por inercia con control neutral, sin empuje ni giro. Perder foco frena, y el
timeout del servidor también frena si deja de recibir control naval. Retomar el puesto requiere la sesión
propietaria y soporte válido; no se añade un módulo físico de timón ni un segundo capitán.

Un pasajero debe estar sobre la cubierta real, recibir invitación del propietario y aceptarla desde su
propia sesión. La invitación está ligada a entidades/sesiones y expira tras 600 ticks. El límite del
ensayo es cuatro personas por barco contando al propietario, dentro del máximo de cuatro clientes;
no es una fórmula de tripulación/materiales/navegación ni una medida de rendimiento.

Cada caminante mantiene posición, altura, orientación y velocidad en el marco local del barco. El tick
aplica un solo movimiento coalescido por persona, avanza la nave y transforma las posiciones a mundo.
La caminata reutiliza `stepMover` y `RaftDeck` sobre un marco virtual sin terreno: paredes, huecos,
escaleras y niveles conservan sus reglas. No añade dash, salto, combate, empujones, edición ni producción
a bordo. No hay detección de masa corporal/lastre humano, colisión entre personas ni desplazamiento por oleaje.

El ACK de caminata es separado del naval y del terrestre. Epochs cambian al volver a caminar o embarcar;
entradas viejas no reactivan registros. Los comandos son ejes locales del barco, no posiciones enviadas
por el cliente. Su flood se coalesce; sus límites y timeout viven en autoridad. Los paquetes se pueden
encolar mientras M5 retiene el tick, pero el estado y los ACK solo avanzan al admitirlo.

Salir del ensayo devuelve tripulación al muelle y restaura el amarre. El pasajero puede salir por separado.
Muerte, pérdida de soporte, cambio de fuente, desconexión o cierre invalidan el registro pertinente;
el rescate no revive ni cambia inventario. Un ocupante no registrado sigue invalidando la navegación,
con retorno seguro de este laboratorio. No es un sistema de abordaje/PvP ni la política pública de pérdidas.

## Cliente y vista

Protocolo 18: `DECK_INPUT`, estado privado `deck` y anclas públicas `crew`. La predicción reproduce el
mismo paso de caminata y reejecuta comandos no confirmados. Antes de aceptar un snapshot se validan
ambos streams privados, evitando confirmar uno cuando el otro es inválido.

El piloto y pasajeros remotos se sitúan mediante anclas locales interpoladas sobre la misma pose de
barco que usa el renderer. El caminante local combina su caminata predicha con esa pose; el dueño
conserva también la predicción del casco. Un pasajero no predice las órdenes navales de otra sesión.
La red real con latencia, teléfonos físicos y FPS mantienen aceptación aparte.

## Reutilización

Luna verificó `MM_Walk_InPlace.uasset` (716.238 B), `MM_Walk_Fwd.uasset` (549.134 B) y `MM_Run_Fwd.uasset`
(482.628 B) en `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Demo\UE5_Manny\Animations\Manny\`.
Son candidatos de cadencia/animación; no se verificó un retarget compatible y `.uasset` no carga en Three.
Este corte reutiliza el personaje procedural, rig, superficies, atlas/agua/espuma/audio existentes.
No necesita arte nuevo ni exportaciones; fuentes Unreal intactas. [Inventario previo](../research/unreal-assets/D08-REUSE.md).

Luna escribe locomoción local, predictor, tests independientes y UI en archivos disjuntos.
El principal conserva diseño, World/controlador, protocolo/cliente, revisión y aceptación.
Los cambios paralelos de arte y M5 quedan preservados; la verificación usa un checkout aislado del commit base.

## Siguiente

Conectar contacto costero y HP modular al tick, predicción y feedback de la navegación.
La barrera de esquinas continúa siendo discreta, no un barrido ni daño costero continuo.
La activación en partida y su cámara requieren integración explícita y puertas M5/D09 antes de riesgo
persistente. Viajes, encuentros, reparación/pérdidas, ancla/drift y remolino conservan sus propios cortes.
