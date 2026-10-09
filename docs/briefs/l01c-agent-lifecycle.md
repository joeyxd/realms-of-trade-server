# L01c — vida y reentrada del agente

2026-10-08. Continuación autorizada tras L01b. Raíz integra; Luna revisa contrato y
prueba el ciclo. Se conserva el trabajo concurrente del checkout.

El runner cancela trabajo sin enviar y conserva incertidumbre de cuerpo/chat enviados
al morir, detenerse o perder conexión. Limpia sus buffers, intenta neutral en un socket
vivo y lo cierra. Una instancia cerrada permanece terminal.

Un coordinador local permite reentrada explícita del dueño dentro de la misma caducidad
y capacidades: nueva conexión, sessionId, revisión y referencias de vida. Espera WELCOME
y snapshot propio válido; no hereda entradas, destinatarios, observación ni tareas.
Los IDs de acciones anteriores quedan reservados, incluso si se reescribe su scope.
Archivos de personalidad/objetivos se pueden volver a leer; conservar un objetivo no
reanuda órdenes. Un archivo de sesión acotado conserva resultados e incertidumbre.

CLI optativo `--stay-open` permite inspección/reentrada; el modo habitual conserva salida
al detenerse. Sin reconexión automática, renovación de permiso, cuenta persistente,
proveedor, inferencia, gasto, cambios SQL/protocolo/host/UI o simulación.

Reutilización: GameClient/WsTransport, C01 y controlador L00/L01 existentes. Revisados
los candidatos concretos del [inventario Unreal/FAB](../research/unreal-assets/CANDIDATES.csv):
`SaveSystem/BP_JigServerSave.uasset` es Blueprint de otro runtime, e
`Widgets/Images/ItemImages/T_HPBottle.uasset` es arte de inventario; ninguno resuelve
el ciclo de conexión Node. Descartados para este corte; fuentes intactas, sin arte nuevo.

Aceptación: muerte por evento/snapshot, corte/stop con acciones enviadas/sin enviar,
neutral fallido, callbacks/respuestas tardías, IDs/targets reutilizados, admisión fallida,
archivo/caducidad acotados y CLI. Reentrada por WebSocket real en plaza normal; sin prueba
de propiedad de cuenta ni revocación de cola del servidor (L02c). No hay cambio visual.
