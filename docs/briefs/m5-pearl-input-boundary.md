# D09f-2b.15 — acciones recibidas antes del cambio de perla

La espera de SQL conserva comandos y `carry`. Al aplicar swallow/reemplazo, un ataque/Q/E/R/G
recibido con el poder anterior no debe iniciar una acción con el nuevo. El movimiento conserva su
orden y el ACK avanza únicamente por el dequeue habitual. Este corte define una frontera de recepción
del servidor; no añade un epoch al protocolo ni identifica paquetes todavía en tránsito.

## Contrato

`PearlStaging(..., { prepareInputs: (clientId, entity) => server.preparePearlInputs(clientId, entity) })`
es opcional, trusted y síncrono. Solo se invoca para swallow/reemplazo confirmado, durante `drain`;
give mueve una perla en bag sin cambiar poder activo y no necesita limpiar acciones. Sin adapter se
conserva el comportamiento anterior. El host todavía no construye/configura staging automáticamente.

`LocalServer.preparePearlInputs` prepara un efecto separado de solo lectura dentro de `beforeTick`.
Comprueba cliente/entidad/perfil/ECS actuales y conserva referencias/valores de cola, carry, último
comando y contadores. Su `apply` también exige esa fase; no se puede invocar desde un mensaje del
cliente, un tick en ejecución o fuera de la frontera síncrona.

- Quita `ATTACK|Q|E|R|G` de held/press en comandos ya recibidos, carry y último comando. Conserva
  movimiento, aim, DASH/GUARD/INTERACT/POTION, petición de arma `w`, seq/pt, orden y número de comandos.
  No avanza ACK, cambia lastPt/fillPt/starve ni incrementa trim/late/filler.
- Limpia `atkBuf/rBuf/qBuf/eBuf/gBuf` dentro del mismo draft ECS del efecto de perla, con rollback
  exacto. No cambia cooldowns, recursos, stats ni la regla existente de cooldown al cambiar perla.
- Prepara/valida antes de escribir; aplica junto a perfil/ledger/ECS/drop, antes de encolar saves y
  liberar la reserva. Verifica el resultado antes de publicar. Si falla, restaura sus referencias
  de transporte y las escrituras propias de staging; conserva fence y no revierte/reenvía SQL.
- Métodos del efecto, incluidos getters/proxies, se resuelven dentro del guard de reentrada y se
  capturan una vez. Promise/thenable, retorno inesperado o reentrada atrapada deniegan el apply.
  Un rollback defectuoso del adapter no impide revertir el perfil/ECS/drop propios de staging.
- Invalidación sticky, close y reciclaje siguen denegando antes de preparar. Otros jugadores
  conservan sus inputs. Apply durante pausa no consume movimiento ni publica éxito anticipado.

Los adapters son código del dueño, no permisos ni datos del cliente. Deben preparar sin escrituras
y devolver métodos síncronos `assertCurrent/apply/assertApplied/rollback` con retorno `undefined`.
No existe rollback genérico de escrituras externas hechas por un callback que incumple el contrato.

## Límites y siguiente integración

Un paquete viejo recibido después del apply es indistinguible de uno nuevo y usa la autoridad
vigente. Tampoco se cancela un cast/proyectil ya iniciado, se rebasa la predicción del cliente ni
se envía un ACK especial. La época de inputs de extremo a extremo sigue pendiente antes de aceptar
esa garantía; esta frontera cubre únicamente acciones ya almacenadas en el servidor.

No cambia SQL/env, esquema/perfil/payload/protocolo (17 heredado de D08c.2), afinidad, balance ni
activación durable automática. Siguen montaje del host/startup, scope/namespace/reloj/adopción,
finalizador durable, muerte completa y afinidad permanente. No aceptar P4/P6 como completos.

## Reutilización y aceptación

Inventario Unreal/FAB cruzado antes de implementar: `BP_ARPG_PlayerController.uasset` (5.365.068 B)
y `Inputs/IMC_Default.uasset` (18.874 B), comprobados de solo lectura en ActionRPGMultiplayerStart.
Son grafos/configuración de Unreal, sin transporte/cola Node portable. Se reutilizan los bits BTN,
sanitizeCmd, cola/ACK, draft ECS y rollback existentes; sin nuevos assets ni cambios a Unreal.

Probar memoria y SDK/SQL006/008 local, recibo lento, pausa/apply, movimiento/ACK/acción nueva, potion
conservada, trim/late/filler, give/default, rollback y callbacks inválidos/reentrantes/getters,
lifecycle/identidad y progreso/reemplazo conservados. Regresión aislada de M5/combate/net y pilotaje
ya aceptado en `0379b2e`; excluir arte paralelo. No cambio visible activo que requiera nuevas capturas.

[Mapa común](m5-pearl-common-gate.md), [frontera de tick](m5-pearl-tick-apply.md),
[captura canónica](m5-pearl-profile-snapshot.md), [resultado](../delivery/d09f-pearl-input-boundary.md).
