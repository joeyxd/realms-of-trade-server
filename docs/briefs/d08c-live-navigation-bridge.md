# D08c — del laboratorio a la balsa del jugador

2026-10-06. **Preparación y propuesta técnica, sin implementación ni activación.** El autor confirma
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

1. **Cuerpo naval en autoridad, pruebas aisladas.** Adaptar el plano a `buildNavalRig` y mantener
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

## Pruebas de paso

- Mismos comandos a distintos FPS producen mismos ticks/pose; giro cruza ±π sin salto.
- Solo el piloto autorizado mueve su nave; secuencias viejas/repetidas no vuelven a actuar.
- Cambio de puesto, blur, cierre y reciclaje no dejan órdenes activas ni ocupantes sin soporte.
- ACK/predicción con latencia y snapshots viejos mantienen nave/piloto/cubierta coherentes.
- Dos clientes observan el mismo barco; reiniciar conserva plano y bodega original intactos.
- Revisar escritorio/móvil emulado con casa construida; medir FPS y dispositivos físicos por separado.

## Persistencia y orden mayor

M5 D09f-2b.9 ya tiene arranque común dormant con 814/814 pertinentes aisladas. Sigue integrar host y
**todos** los hooks del gate, con scope/reloj/adopción explícitos, admisión/sim detenidas hasta ready
y cierre que espere startup. SQL007/008 ya tienen verificación real; no son el paso pendiente.
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
