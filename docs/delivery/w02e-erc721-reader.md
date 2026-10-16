# W02e — lector ERC-721 de contrato fijo y bloque explícito

Fecha: 2026-10-08. **Implementado y verificado localmente.**
[Contrato del corte](../briefs/w02e-erc721-reader.md), [plan](../../PLAN-WEB3.md),
[evidencia](w02e-erc721-reader-evidence.json).

El servidor dispone de un adaptador para observar el titular de un ERC-721 en un bloque concreto.
Comprueba red, número/hash, código no vacío, interfaces reportadas y respuesta ABI de `ownerOf`;
relee el bloque antes de emitir el resultado. No registra tokens ni cambia el dueño W01 o permisos
de equipo/parcelas. W02 sigue parcial; no se ha leído un contrato de Amoy real en este corte.

## Uso y configuración

```powershell
node tools/web3-token-read.mjs --help
node tools/web3-token-read.mjs --read
```

`--read` exige variables explícitas del proceso:

| Variable | Valor requerido |
|---|---|
| `MN_WEB3_RPC_URL` | Endpoint elegido por el operador, server-only |
| `MN_WEB3_WALLET_CHAIN_ID` | Red exacta; Amoy `80002` para el piloto elegido |
| `MN_WEB3_READ_CONTRACT` | Dirección no nula del contrato que se quiere examinar |
| `MN_WEB3_READ_TOKEN_ID` | Decimal canónico uint256, sin signo/ceros iniciales salvo `0` |
| `MN_WEB3_READ_BLOCK_NUMBER` | Altura hex mínima, por ejemplo `0x2a` en fixtures |
| `MN_WEB3_READ_BLOCK_HASH` | Hash esperado del bloque, 32 bytes no nulos |

La altura/hash deben proceder de una observación previa del bloque que el operador pretende examinar;
el comando no escoge `latest` ni inventa un token/contrato. Los ejemplos de la evidencia son fixtures,
no direcciones o bloques desplegados. Puede cargarse un archivo privado solo de forma explícita con
`node --env-file="C:\ruta\privada\piloto.env" tools/web3-token-read.mjs --read`.
No requiere Supabase, firma ni `MN_WEB3_WALLET_ENABLED=1`; `npm start` no ejecuta esta herramienta.
La plantilla sigue apagada y solo añade comentarios para sus entradas independientes.

Éxito devuelve versión 1, red, contrato, token, dirección observada y bloque reducido
(número/hash/parentHash/timestamp). No imprime URL RPC, claves, bytecode, datos crudos o campos extra.
Salida 0 para éxito; fallo 1 con JSON `{ok:false,why:<código fijo>}`; argumentos inválidos 2.
`--help` no hace peticiones. El adaptador fija un solo contrato en su constructor, sin métodos/ABI libres.

## Implementación y límites

Se comparte el transporte existente W02d en `rpcTransport.mjs`, que expone cuatro lecturas nombradas.
`rpcProbe.mjs` conserva API pública, clase/errores, resultado y sus dos peticiones históricas.
El lector emite como máximo ocho peticiones fijas, sin retry/polling/failover. Cada petición conserva
HTTPS salvo loopback, rechazo de redirecciones, 1 MiB/UTF-8/envelope estrictos y límite completo 10 s.
Solo las consultas `eth_call` usan gas como presupuesto de ejecución simulado: no se paga gas de una
transacción; posibles costes/cuotas del proveedor RPC se concretan aparte.

Código/interfaz/owner se consultan por `{blockHash,requireCanonical:true}` según
[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898), sin fallback a altura o `latest` si no hay soporte.
Los selectores, identificadores y forma de las respuestas siguen
[ERC-721](https://eips.ethereum.org/EIPS/eip-721) y [ERC-165](https://eips.ethereum.org/EIPS/eip-165).
Presupuestos eth_call de 60000/200000 incluyen coste intrínseco; no prueban el límite STATICCALL ERC-165.

El RPC sigue siendo una fuente externa que puede fallar o informar datos falsos. Canonicalidad reportada
en ese instante no prueba finalidad ni impide una reorganización posterior. Rechazar código vacío e
interfaz incorrecta no prueba origen/autenticidad, contrato completo, derechos/licencia o proxy estable.
Un revert/token inexistente/bloque no disponible falla sin inferir dueño cero o certeza sobre su causa.
La dirección devuelta no se convierte en cuenta de juego ni beneficiario de escrow. Política de
confirmación, custodia, reconciliación y vínculo único token/activo pertenecen a cortes posteriores.

## Verificación

**27/27 pruebas seleccionadas locales: 14 nuevas (11 adaptador + 3 CLI) y 13 de regresión W02d**.
Sin fallos, canceladas, omitidas o todo en el pase final; no es la suite completa del repositorio.

```powershell
node --test tests/web3-erc721-reader.test.mjs tests/web3-token-read-cli.test.mjs tests/web3-wallet-preflight.test.mjs
```

Calldata contrastado con `viem` independientemente del encoder propio. Se probaron uint256 cero/máximo,
entrada exacta/getters/Proxy, copia antes de await, normalización, consultas concurrentes, interfaz
incorrecta, code/ABI inválidos, red distinta, bloque cambiado y errores sin secretos. CLI ejecutado
en procesos separados contra RPC loopback con fetch nativo, incluso rechazo EIP-1898 sin fallback.
Un `.env` válido de fixture apunta a servidor trampa: no se carga ni recibe peticiones implícitas.
La regresión W02d verifica SQL antes de RPC, separación de credenciales, límites, UTF-8, redirect y
timeouts completos de fetch/cuerpo. No hubo llamada a Supabase/RPC externos.

Sintaxis, whitespace y UTF-8 sin BOM revisados. UI, perfil, simulación, protocolo/versión y montaje
permanecen fuera de este corte; sin nuevo pase visual por no haber UI. Ledgers históricos intactos.
Unreal/FAB revisado: no aplica a transporte/ABI; reutilización propia, sin arte ni fuentes modificadas.
Trabajo concurrente conservado. Sin leer `.env` real, aplicar SQL, arrancar/reiniciar host del autor,
firma/TX/mint/approval/pago, commit/push/deploy ni indexación OpenSea.

Sigue concretar origen/RPC del piloto, comprobar Supabase y extensión reales, y probar compatibilidad
EIP-1898 sobre un contrato experimental conocido en Amoy. Cerrar producto/custodia antes de activar uso.
