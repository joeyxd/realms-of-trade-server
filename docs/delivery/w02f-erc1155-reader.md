# W02f — lector de cantidades ERC-1155

Fecha: 2026-10-08. **Implementado y verificado localmente.**
[Contrato](../briefs/w02f-erc1155-reader.md), [plan](../../PLAN-WEB3.md),
[evidencia](w02f-erc1155-reader-evidence.json).

El servidor puede observar cuántas copias de un tipo ERC-1155 tiene una dirección en un bloque explícito.
Complementa el lector ERC-721 para preparar ediciones de apariencias y contenido de creadores.
Los saldos se conservan como strings decimales exactos, incluso cero y uint256 máximo.
No concede licencias/uso ni convierte una edición con varias copias en activos únicos W01.

## Uso

```powershell
node tools/web3-edition-read.mjs --help
node tools/web3-edition-read.mjs --read
```

| Variable del proceso | Entrada requerida |
|---|---|
| `MN_WEB3_RPC_URL` | Endpoint explícito del operador, server-only |
| `MN_WEB3_WALLET_CHAIN_ID` | Red exacta; Amoy `80002` para el piloto elegido |
| `MN_WEB3_READ_CONTRACT` | Contrato ERC-1155 no nulo que se quiere examinar |
| `MN_WEB3_READ_HOLDER` | Dirección no nula cuyo saldo se consulta |
| `MN_WEB3_READ_TOKEN_ID` | Decimal canónico uint256, incluido `0` |
| `MN_WEB3_READ_BLOCK_NUMBER` | Altura hex mínima del bloque esperado |
| `MN_WEB3_READ_BLOCK_HASH` | Hash esperado, 32 bytes no nulos |

No se infiere wallet de la cuenta ni se escoge latest. Altura/hash deben proceder del bloque que el
operador pretende examinar. No necesita Supabase, wallet vinculada o activar el flag Web3.
Puede cargarse un archivo privado explícitamente mediante
`node --env-file="C:\ruta\privada\piloto.env" tools/web3-edition-read.mjs --read`.
`npm start` no ejecuta el comando. La plantilla solo añade comentarios; `.env` real intacto.

Éxito devuelve versión/red/contrato/tipo/holder/saldo/bloque reducido. Fallo sale con 1 y
`{ok:false,why:<código fijo>}`; argumentos incorrectos salen con 2. `--help` no hace peticiones.
No imprime URL/clave RPC, causa cruda, bytecode ni campos extra del proveedor.

## Comprobaciones y límites

Reutiliza `rpcTransport.mjs` sin cambios. Ocho lecturas fijas: red, bloque, código, handshake ERC-165,
interfaz ERC-1155, balanceOf y relectura del bloque. Calldata fijado por el adaptador;
contrato/holder/token explícitos. Código y eth_call usan hash canónico con
[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898), sin fallback si el RPC rechaza ese formato.
ABI/interfaz siguen [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) y
[ERC-165](https://eips.ethereum.org/EIPS/eip-165). Presupuestos eth_call 60000/200000 incluyen
coste intrínseco y no prueban el límite STATICCALL ERC-165. Sin gas de transacciones o llamadas de pago.

Cero es saldo observado, no error ni prueba de inexistencia del tipo. Revert, rechazo, respuesta
inválida o timeout producen fallo. Ni siquiera un saldo positivo prueba licencia, tirada, contrato
auténtico o permisos; tampoco la observación acredita finalidad o impide reorganizaciones posteriores.
El lector no registra tokens/activos, actualiza cuentas, reserva copias ni activa contenido en el juego.
Custodia, reservas por cantidad, confirmación y proyección requieren cortes posteriores.

## Verificación

**42/42 seleccionadas locales: 15 nuevas (12 adaptador + 3 CLI) y 27 de regresión W02d/e.**
Cero fallos, canceladas, omitidas o todo; no es la suite completa del repositorio.

```powershell
node --test tests/web3-erc1155-reader.test.mjs tests/web3-edition-read-cli.test.mjs tests/web3-erc721-reader.test.mjs tests/web3-token-read-cli.test.mjs tests/web3-wallet-preflight.test.mjs
```

ABI contrastado con encodeFunctionData/decodeFunctionData de viem, independientes del encoder propio.
Pruebas de uint256 cero/máximo y >2^53 sin redondeo, inputs exactos/accesores/Proxy/prototipo nulo,
copia antes de await y consultas concurrentes por holder/token. Red/bloque/interfaces/código/ABI incorrectos
interrumpen sin saldo inventado; errores redactados y deadlines de fetch/cuerpo verificados.
CLI en procesos separados con fetch nativo contra loopback, saldos cero/máximo, `.env` trampa ignorado,
holder ausente/nulo, rechazo EIP-1898, revert y ABI inválido sin fallback. W02d/e conservan sus pruebas.

La revisión independiente detectó acceso a campos de Proxy tras validar descriptores; se corrigió
rechazando Proxy antes de reflexión y copiando los valores de los descriptores. Pase final 42/42.
Sintaxis, whitespace, UTF-8 sin BOM y enlaces locales revisados. No hay UI nueva que requiera capturas.
Inventario Unreal/FAB revisado e intacto; transporte propio reutilizado y cero nuevas dependencias.

Contratos/RPC son fixtures locales, sin EVM ni contrato/token desplegado o lectura de Amoy real.
Sin Supabase externo, SQL, host del autor, firmas, transacciones, mint, approvals, pagos, commit/push/deploy
o indexación OpenSea. Trabajo concurrente preservado, ledgers históricos intactos.
Sigue concretar origen/RPC y verificar servicios/wallet/contratos reales en Amoy; W02 permanece parcial.
