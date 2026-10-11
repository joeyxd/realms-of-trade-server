# W02f — observar copias ERC-1155 en un bloque concreto

Fecha: 2026-10-08. Continuación local autorizada; [plan](../../PLAN-WEB3.md),
[lector ERC-721 W02e](../delivery/w02e-erc721-reader.md).

## Resultado y alcance

Adaptador server-only para consultar el saldo de un tipo ERC-1155 en una dirección explícita.
Prepara la lectura de ediciones de apariencias/copias, sin cerrar su formato contractual definitivo.
Cada lector fija un contrato elegido por un operador confiable; el jugador no puede seleccionar ABI,
método RPC, proveedor o contrato desde mensajes de juego. Sin SQL, Auth, permisos ni montaje del host.

ERC-1155 representa tipos y cantidades; `balanceOf(address,uint256)` devuelve uint256 y su interfaz
es `0xd9b67a26`, según [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155).
Una copia no es una instancia individual ERC-721. El saldo cero es un resultado válido: no permite
concluir que el tipo no existe, que la colección no tiene suministro o que una licencia fue revocada.
Un error/revert/timeout nunca se convierte en saldo cero.

## Contrato

`createErc1155Reader({url,chainId,contractAddress,fetchFn?,timeoutMs?})` comparte el transporte W02d/e
y fija red/contrato. `observeBalance({holderAddress,tokenId,blockNumber,blockHash})` exige exactamente
cuatro propiedades de datos propias en objeto plano o de prototipo nulo. Rechaza Proxy/accesores
sin ejecutarlos y copia sus valores antes del primer await. Holder/contrato: direcciones no nulas;
token: decimal canónico uint256, incluido cero; altura hex mínima y hash no nulo de 32 bytes.

Ocho peticiones secuenciales como máximo, sin batch, retry, failover ni método libre:

1. `eth_chainId` coincide con la red configurada.
2. `eth_getBlockByNumber` en altura explícita coincide con número/hash esperados.
3. `eth_getCode` del contrato es hex de bytes completo y no vacío.
4. `supportsInterface(0x01ffc9a7)` informa true.
5. `supportsInterface(0xffffffff)` informa false.
6. `supportsInterface(0xd9b67a26)` informa true.
7. `balanceOf(holderAddress,tokenId)` devuelve exactamente un word uint256 de 32 bytes.
8. Releer la altura y comparar número/hash/parentHash/timestamp antes de devolver el saldo.

Código y llamadas de contrato usan `{blockHash,requireCanonical:true}` conforme a
[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898); RPC incompatible falla sin bajar a altura/latest.
La detección sigue [ERC-165](https://eips.ethereum.org/EIPS/eip-165), con bool ABI estricto. Presupuestos
eth_call de 60000 para interfaces y 200000 para balance incluyen coste intrínseco; no prueban el límite
STATICCALL ERC-165. Son consultas simuladas, sin pagar gas de transacción.

Éxito exacto: `{version:1,chainId,contractAddress,tokenId,holderAddress,balance,observedBlock}`.
`balance` es string decimal canónico incluso para cero o uint256 máximo; nunca pasa por Number.
`observedBlock` conserva solo número/hash/parentHash/timestamp, normalizados como direcciones/hex.
Errores fijos sin causa original: `configuration`, `input`, `chain`, `block`, `contract`, `interface`,
`rpc`, `response`. Ni URL/clave RPC ni datos privados del proveedor forman parte de la salida.

Transporte existente: HTTPS salvo loopback HTTP, sin redirect/cookies/credenciales de cuenta,
1 MiB, UTF-8/envelope estrictos y 10 s completos por petición; fixtures admiten 10–30000 ms.
Sin modificar APIs ni archivos W02d/e. No hay caché o estado compartido de titularidad.

CLI independiente: `node tools/web3-edition-read.mjs --read`, variables explícitas del proceso.
Exige las entradas del lector W02e y `MN_WEB3_READ_HOLDER`; no carga `.env`, SQL ni host.
`--help` inerte; argumentos inválidos salen con 2, lectura fallida con 1, éxito con 0.
Funciona sin activar `MN_WEB3_WALLET_ENABLED`; no firma, aprueba, acuña ni envía transacciones.

## Límites y aceptación

El saldo observado no prueba finalidad, honestidad/sincronía del RPC, conformidad contractual completa,
origen/licencia, suministro o exclusividad de una instancia. No escribe W01 ni traduce el holder a cuenta,
beneficiario de escrow o derechos de juego. Activar/vender copias requiere vínculo reconocido,
reservas por cantidad, custodia, confirmación/reorganizaciones y recuperación propias de su corte.
La observación de un bloque no sustituye esas reglas.

Contrastar calldata con viem; probar cero/máximo y >2^53 sin redondeo, saldo inválido frente a fallo RPC,
entradas exactas/accesores/Proxy/copia, concurrencia por holder/token, paradas tempranas y bloque cambiado.
CLI en proceso separado con fetch nativo/loopback y `.env` trampa; revalidar W02d/e sobre transporte compartido.
Sin nuevas dependencias, SQL, UI, simulación, perfiles, protocolo/versión o publicación.

Unreal/FAB contrastado en [inventario](../research/unreal-assets/SUMMARY.md) y
[portabilidad](../research/unreal-assets/PORTABILITY.md): arte/Blueprints no resuelven esta lectura ABI/RPC.
Reutilizar transporte propio y viem para el oráculo de pruebas; fuentes Unreal intactas, cero arte nuevo.
La ejecución real Amoy sigue pendiente del proveedor y de un contrato experimental conocido.
