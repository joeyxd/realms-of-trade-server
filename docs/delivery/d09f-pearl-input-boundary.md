# D09f-2b.15 — frontera de acciones recibidas al cambiar perla

Al aplicar swallow/reemplazo, los ataques y skills ya recibidos no pueden iniciar una acción con
la nueva perla. La cola conserva movimiento, orden y secuencias; el ACK avanza durante el tick
normal. Perfil/ledger/drop/ECS y transporte comparten apply reversible; un fallo local conserva
fence y restaura las escrituras propias, sin reintentar el commit durable.

## Implementación

- Adapter opcional `prepareInputs(clientId, entity)` en PearlStaging, resuelto después del recibo y
  antes de escribir. Give y default mantienen su conducta anterior.
- `LocalServer.preparePearlInputs` prepara/valida un efecto de transporte solo dentro de beforeTick.
  Limpia ATTACK/Q/E/R/G de held/press/carry/último comando; conserva aim, DASH/GUARD/INTERACT/POTION,
  `w`, seq/pt, cola y ACK/counters. Revalida identidad, referencias y valores antes/después.
- `atkBuf/rBuf/qBuf/eBuf/gBuf` se limpian en el mismo draft ECS de perla, con rollback. Cooldowns y
  recursos siguen las reglas compartidas; una nueva G respeta el cooldown normal del cambio.
- Métodos/getters del adapter se capturan dentro del guard de reentrada. Promise/retorno inválido,
  reentrada atrapada y fallos de apply/assert deniegan; un rollback defectuoso del adapter no impide
  revertir perfil/ECS/drop de staging. No hay rollback genérico de escrituras externas de callbacks.

## Aceptación local

**950/950** pertinentes, cero fallos/canceladas/skips/todo, Node v24.14.0/concurrencia 2, 111.824 ms.
73 archivos de pruebas y 219 fuentes/hash SHA256 normalizado LF verificados antes/después; cinco
overlays propios también verificados en el checkout. [JSON](d09f-pearl-input-boundary-evidence.json).
**33/33 checks nuevos en 14 pruebas superiores** dirigidas:
memoria y SDK/SQL006/008 local, recibo lento/pausa, movimiento/ACK/acción nueva, potion conservada,
reemplazo/progreso/drop/RNG, give/default, trim/late/filler, rollback y lifecycle/callback/getters.

Regresión desde archivo Git fijo `0379b2e` más cinco overlays propios. Retiene los 884 checks M5/net/
combate anteriores, añade los 33 propios y 33 de cinco archivos navales ya aceptados; arte paralelo
excluido. Dependencias por
junction, con Three.js copiado dentro del archivo aislado para respetar el allowlist del servidor
de ensayo naval. Ese allowlist correctamente rechazó el junction global en la primera ejecución;
se corrigió únicamente el aislamiento, sin editar fuentes navales ni debilitar su guard.

Revisión acotada GPT-6 Luna: encontró un getter fuera del guard; corregido y cubierto con un check
de reentrada atrapada. Segunda revisión de la validación: sin otro defecto material encontrado.
No cambio visible activo/payload nuevo; se comprobaron eventos privados/ECS/transporte con helpers
reales. No se repitieron navegador/GPU/dispositivo/reinicio real ni conexión Supabase.

## Alcance y siguiente parte

Es una frontera de **recepción**, no de extremo a extremo: un paquete antiguo recibido después
del apply se interpreta como input nuevo. Casts/proyectiles iniciados continúan; predicción del
cliente y epoch wire siguen pendientes. GameHost no monta staging/startup/diario automáticamente
ni despacha comandos durables; los fixtures configuran adapters explícitos.

Sin SQL/env nuevos, schema/protocolo nuevo (17 heredado de D08c.2), tasas de afinidad, balance,
publicación ni activación durable. Montaje/políticas de mundo/reloj/adopción, finalizador durable,
muerte completa, leases y afinidad permanente pendientes; P4/P6 siguen parciales.

Unreal/FAB: BP_ARPG_PlayerController (5.365.068 B) e IMC_Default (18.874 B) comprobados de solo
lectura. Grafos/configuración sin cola Node portable; reutilizados BTN/sanitizeCmd/cola/draft/rollback
del repo, sin arte nuevo ni cambios en fuentes Unreal.

[Brief](../briefs/m5-pearl-input-boundary.md), [mapa común](../briefs/m5-pearl-common-gate.md),
[captura canónica](../briefs/m5-pearl-profile-snapshot.md), [afinidad pendiente](../briefs/m48-pearl-affinity.md).
