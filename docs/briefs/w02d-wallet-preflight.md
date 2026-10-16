# W02d — comprobar SQL y RPC del piloto

Fecha: 2026-10-08. Desarrollo local autorizado. [Plan](../../PLAN-WEB3.md),
[montaje W02c](../delivery/w02c-wallet-runtime.md).

## Resultado y alcance

Comando independiente para comprobar la configuración completa de wallet, sus prerrequisitos SQL
y una observación del RPC elegido antes de activar el montaje. No inicia mundo/HTTP, carga `.env`,
aplica migraciones, crea retos/vínculos, solicita firmas ni envía transacciones. No elige red/proveedor.
El autor tiene pendiente la selección de testnet/origen; desarrollar la herramienta no los selecciona.

## Contrato

`node tools/web3-wallet-preflight.mjs --check` usa exclusivamente las variables del proceso.
Exige `MN_WEB3_WALLET_ENABLED=1`, configuración completa W02c y `MN_WEB3_RPC_URL` explícito.
`--help` no realiza peticiones; otros argumentos fallan con código 2. Las comprobaciones fallan
con código 1 y JSON fijo `{ok:false,why:<configuration|storage|rpc|response|chain>}`. Éxito: código 0.
No imprimir valores de configuración privada, URL RPC, claves ni diagnósticos originales del proveedor.

Primero valida toda la configuración, antes de crear un cliente con credenciales. La fábrica de
readiness comparte la validación W02c de Supabase, origen, chain ID y TTL; expone solo origen,
chain ID y `prepare()`. No requiere construir un resolver Auth ni simular un store del mundo.
La comprobación no verifica login ni que el mundo tenga almacenamiento durable.

Después ejecuta exclusivamente `mn_web3_wallet_ready({})`, con el cliente service-role stateless
separado. Exige `{version:1}` exacto y conserva su límite W02c de 10 s. Un fallo detiene el flujo
antes del RPC. No verifica hash del cuerpo SQL, mutadores ni concurrencia Postgres real.

RPC HTTPS salvo loopback HTTP, sin userinfo, fragmento, espacios, cookies, cabeceras de cuenta
o redirecciones. La ruta/query pueden contener claves del proveedor y nunca forman parte del informe.
Dos métodos fijos y secuenciales: `eth_chainId([])` y, si coincide, `eth_getBlockByNumber(['latest',false])`.
No hay método arbitrario, signer, reintento, polling ni failover. Cada petición tiene límite completo
de 10 s y 1 MiB, UTF-8 estricto y envelope JSON-RPC exacto. La API de fixture permite ajustar el
límite 10–30000 ms; el comando usa 10 s, sin variable nueva de timeout.

Las cantidades RPC usan hexadecimal mínimo según [EIP-1474](https://eips.ethereum.org/EIPS/eip-1474).
El bloque se reduce a número, hash, parentHash y timestamp; los campos adicionales se descartan.
Se conservan cantidades como strings hex para evitar pérdida de precisión. Los métodos están
documentados por [Ethereum](https://ethereum.org/developers/docs/apis/json-rpc/).

El informe exacto contiene `version:1`, `checks:{walletSql:'passed',rpc:'passed'}`,
`wallet:{origin,chainId,proof:'eoa'}` y `observedBlock:{number,hash,parentHash,timestamp}`.
Es una observación del endpoint configurado y de permisos SQL en dos instantes sucesivos.
No acredita que el endpoint sea honesto, esté sincronizado o reporte un bloque finalizado;
no establece confirmaciones/reorganizaciones ni autoriza activos. `latest` puede reorganizarse.
Tampoco confirma extensión real, dispositivo físico, pagos, publicación o integración jugable.

## Reutilización y aceptación

Reutilizar servicio/política W02c y `checkReady()` existente; mantener la validación durable/Auth
del montaje normal. Inventario Unreal/FAB revisado en `docs/research/unreal-assets/SUMMARY.md`:
modelos/iconos/Blueprints no resuelven una consulta RPC/SQL server-only; cero arte nuevo y fuentes intactas.

Probar configuración completa antes de clientes, errores sin secretos, SQL antes de RPC,
rechazo de otra red, envelopes/cantidades/bloques inválidos, exceso/UTF-8, redirección y timeout
incluido cuerpo que no responde al AbortSignal. Probar CLI con env explícito en proceso separado
y `.env` de fixture válido ignorado. Regresión W02a/b/c y contrato de registro/contenido de equipo.
No modificar SQL, perfil, simulación, protocolo, versión, launchers, host ni configuración live.
