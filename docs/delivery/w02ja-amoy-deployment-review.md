# W02j-a — datos de despliegue experimental revisables, sin firma

Fecha: 2026-10-08. **Preparación offline implementada; 78/78 seleccionadas locales.**
[Brief](../briefs/w02ja-amoy-deployment-review.md), [evidencia](w02ja-amoy-deployment-review-evidence.json),
[plan](../../PLAN-WEB3.md), [módulo](../../tools/web3-evm-lab/amoyDeployment.mjs),
[comando](../../tools/web3-evm-lab/prepare-amoy-deployment.mjs).

## Resultado

`prepareAmoyDeployment({chainId,deployerAddress,mintOperatorAddress})` exige exactamente tres
propiedades de datos propias en un registro normal o sin prototipo. Rechaza Proxy sin traps,
accessors sin invocación, extras/faltantes, chain distinta del número 80002 y direcciones
inválidas/cero/checksum mixto incorrecto. Normaliza direcciones EIP-55; no acredita control,
tipo EOA/contrato, disponibilidad de fondos ni capacidad del operador para firmar.

Recompila W02i con solc/OpenZeppelin fijados y compara la serialización completa byte a byte
contra `artifacts/amoy-reader-721.json`. Ninguna entrada suministra ABI/bytecode o rutas alternativas.
`encodeDeployData` concatena bytecode de creación y el constructor con el operador explícito;
informe contiene `from` del deployer, chain hexadecimal `0x13882`, `data` y `value:0x0`.
Deployer y operador independientes; no asumir que el deployer obtiene permiso de acuñación.

El informe no contiene `to`, gas, nonce, gas price/fees, dirección futura de contrato, firma ni
hash de transacción. Es una preparación parcial para revisión, no una solicitud lista para enviar:
requiere red/identidad verificadas, simulación, presupuesto y firma en el corte siguiente.

SHA-256 de los bytes UTF-8 del artefacto; keccak256 del bytecode de creación y runtime esperado.
Para el runtime exige un solo immutable referenciado en dos posiciones, cada una de 32 bytes,
dentro de límites, sin solapamiento y con placeholders cero; inserta `mintOperator` con padding.
Creación base **4591 bytes**, datos con constructor **4623 bytes**, runtime **3904 bytes**.
Runtime/hash depende del operador; estos datos no identifican una dirección pública desplegada.

`networkVerified:false`; `readiness.offlinePrepared:true` y `rpcSimulated`, `gasEstimated`,
`signed`, `broadcast`, `deployed` en false. No hay RPC, API de firma/envío ni lectura de claves.
Fallos del build/filesystem/librería se reducen a `artifact`, sin imprimir paths/mensajes.

## Uso con direcciones públicas explícitas

Desde la raíz, con dependencias del laboratorio ya instaladas y el artefacto W02i válido:

```powershell
node tools/web3-evm-lab/prepare-amoy-deployment.mjs --help
$env:MN_WEB3_WALLET_CHAIN_ID = '80002'
$env:MN_WEB3_AMOY_DEPLOYER_ADDRESS = Read-Host 'Direccion publica del deployer 0x...'
$env:MN_WEB3_AMOY_MINT_OPERATOR_ADDRESS = Read-Host 'Direccion publica del operador 0x...'
npm.cmd --prefix tools/web3-evm-lab run prepare:amoy
```

No ejecutar esos prompts con claves privadas/frase semilla. CLI lee solo las tres variables
indicadas, sin cargar `.env`, cliente del juego o configuración RPC. `--prepare` emite
`{ok:true,report}` en stdout; argumentos inválidos, exit 2/`arguments`; configuración o artefacto
inválidos, exit 1/`input` o `artifact`. No escribe archivos de salida ni cambia el artefacto.
El informe contiene direcciones públicas y bytecode, no un secreto ni un permiso de gasto.

El comando no se ejecutó con direcciones del autor, aún ausentes. Pruebas usan direcciones
sintéticas explícitas; no las adoptar como operador/deployer del piloto público.

## Verificación y límites

**78/78: 10 nuevas + 68 regresión W02d/e/f/g/h/i**, 0 fallos/canceladas/omitidas/todo,
duración **27681.6304 ms**. No es toda la suite del juego.

```powershell
node --test tools/web3-evm-lab/amoy-deployment.test.mjs tools/web3-evm-lab/amoy-pilot.test.mjs tools/web3-evm-lab/reader-evm.test.mjs tests/web3-amoy-check.test.mjs tests/web3-erc1155-reader.test.mjs tests/web3-edition-read-cli.test.mjs tests/web3-erc721-reader.test.mjs tests/web3-token-read-cli.test.mjs tests/web3-wallet-preflight.test.mjs
```

Constructor/data exactos, hashes, report determinista/canonicalización, límites de input y runtime
contrastado contra EthereumJS. CLI en entorno mínimo, RPC/key dummy ignorados, `.env` dummy aislado
no cargado y fuentes sin mutación; artefacto alterado/ausente probado en copia temporal separada.
Limpieza de scratch con contención previa. Luna escribió nueve pruebas y revisó el resultado;
principal agregó rechazo de artefactos alterados/ausentes sin modificar el entregado, igualdad
completa del calldata, canonicalización con letras y contención de borrado, e integró/aceptó 78.

Cero RPC externos, transacciones firmadas/enviadas, NFT públicos o gas pagado en este corte.
La red 80002 del ensayo es sintética: no acredita Amoy ni el hardfork Cancun del endpoint real.
Sin cambios de contrato Solidity, artefacto W02i, dependencias/lock, root package, frontend/host,
sim/perfiles/protocolo, SQL (incluida 013)/Supabase, `.env` real, proveedor o Git/publicación.
Pruebas previas conservan sus límites; sus ledgers son snapshots históricos, no los reescribe W02j-a.

## Dirección del taller registrada y siguientes pasos

El autor aprobó [W05 taller modular](../briefs/w05-modular-equipment-direction.md): componentes
de catálogo pueden aportar diferencias de stats; diseño/plano, receta/materiales/oficio e instancia
separados. Sable con pocas piezas primero, GLB/IA/escultura/armaduras después. Solo dirección de
producto, sin crear piezas/recetas/editor y sin adelantarlo sobre W02/equipo/tierra.

**W02j-b pendiente:** dirección pública y wallet del operador/deployer, RPC y POL de prueba;
simulación/estimación pública y presupuesto antes de firma. **W02j-c pendiente:** envío y recibos,
comparación de runtime, mint/transfer y lectura histórica pública, sin reenviar operaciones inciertas.
Supabase/origen/vínculo/extensión y proyección jugable conservan aceptación separada.

Reuso: viem/toolchain/artefacto W02i y ejecutor W02g. Inventario Unreal/FAB revisado: RepairBench
y StoragePart aportan arte de taller/bodega, no lógica de preparación contractual; no arte nuevo.

Fuentes: [codificación de constructor viem](https://viem.sh/docs/contract/encodeDeployData),
[checksum viem](https://viem.sh/docs/utilities/getAddress),
[Amoy en Polygon](https://docs.polygon.technology/pos/reference/rpc-endpoints).
La semántica usada se contrastó también con el código instalado viem 2.57.3; no se invoca
`deployContract` ni cliente de wallet. Esas fuentes no prueban despliegue o tarifas del piloto.
