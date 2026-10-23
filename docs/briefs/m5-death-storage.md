# D09f-2b.21 — transacción de muerte completa

Base `2af53b8`. Sigue la [preparación de muerte](m5-death-plan.md) y la regla del autor: perla tragada hasta morir, EXP y bolsa perdidas en toda zona; equipo/pociones adicionales en Cala.

## Contrato

`commitDeath` confirma juntos los perfiles CAS de víctima y atacante con PK (si aplica), todas las perlas gestionadas y su suelo, los objetos/pociones perdidos y un recibo exacto. Funciona también con cero perlas y cero drops. `loadDeathOperation` lee el recibo histórico; `listDeathDrops` pagina botín ordinario por mundo, UUID de operación y ordinal.

Los endpoints vienen de la autoridad trusted, ordenados por UUID. Cada perfil contiene `id`, `expectedVersion`, `before` y `data`: versión y JSON anterior deben coincidir completos con la fila persistida. Si el ECS o un guardado están adelantados, devuelve conflicto; la integración futura debe resolver el progreso bajo reserva común antes de preparar el recibo. No superponer silenciosamente un perfil actual sobre otro antiguo.

El delta conserva nivel, oro, maestría, tatuajes, economía, quests y otros campos. Toda muerte vacía bolsa/perlas, descuenta la fracción de EXP capturada y aumenta muertes; Cala además vacía equipo salvo arma starter y pociones. Si se pierde el arma, crea un starter del mismo kit con el siguiente UID. El atacante distinto aumenta exclusivamente PK en Cala. El 10 % sigue siendo provisional ajustable; storage acepta la regla elegida por servidor, no fija el balance.

`rules.xpBefore` conserva la EXP cruda Float64 del ECS porque el perfil anterior ya está redondeado a centésimas. SQL y memoria reproducen el helper real antes de redondear el resultado. No añadir afinidad: su esquema/progresión siguen pendientes. La prueba SQL conserva JSON futuro desconocido al parchear el baseline, pero el SDK mantiene el saneado vigente y rechaza campos aún no admitidos.

Perlas usan el ledger/ubicaciones existentes y sus generaciones independientes, todas liberadas juntas. Objetos/pociones usan identidad persistente `(operationId, ordinal)` (1–35), UUID de víctima y mundo; payloads y geometría ya preparados, sin IDs/entity locales, eventos o RNG guardados como autoridad. Los tiempos `availableAt`/`expiresAt` y `returnAt` son datos explícitos del caller trusted: no define epoch/reloj, expiración o retorno automático.

La migración nueva `009_death_operations.sql` aplica después de 001–008 y no modifica sus archivos/recibos históricos. Reserva el UUID contra todas las familias antiguas y el journal en ambos sentidos, incluso inserts/updates directos de servicio. Los drops deben coincidir exactamente con el request provisional; un recibo sin resultado completo no puede persistir. Invariantes manuales antes del return y diferidas al commit; cualquier fallo revierte todos los perfiles, perlas, drops y recibo. Acceso RLS y RPC exclusivamente service_role, search_path vacío.

## Aceptación y alcance

Pruebas de memoria y PostgreSQL local/PGlite por SDK Supabase: reglas reales, baseline completo, cero/nueve perlas, drops, colisiones, reintentos, respuestas corruptas y fallos parciales. Tres procesos nuevos prueban persistencia local, respuesta perdida y replay sin duplicación. Supabase real y aplicación de SQL009 por el autor pendientes.

Storage está disponible para integrar; este corte no conecta journal/cola, reserva de muerte/respawn, apply síncrono, snapshot/publicación, pickup/consumo, hidratación/expiry al arranque ni hooks de host. `listDeathDrops` conserva todas las filas de creación; no llamarlo estado actual recogible hasta incorporar lifecycle durable. Siguiente slice: diario/cola de muerte con reserva de víctima/PK/UID y recuperación sin repetir efectos, después apply/hidratación. No garantiza todavía muerte durable en la partida activa. Políticas/leases/epoch, finalizador y afinidad siguen abiertos.

## Reutilización Unreal/FAB

Reverificados inventario y fuentes de solo lectura: BP_JigServerSave 580.554 B y BP_InventoryComponent 24.878.603 B de ActionRPGMultiplayerStart. Blueprints no portables a Node/CAS; reutilizamos captureDeathPlan, saneado de perfil/items, DTOs de suelo y los invariantes de perlas. Sin nuevos assets ni modificación de Unreal.
