# W02h — primera comprobación RPC pública de Amoy

Fecha: 2026-10-08. **Implementado, 58/58 seleccionadas locales y diagnóstico público satisfactorio.**
[Brief](../briefs/w02h-amoy-rpc-check.md), [consulta pública](w02h-amoy-rpc-live.json),
[evidencia](w02h-amoy-rpc-check-evidence.json), [plan](../../PLAN-WEB3.md).

## Entrega y reproducción

`server/web3/amoyRpcProbe.mjs` reutiliza el transporte acotado existente; el comando independiente
`tools/web3-amoy-check.mjs --check` confirma Amoy (`80002`), observa un bloque `latest`, consulta
`eth_getCode` y `eth_call` mediante `{blockHash,requireCanonical:true}` y relee esa altura.
La llamada usa identity precompile `0x04`, una carga fija con bytes `00/ff/0a` y texto, y gas
de simulación fijo `60000`. Exige código de cuenta vacío, echo exacto y los cuatro campos de bloque
inalterados. Cinco solicitudes secuenciales, sin reintentos, fallback o elección automática de URL.

```powershell
$env:MN_WEB3_WALLET_CHAIN_ID = '80002'
$env:MN_WEB3_RPC_URL = 'https://polygon-amoy.drpc.org'
node tools/web3-amoy-check.mjs --check
```

Estas variables pertenecen al proceso de quien ejecuta el comando; no se modifica `.env`.
No requiere activar Web3, Supabase, origen del juego, wallet o fondos. `--help` y argumentos inválidos
son inertes. Las salidas contienen datos reducidos o códigos de fallo fijos, sin URL/claves ni
mensajes del proveedor. El deadline es por solicitud: por defecto hasta cinco veces 10 segundos.
No cambia `rpcProbe.observe()` de W02d, transporte, lectores, dependencias o montaje del juego.

## Verificación separada

**58/58 seleccionadas locales: 9 nuevas + 49 W02d/e/f/g**, sin fallos, canceladas u omitidas;
duración registrada 3485.3461 ms. No es la suite completa del repositorio.

```powershell
node --test tests/web3-amoy-check.test.mjs tools/web3-evm-lab/reader-evm.test.mjs tests/web3-erc1155-reader.test.mjs tests/web3-edition-read-cli.test.mjs tests/web3-erc721-reader.test.mjs tests/web3-token-read-cli.test.mjs tests/web3-wallet-preflight.test.mjs
```

Configuración/red equivocadas, bloques inválidos/ausentes, código/echo inesperado, cambios de
altura/hash/padre/timestamp, fallo EIP-1898 sin fallback, timeout aun si fetch ignora abort y
redacción de errores probados. CLI por fetch nativo loopback, proceso con entorno mínimo,
señuelo `.env` aislado y cerrado/limpiado con contención comprobada. Revisión Luna de fuentes y
primeras siete pruebas; principal revisó, amplió y aceptó el pase final. Sintaxis y enlaces revisados.

**Consulta pública real separada**, 2026-10-08, 21:55:49–21:55:52 UTC: CLI ejecutado con entorno
mínimo y fetch nativo contra `https://polygon-amoy.drpc.org`. Exit 0, stderr vacío, red `80002`,
bloque `0x2f5f764`, hash
`0x6a29ea4ed8b0a4c4cbc56cae3034b4c4baedcb07ac7a8e82f2accd18ffd17b47`;
ambos selectores aceptados, echo correcto y bloque estable al releer. [Registro](w02h-amoy-rpc-live.json).
Cinco llamadas del CLI y cinco exploratorias previas: **10 consultas RPC externas, cero transacciones
firmadas/enviadas y cero gas pagado**. Este uso puntual no configura ni selecciona proveedor permanente.

## Interpretación y fuentes

Polygon documenta Amoy `80002` y ese endpoint público; advierte que RPC públicos pueden tener
límites/restricciones. [Polygon RPC endpoints](https://docs.polygon.technology/pos/reference/rpc-endpoints).
[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898) define los selectores por hash y petición de
canonicalidad para code/call. El [Yellow Paper](https://ethereum.github.io/yellowpaper/paper.pdf),
apéndice E.3, y [Bor](https://github.com/0xPolygon/bor/blob/develop/core/vm/contracts.go) describen
identity en `0x04`: devuelve los bytes de entrada mediante implementación nativa. El código vacío
de esa cuenta no significa ausencia de su función.

Este diagnóstico comprueba **aceptación del formato de selector y comportamiento observado**.
Identity es independiente de estado: un servidor que ignore el hash podría producir el mismo echo.
No se comprueba rechazo real de hashes inexistentes/no canónicos, historial de estado, conformidad
completa EIP-1898, honestidad, consenso/finalidad ni disponibilidad continua. `finalityVerified:false`
se conserva en el resultado. Los lectores NFT siguen ensayados localmente, sin contrato público conocido.
No mide gas/tarifas ni verifica OpenSea, wallets/extensiones, Supabase o permisos del juego.

Fuentes Unreal/FAB revisadas e intactas; sin candidato de lógica RPC/EVM portable. Sin migraciones
(incluida 013), `.env` real, perfiles/simulación/protocolo, SQL/Supabase, inicio/reinicio del host,
contratos/tokens públicos, pago, UI, commit/push o despliegue. Trabajo concurrente conservado.

W02 sigue parcial: preparar contrato experimental apropiado para Amoy y verificar allí los lectores
con acuñación/transferencia y bloque explícito; concretar origen/proveedor operativo y aceptar
Supabase/wallet reales. Los fixtures W02g no deben desplegarse. W03/W04 conservan las decisiones
abiertas de derechos, pérdidas y custodia antes de conceder uso jugable.
