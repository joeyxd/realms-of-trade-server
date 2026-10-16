# D09f-2b.23 — staging dormant de muerte completa

## Objetivo y autoridad

Convertir la captura real de D09f-2b.20 y el recibo/diario/cola de D09f-2b.21–22 en un coordinador server-only que aplique la muerte completa de forma síncrona. Este corte no conecta GameHost, LocalServer ni el combate de la partida.

El autor confirmó el 2026-10-07 que SQL010 corrió sin error en Supabase. Esa confirmación no equivale a un canario independiente; aquí se usa SDK real contra SQL001–010 en PGlite local. No hay migración nueva, lectura de env, reinicio, push ni deploy.

## Reglas conservadas

La perla tragada queda ligada hasta morir. No se abre escupir ni reemplazo. Morir pierde la fracción configurada de EXP del nivel actual, bolsa ordinaria y todas las perlas en cualquier zona. Cala también pierde equipo no starter y pociones, conserva el starter y acredita PK al killer distinto. Nivel, oro, maestría y los otros campos del perfil se conservan. El 10 % de EXP sigue provisional; afinidad permanente, animales y legendarias continúan pendientes.

## Contrato del adaptador trusted

- Construir `new DeathStaging(sessions, world, scope, {limit:64})`; límite entre 1 y 256 y scope idéntico al diario.
- Pedir `request({victim:{clientId,entity},seq,killer?:{clientId,entity}|null})` antes de matar el actor. Devuelve solo UUID pendiente. No recibe account, perfil, regla, versión, generación ni UUID del caller.
- Resolver conexiones/personajes de cuentas actuales; huéspedes/adopción quedan fuera. El killer exterior permanece ligado a la identidad causal, pero su perfil no se escribe ni se reserva porque no recibe PK allí.
- Reservar víctima, killer PK de Cala y todos los UIDs de sus perfiles antes de invocar los helpers. También se conserva la identidad y fila de un killer exterior mientras dura esa causa. La captura usa helpers reales sobre drafts y guarda EXP Float64, perfiles, geometría y fechas desprendidas antes del primer await. Reentrada de request/save/drain durante captura se rechaza aunque un callback trague la excepción.
- Congelar las filas ECS y progresión de los actores ligados mientras la operación espera. Cualquier cambio detectado cancela el apply y mantiene fence. Este corte verifica esa obligación, todavía no instala la congelación en el host.
- Guardar el baseline canónico bajo la reserva y esperar autosaves anteriores de los participantes. Elegir versiones después de esos writes; leer generaciones managed desde storage, validar propiedad y enviar un único DTO exacto a commitDeath. La cola conserva sus verificaciones de ubicación, recibo y diario.
- Usar `save(clientId, snapshot)` para buffer de un baseline idéntico; rechazar progreso distinto. Proteger syncProfile/envío con `assertPublishable(clientId)` y las demás mutaciones con la reserva común.
- Invocar `invalidate(account)` antes de close, muerte externa, respawn, detach/recycle, incluso si luego se restauran las mismas referencias/valores. El fence es sticky; equality final no detecta por sí sola un ciclo transitorio sin invalidación.
- Llamar `drain()` solo en el tick, antes de eventos/snapshots. `settle()` espera IO sin aplicar ni liberar reservas. No existe replay local automático al reconciliar un recibo histórico.

## Apply y fallos

Drain exige la misma sesión, account, perfil, contenedores, columnas, filas ECS, nombres y propiedad de cada UID; también busca ownership huérfana. Exige las versiones y perfiles confirmados completos del recibo y storage idle antes de aplicar.

DeathApply prepara cambios desprendidos, asigna IDs de drop desde el allocator actual y remapea ledger/eventos. Los drops ordinarios llevan identidad durable `operationId + ordinal`; no se usa el ID efímero como identidad de storage. Los campos del perfil, EXP/estado de muerte/poderes, todos los UIDs, drops, dirty marks y eventos se publican juntos. El contenedor y referencias del perfil se mantienen; eventos ya decorados por el draft se copian sin invocar callbacks emit live.

Contenedores de apply deben ser Map/Set/Array normales mutables, sin proxies, subclasses ni mutators sobrescritos. Campos de perfil afectados deben ser data properties writable. Se usan intrinsics para no ejecutar callbacks de mutación dentro del apply. Los checks verifican datos/identidades congeladas de drops, ledgers y publicación. Un fallo posterior restaura solo el apply local tentativo, preserva el recibo SQL y bloquea ambas autoridades. No reintenta efectos locales ni vuelve a abrir los lanes mediante reconcile.

La geometría usa el fork RNG privado existente de deathPlan. Captura y apply no avanzan, reemplazan ni rebobinan el RNG vivo; otros actores pueden consumirlo o asignar drops durante IO. Este contrato de preparación no cierra la política de RNG/epoch/reloj del host ni pretende equivalencia del cursor RNG con ejecutar killPlayer inmediatamente.

## Reutilización verificada

Se cruzó CANDIDATES.csv del inventario Unreal/FAB con InventorySystem y se verificaron sin editar:

- BP_JigServerSave.uasset: 580554 bytes, en ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/InventorySystem/SaveSystem.
- BP_InventoryComponent.uasset: 24878603 bytes, en el mismo InventorySystem/Components.

Son Blueprints Unreal, no ejecutables en el host Node/CAS. Se reutilizan captureDeathPlan, deathOperation, ProfileSessions/PearlQueue, journal SQL010 y la reserva común; no se reimplementan reglas de muerte ni se integra arte. Fuentes Unreal intactas.

## Criterio de aceptación y siguiente entrega

Pruebas con memoria y SDK/SQL001–010: cero/nueve perlas, pérdida exterior/Cala, PK, autosave anterior, EXP sin redondear, generaciones managed, UID unchanged del killer, pérdida de respuesta, cambios/recycle/lifecycle, reentrada, remapeo durante IO, rollback y ausencia de replay histórico. Regresión sobre Git archive fijo + seis overlays propios; no se acepta el checkout compartido completo.

Después: integrar muerte antes del helper local y congelación/publicación/lifecycle en GameHost, restaurar suelo ordinario actual con pickup/expiry durable y respawn, y cerrar políticas/epoch/finalizador. P4/P6 continúan parciales. Afinidad permanente necesita schema, crédito y consumo propios; este corte solo conserva progreso existente.
