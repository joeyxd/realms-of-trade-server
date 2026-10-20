# AREA15 — recursos GM componen con el piloto común Ground (SQL040)

Segundo corte del paso 3 de la [matriz de continuidad](../CONTINUITY-MATRIX.md). Ticket T-1020-70, sobre la base
`bebd463` (alpha.79). Versión alpha.82; protocolo 63 sin cambio (no hay cambio de wire). SQL040 nuevo y aditivo;
sin flag, variable de entorno ni dependencia nuevos.

## Qué compone

- Un cambio de contenido GM (`gmContent.activate`) a un mapa con `gmResources` funciona con `groundTransactions`
  activo: la admisión del roster es durable antes de que se mueva el puntero de contenido, y el host sigue sano.
- Un host Ground arranca con un mapa GM ya activo (el roster admitido se restaura; los nodos fuera del mapa quedan inertes).
- Recoger en un nodo GM admitido es un comando económico normal: se confirma por el recibo común SQL018/019 con el
  recibo SQL014 anidado, se paga una vez y el reenvío con el mismo `opId` es réplica.
- Se quitaron solo las cláusulas `groundAuthority` de los dos guards de `server/host.mjs` (arranque en `#prepareEconomy`
  y `prepareContentResources`). La comprobación `checkGmResourceRoster` versión 1 se conserva en los dos sitios.
- Sin Ground nada cambia: la ruta SQL036 (`store.admitGmResources`), su readiness y sus tests siguen igual.

## Diseño: una sola autoridad

Bajo Ground la admisión es una operación de familia del dueño Ground, nunca del host:

1. `GameHost.prepareContentResources` exige SQL036 v1, la capacidad `groundAuthority.admitGmResources` y la readiness
   SQL040; si falta algo responde `gm_resource_unavailable` sin escribir nada.
2. `GroundHostAuthority.admitGmResources(nodes)` (nuevo) exige el arriendo de cambio de contenido y un mundo en reposo
   (`canMutate`, sin jugadores, checkpoint ni familia pendiente, versión y roster vivos iguales a los confirmados por la
   sesión), valida los nodos antes de cualquier E/S y ocupa el dueño (`kind: 'gm'`, `operationBusy`): no corre tick,
   checkpoint ni otra familia mientras tanto.
3. `GroundTransactionSession.admitGmResources` (nuevo): resuelve primero una intención pendiente que dejó un host
   detenido, después escribe la intención con su `operationId` (`mn_prepare_ground_gm_admission`) y solo entonces llama a
   `mn_commit_ground_gm_admission`. El recibo se adopta en la sesión (versión del mundo y roster confirmados) antes de
   volver; el autor del puntero solo avanza después. El reloj Ground no se mueve.
4. Cualquier fallo tras la primera lectura (conflicto o rechazo del commit propio, respuesta perdida o ambigua, parada,
   recibo que no cuadra con el pin) cerca la sesión, la autoridad y el mundo, igual que la ruta SQL036 hoy; el mapa no se
   instala. Una intención antigua que SQL resuelve con un fallo terminal (conflicto o rechazo) no escribe nada:
   no cerca; si en cambio se confirma, se adopta como la propia antes del nuevo append.

El host nunca llama a `mn_admit_gm_resources` ni a `mn_save_world` para la admisión (los tests espían el store), y nada
escribe `mn_worlds` fuera de la sesión Ground. El checkpoint siguiente usa la versión adoptada (sin CAS obsoleto).

### Funciones SQL040 (`server/migrations/040_ground_gm_resources.sql`)

| función | papel |
|---|---|
| `mn_prepare_ground_gm_admission(p_operation_id uuid, p_request jsonb) → jsonb` | intención en diario antes del commit; idempotente para la misma petición; una sola pendiente por mundo; rechaza IDs de recibos, diario y reloj Ground |
| `mn_commit_ground_gm_admission(p_operation_id uuid, p_request jsonb) → jsonb` | el commit, una transacción |
| `mn_pending_ground_gm_admission(p_world text) → jsonb` | la intención pendiente de un host detenido, o `null` |
| `mn_ground_gm_resources_ready() → jsonb` | readiness, `{"version":1}` |
| `mn_valid_ground_gm_admission`, `mn_valid_ground_gm_admission_result`, `mn_guard_ground_gm_admission` | privadas (CHECK y trigger) |

Petición exacta: `{ world, expectedWorldVersion, clock: { operationId, version, tick }, resources }`; el roster completo
(estado de recursos v1, v2 o v3 válido según el validador de SQL024/036) con `resources.tick` igual al tick del reloj.
Recibo: `{ ok: true, worldVersion: expected + 1, clock: {world, tick, version, operationId}, added }`; fallos
`{ ok: false, why: 'conflict' | 'invalid' | 'operation' }`.

Invariantes que el commit hace cumplir en el servidor, dentro de la transacción:

- Locks de la familia SQL018: identidades `mn-pearl-op:` en orden UUID, después `mn-economic-world:<world>` con
  `FOR UPDATE` de la fila del mundo y `mn-ground-clock:<world>` con `FOR UPDATE` de la fila del reloj.
- CAS: la versión del mundo es la esperada y el reloj coincide (versión, tick y operación) con el pin de la sesión, y el
  tick de recursos guardado es el del reloj; si no, `conflict`.
- Diario primero: sin intención previa con la petición exacta no hay commit (`operation`, sin escritura).
- Append-only, tope y estado: se delega en `public.mn_admit_gm_resources` de SQL036 dentro de la misma transacción (no se
  copia su validación): nodos existentes y su estado intactos y en orden, a lo sumo +128 por admisión, filas nuevas
  `gm_…` con valores por defecto y su entrada de tala exacta. Sin nodos nuevos → `invalid`. Lo que SQL036 rechaza → `invalid`.
- La escritura en un mundo adoptado (SQL023) pasa por `mn_ground_world_write_context` solo durante esta transacción;
  la entrada SQL036 directa sigue rechazada para ese mundo.
- Idempotencia: un ID decidido devuelve su recibo guardado byte a byte y no escribe nada; una intención resuelta como
  conflicto o rechazo guarda ese resultado, sin recibo y sin tocar el mundo.

Almacén del recibo: una tabla nueva, `mn_ground_gm_admissions` (fila = intención y después recibo, estados
`pending → committed | conflict | rejected`, inmutable salvo esa transición, RLS, solo `SELECT` para `service_role`).
`mn_ground_transactions` y `mn_ground_transaction_intents` no pueden guardarla: sus CHECK admiten solo las seis familias
de SQL018 y no se tocan; un checkpoint tampoco puede llevar la admisión porque `mn_save_world` congela el roster
(T-1020-67). Ninguna función, tabla ni migración existente cambia. Privilegios como SQL036: las cuatro RPC solo para
`service_role` (revocadas de `PUBLIC`, `anon` y `authenticated`), `SECURITY DEFINER` con `search_path = ''`; la
readiness `SECURITY INVOKER`; las privadas sin `EXECUTE` para nadie.

### Recuperación

- Parada tras el commit y antes del puntero: un host nuevo carga las filas actuales (roster con los nodos una vez,
  versión +1); los nodos quedan inertes mientras el mapa activo no los usa; reintentar el cambio no admite nada (cero
  `prepare`/`commit`) y el puntero se instala. Repetir el ID devuelve el recibo guardado sin escribir.
- Parada tras la intención y antes del commit: el arranque no aplica intenciones históricas; el siguiente cambio
  resuelve primero esa intención (un commit, sobre el mismo pin) y después no encuentra nada nuevo.

## Puerta de readiness: SQL040 debe aplicarse a mano

`store.checkGroundGmResources()` llama a `mn_ground_gm_resources_ready()` y solo acepta exactamente `{"version":1}`;
la función devuelve 0 si falta una dependencia (SQL018/019/023/036), si una RPC no es `DEFINER` con `search_path` vacío,
si un permiso se desvió, si la tabla perdió RLS o su trigger. Bajo Ground, un mapa con `gmResources` exige esa readiness
al arrancar (`StoreError('configuration')`) y en cada cambio (`gm_resource_unavailable`); una sonda que falla cuenta
como no lista.

**La persona responsable debe aplicar SQL040 en Supabase antes de cualquier piloto Ground con mapas GM.** Hasta entonces
el host falla cerrado en esos casos. Producción no se ve afectada mientras `groundTransactions` siga apagado: sin Ground
no se llama a ninguna función SQL040. Comprobación tras aplicar (rol de servicio):
`select public.mn_ground_gm_resources_ready();` → `{"version": 1}` (ops/migration-check.md).

## Sigue excluido de Ground

Los demás guards no cambian: emparejamiento y presencia de compañeros, bots / `agentTrade` / `agentControl`, rutas
autónomas y runners de agentes, kill/cofre, la adopción detenida y el canario VPS. `deploy/vps-update.py` (TESTS) no
cambia: incluir los tests nuevos es decisión del operador.

## Archivos

- `server/migrations/040_ground_gm_resources.sql` (nuevo).
- `server/host.mjs`: las dos cláusulas `groundAuthority`, `#groundGmResourcesReady` y la rama Ground de `prepareContentResources`.
- `server/groundHostAuthority.mjs`: `admitGmResources` y la parada de una admisión activa.
- `server/groundTransactionSession.mjs` (el único otro módulo `ground*`): la familia, la resolución de la intención
  pendiente y la adopción.
- `server/store.mjs`: cliente RPC SQL040 (`prepareGroundGmAdmission`, `commitGroundGmAdmission`,
  `loadPendingGroundGmAdmission`) y `checkGroundGmResources`, con sus DTO exactos; solo en el store Supabase.
- `tests/gm-ground-sql.test.mjs`, `tests/gm-ground-host.test.mjs` (nuevos); `tests/gm-functional-authority.test.mjs`:
  el caso de la autoridad sin capacidad ahora tiene dos subcasos (sin capacidad con SQL040 listo; con capacidad sin
  readiness), los dos rechazados antes de escribir.

## Evidencia (checkout `area15-resource-live`, base `bebd463`)

Línea base antes de editar, los 10 archivos existentes del conjunto dirigido: 54 pruebas, 54 pasan.

| # | comando (desde la raíz del repo) | resultado |
|---|---|---|
| 1 | `node --test --test-concurrency=1 tests/gm-ground-sql.test.mjs` | 10 pruebas, 10 pasan, 0 fallan (7 casos; v1/v2/v3 como subpruebas) |
| 2 | `node --test --test-concurrency=1 tests/gm-ground-host.test.mjs` | 10 pruebas, 10 pasan, 0 fallan (8 casos A-E; E con dos subcasos) |
| 3 | conjunto dirigido, abajo | 76 pruebas, 76 pasan, 0 fallan (54 de la base + 10 + 10 + 2 subcasos nuevos) |
| 4 | puerta del actualizador, abajo (TESTS exactos de `deploy/vps-update.py`) | 29 archivos, 202 pruebas, 202 pasan, 0 fallan |

```
# 3
node --test --test-concurrency=1 tests/gm-ground-sql.test.mjs tests/gm-ground-host.test.mjs \
  tests/gm-functional-authority.test.mjs tests/gm-resource-roster-sql.test.mjs tests/gm-resource-readiness.test.mjs \
  tests/gm-content-service.test.mjs tests/ground-host-authority.test.mjs tests/ground-host-authority-sql.test.mjs \
  tests/torch-ground-host.test.mjs tests/fire-ground-host.test.mjs tests/ground-workshop-compatibility.test.mjs \
  tests/ground-family-host.test.mjs
# 4 (la selección exacta del updater: los 29 archivos de TESTS en deploy/vps-update.py)
node --test --test-concurrency=1 $(python -c "import ast,re;s=open('deploy/vps-update.py',encoding='utf-8').read();print(' '.join(ast.literal_eval(re.search(r'^TESTS\s*=\s*(\(.*\))',s,re.M).group(1))))")
```

Casos del host: A cambio GM bajo Ground con un único commit SQL040 y checkpoint posterior sobre la versión adoptada;
B recogida de piedra GM por el diario Ground y réplica sin segundo pago; C conflicto y respuesta perdida cercan sin
puntero; D parada tras commit y antes del puntero, host nuevo, reintento sin admisión y arranque posterior con el mapa
GM; D2 parada tras la intención, commit único en el siguiente cambio; E arranque sin SQL040 → `configuration`, cambio sin
readiness o sin capacidad → `gm_resource_unavailable` sin escritura (más los dos subcasos de
`gm-functional-authority.test.mjs`).
