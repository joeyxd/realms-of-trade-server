# D09f-2b.17 — recuperación de perlas antes de abrir el host

2026-10-07. Continúa [el montaje del staging](m5-pearl-host-mount.md) y reutiliza
[PearlStartup](m5-pearl-startup.md). Corte de API trusted; `npm start` no lo activa.

## Contrato

GameHost recibe `pearlJournal` desde construcción de ProfileSessions: no sustituye sesiones/cola,
no fabrica un diario ni infiere scope. Exige verificador, bots cero, WorldState con ID que coincida
con journal y staging. `mountPearlStartup({accountPolicy:'accounts-only',mapClock,pageSize?,maxRows?})`
monta una vez, con autoridad de jugadores vacía, antes de prepare/attach/admisión/start/tick.
Sin reloj explícito, política de cuentas o configuración acotada, rechaza el montaje.

El piloto explícito rechaza invitados, incluidos sus blobs firmados, y `importSave`; no adopta sus
UIDs ni cambia el flujo de invitados por defecto. Cuentas existentes se cargan por la autoridad usual;
backfill/adopción de UIDs antiguos y política definitiva de invitados siguen abiertas.

`prepare()` comparte una Promise estable. Adquiere la barrera global de Startup sincrónicamente antes
del primer await. Carga economía y prepara recuperación/lecturas actuales de suelo en paralelo;
espera ambas autoridades incluso si una falla. `mapClock` debe ser puro, síncrono y consumir solo sus
inputs/context congelados; no leer World/economía todavía en carga por closure. Este corte no elige
envejecimiento offline, rebasa deadlines ni expira perlas por su cuenta.

Solo tras ambas preparaciones exitosas y host abierto, `drain()` síncrono instala suelo actual y
debe devolver ready. Economía restaurada antes del apply; listener/sim/admisión/upgrade/health/perfiles/
comandos/tick permanecen cerrados hasta ready. Staging conserva su propio beforeTick, separado de
la instalación inicial. El status público añade únicamente `{state,ready}`, sin filas/UIDs/diario.

Un request pendiente sin recibo, IO/configuración/captura inválida o rollback dejan host cerrado.
No resume requests, no borra reservas ni vuelve a intentar prepare. Close cancela recuperación iniciada
no-ready, espera su preparación y flush de ambas autoridades, sin drain. Close de startup incompleto
rechaza flush. La cancelación económica conserva el contrato previo de WorldState: lectura abortada
no instala respuesta tardía; la recuperación de diario/suelo sí se espera antes de terminar el cierre.

`createGameServer` exige `worldId` explícito y ofrece
`pearlStartup:{journal,accountPolicy:'accounts-only',mapClock,pageSize?,maxRows?}` junto a pearlStaging.
Monta antes de attach; listen espera prepare antes de abrir socket/arrancar timers de simulación.
No agrega flags/env, endpoints mutantes ni configuración de producción.

## Reutilización y aceptación

Unreal/FAB cruzado con [portabilidad](../research/unreal-assets/PORTABILITY.md). Candidatos verificados
por stat: BP_JigServerSave.uasset (580.554 B) y BP_InventoryComponent.uasset (24.878.603 B), en
ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/InventorySystem. Son referencias Blueprint,
sin runtime Node/CAS portable. Reutilizar Startup, hidratación, diario SQL008, gate, ProfileSessions y
WorldState; no importar assets ni modificar fuentes Unreal.

Pruebas con GameHost real en memoria y SDK contra SQL001–008 local: waits de economía/diario/suelo,
Promise compartida, gates antes de IO y durante prepared, recibo histórico/ubicación actual, request
sin recibo conservado, cancelación/fallos/mapper inválido, cuenta admitida y staging sobre mismo diario,
invitados/importación rechazados y upgrade HTTP/WebSocket loopback. Regresión de la aceptación previa
en archivo Git fijo más fuentes propias con SHA256 antes/después. Sin cambios visuales o payload de
juego; no repetir GPU/dispositivos ni afirmar Supabase real, reinicio del PC o despliegue.

## Límites

Activación automática y comandos durables del juego todavía pendientes; no activar circulación parcial.
Una autoridad por mundo hasta leases. Namespace/adopción/reloj definitivo, inputs con epoch, finalizador
durable, muerte completa y transacciones conjuntas perfil/mundo/barco siguen abiertos. Afinidad permanente
por personaje/tipo conserva [su corte](m48-pearl-affinity.md); animales/legendarias después.
