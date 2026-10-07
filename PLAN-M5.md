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
Checkpoint D09f-2a, base `0e82162`: **reserva común server-only**, compartida por staging, admisión/guardados
de sesiones y ambas familias de la cola. Permiso opaco interno; rechaza saves/commits que saltan una reserva,
invalida close/fail/release y protege publicación previa a apply. **226/226** pertinentes, **42 nuevas**.
[Contrato y evidencia](docs/delivery/d09f-mutation-gate.md).
Checkpoint D09f-2b.1, base `0ec0b9d`: **CAS same-holder de un UID aceptado en aislamiento**. Bag→swallowed
vacío conserva dueño/otros slots/progreso; perfil/ledger/tombstone/recibo juntos, cola con una cuenta y
diario ground existentes. **306/306**, **80 nuevas**, seis procesos independientes de SQL/sesiones.
**006 nueva, pendiente de aplicar/verificar en Supabase**. [Contrato y evidencia](docs/delivery/d09f-same-holder.md).
Checkpoint D09f-2b.2, base `d7398d8`: **staging swallow server-only aceptado en aislamiento**. Helper real
sobre ECS/perfil separados; efecto actual de stats/cooldown/agua aplicado una vez en tick, con progreso
conservado y rollback local/fence. **356/356**, **50 nuevas**, memoria y SDK/SQL006. Sin nueva SQL/env;
006 real sigue pendiente. [Contrato y evidencia](docs/delivery/d09f-swallow-staging.md).
Actualización 2026-10-06: el autor confirma **006 aplicada**; sus validadores y denegación pública
comprobados en Supabase con **6/6 probes de solo lectura**. No se verificó el commit nuevo con un canario
real ni se conectó staging al host. [Alcance de la comprobación](docs/delivery/d09f-sql006-readonly.md).
Aceptación posterior 2026-10-06: **commit same-holder 006 verificado en Supabase, 21/21**. Cuatro procesos
Node de SDK/ProfileSessions: CAS/conservación/rollback/replay, recuperación sin envío y request pendiente
reanudado una vez. Fixtures de juego limpiadas; dos auditorías terminales retenidas. No conecta host/juego
ni implementa afinidad. [Evidencia y límites](docs/delivery/d09f-same-holder-live.md).
Checkpoint D09f-2b.3, fuente `26ef249`: **efecto ECS común extraído**. Sim y staging
usan una regla de G/cooldown/agua/stats; dirty/eventos y draft/rollback mantienen sus dueños.
**745/745** regresión completa en 74 archivos de commit aislado, 68/68 smoke; sin reglas nuevas,
SQL/host/activación ni protocolo nuevo. [Contrato y evidencia](docs/delivery/d09f-common-effect.md).
Checkpoint D09f-2b.4, base `4414665`: **lote atómico de perlas en storage** para muerte
(todas, 1–9 UIDs) y reemplazo (dos UIDs). Perfil CAS/ledger/ubicaciones/recibo únicos;
**481/481** pertinentes aisladas, **125 nuevas**, cuatro procesos Node de lectura/replay.
**007 nueva pendiente de aplicar/verificar real**; no conecta diario/cola/staging ni activa gameplay.
Progreso externo a `pearls` conservado; afinidad runtime pendiente. [Contrato/evidencia](docs/delivery/d09f-pearl-batch.md).
Siguiente: verificar 007 y diario/cola/reservas del lote; [hooks concretos](docs/briefs/m5-pearl-common-gate.md)
con dueño de LocalServer/sim, restauración/reloj/adopción antes de activación. P4/P6 parciales.

Aceptación posterior 2026-10-06: **007 aplicada por el autor y verificada real, 31/31**.
Cuatro procesos SDK/Supabase: muerte de nueve UIDs con generaciones mixtas, reemplazo legacy,
respuesta descartada tras commit/recibo leído sin envío, replay/CAS/conservación de progreso,
recogida posterior y exclusión 003/004/005/permisos. Dos perfiles/trece UIDs sintéticos limpiados;
una auditoría terminal conservada. **7/7** pruebas del runner final aisladas; runtime sin cambios.
[Evidencia y límites](docs/delivery/d09f-pearl-batch-live.md).
Sigue [diario/cola/reservas y recuperación del lote](docs/briefs/m5-pearl-batch-journal.md), luego staging
y hooks/restauración. Afinidad permanente aún pendiente; no activa host/juego ni cierra P4/P6.

Checkpoint D09f-2b.5, base `64b9956`: **diario/cola compartida y recuperación de lote aceptados localmente**.
Una cuenta/todos los UIDs/UUID reservados antes del builder; request exacto persistido antes del RPC,
reconciliación de cada ledger/ubicación y perfil, reanudación explícita sin builder, progreso posterior
conservado sin mezcla parcial de slots. **579/579** pertinentes aisladas en 32 archivos, **91 nuevas**,
doce procesos SDK/SQL008 nuevos; 003–007/staging conservados y 22 fuentes comunes sin cambios.
**008 nueva pendiente de aplicar/verificar en Supabase**. [Contrato/evidencia](docs/delivery/d09f-pearl-batch-journal.md).
Sigue canario real008, luego staging/tick de lote y hooks/restauración. No activa host/juego ni afinidad;
la muerte completa aún necesita resolver sus otros efectos de equipo/oro/mundo. P4/P6 parciales.

Checkpoint D09f-2b.6, base `b2b2b1`: **SQL008 aplicada por el autor y diario/cola batch verificados reales,
18/18** en cuatro procesos nuevos SDK/Supabase. ProfileSessions confirma reemplazo con respuestas
descartadas, recupera el recibo sin dispatch y reanuda una muerte preparada con un solo request exacto.
Todos los UIDs/cuenta reservados; progreso y recogida posterior conservados ante replay histórico.
Dos perfiles/seis UIDs sintéticos limpiados; tres terminales retenidos. **8/8** pruebas del canario
aisladas; cuatro procesos locales nuevos, cuatro fuentes propias y 28 fuentes seleccionadas intactas.
[Contrato/evidencia](docs/delivery/d09f-pearl-batch-journal-live.md). No requiere SQL nueva.
Sigue [staging de reemplazo de dos UIDs](docs/briefs/m5-pearl-batch-staging.md), después hooks/restauración;
host/juego todavía sin conexión durable del lote. Afinidad permanente y P4/P6 siguen pendientes.

Checkpoint D09f-2b.7, base `621dc98`: **staging dormant del reemplazo aceptado en aislamiento**.
Reserva cuenta/ambos UIDs antes del await, reutiliza `swallowPearl` en draft y confirma un solo lote
SQL007/008. `drain()` aplica perfil/ambos ledgers/drop/ECS/eventos juntos, conserva progreso vivo y
asigna el ID local desde el contador actual; fallo local revierte sus escrituras y conserva fence.
**681/681** pertinentes en 36 archivos, **94 nuevas**; contratos memoria/SQL008 y paridad del helper
en los cuatro tipos. Seis fuentes propias y 67 seleccionadas intactas antes/después de la regresión.
[Contrato/evidencia](docs/delivery/d09f-replace-staging.md). Sin SQL/env nueva ni canario live en este corte.
Siguen hooks completos/restauración del host y revisión de la muerte completa (equipo/oro/mundo).
Afinidad permanente aún requiere su propio corte; P4/P6 parciales, sin activación del juego.

Checkpoint D09f-2b.8, base `e1aa918`: **adaptador dormant de reconstrucción de suelo aceptado**.
Barrera global antes de paginar, después de recuperar diario y sin sesiones/operaciones pendientes.
Scan/unique/location/segundo scan validados; reloj explícito del caller. `drain()` instala ledger/drop
sin eventos históricos/RNG/mint y revierte escrituras propias ante fallo, conservando fence.
**758/758** pertinentes, **95 nuevas**; 46 memoria/46 SQL008 y seis procesos frescos
con imágenes SQL. Cuatro runners NodeFS anteriores no repetidos por límite de inicialización local;
hashes/exclusiones detallados. [Contrato/evidencia](docs/delivery/d09f-ground-hydration.md).
Sin SQL/env ni host/activación. Siguen hooks/startup/publicación, scope/reloj/adopción, muerte completa
y afinidad permanente; P4/P6 parciales.

Checkpoint D09f-2b.9, base `0a485e3`: **arranque común dormant aceptado en aislamiento**.
Una barrera desde el primer await del diario hasta drain del suelo, sin hueco de admisión al cambiar
la queue a disponible. Pendiente sin recibo conserva reservas/request exacto y cerca startup; no auto-resume.
Cancelación conserva fence y no instala resultados tardíos. Solo drain síncrono marca ready; reloj puro
explícito y World detenido. **814/814** pertinentes en 38 archivos, **56 nuevas**
(23 memoria/23 SDK-SQL008/10 gate); hashes de siete fuentes propias y 77 seleccionadas intactos.
[Contrato/evidencia](docs/delivery/d09f-pearl-startup.md). Sin SQL/env ni host/activación.
Siguen hooks completos e integración del host con scope/reloj/adopción definidos, muerte completa
y afinidad permanente; P4/P6 parciales.

Checkpoint D09f-2b.10, base `8f5a50a`: **guards de salida/desconexión conectados al host**.
Cuenta trusted y UIDs de inventario/ledger antes de sync/publicar/guardar; busy conserva dirty/scheduling/blob.
Snapshots ECS/ACK continúan sin inventario/UID/recibo. Close invalida antes del detach; final save bloqueado
se retiene solo en memoria, detiene host y falla flush, sin reescribir inventario previo al commit.
**786/786** pertinentes en 60 archivos, **17 nuevas**; staging real manual cubre gap
recibo→apply y cierre con recibo tardío. Fuentes fijadas/hashes comprobados; SQL/procesos durables/live no
repetidos. [Contrato/evidencia](docs/delivery/d09f-pearl-profile-io.md). Sin SQL/env ni activación de comandos.
Siguen hooks de mutación/autónomos, snapshot canónico/apply/startup del host, reloj/scope/adopción,
finalizador durable (último progreso no garantizado en cierre bloqueado), muerte completa y afinidad.
P4/P6 parciales; protocolo 16 conservado.

Checkpoint D09f-2b.11, base `88f8cdd`: **preflight inmediato de comandos conectado al host**.
Player/dev/debug consultan cuenta trusted y UIDs actuales antes de helpers; give incluye receptor.
Mint/RNG/mercado/deck/encuentro consultan todas las reservas de perlas del mundo; cuentas y autosaves
ordinarios siguen disponibles. Busy devuelve aviso privado sin eventos World, dirty/saveAt ni éxito
del helper; no encola reintentos. **809/809** pertinentes en 61 archivos, **23 nuevas**;
182 fuentes comprobadas antes/después. Staging real manual cubre espera de RPC y gap receipt→drain;
comandos válidos de equipo/misión/cofre/mint/caches conservan estado y funcionan al reintentar.
Aviso GameClient→Rewards y capturas aisladas 1280×720/390×844 inspeccionadas (layout, con shim de animación).
[Contrato/evidencia](docs/delivery/d09f-pearl-command-access.md). Sin SQL/env, durabilidad de comandos
ni activación automática. Siguen efectos autónomos, snapshot/apply/startup del host, finalizador durable,
muerte completa, scope/reloj/adopción y afinidad permanente. P4/P6 parciales; protocolo 16 conservado.

Checkpoint D09f-2b.12, base `ac47564`: **barrera conservadora del tick conectada al host**.
Reserva/queue/fence/recovery cierra antes de dequeue, movimiento, combate, loot/RNG y producción;
todo el tick autoritativo espera, incluyendo movimiento. PING/inputs y snapshots actuales continúan,
sin ACK anticipado, flush de eventos/saves ni deuda de catch-up. Cola acotada/carry existentes conservados.
**822/822** pertinentes en 63 archivos, **13 casos nuevos**, 191 hashes fijados; cuatro overlays propios,
trabajo naval/visual paralelo excluido. Controles positivos de pickup/retorno, lote red/parrilla,
death/spill y kill/rewards, staging real manual y gap receipt→drain. [Contrato/evidencia](docs/delivery/d09f-pearl-tick-access.md).
Sin SQL/env/activación durable automática ni cambio de protocolo 16. Siguen captura granular para mover
durante espera, política de inputs tras apply, startup/drain/snapshot canónico del host, finalizador durable,
muerte durable completa, scope/reloj/adopción y afinidad permanente. P4/P6 parciales.

Checkpoint D09f-2b.13, base `9846df4`: **frontera opcional de apply síncrono en LocalServer**.
`beforeTick` progresa antes del permiso/pausa, una vez por entrada exterior pump/step/filler; el filler
interno no redrena. Errores/Promise/reentrada conservan fallo sticky; eventos de apply esperan al tick
admitido incluso ante flush de HELLO/disconnect. Staging/startup reales comprobados con adapters
inyectados, incluido receipt lento y prepared→ready; **855/855, 15 pruebas nuevas**. Regresión aislada
de 66 archivos/197 fuentes, [resultado y límites](docs/delivery/d09f-pearl-tick-apply.md).
GameHost no configura el hook ni activa operaciones durables. Scope/reloj/adopción, epoch de inputs,
montaje del host/snapshot canónico, finalizador y muerte completa/afinidad permanecen abiertos.
Sin SQL/env/protocolo nuevo; P4/P6 parciales.

Checkpoint D09f-2b.14, base `d47353b`: **captura canónica opcional del progreso ECS para staging**.
Baseline separado antes del primer await y recaptura en apply de nivel/XP/pociones/checkpoint;
oro/equipo/maestrías/tatuajes y referencias conservados. Save reservado separado, rollback/fence y
puente de lectura trusted de GameHost; default anterior conservado. **884/884**, 29 checks nuevos
en 15 pruebas superiores, regresión aislada de 67 archivos/199 fuentes.
[Contrato y límites](docs/delivery/d09f-pearl-profile-snapshot.md).
Sin activación automática, SQL/env ni protocolo nuevo. El progreso posterior al recibo usa save CAS
posterior: aún puede perderse antes de completarlo. Montaje del host, scope/reloj/adopción/inputs,
finalizador/muerte completa/afinidad y P4/P6 permanecen pendientes.

Checkpoint D09f-2b.15, base `0379b2e`: **frontera opcional de acciones ya recibidas al cambiar perla**.
Swallow/reemplazo limpian ATTACK/Q/E/R/G en cola/carry/último comando y sus buffers ECS dentro del
apply reversible; movimiento, aim, otros botones, orden/seq/pt/ACK y cooldowns normales conservados.
Solo durante beforeTick; give/default no cambian. Callback/getters/reentrada, rollback, pausa y
lifecycle cubiertos con staging real de memoria y SDK/SQL006/008 local.
**950/950** pertinentes en 73 archivos/219 fuentes aisladas; 33 checks nuevos en 14 pruebas
superiores, más 33 checks navales ya aceptados añadidos a esta regresión.
[Contrato y aceptación](docs/delivery/d09f-pearl-input-boundary.md).
No identifica paquetes antiguos que lleguen después del apply ni rebasa predicción del cliente:
epoch de extremo a extremo sigue pendiente. Sin SQL/env/protocolo nuevo ni activación durable
automática. Montaje/startup/políticas, finalizador/muerte completa/afinidad y P4/P6 siguen abiertos.

Checkpoint D09f-2b.16, base `155390a`: **montaje trusted opcional de staging en GameHost**.
Scope explícito y montaje único antes de attach/admisión/start; captura ECS, inputs y beforeTick propios
del host. Fallo de apply detiene timers/admisión y difiere desconexión hasta terminar rollback. Close
espera tasks de staging sin aplicar, conserva fence y rechaza progreso/contextos sin resolver.
API createGameServer explícita; entrypoint/default siguen sin activación de circulación durable.
**992/992** pertinentes en 78 archivos/226 fuentes aisladas, **21 checks nuevos en 12 pruebas
superiores**, más 21 checks del ensayo naval de pasajeros ya aceptado añadidos a esta regresión.
[Contrato](docs/briefs/m5-pearl-host-mount.md) y [aceptación](docs/delivery/d09f-pearl-host-mount.md).
No agrega diario/startup, SQL/env/protocolo ni afinidad. Recuperación automática/políticas, dispatch
durable/hooks completos, epoch, finalizador y muerte completa siguen pendientes; P4/P6 parciales.

Checkpoint D09f-2b.17, base `14ede6d`: **recuperación de perlas integrada al arranque trusted del host**.
Diario inyectado desde construcción, ID/reloj/piloto solo cuentas explícitos y bots cero. Barrera global
antes del primer await; recuperación/suelo y economía preparadas antes del drain inicial/listener/sim.
Health/upgrade/comandos/perfiles/tick cerrados hasta ready. Primer fallo cancela la otra autoridad;
close espera preparación sin aplicar ni reenviar requests. Invitados firmados/importación no se adoptan.
**1030/1030** pertinentes en 79 archivos/227 fuentes aisladas, **38 checks nuevos en 23 pruebas superiores**.
[Contrato](docs/briefs/m5-pearl-host-startup.md) y [aceptación](docs/delivery/d09f-pearl-host-startup.md).
API explícita; entrypoint/configuración productiva y comandos durables todavía no activados. Sin SQL/env/
protocolo nuevo. Políticas definitivas, dispatch/hooks completos, epoch, finalizador/muerte completa,
afinidad permanente y P4/P6 siguen pendientes; una autoridad por mundo hasta leases.

Checkpoint D09f-2b.18, base `9bf5826`: **solicitudes trusted con generaciones elegidas por el servidor**.
PearlStaging.request recibe solo acción/UID/selectores y consulta loadUnique bajo la misma reserva
síncrona de cuentas/UIDs. Revalida tras IO, refresca progreso antes de save y conserva límite/tasks
hasta apply/fence. Reemplazo usa ambas generaciones independientes; cola y SQL mantienen verificación
y CAS, sin replan al cambiar generación. Métodos trusted anteriores conservados; sin dispatch público.
**1131/1131** pertinentes en 87 archivos/250 fuentes aisladas: **58 checks nuevos en 18 pruebas
superiores**, más 43 checks navales aceptados incorporados a la regresión anterior de 1030.
[Contrato](docs/briefs/m5-pearl-managed-request.md) y [aceptación](docs/delivery/d09f-pearl-managed-request.md).
Sin nueva SQL/env/protocolo ni cambios de host/LocalServer. Dispatch completo/circulación autónoma,
políticas definitivas, epoch/finalizador/muerte completa/afinidad y P4/P6 permanecen pendientes.

Checkpoint D09f-2b.19, base `126a543`: **perla tragada ligada hasta morir y dejar desde bolsa durable**.
Decisión del autor 2026-10-07: no escupir/reemplazar; entradas sim, UI y staging deniegan incluso comandos
viejos confirmados. Nuevas solicitudes give/swallow/leave conservan generación elegida en el servidor,
reserva, CAS, geometría congelada, apply reversible y progreso actual. Recibos/diario batch históricos intactos.
La muerte local pierde EXP y suelta bolsa/perlas en toda zona; equipo/pociones conservan la regla de Cala.
10 % del XP del nivel actual es un default provisional ajustable, sin perder nivel ni maestría; cantidad/balance
por confirmar. Regresión **1151/1151**, 92 archivos y 322 fuentes verificadas; UI desktop/móvil emulado revisada.
[Contrato](docs/briefs/m5-pearl-release-staging.md) y [evidencia/límites](docs/delivery/d09f-pearl-bound-death.md).
Sustituye la creación de reemplazos de .7/.18 y la propuesta spit de .19 anterior, sin reescribir historial SQL.
No activa dispatch durable automático ni muerte atómica completa; estos efectos siguen en el guardado actual.
Siguen pickup/retorno/mint/venta durables, muerte completa, finalizador, políticas/epoch/leases y afinidad.
Sin SQL nueva, env, Supabase real, push, deploy ni reinicio del host del PC; P4/P6 siguen parciales.

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
  Afinidad de perla confirmada: aprendizaje del personaje por tipo, separado del UID y del inventario
  `pearls`. Persiste tras pérdida/death/venta y vuelve a potenciar ese tipo al recuperarlo; no se transmite
  al nuevo dueño. Falta implementarla en perfil/progresión/poderes/UI. [Contrato](docs/briefs/m48-pearl-affinity.md).
- Pedidos/proyectos de ciudad, caravanas y aportes como estado de mundo; una remesa no se acredita dos veces.
- Transferencia entre regiones y reconexión: un solo dueño autoritativo por barco; liquidación de combate,
  rendición y saqueo conserva resultado. Bounty exige fuente y límites de pago antes de activarse.

Esquema físico aún por diseñar: el JSON del perfil y un guardado de mundo cada 60 s no garantizan atomicidad
entre dos dueños. Las operaciones críticas se confirman duraderamente al ocurrir, fuera del bucle de combate.

## 3. Pasos

- [x] **P1 Capa de almacenamiento** (`server/store.mjs`): interfaz `{ loadProfile, saveProfile, loadWorld,
  saveWorld, claimUnique, releaseUnique }`, ampliada por D09a/b con `loadUnique`/`commitPearl`/`loadPearlOperation`
  y por D09c con `commitPearlGround`/`loadPearlLocation`/`listPearlGround`/`loadPearlGroundOperation`;
  D09f-2b.4 suma `commitPearlBatch`/`loadPearlBatchOperation` en storage, sin cola/host, con dos implementaciones:
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
  D09f-1 prueba staging de give fuera del host y D09f-2a añade reserva común de autoridad/cola/guardados;
  D09f-2b.1 agrega bag→swallowed vacío de un UID a la familia ground (006 aplicada; validadores 6/6 y
  commit/recuperación reales 21/21);
  D09f-2b.2 prueba staging swallow/efecto ECS actual en tick; D09f-2b.3 comparte su regla con sim.
  D09f-2b.4 agrega storage de lote muerte/reemplazo (481/481 locales y 007 real 31/31).
  D09f-2b.5 integra diario/cola/reservas y recuperación batch (579/579 aisladas, 12 procesos;
  SQL008 real aceptada después en D09f-2b.6: 18/18 y cuatro procesos).
  D09f-2b.7 agrega staging/tick dormant de reemplazo: 681/681, ambos UIDs/drop/ECS/eventos,
  progreso conservado y rollback local/fence. Staging de muerte completa permanece pendiente.
  D09f-2b.8 agrega reconstrucción dormant del suelo actual: barrera previa a admisión, scan validado
  y drain síncrono con reloj explícito, sin repetir efectos ni mint. Faltan hooks de sim/LocalServer,
  integración de startup y publicación del suelo.
  D09f-2b.9 compone diario/suelo en un arranque dormant con barrera continua, cancelación sticky
  y readiness solo tras drain; no conecta ni habilita el host.
  Legendarias (`PLAN-M4.8.md`), regreso por inactividad y cartel de SE BUSCA siguen pendientes.
  Dirección de contenido confirmada el 2026-10-06: legendarias de cuerpo elemental y perlas de
  transformación animal para después; [familias de poder](docs/briefs/m48-pearl-power-families.md).
  Estas ampliaciones no cambian el orden de cierre de hooks/restauración ni implementan afinidad.
- [ ] **P5 Varias zonas** (cuando haya islas): gateway + un proceso por zona (`DESIGN.md` §16), el perfil viaja
  por la base de datos al cruzar un portal.
- [ ] **P6 Movimientos y recuperación durables.** Transacciones/reintentos y fallos parciales de bienes/barcos;
  desarrollar esta base junto a P1–P3 y antes del PvP económico persistente, aunque conserve el número P6.
  D09a/b acepta una primera operación de perla/perfiles/recibo y su cola de sesión, con SDK/Supabase reales;
  D09c suma el suelo a esa transacción; D09d verifica 004/SDK real y conecta su cola/reconciliación.
  D09e añade diario opcional y recuperación tras restart (005 real verificada); D09f-1 agrega coordinador
  dormant give/commit/apply en tick; D09f-2a comparte reservas con admisión/guardados/commits de sesiones.
  D09f-2b.1 acepta CAS/recibo/cola/diario same-holder de un UID; 006 aplicada, validadores reales 6/6 y
  commit/recuperación de ProfileSessions en cuatro procesos reales 21/21.
  D09f-2b.2 agrega staging swallow y efecto ECS actual en tick, con rollback/fence y progreso conservado;
  D09f-2b.3 extrae la regla común con sim, sin cambios de comportamiento.
  D09f-2b.4 confirma varios UIDs/perfil/suelo en un recibo de storage; SQL007 real 31/31 aceptada.
  D09f-2b.5 acepta recuperación de intención batch en diario/cola con todos los UIDs y reanudación exacta;
  D09f-2b.6 verifica SQL008/cola reales: 18/18 en cuatro procesos.
  D09f-2b.7 acepta staging/tick dormant de reemplazo con dos UIDs y drop: 681/681;
  los otros efectos de la muerte completa requieren integración antes del spill durable.
  No están conectados al host/juego; mundo/barcos siguen separados.
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
