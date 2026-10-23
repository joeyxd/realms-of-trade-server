# W01 — propiedad y transferencias de equipo y parcelas

Fecha: 2026-10-07. **Implementado y verificado localmente; sin publicación ni conexión al juego.**
[Brief/contrato](../briefs/w01-asset-registry.md), [plan Web3](../../PLAN-WEB3.md),
[evidencia y hashes](w01-asset-registry-evidence.json).

## Resultado

Un registro independiente asigna identidad global, origen, contenido, derechos, dueño y versión a
equipo o parcelas. Una operación preparada reserva el activo y su origen de forma durable; confirmar
aplica titularidad y recibo juntos. Cancelar libera la reserva y conserva el resultado terminal.

Un segundo comprador no puede reservar simultáneamente el mismo activo. Tampoco se registra el mismo
origen con otro ID. Transferencias requieren dueño, mundo/generación y versión actuales; el contenido
y la identidad permanecen inmutables. Repetir una operación devuelve su recibo histórico sin restaurar
dueño/versión anteriores. Leer pendientes no ejecuta ni reenvía operaciones.

`checkClaim` consulta el registro y rechaza claims viejos o activos reservados. Es una lectura puntual,
no una lease ni permiso de gameplay; aún no sustituye `eco.deeds`, inventarios o dueños del mundo.
Un guardado de perfil viejo no escribe en este registro ni puede cambiar su titularidad.

## Implementación y autoridad

- `server/web3/assetContract.mjs`: DTOs exactos, UUID/cuentas/origen/hashes/versiones y validación de
  respuestas. Metadata adicional, coerciones y respuestas contradictorias se rechazan.
- `server/web3/assetRegistry.mjs`: referencia en memoria **no durable** y adaptador Supabase SDK para
  almacenamiento PostgreSQL. No reintenta automáticamente tras fallos o respuestas ambiguas.
- `server/migrations/web3/001_asset_registry.sql`: migración **opcional e independiente** de SQL001–010.
  Tablas privadas de activos/intenciones/reservas, siete RPCs y transiciones transaccionales.
  Requiere roles Supabase y un dueño de migración confiable; no requiere las tablas del juego.
- `service_role` puede leer las tablas y ejecutar RPCs; se rechaza INSERT/UPDATE/DELETE/TRUNCATE directo.
  PUBLIC/anon/authenticated no tienen acceso; helpers privados y funciones con `search_path=''`.
- Mutadores y `checkClaim` exigen read committed y usan locks con namespace propio. Se rechazan
  snapshots de aislamiento distinto para esta autoridad. El tratamiento de snapshots sigue la
  [documentación PostgreSQL](https://www.postgresql.org/docs/current/transaction-iso.html);
  las funciones privilegiadas restringen el acceso y su resolución de nombres según
  [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html).

Las APIs reciben identidades elegidas por un **servidor confiable**. Los campos from/to no prueban
autorización de una persona ni de una wallet. No hay endpoints de jugador ni montaje en host/sim.
`contentHash/rightsHash` identifican definiciones aprobadas por un futuro catálogo: aquí se valida
su formato y conservación, no los bytes del arte, los términos ni sus atributos de combate.
Las transferencias son internas de registro; no liquidan compras ni pagos.

## Verificación

**25/25 pruebas pertinentes**, cero failed/cancelled/skipped/todo:

```powershell
node --test tests/web3-asset-registry.test.mjs tests/web3-asset-registry-sql.test.mjs tests/web3-asset-registry-process.test.mjs tests/web3-asset-registry-boundary.test.mjs
```

Cubren equipo/parcela, cambio de dueño y CAS, reservas de activo/origen, paginado por mundo,
cancelación/rollback, inputs directos SQL malformados, respuesta RPC contradictoria y errores sin
reintentos. Replay después de transferencias posteriores mantiene el dueño actual. Se pierden respuestas
de prepare/commit y se recuperan leyendo intención/recibo y reanudando el UUID exacto.

El backend fue ejercitado mediante **Supabase SDK contra PGlite local**, con roles reales del motor
SQL de prueba; no contra Supabase remoto. Tres procesos Node independientes reabren el mismo directorio:
prepare con respuesta perdida → lectura/reanudación → lectura/replay terminal. Reapply conserva datos.
Compatibilidad: SQL001–010 del juego y W01 coexisten; los perfiles siguen guardándose y sus snapshots
no cambian la propiedad del nuevo registro. No se ensayaron múltiples conexiones PostgreSQL remotas
ni fallos de infraestructura real.

**56/56 de regresión seleccionada** del almacenamiento/host/perlas/muerte existente:

```powershell
node --test tests/store.test.mjs tests/store-sql.test.mjs tests/store-host.test.mjs tests/pearl-operations.test.mjs tests/death-storage.test.mjs
```

Total comprobado: **81/81** en estos dos grupos; no es una corrida de toda la suite del checkout.
Node `v24.14.0`; fuentes propias y hashes en el JSON enlazado. Cambios ajenos/staging existente conservados.
Revisión independiente de contrato/SQL sin problemas residuales, seguida por verificación del principal.

## Pendientes concretos

W00a: el autor ya eligió **ambas modalidades**; [reglas y contenido](w00-equipment-content.md) en un corte
posterior a este checkpoint. Cerrar pérdidas/licencias y derechos de escritura.
W02: vinculación autenticada de wallet y red de prueba; W03/W04: uso/transferencia jugable, custodia
y proyección a perfiles/parcelas con la autoridad M5/M8. Vínculo único con tokens, contratos, mint,
pagos, comisiones, reorgs y contenido de creadores permanecen sin implementar.
No se aplicó la migración contra Supabase live ni se reinició/publicó el host.
