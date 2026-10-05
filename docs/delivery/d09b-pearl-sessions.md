# D09b — cola de perlas, recibos y reconciliación de cuentas (M5 P4/P6)

Base D09a `d028a42`, integrada sobre cubierta D04 P2 `15bfb44`; versión `0.6.0-alpha.1`, protocolo 13.
El autor confirmó que aplicó todas las SQL. Esta misión verificó 003 y el nuevo coordinador con Supabase real;
no arrancó/reinició el host del PC, publicó cambios ni consultó perfiles de jugadores existentes.
[Brief y límites de escritura](../briefs/m5-pearl-session-queue.md).

## Resultado

`ProfileSessions.commitPearl(meta, build)` es un contrato interno del servidor. La metadata contiene UUID de
operación, UID/kind, origen/destino y generación esperada del UID; el builder síncrono recibe copias de los
perfiles confirmados y sus versiones después de drenar los guardados anteriores. La cola agrega CAS de perfiles,
reserva cuentas/UID/UUID antes del primer await y forma un request separado y congelado. El builder corre una vez.
Operaciones disjuntas avanzan juntas; cuentas, UID o UUID compartidos pendientes dan `busy` sin ejecutar builders.

El builder solo cambia la perla solicitada y un crédito entero no negativo de oro para su cuenta de origen en
una venta/release (`to:null`). No puede mover otras perlas, cambiar progreso, acreditar transferencias ni superar
el tope de oro del perfil. No decide precio/eligibilidad de juego: esos valores deben venir del futuro comando
autoritativo. Se rechazan duplicados, bolsas truncadas y valores que el sanitizer tendría que redondear/clamp.

La secuencia es save anterior → operación atómica → save posterior con nuevas versiones. Snapshots recibidos
durante la RPC normalmente todavía contienen la ubicación anterior de la perla; la cola aplica el movimiento
confirmado y el delta de oro conservando XP, banderas y progreso posterior. Una ubicación contradictoria,
destino lleno o exceso de oro cercan las cuentas, sin escribir el snapshot inseguro sobre la operación confirmada.
El resultado `{receipt, profiles:[{id,data}]}` entrega copias al futuro caller; no es un ack de red ni modifica
el perfil vivo de la simulación. El caller debe aplicar/publicar el resultado mediante staging.

Close antes del envío cancela la intención y conserva el guardado final. Close después del envío espera la
operación y su save rebasado; la cuenta no se puede volver a abrir antes de drenar. `flush` incluye operaciones,
escrituras y recuperación; un fallo se contabiliza una vez por cuenta afectada y el cierre informa `flush`.

## Respuestas perdidas y acceso

Un error de transporte/respuesta ambiguo permite un solo reintento con el request congelado idéntico. El recibo
repetido exige leer perfiles y UID y compararlos con sus versiones/datos; un estado posterior produce conflicto,
sin restaurar un resultado viejo. Tras dos respuestas ambiguas, `loadPearlOperation` lee únicamente el recibo por
UUID desde `mn_pearl_operations`, tabla ya protegida por 003 para service_role. No hay SQL adicional.

Recibo ausente, payload diferente o lecturas de estado fallidas mantienen UID/cuentas reservados incluso después
de cerrar el socket. `reconcilePearl(operationId)` permite otra lectura acotada de recibo/perfiles/UID; nunca envía
una tercera mutación. Solo lecturas autoritativas completadas resuelven la reserva: estado exacto devuelve el
resultado; estado avanzado rechaza el recibo viejo. Los errores permanecen contabilizados, las sesiones fallidas
siguen cercadas y los snapshots descartados no se reaplican. La cuenta cerrada puede volver a cargar el estado real.
No existe endpoint público de recuperación ni lease entre procesos; una ausencia permanente exige investigación
operativa, no quitar la reserva por un timeout. Contexto/reservas de la cola son memoria local: un reinicio pierde
su seguimiento. Antes de conectar el juego, el caller debe retener el UUID y reconciliar recibos durables antes
de volver a publicar/abrir un estado pendiente; este corte no acredita recuperación completa tras restart.

Antes de WELCOME, `ProfileSessions.open` consulta los UIDs del perfil: un registro debe coincidir en kind/dueño
y tener generación válida. Discrepancia o lectura fallida impiden entrar; no se reemplaza la partida con un
perfil vacío. Un UID ausente permanece sin adoptar y conserva su flujo previo. No se escanean otras cuentas.

## Evidencia

- **109/109 pruebas pertinentes**: 91 de cuentas/store/SQL/mundo/economía/perlas y 18 nuevas de sesión/host,
  `shots/review/m5-pearl-sessions-acceptance.log`, con concurrencia limitada a dos archivos.
  Casos: orden/CAS, snapshots separados, progreso durante RPC, dos lanes, bag llena, busy/disjuntos, builders
  inválidos, transporte perdido, recibos antiguos, lectura de recuperación fallida, close antes/después y join.
- **45/45 del subconjunto de integración** pasaron además en copia aislada de fuentes confirmadas `15bfb44`
  más los seis archivos de código/tests de esta misión, `shots/review/m5-pearl-sessions-committed-base.log`.
  Comprueba que no depende de los cambios D05 ajenos sin commit; comparte las dependencias instaladas del repo,
  sin copiar `.env`, cambiar checkout/índice ni tocar el host. Es un subconjunto de las 109, no pruebas nuevas.
- **Probe real 5/5**, `shots/review/m5-pearl-live-probe.log`: RPCs/tabla 003 disponibles al servicio y lectura/RPC
  denegadas con la clave pública. No lee filas existentes; busca solo un UID aleatorio ausente.
- **Canario SQL/SDK real 9/9**, `shots/review/m5-pearl-live-canary.log`: tres grants contendientes, dos transfers
  contendientes, venta/replay con oro una vez, UUID reutilizado, reclaim/replay viejo, rollback de save/import,
  primitivas P1 rechazadas y limpieza. Tres clientes SDK emiten peticiones HTTP concurrentes al proyecto.
- **Coordinador real 6/6**, `shots/review/m5-pearl-sessions-live.log`: save anterior/grant con CAS actualizado,
  transferencia lenta con progreso de ambas cuentas, venta con dos replies perdidas recuperada del recibo real
  sin doble crédito, reconexión válida/rechazo de dueño incorrecto y limpieza verificada.
- Todos los perfiles, UIDs, UUIDs de operación y recibo legacy fueron generados para estas pruebas. Delete y
  consultas de ausencia se limitaron a esas claves exactas; ledger temporal eliminado antes de perfiles para
  respetar la guardia de propiedad. Ninguna prueba inició una cuenta de usuario ni escribió el mundo activo.
- Host existente consultado solo por HTTP: `/health`, `/status` y `/` 200, mundo ready y cero errores de
  almacenamiento, `shots/review/m5-pearl-sessions-active-host.log`. Esto acredita continuidad del proceso
  abierto, que todavía no cargó el código nuevo.

PGlite/SDK local siguen cubriendo SQL/rollback/privilegios sin red. Las peticiones HTTP contendientes reales
no demuestran solapamiento forzado de transacciones en conexiones PostgreSQL independientes; el pool puede
serializarlas. Se conserva `READ COMMITTED` y no se acredita P5 con estas pruebas.
Revisión Luna acotada y pruebas delegadas; arquitectura, canarios, correcciones, inspección y aceptación del principal.
Sintaxis y diff verificados; claves reales configuradas ausentes de todos los archivos seleccionados.

## Próximo corte

P4/P6 permanecen parciales: el juego todavía usa el ledger de sesión y sus comandos síncronos no llaman a
esta cola. Suelo/expiración durable, pickups/death y staging antes de mutación/ack requieren un contrato conjunto.
Adopción/cuarentena de raras existentes, colisiones e invitados deben ser explícitos; no se activaron legendarias,
retorno por inactividad, cartel, leases ni atomicidad de mundo/perfil/barcos. No cambia UI, sim ni protocolo.

El otro responsable conserva LocalServer, client/render/sim, editor D05 y host del PC. Antes de conectar
circulación gestionada, acordar un seam de intents en esa autoridad y completar recuperación de suelo/propietarios;
un autosave posterior a una mutación publicada no sustituye esa transacción.
