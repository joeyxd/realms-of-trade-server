# IC08: hosted inference (the companion's model is entered in the game and runs on the server)

Decided by Joi on 2026-10-22 (session T-1022-45..48): the owner types the endpoint URL, the API key and the model inside the
game; the server stores the key encrypted and runs the companion's mind on the VPS. This replaces, for hosted use, the rule
of IC01 that keys only live in the owner's PC Studio. The PC flow (Studio + `pair-companion.mjs`) keeps working unchanged.
The L03d inference config (`server/inferenceConfig.mjs`, SQL028) stays in the code but its panel is no longer reachable
from "Mis compañeros": the "Centro de inferencia" button opens the hosted center.

## What the owner does

1. Mis compañeros -> Centro de inferencia -> add a connection: label, base URL (`https://.../v1`), API key, default model.
2. "Probar modelos" lists the provider's models; "Probar" sends one test prompt and shows reply, tokens and latency.
3. For a companion whose body is summoned and whose connection is allowed (existing controls): pick connection and model,
   press "Iniciar en el servidor". The server pairs a hosted controller to that companion; it chats and obeys like the
   PC-paired one (IC03-IC05). "Detener" ends it. Leaving the world, revoking, the pairing expiring or a server restart end it.

## Server switches (alpha.env; nothing is on by default)

| env | meaning |
|---|---|
| `MN_HOSTED_INFERENCE=1` | turns the feature on; any other value is off |
| `MN_HOSTED_INFERENCE_KEY` | base64 of exactly 32 random bytes (AES-256-GCM). Missing or malformed with the flag on: the server boots, the feature reports `misconfigured`, one log line without the value |
| `MN_HOSTED_INFERENCE_ACCOUNTS` | comma list of auth.users ids allowed to use it (same format and parser as `GM_ACCOUNT_IDS`, max 32). Empty: nobody |
| `MN_HOSTED_INFERENCE_MAX` | concurrent hosted companions on the server, default 2, range 1-8; one per owner |
| `MN_HOSTED_INFERENCE_DIR` | data directory; compose sets `/var/lib/marea-companions` (named volume `marea-companions`) |

## Storage

- `<dir>/owners/<sha256(ownerId)>/inference.json`: the existing inference center store (server/agent/inference-center.mjs),
  with the API key sealed: AES-256-GCM, random 12-byte IV, AAD `<sha256(ownerId)>:<endpointId>`. The plaintext key never
  touches disk, logs, views, snapshots or errors; views expose `keyHint` (last 4 characters, keys of 8+ characters only).
- `<dir>/owners/<sha256(ownerId)>/companions/<sha256(characterKey)>/`: the hosted controller's files (memory, budget,
  paired manifest), same layout as a PC-paired directory.
- Limits: 8 connections per owner; label 1-48 chars; base URL up to 300 chars; key up to 400 chars (empty allowed);
  model id up to 200 chars.

## Egress fence (every server request to a user URL: probe and completion)

`https:` only, no userinfo, no redirects. Resolve the hostname (all addresses) and refuse if any address is loopback,
private, link-local, CGNAT, unspecified, multicast, broadcast, reserved or documentation: IPv4 0/8, 10/8, 100.64/10,
127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4;
IPv6 ::, ::1, fc00::/7, fe80::/10, ff00::/8, 2001:db8::/32, and IPv4-mapped (::ffff:0:0/96) or NAT64 (64:ff9b::/96)
addresses checked as their embedded IPv4. Connect to the vetted address (pinned lookup) with SNI and Host set to the
hostname. Refusal code: `egress_blocked`. Tests may inject a permissive fence; production code has no switch to relax it.
Same size and time limits as IC01 (models 10 s and 1 MiB; completion 30 s, 16 KiB in, 256 KiB out).

## Wire contract (PROTOCOL_VERSION 70)

Client -> server `MSG.HOSTED_INFERENCE` (`'hosted_inference'`), exact keys only:

| op | fields besides `t`, `requestId` (`/^[A-Za-z0-9_-]{1,100}$/`), `op` |
|---|---|
| `load` | none |
| `save` | `endpoint: { id: string or null, label, baseUrl, apiKey?, defaultModel: string or null }`; `id: null` creates; omitting `apiKey` keeps the stored key, `''` clears it |
| `delete` | `id` |
| `probe` | `id` |
| `test` | `id`, `modelId`, `prompt` (1-2000 chars) |
| `start` | `character`, `endpointId`, `modelId` |
| `stop` | `character` |

Server -> client `MSG.HOSTED_INFERENCE_RESULT` (`'hosted_inference_result'`):
`{ t, requestId, op, ok, why, state, test? }`. A result with `requestId: null` and `op: 'status'` is pushed to the owner's
sockets when a hosted companion changes status.

- `state`: `{ available, reason, endpoints, companions, limits }`
  - `available`: boolean; `reason`: `null`, `'disabled'`, `'not_allowed'` or `'misconfigured'`. When not available,
    `endpoints` and `companions` are empty arrays.
  - `endpoints[]`: `{ id, label, baseUrl, keyHint, defaultModel, models, catalogUpdatedAt, catalogError, usage }`,
    `usage = { requests, failures, promptTokens, completionTokens }`.
  - `companions[]`: `{ character, name, status, endpointId, modelId, error }`, `status` one of `stopped`, `starting`,
    `running`, `failed`; `name` may be null; `error` a why code or null.
  - `limits`: `{ maxEndpoints: 8, maxRunning }`.
- `test` (only on `op: 'test'` with `ok: true`): `{ text, usage, latencyMs, servedModel, modelMismatch }`, `text` at most
  2000 characters, `usage` the IC01 shape `{ inputTokens, outputTokens }` or null (endpoint `usage` keeps
  `promptTokens`/`completionTokens`).
- `why` (null when ok): `forbidden`, `disabled`, `not_allowed`, `misconfigured`, `invalid_request`, `busy`, `limit`,
  `endpoint_unknown`, `model_unknown`, `egress_blocked`, `not_created`, `stopped` (connection not allowed),
  `presence_body_required`, `unavailable`, and the IC01 provider codes `http_status`, `invalid_json`, `invalid_response`,
  `transport_error`, `timeout`, `response_too_large`, `content_type`, `output_limit`, `truncated`, `content_filter`,
  `incomplete`, `storage_error`.
- Rates per owner: probe and test 6 per minute; save and delete 20 per minute; start and stop 10 per minute (`busy`).

## Hosted controller

The server issues a pairing code for the owner and character through the pairing service, then runs the same controller as
the PC (`server/agent/paired-companion.mjs`) in hosted mode: it connects to `ws://127.0.0.1:<PORT>/ws` with the public
origin, claims the code, and its mind is the endpoint mind (`createEndpointOpenAIMind`) with the decrypted endpoint, thinking
mode `server_default` (no `chat_template_kwargs` sent to third-party providers), and the limits of the documented PC
command (`maxCalls 8`, `maxTokens 262144`). Same preconditions as the PC flow: companion created, connection allowed, body
summoned. Not restored after a server restart.

## Known limits

- o-series and gpt-5 models reject `max_tokens` and `temperature: 0` (HTTP 400, shown as `http_status`).
- Memory lives on the VPS volume, not in Supabase backups.
