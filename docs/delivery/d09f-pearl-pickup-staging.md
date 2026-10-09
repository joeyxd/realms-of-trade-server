# D09f-2b.36 — recogida persistente de perlas

Fecha: 2026-10-09. Base aislada 1a3ef18d4da16331088ff16802f3f4ace9f5df91; integrada después de commits concurrentes compatibles.
SQL013 aplicada según el autor; este corte no consulta Supabase live ni necesita otra migración.

## Resultado

PearlPickupStaging añade pickup trusted con solo dropId y receiver clientId/entity. Requiere reloj
GroundDeadlineClock auténtico del mismo scope y una fuente proyectada válida; cuenta, UID, kind,
generación y ubicación se derivan de autoridades del servidor. Compara radio, capacidad y ventana
inclusive de disponibilidad/retorno, incluso con disponibilidad local negativa. loadUnique y
loadPearlLocation prueban holder null, kind, versión común, world y ground original. La cola revalida
versiones antes de SQL y el CAS rechaza una fuente movida. Un marker local no acredita storage por sí solo.

Una reserva exacta cuenta + UID fuente conserva el contrato de permisos de PearlQueue. La cuenta
impide también dar las otras perlas del receptor, y se comprueban sus ledgers completos. El dueño
retiene el tick completo y todas las columnas ECS/perfil/fuente del receptor hasta drain: avanzar o
retroceder el tick invalida esta operación. El host aún no monta ni implementa esa retención aquí.

Ligadura privada de fuente, ground, receptor, tick, reservas y request/recibo; selector no acepta
cuenta, UID, ground, generación, at ni UUID proporcionados por cliente. Async deja World intacto.
Drain decora eventos detached, valida otra vez, actualiza bolsa/progreso/ledger/suelo/dirty y publica
pickup/unloot al final. Conserva perla tragada, orden de otras perlas, RNG y shape de eventos existentes.
Error local restaura estado propio y mantiene fence/recibo durable; no repite efectos históricos.

pickPearl y returnPearl nativos rechazan cualquier propiedad propia groundClock, incluso nula o inválida,
antes de mutar. Así stepDrops no recoge ni relocaliza fuentes proyectadas sin su dueño durable. Las
fuentes nativas sin marker conservan el flujo anterior. El helper usado por staging recibe una copia
tras verificar/retirar el marker; nunca se retira de la fuente viva para autorizar fallback.

## Verificación aceptada

**566/566 pertinentes aisladas**, 26 archivos, **60 nuevas** (58 unitarias + 2 SQL), cero fallos,
cancelaciones, skips o TODOs; 69075.6646 ms, Node 24.14.0. Git archive fijo, **620 fuentes** de
server/src/tests/manifiestos y **954 archivos físicos Three** estables antes/después. Dependencias
externas mediante junction no se hashéan completas. **97/97 focales compartidas**, cuatro archivos,
3531.0789 ms y **130 fuentes** de cierre literal de imports relativos/manifiestos/migraciones001–013
estables, comparadas normalizadas con la copia aislada y luego con el índice. No es la regresión completa
de comunidad/arte/LLM/Web3 que avanzó concurrentemente. Pases preparatorios no se suman.

Cobertura: dos receptores/coordinadores compiten por el UID, regreso al poseedor original con perlas
y tragada, radio/capacidad/timing, tick de retorno inclusive, pasado negativo, offset >2^32,
ancla futura/overflow antes de I/O, selectors/getters/Proxy sin callbacks, lecturas independientes,
source ground/holder/kind/version falsos, relocación concurrente, respuesta perdida con UUID/request
idénticos, request/receipt/source/ledger/profile/ECS/tick alterados, disconnect/invalidation/reuse,
progreso ECS, saves dentro de reserva, rollback y reentrada/publicación fallida. Recibo durable intacto.

SDK/SQL001–013 service_role local: leave → checkpoint exactamente en disponibilidad → reloj nuevo y
World tick0 → recovery/hydration sin escritura async ni eventos históricos → admisión → pickup →
recibo/replay exacto sin cambiar perfil → un drain → nueva restauración sin fuente de suelo y cuenta
reabierta con un solo UID. Segundo caso SQL recupera hacia un receptor con otras perlas y tragada.
Son Worlds/coordinadores nuevos sobre la misma instancia de storage; no reopen file-backed/proceso,
GameHost real, conexiones PostgreSQL independientes, leases o Supabase live.

Preparación encontró dos fallos de fixture (receptor original fuera del radio); corregidos. Una segunda
pasada mostró el permiso demasiado amplio del gate y el resultado de reentrada: la reserva ahora es
exacta y drain devuelve fence explícito tras error capturado. La revisión Luna no detectó el defecto de
permiso; aceptación se basa en comprobación directa del principal y pruebas finales. El test SQL de
receptor no vacío cubre esa corrección. Ningún pase fallido se acepta ni se agrega a los totales.

[Evidencia/hashes](d09f-pearl-pickup-staging-evidence.json), [brief](../briefs/m5-pearl-pickup-staging.md).
Commit selectivo de ocho rutas; contenido/índice ajenos conservados. Logs en shots/review.

## Siguiente corte y límites

Retorno durable a playa y ruta de venta antes de activar el ciclo completo; ahora fuentes proyectadas
se bloquean en retorno local. Montar pickup con retención/publicación del tick y startup conjunto solo
tras cerrar dominio/versionado legacy, atomicidad reloj/gameplay/ventana de crash, autoridad entre
procesos, política offline/cadencia y leases. La política offline consultada sigue sin respuesta.
Afinidad permanente por personaje/tipo, finalizador, P4/P6 y restart/reconexión/WAN reales pendientes.
Sin host/CLI/defaults/env/protocolo/push/deploy/reinicio ni SQL nueva.

Unreal/FAB: metadatos leídos de BP_InventoryComponent (24878603 bytes), BP_MainPickupClass (370913),
BP_PickupComponent (586537) y SM_Potion (117402); no prueban portabilidad/semántica ni son arte de perla.
Se reutilizan helper/sesiones/ground/journal/reloj/SDK existentes; cero assets nuevos, fuentes intactas.
