# D09a — base atómica de perlas (M5 P4/P6)

Base `6402462`, versión `0.6.0-alpha.1`, protocolo 13. Corte de almacenamiento independiente del dueño de
balsas/cubiertas/navegación y del host del PC. No modifica sim, protocolo, renderer, host ni servidor abierto.

## Dueños

- Principal: `server/store.mjs`, `server/pearlOperations.mjs`, `server/migrations/003_pearl_operations.sql`,
  arquitectura, integración y aceptación. Documentación compartida solo en hunks propios de M5.
- Luna revisión: contrato/carreras en solo lectura.
- Luna pruebas: dos archivos nuevos de operaciones memoria y SQL/SDK, asignados tras cerrar el contrato.

## Contrato

`commitPearl({operationId, uid, kind, from, to, expectedVersion, profiles})` solo en el servidor.
operationId es UUID; uid/kind son una perla actual válida. from/to UUID o null, distintos y no ambos null.
expectedVersion es la generación del ledger; cero solo crea un UID nuevo desde null. Cada endpoint no null
aparece una vez en profiles: `{id, expectedVersion, data}` de una cuenta ya creada, con perfil saneado.

La operación valida CAS de los perfiles y UID, retira exactamente una perla del origen y la añade al destino
(null significa liberada, sin drop/ubicación en esta fase). Las demás perlas conservan identidad/propietario.
Perfiles, ledger `kind=pearl:<kind>` y recibo se confirman en una transacción. Misma operación/payload devuelve
el recibo sin repetir efectos; ID reutilizado con contenido distinto falla. Oro se incluye en el snapshot
autoritativo; el almacén no decide precios ni permite peticiones directas del jugador.
El recibo describe esa confirmación, no el estado actual tras operaciones posteriores. Al recuperar una
respuesta perdida, el futuro caller debe reconciliar con `loadProfile`/`loadUnique`, sin reinstalar el payload viejo.

Perlas gestionadas no se reclaman/liberan mediante las primitivas P1 independientes. Guardados/importaciones
de perfil no pueden añadir/quitar una copia que contradiga ese ledger. Memoria aplica el mismo contrato;
SQL usa locks/CAS y comprobación diferida de propiedad. `loadUnique(uid)` permite consultar la generación.
El trigger de perfil toma locks transaccionales por UID antiguo/nuevo aunque no exista aún en el ledger;
la operación toma filas de endpoints y luego esos UIDs en orden estable. Así, guardar un UID sin registro y
registrarlo por primera vez no puede cruzarse invisiblemente. Se conserva el flujo de raras no gestionadas;
esta fase no promete unicidad global, adopción ni saneado de todos los perfiles históricos.
La frontera SQL exige `READ COMMITTED`: otros niveles se rechazan para no leer un snapshot anterior al lock.

## Aceptación y límites

Transferir/reclamar/liberar, repetir tras respuesta perdida, payload cambiado, CAS atrasado, fallo parcial,
dos destinos competidores, snapshot aislado, guardado/importación viejo, respuesta malformada/redacción,
RLS/permisos y reaplicación de SQL. Verificar con PGlite + SDK; no necesita red ni credenciales.

La migración 003 se entrega revisable para aplicar en Supabase; no existe canal SQL administrativo configurado.
No activarla automáticamente ni reiniciar el host. P4 sigue parcial: falta cola/ack de juego, reconciliación
al entrar, política de backfill/collisiones, suelo/expiración durable y catálogo de legendarias. P6 genérico,
leases, regreso por inactividad, cartel y riesgo público tampoco se declaran terminados.
