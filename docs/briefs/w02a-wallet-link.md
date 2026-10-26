# W02a — vincular cuenta y wallet mediante firma

Fecha: 2026-10-07. Continuación autorizada del [plan Web3](../../PLAN-WEB3.md).
Implementar prueba EOA ERC-191 / mensaje SIWE; no elegir red comercial ni desplegar contratos.
La wallet complementa Supabase Auth: no sustituye cuenta/personaje ni concede propiedad/uso/pagos.

## Autoridad y contrato

- `createWalletLinkService({store,origin,chainId,ttlMs=300000,now=Date.now})` requiere origin HTTPS
  exacto (HTTP solo localhost/127.0.0.1/[::1]), chainId entero positivo <=2147483647 y TTL 30–600 segundos.
  Métodos internos: `issue(accountId,{address,chainId})`, `verify(accountId,{challengeId,message,signature})`,
  `loadLink(accountId)`. accountId siempre viene de autenticación del servidor.
- Mensaje generado por el servidor mediante `viem/siwe`: scheme/domain del origin configurado,
  URI `${origin}/web3/wallet`, version 1, chainId fijo, nonce 32 bytes aleatorios en hex, issued/expiration,
  requestId challengeId y cuenta incluida en statement de vinculación sin permiso de compra/transferencia.
- Se exige el mensaje exacto persistido y reconstruido con la política vigente. Se recupera la dirección
  de la firma ERC-191 con viem. Sin RPC ni soporte ERC-1271 en este corte; no se comprueba estado/tokens
  de la red. Firma hex de 65 bytes. Direcciones validadas y almacenadas lower-case, rechazando cero.
- Una cuenta tiene un vínculo; `(chainId,address)` tiene una sola cuenta. No overwrite, unlink/rebind,
  creación de sesión de juego por firma, delegación ni acceso de agentes a gasto.
- Un intento de verificación autorizado y con DTO válido consume el reto aunque la firma/mensaje
  sean incorrectos. Dos verificaciones simultáneas: una sola completa. Replays devuelven `used`.
  Cuenta distinta no consume el reto. Expiración se comprueba de nuevo al completar, con reloj DB
  en persistencia SQL. Respuesta perdida: consultar vínculo autenticado; no repetir venta/mint.

## Storage interno

`walletContract.mjs`, `walletStore.mjs`; referencia memory no durable y adaptador Supabase RPC.
Reto exacto: `{challengeId,accountId,address,chainId,nonce,message,issuedAt,expiresAt}`. UUIDs canónicos
no cero; dirección lower-case 0x + 40 hex; nonce 64 hex lower-case; message string 1–2048 bytes ASCII;
timestamps epoch-ms enteros positivos <=253402300799999 y duración 30000–600000 ms.
Vínculo exacto: `{accountId,address,chainId,challengeId}`.
Registro leído: `{challenge:reto,state:'pending'|'used',result:null|resultadoTerminal}`.
Resultado terminal: `{ok:true,link}` o `{ok:false,why:'signature'|'expired'|'conflict'}`.

- `store.issue(reto)` → `{ok:true,replay:boolean,challenge:reto}` o `{ok:false,why:'identity'|'busy'|'linked'|'expired'}`.
  Mismo ID/request devuelve reto solo si pending y vigente; ID con otro request falla identity.
  Hay un pending por cuenta. Repetir issue tras respuesta perdida devuelve pending vigente si dirección/red
  coinciden; cambiar dirección mientras pending devuelve busy. Expirado se termina y permite nuevo reto.
  Cuenta vinculada devuelve linked. Nonce único global. Issue rechaza reloj futuro >10 segundos y expirado.
- `store.complete(challengeId,accountId,verified)` → terminal resultado, o `{ok:false,why:'missing'|'used'}`.
  Verified es boolean interno establecido por el verificador del servidor, jamás un campo público.
- `store.loadChallenge(challengeId)` → registro o null; `store.loadLink(accountId)` → vínculo o null.
- `createSupabaseWalletStore(client,{timeoutMs=10000})` acota cada RPC y transmite AbortSignal al SDK.
  Timeout no demuestra rollback; consultar reto/vínculo antes de seguir, sin reintentos automáticos.
- RPCs: `mn_web3_wallet_issue(p_request jsonb)`,
  `mn_web3_wallet_complete(p_challenge_id uuid,p_account_id uuid,p_verified boolean)`,
  `mn_web3_wallet_challenge(p_challenge_id uuid)`, `mn_web3_wallet_link(p_account_id uuid)`.

SQL opcional `server/migrations/web3/002_wallet_link.sql`, schema `mn_web3_private`, independiente
de SQL del juego y aplicable sin W01. Tablas `wallet_challenges` y `wallet_links`; DML/truncate directo
denegado a service_role, RPCs solo service_role y helpers revocados. Funciones SECURITY DEFINER,
search_path vacío, nombres cualificados y mutadores solo read committed. Orden locks: challenge UUID,
cuenta UUID, wallet `(chainId,address)`. Nonce exclusivo y unicidad cuenta/wallet; reto, consumo y vínculo
transaccionales. Errores SQL de input `MNW11`, aislamiento `MNW12`; no guardar firmas, bearer ni claves.

## HTTP opt-in y reutilización

Handler `walletHttp.mjs` montable por opción explícita `walletLink` de `createGameServer` antes del guard
GET/HEAD; npm start permanece apagado. Usa `resolvePlayer(req,{token})` existente con Bearer validado;
body jamás contiene accountId. POST requiere Origin exacto; GET puede omitirlo para fetch del mismo
sitio, pero rechaza Origin distinto o Sec-Fetch-Site cross-site. Bearer es obligatorio para ambos;
sin cookies de autenticación ni wildcard CORS.
GET `/web3/wallet/link`; POST `/web3/wallet/challenge` `{address,chainId}`;
POST `/web3/wallet/verify` `{challengeId,message,signature}`. JSON máximo 4096 bytes, lectura máxima
5 segundos y cada espera de auth/backend máxima 12 segundos (configurables internamente),
no-store, fallos fijos sin texto privado y métodos estrictos. Sin modificación de host/sim/perfiles/WS.
La referencia memory solo sirve para pruebas/desarrollo; los vínculos reales requieren el store durable.

Reutilizar autenticación stateless Supabase, W01 DTOs y patrones PGlite. Inventario Unreal/FAB revisado:
ningún modelo/textura resuelve autenticación; sin nuevos assets ni cambios a fuentes Unreal.
[ERC-4361](https://eips.ethereum.org/EIPS/eip-4361),
[createSiweMessage](https://viem.sh/docs/siwe/utilities/createSiweMessage),
[recoverMessageAddress](https://viem.sh/docs/utilities/recoverMessageAddress).

Aceptación: firma EOA real local; rechazo de firma/origin/cuenta/mensaje/red/expiry/replay inválidos,
unicidad y no overwrite; pérdida de respuesta/reapertura de storage; ACLs SQL e inputs malformados;
HTTP real opt-in con getUser del proveedor simulado y rechazo de invitados. Regresión cuenta/Web3.
Pruebas locales no equivalen a Supabase live, wallet de navegador, RPC/testnet ni publicación.
