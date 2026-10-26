# Inventario y mercado para decidir — L06b-2a

Estas herramientas consultan datos privados del personaje y el mercado de su pueblo actual.
Son de solo lectura. No compran, venden, equipan ni transfieren bienes. El inventario se entrega
al contexto de la mente únicamente mientras está vigente; una cotización es orientativa.

## Montaje confiable y optativo

El montaje de ensayo usa cuentas separadas y vínculos suministrados por la aplicación confiable.
El resolver debe verificar el token de cuenta: nunca sustituirlo por un UUID enviado por el cliente.
No existe provisioning público de agentes en este corte.

```js
const server = createGameServer({
  host: '127.0.0.1', maxPlayers: 4, worldId: 'my-pilot',
  resolvePlayer: verifiedAccountResolver, store: isolatedPilotStore,
  agentControl: {
    worldId: 'my-pilot', ttlMs: 300000,
    bindings: [{ ownerId: ownerAccountUuid, characterId: agentAccountUuid,
      capabilities: ['move', 'inventory_read', 'market_read'] }],
  },
  agentPilot: { maxAgents: 2 },
});
```

`npm start` conserva `agentControl:null` y `agentPilot:null`. No se activan mediante `.env`.
El despliegue de este código tampoco conecta un proveedor. El control y la percepción del piloto
se mantienen acotados a dos agentes y cuatro plazas. Los vínculos todavía son configuración
confiable de proceso; no son propiedad persistente del juego.

## Runner y CLI

Solicitar capacidades que sean subconjunto del vínculo del servidor. El token se carga mediante
`--account-token-env NOMBRE_VARIABLE`, nunca desde un argumento con el valor secreto. La mente
del CLI admite `--mind simulated`; las lecturas y las consultas de mente son explícitas.

Con el montaje anterior y archivos del dueño preparados, iniciar desde la raíz del repositorio.
Sustituir los UUID y la ruta; `AGENT_ACCOUNT_TOKEN` nombra una variable privada ya configurada:

```sh
node tools/agent/run.mjs --url ws://127.0.0.1:5173/ws --files C:/ruta/brisa --owner OWNER_UUID --character AGENT_UUID --world my-pilot --account-token-env AGENT_ACCOUNT_TOKEN --capabilities move,inventory_read,market_read --mind simulated --stay-open
```

Los valores predeterminados `move,aim` no conceden lecturas. Las capacidades solicitadas tampoco
amplían el vínculo del servidor. English: explicitly request the read capabilities shown above;
the server grant remains the upper bound.

```js
const base = {
  v: 1, scope: runner.grant.scope,
  controlRevision: runner.grant.controlRevision,
};
runner.readInventory({ ...base, requestId: 'inventory-1' });
runner.readMarket({ ...base, requestId: 'market-1', op: 'list' });
runner.readMarket({ ...base, requestId: 'quote-1', op: 'quote',
  g: 'madera', n: 3, side: 'buy' });
```

Esperar el resultado de cada solicitud antes de enviar la siguiente del mismo canal. El retorno
local `ok:true` acredita admisión del envío; los eventos `inventory_result` y `market_result`
o sus ledgers acreditan la respuesta del servidor. En el CLI se envía JSON por stdin:

```json
{"type":"market_read","query":{"v":1,"requestId":"market-1","scope":{"ownerId":"OWNER_UUID","characterId":"AGENT_UUID","worldId":"my-pilot","sessionId":"CURRENT_SESSION"},"controlRevision":1,"op":"list"}}
```

Reemplazar scope y revisión por el grant actual del evento `ready` o `reenter_response`.
`inventory`/`market` inspeccionan vistas y ledger; `context` usa el mismo ensamblador que la mente
y no llama al modelo. `inventory_read` usa la misma forma sin `op`; `quote` añade `g`, `n` y
`side`. No se acepta un selector de pueblo, cuenta, dueño ni entidad en el wire.

## Frescura, privacidad y límites

- El servidor deriva personaje y pueblo del socket autenticado y `townAt`; exige vida, permiso
  vigente, sesión/epoch y puerta M5 disponibles. Repite las guardas antes de servir un replay.
- Cada canal admite una solicitud pendiente y 64 IDs distintos por sesión/epoch. Mercado incluye
  rechazos de consulta válidos en ese límite. Cantidad de cotización: 1–500 del catálogo existente.
- Un ID conserva su solicitud y foto original. Cambiar la petición con el mismo ID se rechaza.
  Repetir localmente consulta el ledger, sin enviar otro mensaje. Un replay no renueva vigencia.
- Las vistas caducan con la observación local, por defecto 1500 ms. Mercado también se retira
  cuando cambia XZ; volver a la posición anterior requiere otra lectura. Una denegación retira
  la vista anterior. Stop, revocación, muerte y nueva sesión retiran las vistas actuales.
- Timeout deja incertidumbre inspeccionable, sin reintento automático. Reentrada es explícita,
  requiere grant fresco y retira los IDs de las sesiones anteriores.
- El contexto incluye datos detached, fuente, tick y caducidad; omite ledgers de lectura, PROFILE,
  barcos, perlas y economía global. Si los campos obligatorios exceden el presupuesto del prompt,
  la consulta falla cerrada. Memoria histórica nunca sustituye una cotización vigente.

Protocolo **35**: host, clientes y runner se recargan juntos. No hay SQL nuevo ni escritura
económica. Compra/venta y presupuesto durable de bienes siguen en L06b-2b y deben entrar por
`EconomicAuthority`, la misma autoridad M5 que usan los humanos.

[Brief](../briefs/l06b-agent-market.md) · [Entrega y evidencia](../delivery/l06b-agent-market.md).

English: private inventory and current-town list/quote reads require an authenticated opt-in
grant. They never spend or transfer goods. Quotes expire, movement invalidates market views,
replays retain their original age, and fresh sessions cannot reuse retired request IDs.
