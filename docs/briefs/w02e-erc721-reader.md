# W02e — observar titular ERC-721 en un bloque concreto

Fecha: 2026-10-08. Desarrollo local autorizado tras elegir Polygon PoS y Amoy.
[Plan](../../PLAN-WEB3.md), [sonda W02d](../delivery/w02d-wallet-preflight.md).

## Resultado y alcance

Adaptador server-only para consultar un token ERC-721 de un contrato fijado por un operador confiable.
La lectura conserva identidad de red/contrato/token y número/hash de bloque, evitando mezclar estados
si cambia el bloque durante la consulta. Sirve de base para el piloto de equipo/escrituras.
No requiere SQL, Auth, wallet vinculada ni activar el juego. No concede permisos ni escribe W01.
La elección ERC-721 del lector no cierra el formato definitivo del equipo, solares o ediciones ERC-1155.

## Contrato

`createErc721Reader({url,chainId,contractAddress,fetchFn?,timeoutMs?})` fija una red y un solo contrato.
Sin red, proveedor o contrato por defecto, fallback o selección desde mensajes de jugador.
`observeOwner({tokenId,blockNumber,blockHash})` acepta exactamente tres propiedades de datos propias:
token decimal canónico `uint256` (incluido cero), número de bloque hex mínimo y hash no nulo de 32 bytes.
Rechaza entradas inválidas antes de hacer peticiones; copia la entrada antes de esperar red.

Ocho peticiones secuenciales y fijas, sin batch ni métodos arbitrarios:

1. `eth_chainId`; otra red interrumpe la lectura.
2. `eth_getBlockByNumber` en la altura explícita; número/hash deben coincidir con lo esperado.
3. `eth_getCode` del contrato, por hash y `requireCanonical:true`; código vacío impide seguir.
4. `supportsInterface(0x01ffc9a7)` debe informar true.
5. `supportsInterface(0xffffffff)` debe informar false.
6. `supportsInterface(0x80ac58cd)` debe informar true.
7. `ownerOf(uint256)`, con selector/ABI fijados por el lector, debe devolver un único word de dirección no nula.
8. Releer la altura y comparar número/hash/parentHash/timestamp antes de publicar la observación.

Las consultas de código y contrato usan `{blockHash,requireCanonical:true}` conforme a
[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898). Un RPC sin soporte falla; no degradar a altura o `latest`.
Identificación de interfaz y titular según [ERC-165](https://eips.ethereum.org/EIPS/eip-165) y
[ERC-721](https://eips.ethereum.org/EIPS/eip-721). Bool y dirección ABI se validan estrictamente.
Los `eth_call` tienen presupuesto de 60000 para interfaces y 200000 para `ownerOf`, incluido el coste
intrínseco de llamada; no constituyen una prueba del límite STATICCALL ERC-165 de 30000.
Contratos más costosos pueden fallar y necesitan revisar el presupuesto, nunca retry automático.

Se comparte el transporte acotado W02d: HTTPS salvo loopback HTTP, sin credenciales de cuenta,
cookies/redirecciones, 1 MiB/UTF-8/envelope estrictos, 10 s completos por petición. API de fixture
permite 10–30000 ms. Su helper solo expone cuatro métodos de lectura nombrados, no un método RPC libre.
W02d mantiene sus dos peticiones, API, resultados y errores históricos.

Éxito exacto: `{version:1,chainId,contractAddress,tokenId,ownerAddress,observedBlock}`.
Direcciones/hashes/hex normalizados a minúsculas; token IDs/cantidades RPC nunca pasan por Number.
`observedBlock` conserva solo número, hash, parentHash y timestamp. Errores fijos sin causa original:
`configuration`, `input`, `chain`, `block`, `contract`, `interface`, `rpc`, `response`.
Un revert/token inexistente o rechazo EIP-1898 produce fallo, no un dueño inventado o dueño cero.

El CLI `node tools/web3-token-read.mjs --read` usa env explícito y exige contrato/token/número/hash
además de RPC/red. `--help` es inerte, argumentos distintos salen con 2; lectura fallida, 1; éxito, 0.
No carga `.env`, inicia host, consulta SQL, firma, envía transacciones ni solicita aprobaciones NFT.
No necesita `MN_WEB3_WALLET_ENABLED=1`: es una herramienta independiente, no activación del juego.
No emitir URL RPC/claves/config privada/errores originales en el informe.

## Límites y aceptación

Es una observación de un RPC, no prueba criptográfica, finalidad o sincronía. El código/interfaz reportados
no prueban autenticidad, derechos vendidos, contrato verificado, implementación completa ERC-721 ni que
un proxy no cambie. Una dirección observada no equivale a `ownerId` de W01 ni al beneficiario de un escrow.
No usar este resultado para activar equipo o construcción sin custodia, política de confirmación,
vínculo token/activo aprobado y recuperación/reorganizaciones propios de W03/W04.

Probar ABI con fixtures independientes, extremos uint256, entrada exacta y mutaciones concurrentes,
rechazo temprano, red distinta, altura/hash cambiados, interfaz incorrecta, fallos del RPC y errores
redactados; CLI en proceso separado contra loopback y trampa `.env`. Revalidar W02d tras extracción
del transporte. Sin nuevas dependencias, simulación/perfiles/protocolo, SQL ni cambios al arranque.

Inventario Unreal/FAB revisado (`docs/research/unreal-assets/SUMMARY.md` y `PORTABILITY.md`):
modelos/iconos/Blueprints no resuelven RPC/ABI; reutilizar transporte propio. Cero arte nuevo,
fuentes Unreal intactas. Extensión/Supabase/RPC reales, contrato desplegado y mercado siguen pendientes.
