# W02j-b — herramienta de simulación y estimación de creación

Fecha: 2026-10-09. **Implementada y verificada localmente: 97/97 seleccionadas.** La corrida
contra Amoy pública todavía no se realizó: faltan direcciones y endpoint explícitos del autor.
[Brief](../briefs/w02jb-amoy-deployment-simulation.md),
[evidencia](w02jb-amoy-deployment-simulation-evidence.json), [plan](../../PLAN-WEB3.md),
[módulo](../../tools/web3-evm-lab/amoySimulation.mjs),
[CLI](../../tools/web3-evm-lab/simulate-amoy-deployment.mjs).

## Comportamiento

`simulateAmoyDeployment(input, options)` exige exactamente cuatro propiedades de datos propias:
`chainId:80002`, `deployerAddress`, `mintOperatorAddress` y `simulationGasLimit` decimal en string.
Registros normales o sin prototipo; Proxy/accessors se rechazan sin traps/getters. Direcciones
validadas y normalizadas por W02j-a, sin asumir control/capacidad de firma. Límite de simulación
explícito 53000..30000000; es un límite técnico de esta herramienta y no una autorización de gasto.

Opciones de transporte: `url` explícita y opcionales `timeoutMs`/`fetchFn`, sin extras/accessors/Proxy.
Recrea W02j-a: recompila artefacto fijado, igualdad completa byte a byte y constructor exacto.
Ninguna entrada proporciona ABI, bytecode, rutas alternativas o datos arbitrarios de transacción.
Datos de creación 4623 B, creación base 4591 B, runtime con operador inmutable 3904 B.

Siete consultas, en orden, sin retry/fallback:

1. `eth_chainId`, exigir 80002.
2. `eth_getBlockByNumber(latest,false)`, conservar número/hash/parent/timestamp/gasLimit.
3. `eth_gasPrice`, observar entero positivo; limitar producto con gas a uint256.
4. `eth_call` de creación, sin `to`: from/data/value cero/gas explícito/gasPrice observado,
   selector `{blockHash,requireCanonical:true}`. Exigir runtime completo con inmutables exactos.
5. `eth_estimateGas` con el mismo objeto, selector por **número** del bloque anterior.
   Exigir estimación >=53000 y <=límite; el límite también debe caber en gasLimit del bloque.
6. Releer ese número; exigir igualdad de los cinco campos del bloque.
7. Releer chain ID, exigir 80002.

EIP-1898 no estandariza hash para estimateGas: no presentar su selector numérico como selector
hash. Si el RPC rechaza cualquiera de los selectores, terminar; no degradar a latest. Bloque
estable, selector aceptado y runtime correcto no prueban consenso, honestidad, finalidad ni
conformidad RPC completa. El endpoint podría mentir/ignorar un parámetro; estas son comprobaciones
diagnósticas, no una prueba criptográfica de ejecución. Sin override de saldo/estado o contexto.

Reporte conserva datos/hashes W02j-a y añade bloque, selectores y checks, gas estimado,
gasPrice observado y productos decimales exactos en wei: `estimatedFeeWei` y
`simulationLimitFeeWei`. **El precio observado no está fijado al bloque y no es fee cap**;
los productos no aseguran la tarifa final ni prueban fondos. Son POL de prueba, sin cotización
USD/mainnet. Transacción revisable conserva ausencia de gas/nonce/fees/firma/dirección de contrato.
No arma una solicitud lista para enviar ni mide costos de mint/transfer de producción.

`rpcChainIdMatched:true`, `rpcSimulated:true` y `gasEstimated:true` indican las consultas
satisfactorias; `networkVerified:false`, `finalityVerified:false`, `signed:false`,
`broadcast:false`, `deployed:false` permanecen explícitos. También en fixtures locales.

Transporte privado del laboratorio: métodos fijos, HTTPS o HTTP loopback, sin credenciales URL/
fragmentos/espacios; redirect error y credentials omit. Timeout por consulta 10000 ms por defecto,
configurable 10..30000 ms, incluido cuerpo y fetch que ignore abort. Cuerpo declarado o recibido
máximo 1 MiB, UTF-8 estricto y envelope JSON-RPC/id exactos. Errores RPC crudos no salen del módulo;
cancelación best-effort no extiende el deadline. Transporte de lectores W02d/e/f/h intacto.

## Comando independiente

Desde la raíz, con dependencias locales instaladas:

```powershell
node tools/web3-evm-lab/simulate-amoy-deployment.mjs --help
$env:MN_WEB3_WALLET_CHAIN_ID = '80002'
$env:MN_WEB3_AMOY_DEPLOYER_ADDRESS = Read-Host 'Direccion publica del deployer 0x...'
$env:MN_WEB3_AMOY_MINT_OPERATOR_ADDRESS = Read-Host 'Direccion publica del operador 0x...'
$env:MN_WEB3_WALLET_RPC_URL = Read-Host 'URL del RPC Amoy elegido'
$env:MN_WEB3_AMOY_SIMULATION_GAS_LIMIT = Read-Host 'Limite decimal solo para simulacion'
npm.cmd --prefix tools/web3-evm-lab run simulate:amoy
```

Solo esas cinco variables; no carga archivos `.env`, claves o proveedor de wallet. Direcciones
públicas/calldata se envían al RPC explícito. Reporte/error no imprime URL ni mensajes privados.
`--simulate` emite `{ok:true,report}` JSON/stdout, sin archivos de salida. `--help` no compila/consulta;
argumentos inválidos (`--send` incluido), exit 2/`arguments`. Fallos, exit 1 y categoría cerrada:
input/configuration/artifact/rpc/response/chain/gas/runtime/block. No existe comando de envío.

No ejecutar estos prompts con secretos de wallet. No se ejecutaron con valores del autor:
pruebas usan direcciones sintéticas y loopback; no adoptarlas como operadores del piloto público.

## Evidencia local

**97/97: 19 nuevas (16 contrato/transporte/CLI + 3 EVM) + 78 regresión seleccionada W02d–j-a**,
0 fallos/canceladas/omitidas/todo, duración **40713.8233 ms**, exit 0. No es toda la suite del juego.

```powershell
node --test tools/web3-evm-lab/amoy-simulation.test.mjs tools/web3-evm-lab/amoy-simulation-evm.test.mjs tools/web3-evm-lab/amoy-deployment.test.mjs tools/web3-evm-lab/amoy-pilot.test.mjs tools/web3-evm-lab/reader-evm.test.mjs tests/web3-amoy-check.test.mjs tests/web3-erc1155-reader.test.mjs tests/web3-edition-read-cli.test.mjs tests/web3-erc721-reader.test.mjs tests/web3-token-read-cli.test.mjs tests/web3-wallet-preflight.test.mjs
```

Payload/selectores/secuencia/report, fail temprano, Proxy/getters/extras, runtime incorrecto,
gas/fee overflow y aritmética >MAX_SAFE_INTEGER, bloque/red cambiados, rechazo de selectores sin
fallback, envelopes/UTF-8/cuerpos inválidos/grandes/stall/deadline y errores privados redactados.
CLI en procesos de env mínimo, HTTP loopback y `.env` dummy en carpeta aislada; no lee env real.
Limpieza de scratch con contención comprobada. Luna escribió 14 pruebas; principal amplió límites,
aritmética exacta y rechazo de estimateGas, integró 16 + 3 EVM y aceptó el conjunto de 97.
Otro Luna revisó sin encontrar bugs materiales; su revisión no sustituye la ejecución principal.

EVM Cancun en memoria con ID 80002 **simulado**: ejecuta el initcode real dos veces por revisión,
calcula uso de ejecución + intrinsic/calldata/EIP-3860 y devuelve runtime real. Dos revisiones
idénticas conservan state root, nonce 7, balance sintético y ausencia de código en direcciones
creadas. No es algoritmo de estimación de un cliente público ni transacción firmada. Constructor
rechaza VM 137 aunque el RPC fixture anuncie Amoy; gas insuficiente también aborta sin estado residual.

**Cero RPC externos de esta herramienta, firmas, envíos, NFT públicos o gas pagado.** Sin cambios
de Solidity/artefacto W02i, dependencias/lock, root package, frontend/host/sim/perfiles/protocolo,
SQL013/Supabase, .env real, proveedor o Git/publicación. Ledgers anteriores son snapshots históricos.

Reuso comprobado: W02i/j-a, viem y parsers existentes, EthereumJS; inventario Unreal/FAB
SM_RepairBench y SM_StoragePart_03 son arte de taller/bodega, no lógica JSON-RPC. Sin nuevo arte.

## Lo que sigue

W02j-b **herramienta local lista**, aceptación pública pendiente de deployer/operador/RPC explícitos.
Antes de W02j-c: revisar resultado real, wallet/identidades de firma, fondos de prueba y presupuesto
acordado. W02j-c conserva firma/envío controlados, recibo/código, mint/transfer y lectura histórica
pública. Sin reemitir transacciones inciertas. Supabase/vínculo/origen/pagos/permisos jugables son aparte;
W05 modular sigue futuro, sin editor/piezas/recetas ni cambio de la cola.

Fuentes técnicas: [JSON-RPC Ethereum](https://ethereum.org/developers/docs/apis/json-rpc/),
[eth_call Geth](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-eth),
[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898). Se contrastó también estimateGas en viem
2.57.3 instalado (selector numérico); la herramienta usa RPC fijo propio sin cliente de wallet.
