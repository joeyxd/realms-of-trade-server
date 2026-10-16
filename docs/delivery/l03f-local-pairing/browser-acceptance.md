# L03f local pairing browser acceptance

Local browser acceptance for the owner-to-controller pairing flow. This records implementation evidence only; it is not a production or deployment check.

## Result

Chrome headless with ANGLE default passed **14/14 checks** on 2026-10-12 UTC. The flow created Brisa, loaded the prepared record into the pairing registry, committed the owner's explicit `Permitir conexión` action through SQL027, opened `Conectar en mi PC`, issued a five-minute one-use code, and checked revoke, expiry, and logout cleanup.

The fixture applied SQL001, SQL025, SQL027, and SQL034 to temporary local PGlite. Creation, configuration, and control calls use their SQL RPC adapters. Supabase authentication is simulated and gameplay uses the memory store, so this does not establish production authentication or durable gameplay behavior. No controller process, admission, or model inference ran.

The code was held in test memory for assertions, but was not written to the evidence JSON or other storage and never appeared in the URL. Every screenshot containing the code was taken after replacing it with a mask. The recorded checks confirm no code in browser storage or navigation.

On mobile 390×844, the pairing panel scrolls vertically. The final screenshot shows that scrolling exposes the 44 px `Revoke connection` control. Logout coverage simulates the auth sign-out event, verifies immediate browser-code clearing, then closes the gameplay socket to exercise the server's owner-disconnect cleanup.

## Evidence

- [Machine-readable browser results](browser/browser.json)
- [Prepared Brisa, desktop ES](browser/pairing-desktop-es-prepared.png)
- [Pairing code masked, desktop ES](browser/pairing-desktop-es-code-masked.png)
- [Pairing code masked, mobile EN](browser/pairing-mobile-en-code-masked.png)
- [Mobile revoke control visible, code masked](browser/pairing-mobile-en-revoke-visible-code-masked.png)

All four screenshots were visually inspected. The pairing panel and code are legible on desktop and mobile, and the mobile revoke action is reachable after scrolling.

## Reproduce

From the repository root, run:

```powershell
node tools/qa-companion-pairing.mjs
```

The script writes the JSON and screenshots under `docs/delivery/l03f-local-pairing/browser/`.
