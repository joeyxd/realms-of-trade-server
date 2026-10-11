# D09f-2b.12 — tick autoritativo espera las reservas de perlas

Aceptado localmente sobre `ac475641b2bfcebc38b77850c0c66686edcdc32a` con cuatro overlays propios.
[Contrato](../briefs/m5-pearl-tick-access.md), [evidencia exacta](d09f-pearl-tick-access-evidence.json).

## Comportamiento comprobado

GameHost conecta `tickAccess` a la puerta común y a las lanes trusted de perfiles/entidades actuales.
Mientras una cuenta/UID/cola/fence o barrera recovery/hydration conserva autoridad, LocalServer espera
antes de retirar inputs, aplicar fillers o ejecutar movimiento, combate, drops y economía del tick.
No consume daño, progreso, reloj, RNG, IDs, ganador de recogida, revisión ni save scheduling durante ese hold.
No crea operaciones durables ni activa automáticamente PearlStaging/PearlStartup.

El pump descarta deuda de simulación y conserva hitstop/slow-mo. Durante espera usa tiempo separado
para snapshots públicos a cadencia normal; el ACK se mantiene en el último input aplicado. PING/INPUTS
siguen disponibles. La cola mantiene su límite previo de 30 comandos y OR de presses en carry.
Al liberar, los helpers pendientes actúan con el estado vigente y el tiempo nuevo; no hay un tick por
cada intento bloqueado ni se reejecuta automáticamente un comando inmediato denegado.

La prueba de staging real confirma el hold antes de recibir la respuesta durable y después de que
storage libera su cola, hasta `drain()` manual. Después aplica la perla una vez y procesa el input retenido.
Hooks Promise/throw/configuración inválida fallan antes de mutación. Worker sin hook conserva el flujo anterior.

## Evidencia

- **822/822** pruebas pertinentes, 63 archivos, **13 casos nuevos**; cero fail/cancel/skip/todo.
  Node v24.14.0, concurrencia 2, **89.694,5516 ms**.
- Fuente fijada mediante Git archive de `ac47564`, cuatro overlays propios y junction de dependencias;
  ningún `.env`. **191 hashes SHA-256 con LF normalizado**, antes/después en la copia aislada;
  los cuatro overlays de trabajo también comprobados antes/después. **187 fuentes de base** excluyen
  las ediciones paralelas del checkout; no se afirma que dichas ediciones igualen la base.
- Casos reales: recogida de oro y retorno de perla vencida; red/parrilla liquida un único lote
  con sus inputs/outputs/revisiones; burn mortal espera antes de death, spill de perla, objeto y
  dos pociones; burn que mata NPC espera antes de XP, loot y roll de perla elite. Maestría de arma
  existente se conserva en muerte; esto no implementa ni acredita afinidad de perla.
- Cuenta, inventario/ledger-only UID, todas las lanes de queue, fence sticky, recuperación/hidratación,
  sesión cerrada/fallida/busy, entidad/perfil faltantes y autosave en vuelo. Backlog de 45 inputs
  queda en 30, preserva el press de poción recortado, reanuda cuatro comandos y consume una poción.
- Heartbeats de actor/espectador no publican perfil/recibo/UID ni vacían eventos; dirty/saveAt quedan
  pendientes y el evento legítimo se transmite una sola vez al reanudar. Sin deuda de reloj al liberar.
- Revisión Luna acotada de solo lectura y autoría inicial de tests; principal revisó fuentes/evidencia,
  corrigió expectativas de fixtures, añadió controles positivos y aceptó la regresión fijada.

Las pruebas dirigidas previas (13/13 nuevas y 55/55 rutas relacionadas) fueron comprobaciones de trabajo;
no se suman al total de aceptación. Los primeros fixtures del delegado fallaron y se corrigieron antes
de la aceptación. Log ignorado: `shots/review/m5-pearl-tick-accept.log`; hash/comando/rutas en el JSON.

## Límites y siguiente corte

El hold es global e incluye **movimiento autoritativo**. La predicción del cliente sigue como antes;
no se acepta una experiencia visual de espera ni rendimiento/feel/dispositivos. No hay cambio de UI,
arte, snapshot/you, EVENT o protocolo 16; no se repite navegador para este guard de servidor.

La captura/retención granular para mantener movimiento durante storage sigue pendiente. Inputs anteriores
pueden ejecutarse bajo el loadout nuevo tras apply; epoch/rebase necesita un contrato explícito. Comandos
inmediatos disjuntos mantienen sus guards anteriores; el hold no les aporta durabilidad ni cola automática.
`storage.tickBlocked` es la última preflight; durante pausa total puede quedar stale. No sustituye readiness.

El siguiente apply debe progresar **antes** del guard de sim y durante pausa/hold: situar drain detrás de
su propia reserva causaría espera permanente. Falta conectar startup/apply/snapshot canónico al host;
scope/reloj/adopción, efecto completo de muerte durable y finalizador de cierre siguen abiertos. Llamadas
directas a helpers/economy.advance fuera de entradas protegidas, admisión y lifecycle tienen contratos propios.
P4/P6 siguen parciales; afinidad permanente por personaje/tipo permanece pendiente.

No nueva SQL/env, lectura de credenciales, Supabase live, pruebas SQL/procesos durables adicionales,
restart del host activo, push o despliegue. La muerte existente espera antes de todos sus efectos, pero
la transacción pearl-only 007/008 no se amplía a equipo/oro/mundo en este corte.

## Reutilización y trabajo paralelo

Inventario Unreal/FAB cruzado; archivos BP_JigServerSave (580.554 B) y BP_InventoryComponent
(24.878.603 B) re-verificados de solo lectura. Blueprint de referencia sin lógica Node/CAS portable;
se reutilizan gate, resolución de lanes, tick y snapshots. Sin assets nuevos ni fuentes Unreal modificadas.

Solo host, LocalServer, dos tests y documentación M5 propios. `src/sim/world.js`, `src/sim/systems/rafts.js`,
renderer, materiales, naval y documentos de sus otros dueños permanecen fuera del parche y de los overlays
de aceptación. La lista de cambios tracked excluidos se captura en el JSON; esta entrega no acepta ese trabajo.
