# W02h — diagnóstico de consultas por hash en Amoy

Fecha: 2026-10-08. Continúa [W02g](../delivery/w02g-local-evm-rehearsal.md) y la red elegida
por el autor: Polygon PoS, piloto Amoy. Alcance autorizado: desarrollo y consultas públicas sin gasto.

## Resultado y aceptación

Preparar un comando independiente que use configuración explícita del proceso, confirme chain ID
80002, fije un bloque observado, consulte código y ejecute identity precompile (`0x04`) con
`{blockHash, requireCanonical:true}`, y relea esa altura. Cinco llamadas acotadas mediante el
transporte existente; sin reintentos o fallback a otro bloque/proveedor. Fallos con errores fijos
que no revelen URL/claves ni respuestas completas. Pruebas automáticas de éxito/fallos y CLI loopback;
una ejecución pública se registra separada de las pruebas locales.

No requiere wallet, origen del juego ni Supabase para este diagnóstico. No selecciona proveedor de
operación ni despliega los fixtures W02g. No implica contrato NFT real, semántica completa EIP-1898,
finalidad, honestidad, archivo histórico, tarifa/gas, permisos jugables o pagos. El identity echo
no depende de estado: un RPC que ignore el selector podría devolver lo esperado. La comprobación
de aceptación del formato y estabilidad de bloque se describe con esa limitación.

## Reutilización y límites

[SUMMARY](../research/unreal-assets/SUMMARY.md) y
[PORTABILITY](../research/unreal-assets/PORTABILITY.md) revisados: arte y patrones de gameplay,
sin lógica RPC/EVM portable aplicable. Reutilizar `rpcTransport.mjs`; ninguna dependencia nueva.
Fuentes Unreal intactas. No tocar migraciones, `.env` real, host, simulación, perfiles, protocolos,
catálogo/tokenización, contratos Solidity o frontend. Principal integra/acepta; Luna revisa fuentes
y pruebas delimitadas. Entrega/evidencia propia, conservando checkpoints anteriores y trabajo ajeno.
