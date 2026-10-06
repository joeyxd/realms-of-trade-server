# PLAN M5 — «Mundo persistente»

Orden de ejecución y aceptación: [PLAN-DELIVERY.md](PLAN-DELIVERY.md), D07/D09; base antes de riesgo persistente.

> Punto de partida: cada partida iba **firmada en el navegador** del jugador y el mundo (mercados, solares) duraba lo que la sesión.
> M5 lo pasa a una base de datos en el servidor: cuentas, personajes, inventario, economía, y lo que necesita ser
> único (perlas legendarias, solares) sin duplicados.

Checkpoint D07a, base `61a34a5`: **P1 implementado y probado localmente**. Memoria, adaptador Supabase,
migración SQL y ciclo de perfiles del host. [Evidencia y contrato](docs/delivery/d07a-store.md).
Checkpoint D07b, base inicial `da757d3`, integrado sobre `a01294c`: **P2 cuentas e importación aceptados
localmente**. Credenciales configuradas y API real consultada; al cerrar D07b aún faltaban migraciones y P3.
[Contrato y evidencia](docs/delivery/d07b-accounts.md); D07c/D07d actualizan ese checkpoint debajo.
Checkpoint D07c: acceso de cómic, registro/confirmación y selector de cinco aspectos implementados.
Migraciones aplicadas; Auth, permisos y perfil tras reiniciar comprobados con un canario real aislado.
Correo humano y economía P3 pendientes. [UI y pruebas](docs/delivery/d07c-comic-account.md).
Checkpoint D07d: **P3 economía persistente implementada**: carga antes de escuchar, snapshots CAS cada 60 s
y al cerrar, reloj/RNG/mercados/solares restaurados. Mundo temporal real reiniciado y conflicto CAS comprobados.
[Contrato, evidencia y límites](docs/delivery/d07d-world.md). Correo humano, publicación y P4–P6 pendientes.
Checkpoint D09a, base `6402462`: **base atómica de propiedad de perlas aceptada localmente**. `commitPearl`
confirma perfiles, ledger y recibo juntos; reintentos, CAS y guardados/importaciones contradictorios protegidos.
SQL 003 estaba pendiente al aceptar ese corte; el juego aún usa su circulación actual. [Contrato y límites](docs/delivery/d09a-pearl-operations.md).
Checkpoint D09b, integrado sobre `15bfb44`: **003 aplicada por el autor y verificada en Supabase**. Cola de
sesiones para operaciones/guardados, recibos ambiguos y validación de UIDs registrados antes de entrar.
Canarios reales temporales limpiados; falta staging/ack del juego, suelo durable y adopción de raras.
[Contrato y evidencia](docs/delivery/d09b-pearl-sessions.md). P4/P6 siguen parciales.
Checkpoint D09c, integrado sobre `991db89`: **ubicación durable de perlas aceptada localmente**. Una operación
confirma perfiles, ledger, posición/relojes de suelo y recibos juntos; también cubre mint/relocación sin cuentas.
Al aceptar D09c, SQL **004 nueva, pendiente de aplicar/verificar en Supabase**. No conectaba cola ni juego.
[Contrato y evidencia](docs/delivery/d09c-pearl-ground.md). P4/P6 siguen parciales.
Checkpoint D09d, base `018a177`: **004 aplicada por el autor y verificada en Supabase**. Cola de suelo comparte
reservas con la familia anterior, confirma snapshots y compara perfiles/ledger/ubicación al recuperar recibos.
Canarios SDK/cola reales limpiados; contexto de intenciones aún en memoria, diario tras restart y staging del
juego pendientes. [Contrato y evidencia](docs/delivery/d09d-pearl-ground-queue.md). P4/P6 siguen parciales.
Checkpoint D09e, base `c6bc368`: **diario opcional de request/UUID y recuperación tras restart aceptados
localmente**. Recarga reservas antes de admitir, compara recibos/estado actuales y permite reanudar el
request persistido sin builder nuevo. **SQL 005 aplicada/verificada real**: 21/21 checks y recuperación
de ProfileSessions en procesos independientes; cuatro auditorías terminales retenidas, fixtures de juego
limpiadas. Host/juego aún sin conexión. [Verificación](docs/delivery/d09e-journal-live.md).
[Contrato y evidencia](docs/delivery/d09e-pearl-journal.md). P4/P6 siguen parciales.
Checkpoint D09f-1, base `1b5c2fa`: **coordinador de staging dormant aceptado en aislamiento**, entrega de
un UID gestionado entre cuentas. Reutiliza elegibilidad actual en una vista separada; reserva hasta apply
en tick/fence, conserva progreso y no publica éxito anticipado. **184/184** pruebas pertinentes, incluidas
38 nuevas; host/LocalServer sin conexión. [Contrato y siguiente corte](docs/delivery/d09f-pearl-staging.md).
Siguiente D09f-2: diseñar/conectar una reserva común para comandos, snapshots y lifecycle con el dueño
D06b; resolver CAS same-holder/lotes de varios UIDs antes de activación. P4/P6 siguen parciales.

## 1. Decisión: Supabase (propuesta del autor)

- **Postgres** para todo lo persistente, **Auth** para las cuentas (correo / Google / Discord), **Realtime** para
  chat y presencia (en lugar de Redis), **Storage** si hace falta.
- **Solo el servidor de juego escribe** en las tablas del juego, con la clave de servicio (variable
  `SUPABASE_SERVICE_KEY` en `/etc/marea-negra.env`, nunca en el cliente). El cliente usa la clave pública solo para
  iniciar sesión y leer lo público (ranking, carteles de SE BUSCA) con reglas RLS.
- El combate y la simulación siguen en nuestros procesos Node (60 Hz). La base de datos no está en el bucle: se
  carga al entrar, se guarda cada N segundos y al salir.

## 2. Esquema inicial

| Tabla | Columnas | Notas |
|---|---|---|
| `players` | `id` (= auth.users.id), `name`, `created_at`, `last_seen` | |
| `profiles` | `player_id`, `data jsonb` (el perfil de hoy: `sanitizeProfile` sigue siendo la puerta), `updated_at`, `version` | Bloqueo optimista por `version` |
| `world_state` | `world` (id del servidor / zona), `economy jsonb` (`Economy.serialize()`), `updated_at` | Uno por mundo |
| `unique_items` | `uid`, `kind` (perla legendaria…), `holder` (player_id / null), `since`, `last_seen_holder` | La fuente de verdad de lo único |
| `events_log` | `at`, `player_id`, `type`, `data jsonb` | Auditoría: comercio grande, muertes con perla, construcciones |

### Ampliación de contratos para el mundo naval (2026-10-04; diseño pendiente de implementación)

La dirección del autor está en `docs/NAVAL-ROADMAP.md`. Además del autosave, M5 debe resolver transacciones
de riesgo antes de una economía naval pública persistente:

- Identidad/propiedad única de barco y piezas; plano separado del daño operativo y ubicación/instancia.
- Depósito local de puerto y movimientos de bienes entre puerto, bodega, expulsado, saqueado y entregado.
  Recibos idempotentes por operación/lote; no hace falta un UID por unidad de materia prima.
- Reparación/recuperación: coste + retiro de instancia anterior + activación reparada, sin copias en pecio.
- Skills de navegación/comercio/oficios, afinidad por poder y notoriedad con defaults, migración y saneado.
- Pedidos/proyectos de ciudad, caravanas y aportes como estado de mundo; una remesa no se acredita dos veces.
- Transferencia entre regiones y reconexión: un solo dueño autoritativo por barco; liquidación de combate,
  rendición y saqueo conserva resultado. Bounty exige fuente y límites de pago antes de activarse.

Esquema físico aún por diseñar: el JSON del perfil y un guardado de mundo cada 60 s no garantizan atomicidad
entre dos dueños. Las operaciones críticas se confirman duraderamente al ocurrir, fuera del bucle de combate.

## 3. Pasos

- [x] **P1 Capa de almacenamiento** (`server/store.mjs`): interfaz `{ loadProfile, saveProfile, loadWorld,
  saveWorld, claimUnique, releaseUnique }`, ampliada por D09a/b con `loadUnique`/`commitPearl`/`loadPearlOperation`
  y por D09c con `commitPearlGround`/`loadPearlLocation`/`listPearlGround`/`loadPearlGroundOperation`, con dos implementaciones:
  `memory` (tests/host sin DB) y `supabase`
  (`@supabase/supabase-js`). `GameHost` usa la interfaz mediante un verificador de identidad inyectado por el
  servidor. Sin verificador, sigue el flujo anónimo firmado; el Worker solo conserva su flujo actual.
  `storeFromEnv` selecciona memoria sin credenciales y rechaza configuración incompleta. El entrypoint lo usa,
  y habilita cuentas al añadir la clave pública P2. Migración `server/migrations/001_store.sql` probada con
  PostgreSQL embebido; proyecto real/PostgREST y concurrencia de conexiones independientes por verificar.
- [x] **P2 Cuentas (local).** Inicio de sesión en el título (Supabase Auth en el cliente), el token en el `hello`; el
  servidor lo verifica y carga el perfil. Implementación local: correo/contraseña, registro con confirmación,
  sesión renovable y cierre local, cliente Auth separado del servicio, configuración pública y rechazos
  explícitos. Importación voluntaria de una partida firmada con `pirateId`, RPC atómica `002_accounts.sql` y
  recibo único entre versiones; cuenta existente prevalece e invitado importado queda retirado. D07b aceptado
  localmente. Google/Discord, recuperación de contraseña y aceptación del proyecto real pendientes.
- [x] **P3 Economía persistente.** `mn_worlds` cada 60 s y al apagar; carga antes de abrir el listener y
  arrancar la simulación mediante `Economy.from()`. `WORLD_ID` estable, CAS serializado/coalescido, snapshot
  económico v2 con RNG, tendencia de mercados y solares. Fallos de carga no fabrican un reemplazo; conflictos
  o errores de escritura detienen ese host y dejan health 503. Memoria no sobrevive al proceso; Supabase sí.
  No hay avance offline ni transacción atómica entre mundo/perfil; un proceso por ID hasta P5/P6. [D07d](docs/delivery/d07d-world.md).
- [ ] **P4 Únicos — base D09a/b/c de almacenamiento, sesión y suelo.** `commitPearl` mueve una perla de UID conocido junto
  con los snapshots CAS de sus cuentas y un recibo idempotente. Ledger `kind=pearl:<kind>`; guardados/importaciones
  no pueden contradecir un UID gestionado. `claimUnique`/`releaseUnique` independientes quedan para otros tipos.
  Migración 003 aplicada/verificada. `ProfileSessions.commitPearl` reserva cuentas/UID, ordena CAS y rebasa
  snapshots posteriores; valida al entrar los UIDs registrados. Falta conectar staging/ack del juego y
  definir adopción/backfill de perlas raras existentes, colisiones e invitados. D09c agrega posición durable
  con la misma generación del UID, tombstone al estar en perfil y listado por mundo/UID; SQL 004 real verificada.
  D09d amplía cola/reconciliación a ubicación, incluyendo mint/relocación sin cuentas.
  D09e añade diario opcional de intenciones/UUIDs tras restart (005 real verificada) y recuperación de reservas;
  D09f-1 prueba staging de give fuera del host; falta integración común y restauración/publicación del suelo.
  Legendarias (`PLAN-M4.8.md`),
  regreso por inactividad y cartel de SE BUSCA siguen pendientes.
- [ ] **P5 Varias zonas** (cuando haya islas): gateway + un proceso por zona (`DESIGN.md` §16), el perfil viaja
  por la base de datos al cruzar un portal.
- [ ] **P6 Movimientos y recuperación durables.** Transacciones/reintentos y fallos parciales de bienes/barcos;
  desarrollar esta base junto a P1–P3 y antes del PvP económico persistente, aunque conserve el número P6.
  D09a/b acepta una primera operación de perla/perfiles/recibo y su cola de sesión, con SDK/Supabase reales;
  D09c suma el suelo a esa transacción; D09d verifica 004/SDK real y conecta su cola/reconciliación.
  D09e añade diario opcional y recuperación tras restart (005 real verificada); D09f-1 agrega coordinador
  dormant give/commit/apply en tick. No están conectados al host/juego; mundo/barcos siguen separados.
  Aceptación: restaurar/reconectar/repetir petición no crea oro, mercancías ni módulos adicionales.

## 4. Notas

- Los tests usan `memory`: ninguna prueba necesita red.
- La suite SQL usa PGlite y el SDK con un transporte local; no necesita credenciales ni red externa.
- D09c conserva coordenadas y tiempos enteros `availableAt`/`returnAt`; storage no decide precio, reloj de juego,
  expiración offline ni ubicación navegable. Un UID registrado 003 y validado en su dueño empieza a guardar ubicación
  al moverse legítimamente; no adopta UIDs ausentes ni recupera un holder:null sin posición conocida.
  Recibos 003/004 comparten exclusión por UUID. Un replay entrega el resultado histórico sin revertir una ubicación
  posterior; el caller debe comparar versiones antes de publicar. Todas las lecturas/escrituras son service-only.
- D09b/d comprobó RPC/RLS y operaciones del SDK en el proyecto configurado con UUIDs temporales exactos,
  limpieza verificada y sin consultar jugadores existentes. Contendientes HTTP reales no prueban un
  solapamiento forzado de backends PostgreSQL independientes; leases siguen pendientes.
- Si ambas respuestas de perla quedan ambiguas y no aparece el recibo, la cola reserva UID/cuentas incluso
  tras close. `reconcilePearl` lee recibo/perfiles/UID y `reconcilePearlGround` agrega ubicación; no envían
  otra mutación ni cruzan familias de recibo. Errores de flush permanecen contabilizados durante esa instancia,
  también los de operaciones sin cuentas y después de reconciliar. Sin diario, reservas en memoria; D09e
  permite reconstruirlas con scope estable antes de abrir cuentas/aceptar operaciones. No es lease entre hosts.
- P1 impide dos autoridades de un perfil dentro del host y rechaza escrituras con versión atrasada. Las
  reservas de sesión todavía no son leases entre procesos; P5 debe resolverlos antes de varias zonas.
- Los métodos de propiedad única aún no sustituyen el ledger de perlas del juego. P4/P6 deben integrar
  la nueva operación durable con perfiles, suelo y propietarios; no activar legendarias ni riesgo persistente
  con esta base sola. Los UIDs raros sin registro gestionado conservan el flujo previo; no se reclama unicidad
  global ni adopción de esos registros. PGlite no acredita concurrencia entre conexiones independientes reales.
- Respaldo diario de la base (Supabase lo hace en los planes de pago; si no, `pg_dump` programado).
