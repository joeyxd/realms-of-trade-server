# D09b — cola de perlas y reconciliación de cuentas

Base `d028a42`, `0.6.0-alpha.1`, protocolo 13. El autor aplicó 001/002/003; probe real confirmó 003/RPC/RLS
y canario temporal probó contendientes, replay, venta e importación con limpieza verificada.

## Dueños y límites

Principal: `server/profileSessions.mjs`, `server/pearlQueue.mjs`, `server/pearlOperations.mjs`, arquitectura,
integración, aceptación y documentación M5 en hunks propios. Luna: revisión acotada y dos tests nuevos asignados.
Otro responsable conserva LocalServer, sim/rafts/client/render/editor y host abierto del PC. No editar esos
archivos, reiniciar el host ni conectar circulación de juego sin el seam de intents/suelo duradero.

## Contrato interno

`ProfileSessions.commitPearl(meta, build)` recibe `{operationId, uid, kind, from, to, expectedVersion}` del
servidor, jamás del mensaje del jugador. `build(rows)` es síncrono y puro; recibe snapshots separados
`[{id, version, data}]` de sus endpoints persistidos al llegar al turno. Devuelve `[{id, data}]` con el cambio.
La cola agrega los CAS de perfil. El builder se ejecuta una sola vez; reintento de transporte usa el mismo
UUID y request congelado. Un builder no puede cambiar otros campos: solo el UID solicitado y un crédito
aditivo entero de oro únicamente para el origen de venta/release (`to:null`), dentro del tope de perfil.
Otras perlas conservan ubicación dentro del perfil además de UID/kind.

Reservar UID y cuentas afectadas antes de esperar. Guardados anteriores terminan y el último snapshot anterior
se confirma antes de formar la operación. Guardados posteriores quedan en espera; al confirmar, reciben el
cambio del UID y el crédito de oro, conservando progreso posterior. Snapshot contradictorio, bag llena al
rebasar, fallo/CAS o confirmación malformada cercan las cuentas afectadas y no sobrescriben la base.
Operaciones disjuntas pueden avanzar; compartir cuenta, UID o UUID de operación pendiente da `busy`, sin escrituras.

Una respuesta perdida se reintenta exactamente una vez con request idéntico. Un recibo repetido exige recargar
perfil y UID: si ya avanzaron, no aplicar el resultado viejo ni inventar otro operationId. Si ambas respuestas
se pierden, leer el recibo por UUID: ausencia/error mantiene UID/cuentas cercados incluso tras close. La lectura
acotada `reconcilePearl(operationId)` permite liberar cuentas cerradas cuando verifica recibo y lecturas de estado; compara
payload/perfiles/UID y nunca envía una tercera mutación ni restaura snapshots descartados. El resultado es
`{receipt, profiles:[{id, data}]}` para que un futuro caller publique solo después de confirmar. No es un ack
de red ni cambia el perfil vivo de la simulación. El caller necesita un seam de staging antes de habilitarlo.

Close antes de enviar cancela la intención y conserva el guardado final. Close después de enviar espera el
resultado/reintento y conserva la reserva hasta drenar guardados. `flush`/cierre de host incluyen operaciones.
Al abrir una cuenta, consultar los UIDs del perfil y validar los registrados contra kind/dueño antes de WELCOME;
los UIDs ausentes siguen explícitamente sin adoptar. Error/cancelación no permite entrar con perfil vacío.

## Aceptación

Orden save→operación→save, snapshot separado, progreso durante RPC lenta y crédito único, transferencia entre
dos cuentas, contendientes busy/disjuntos, reply perdido/replay avanzado, CAS/builder inválido, close antes y
después de enviar, flush fallido, reentrada tras drenar y guardia de join antes de WELCOME. Memoria + SQL/SDK,
canario real temporal del coordinador y prueba de salud del host actual; ningún dato de jugador existente.

P4/P6 siguen parciales: falta adoptar/cuarentenar raras existentes y conectar intents/ack, pickups/death/suelo/
expiración, invitados y catálogo de legendarias. Leases y economía naval siguen sus pendientes.
