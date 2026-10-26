# D09d — cola de suelo y verificación real de 004 (M5 P4/P6)

Base `018a177`, versión confirmada `0.6.0-alpha.2` / protocolo 14 conservados por M5.
[Brief](../briefs/m5-pearl-ground-queue.md). D06 modifica comercio/cliente/sim/protocolo en paralelo;
este corte conserva esos archivos y sus cambios sin incluirlos en la aceptación M5.

## Resultado

`ProfileSessions.commitPearlGround(meta, build)` usa la misma cola que `commitPearl`, con reservas comunes
de cuentas/UID/UUID antes del primer await. Metadata incluye world/ground y se copia/congela al recibirla;
builder síncrono recibe `{id,version,data}` después de drenar guardados previos y devuelve `{id,data}`.
Mint/relocación sin cuentas usa `() => []`; esas operaciones participan en tasks/flush y reservas de UID/UUID.
El builder solo mueve el UID solicitado y puede acreditar oro entero al origen cuando el destino es suelo;
precios, geometría, elegibilidad y tiempos siguen perteneciendo a la futura autoridad de comandos.

Antes del builder se leen ledger y ubicación: kind/generación/dueño deben coincidir. Una ubicación existente
exige mismo mundo/generación y ground coherente con holder. Mint nuevo permite generación cero; un nullholder
histórico sin ubicación conocida no se adopta. Un UID 003 validado desde su dueño puede empezar a guardar
posición al moverse. La transacción SQL sigue siendo la autoridad final frente a cambios posteriores al preflight.

Builder una vez y máximo dos envíos con la misma solicitud concreta congelada. Replay o recuperación de recibo
leen perfiles, ledger **y ubicación actual**, comparados con datos/generaciones del resultado confirmado.
`reconcilePearlGround(UUID)` solo lee la familia ground y no manda una tercera mutación. Recibo ausente,
malformado o distinto, o lectura de estado fallida, conserva reservas; familia equivocada se rechaza.
Lecturas completadas que prueban estado posterior resuelven la reserva con conflicto sin devolver/aplicar el
resultado histórico. El método retorna copias `{receipt,profiles}` y no publica posiciones ni acuses de red.

Saves recibidos durante RPC conservan progreso y se rebasan con el movimiento/delta de oro confirmado.
Close después del envío espera operación y save final; no libera una cuenta incierta. Se reutiliza la defensa
D09b de bolsas llenas, cambios contradictorios y límites de oro. La familia anterior conserva su contrato
para UIDs sin ubicación; 004 sigue impidiendo avanzar un UID rastreado mediante la operación antigua.

Los fallos de operaciones sin cuentas incrementan una vez el contador de errores de la instancia. `flush`
permanece fallido incluso tras reconciliar, como las cuentas fallidas de D09b; recuperación no borra evidencia
de errores ni reproduce snapshots descartados. Contexto/reservas siguen en memoria, sin lease entre hosts ni
diario durable de intenciones/UUIDs tras restart. Reabrir una intención después de reiniciar aún no está resuelto.

## SQL real y evidencia

El autor confirmó que aplicó **004** y se verificó en Supabase con el SDK instalado. No se modificó ninguna
migración, variable de entorno ni configuración Auth. El primer probe no pudo completar red en sandbox;
la ejecución autorizada por red pasó. No hubo rechazo de revisión automática.

- **Probe RPC/RLS 5/5**, `shots/review/m5-ground-live-probe.log`: tablas/RPCs 004 disponibles al servicio,
  lecturas con UID/mundo/UUID aleatorios ausentes y request inválido sin escritura; ambas tablas y cuatro
  RPCs denegadas con clave pública.
- **Canario SQL/SDK real 10/10**, `shots/review/m5-ground-live-canary.log`: mint/pickup/transfer contendientes,
  un solo dueño, venta con reply perdido y replay desde otro cliente sin oro extra, relocación y recibo viejo,
  páginas por mundo/cursor que conservan expirados, payload cambiado y UUID entre familias rechazados.
  Mundo incorrecto después del cambio interno de cuentas revierte perfil/ledger/ubicación/ambos recibos;
  RPC antigua y raw writes de ubicación/ledger no eluden las guardias. Limpieza exacta y cascade verificados.
- **Cola SDK real 7/7**, `shots/review/m5-ground-sessions-live.log`: mint/pickup con CAS posterior al save,
  transferencia lenta con progreso de ambas cuentas, dos replies perdidos de venta recuperados sin crédito
  duplicado, lectura de ubicación fallida mantiene reserva ground-only, familia antigua no la elude,
  reconcile de solo lectura confirma posición sin otro envío, y limpieza.
- Cada fixture usó cuentas/UIDs/UUIDs/mundo nuevos. Queries y deletes se limitaron a esas claves exactas,
  ambos recibos eliminados, ledger antes de perfiles y ubicaciones borradas por cascade; ausencia comprobada.
  No se consultó una cuenta de jugador ni se escribió el mundo activo. Claves nunca impresas ni copiadas.
- **159/159 pruebas pertinentes** sobre copia aislada del árbol confirmado `018a177` más los cuatro archivos
  propios de código/tests, `shots/review/m5-ground-queue-committed-base.log`. Lista explícita de 19 archivos,
  `node --test --test-concurrency=2`, ~41,9 s de ejecución. Las 149 previas cubren cuentas/store/SQL/mundo/
  economía/perlas/balsa; diez nuevas prueban cola ground, familias compartidas, fuente inválida, builders,
  metadata separada/congelada, rebase/close, incertidumbre, recibos ausentes/diferentes/malformados, lectura
  fallida/malformada y ubicación posterior con lectura histórica coincidente de ledger.
  Se reutilizaron dependencias instaladas, sin copiar `.env` ni cambiar checkout/índice/host. Esta aceptación
  no incluye cambios D06 activos. Las diez nuevas también pasaron en el checkout compartido.
- Revisión de arquitectura Luna acotada y borrador de tests delegado. El principal corrigió fixtures que
  fallaban antes de enviar la operación, reforzó que cada builder inválido fuese ejecutado en una sesión
  fresca y revisó aceptación/evidencia. Sintaxis y diff propios comprobados.
- El host existente fue consultado solo por HTTP: `/health`, `/status`, `/` dieron ECONNREFUSED en el puerto
  5173, `shots/review/m5-ground-queue-active-host.log`. No se inició/reinició otra autoridad ni se verificó una
  URL pública. Esta observación no atribuye el estado del host a M5 o D06.

PGlite/SDK local prueban SQL/rollback/permisos sin red. La contención HTTP real entre clientes no demuestra
solapamiento forzado de transacciones en backends PostgreSQL independientes. READ COMMITTED y las guardias
existentes se conservan; P5 sigue pendiente. No se repitió regresión visual/editor/comercio de otro responsable.

## Reutilización y siguiente corte

Se cruzó la tarea con [SUMMARY](../research/unreal-assets/SUMMARY.md),
[CANDIDATES](../research/unreal-assets/CANDIDATES.csv) y [PORTABILITY](../research/unreal-assets/PORTABILITY.md).
`ActionRPGStarterSystem/InventorySystem` es referencia de crafting/vendor/containers/save; la evidencia
catalogada no demuestra transacciones CAS/recibos resistentes a duplicados y Blueprints no se ejecutan en Node.
`SM_StoragePart_03` aporta apariencia de caja, sin contenido/propiedad/persistencia. Para este corte se reutilizó
la cola D09b y los DTOs/RPCs D09c; ningún asset integra estas garantías. No se reabrió inventario, exportó arte
ni modificó fuente Unreal.

**No hace falta otra SQL para D09d.** Siguiente: diario durable del request/UUID antes de enviar y recuperación
al iniciar que reserve/reconcilie intenciones pendientes antes de admitir nuevas mutaciones. Debe distinguir
resultado exacto, estado posterior y resultado desconocido sin aplicar recibos viejos ni generar otro UUID.
Después acordar con dueño de LocalServer staging antes de publicar efectos/acks, cubriendo death/pickup/expiry.
Cerrar reloj persistente/restauración de ground, colisiones/cuarentena/adopción de raras e invitados antes de
activar circulación gestionada. No se decide envejecimiento offline, legendarias, cartel ni pérdidas navales;
mundo/perfiles/barcos todavía no comparten una transacción general.
