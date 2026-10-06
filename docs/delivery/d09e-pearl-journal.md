# D09e — diario de solicitudes y recuperación tras restart (M5 P4/P6)

Base `c6bc368`. [Brief](../briefs/m5-pearl-journal.md). Versión/protocolo conservados por M5;
D06 mantiene cliente/sim/UI/comercio/entrypoints y sus cambios pendientes fuera de esta aceptación.

## Resultado y uso

`server/pearlJournal.mjs` ofrece `createMemoryPearlJournals()` y
`createSupabasePearlJournal(serviceClient,scope)`. El scope debe ser el identificador estable del mundo;
ground exige world=scope. Cada fila conserva `{operationId,scope,family,request,state}`: request canónico
sin UUID interno, snapshots CAS completos, familia pearl/ground y estado pending/committed/conflict/rejected.
Identidad inmutable por UUID global; prepare exacto y cierre terminal exacto son idempotentes. No se borra
historia ni se reabre un terminal. Listado solo pendiente, por scope/UUID, cursor exclusivo y páginas 1–256.

Migración **[005_pearl_journal.sql](../../server/migrations/005_pearl_journal.sql)**, después de 001–004:
tabla/RPCs/helpers solo para service_role, RLS, SECURITY INVOKER/search_path vacío, guardias de identidad y
transición terminal. RPCs devuelven JSONB: objeto para prepare/resolve y array para list. Una fila del diario
no es un recibo de transacción; prepare y commit son transacciones separadas, coordinadas por el request/UUID.

```js
const journal = createSupabasePearlJournal(serviceClient, worldId);
const sessions = new ProfileSessions(store, onFailure, { journal });
const outcomes = await sessions.recoverPearls(); // before accepting joins or commands
```

Con diario, `open` y nuevos commits rechazan con recovery hasta escanear/validar TODO el backlog.
Corrupción, orden/cursor incorrecto, UUID repetido o solapamientos de UID/cuenta impiden admitir, sin elegir
un ganador. Una vez validado, instala reservas de cuentas/UID/UUID antes de leer recibos. Cuentas recuperadas
no necesitan sesiones vivas para quedar cercadas; operaciones disjuntas pueden avanzar después de startup.

La cola escribe prepare **después** de los guardados previos/preflight/builder y **antes** del primer RPC de
perla. Esos guardados anteriores conservan su CAS habitual; este diario no los engloba. Si falla o se pierde
la respuesta de prepare, no manda la perla y mantiene contexto local conservador. Cancelar una cuenta durante
prepare confirmado cierra rejected antes de soltar reservas. Builders/metadata/dos envíos idénticos de D09d
se conservan. El resultado solo sale tras cerrar el diario; saves llegados durante ese await se rebasan con
el UID/delta de oro después de cerrar, preservando progreso reciente.

## Recuperación

Startup y `reconcilePearl`/`reconcilePearlGround` leen recibo de su familia, comparan request exacto y leen
perfiles/ledger/ubicación ACTUALES. DTO inválido/lectura fallida o recibo ausente/malformado/distinto conserva
pending. Lecturas completas exactas cierran committed; estado avanzado/ausente confirmado cierra conflict
sin devolver perfiles/posición históricos. Startup devuelve solo UUID/outcome, sin publicar gameplay.

`resumePearl(UUID)`/`resumePearlGround(UUID)` reanudan explícitamente un pendiente: primero leen recibo;
solo null autoritativo, sin recibo ya observado ni resultado conocido en ese contexto, permite prepare exacto
y **un** envío del request persistido. No hay builder, nuevo UUID, actualización de payload ni bucle de retry.
Si existe recibo, resume solo reconcilia. Error de lectura o DTO distinto nunca autoriza ese envío.
Un conflicto/rechazo definitivo del RPC reanudado retira el diario como rejected; resultado ambiguo queda pending.

Fallo/respuesta perdida de resolve conserva reservas; reconcile repite lectura/cierre sin mutación de perla.
Caso especial verificado: committed quedó escrito pero se perdió su respuesta, y luego la autoridad avanzó.
Tras recibo exacto y lecturas actuales que prueban conflicto, prepare idempotente confirma que esa identidad
ya estaba committed; se libera el contexto local con conflict sin cambiar el resultado de auditoría. Fila
pending, distinta o malformada no sirve para esa excepción. No hay snapshots anteriores reproducidos.

Sin diario, API/errores de las sesiones anteriores siguen disponibles. Con diario, flush falla si falta scan
o quedan pendientes, además de los errores permanentes de la instancia ya existentes. Reconciliar no borra
contadores de error ni reabre la sesión fallida: cerrarla/reabrirla carga autoridad actual. Comandos nuevos
con un UUID ya terminal se rechazan; resume actúa solo sobre contextos pendientes.

## Evidencia local

- **204/204** pruebas pertinentes sobre árbol confirmado `c6bc368` más siete archivos propios de código,
  migración y tests. Lista explícita de 22 archivos, `node --test --test-concurrency=2`;
  `shots/review/m5-journal-committed-base.log`. Incluye 159 previas, 14 de contrato/DTOs/cierre ambiguo,
  seis SQL/SDK y 25 de cola/restart (conteo de Node incluye subtests). Sin `.env` copiado ni checkout/index/host
  cambiado. Esta aceptación aísla D06; no es regresión visual ni aceptación de su gameplay.
- SQL 005 aplicada y reaplicada en PGlite: identidad exacta/terminales, payload/familia/scope cambiados,
  páginas exclusivas, generaciones/endpoints/ground inválidos, writes raw y roles públicos denegados.
  SDK Supabase instalado con transporte local comprueba argumentos y forma JSONB de las tres RPCs.
- Reinicios/reconstrucción: pendiente antes/después de commit, cuentas/UID/UUID cercados, prepare reply perdido
  con cero envíos, resolve fallido sin otra mutación, venta acreditada una vez, ubicación posterior rechazada,
  lecturas de perfil/ledger/ubicación fallidas o malformadas, recibos ausentes/distintos/malformados,
  scan fallido/corrupto/solapado y 65 pendientes en dos páginas, close durante prepare, crédito de venta + XP/oro
  reciente durante cierre lento. Principal revisó fixtures y solicitó reforzar los casos de venta/lecturas/solapamientos.
- **4/4 fases en procesos Node separados**, `shots/review/m5-journal-process-canary.log`: una venta SQL
  confirma perfil/ledger/suelo y deja diario pending antes de terminar el proceso; proceso nuevo recupera
  committed sin envíos, oro 610 una vez. Otro proceso guarda mint sin dispatch; el siguiente encuentra pending
  y reanuda el mismo UUID una vez, generación 1 y sin builder. Base PGlite aislada en `.scratch`, sin credenciales,
  HTTP listener ni mundo/partida real. Son cuatro fases, no una prueba de hosts concurrentes.
- Delegación Luna: revisión arquitectónica, SQL/tests SQL y tests de reconstrucción; principal conserva
  integración/aceptación, corrigió cardinalidad JSONB y añadió DTOs y cierre committed perdido + avance posterior.
  Revisión read-only del caso de cierre; sintaxis/diff propios y escaneo de secretos antes del commit.

## Límites y siguiente corte

**005 pendiente de aplicar y verificar en Supabase.** Ninguna red/proyecto real se consultó o modificó en
este corte; no hubo cambios de credenciales/Auth ni nuevas variables. Tampoco inicio/reinicio de host,
push/publicación, cambio de sim/cliente/protocolo/comercio ni prueba de URL pública.

El diario es opt-in y aún **no está inyectado en el host ni ligado a comandos de juego**. Memoria solo modela
restart si se conserva la factory; una nueva factory pierde datos. PGlite sobre disco demuestra persistencia
local entre procesos, sin acreditar PostgREST real 005 ni solapamiento PostgreSQL multi-backend. Un scope
estable y una autoridad siguen siendo requisitos; diario no proporciona lease/exclusión entre hosts P5.
Snapshots de progreso aún pendientes al morir el proceso no están journaled. Filas terminales conservan
snapshots para auditoría; política de retención/operación administrativa queda por diseñar antes de gran volumen.

Se cruzó la necesidad con [SUMMARY](../research/unreal-assets/SUMMARY.md),
[CANDIDATES](../research/unreal-assets/CANDIDATES.csv) y [PORTABILITY](../research/unreal-assets/PORTABILITY.md).
`ActionRPGStarterSystem/InventorySystem/SaveSystem/BP_JigServerSave` es referencia; no prueba UUID/CAS/recovery
portable a Node. `SM_StoragePart_03` solo aporta apariencia. Se reutilizaron DTOs/recibos/cola 003–004; no hubo
importación de arte, nuevo inventario ni escritura de fuentes Unreal.

Siguiente: verificar 005 tras aplicación del autor; coordinar con dueño de LocalServer staging previo a
mutación/ack y conectar journal/recover al startup. Resolver reloj/restauración de ground y adopción/cuarentena/
invitados antes de activar circulación gestionada. Offline aging, legendarias/cartel/retorno, reglas navales,
leases y transacción general mundo/barcos/perfiles permanecen abiertos. P4/P6 no se marcan completos.
