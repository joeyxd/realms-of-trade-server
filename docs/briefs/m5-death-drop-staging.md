# M5 — recogida y expiración en tick (D09f-2b.28)

Un recibo de botín confirmado debe convertirse en inventario/ECS, retirada del suelo y eventos en un único apply síncrono. Se reutiliza la cola/journal drop de .27 y el gate común; el coordinador queda dormant hasta montar los hooks del host.

## Entrada trusted

DeathDropStaging(sessions, world, scope, {limit:64}) exige scope igual al diario y límite 1–256. pickup({dropId,receiver:{clientId,entity}}) y expire({dropId}) reciben selectors locales únicamente; nunca aceptan account, versión, perfil, UUID, tick o metadata aportados por cliente. El UUID devuelto solo identifica trabajo pendiente.

Solo objetos/pociones públicos con identidad durable de muerte UUID+ordinal. Legacy/oro/quest/cofres/perlas quedan fuera de esta familia. Resolver receptor autenticado actual, vivo y cercano usando DROPS.pickR; capacidad 24/5 y UID nuevo del receptor. Full rechaza antes de reservar/enviar/consumir. Las perlas y toda progresión restante se conservan.

Captura desprendida de perfil canónico y progreso ECS real; reserva receptora, todos sus UIDs de perla y fuente UUID/ordinal antes de IO. Expiry solo reserva la fuente. Asentar baseline/guardados previos bajo capability, elegir versión de perfil y leer suelo actual de storage, comprobar identidad/metadata completas contra el objeto local. La petición conserva el tick de selección; no recaptura capacidad, perfil o tiempo tras espera.

## Obligaciones del host

Mantener el tick lógico completo sin avanzar durante IO y hasta drain; el coordinador comprueba world.tick igual al capturado. Congelar receptor y source, interceptar stepDrops antes de su mutación local, y retener eventos/snapshots/guardados. No se instala esa interceptación en este corte. No usar la ruta legacy sobre una fuente reservada.

Invocar invalidate(account) e invalidateDrop(sourceUUID,ordinal) antes de lifecycle externo, close/detach/recycle o retirada/reemplazo de fuente, incluso si después se restauran valores/referencias. Fence sticky: reconcile/resume de storage no autorizan un replay World. Fuente storage es authoritative; no backfill de historial pre011 ni nueva política de epoch/offline.

## Apply

settle espera IO sin cambiar el World ni liberar capability. save solo bufferiza el baseline capturado idéntico durante el gap; assertPublishable bloquea la cuenta. drain debe ejecutarse síncronamente en el tick retenido, antes de publicación.

Exige mismas sesiones/cuentas, actor, nombres, contenedores, todas las columnas numéricas, perfil completo, objeto de suelo y metadata, todos los ledgers de perla y ausencia de ownership huérfana/duplicación de fuente. Requiere recibo exacto, versión post-confirmada y storage idle.

Apply conserva referencias del perfil, cambia campos confirmados y potions ECS, retira exactamente el objeto original, ensucia perfil y prepara pickup/unloot. back depende de la cuenta víctima durable, no de un entity reciclado. Expiry emite solo unloot. No usa RNG ni allocator y no ejecuta emit/onPickup live; no concede nuevas recompensas por callbacks. Contenedores normales mutables, sin proxies/mutators/iterators propios; perfil plain JSON sin accessors.

Fallo antes/durante apply produce rollback local y fence, conserva SQL confirmado y no reintenta el efecto. Otros objetos/eventos y RNG pueden cambiar sin adelantar el tick retenido; no se capturan ni rebobinan.

## Reutilización verificada

Lectura y stat de candidatos Unreal/FAB: BP_InventoryComponent.uasset (24,878,603 bytes) en C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/InventorySystem/Components y SM_Potion.uasset (117,402 bytes) en Assets/PickupMeshes/O_Potion bajo ese mismo paquete. El primero es Blueprint no portátil al contrato JS/Postgres y el segundo solo aporta visual. No se exporta arte ni se modifica Unreal. Se reutilizan capturePearlProfile, deathDropOperation, ProfileSessions/PearlQueue, SQL011/012 y gate común.

## Aceptación y siguiente

Contrato memoria y SDK/SQL001–012 local, respuestas perdidas, saves/progreso reales, capacidad, ventanas/proximidad, lanes hasta apply, drift/lifecycle/tick, conservación de perlas y rollback/publicación sin callbacks. Revisión independiente acotada. No nueva SQL/schema/protocolo/env.

Después: montar pickup/expiry en host con la pausa/publicación del tick y restaurar suelo actual con reloj estable, luego restart/reconexión/WAN. Afinidad permanente y políticas/leases/finalizador/P4/P6 abiertos.
