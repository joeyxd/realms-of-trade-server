# Comercio explícito de agentes / Explicit agent trade

## Español

Este corte añade compras y ventas explícitas al runner de agentes. Cada operación usa el perfil, oro, inventario, mercado y reglas M5 del propio personaje del agente. El dueño autentica y administra el mandato; el agente no elige dueño, cuenta, perfil, ciudad ni límites. El comercio sigue fuera de la mente simulada: ningún proveedor, planificador autónomo o coste de inferencia inicia compras.

### Mandato del dueño

Un dueño autenticado y conectado puede administrar únicamente un personaje que ya esté enlazado a su cuenta en la configuración confiable del servidor. La identidad del dueño se toma de la sesión autenticada. Estos mensajes no crean personajes, bindings ni capacidades.

La forma exacta del mensaje es:

```json
{"t":"agent_goods_budget","op":"create","characterId":"<uuid-personaje-configurado>","budgetId":"<uuid-canonico>","limits":{"buyGold":100,"buyGoldPerTrade":25,"sellUnits":{"madera":10,"fruta":4},"sellUnitsPerTrade":2}}
```

`read` lleva solo `t`, `op` y `characterId`. `revoke` lleva esos campos y `budgetId`. La respuesta privada es `agent_goods_budget_result` con `op`, `characterId`, `ok`, `why` y `budget`; no incluye la identidad del dueño.

El mandato es único por mundo y personaje. `budgetId` es un UUID canónico. Los cuatro límites son obligatorios: `buyGold` es el gasto acumulado máximo en compras; `buyGoldPerTrade` limita el coste de cada compra; `sellUnits` define máximos acumulados por bien; `sellUnitsPerTrade` limita las unidades de cada venta. Los importes son enteros no negativos: oro hasta 1.000.000.000, unidades acumuladas por bien hasta 1.000.000 y unidades por venta hasta 500. Los bienes deben pertenecer al catálogo M5. Un límite cero cierra ese lado del comercio.

El servidor devuelve esta proyección pública, sin mundo, dueño ni personaje:

```json
{"v":1,"budgetId":"<uuid-canonico>","enabled":true,"limits":{"buyGold":100,"buyGoldPerTrade":25,"sellUnits":{"madera":10,"fruta":4},"sellUnitsPerTrade":2},"buyGoldUsed":0,"sellUnitsUsed":{}}
```

El mandato no se puede editar ni renovar en este corte. Crear otra vez con el mismo `budgetId` y límites idénticos es idempotente y conserva el consumo actual. Cambiar el ID o los límites para el mismo personaje se rechaza. Revocar deshabilita el mandato de forma permanente; repetir `create` no lo reactiva. No hay reposición, crédito ni transferencia de bienes desde el dueño: el personaje usa sus propios bienes y oro.

### Operación y CLI

Para el runner, `tools/agent/run.mjs` acepta por stdin un mensaje `trade`:

```json
{"type":"trade","opId":"compra-01","op":"buy","g":"madera","n":1,"expectedTotal":20}
```

`op` es `buy` o `sell`; `g` debe estar en el catálogo M5; `n` es de 1 a 500; `expectedTotal` es un entero de 0 a 1.000.000.000. El agente debe tener sesión autenticada, observación vigente y la capacidad de servidor `trade_buy` o `trade_sell`, además de un mandato activo. `--capabilities` solo prepara el grant local del runner; no concede permisos al servidor.

El mensaje de red es exacto y ligado a la sesión:

```json
{"t":"agent_trade","opId":"compra-01","epoch":7,"sessionId":"<uuid-sesion>","op":"buy","g":"madera","n":1,"expectedTotal":20}
```

El servidor deriva la cuenta y ciudad a partir de la identidad autenticada y la posición del personaje. Vuelve a comprobar grant, época, vida, stop, alcance y disponibilidad. El helper de comercio M5 calcula el precio real y conserva las reglas existentes de distancia, carga, stock, calma, ley y propiedad; `expectedTotal` debe coincidir con el precio vigente.

La compra solo aumenta `buyGoldUsed` por el oro realmente debitado en una ACK exitosa. La venta solo aumenta `sellUnitsUsed[g]` por las unidades realmente retiradas en una ACK exitosa. El servidor valida el cambio de oro y del bien en el perfil. Una denegación terminal de comercio se guarda con coste cero. Un rechazo de permiso o presupuesto devuelve `why` y no crea escritura económica.

La respuesta de red `agent_trade_result` lleva el `opId`, época y sesión, estado, tick, receipt y proyección pública actual del presupuesto. El receipt describe `op`, `g`, `n`, `total`, `rev`, `ok` y `why`. En una denegación, `total` puede conservar la cotización solicitada: solo una ACK exitosa prueba un cargo. El runner acepta la respuesta solo para la operación y grant pendientes. Su disponibilidad indica que puede intentar la operación; no sustituye la cotización vigente ni garantiza saldo, stock o permiso M5.

### Stop, incertidumbre y replay

Antes de enviar el commit, el servidor vuelve a comprobar que el grant siga vigente. Un stop o una revocación en esa frontera cancela la operación. Después del envío, una respuesta perdida puede dejar el resultado incierto: el commit pudo consumar perfil, mercado y presupuesto en una sola transacción. Se reconcilia consultando el receipt o reenviando exactamente el mismo CAS; no se libera ni reutiliza una reserva externa.

El mismo `opId` y el mismo cuerpo recuperan el receipt durable sin repetir efectos ni consumo, incluso con el mandato revocado. Cambiar el cuerpo, dueño o mandato con el mismo ID se rechaza. Un replay histórico no hidrata el inventario actual ni instala su presupuesto como observación vigente. Reentrar exige un grant fresco y volver a la ciudad original; el uso del mandato permanece. El runner conserva hasta 64 IDs entre un máximo de 16 sesiones dentro del proceso; reiniciar el runner requiere aportar de nuevo el mismo ID/cuerpo y no reinicia el presupuesto M5. La revocación del mandato detiene nuevas compras y ventas de forma permanente.

`agentTrade` está apagado por defecto. Para habilitarlo, el host también requiere los controles/piloto y la autoridad económica M5, y comprueba SQL017 al iniciar. Sin la migración o sus permisos de servicio, el arranque opt-in falla antes de abrir el mundo. No se activa por publicar código ni instala SQL automáticamente.
En el montaje del host alpha26/proto38, SQL017 debe coexistir con los módulos de recursos y logging; conserva los flags existentes y no habilita `agentTrade`.

## English

This cut adds explicit buys and sells to the agent runner. Each operation uses the agent character’s own M5 profile, gold, inventory, market, and trade rules. An authenticated owner manages the mandate; the agent cannot choose an owner, account, profile, town, or limits. Trade stays outside the simulated mind: no provider, autonomous planner, or inference cost starts purchases.

### Owner mandate

An authenticated, connected owner can manage only a character already bound to that account in trusted server configuration. The server derives the owner from the authenticated session. These messages do not create characters, bindings, or capabilities.

The exact create message is:

```json
{"t":"agent_goods_budget","op":"create","characterId":"<configured-character-uuid>","budgetId":"<canonical-uuid>","limits":{"buyGold":100,"buyGoldPerTrade":25,"sellUnits":{"madera":10,"fruta":4},"sellUnitsPerTrade":2}}
```

`read` contains only `t`, `op`, and `characterId`. `revoke` also contains `budgetId`. The private response is `agent_goods_budget_result` with `op`, `characterId`, `ok`, `why`, and `budget`; it omits the owner identity.

There is one mandate per world and character. `budgetId` is a canonical UUID. All four limits are required: `buyGold` caps lifetime buy spending; `buyGoldPerTrade` caps each buy; `sellUnits` sets lifetime sold-unit caps by good; `sellUnitsPerTrade` caps each sale. Values are nonnegative integers: gold up to 1,000,000,000, units per good up to 1,000,000, and units per sale up to 500. Goods must come from the M5 catalog. A zero limit closes that side of trade.

The server returns this public projection, without world, owner, or character identity:

```json
{"v":1,"budgetId":"<canonical-uuid>","enabled":true,"limits":{"buyGold":100,"buyGoldPerTrade":25,"sellUnits":{"madera":10,"fruta":4},"sellUnitsPerTrade":2},"buyGoldUsed":0,"sellUnitsUsed":{}}
```

The mandate cannot be edited or renewed in this cut. Repeating `create` with the same `budgetId` and identical limits is idempotent and preserves usage. Changing the ID or limits for that character is rejected. Revocation permanently disables the mandate; `create` cannot re-enable it. There is no refill, credit, or owner-to-agent transfer: the character uses its own goods and gold.

### Operation and CLI

The `tools/agent/run.mjs` runner accepts a `trade` message on stdin:

```json
{"type":"trade","opId":"buy-01","op":"buy","g":"madera","n":1,"expectedTotal":20}
```

`op` is `buy` or `sell`; `g` must be in the M5 catalog; `n` is 1–500; `expectedTotal` is an integer from 0 to 1,000,000,000. The agent needs an authenticated session, a fresh observation, server capability `trade_buy` or `trade_sell`, and an enabled mandate. `--capabilities` only prepares the runner’s local grant; it does not grant server permission.

The network message is exact and session-bound:

```json
{"t":"agent_trade","opId":"buy-01","epoch":7,"sessionId":"<session-uuid>","op":"buy","g":"madera","n":1,"expectedTotal":20}
```

The server derives the account and town from authenticated identity and character position. It rechecks the grant, epoch, life state, stop state, range, and availability. The M5 commerce helper calculates the current price and retains its distance, capacity, stock, calm, law, and ownership rules; `expectedTotal` must match the current quote.

A successful buy increases `buyGoldUsed` only by the gold actually debited. A successful sale increases `sellUnitsUsed[g]` only by units actually removed. The server validates the profile’s gold and good deltas. A terminal commerce denial is receipted at zero cost. Permission or budget denial returns a reason without an economic write.

The `agent_trade_result` network response carries `opId`, epoch and session, status, tick, receipt, and the current public budget projection. The receipt describes `op`, `g`, `n`, `total`, `rev`, `ok`, and `why`. On denial, `total` may retain the requested quote: only a successful ACK proves a charge. The runner accepts it only for the matching pending operation and grant. Availability is a preflight signal; it does not replace a current quote or guarantee funds, stock, or M5 permission.

### Stop, uncertainty, and replay

Before dispatching the commit, the server rechecks that the grant remains valid. A stop or revoke at that boundary cancels the operation. After dispatch, a lost response can leave the result uncertain because profile, market, and budget may have committed in one transaction. Recovery reads the receipt or resends the identical CAS request; there is no external reservation to release or reuse.

The same `opId` and body recover the durable receipt without repeating effects or usage, even after mandate revocation. Reusing the ID with a changed body, owner, or mandate is rejected. A historical replay does not hydrate current inventory or install its budget as a current observation. Reentry requires a fresh grant and returning to the original town; mandate usage persists. The runner retains up to 64 IDs across at most 16 sessions within its process; restarting it requires supplying the same ID and body again and never resets the M5 budget. Revoking the mandate permanently blocks new buys and sells.

`agentTrade` is off by default. Enabling it also requires M5 economic authority and the agent control/pilot, and the host checks SQL017 during startup. Without the migration or service permissions, opt-in startup fails before opening the world. Publishing code does not enable it or install SQL automatically.
When mounting with host alpha26/proto38, SQL017 must coexist with resource and logging modules; preserve existing flags and leave `agentTrade` disabled.
