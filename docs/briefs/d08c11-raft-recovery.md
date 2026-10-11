# D08c.11 — condición guardada y recuperación del barco

Fecha: 2026-10-08. Continúa [D08c.10](../delivery/d08c10-raft-repair.md).

Objetivo: cerrar el reinicio que sanaba gratis la balsa y descartaba la posición del viaje.
Conservar el barco-hogar, su plano, carga, módulos destruidos y coste de reparación entre sesiones.
Al volver, recuperar el mismo barco de forma explícita, sin restaurar controles ni participantes.

Contrato de perfil, conservando versión de perfil 1 y migración legacy:

- `ship.condition`: `null` legacy o `{v:1,next,entries:[[id,tipo,x,z,nivel,dir,hp],…]}`.
  Cada entrada se vincula a una tupla del plano. HP máximo deriva del catálogo; 0 es una pieza destruida.
  IDs nuevos `pN`, contador monotónico, sin entidad ECS/cuenta/token. Refuerzo conserva ID y fracción HP.
  Un registro presente incompleto/inválido conserva las entradas válidas; faltantes pasan a HP 0,
  reparables en su casilla original, sin regalar materiales ni sanar silenciosamente.
- `ship.voyage`: `null` amarrada o `{v:1,seed,pose:[x,z,yaw]}` del último tick confirmado.
  No guarda velocidad, entradas, boosts, enfriamientos, ACK, épocas, pasajeros o invitaciones.
  Mismo mapa/seed, coordenadas finitas, plano dentro del límite y casco fuera de costa/muelle;
  pose incompatible o pérdida de flotación se recupera en el amarre derivado, conservando daño/bienes.
- Solo perfiles confiados por el servidor: blob firmado o perfil de cuenta, con los límites/CAS existentes.
  No nuevo comando que acepte HP/pose. Guardado periódico conserva su ventana actual; no es un
  registro transaccional de combate ni impide replay de blobs guest antiguos entre procesos.

Reentrada: balsa estacionada y sin tripulación en la pose válida. Personaje en checkpoint habitual;
snapshot privado `voyage.active=true`, `phase=shore`, `recovery=true`, landing seguro o null.
Puede reembarcar cerca de una costa válida, o recuperar desde el muelle con la acción existente.
Recuperar/atracar mueve la misma entidad al amarre y limpia voyage; no sana, duplica ni pierde carga.
Desconectar/cerrar captura condición/pose antes de quitar controles y nave. Una reserva M5 o CAS
fallido conserva sus barreras; no se cambia el ciclo del host ni se publica estado durable por adelantado.

Reutilización Unreal/FAB: ninguna geometría/textura/audio nuevos necesarios. El inventario ActionRPG
`SaveSystem/BP_JigServerSave` es referencia arquitectónica sin portabilidad directa a los perfiles
firmados/CAS JS actuales; no ahorra implementación verificable. Se reutiliza recuperación de puerto,
HUD y editor. Fuentes `C:\Unreal` intactas; sin exportaciones ni auditoría de licencias.

Root: esquema, sim/autoridad, integración y aceptación. GPT-6 Luna: auditorías de guardado/naval,
pruebas independientes, texto de UI y único runner de navegador. Un escritor por archivo.
Validar reparación/refit/IDs, save/reinicio/reentrada, pose insegura/seed cambiado, ausencia de controles,
recuperación/reembarque, no duplicación, coste real y UI escritorio/móvil/vertical emulado.
No SQL nueva/aplicación, env, commit/push/publicación o balance/FPS físico en este corte.
