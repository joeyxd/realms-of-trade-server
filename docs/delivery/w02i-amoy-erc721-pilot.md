# W02i — ERC-721 experimental preparado para Amoy

Fecha: 2026-10-08. **Contrato y artefacto implementados; 68/68 seleccionadas locales. Sin despliegue público.**
[Brief](../briefs/w02i-amoy-erc721-pilot.md), [evidencia](w02i-amoy-erc721-pilot-evidence.json),
[plan actualizado](../../PLAN-WEB3.md), [contrato](../../tools/web3-evm-lab/contracts/AmoyReader721Pilot.sol),
[artefacto completo](../../tools/web3-evm-lab/artifacts/amoy-reader-721.json).

## Resultado

Contrato nuevo `AmoyReader721Pilot`, separado de los fixtures sin autorización W02g. Constructor
rechaza cualquier red distinta de 80002 y operador cero; el operador de acuñación se recibe
explícitamente y queda inmutable. Deployer y operador pueden ser distintos. `mint` comprueba red
y operador, usa `_safeMint`, rechaza duplicados/cero y respeta aceptación del receptor ERC-721.
IDs uint256 arbitrarios de prueba, incluidos 0 y máximo; no configura tiradas comerciales.

Transferencias/approvals heredados de OpenZeppelin; el operador de acuñación no tiene privilegio
para quitarle tokens al titular. La aprobación individual se limpia al transferir; una aprobación
para todos pertenece a la relación dueño/operador y no se convierte en privilegio de acuñación.
No hay burn, cambio de operador, setter de URI, proxy, pausa, custodia, regalías o pagos.
Constructor y mint tienen guardia de red; transfers/approvals conservan el comportamiento estándar.

`name`, `symbol` y JSON data URI son constantes experimentales. `tokenURI` exige token existente;
el JSON declara: «Token experimental de testnet. No representa equipo, tierra, licencia, pago ni
permiso de juego». Misma metadata para los tokens de prueba, sin arte externo ni contenido del
catálogo W00/W01. Pérdida de acceso al operador impediría futuras acuñaciones; no hay recuperación
administrativa. Este diseño acotado no cierra la custodia, derechos o administración del producto.
La guardia comprueba `block.chainid == 80002`; ese identificador por sí solo no autentica la red
Polygon Amoy. La procedencia del endpoint y evidencia pública se aceptan por separado en W02j.

## Artefacto reproducible

Paquete privado W02g y lock conservado: solc **0.8.37+commit.f401782d.Emscripten.clang**, OpenZeppelin
**5.6.1**, target **Cancun**, optimizer **200**. Sin dependencias nuevas. Fuentes OpenZeppelin
resueltas dentro del paquete instalado, con contención por ruta real; segunda compilación desde
entrada Standard JSON completa, sin callback/imports externos.

`amoyPilotBuild.mjs` y CLI `build-amoy-pilot.mjs` producen `artifacts/amoy-reader-721.json`:
ABI, bytecode de creación **4591 bytes**, plantilla runtime **3904 bytes**, referencias inmutables,
metadata del compilador, **16 fuentes completas** y sus SHA-256. Sin timestamp o dirección/clave
de operador; construir dos veces y recompilar entrada completa produce el mismo resultado.
`--check` exige igualdad byte a byte con el archivo entregado, sin escribir.

```powershell
npm.cmd --prefix tools/web3-evm-lab run build:amoy
npm.cmd --prefix tools/web3-evm-lab run check:amoy
```

No son comandos de despliegue. La plantilla runtime tiene dos posiciones de 32 bytes para el
mismo `mintOperator`; no debe compararse literalmente con código desplegado sin rellenarlas.
La prueba compara el runtime realmente ejecutado con la plantilla tras insertar el operador local.
El artefacto es preparatorio para Amoy; compatibilidad del despliegue, argumentos, simulación/gas y
recibos públicos se aceptan después. Los receptores auxiliares de las pruebas no están en el artefacto.

## Verificación local

**68/68 seleccionadas: 10 nuevas + 58 W02d/e/f/g/h**, 0 fallos/canceladas/omitidas/todo;
duración 12329.2509 ms. No es la suite completa del juego.

```powershell
node --test tools/web3-evm-lab/amoy-pilot.test.mjs tools/web3-evm-lab/reader-evm.test.mjs tests/web3-amoy-check.test.mjs tests/web3-erc1155-reader.test.mjs tests/web3-edition-read-cli.test.mjs tests/web3-erc721-reader.test.mjs tests/web3-token-read-cli.test.mjs tests/web3-wallet-preflight.test.mjs
```

Pruebas nuevas: build/fuentes/ABI/runtime, constructor en 137/31337/1 y operador cero; deployer sin
privilegio, outsider/approved/operator-for-all sin mint; duplicate/cero y callback rechazado con
rollback de raíz/head; approvals, transfer autorizado y rechazo de aprobación vieja; metadata
constante y token inexistente; receptor válido, selector incorrecto/revert y safe transfer fallido;
lector/CLI por hash actual e histórico; operador sin confiscación e IDs extremos sin remint.

`createEvmContractFixture` extrae el ejecutor local compartido y admite planes de contratos
compilados. W02g mantiene **31337** por defecto. W02i simula **80002**, marcado `simulated:true`,
para ejecutar la instrucción CHAINID. Raíces de estado EVM reales, alturas/hashes/canonicalidad
sintéticos; mensajes `runCall` sin firmas/transacciones/recibos públicos. Solo HTTP loopback.
El lector y CLI hacen 24 solicitudes locales acotadas (tres secuencias de ocho), con entorno
mínimo en el subproceso; ninguna envía transacciones y las lecturas conservan la raíz.

Luna revisó el alcance y escribió nueve pruebas; principal revisó/amplió a diez, agregó igualdad
con artefacto entregado, hashes, comparación runtime/inmutables, rechazo de permisos viejos,
safe transfer fallido y no confiscación, y aceptó el pase completo. Sintaxis, UTF-8 y enlaces
comprobados en la evidencia. No prueba consenso/finalidad ni usa el RPC público W02h de nuevo.

## Fuentes, reutilización y siguiente corte

[OpenZeppelin ERC-721](https://docs.openzeppelin.com/contracts/5.x/erc721) describe ownership,
metadata y mint; sus ejemplos abiertos requieren añadir autorización para restringir acuñación.
[Access control](https://docs.openzeppelin.com/contracts/5.x/access-control) y
[ERC-721](https://eips.ethereum.org/EIPS/eip-721) sustentan la separación entre mint y permisos
de transferencia. La implementación exacta usada es la fijada en el lock y entrada entregada.
Amoy `80002` está documentada por [Polygon](https://docs.polygon.technology/pos/reference/rpc-endpoints).
[PIP-31](https://forum.polygon.technology/t/pip-31-cancun-eips/13406) describe el subconjunto de
Cancun de Polygon; esta fuente no convierte la VM local en una verificación de hardfork de Amoy.

Inventario Unreal/FAB y candidatos StoragePart_03/RepairBench/SmallWoodeHut/BuildHammer revisados:
props y referencias de interacción, sin lógica Solidity portable. Sin arte nuevo o importación;
fuentes Unreal intactas. Se reutilizan OpenZeppelin, toolchain y ejecutor del laboratorio.

**Siguiente W02j:** dirección pública del operador/deployer y wallet de firma, POL de prueba y
endpoint explícito; revisión del artefacto/argumentos y simulación del envío; deploy/recibos,
comparación de código con inmutables, mint/transfer de prueba y lectura histórica por bloque.
La dirección/wallet aún no se suministró; no pedir secretos ni generar una clave por defecto.
Supabase/origen/vínculo/extensión reales siguen una aceptación separada. W03/W04 esperan las
decisiones de producto y un puente recuperable token/activo/permisos.

Sin `.env` real, migraciones (incluida 013), SQL/Supabase live, inicio/reinicio de host, frontend,
perfiles/simulación/protocolo, cambios de proveedor, NFT público, OpenSea, pagos, gas pagado,
commit/push o despliegue. Cero consultas RPC externas en W02i. Checkpoints anteriores son evidencia
histórica de sus fuentes; este corte registra los hashes nuevos sin reescribir sus ledgers.
