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
  saveWorld, claimUnique, releaseUnique }` con dos implementaciones: `memory` (tests/host sin DB) y `supabase`
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
- [ ] **P4 Únicos.** Perlas legendarias (`PLAN-M4.8.md`): `claimUnique` al tragar o recoger, `releaseUnique` al
  morir; si el portador no entra en X días, vuelve al mar (tarea programada). Cartel de SE BUSCA con el portador.
- [ ] **P5 Varias zonas** (cuando haya islas): gateway + un proceso por zona (`DESIGN.md` §16), el perfil viaja
  por la base de datos al cruzar un portal.
- [ ] **P6 Movimientos y recuperación durables.** Transacciones/reintentos y fallos parciales de bienes/barcos;
  desarrollar esta base junto a P1–P3 y antes del PvP económico persistente, aunque conserve el número P6.
  Aceptación: restaurar/reconectar/repetir petición no crea oro, mercancías ni módulos adicionales.

## 4. Notas

- Los tests usan `memory`: ninguna prueba necesita red.
- La suite SQL usa PGlite y el SDK con un transporte local; no necesita credenciales ni red externa.
- P1 impide dos autoridades de un perfil dentro del host y rechaza escrituras con versión atrasada. Las
  reservas de sesión todavía no son leases entre procesos; P5 debe resolverlos antes de varias zonas.
- Los métodos de propiedad única aún no sustituyen el ledger de perlas del juego. P4/P6 deben integrar
  operaciones durables de perfiles, suelo y propietarios; no activar legendarias ni riesgo persistente con P1.
- Respaldo diario de la base (Supabase lo hace en los planes de pago; si no, `pg_dump` programado).
