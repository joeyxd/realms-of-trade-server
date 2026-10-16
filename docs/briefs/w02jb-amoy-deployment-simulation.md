# W02j-b — simulación de creación y estimación, sin firma

Fecha: 2026-10-09. Alcance autorizado: continuar W02 después de W02j-a. Este corte prepara y
verifica la herramienta local; la ejecución pública requiere direcciones y RPC explícitos del autor.

Recrear internamente el reporte W02j-a; no aceptar ABI/calldata/artefacto libres. Entrada exacta:
chainId 80002, deployerAddress, mintOperatorAddress y simulationGasLimit decimal explícito,
entre 53000 y 30000000 (límite técnico de esta herramienta, no permiso de gasto).

Siete consultas secuenciales: chain ID, bloque latest, gasPrice observado, eth_call de creación
por hash/canonical, eth_estimateGas en el número de ese bloque, releer bloque y chain ID.
Exigir runtime completo con inmutables, gas positivo dentro del límite y estabilidad del bloque.
No fallback a latest, retries, state overrides, clave, firma o envío. EIP-1898 no garantiza selector
hash para estimateGas; declarar número para estimación y hash para eth_call, sin confundirlos.

Transporte privado del laboratorio, métodos fijos, HTTPS o HTTP loopback, errores redactados,
timeout 10 s por consulta (10–30000 ms), cuerpo máximo 1 MiB. Conservar transporte de lectores.
CLI opt-in --simulate, env explícito sin cargar archivos. Costo orientativo en wei de POL de
prueba mediante enteros exactos; no cotización USD/mainnet, tarifa asegurada ni autorización de gasto.

Aceptación: secuencia/payload exactos, stop temprano, runtime alterado, estimación inválida,
reorg/red cambiada, error RPC/timeout/cuerpo limitado y CLI loopback sin secretos ni env real.
Contrastar creación contra EVM real en memoria conservando estado. Regresión W02d–j-a.
No aceptar Amoy público hasta ejecutar con identidad/endpoint del autor y guardar evidencia.

Reuso comprobado: W02i/j-a, viem fijado, parsers rpcTransport y EVM W02g. Inventario
[Unreal/FAB](../research/unreal-assets/SUMMARY.md): SM_RepairBench/StoragePart03 ofrecen arte
de taller/bodega; no implementan simulación JSON-RPC. No hace falta arte/exportación nueva.
Sin cambios de SQL013, Supabase, host/UI/sim/perfiles/protocolo, dependencias, .env o publicación.
