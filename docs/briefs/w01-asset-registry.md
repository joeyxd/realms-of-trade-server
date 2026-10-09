# W01 — registro durable de activos, primer corte

Fecha: 2026-10-07. El autor autorizó iniciar el plan Web3. Implementación **server-only y aislada**:
registro/transferencia de titularidad interna de equipo y parcelas. Sin conectar perfiles, gameplay,
wallets, tokens, compras, pagos ni contratos. La elección de variante premium no bloquea este registro.

## Alcance y reutilización

- Reutilizar principios M5: CAS, intención exacta, reservas durables, recibo y recuperación sin builder.
- Registro independiente, sin modificar SQL001–010 ni namespaces de perlas/muerte.
- PostgreSQL/Supabase como backend durable y memoria solo como referencia no durable.
- Migración opt-in: `server/migrations/web3/001_asset_registry.sql`; requiere roles Supabase
  `anon`, `authenticated`, `service_role`, pero no las tablas del juego. No aplicar contra live en este corte.
- Inventario Unreal/FAB revisado (`docs/research/unreal-assets/SUMMARY.md`): assets/VFX/inventario de
  referencia no sustituyen un ledger transaccional PostgreSQL. Este corte no crea ni importa arte.

## Contrato de datos

Todas las claves son exactas; rechazar extras, null, coerciones, UUID no canónico o cero, valores no finitos.
UUID: minúsculas con forma 8-4-4-4-12; SHA256: 64 caracteres hex minúsculos.
`worldId`, `contentId`: `[a-zA-Z0-9:_-]{1,100}`; `sourceKey`: igual hasta 160.
Versiones: enteros 1..2147483647; transferir requiere `expectedVersion < 2147483647`.

Registro:
`{ operationId, action:'register', assetId, worldId, worldGeneration, assetClass:'equipment'|'plot',
sourceKey, contentId, contentHash, rightsHash, to }`.

Transferencia:
`{ operationId, action:'transfer', assetId, worldId, worldGeneration, from, to, expectedVersion }`.
`from` y `to` son cuentas UUID distintas. Nunca inferir dueño desde metadata/importación.

Activo:
`{ assetId, worldId, worldGeneration, assetClass, sourceKey, contentId, contentHash, rightsHash,
ownerId, version }`.
Identidad inmutable; solo `ownerId/version` cambian con transferencia confirmada. Unicidad global de
`assetId` y de `(worldId,worldGeneration,assetClass,sourceKey)`; `sourceKey` representa origen persistente,
no el UID numérico local `u` del perfil. No hay vínculo de token todavía.

Operación:
`{ operationId, request, state:'pending'|'committed'|'rejected'|'cancelled', result }`.
`request` incluye `operationId` y nunca cambia. `result` es null si pending; terminal conserva un resultado
sin campo replay. El campo replay lo agrega cada respuesta al consultar/reintentar.

## API y resultados

`server/web3/assetRegistry.mjs` exporta `AssetRegistryError` (`code`),
`createMemoryAssetRegistry()` y `createSupabaseAssetRegistry(client)`.
`server/web3/assetContract.mjs` valida requests/rows/receipts/resultados y exporta sus helpers.

- `prepare(request)`: valida y reserva activo/origen; persiste intención exacta antes de mutar titularidad.
  `{ok:true,replay:false,operation}`; identidad repetida devuelve replay true con operación histórica.
  Fallos: `{ok:false,replay:false,why:'operation'|'conflict'|'ownership'|'busy'|'identity'}`.
- `commit(operationId)`: usa exclusivamente la intención persistida, sin request/builder nuevo.
  Éxito `{ok:true,replay:false,asset}`; fallos `{ok:false,replay:false,why:'missing'|'conflict'|'ownership'|'identity'|'cancelled'}`.
  Activo y resultado terminal se confirman juntos; repetir devuelve resultado histórico + replay true.
- `cancel(operationId)`: pending → cancelled con resultado `{ok:false,why:'cancelled'}` y libera reserva;
  terminal devuelve su resultado histórico + replay true; missing devuelve replay false/why missing.
- `loadAsset(assetId)`: activo o null. `loadOperation(operationId)`: operación o null.
- `listPending(worldId,worldGeneration,{afterId:null,limit:50})`: operaciones pending ordenadas por UUID,
  cursor exclusivo, límite 1..100; no reenvía ni ejecuta nada.
- `checkClaim({assetId,ownerId,version})`: lectura autoritativa; `{ok:true}` o
  `{ok:false,why:'missing'|'busy'|'ownership'|'conflict'}`. Una reserva pending impide conceder uso nuevo.
  Es una comprobación puntual, no una lease ni permiso de gameplay entre ticks.

Prioridad de prepare: operación previa exacta → replay; UUID previo distinto → operation;
reserva incompatible de assetId/origen → busy; registro existente assetId → conflict;
origen existente distinto assetId → identity. Transferencia requiere activo existente/mismo mundo-generación,
versión esperada y dueño from; ausencia/mundo/versión → conflict, dueño incorrecto → ownership.
commit vuelve a validar identidad/versión/dueño; rechazo terminal libera reserva, sin escritura parcial.

RPCs (JSONB salvo lectura null):
`mn_web3_prepare(p_request jsonb)`, `mn_web3_commit(p_operation_id uuid)`,
`mn_web3_cancel(p_operation_id uuid)`, `mn_web3_load_asset(p_asset_id uuid)`,
`mn_web3_load_operation(p_operation_id uuid)`,
`mn_web3_list_pending(p_world_id text,p_world_generation uuid,p_after_id uuid,p_limit integer)`,
`mn_web3_check_claim(p_asset_id uuid,p_owner_id uuid,p_version integer)`.

## Autoridad y seguridad

Estas son APIs internas de almacenamiento para un servidor confiable, **no endpoints de jugador**.
Los UUID from/to no prueban autorización del humano: un futuro resolver autenticado debe seleccionar
cuentas y capacidades antes de llamar; aquí no hay acceso desde cliente ni host.
RLS y revocación para PUBLIC/anon/authenticated. service_role solo SELECT en tablas y EXECUTE en RPCs;
sin INSERT/UPDATE/DELETE/TRUNCATE directo. Mutadores SECURITY DEFINER con `search_path=''`, nombres
calificados y dueño de migración confiable; helpers privados. Solo aislamiento read committed para
mutadores y checkClaim, con locks de operación/activo/origen y reserva única pending. Registrar/transferir no paga
ni acredita monedas. Ningún snapshot de perfil es fuente de propiedad de este ledger.

Errores de transporte/SQL desconocido → `AssetRegistryError('unavailable')`; input → 'input';
respuesta incorrecta/extra/contradictoria → 'response'. No reintento automático. SQL input inválido
usa SQLSTATE `MNW01`; aislamiento no soportado `MNW02`.
Backend identifica `kind:'memory'|'supabase'` y `durable:false|true` respectivamente.

## Aceptación

- Registrar equipo/parcela, transferir una vez, leer dueño actual y rechazar claims anteriores.
- Doble prepare/compra: una sola reserva; CAS/origen/UUID distintos no alteran titularidad.
- Replay histórico tras transferencias posteriores no restaura dueño ni versión anteriores.
- Respuesta perdida tras prepare/commit: leer recibo y reanudar UUID exacto; nada se duplica.
- Restart sobre PostgreSQL local durable y procesos independientes: pending y terminal recuperables.
- Cancelación/rollback, permisos SQL, input/respuesta estrictos; reapply de migración conserva datos.
- Supabase SDK contra PostgreSQL local, además de memoria; no equivale a verificación Supabase live.
- Sin hooks de perfiles/sim/host ni modificaciones a gameplay, assets, protocolo o dependencias.
