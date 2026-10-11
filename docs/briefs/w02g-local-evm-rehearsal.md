# W02g — ensayo de lectores con bytecode en EVM local

Fecha: 2026-10-08. Alcance autorizado: continuar la base Web3 opcional del piloto Polygon.
Depende de [W02e](../delivery/w02e-erc721-reader.md) y
[W02f](../delivery/w02f-erc1155-reader.md). Estado: implementado y verificado localmente;
[entrega](../delivery/w02g-local-evm-rehearsal.md), 7 nuevas + 42 de regresión seleccionada.

## Resultado

Compilar fixtures ERC-721/ERC-1155 y ejecutar su creación, acuñación y transferencias en una EVM
desechable en memoria. Los lectores existentes y sus CLIs deben obtener titular/saldos reales de esa
ejecución, mediante HTTP loopback y consultas por hash de estado histórico. No se elige proveedor
RPC, firma wallet, despliega en Amoy ni se define un contrato comercial.

El laboratorio vive en `tools/web3-evm-lab/`, paquete privado con dependencias exactas y lock propios;
sin modificar package/lock raíz, montaje normal, simulación, perfiles, migraciones o `.env` reales.
Se reutilizan los lectores, transporte y CLIs existentes sin cambiar sus APIs. Los fixtures heredan
OpenZeppelin; mint/burn sin autorización solo para preparar pruebas, nunca para una red pública.

## Aceptación

- ERC-721: acuñar a A, transferir a B; lectura antes/después y estado histórico conservan el titular
  correcto. Token inexistente/quemado revierte y no inventa dueño; operación sin autorización no cambia titular.
- ERC-1155: acuñar y transferir cantidades parciales, incluido saldo mayor que 2^53; A/B y lecturas
  históricas conservan strings exactos, cero válido y suma de cantidades. Transferencia inválida no cambia saldos.
- Código/interfaz/ownerOf/balanceOf salen del bytecode ejecutado, no de tablas de respuestas ABI prefabricadas.
  Contrato de tipo incorrecto y dirección sin código se rechazan. Las lecturas no alteran el estado EVM.
- La fachada de prueba exige `blockHash` y `requireCanonical:true`, rechaza bloques desconocidos/no
  canónicos y no hace fallback a altura/latest. Identidades de bloque son sintéticas, sin prueba de finalidad.
- Ambos CLIs corren en procesos separados con entorno mínimo y endpoint loopback explícito; no hay
  firmas, envío de transacciones, gas pagado o acceso a proveedores externos desde lectores/CLIs.
- Verificar regresión pertinente W02d/e/f, documentar versiones y evidencia reproducible.

## Herramientas y límites

Toolchain de desarrollo aislado: EthereumJS VM/Common/Util 10.1.3, solc 0.8.37,
OpenZeppelin Contracts 5.6.1 y viem 2.57.3. Compilación Standard JSON y target Cancun explícito.
Override acotado `solc → tmp@0.2.7` para la versión corregida de su dependencia transitiva;
auditoría del paquete aislado sin avisos al cerrar el corte.
La EVM local no reproduce consenso, tarifas, RPC completo, recibos de transacciones, finalidad,
patrocinio, persistencia SQL ni Polygon/Amoy. No evaluar costes reales a partir de este ensayo.
La capa HTTP mínima es fixture, no servidor RPC publicable ni herramienta de despliegue.

Fuentes primarias: [EthereumJS VM](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/vm),
[solc-js](https://github.com/argotorg/solc-js),
[ERC-721 OpenZeppelin](https://docs.openzeppelin.com/contracts/5.x/api/token/erc721),
[ERC-1155 OpenZeppelin](https://docs.openzeppelin.com/contracts/5.x/api/token/erc1155),
[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898).

## Reutilización Unreal/FAB

Revisados [SUMMARY](../research/unreal-assets/SUMMARY.md) y
[PORTABILITY](../research/unreal-assets/PORTABILITY.md): arte y lógica Blueprint/C++ de gameplay,
sin compilador Solidity, bytecode EVM o transporte RPC reutilizables para este corte. Fuentes intactas;
se reutiliza el código Web3 propio y las implementaciones estándar instaladas solo en el laboratorio.
