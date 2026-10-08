# D09f-2b.25 — combate fatal automático con frontera de publicación

## Objetivo y reutilización

Conectar golpes fatales reales a la muerte completa durable aceptada, conservando cada tick una sola vez.
Reutilizar DeathStaging, DeathPlan/DeathApply, input boundary, journal/queue, gate y helpers de muerte/respawn.
Se contrastó el inventario Unreal/FAB: InventorySystem/SaveSystem sirve como referencia de flujo, pero
BP_JigServerSave.uasset (580554 bytes) y BP_InventoryComponent.uasset (24878603 bytes) son Blueprints,
no adaptadores ejecutables para Node/CAS. Fuentes comprobadas en C:\Unreal, solo lectura; no se portó arte.

Montaje opcional explícito antes de admisión: mountPearlStaging({scope}), mountDeathStaging({scope}),
mountCombatDeaths(). El último no acepta argumentos/callbacks; exige autoridad vacía, cero bots, owners
intactos y ningún tick/prepare/transporte previo. Requiere cuentas verificadas; rechaza resolución guest.
Si existe journal, conserva startup accounts-only/mapClock requeridos. Ningún entrypoint/CLI/env lo activa
por defecto. No cambia snapshots ni protocolo, ni introduce schema de perfil/SQL nueva.

## Tick terminal y publicación

killPlayer consulta el hook síncrono antes de reset, pérdida, evento death o spill. Solo durante un tick completo
de LocalServer; hurtPlayer, hurtByPlayer y maldición de agua confluyen en esa ruta. El adapter enlaza cliente,
sesión, cuenta, entidad y referencias actuales; retiene primera secuencia/killer, y escribe solo dead=1
provisional. Un segundo golpe no vuelve a matar ese actor. El dead branch impide respawn/cuenta regresiva
para esos marcadores; los efectos ya comprometidos conservan su política existente.

Terminan una vez los comandos admitidos y todos los sistemas de stepWorld. La captura síncrona afterTick
ocurre después del incremento de world.tick y antes de eventos, snapshots, perfiles o saves.
Se verifican todos los participantes y se normalizan únicamente los marcadores propios a dead=0.
Se captura el estado del tick COMPLETO: XP adicional ganado en ese mismo tick, coordenadas finales,
RNG y reloj de drops de esa frontera. No se vuelve a ejecutar daño/comando/tick ni se rebobina el mundo.

El ACK avanza únicamente por comandos que sí ejecutaron durante ese tick. El tick terminal retiene también
los eventos de daño previos; ni heartbeat de snapshots ni publicación directa puede mostrar el estado
normalizado provisional. PING/PONG y recepción de inputs continúan. Los inputs nuevos esperan; acciones,
perfil/save, admisión y tick siguiente quedan bloqueados globalmente. No acumula deuda de catch-up.
applyFiller standalone se rechaza antes de tocar estado; el filler interno sigue dentro del tick completo.

Política explícita de eventos: primero los eventos retenidos del tick terminal completo, después death/spill
de los recibos en orden fatal, después eventos del próximo tick admitido. No se promete la intercalación
histórica inmediata de death entre eventos del mismo tick. Solo la siguiente publicación admitida vacía
el buffer, una vez. Respawn/cuenta regresiva empiezan tras apply, usando helpers normales.

## Varias muertes y baselines

Los incidentes del mismo tick se ordenan por llamada fatal. Se confirma/aplica un recibo de muerte completa
a la vez. advance exige el resultado exacto operationId/state=applied, nunca ausencia de una reserva.
El siguiente plan se captura desde las versiones y PK/death confirmados por el anterior: dos víctimas con
el mismo killer no compiten por la misma versión. Un killer causal ya muerto puede recibir PK por un efecto
comprometido anterior; víctima de cada operación sigue requiriendo dead=0 antes de aplicar.

Cada participante conserva identidad y baseline exacto de ECS/perfil/propiedad durante la espera, aunque
todavía no tenga su reserva individual. Antes de drain se comprueban todas las filas. Tras apply, la continuación comprueba de forma independiente perfiles/columnas exactos esperados; solo la
víctima validada y el perfil PK validado del killer pueden cambiar; ECS/propiedad del killer permanecen exactos.
El indicador global de cola evita una ventana de simulación/publicación entre release y la nueva reserva.
La reserva cuenta/UID de DeathStaging continúa hasta apply/fence y comparte el gate existente.

Esta cola NO es una transacción de todas las muertes del tick. Un prefijo confirmado queda durable si el
siguiente recibo falla. Se bloquea/cierra el host y se retiene evidencia de lo restante; no se repite ese
prefijo ni se acepta una captura nueva del tick histórico. No hay promesa de durabilidad atómica de todo
el mundo/tick ni lease entre hosts.

## Fallos y cierre

Un error parcial de comando/stepWorld nunca captura ni repite el tick. afterTick(false) marca fallo sticky,
retiene publicación y detiene el host con teardown diferido. Hooks Promise, resultados malformados,
reentrada o owner reemplazado tampoco pueden abrir simulación. Fallo SQL/receipt/apply o cambio de baseline
cierra con fence, sin éxito anticipado. Desconectar un participante invalida la cola antes de mutar/despawn.
Un join ya pendiente revisa el hold otra vez antes de spawn.

close espera IO actual de staging y guardados, sin drain/apply de muerte. Cola pendiente/fallida o snapshots
finales retenidos hacen rechazar flush. No se resetean marcadores/cola como una supuesta recuperación.

## Reglas conservadas y aceptación

Pérdida de XP de nivel actual configurable, sin perder nivel; bolsa normal y todas las perlas caen globalmente.
Cala añade equipo no starter y pociones. Oro, maestría y demás progreso quedan conservados. Perla swallowed
ligada hasta muerte: no expel/replacement gameplay. Afinidad permanente, crédito/escalado elemental adicional,
adopción guest, clocks offline, pickup/expiry durable y restauración de drops comunes siguen pendientes.

Pruebas: comandos/golpes reales, maldición Brasa/agua, marker sin respawn ni publicación, tick/RNG/ACK una vez,
memory y SDK sobre SQL001–010 local, dos víctimas/killer compartido, killer muerto, XP del tick completo,
recibo posterior rechazado, partial tick, close/detach/cambio de actor, join en curso y hooks no síncronos.
Regresión fija completa en artefacto aislado; aceptar solo hashes correspondientes a fuentes ejecutadas.
SQL010 aplicada según confirmación del autor; este corte no es canario live, deploy ni playtest humano/WAN.
