# D08c.11 · Recuperación de balsa guardada

Aceptación local del 8 de octubre de 2026 con el juego en `alpha.11`, protocolo 26. El recorrido usa un `GameHost` aislado en memoria, tres reinicios reales del host por viewport, la misma semilla, secreto HMAC y puerto, y el mismo almacenamiento de navegador. No usa `.env`, SQL ni servicios externos.

El fixture confiable añade daño `p1` de `30/60`, madera en bodega y mochila, y una pose segura alejada. `LocalServer.sendSave` entrega el blob firmado por el WebSocket real; el harness comprueba la firma con el verificador del servidor y reconecta el navegador usando ese blob. El daño y la pose son datos de fixture: esta evidencia no afirma que ocurrieran por un impacto real.

En las tres vistas, la reconexión conservó el mismo ID de barco, plano, ID de pieza, HP y carga; el jugador apareció en su checkpoint habitual, sin timón, cuerpo naval ni tripulación. El estado mostró la balsa recuperable, sin opción de reembarque cuando `landing` era nulo. En táctil se inspeccionó la captura: el objetivo “BALSA RECUPERABLE · Posición guardada · Puerto” queda visible y se ocultan brújula y viento. Llevar al jugador al radio real del muelle permitió hacer clic o tap en “Recuperar en puerto”; el servidor devolvió la misma balsa dañada al amarre. Después, el editor reparó `p1` una vez por dos maderas, preservó el plano y la mochila, y una nueva recarga de un `SAVE` firmado encontró la balsa amarrada con `60/60` HP y sin viaje pendiente.

## Resultado y capturas

`node tools/qa-raft-recovery.mjs` pasó en escritorio `1280×720`, móvil apaisado `844×390` y retrato `390×844`. No hubo errores de página, consola, solicitudes ni HTTP. La evidencia completa de datos, acciones, ACK de reparación y solicitudes está en [el JSON del pase final](raft-recovery-evidence-2026-10-08T06-45-02-474Z.json).

| Vista | Recuperación visible | Muelle | Recarga reparada |
|---|---|---|---|
| Escritorio | [captura](raft-recovery-desktop-1280x720-2026-10-08T06-45-02-474Z-00-signed-recovery-away.png) | [captura](raft-recovery-desktop-1280x720-2026-10-08T06-45-02-474Z-01-recovered-at-port.png) | [captura](raft-recovery-desktop-1280x720-2026-10-08T06-45-02-474Z-06-fresh-reload-repaired-docked.png) |
| Móvil apaisado | [captura](raft-recovery-mobile-844x390-2026-10-08T06-45-02-474Z-00-signed-recovery-away.png) | [captura](raft-recovery-mobile-844x390-2026-10-08T06-45-02-474Z-01-recovered-at-port.png) | [captura](raft-recovery-mobile-844x390-2026-10-08T06-45-02-474Z-06-fresh-reload-repaired-docked.png) |
| Retrato | [captura](raft-recovery-portrait-390x844-2026-10-08T06-45-02-474Z-00-signed-recovery-away.png) | [captura](raft-recovery-portrait-390x844-2026-10-08T06-45-02-474Z-01-recovered-at-port.png) | [captura](raft-recovery-portrait-390x844-2026-10-08T06-45-02-474Z-06-fresh-reload-repaired-docked.png) |

El primer pase fallido y sus capturas se conservaron junto con los pases corregidos; los nombres incluyen la hora de ejecución para evitar sobrescribir evidencia. No se midió rendimiento en dispositivo físico y esto no representa publicación ni aceptación de balance.
