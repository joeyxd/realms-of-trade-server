# PRG01b2 — Tala compartida y aprendizaje confirmado

2026-10-10. Continuación de [PRG01b1](prg01b1-profile-continuity.md) sobre la
[autoridad de recursos](m5-resource-authority.md). SQL016 aplicada por el autor y verificada con servicio;
Tala activada en el VPS sobre alpha.25, con adopción exacta de recursos v1 a v2. Cooperación 7/3,
beneficiario offline y cadencia 54→45 comprobados mediante cuentas temporales y comandos normales.
Revisión/imagen, recuperación y límites en la [entrega](../delivery/prg01b2-logging.md).

## Resultado jugable

Cada palmera conserva tres golpes. Al concluirla, quien termina recibe dos troncos y sus contribuyentes
reparten diez puntos de Tala según golpes válidos: 7/3 para dos y un golpe; 4/3/3 para tres participantes,
con desempate por UUID. No concede XP general, maestría, tatuajes ni conocimiento de recetas.

El primer hito llega a 60 de práctica. El intervalo entre golpes pasa de 0,9 a 0,75 segundos
(54 a 45 ticks). El golpe que abre el hito conserva su intervalo anterior. Oficios/Trades muestra la
práctica del perfil confirmado en ES/EN. Carpintería y la enseñanza de bodega siguen en PRG01c.

## Una autoridad y un recibo

Se extiende `EconomicAuthority`, `ProfileSessions` y `mn_commit_economic_operation`; no aparece otra
cola, autosave, tabla de recibos ni identidad de operación. Los comandos del cliente conservan su forma.
La cuenta autenticada resuelta por el host identifica a cada contribuyente; los IDs de socket/entidad
no se guardan como propietarios de práctica.

Antes de una conclusión cooperativa, M5 reserva todas las cuentas afectadas y las lanes de perlas
conectadas, detiene el avance del mundo, liquida escrituras pendientes y toma baselines actuales.
Los participantes conectados usan captura del perfil vivo; los desconectados usan la fila actual del
store, nunca una copia guardada cuando dieron su primer golpe. Una reentrada no puede ocupar una
cuenta reservada mientras se confirma su recompensa.

La extensión opcional `beneficiaries` contiene de uno a tres perfiles ordenados por UUID canónico:
`{account,expectedVersion,before,profile}`. Incluye al actor y a cada beneficiario acreditado. Cada perfil
completo respeta 128 KiB; los cambios de los otros participantes se limitan a `progression`.
El actor solo añade los dos troncos y una revisión comercial al terminar; los demás campos se
conservan. Cada cambio de práctica, hito, cadencia y cooldown se comprueba contra su baseline.
SQL bloquea las filas en orden, compara cada versión y baseline y confirma perfiles, nodo, contribuyentes,
reloj y recibo en una transacción. Si falla cualquier baseline, ninguno se instala.

El drain sincrónico aplica el resultado confirmado al mundo y a todas las sesiones conectadas antes
de publicar perfiles y ACK. El ACK no expone UUIDs ajenos. Un timeout consulta el recibo y reintenta
solo la petición exacta; un resultado ambiguo sin resolver bloquea la autoridad. Replay histórico
responde con su recibo y no instala perfiles antiguos sobre progreso posterior.

## Migración de recursos y pausa offline

SQL016 preserva los DTO v1 y sus recibos históricos. Recursos v2 añade `logging`, un mapa por palmera
con `{cycle,contributors:[{actor,hits}]}`. Revisión, ciclo y suma de contribuciones deben concordar.
Los plazos usan el reloj lógico existente y siguen pausándose offline. El checkpoint del reloj
mantiene la ventana de AREA15; una caída puede retroceder tiempo transcurrido aún no guardado.

La adopción mantiene exactamente nodos, revisiones, golpes, plazos y cooldowns. Los ciclos legacy
parciales o agotados sin autoría quedan marcados `null` y terminan sin práctica. Su siguiente ciclo
empieza con autoría nueva. No se inventan autores ni práctica retroactiva; un historial incompatible
falla cerrado y requiere diagnóstico. Guardados ordinarios no pueden borrar el ledger ni volver a v1.

## Montaje y compatibilidad

`loggingOperations` / `MN_LOGGING_OPERATIONS=1` requiere recursos y economía activos, cuentas M5 y
`mn_logging_operations_ready()` de SQL016 antes de crear/admitir un mundo. Está apagado por defecto.
Un mundo que ya adoptó recursos v2 rechaza arrancar con Tala apagada. No usar builds anteriores como
rollback de un mundo adoptado. La composición con perlas/muerte/botín conserva el pendiente de AREA15.

El protocolo 36 de la base publicada se revisa: se conservan comandos, snapshots y `you`; `PROFILE.p`
ya admite el bloque y versión interior 2 de pilotaje. `actionTicks` y el estado de Tala del ACK son
campos adicionales; clientes anteriores mantienen una espera más conservadora. No se cambia la versión
de red por este corte. Se preservan los hitos de pilotaje, conocimiento, progreso de combate y pérdidas
de muerte existentes. El scope sigue siendo cuenta en el único mundo alfa, con aislamiento por
personaje/mundo/época todavía pendiente.

## Reutilización y aceptación

Se reutilizan palmera, hacha, banco, golpes/pose y tarjetas de la ficha existentes. El cruce Unreal de
[PRG01a](prg01a-logging-contract.md) sigue aplicando: este corte no necesita arte/exportaciones nuevos;
las fuentes Unreal permanecen intactas. No añade pesca, domesticación ni nuevas herramientas.

La aceptación incluye cooperación y desconexión, baselines actuales, replay tras progreso posterior,
respuesta perdida, perfiles legacy, cadencia, v1/v2 y permisos SQL, terminación abrupta antes/después
del commit y ficha real con ES/EN en escritorio/móvil emulado. Los fixtures de navegador no prueban
balance, FPS ni sensación en teléfono físico. Ver [entrega](../delivery/prg01b2-logging.md).
