# M5 — ciclo de botín ordinario de muerte (D09f-2b.26)

## Objetivo y frontera

Un objeto o poción creado por una muerte confirmada debe tener un solo resultado: sigue en suelo,
lo recoge una cuenta o expira. Inventario, estado del drop y recibo se confirman juntos.
El almacenamiento expone el suelo actual separado del historial de creación de SQL009.
No se activa todavía pickup/expiry en sim, cola/journal, hidratación de World ni configuración del host.

## Identidad y datos

La fuente sigue siendo (operationId de muerte, ordinal 1–35). Cada transición recibe un UUID distinto
que comparte exclusión con recibos pearl/ground/batch/death e intenciones existentes, en ambos sentidos.
La petición incluye world, modo pickup/expire, tick lógico at, metadatos completos de creación,
expectedVersion y, para pickup, cuenta/version/before/data completos del receptor.
Identidad de cuenta procede del servidor y pirateId mantiene account:<UUID>.
Ningún selector enviado por el jugador constituye permiso de proximidad, vida o propiedad.

El estado empieza ground/version 1 y solo puede terminar picked/version 2 (holder cuenta) o
expired/version 2 (holder null). Conserva el UUID de transición. No hay reapertura ni borrado de estados.
Cada recibo conserva petición y resultado exactos; repetir UUID/petición devuelve replay histórico.
Repetir con datos distintos falla. Un replay no vuelve a entregar el objeto ni revierte progreso posterior.

## Conservación y tiempo

Pickup de objeto público copia todos sus campos, asigna u=before.uid del receptor, añade al final de bag,
incrementa uid e items una vez y conserva los demás campos del perfil. La misma regla vale al recuperar
el equipo propio. Capacidad 24; uid no desborda Int32; contador items no supera 1e9.
Pickup de poción aumenta pot en uno hasta capacidad 5. Bolsa/pociones llenas no consumen el drop.
Oro, XP, maestría, perlas y demás progreso no cambian por esta transición.

Pickup permite availableAt <= at <= expiresAt. Expiry exige at > expiresAt, igual que inventory.js.
Los ticks son enteros seguros suministrados por autoridad trusted. Este corte no elige epoch, avance
offline ni conversión de reloj después de restart. Un ground vencido sigue listado hasta confirmarse
su operación expire; no se elimina mediante una lectura o filtro silencioso.

## Migración y recuperación

Aplicar SQL011 después de SQL001–010. AFTER INSERT de un drop nuevo en SQL009 crea su estado inicial
en la misma transacción de muerte, mientras su recibo es provisional. El recibo de muerte no cambia.
No se rellena estado para filas históricas anteriores a SQL011: pudieron ser recogidas localmente sin
un tombstone y reconstruirlas como disponibles duplicaría botín. Quedan fuera del suelo actual,
loadDeathDrop devuelve null y replay de muerte no las adopta. Reaplicar SQL011 no modifica estas filas
ni reabre estados terminales. Una adopción histórica requiere evidencia y un corte distinto.

loadDeathDrop lee estado actual; listCurrentDeathDrops pagina solo ground por mundo/UUID/ordinal.
listDeathDrops sigue devolviendo historia de creación. loadDeathDropOperation devuelve recibo exacto.
Tras respuesta perdida se lee ese recibo; un caller futuro deberá reservar cuenta/drop y comparar
versiones actuales antes de publicar/aplicar. Este corte no incorpora la nueva familia al journal.

## Atomicidad y permisos

Orden de locks: UUID de nueva operación, perfil receptor, todos sus UIDs de perla ordenados, fila del
estado del drop. Expiry no bloquea perfil. No se vuelve a bloquear el recibo inmutable de muerte después
de bloquear perfil. CAS y before exacto se verifican antes de cualquier cambio.
Una excepción revierte inventario/estado/recibo completos. Los triggers conservan identidad, validan
transiciones contra recibo provisional y rechazan finalización incompleta, metadatos o ventanas falsos.
Un RPC por transacción; no agrupar varias operaciones sobre el mismo receptor antes de los checks
diferidos. RLS y funciones invoker con search_path vacío dejan acceso únicamente a service_role.
SQL conserva JSON de perfil futuro; el DTO JS exige el perfil/item canónico del catálogo actual.

## Reutilización comprobada

Inventario Unreal/FAB consultado para esta necesidad concreta. Fuentes intactas y revisadas por stat:
BP_InventoryComponent.uasset (24,878,603 bytes) y SM_Potion.uasset (117,402 bytes), bajo
C:/Unreal/ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem.
El componente es Blueprint y no ofrece una implementación portable de Postgres/JS; la poción es un
candidato visual, sin preview ni integración en este corte de almacenamiento. Se reutilizan las reglas
existentes de inventory.js y los contratos SQL009/010. No se recrea ni añade arte al bundle.

## Aceptación necesaria

Memoria y SDK/PostgreSQL local: conservación, ventanas, CAS, capacidad, contención, errores/replay,
UUIDs, RLS, escrituras directas, migración repetida e historia anterior. Dos procesos independientes
prueban reinicio real de la base local y respuesta perdida sin resucitar estados terminales.
PGlite serializa consultas: no acredita solapamiento real de backends PostgreSQL independientes.
Aceptación fija de fuentes y suite anterior antes de integrar; canario Supabase real pendiente.
Sigue journal/reservas/reconciliación, staging/apply en tick, hooks de recogida/expiración y restauración
con reloj estable, luego restart/reconexión/WAN. Afinidad permanente y escalado elemental siguen abiertos.
