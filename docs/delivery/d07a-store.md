# D07a — M5 P1: base de almacenamiento

Fecha: 2026-10-04. Base `61a34a5`; entrega local P1, parte de D07. M4.8 conserva el candidato
`0.4.8-rc.1`, protocolo 12. P2/P3, servicio remoto y publicación siguen pendientes.
Durante esta misión se integró A02 por separado en `59b5b35`; se conserva como padre del checkpoint M5.
Este informe no vuelve a aceptar el asset ni modifica su consumidor/manifiesto.

## Resultado y contrato

`server/store.mjs` implementa seis métodos asíncronos, con memoria y Supabase como adaptadores:

| Método | Resultado y autoridad |
|---|---|
| `loadProfile(playerId)` | `{data, version}` o `null`; UUID verificado por el host, perfil saneado |
| `saveProfile(playerId, data, expectedVersion)` | CAS; versión 0 crea solo si falta; conflicto no sobrescribe |
| `loadWorld(world)` / `saveWorld(world, data, expectedVersion)` | Snapshot JSON aislado, mismo CAS; hidratación/autosave de economía son P3 |
| `claimUnique(uid, kind, holder)` | Reclama atómicamente; mismo propietario/tipo repite la misma generación; otro propietario o tipo se rechaza |
| `releaseUnique(uid, holder, version)` | Libera solo la generación del propietario; un release atrasado no borra una adquisición posterior |

Las escrituras copian el estado antes del `await`. Perfil y mundo están separados; estos métodos no realizan
una transferencia atómica entre dos perfiles, un objeto caído y un puerto. Esa integración pertenece a P4/P6.
El ledger de perlas que usa el juego continúa en memoria; no se habilitaron legendarias ni cambios navales.

`server/migrations/001_store.sql` crea `mn_profiles`, `mn_worlds` y `mn_unique_items`, con prefijo para evitar
colisiones con tablas existentes. No crea cuentas ni FKs de `auth.users`: P2 debe resolver identidad/importación.
Los RPCs usan `SECURITY INVOKER`, nombres SQL cualificados y `search_path` vacío. RLS está habilitado, sin
políticas de cliente; tablas y funciones se revocan a `PUBLIC`, `anon` y `authenticated`, y se conceden al servicio.
La migración puede reaplicarse sin borrar filas. No se aplicó a una base externa.

## Integración del host

`createGameServer({store, resolvePlayer})` permite conectar el contrato a una identidad verificada por código
del servidor. El callback recibe contexto de origen/dirección y el HELLO; devuelve UUID o `null` para anónimo.
No recibe cabeceras de cookies/Authorization, y ningún `playerId` o `profile` del mensaje decide la propiedad.
P2 debe verificar el token de HELLO; todavía no hay autenticador real ni pantalla de login.

Antes de crear la entidad, el host reserva capacidad y cuenta, carga el perfil y lo sanea. Un segundo HELLO
pendiente no duplica la petición. Otro socket con la misma cuenta es rechazado; la reserva continúa mientras
se termina el guardado de desconexión. Un timeout/cierre invalida el join; terminar una carga tarde no crea
un personaje. Un blob firmado anterior nunca reemplaza el perfil de cuenta; la importación única queda para P2.

`ProfileSessions` serializa y combina snapshots por cuenta. El hook de `LocalServer` usa el ciclo actual de
guardado y sincroniza XP/pociones/checkpoint; al desconectar recoge el último perfil. El cierre del host espera
las escrituras. Conflicto/error cerca la sesión y se reporta un fallo de flush; no recarga y pisa otro estado.
Una cuenta recibe `PROFILE`, sin un `SAVE` HMAC reutilizable como personaje anónimo. El Worker y los anónimos
mantienen su comportamiento de guardado anterior.

Las reservas son **locales a un proceso**. CAS impide sobrescrituras atrasadas, pero no es un lease duradero
entre hosts ni una garantía de que ambos no simulen antes de detectar conflicto. No publicar varias autoridades
ni operaciones económicas en riesgo hasta cerrar P5/P6. Un fallo del backend puede dejar progreso sin guardar:
el cierre lo comunica, y la recuperación/idempotencia durable sigue pendiente.

## Configuración y dependencias

El entrypoint llama a `storeFromEnv`: sin variables selecciona memoria; `SUPABASE_URL` y
`SUPABASE_SERVICE_KEY` deben estar juntas. Una configuración parcial falla, sin fallback silencioso.
Seleccionar Supabase **no activa cuentas**: `npm start` todavía no suministra `resolvePlayer`. `/status`
expone tipo de adaptador, si la ruta de cuentas está habilitada y número de errores; no expone credenciales/UUIDs.

SDK oficial `@supabase/supabase-js` 2.117.2; pruebas SQL con `@electric-sql/pglite` 0.5.8, solo dev.
Cliente de servicio sin persistencia/refresco de Auth ni detección de URL; llamadas con timeout de 10 s.
Errores del proveedor se sustituyen por códigos fijos para evitar volcar credenciales. La clave de servicio
permanece en el servidor, que ya excluye `server/`, tests, paquetes y despliegue de los archivos públicos.
Los nuevos paquetes no entran en el artefacto solo del cliente. `.scratch/` queda ignorado para cache/instalaciones.

Referencias oficiales usadas para revisar el contrato: [RPC JavaScript](https://supabase.com/docs/reference/javascript/rpc),
[funciones y permisos](https://supabase.com/docs/guides/database/functions),
[configuración del cliente](https://supabase.com/docs/reference/javascript/initializing).

## Evidencia local

- `tests/store.test.mjs`: saneado y aislamiento, CAS de perfil/mundo, propietario/generación, respuestas inválidas
  y errores/configuración sin fugas. Ocho casos.
- `tests/store-sql.test.mjs`: ejecuta SQL real en PGlite, roles locales y SDK con fetch inyectado hacia SQL.
  Verifica las seis llamadas, CAS, reejecución conservando datos, argumentos inválidos y denegación de
  SELECT/INSERT/UPDATE y los seis RPCs a ambos roles de cliente. Un caso de integración.
- `tests/store-host.test.mjs`: once casos de ciclo real de `LocalServer`: carga/HELLO, anónimos, duplicados,
  timeout/cierre, aislamiento/orden/final flush, conflicto y protocolo WebSocket entre dos hosts sucesivos.
  Ese reinicio conserva el mismo adaptador de memoria en el proceso de pruebas; no demuestra persistencia en disco.
- Integración dirigida: **30/30** con store/SQL/host y pruebas existentes de servidor y partidas firmadas.
  Log local `shots/review/m5-focused.log`.
- Regresión completa: **296/296 sin la suite net + 2/2 net = 298/298**, Node 24.14.0, concurrencia 2 y
  red aislada. Logs `shots/review/m5-tests.log` y `m5-net.log`, inspeccionados por el principal.
- `npm ci --ignore-scripts --no-audit --no-fund` en `.scratch/m5-clean-verified`: 12 paquetes instalados desde
  el lockfile, SDK importado correctamente. Una primera prueba offline no tenía `ws` en la cache; la instalación
  limpia posterior obtuvo las dependencias desde npm. No se modificó la instalación principal para esa prueba.
- Arranque CLI: sin configuración → `memory`, cuentas desactivadas; configuración completa de prueba →
  `supabase`, cuentas desactivadas; configuración parcial → rechazo de arranque. Dos servidores locales con
  `/status` sin errores; la clave de prueba no es una credencial real y no hubo consultas a Supabase.
  Log `shots/review/m5-cli.log`. Sintaxis y `git diff --check` limpios.

La base embebida tiene una conexión: los casos concurrentes comprueban operaciones programadas y resultados,
sin certificar locking de conexiones independientes. El transporte SQL inyectado no es un PostgREST real.
No hubo cambios visuales, recorrido de GPU ni conexión a un proyecto Supabase. Esta aceptación es del código
local y del contrato ejecutado en la base embebida; la aceptación del servicio remoto continúa pendiente.

## Próxima misión

M5 P2: configuración pública de Auth, verificación de token en el host, UI de login y rechazo explícito;
migración única de partida firmada con recibo durable y resultado al reintentar. Necesita proyecto Supabase
configurado y aceptación real de RLS/RPC/Auth antes de publicarse. Luego P3 conecta economía/autosave;
P4/P6 deben liquidar propietarios/caídas/transferencias duraderamente. D04 puede continuar por separado.
