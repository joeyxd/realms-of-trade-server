# AREA15 — transacción de gameplay con reloj común

2026-10-10. Corte de almacenamiento y sesión detenida; no monta GameHost ni activa SQL en Supabase.

## Resultado

SQL018 une una operación M5 existente, el snapshot del mundo y su reloj lógico en un mismo commit.
Resuelve el hueco entre confirmar una perla/muerte/botín y guardar su reloj por separado. Las familias
son `economic`, `ground`, `batch`, `death`, `drop` y `checkpoint`; reutiliza sus validadores y RPC.
La autoridad sigue siendo M5. El servidor construye el candidato y decide elegibilidad, costes,
distancia, pérdidas y recompensas; el RPC interno no sustituye esas reglas.

`commitGroundTransaction({operationId, request})` recibe exactamente `world`, `expectedWorldVersion`,
`worldData`, `family`, `operation` y `clock`. La operación anidada es el request canónico de su familia,
sin UUID exterior. El reloj declara `operationId`, `expectedVersion`, `expectedTick` y `tick`.
Requiere mundo y reloj ya existentes. Si hay recursos, su tick actual coincide con el reloj actual y
el tick candidato coincide con el reloj candidato. No inventa un reloj ni convierte fechas legacy.

## Commit y recuperación

El UUID exterior identifica tanto el recibo de familia como el sobre atómico; no representa un segundo
efecto. El UUID del reloj es distinto. Un avance crea su recibo SQL013 dentro de la misma transacción;
varias operaciones en un tick conservan el UUID y versión del reloj actual. El mundo incrementa una
vez su versión. La familia económica ya lo guarda; las otras usan el `mn_save_world` protegido de SQL016.
Este último impide borrar recursos/comunidad y reescribir nodos, cooldowns o autoría mediante un checkpoint.
SQL018 también exige conservar la comunidad vigente en candidatos económicos ajenos a sus aportes.

CAS de mundo, reloj, perfiles y UIDs, namespace de recibos, efecto y sobre se confirman juntos.
Un rechazo o excepción posterior revierte todas las escrituras provisionales. No se puede envolver
retroactivamente un recibo standalone. Repetir el mismo UUID/request devuelve el recibo histórico
con `replay:true` exterior; no restaura sus snapshots sobre filas posteriores.

Solo `service_role` puede invocar commit/load/capability. No tiene escritura directa del sobre,
que es inmutable. SQL018 se aplica después de SQL001–017 y se puede reaplicar. SQL017 conserva el
presupuesto/comercio de agentes de AREA17. El límite persistido del request completo es 2 MiB según
JSONB de PostgreSQL, incluyendo espacios canónicos; JS también limita el DTO a 2 MiB, por lo que
un request muy próximo al límite puede ser rechazado por SQL.

## Sesión y pausa offline

`GroundTransactionSession` prepara I/O y solo adopta estado mediante `drain` síncrono en el tick
capturado. Su carga verifica recibo del reloj y dos lecturas iguales del mundo. El llamador mantiene
la simulación detenida; un efecto no checkpoint requiere un aplicador síncrono confiable que retorna
`true`. No se publican inventario, eventos ni ACK desde la promesa. El error de aplicación bloquea
la sesión; la recuperación posterior debe volver a cargar las filas actuales.

La sesión retiene un dueño por objeto store/mundo, captura el DTO antes del envío y reconcilia una
respuesta perdida mediante recibo exacto y reenvío del mismo UUID/request. Un resultado desconocido
mantiene `unresolved`; corrupción, conflicto definitivo o cancelación impiden continuar. `settle`
espera el I/O en curso incluso después de cancelar. Esto no constituye un lease entre procesos.

La época cargada proyecta ticks locales sobre el tick durable sin usar la hora del sistema. Respeta
la pausa offline aprobada para recursos y perlas/botín. Los ticks posteriores al último commit pueden
retroceder al caer el proceso; no existe promesa de tiempo continuo sin checkpoint.

## Composición siguiente

Este corte no se llama desde `npm start`, GameHost ni EconomicAuthority. No modifica sus exclusiones
entre economía y pearlJournal, ni crea soporte en memoria. La integración siguiente debe dar un solo
dueño a `beforeTick`, incluir el sobre exacto en el diario de intenciones, aplicar el candidato completo
una sola vez, adoptar explícitamente reloj/datos legacy y verificar reinicio/caída en el VPS real.
El comercio autorizado de agentes deberá conservar presupuesto y recibo SQL017 en ese mismo commit;
no se debe desviarlo a la familia económica humana. Tampoco activa cofres/salvamento, invitados
durables, XP/misiones, supervivencia, custodia offline o respaldo/restauración.

Reutilización: SQL001–017, los contratos de perlas/muerte/botín, `checkedWorldData`, GroundClockSession
y los helpers PGlite existentes. No necesita arte/modelos ni un asset Unreal/FAB; las fuentes permanecen
intactas. [Entrega y evidencia](../delivery/m5-ground-transactions.md).
