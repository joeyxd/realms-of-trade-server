# D09e — SQL 005 y recuperación verificadas en Supabase

2026-10-05. El autor confirmó la aplicación de 005. Código D09e `cfb494b`; HEAD al verificar `68fdcec`
(D06a gameplay `bcd0886`). [Diario local y contrato](d09e-pearl-journal.md),
[evidencia estructurada](d09e-journal-live-evidence.json), [siguiente brief D09f](../briefs/m5-pearl-game-staging.md).

## Resultado

**21/21 comprobaciones reales**: cinco de superficie RPC/permisos y 16 del canario SDK/cola.
Una venta y un grant de familias ground/pearl quedaron committed con diario pending; otro proceso
recuperó ambos sin enviar mutaciones y abrió el perfil con **610 de oro una sola vez**.
Un request preparado antes del envío sobrevivió al proceso; la instancia nueva reservó cuenta/UID y
lo reanudó con **una** llamada del payload/UUID persistido, sin builder. Otra reanudación fue rechazada.

La respuesta de un cierre terminal realmente aplicado se ocultó en el wrapper del canario: conservó
reserva local y se reconcilió sin repetir la relocación. El error permanente de flush siguió contabilizado.
Solo se simularon pérdidas de respuesta en el caller; las RPCs y las lecturas persistentes usaron Supabase real.

## Evidencia y reproducción

- Probe de cinco checks: tabla presente para servicio, JSONB array real del SDK, prepare/resolve inválidos
  sin insertar, tabla pública denegada y tres RPCs públicas denegadas. Log ignorado
  `shots/review/m5-journal-live-probe.log`; resultados conservados en el JSON enlazado.
- `node tools/verify-pearl-journal.mjs --live`: **16 checks en seis procesos Node independientes**,
  más el orchestrator. Tabla/PostgREST/SDK reales con fixture creada en scope aleatorio exclusivo.
  Primeras cinco fases prueban preparación/commit, restart recovery, request sin envío, resume y cierre ambiguo;
  sexta fase comprueba terminales y limpia fixtures. Log ignorado `shots/review/m5-journal-live-canary.log`.
- Prepare exacto idempotente; request/scope/familia cambiados rechazados; páginas de un registro por UUID
  con cursor exclusivo, scope aislado y terminales omitidos. Cierre committed exacto idempotente, resultado
  terminal diferente rechazado. DELETE del servicio denegado con fila todavía presente.
- Clave pública configurada: SELECT/INSERT/UPDATE/DELETE de tabla y prepare/resolve/list RPC denegados.
  No se creó usuario Auth; permisos de una sesión humana authenticated siguen cubiertos solo localmente por SQL.
- Sintaxis del tool y ejecución sin `--live` comprobadas; el comando sin flag muestra uso y sale sin leer `.env`
  ni iniciar red. La aceptación local previa 204/204 y la regresión D06a 493/493 son evidencia de sus cortes
  originales; no se repitieron ni se presentan como una suite nueva en este seguimiento.

El tool carga `.env` solo dentro de las fases live y no imprime URL, claves, errores del proveedor, perfiles
ni tokens. Timeout HTTPS por llamada; sin listener, puerto de juego, Auth, variables nuevas o host simulado.
Si falla una fase, conserva el manifiesto y evidencia exactos en `.scratch`; no borra fixtures ambiguas,
no retira pendientes a ciegas ni inicia otra ejecución automáticamente. Recuperar ese scope exacto y comprobar
sus recibos/autoridad antes de limpieza administrativa; no borrar/reabrir filas del diario.

## Limpieza y límites

Se comprobaron ausentes los dos perfiles, tres UIDs, ubicaciones y recibos exactos de cinco UUIDs temporales;
ground del scope vacío. **Cuatro filas committed del diario permanecen**, intencionalmente: 005 impide borrar
auditoría. Son snapshots de fixtures sin usuarios Auth ni jugadores reales; IDs/scope se conservan en evidencia.
No hubo consultas a perfiles de jugadores existentes ni escritura de su mundo/economía.

No se inició/reinició/publicó el host, no se inyectó el diario en GameHost y no se modificaron sim/cliente/
protocolo/editor/comercio/producción. D06b continúa con sus archivos. El canario acredita persistencia real
entre procesos y contratos del proyecto configurado; no acredita leases, failover multi-host, solapamiento
forzado de backends, entrega humana de correo ni circulación durable dentro del juego.

Se revisaron inventario Unreal/FAB y candidatos concretos: BP_JigServerSave/InventoryComponent/WorldContainer
son referencias de flujo; la caja SM_StoragePart_03 es visual. Ninguno reemplaza UUID/CAS/staging, por lo que
no hubo importación ni edición de las fuentes. La integración siguiente empieza con transferencia de un UID
gestionado en fixtures aisladas; death/reemplazo de perla afectan varios UIDs y exigen diseño adicional.
Restauración/reloj/adopción/invitados y gate de todas las rutas preceden activación pública. P4/P6 siguen parciales.
