# IC08: hosted inference, the companion's model entered in the game and run on the server

Tickets T-1022-45 (move), T-1022-46 (kit re-skin), T-1022-47 (client), T-1022-48 (server). AREA17, 2026-10-22.
Contract: [docs/briefs/ic08-hosted-inference.md](../briefs/ic08-hosted-inference.md). No SQL. Protocol 69 -> 70 and
version 0.6.0-alpha.97 -> 0.6.0-alpha.98. Decided by Joi: URL, key and model are typed in the game, the server keeps the
key encrypted and runs the mind on the VPS; the PC flow (Studio and `pair-companion.mjs`) keeps working.

## What changed

- `server/agent/` (T-1022-45): the 33-file runtime closure of the paired controller, the inference center and the
  endpoint transport moved from `tools/agent/` so it ships in the release image (the image and the installed updater only
  carry `src/`, `server/`, `styles/`, `assets/`, `deploy/`). `tools/agent/<file>.mjs` are one-line re-export shims;
  `create-companion.mjs` keeps its CLI through `runCreateCompanionCli`.
- `server/hostedInference.mjs`: `HostedInferenceService` (message `hosted_inference`, ops load, save, delete, probe, test,
  start, stop; result `hosted_inference_result`, plus `op: 'status'` pushes), gating by env, per-owner rates, one hosted
  companion per owner and `MN_HOSTED_INFERENCE_MAX` in total, AES-256-GCM sealing (`v1.<iv>.<ct+tag>`, AAD owner hash and
  endpoint id).
- `server/agent/egress-guard.mjs`: https only, every resolved address checked (private, loopback, link-local, CGNAT,
  reserved, multicast, documentation, IPv4-mapped and NAT64 forms), the connection pinned to the vetted address with
  SNI and Host set to the hostname, no redirects. Used by the probe and the completion in hosted mode only.
- `server/agent/inference-center.mjs`, `endpoint-openai-transport.mjs`, `local-openai-mind.mjs`: optional sealer, egress
  fence and endpoint cap; without them (PC Studio) behaviour and file format are unchanged.
- `server/agent/paired-companion.mjs`: hosted mode (loopback `ws://127.0.0.1:<PORT>/ws` with the public origin, endpoint
  mind with `thinkingMode server_default`, manifest kind `hosted-openai-compatible` without URL or key).
- `server/companionPairing.mjs`: the owner `issue` body is `ownerOperation()`; `issueHosted(sock, character)` runs it for
  the hosted start with the same preconditions and why codes. Claim and admission are unchanged.
- `deploy/`: named volume `marea-companions` at `/var/lib/marea-companions`, `MN_HOSTED_INFERENCE_DIR`, the directory owned
  by node in the image; `marea-negra.env.example` documents the four switches.
- Client: `src/client/hostedInference.js` and `src/ui/hostedInference.js` (connections, probe, test, companions with
  start and stop); "Mis compañeros -> Centro de inferencia" opens it instead of the L03d panel (L03d code stays).
- Look (T-1022-46): `styles/companions.css` gives the five companion panels the UI kit of the inventory and the skill tree
  (navy plates, steel hairlines, orange brush primary actions, Barlow italic caps); the modules keep only layout CSS.

## Validation

- New tests 17/17: `hosted-inference-server-{fence,service,room}` (9) and `hosted-inference-{client,ui}` (8). The room
  test pairs a hosted controller in an in-process host with ORIGINS enforced and gets a chat reply from a fake endpoint.
- Companion, pairing, presence, Studio and transport suites 170/170, unchanged; companion UI suites 49/49; deploy gate
  386/386 (60 files). `i18n-hardcoded` keeps its one pre-existing failure.
- Screenshots outside git: scratchpad `t46/` (re-skin) and `area17-market/.scratch/t47/` (hosted center).

## Turning it on (Joi, alpha.env on the VPS)

`MN_HOSTED_INFERENCE=1`, `MN_HOSTED_INFERENCE_KEY` (`openssl rand -base64 32`, keep a copy off the VPS: losing it makes
stored keys unreadable, owners re-enter them), `MN_HOSTED_INFERENCE_ACCOUNTS` (raw auth.users ids, same format as
`GM_ACCOUNT_IDS`), optional `MN_HOSTED_INFERENCE_MAX` (default 2). Never `docker compose down -v`: it deletes the volume.

## Known limits

- o-series and gpt-5 reject `max_tokens` and `temperature: 0` (`http_status`). Model ids over 128 characters are refused.
- Each hosted controller uses one socket against `MAX_PLAYERS + 4`. Deleting a connection does not stop a running
  companion; it keeps its key in memory until it stops. Nothing is restored after a restart. Memory lives on the volume,
  not in Supabase. `/status` has no hosted readiness flag yet.
