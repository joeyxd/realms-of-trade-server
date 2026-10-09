# M5 / D09f-2b.36 — recogida persistente de perlas

Base aislada 1a3ef18d4da16331088ff16802f3f4ace9f5df91. Añadir un dueño server-only de pickup de una perla de suelo con el dominio
explícito de GroundDeadlineClock. Reutilizar pickPearl detached, reservas, cola ground, journal y SQL001–013;
no crear migración ni activar host/CLI. La perla tragada permanece ligada hasta muerte.

API trusted PearlPickupStaging.pickup({dropId,receiver:{clientId,entity}}), reloj auténtico obligatorio y
del mismo scope. Identidad de cuenta se obtiene de sesión/ECS; UID/kind del objeto de suelo. Comprobar
radio, capacidad, disponibilidad/retorno en tiempo durable y groundClock exacto. Fuentes legacy sin marker
no se reinterpretan. Lecturas loadUnique/loadPearlLocation deben probar holder null, kind, versión
común, world y ground original. Congelar y ligar request/recibo de destino ground:null privadamente.

Mantener detenido el tick completo y sus columnas ECS/perfil/fuente hasta drain. La reserva exacta
cuenta + UID fuente cumple el contrato de PearlQueue; la cuenta bloquea también transferencias de las
otras perlas y se revalidan todos sus ledgers. Rechecks + CAS cierran desplazamiento/cambio de versión.
Async solo prepara; drain síncrono decora eventos detached, revalida, cambia perfil/ledger/suelo/dirty,
publica último y revierte/fence si falla. Reconcile no autoriza repetir efectos locales.

pickPearl y returnPearl nativos rechazan cualquier propiedad propia groundClock antes de mutar.
Una proyección no puede entrar en consumo local ni retorno sin recibo. El helper detached recibe solo
una copia después de validar y retirar su marker; la fuente viva conserva su identidad/proveniencia.
Mantener comportamiento de fuentes nativas sin marker y snapshots/protocolo/RNG.

Pruebas: competencia entre receptores/coordinadores, receptor con otras perlas/tragada, ventanas,
proyección pasada negativa, offset >2^32, ancla futura/overflow, selectors/getters/Proxy, lecturas
independientes, ground/version/holder falsos, relocation concurrente, respuesta perdida/replay,
request/receipt/fuente/actor/tick alterados, disconnect/invalidation, progreso ECS, rollback y publicación.
SDK/SQL001–013: leave → checkpoint disponibilidad → World0 → startup antes de admisión → pickup →
replay → nueva restauración sin suelo y reapertura de una sola perla; también receptor ya poseedor.

Unreal/FAB comprobados solo lectura: BP_InventoryComponent (24878603 bytes), BP_MainPickupClass
(370913), BP_PickupComponent (586537) y SM_Potion (117402), ActionRPGMultiplayerStart. Metadatos/nombres
son referencias de flujo; no prueban autoridad durable ni portabilidad. No es un mesh de perla.
Reusar helper/ground/clock/sesiones/SDK actuales; ningún asset nuevo, exportación ni cambio de fuentes.

Pendientes: retorno durable/playa y venta, montaje de pickup en host y startup conjunto, dominio/versionado
legacy, atomicidad reloj/gameplay y ventana de crash, política offline/cadencia, leases/finalizador,
afinidad por personaje/tipo, P4/P6 y aceptación real. Sin env/secrets/Supabase live/push/deploy/reinicio.
