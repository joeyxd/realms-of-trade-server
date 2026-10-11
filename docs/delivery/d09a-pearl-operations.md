# D09a — operación atómica de perla, perfiles y recibo (M5 P4/P6)

Base `6402462`, versión `0.6.0-alpha.1`, protocolo 13 conservados. Corte local de almacenamiento;
sin push, despliegue, migración real ni reinicio del host. [Dueños y contrato](../briefs/m5-pearl-operations.md).
El otro trabajo de cubierta/navegación/host del PC conserva sus archivos y autoridad.

## Resultado

`store.commitPearl({operationId, uid, kind, from, to, expectedVersion, profiles})` confirma juntos:

- Snapshots saneados de las cuentas origen/destino, con CAS de cada perfil y generaciones incrementadas.
- Ledger del UID, `kind=pearl:<kind>`, dueño UUID o null y generación CAS.
- Recibo por UUID de operación: mismo payload devuelve el resultado original con `replay:true`, incluso
  después de operaciones posteriores; otro payload con ese UUID devuelve `why:operation`.

Los endpoints deben existir, ser distintos y aparecer exactamente una vez; null significa fuera de cuentas,
sin representar ubicación/suelo. La primera creación exige generación cero y origen null. Se quita exactamente
una copia del origen y se añade al destino; las otras perlas conservan UID/kind. Los cuatro tipos raros actuales
son válidos. La capa de comandos decide elegibilidad y precio; el almacén recibe el snapshot autoritativo.
Una venta puede incluir su oro en ese snapshot, sin acreditar otra vez cuando se repite el recibo.
El recibo repetido conserva las generaciones originales; no es una lectura del estado más reciente. La futura
cola de juego debe cargar/reconciliar ese estado al recuperarse, sin aplicar el snapshot viejo por el replay.

`server/pearlOperations.mjs` valida y desacopla solicitudes/resultados. `loadUnique(uid)` consulta dueño y
generación. Memoria confirma sus tres mapas en una ejecución sin await entre mutaciones; no sobrevive al proceso.
Supabase usa `mn_commit_pearl`/`mn_load_unique` de 003. Mensajes del proveedor no salen del límite de errores.

## Frontera SQL

[003_pearl_operations.sql](../../server/migrations/003_pearl_operations.sql) se aplica después de 001/002.
Añade `mn_pearl_operations`, con RLS y permisos solo de servicio. La operación bloquea perfiles por UUID y
después UIDs en orden estable. El recibo provisional serializa reintentos; CAS o validación fallida revierte
perfiles/ledger/recibo. Fallos inesperados también abortan la transacción y se redactan en el adaptador.

El trigger BEFORE de perfil toma locks transaccionales por todos sus UIDs viejos/nuevos, aunque aún no estén
registrados. La guardia diferida valida la propiedad gestionada al terminar la transacción. Esto coordina
guardados/importaciones con la primera creación del UID; una copia histórica que ya contradiga la creación
causa rechazo, sin adoptarla silenciosamente. Las primitivas P1 independientes rechazan `pearl:*`, y el UPDATE
de liberación incluye la exclusión del tipo gestionado para cerrar la carrera entre lectura y escritura.
SQL exige `READ COMMITTED` y rechaza otros aislamientos: necesita observar commits anteriores tras esperar el
lock, conforme al [contrato de snapshots de PostgreSQL](https://www.postgresql.org/docs/current/transaction-iso.html).

La elección usa [locks transaccionales de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html),
[triggers de constraint diferibles](https://www.postgresql.org/docs/current/sql-createtrigger.html) y
[rollback del bloque PL/pgSQL al capturar errores](https://www.postgresql.org/docs/current/plpgsql-control-structures.html).
Revisión Luna de contrato/carreras en solo lectura; integración y aceptación por el principal.

## Evidencia y límites

**91/91 pruebas pertinentes**, sin ampliar la afirmación a toda la suite compartida:

- **77/77** de cuentas/importación/store/SQL y mundo/economía, `shots/review/m5-pearl-regression.log`.
- **14/14** de aceptación consolidada del principal, `shots/review/m5-pearl-acceptance.log`: conceder/transferir/
  liberar/reclamar, oro acreditado una vez, replay tras cambios posteriores, contendientes/CAS, snapshots aislados,
  pérdida de respuesta, errores redactados, progreso legítimo y bag/swallowed, restauración vieja rechazada,
  importación fallida sin recibo legacy, copia histórica detectada en tercera cuenta, rollback después de mutar
  el primer perfil, aislamiento incompatible rechazado, permisos/RLS y reaplicación sin pérdida de datos.

PGlite compila 001/002/003 y el SDK usa un transporte local sin red ni credenciales. La prueba de schema/grant
también pasó. Sintaxis y diff limpios al integrar. Revisión de pruebas Luna, inspección y aceptación del principal.

El host abierto fue consultado por loopback: health 200, Supabase durable, cuentas activas, mundo ready y
cero errores de almacenamiento/simulación; `shots/review/m5-pearl-active-host.log`. La generación observada
del mundo fue 44 y continúa cambiando por autosave. Esta misión no lo arrancó, detuvo ni reinició.

**003 todavía no se aplicó al Supabase real**: no hay canal SQL administrativo configurado. No se consultaron
ni modificaron partidas existentes. Las pruebas PGlite de peticiones competidoras usan una instancia que
serializa consultas; no acreditan conexiones PostgreSQL independientes, PostgREST real ni leases.

P4/P6 siguen parciales. El juego mantiene su ledger de sesión y no llama a `commitPearl`. Raras existentes sin
registro gestionado siguen con su flujo previo: no hay garantía global para ellas ni adopción/backfill automático.
No se implementan suelo/expiración durable, catálogo de legendarias, regreso por inactividad, cartel de portador,
leases, ni atomicidad mundo/perfil/barcos. No cambia simulación, UI, protocolo o versión.

Próximo corte: aplicar/verificar 003 en el proyecto real; preparar cola/ack autoritativa y reconciliación de
perfil/UID al entrar, con política explícita de adopción/backfill/collisiones e invitados. Probar concurrencia
de conexiones independientes antes de habilitar circulación gestionada o riesgo persistente en el juego.
