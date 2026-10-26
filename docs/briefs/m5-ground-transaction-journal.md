# AREA15 — diario del sobre y recuperación al arrancar

2026-10-10. Extiende [SQL018](m5-ground-transactions.md); integración opt-in de la sesión detenida.

## Resultado y autoridad

SQL019 guarda el UUID y la petición completa de SQL018 **antes** de enviar el efecto. Dueño: M5,
scope: `request.world`; una intención pendiente por mundo. No es otro autosave ni una segunda
autoridad de gameplay. No añade campos de perfil, valores de supervivencia o cambios de protocolo.

`createSupabaseGroundTransactionJournal(client, worldId)` ofrece `check`, `prepare({operationId,request})`,
`load(operationId)` y `list({afterId,limit})`. El DTO público exacto es
`{operationId,request,state,result}`. `pending` lleva `result:null`; los terminales son `committed`,
`conflict` y `rejected`, con el resultado canónico no replay del RPC. UUID/request no se modifican.
La preparación no concede bienes ni equivale a un ACK confirmado del juego.

## SQL y namespace

Aplicar SQL001–019 en orden. SQL017 conserva el presupuesto de agentes; SQL018 conserva su contrato
y capability v1. SQL019 añade `mn_ground_transaction_journal_ready` v1, prepare/load/list y envuelve
el commit existente. Su implementación anterior queda privada, sin EXECUTE para `service_role`.
El commit sin intención sigue siendo compatible con SQL018, sujeto a las reservas del diario.

Preparación y commit toman los UUID exterior/reloj en orden. Una intención reserva su UUID exterior
y, si avanza el reloj, el UUID nuevo del reloj. Los recibos legacy no pueden consumirlos por otro
camino. Al mismo tick, varias operaciones pueden referenciar el recibo vigente verificado; esto no
reserva otra vez el reloj ni incrementa su versión. Una intención no adopta recibos ya confirmados.
Los tombstones terminales conservan sus identidades y resultados para respuestas tardías.

El commit pasa provisionalmente por `committing`, ejecuta SQL018 y cierra la intención **en la misma
transacción** que perfiles, UIDs, mundo, reloj y recibos. `committing` no es un estado durable que deba
recuperarse. Un fallo al finalizar revierte también los efectos; queda `pending`. Un rechazo SQL018
no tiene efecto y termina en `conflict` o `rejected`, liberando la plaza pendiente del mundo.
Solo el servicio puede invocar los RPC públicos; tablas sin DML directo y funciones internas sin EXECUTE.

La intención no es un lease ni reserva versiones de perfiles/mundo frente a otros writers. Un cambio
externo puede provocar conflicto CAS terminal. El montaje futuro debe detener su autoridad durante
preparación/commit/drain. Este corte no acredita concurrencia de varios procesos PostgreSQL.

## Sesión y recuperación

`new GroundTransactionSession({store,worldId,journal})` exige un diario durable del mismo scope.
Sin `journal`, conserva la API SQL018 anterior. Con él, `load(localTick)` resuelve la intención pendiente
con el **mismo UUID y petición**, verifica resultado final y recibo, y después carga reloj/mundo actuales.
No instala perfiles ni snapshots históricos desde un recibo; no emite eventos ni ACK de recuperación.
La época solo se adopta en `drain` síncrono detenido. Continúa la pausa offline aprobada.

`begin` observa la intención durable antes del envío. Una respuesta perdida de prepare se comprueba
por load; una de commit se reconcilia contra recibo/intención exactos. Incertidumbre mantiene cerrado
el paso. Cancelar impide dispatch/adopción tardíos, espera I/O mediante `settle` y conserva la intención
para el siguiente arranque. Corrupción o conflicto durante una operación viva cerca esa sesión; requiere
reiniciar/cargar estado actual. Al arrancar, un conflicto terminal sin efecto permite cargar filas actuales.
Nunca se inventa un UUID nuevo para reintentar silenciosamente un candidato conflictivo.

## Límite y siguiente composición

No se llama desde GameHost ni `npm start`; no se quitan las exclusiones economía/pearlJournal.
No inicializa épocas, convierte fechas legacy ni aplica SQL/flags en Supabase. El siguiente corte debe
componer un solo dueño de `beforeTick`, la época común de recursos/perlas/botín, el candidato completo
y ACK posterior al commit, con adopción legacy explícita. SQL017 de agentes debe conservar su consumo
atómico; no derivarlo a una operación económica humana.

Reutilización: contratos y RPC SQL001–018, GroundTransactionSession, los helpers PGlite/Supabase SDK
y la recuperación de proceso existente. No necesita arte ni assets Unreal/FAB; fuentes intactas.
[Entrega y evidencia](../delivery/m5-ground-transaction-journal.md).
