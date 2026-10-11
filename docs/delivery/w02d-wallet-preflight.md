# W02d — comprobación independiente del piloto Web3

Fecha: 2026-10-08. **Implementado y verificado localmente.**
[Contrato](../briefs/w02d-wallet-preflight.md), [plan](../../PLAN-WEB3.md),
[evidencia](w02d-wallet-preflight-evidence.json).

El operador puede comprobar SQL de wallet y RPC de la red configurada antes de activar el flujo.
El comando no carga `.env` automáticamente, inicia el juego ni modifica datos. No se ha elegido
red, proveedor u origen real, ni se ha ejecutado contra servicios reales en este corte.

## Uso

```powershell
node tools/web3-wallet-preflight.mjs --help
node tools/web3-wallet-preflight.mjs --check
```

Para `--check`, suministrar al proceso la configuración privada W02c:
`MN_WEB3_WALLET_ENABLED=1`, origen exacto, chain ID, URL y claves Supabase, más `MN_WEB3_RPC_URL`.
El TTL sigue siendo opcional. El comando usa el env ya suministrado; no busca archivos privados.
Si el operador decide usar un archivo, puede cargarlo explícitamente con Node:

```powershell
node --env-file="C:\ruta\privada\piloto.env" tools/web3-wallet-preflight.mjs --check
```

Esa ruta es ilustrativa. Las migraciones opcionales Web3 002 y 003 deben estar instaladas;
la herramienta no las aplica. La plantilla `deploy/marea-negra.env.example` conserva el montaje
apagado e incorpora solo un comentario de RPC para el comando; `npm start` no consulta ese RPC.
No mostrar ni copiar las claves a UI, informes, commits o argumentos de petición blockchain.

Éxito devuelve JSON versión 1: las dos comprobaciones aprobadas, origen/chain/proof públicos y
número/hash/parentHash/timestamp del bloque observado. No devuelve URL RPC, URL Supabase,
claves, cuentas, retos o vínculos. Cantidades hex permanecen strings para evitar redondeo.
Fallo devuelve `{ok:false,why:<código fijo>}` en stderr y código 1; argumentos inválidos, código 2.

## Cambios

- `walletRuntime.mjs` comparte la construcción/validación completa entre el montaje existente y
  `walletReadinessFromEnv`, que expone únicamente origen, chain ID y `prepare()`. El montaje normal
  conserva sus requisitos de Auth y store durable; el diagnóstico no simula esas dependencias.
- `walletPreflight.mjs` valida toda la configuración antes de clientes, comprueba SQL y después RPC.
  El SQL utiliza únicamente `mn_web3_wallet_ready({})` y el DTO exacto W02c, sin mutadores.
- `rpcProbe.mjs` expone solo una observación: `eth_chainId`, rechazo de otra red, y bloque `latest`.
  No acepta métodos arbitrarios. HTTPS salvo loopback, sin redirecciones/cookies/cabeceras de cuenta,
  respuesta de hasta 1 MiB, UTF-8/envelope/cantidades estrictos y 10 s completos por petición.
  Cancela el lector al agotar el límite y no espera una cancelación que pudiera bloquear.
- El CLI exige `--check` explícito. Sin retry, polling, failover, signer, firma o envío de transacción.

El resultado registra lo reportado por el endpoint, no finalidad o honestidad del bloque, sincronía,
confirmaciones, reorganizaciones, propiedad de activos ni disponibilidad futura. SQL y RPC se leen
secuencialmente: no constituyen una transacción compartida. No prueba login, mundo durable,
extensión real o integración de equipo/tierra. W02 sigue parcial; W03/W04 no quedan aceptados.

## Verificación local

**128/128 pruebas únicas seleccionadas: 13 nuevas + 115 de regresión**, sin fallos, omitidas,
canceladas o todo. No es la suite completa del repositorio. Comandos/duración en la evidencia.
El primer grupo W02c/W02d pasó 28/28; después se reforzaron las 13 nuevas con comprobación
de cancelación y un servidor trampa para `.env`, que pasaron 13/13. Esa repetición no se suma.
La regresión restante pasó 100/100.

Incluye config inválida antes de clientes, separación service-role/RPC, envelopes/bloques corruptos,
red errónea, exceso de bytes/UTF-8 inválido, timeout de fetch/cuerpo y redirección real loopback.
CLI en proceso separado con SDK Supabase real contra stub HTTP: únicamente readiness, chain ID
y bloque; los headers de Supabase no llegan al RPC. Otro `.env` válido de fixture apunta a un
servidor trampa: se ignora y no recibe peticiones. Los directorios temporales se verifican antes
de eliminarlos. Los tests de runtime/SQL W02c vuelven a comprobar montaje y recuperación PGlite.

Node v24.14.0, viem 2.57.3. Sintaxis, whitespace, UTF-8 sin BOM y hashes revisados.
W01 conserva 10/10 fuentes, contenido de equipo 7/7 y W02b 15/20 (los mismos cinco cambios
históricos: index y cuatro documentos). UI W02b exacta y aceptación visual histórica conservada;
sin nueva UI ni pasada de navegador. W02c conserva 7/13: cambian runtime, plantilla y cuatro
documentos de continuidad; index, store, SQL y tests W02c permanecen exactos. Ledgers anteriores intactos.

Unreal/FAB revisado: este corte reutiliza lógica propia, sin dependencia de modelos, iconos o
Blueprints, arte nuevo/imports ni cambios a proyectos fuente. Trabajo concurrente conservado,
sin cambios propios de perfil/simulación/protocolo/versión.

No se leyó `.env` del repo, aplicó SQL live, arrancó/reinició el host del autor o hizo commit/push/deploy.
Sin Supabase real, extensión, RPC/testnet real, contratos, tokens, ventas o pagos. Sigue seleccionar
red/origen del piloto, verificar Supabase y extensión reales y cerrar derechos/pérdidas/custodia,
licencias/economía y escritura antes de la activación jugable de equipo y tierra.
