# D09c — ubicación durable de perlas (M5 P4/P6)

Base M5 `12a6854`, integrada sobre editor D05 `991db89`; versión `0.6.0-alpha.2`, protocolo 14 conservados.
[Brief y límites](../briefs/m5-pearl-ground.md). Solo almacenamiento/SQL/tests/documentación M5 propios;
no se editó LocalServer, simulación, cliente, editor ni se arrancó/reinició/publicó el host.

## Resultado

`store.commitPearlGround({operationId,uid,kind,from,to,expectedVersion,profiles,world,ground})` es una API interna
del servicio. Confirma snapshots CAS de cuentas, ledger de UID, ubicación y recibos en una transacción.
`ground` es `{x,z,availableAt,returnAt}` cuando el destino es suelo y null al quedar en perfil. La ubicación
persiste también como tombstone mientras está en un perfil: conserva mundo y generación del UID.
No existe release sin posición: venta/drop guarda el suelo elegido por la autoridad junto con su cambio de
perfil/oro. Storage no decide precio, geometría navegable ni elegibilidad de juego.

`from:null,to:null,profiles:[]` permite mint con generación cero o relocación de suelo existente con CAS de UID.
Pickup de un UID ya registrado requiere suelo del mismo mundo y generación. Transferencias de cuenta y drops
pueden empezar a rastrear un UID gestionado por 003 desde su dueño validado; no hay bootstrap de mismo dueño
ni adopción de UID ausente. Un holder:null histórico sin posición permanece sin adoptar. La API antigua 003
sigue sirviendo a UIDs sin ubicación; una vez rastreados no puede avanzar su ledger sin actualizar ubicación.

Lecturas: `loadPearlLocation(uid)` devuelve `{world,ground,version}` o null;
`listPearlGround(world,{afterUid:null,limit:64})` devuelve filas `{uid,kind,world,ground,version}`, cursor UID
exclusivo con orden ASCII y límite 1–256; incluye expirados para recuperación. `loadPearlGroundOperation(UUID)`
lee payload/resultado exactos. SDK valida DTOs y errores fijos sin mostrar mensajes del proveedor.
Memoria aplica las mismas reglas y guarda copias separadas, pero no sobrevive al proceso.

Los tiempos son enteros seguros no negativos en milisegundos, `returnAt > availableAt`; coordenadas finitas
acotadas a ±1.000.000. Son datos elegidos por el caller: no se introduce envejecimiento offline, conversión del
tick de juego, borrado de expirados ni política de retorno. El futuro caller debe definir un reloj persistente
coherente antes de conectar restauración/expiry de la simulación.

## Transacción y recuperación

[004_pearl_ground.sql](../../server/migrations/004_pearl_ground.sql) crea `mn_pearl_locations` y
`mn_pearl_ground_operations`, con RLS y permisos solo de service_role; helpers/RPCs tienen search_path vacío
y ejecución denegada a PUBLIC/anon/authenticated. Exige READ COMMITTED. Aplicación después de 001/002/003,
reaplicación sin perder filas/recibos; FK de ubicación al ledger con cascade para limpieza administrativa de
fixtures. Borrar solo una ubicación mientras su ledger siga vivo falla.

Los UUIDs de operación se excluyen entre familias 003 y 004 mediante un advisory lock compartido anterior a
los locks de perfiles/UIDs. Una operación de cuentas usa 003 dentro de la transacción del wrapper, permitiendo
su recibo hijo solo con payload coincidente y recibo ground provisional. Un UUID completado en la otra familia
se rechaza, incluso cuando el mint de suelo no tiene recibo hijo 003. Reutilizar UUID con otro payload falla.

Orden: UUID de operación → perfiles ordenados y UIDs de 003 (si hay cuentas) → ledger → ubicación.
Mint/relocación sin cuentas toman UID/ledger directamente después del UUID. Las guardias diferidas validan
el estado final de ledger/ubicación/propiedad, permitiendo el estado temporal intermedio de 003 dentro del
wrapper. Una excepción revierte perfiles, ledger, posición y ambos recibos provisionales juntos.

Replay devuelve el resultado histórico sin mutar estado actual ni acreditar oro otra vez. No es una lectura
de ubicación vigente: el caller debe leer/comparar generaciones y perfiles antes de aplicar/publicar un recibo
recuperado. D09c no agrega reservas de cola, reintentos automáticos, diario de UUIDs tras restart ni leases;
`ProfileSessions.commitPearl`/`reconcilePearl` todavía usan el contrato anterior sin ubicación.

## Evidencia

- **149/149 pruebas pertinentes**, concurrencia limitada a dos archivos,
  `shots/review/m5-pearl-ground-acceptance.log`: 132 previas de cuentas/store/SQL/mundo/economía/perlas/balsa
  más 17 nuevas (8 memoria/SDK mock y 9 PostgreSQL/SDK local). Comando con lista explícita de 18 archivos,
  registrado por `.scratch/m5-ground-acceptance.mjs`; no se repitió regresión de render/editor ajena.
- Casos nuevos: mint/pickup/transfer/venta/drop/relocación, oro una vez y replay histórico; contendientes
  de pickup en memoria, CAS de perfil/UID atrasado sin cambios parciales, mundo/kind incorrectos, suelo
  histórico ausente, migración de UID ya gestionado desde su dueño, UUID compartido entre familias,
  rollback por fallo de ubicación con ambos recibos ausentes, raw saves/ledger/ubicación contradictorios,
  borrado de ubicación protegido y cascade de fixture, páginas ASCII/mundos/expirados, copias separadas,
  respuestas SDK inválidas/errores redacted, READ COMMITTED, RLS/permisos y reaplicación de 004.
- **70/70 del subconjunto de integración** pasaron también sobre una copia aislada del árbol M5 confirmado
  `12a6854` más los cinco archivos propios de código/SQL/tests, `shots/review/m5-pearl-ground-committed-base.log`.
  No depende del editor D05 de `991db89`; comparte dependencias instaladas, sin copiar `.env` ni alterar
  checkout/índice/host. Son un subconjunto de las 149, no pruebas adicionales.
- Arquitectura y SQL del principal; pruebas nuevas y revisión acotada Luna, inspeccionadas y aceptadas por
  el principal. La revisión explicitó que UIDs 003 sin ubicación conservan su contrato anterior: protección
  de ubicación aplica a UIDs rastreados y la nueva API rechaza pickup de un UID histórico sin suelo.
- Sintaxis y diff verificados; claves configuradas ausentes de los 13 archivos preparados para el commit.
  Hunk de título DEPLOY e intro/reglas de HANDOFF ajenos conservados fuera del índice.

Logs locales en `shots/review/`; fixtures PGlite/SDK usan transporte local sin credenciales ni red.
No hubo escrituras en Supabase. Las pruebas SQL utilizan un backend embebido, sin demostrar solapamiento
forzado entre conexiones independientes; contender de memoria comprueba únicamente la implementación JS.
El puerto 5173 dio ECONNREFUSED en la consulta de solo lectura; no se inició otra autoridad. Esta observación
no verifica un proceso público ni atribuye la causa a un cambio. Código nuevo de almacenamiento aún no activado.

## Aplicación y próximo corte

**Al aceptar D09c, 004 era nueva y quedaba pendiente de aplicar/verificar en Supabase.**
Checkpoint posterior: [D09d](d09d-pearl-ground-queue.md) verifica su aplicación real y conecta la cola.
La instrucción de aplicación del corte original era copiar el archivo completo en el SQL Editor,
después de las tres migraciones ya aplicadas por el autor, y ejecutar. No necesita variables nuevas ni activar
gameplay/reiniciar host. Después: probe RPC/RLS y canario con UUIDs temporales exactos, limpieza verificada.
Las pruebas locales no acreditan disponibilidad PostgREST ni solapamiento forzado de transacciones en conexiones
PostgreSQL independientes.

Siguiente D09d: extender cola/reconciliación al suelo y retener intenciones/UUIDs durables tras restart; acordar
con el dueño de LocalServer un seam de staging antes de publicar mutaciones/acks, incluyendo death/pickup/expiry.
Restaurar suelo desde páginas por mundo sin adoptar copias históricas silenciosamente; definir colisiones,
cuarentena e invitados. Legendarias, cartel, retorno por inactividad, leases y atomicidad de mundo/barcos siguen
pendientes. Un autosave posterior al efecto de juego no sustituye esta transacción.
