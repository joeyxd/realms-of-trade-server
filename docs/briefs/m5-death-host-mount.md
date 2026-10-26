# D09f-2b.24 — montaje opcional de muerte completa en GameHost

## Objetivo y autoridad

Conectar el coordinador aceptado en D09f-2b.23 al límite síncrono del host, con pausa real del mundo, inputs reversibles, publicación y respawn. Es un montaje trusted explícito antes de admisión. No existe trigger automático en hurtPlayer/killPlayer ni configuración nueva de CLI/env/createGameServer.

Una muerte a mitad de stepWorld puede seguir a cambios de otros actores, comandos consumidos y RNG avanzado. Abortar y repetir ese tick no conserva esos efectos. Este corte acepta solicitudes únicamente entre ticks completos; la continuación de un tick parcial es un contrato posterior necesario para conectar combate automático.

## Ensamblaje y solicitud

1. Construir GameHost con bots:0 y resolvePlayer verificado. Montar mountPearlStaging({scope}) antes de transporte, admission o primer tick.
2. Montar mountDeathStaging({scope,limit?:64}). Exige scope idéntico, owner beforeTick intacto, autoridad vacía y cero bots; limit entre 1 y 256. No admite callbacks del caller. Si existe journal, mantener también el startup accounts-only y mapClock explícito ya requeridos por el host.
3. Código interno confiable llama requestDeath({victim:{clientId,entity},seq,killer?:{clientId,entity}|null}) entre ticks. LocalServer.assertTickIdle rechaza durante check/apply/step sin envenenar el tick por esa petición rechazada. La API exige client.serverProfile y conexión/personaje coincidentes; DeathStaging resuelve la cuenta y los datos actuales. No admite perfiles, cuentas, versiones, reglas ni UUIDs suministrados por caller.
4. El caller confiable decide cuándo corresponde morir. La API puede matar un actor vivo con HP positivo; no es una prueba de daño fatal y no se expone por red. El handle significa pendiente.

El mismo gate de cuenta/UID retiene la reserva hasta apply/fence. TickAccess pausa el mundo entero mientras espera IO; beforeTick puede drenar aun durante pausa ordinaria. Heartbeats muestran el estado anterior y el ACK de comandos realmente aplicados; no envían éxito, perfil o save anticipados. No acumula deuda de simulación por latencia.

## Aplicación, inputs y respawn

El drain combinado procesa muerte antes de perlas y mantiene el guard de teardown durante ambos. Solo aplica tras receipt y versiones confirmadas, identidad/baseline intactos y storage idle. El efecto de muerte mantiene las reglas reales; el nuevo efecto de inputs se prepara sin escribir antes de ambos applies y corre después del marcador muerto.

La cola existente y last conservan seq, pt y aim, pero mx/mz/btn/prs/w quedan en cero; carry se vacía. ACK, lastPt, fillPt y starve no se adelantan ni se alteran por la transacción. Los comandos neutrales se consumen en ticks normales posteriores. No se reconocen por recibirlos o neutralizarlos. Las comprobaciones posteriores aceptan dead=1 y verifican conexión, perfil, cola, referencias y contadores.

No se agregan cambios ECS fuera del plan capturado: killPlayer limpia ataque/pendientes/dash; el dead branch real cancela cast y decrece los action buffers durante la cuenta regresiva. Efectos de combate ya comprometidos mantienen su política actual. El respawn usa el helper existente, sin repetir pérdidas ni crédito PK. Se verifica ausencia de acciones buffered al reaparecer.

prepareInputs es un adaptador opcional de DeathStaging, instalado por el host. Sus métodos deben ser data properties síncronas con retorno undefined. Promesas, accessors, métodos incompletos y reentrada request/save/drain/endpoint durante el callback cercan el apply. No abre autoridad a mensajes ni a callbacks suministrados en mount/request.

Fallo de apply/publicación revierte primero los inputs propios y después muerte/perfiles/ECS/drop/ledger/eventos propios. Nunca revierte SQL confirmado. Sessions.fail durante el drain detiene admisión/timers, pero sockets se cierran después de que termine rollback. El cierre invalida/desconecta y espera ambos settle, sin aplicar durante shutdown; operaciones pendientes y snapshots bloqueados hacen fallar flush. El fence conserva evidencia y no autoriza replay local histórico.

## Reglas y límites

Perla ligada hasta morir; EXP configurada del nivel actual, bolsa y todas las perlas perdidas globalmente; Cala agrega equipo no starter/pociones y PK al killer distinto. Oro, nivel y maestría permanecen. 10 % EXP sigue provisional. Afinidad permanente conserva la dirección acordada, pero schema/crédito/consumo todavía pendientes. Animales y legendarias después.

SQL010 fue confirmada aplicada por el autor; no es canario Supabase independiente. No se cambia SQL ni se leen credenciales. Reloj/offline ageing, leases/finalizador, RNG definitivo, suelo ordinario actual durable (hidratación/pickup/consumo/expiry) y rebuild tras fence siguen abiertos. listDeathDrops es creación histórica. P4/P6 parciales, sin afirmación de deploy listo.

## Reutilización y verificación

Se cruzó el inventario Unreal/FAB y se reverificaron BP_JigServerSave.uasset (580554 B) y BP_InventoryComponent.uasset (24878603 B) en ActionRPGMultiplayerStart. Blueprints no ejecutables en Node/CAS; se reutilizan coordinador, gate, sessions, LocalServer.beforeTick, input boundary y helpers de muerte/respawn. Fuentes Unreal intactas.

Aceptación: host real con sockets de prueba, memoria y SDK/SQL001–010 local; hold de mundo/ACK/eventos, apply aun pausado, pérdida completa, PK, respawn, no stale swing/cast, journal compartido, cierre lento y rollback antes del detach, reentrada de tick, guest/wire rejection y montaje estricto. Regresión sobre Git archive fijo + overlays propios, con hashes antes/después; no acepta todo el checkout paralelo.
