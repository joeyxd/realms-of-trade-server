# PLAN M5 — «Mundo persistente»

Orden de ejecución y aceptación: [PLAN-DELIVERY.md](PLAN-DELIVERY.md), D07/D09; base antes de riesgo persistente.

> Hoy cada partida va **firmada en el navegador** del jugador y el mundo (mercados, solares) dura lo que la sesión.
> M5 lo pasa a una base de datos en el servidor: cuentas, personajes, inventario, economía, y lo que necesita ser
> único (perlas legendarias, solares) sin duplicados.

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

- [ ] **P1 Capa de almacenamiento** (`server/store.mjs`): interfaz `{ loadProfile, saveProfile, loadWorld,
  saveWorld, claimUnique, releaseUnique }` con dos implementaciones: `memory` (tests, solo) y `supabase`
  (`@supabase/supabase-js`). `GameHost` usa la interfaz; sin variables de Supabase, la de hoy (partidas firmadas).
- [ ] **P2 Cuentas.** Inicio de sesión en el título (Supabase Auth en el cliente), el token en el `hello`; el
  servidor lo verifica y carga el perfil. Migración: un jugador con partida firmada la sube una vez.
- [ ] **P3 Economía persistente.** `world_state` cada 60 s y al apagar; al arrancar, `Economy.from()`.
- [ ] **P4 Únicos.** Perlas legendarias (`PLAN-M4.8.md`): `claimUnique` al tragar o recoger, `releaseUnique` al
  morir; si el portador no entra en X días, vuelve al mar (tarea programada). Cartel de SE BUSCA con el portador.
- [ ] **P5 Varias zonas** (cuando haya islas): gateway + un proceso por zona (`DESIGN.md` §16), el perfil viaja
  por la base de datos al cruzar un portal.
- [ ] **P6 Movimientos y recuperación durables.** Transacciones/reintentos y fallos parciales de bienes/barcos;
  desarrollar esta base junto a P1–P3 y antes del PvP económico persistente, aunque conserve el número P6.
  Aceptación: restaurar/reconectar/repetir petición no crea oro, mercancías ni módulos adicionales.

## 4. Notas

- Los tests usan `memory`: ninguna prueba necesita red.
- Respaldo diario de la base (Supabase lo hace en los planes de pago; si no, `pg_dump` programado).
