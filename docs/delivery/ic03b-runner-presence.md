# IC03b: the paired runner drives its presence body

Ticket T-1020-83 (AREA17, 2026-10-20). Runner side of [IC03a](ic03-mind-in-body.md). No server, SQL or protocol change.

## What changed

- `tools/agent/contract.mjs`: `presence` is appended to `NETWORK_CAPABILITIES`; `PRESENCE_ORDERS` = follow, wait, return.
- `PairedCompanion` requests `["chat","presence"]`. WELCOME adopts the intersection with the server grant: with presence on
  (a mind attached to the live body) the runner enters body mode; with the flag off it adopts `["chat"]` and behaves as
  before (no driver, no presence traffic). A guest connection (no pairing token) never holds `presence`.
- `AgentNetworkClient.presence(op, { expectedRevision })` (also on `AgentNetworkRunner`): one `agent_companion_presence`
  with the exact keys, settled by the receipt with the same `requestId` into `{ ok, why, enabled, presence }`. Local
  refusals: `invalid_request`, `not_connected` (before WELCOME), `forbidden` (no adopted presence), `busy` (4 pending),
  `timeout` (10 s), `closed` (socket closed while pending), `invalid_receipt`. `presenceState` keeps
  `{ status, order, revision, reason }` from the last receipt. An attached mind no longer sends `AGENT_RELEASE` on stop
  (the server refuses it); it closes its socket and the body keeps its order.
- Mind: in body mode a conversation turn uses `CONVERSATION_BODY_RESPONSE_SCHEMA` and one added sentence
  (`CONVERSATION_BODY_INSTRUCTION`: chat stays untrusted data, the server validates every order). The reply args are
  exactly `text` or `text` + `body` (follow, wait, return); outside body mode a `body` key stays invalid. The order is
  returned with the accepted reply, never executed by the mind: still one model request per owner message, no
  `decide()`, no INPUTS, no AGENT_TASK; `submitOrder` stays `chat_only`. No memory entry records presence ops.
- Mind snapshot: `required.tools.presence` next to `capabilities` (body mode only), `null` until the first receipt.
- `tools/agent/presence-driver.mjs`: `PresenceDriver` sends the orders (below). New `PairedCompanion` option
  `onFeedback` receives `presence` events (every receipt or wire failure, from the runner) and `presence_order` events
  (every driver outcome, including `paced`, `superseded` and `closed`).

## Order path

1. On connect in body mode: one `load` fills the body state.
2. Each owner turn whose reply carries `body`: `load`, then the op with `expectedRevision` = the loaded revision. On
   `conflict` it retries once with the revision the conflict receipt carries; a second conflict is final and reported.
   The revision also moves on its own (server `step()`, owner panel), so it never orders without a fresh load.
3. Latest wins: a new order makes the earlier one resolve `superseded` once its current send resolves (at once if it is
   only waiting). Never two sends in flight.

## Pacing

- At least 1000 ms between any two sends, at most 20 sends per rolling 60 s per runner. An order reserves both its
  sends (load + op) up front: over the cap it resolves `paced` and sends nothing.
- The server still applies 60 ops per minute per owner (shared with the owner panel, about 12 per minute of polling),
  one op at a time per owner and the global cap of 8.

## Tests

- `tests/paired-companion-presence.test.mjs` (9): contract, parser and driver unit cases; on a real host with presence
  on (a) adoption and first load, (b) owner chat with reply plus follow, (c) conflict then retry, (d) the 21st send is
  paced and never sent, (f) revoke with an order pending resolves `closed`; with presence off (e) chat only.
- `tests/agent-network-client.test.mjs` (+2): wire keys, receipt matching, timeout, close, adopted grant, guest.
- `tests/paired-companion.test.mjs`: the requested grant is now `chat,presence`.

## Hand test

- Server: `MN_COMPANION_CREATION=1 MN_COMPANION_PAIRING=1 MN_COMPANION_PRESENCE=1` with SQL027, SQL034 and SQL039 (as IC03a).
- In the game: Mis compañeros, Permitir conexión, Salir conmigo, Conectar en mi PC, Generar código.
- On the PC: `node tools/agent/pair-companion.mjs --url wss://<host>/ws --directory <folder>` with the local model
  options, then paste the code.
- Say "sígueme", "espera" and "vuelve" in chat: the companion answers and the presence card shows follow, wait and
  return (it refreshes every 5 s). The Studio hosts the standalone companion and has no pairing flow yet, and the CLI
  prints only its status lines, not the presence events.
