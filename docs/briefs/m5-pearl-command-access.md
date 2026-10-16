# D09f-2b.11 — preflight de comandos inmediatos

## Objetivo y alcance

Conectar la puerta común al `MSG.CMD` real antes de ejecutar helpers que puedan modificar
inventario/progreso mientras SQL, diario o apply conservan una reserva de perla.
Este corte comprueba disponibilidad de manera síncrona; no crea intent, espera RPC, encola
reintentos ni convierte los comandos existentes en operaciones durables.

`LocalServer.commandAccess(id, entity, plan)` es un hook opcional que devuelve un boolean
síncrono. El plan congelado solo contiene `world` y `target`; su clasificación pertenece al
servidor. Un Promise accidental falla antes del helper. Worker sin hook conserva su flujo.
`playerCommand`, `devCommand` y `debugTeleport` comprueban el cliente vigente, entidad viva
y perfil antes de ejecutar. Dev/debug también respetan sus flags, incluso en llamadas directas.
Tipos desconocidos y operaciones pearl/dev desconocidas siguen sin efecto ni feedback de éxito.

## Cuentas, UIDs y recursos compartidos

GameHost resuelve la cuenta desde `ProfileSessions.clients`, nunca desde `msg.account`,
`msg.pirateId` o el perfil heredado. Reúne todos los UIDs en bolsa/tragada y en el ledger
asociado a la entidad. `pearl give` añade el cliente/sesión y los UIDs actuales del receptor
seleccionado por entidad, incluidos invitados; receptor inexistente impide el helper.

| Comandos | Disponibilidad necesaria |
|---|---|
| equip, unequip, salvage, sell, tut, tier, loadout, form, learn | Cuenta y UIDs actuales del actor |
| pearl give | Cuentas y UIDs actuales de actor y receptor |
| open, talk, quest, buy, market, commerce, raft | Actor y todas las reservas de perlas del mundo |
| pearl swallow, spit, leave, sell | Actor y todas las reservas de perlas del mundo |
| dev tune, spawn, clear, enc, clock, pearl, drop, item | Actor y todas las reservas de perlas del mundo |
| Otros dev conocidos y debug teleport | Cuenta y UIDs actuales del actor |

El preflight mundial es conservador: cofres/mint pueden crear UIDs aún desconocidos;
recompensas, retorno y objetos usan RNG compartido; mercados, balsa y encuentro alteran
estado compartido. Incluso list/quote/cargo pueden actualizar caches; talk puede completar
misiones. No se invoca un helper para descubrir si tiene efectos.

`assertWorldAvailable()` requiere queue disponible y rechaza barrera recovery/hydration,
reservas retenidas/fenced, lanes UID/cuenta/operación y unresolved, además de sesiones pearlBusy,
cerradas o fallidas. Permite cuentas, clientes y tareas de autosave ordinarias; no reutiliza la
condición de cero sesiones que necesita startup. El dispatch es síncrono, sin hueco de await;
este guard no promete serialización durable de RNG/mercado/deck ni reemplaza su futuro plan/apply.

Si el hook deniega, LocalServer envía directamente un `MSG.EVENT` privado `commandDenied`.
No usa `world.emit`, no toca dirty/saveAt, no transmite inventario/UID/recibo y no envía el
acuse de éxito del helper. Rewards muestra «Acción no disponible. Espera un momento y vuelve
a intentarlo». Pause, PING e INPUTS conservan su entrada actual; los efectos producidos por
INPUTS o por ticks todavía necesitan sus propios hooks.

## Aceptación requerida y pendientes

Probar helpers reales y puntos anteriores al primer cambio/RNG/event/cache, cuentas/UIDs
de actor/receptor, invitado, identidad falsa y contexto stale, recursos mundiales, fences y
recovery/hydration. Cubrir un staging real manual con respuesta de commit pausada y la
espera entre queue libre y drain. Comprobar feedback por GameClient/Rewards y lectura del aviso.
Regresión pertinente aislada con hashes; no sumar resultados históricos como pruebas nuevas.

No activa comandos durables, startup, `staging.drain()` automático, muerte completa,
efectos autónomos ni finalizador durable. Scope/reloj/adopción y afinidad permanente por
personaje/tipo siguen pendientes. Perfil y PROTOCOL_VERSION 16 conservados; solo se añade
un tipo de feedback al sobre extensible EVENT. Sin SQL/env nueva, consulta Supabase o despliegue.

## Reutilización

Inventario Unreal/FAB consultado y candidatos BP_JigServerSave (580.554 B) y
BP_InventoryComponent (24.878.603 B) re-verificados de solo lectura. Sirven como referencia
Blueprint; no aportan autoridad Node/CAS portable. Se reutilizan gate, resolución de sesiones,
helpers de comandos y feedback existentes. No se importa ni modifica ningún asset Unreal.

[Puerta común y rutas pendientes](m5-pearl-common-gate.md),
[salida/cierre ya conectado](m5-pearl-profile-io.md).
