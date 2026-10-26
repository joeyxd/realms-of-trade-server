# D09f-2b.16 — montaje del staging en GameHost

2026-10-07. Continúa [la frontera de inputs](m5-pearl-input-boundary.md). El host ensambla las piezas
aceptadas en .13–.15; las pruebas dejan de construir sus tres adapters manualmente. Este corte no
habilita circulación durable en `npm start` ni configura startup/adopción/reloj.

## Contrato

`GameHost.mountPearlStaging({scope,limit?})` es una llamada trusted interna y única, antes de attach,
conexiones (incluso ya cerradas), sesiones, tareas, start o primer tick. Exige verificador de cuentas y
scope explícito; si hay WorldState debe coincidir con su ID. Rechaza callbacks/opciones desconocidas
y un beforeTick previo. El getter `host.pearlStaging` no permite sustituir el coordinador.

El host construye PearlStaging con captura canónica propia, preparación de inputs de su LocalServer
y drain síncrono en beforeTick. Conserva la barrera de tick y guardas de comandos/perfiles ya existentes.
Un recibo solo prepara trabajo; la siguiente entrada normal pump/step aplica, incluso durante pausa.
Eventos esperan al tick admitido; save CAS reservado conserva progreso actual. Sin montaje, beforeTick
sigue null y el flujo anterior conserva publicación/comandos/partidas firmadas.

Un resultado fenced o excepción de drain marca cierre y detiene timers inmediatamente. Si staging
notifica fallo de sesión durante apply, el host difiere la desconexión a una microtask tras salir del
callback; primero termina rollback de perfil/ECS/drop/inputs. No continúa un pump fallido cada 4 ms.
El cierre normal invalida antes de detach, espera tasks de staging y luego flush de perfil/mundo.
Nunca drena/aplica durante shutdown. Operaciones restantes o progreso final bloqueado hacen fallar
close; no se descartan reservas, no se revierte SQL ni se reenvía automáticamente una operación.

`createGameServer({pearlStaging:{scope,limit?}})` monta antes de attach. Es una opción de API trusted,
sin variable de entorno, endpoint, UUID/versiones o inventario suministrados por cliente. El entrypoint
no la pasa. `/status.storage.staging` expone solo enabled/failed y conteos; no revela identidades/requests.

## Reutilización

Cruce con [inventario de portabilidad](../research/unreal-assets/PORTABILITY.md) y candidatos exactos
verificados por Luna, de solo lectura:

- `C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\InventorySystem\SaveSystem\BP_JigServerSave.uasset`, 580.554 B.
- `C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\InventorySystem\Components\BP_InventoryComponent.uasset`, 24.878.603 B.

Son Blueprints de referencia, sin runtime Node/CAS portable. Reutilizar PearlStaging, capturePearlProfile,
preparePearlInputs y gate existentes; sin arte nuevo, imports Unreal ni modificación de fuentes.

## Aceptación

Host real con sesiones verificadas y memory/SDK SQL008 local: recibo lento, baseline ECS y progreso
posterior, pausa, movimiento/ACK y filtros, give y reemplazo, guardados/UID/drop únicos. Cierre durante
RPC espera sin apply/publicación; fallo tras escrituras propias restaura antes de desconectar. Excepción
de drain para host una vez; admisión/timers/health quedan detenidos. Mount tardío/scope/callbacks/repetición
denegados. API HTTP loopback y partida firmada de invitado por default conservadas.

## Límites antes de activar

Faltan recuperación automática de diario/suelo antes de admisión, scope/namespace/reloj/adopción,
dispatch durable y hooks completos de circulación/lifecycle/efectos autónomos. Este montaje no agrega
diario a ProfileSessions ni llama PearlStartup. El operador interno sigue aportando versiones gestionadas;
no hay selección confiable de versión desde un comando de jugador todavía.

Epoch de inputs cliente-servidor, finalizador durable, muerte completa y operaciones conjuntas de
perfil/mundo siguen abiertos. Shutdown con operación pendiente falla explícitamente: conservar su progreso
solo en memoria no acredita recuperación tras crash. Afinidad permanente por tipo es otra entrega.
Una autoridad por mundo hasta leases. No activar el montaje como sustituto de estos gates.
