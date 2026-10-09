# Laboratorio local de lectores Web3 — W02g/W02i

Ejecuta bytecode Solidity de fixtures ERC-721/ERC-1155 en una EVM desechable y prueba los lectores
y CLIs W02e/f existentes contra HTTP loopback. No requiere wallet, RPC externo, Supabase o `.env`.
[Entrega y evidencia](../../docs/delivery/w02g-local-evm-rehearsal.md).

Desde la raíz del repositorio, con Node 24 o superior:

```powershell
npm.cmd --prefix tools/web3-evm-lab ci --ignore-scripts --no-audit --no-fund
npm.cmd --prefix tools/web3-evm-lab test
```

La instalación necesita acceso al registro npm; las pruebas no necesitan red externa. Paquete y lock
privados, dependencias de desarrollo exactas; el arranque del juego no importa este laboratorio.
Pruebas de integración W02g y del contrato experimental W02i, más la regresión seleccionada
documentada en cada entrega. La suite
ordinaria `npm test` del root no incluye automáticamente este laboratorio: ejecutarlo explícitamente.

`evmFixture.mjs` compila `contracts/ReaderFixtures.sol` con solc 0.8.37, target Cancun y optimizador
200 runs; hereda OpenZeppelin Contracts 5.6.1. EthereumJS VM/Common/Util 10.1.3 ejecuta creación y
mutaciones como mensajes EVM `runCall`, con direcciones locales conocidas sin claves ni firmas.
Los eventos y valores de lectura proceden del bytecode; viem 2.57.3 codifica/decodifica el ABI.
`solc` fija un `tmp` vulnerable aguas arriba; override acotado `solc → tmp@0.2.7` y lock propio.
La [corrección publicada](https://github.com/advisories/GHSA-7c78-jf6q-g5cm) se verificó por auditoría
del paquete aislado el 2026-10-08; no equivale a una auditoría de contratos.

La fachada escucha solo en `127.0.0.1` con puerto efímero, cuatro métodos de lectura y cierre al
terminar cada test. Alturas/hashes/canonicalidad son fixtures sintéticos, con snapshots de raíces de
estado EVM reales. `eth_getCode` y `eth_call` exigen hash y `requireCanonical:true`; cada consulta
resta el coste intrínseco/calldata del presupuesto dado y restaura la raíz actual incluso en revert.
El chain ID local es **31337**, distinto de Amoy **80002** y Polygon **137**.

**Las funciones fixtureMint/fixtureBurn no tienen autorización y solo preparan pruebas. Nunca
desplegar estos contratos en una red pública.** El laboratorio no tiene herramienta de despliegue,
API para enviar transacciones ni claves. No prueba consenso/finalidad, tarifas reales, compatibilidad
RPC de un proveedor, transacciones firmadas/recibos ni el hardfork actual de Polygon. Tampoco define
tiradas, licencias, contenido vendible, custodia o derechos dentro del juego.

## Contrato experimental W02i

`contracts/AmoyReader721Pilot.sol` es un contrato separado de los fixtures anteriores. Rechaza
despliegue y mint fuera de chain ID 80002; el constructor exige un operador no cero e inmutable.
Solo ese operador puede acuñar; transferencias/approvals siguen ERC-721. No hay burn, cambio de
operador, setter de URI, pagos o privilegio para quitar tokens a otro dueño. La metadata constante
identifica una prueba sin activos/licencias/derechos de juego. No fija tiradas del producto.

```powershell
npm.cmd --prefix tools/web3-evm-lab run build:amoy
npm.cmd --prefix tools/web3-evm-lab run check:amoy
node --test tools/web3-evm-lab/amoy-pilot.test.mjs
```

El build escribe exclusivamente `artifacts/amoy-reader-721.json`: ABI, bytecode de creación,
plantilla de runtime, referencias inmutables, metadata del compilador, hashes de fuentes y entrada
Standard JSON completa. `--check` recompila y exige igualdad byte a byte, sin escribir. No contiene
dirección de operador/deployer ni datos de una transacción. La plantilla de runtime contiene los
huecos de `mintOperator`: el runtime desplegado se debe comparar aplicando esas referencias.

El ensayo W02i utiliza `createEvmContractFixture` con **80002 SIMULADO** para ejecutar CHAINID;
todo ocurre en la VM local y HTTP loopback con bloques sintéticos. El ensayo W02g conserva
31337 por defecto. Ninguno acredita consenso/red real aunque el número simulado sea 80002.
El artefacto nuevo queda preparado para revisar antes de W02j; los auxiliares de receptor de
las pruebas no se incluyen en él. El target Cancun debe comprobarse en la simulación real del
despliegue público. No hay herramienta de firma/envío ni wallet/RPC configurado en el build.
[Brief W02i](../../docs/briefs/w02i-amoy-erc721-pilot.md).
