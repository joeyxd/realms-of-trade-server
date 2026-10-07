# D08c — del laboratorio a la balsa del jugador

2026-10-06. **Puente de autoridad en desarrollo, sin activación pública.** La base previa
[D08c.0 de daño modular/contacto](d08c0-modular-damage.md) está implementada en la bahía aislada;
no equivale a conectar el World. El autor confirma
que el manejo se siente bien y acepta el HUD B4a. Ahora pide seguir y conocer lo pendiente. Este puente
conserva D08/D10; no fija topología del mar, pérdidas, XP, progresión ni controles finales de abordaje.

## Brecha comprobada

`src/sim/naval/handling.js` ya calcula rig y dinámica determinista, pero su contrato es de bahía aislada:
no adjunta barcos al World ni toca perfiles/bienes. `src/sim/systems/rafts.js` crea la balsa del plano
guardado como vehículo ECS, deriva su amarre y publica pose/plano; no integra `stepNaval` ni piloto.
`w.raftDeck` y la predicción ya comparten superficies amarradas. `src/net/protocol.js` conserva
SHIP_INPUT/SHIP_STATE como reservados sin gameplay. Tener mensajes reservados no habilita pilotaje.

El siguiente salto jugable es mover una balsa construida con la misma autoridad que usa el juego,
conservar al personaje a bordo y ver a otro cliente observar el movimiento correcto.

## Cortes propuestos

0. **Base modular implementada en aislamiento.** `structure.js` conserva plano/IDs/HP; `operational.js`
   deriva el cuerpo de piezas vivas y rebasa el centro de masa; `contact.js` resuelve costa y genera daño
   localizado. La bahía consume estos módulos. En autoridad, asignar IDs de instancia desde el servidor
   sobre un plano validado; no persistir los IDs de fixture `lab:*` ni reconstruir identidad desde índices.
1. **Cuerpo naval en autoridad, ensayo interno implementado.** [D08c.1](d08c1-naval-authority.md)
   conecta una copia transitoria del plano a `World.stepWorld()` con handles de control y daño en tick.
   La opción es server-only y apagada por defecto; el barco ECS/deck públicos permanecen amarrados hasta
   poder mover piloto y cubierta juntos. La copia no crea inventario ni expone bienes.
   Adaptar el plano a `buildNavalRig` y mantener
   estado transitorio por balsa; avanzar `stepNaval` desde el tick del World. Resolver piloto/propiedad
   desde la sesión del servidor. Entorno constante y lastre de prueba; no escribir pose marítima en el
   perfil. Validar entradas, neutralizar al perder control y limpiar al destruir/desconectar.
   Todavía sin activar órdenes navales públicas ni modificar el cliente.
2. **Puesto de mando, cliente y cuerpo del piloto.** Entrada/salida explícita, ejes/ACK de nave,
   predicción/reconciliación compartidas y cámara naval. El piloto necesita posición relativa válida
   a la cubierta; no habilitar barco móvil con personaje inmóvil en coordenadas del mundo.
   Revisar protocolo al añadir campos. Primera activación en prueba delimitada sin bienes en riesgo.
3. **Cubierta móvil y pasajeros.** Mover superficies/bloqueos con la pose autoritativa, caminar/subir
   sin resbalar artificialmente y separar balanceo visual de colisión. Interpolar barcos remotos;
   salida/reentrada/cambio de entidad conservan seguridad. Revisar bajo movimiento el patrón de
   `detachRafts`, que devuelve al muelle a ocupantes cuando desaparece su soporte.

Revisar cada corte antes de activar el conjunto. El ensayo puede usar copia del plano construido,
sin trasladar bodega real ni conceder otro barco. Editor/producción en movimiento requieren contrato
explícito; conectar pose no los habilita automáticamente.
El autor pide completar estructura/features antes de su playtest conjunto (2026-10-06). Las comprobaciones
automáticas y revisiones de integración continúan; su aceptación de manejo/balance/dispositivos queda abierta.

## Pruebas de paso

- Mismos comandos a distintos FPS producen mismos ticks/pose; giro cruza ±π sin salto.
- Solo el piloto autorizado mueve su nave; secuencias viejas/repetidas no vuelven a actuar.
- Cambio de puesto, blur, cierre y reciclaje no dejan órdenes activas ni ocupantes sin soporte.
- ACK/predicción con latencia y snapshots viejos mantienen nave/piloto/cubierta coherentes.
- Dos clientes observan el mismo barco; reiniciar conserva plano y bodega original intactos.
- Revisar escritorio/móvil emulado con casa construida; medir FPS y dispositivos físicos por separado.

## Persistencia y orden mayor

M5 conserva su propia cola de guards y efectos/startup del host; seguir su checkpoint actual en
`PLAN-M5.md`. El arranque durable requiere scope/reloj/adopción explícitos, admisión/sim detenidas hasta
ready y cierre que espere startup. SQL007/008 ya tienen verificación real; no son el paso pendiente.
Muerte completa (equipo/oro/mundo), afinidad y leases permanecen abiertos.

La navegación efímera puede evaluarse sin custodia nueva. Jettison de mercancías, pérdidas, botín,
reparación/recuperación y comercio durante el viaje requieren sus operaciones durables D09.
Después del puente viene D10: primer viaje, dos rutas y NPC vencible. Drift/ancla y remolino son
prototipos posteriores de maniobra; no están implementados. PvP/rendición/notoriedad sigue D11.
Q1 de luz/reflejos es ensayo visual paralelo opcional, no requisito de navegación.

## FAB y reparto

El inventario D08 no identificó un sistema de barco/control listo y portable por nombre/ruta. Sus
Blueprints/agua Unreal no aportan autoridad Node ni reconciliación del juego. Reutilizar rig/dinámica,
RaftDeck, renderer/atlas/crate y netcode existentes; no exportar arte para este trabajo de autoridad.
[Reutilización D08](../research/unreal-assets/D08-REUSE.md). Fuentes Unreal intactas.

Luna realizó el barrido de dependencias/contratos de solo lectura. El principal conserva diseño,
World/LocalServer/protocolo/cliente, integración y aceptación. Al ejecutar, delegar cálculo/adaptadores
y pruebas acotadas en archivos disjuntos; no disputar entrypoints ni tocar arena/puerto concurrentes.
M5 conserva prioridad técnica. D06b móvil necesita su recorrido de producción; HUD móvil no lo sustituye.
