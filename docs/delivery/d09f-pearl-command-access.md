# D09f-2b.11 — comandos inmediatos protegidos por la puerta común

2026-10-06. Base congelada `88f8cdddf530d8aa8a754c1d0569733dae9f83cd` más cinco fuentes propias.
[Contrato](../briefs/m5-pearl-command-access.md), [evidencia](d09f-pearl-command-access-evidence.json).

## Resultado

GameHost conecta un preflight síncrono opcional a playerCommand, devCommand y debugTeleport.
Se resuelve el cliente/entidad vigente, cuenta autenticada y todos los UIDs actuales del perfil/ledger
antes de ejecutar helpers. Pearl give también consulta el receptor por entidad y su sesión; campos
de identidad del payload o pirateId heredado no cambian esas cuentas. Invitados aportan sus UIDs;
esto no autoriza adopción ni una transacción durable hacia invitados.

Cofres/mint y operaciones que usan RNG o modifican mercados/decks/encuentros consultan de manera
conservadora todas las reservas de perlas del mundo. La comprobación bloquea handles held/fenced,
recovery/hydration, lanes UID/cuenta/operación/unresolved y sesiones pearlBusy/cerradas/fallidas.
Permite clientes, cuentas y tareas de autosave normales; no exige el mundo vacío que requiere startup.
Incluso talk/list/quote pueden tener efectos de progreso o caches, por lo que se comprueban antes
del helper. Clasificación exacta en el brief. No se espera RPC entre preflight y dispatch.

Busy envía directamente un EVENT privado commandDenied: no usa world.emit ni altera dirty/saveAt,
no transmite perfil/UID/recibo y no devuelve el acuse del helper. Rewards muestra un aviso en español
para volver a intentar; no hay cola/reintento automático. Los métodos directos también comprueban
contexto y flags dev/debug; tipos u operaciones pearl/dev desconocidos quedan sin efecto.
Un hook async se rechaza antes de la mutación. Retorno true significa dispatch, no éxito del helper
ni commit durable. Worker sin hook conserva su comportamiento. Pause, PING e INPUTS siguen entrando.

## Verificación

**809/809 checks pertinentes**, **23 nuevas**, 61 archivos; cero fallos, cancelaciones, skips o TODO.
Node v24.14.0, concurrency 2; 65319.1015 ms. Archivo Git fijo, overlay de cinco fuentes
runtime/test, junction de dependencias y sin .env. **182 hashes SHA-256 normalizados LF** comprobados
antes/después. Comando, archivos, hashes y SHA del log en el JSON; log ignorado:
`shots/review/m5-pearl-command-accept.log`. No es la suite completa del repo ni suma resultados históricos.

- Cuenta/UID del actor, UID presente solo en ledger, cuenta/UID de receptor, receptor guest/missing,
  identidad falsa y cliente stale. Un comando scoped disjunto sigue disponible mientras otro espera.
- Todas las colecciones de lanes, handles held/fenced y barrera recovery→hydration, incluso cuando
  la queue ya está admitting. Una tarea real de autosave no bloquea el preflight mundial.
- Controles positivos de helpers válidos: equipo, misión lista con recompensa/RNG, cofre real,
  mint/drop de desarrollo y list/quote de comercio/balsa. Bajo reserva quedan intactos perfiles,
  recompensas, contadores/drop IDs, ledger, RNG, eventos, caches y scheduling; tras liberar,
  un comando nuevo produce su efecto. Una misión completada no vuelve a dar su recompensa.
- Clasificación dev, entrypoints directos, flags, hook inválido/async/throw y debug teleport;
  movimiento recibido/PING/pause continúan. Esto no acepta todavía efectos de INPUTS durante tick.
- PearlStaging real manual con RPC de memoria pausada después de commit: comandos bloqueados
  antes de recibir el resultado y tras liberar queue hasta drain; no se reejecutan denegaciones.
  Drain libera el preflight y un tutorial nuevo se aplica. No acredita afinidad permanente.
- Feedback real GameClient→Rewards: aviso para el dueño, texto fijo sin datos de inventario/recibo.
  Capturas inspeccionadas con Chrome headless aislado, GPU deshabilitada: 1280×720 y 390×844.
  Fuentes reales de GameClient/Rewards/Hud.toast y CSS; shim de GSAP para layout estable y tipografía
  local. Es lectura/layout del aviso, no HUD completo, animaciones, GPU ni dispositivo físico.
  Capturas ignoradas: `shots/review/m5-command-toast-desktop.png`, `m5-command-toast-mobile.png`.

No se repitieron SQL, canarios Supabase ni procesos de recuperación durable: migraciones, adaptadores
y diario no cambian. No se consultaron .env, claves, perfiles live o red externa. El navegador MCP
estaba ocupado; las capturas usaron perfiles headless propios, sin tocar esa sesión.

## Reutilización y límites

Inventario Unreal/FAB consultado; BP_JigServerSave (580.554 B) y BP_InventoryComponent (24.878.603 B)
re-verificados de solo lectura. Referencias Blueprint sin autoridad Node/CAS portable: se reutilizan
gate, resolver de sesión, helpers y feedback. Ningún asset importado/modificado. Se preservaron cambios
paralelos navales/arte; no se incluyeron en el overlay ni en la aceptación de este corte.

**Preflight inmediato no es activación durable.** Los comandos disponibles conservan sus helpers
actuales; este parche no crea request/intent/reserva durable, snapshot canónico o apply de tick.
Siguen pendientes world.applyCommand/stepWorld/economy.onAdvance y los efectos autónomos
(pickup/return/death/rewards/producción), startup del host y finalizador durable. La muerte completa
todavía incluye equipo/oro/mundo fuera del lote pearl-only. Scope/reloj/adopción y leases siguen aparte.

Afinidad permanente por personaje y tipo —conservarla al perder la perla y recuperarla al obtener
de nuevo ese tipo, sin transferir progreso al receptor— sigue como corte posterior; tampoco se
implementan familias animales ni cuerpo elemental legendario. P4/P6 parciales. Sin SQL/env nueva,
cambios de perfil/PROTOCOL_VERSION 16, despliegue, push ni reinicio del servicio.
