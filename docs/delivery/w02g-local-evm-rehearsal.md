# W02g — lectores verificados contra bytecode EVM local

Fecha: 2026-10-08. **Implementado y verificado localmente.**
[Brief](../briefs/w02g-local-evm-rehearsal.md), [laboratorio](../../tools/web3-evm-lab/README.md),
[plan](../../PLAN-WEB3.md), [evidencia](w02g-local-evm-rehearsal-evidence.json).

Los lectores ERC-721/ERC-1155 y sus comandos independientes ya se probaron contra valores obtenidos
de contratos Solidity compilados y ejecutados en una EVM en memoria. Los ensayos anteriores de
W02e/f usaban respuestas RPC prefabricadas; este corte verifica el ABI y comportamiento del bytecode
OpenZeppelin en escenarios concretos de acuñación, transferencia, historial y fallos.

## Entrega y reproducción

`tools/web3-evm-lab/` contiene un paquete privado con lock y devDependencies propios, dos fixtures
Solidity, una fachada RPC loopback y siete pruebas de integración. No cambia las dependencias del
root ni los lectores/CLIs del servidor, y el laboratorio no se importa desde el juego.

```powershell
npm.cmd --prefix tools/web3-evm-lab ci --ignore-scripts --no-audit --no-fund
npm.cmd --prefix tools/web3-evm-lab test
```

Dependencias exactas: EthereumJS VM/Common/Util 10.1.3, OpenZeppelin Contracts 5.6.1,
solc 0.8.37 y viem 2.57.3; Node verificado v24.14.0 en Windows. Standard JSON con target Cancun
explícito y optimizador 200 runs. Resolución de imports confinada por realpath a OpenZeppelin
instalado en el laboratorio. Creación y mutaciones son mensajes EVM `runCall`, sin claves/firmas,
transacciones firmadas o recibos. Los fixtures exponen mint/burn sin autorización exclusivamente
para preparar escenarios; **no son contratos de producto ni deben desplegarse a red pública**.

Cada mutación exitosa genera una identidad de bloque sintética y conserva la raíz EVM correspondiente.
La fachada solo ofrece `eth_chainId`, `eth_getBlockByNumber`, `eth_getCode` y `eth_call`; traduce
hashes explícitos a snapshots, comprueba el Set canónico del fixture y ejecuta llamadas sobre la
raíz histórica. `eth_call` puede ejecutar cambios simulados, pero siempre restaura la raíz actual.
El presupuesto descuenta 21000 y el coste por byte de calldata para estas llamadas simples.
No se afirma conformidad universal de gas, STATICCALL ERC-165 o transacciones.

## Verificación

**49/49 seleccionadas locales: 7 nuevas de integración EVM + 42 de regresión W02d/e/f.**
Sin fallos, canceladas, omitidas o todo; duración registrada 4512.4849 ms.
No es la suite completa del repositorio.

```powershell
node --test tools/web3-evm-lab/reader-evm.test.mjs tests/web3-erc1155-reader.test.mjs tests/web3-edition-read-cli.test.mjs tests/web3-erc721-reader.test.mjs tests/web3-token-read-cli.test.mjs tests/web3-wallet-preflight.test.mjs
```

- ERC-721: evento mint, titular A, transferencia con evento a B, consulta de ambos snapshots,
  burn y revert de token inexistente; transferencia sin autorización preserva raíz/titular/bloque.
- ERC-1155: eventos mint/transfer, saldo 9007199254740993 sin redondeo, transferencia parcial,
  suma A+B, consulta histórica, cero e ID/saldo uint256 máximos. Insuficiente saldo o caller
  sin autorización revierten y conservan cantidades, raíz y bloque.
- Código ausente, tipo de contrato equivocado y hash desconocido/no canónico interrumpen la lectura;
  no se inventa propietario ni saldo. Calldata comparado con el ABI compilado y secuencia fija de ocho lecturas.
- Ambos CLIs en procesos separados con entorno mínimo obtienen dueño/saldo después de transferencias
  mediante fetch nativo loopback; raíz preservada y sin solicitudes de firma/envío.
- La fachada rechaza métodos de envío y selectores sin hash canónico. Una llamada simulada a mint
  no persiste el token: prueba de restauración incluso para calldata que cambia estado.

Sintaxis, whitespace, UTF-8 sin BOM y enlaces locales revisados. Auditoría inicial detectó
`solc → tmp@0.2.6`; override acotado a **tmp 0.2.7**, lock actualizado y pase final de pruebas/auditoría
con cero avisos en este paquete. [Advisory y versión corregida](https://github.com/advisories/GHSA-7c78-jf6q-g5cm).
No se aplicó un arreglo automático ni se cambiaron paquetes del juego. Revisiones independientes Luna
de inventario, fixtures, pruebas y snapshots; aceptación del principal sobre el pase final.

## Alcance y siguiente paso

El chain ID del laboratorio es 31337; **no es Amoy ni Polygon**. Hashes/header/canonicalidad son
modelos sintéticos; bytecode y raíces de estado sí son ejecución EVM. No prueba consenso/finalidad,
honestidad de un RPC, compatibilidad EIP-1898 de proveedores ni tarifas en POL. No es una auditoría
de contrato o garantía de conformidad ERC-721/ERC-1155 arbitraria.

Instalación npm y consulta de documentación públicas; **cero lecturas RPC externas**. Sin `.env` real,
Supabase live, SQL (incluida 013), host del autor, wallet, aprobación de gasto, pagos, permiso jugable,
contratos/tokens públicos, OpenSea, commit/push o despliegue. No hay UI nueva que requiera capturas.
Fuentes Unreal/FAB revisadas e intactas; no aportan lógica EVM portable, se reutilizan lectores/CLIs
propios e implementaciones estándar del laboratorio. El trabajo concurrente queda conservado.

W02 sigue parcial: origen/proveedor, Supabase y extensión reales, contrato experimental apropiado
y consultas de Amoy permanecen pendientes. W03/W04 necesitan cerrar derechos, pérdidas y custodia
antes de proyectar uso dentro del juego; estos fixtures no cierran esas decisiones.
