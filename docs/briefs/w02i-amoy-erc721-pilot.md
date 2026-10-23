# W02i — contrato experimental ERC-721 para Amoy

Fecha: 2026-10-08. Continúa W02h dentro del desarrollo autorizado; prepara una entrega revisable
antes de una transacción pública. [Plan](../../PLAN-WEB3.md), [diagnóstico previo](../delivery/w02h-amoy-rpc-check.md).

## Contrato y aceptación

Crear un contrato nuevo de prueba, separado de los fixtures sin autorización W02g: constructor
solo en chain ID 80002 y operador explícito no cero e inmutable; mint restringido a ese operador
y Amoy, mediante safe mint. IDs uint256 arbitrarios de prueba, duplicados rechazados; sin burn
ni cambio de operador. No fija tirada o economía de producto. Transferencias y approvals ERC-721
estándar, sin facultad administrativa de quitar tokens a otro dueño.

Nombre, símbolo y URI JSON constantes identifican un experimento sin equipo, tierra, licencia,
pago o permisos jugables. Sin royalties, custodia, proxy, pagos, arte o puente W01/juego.
No representa aún el formato contractual comercial definitivo ni es una auditoría de seguridad.

Compilar con el toolchain exacto W02g y registrar ABI, bytecode, plantilla de runtime con referencias
inmutables y entrada Standard JSON completa. Construcción reproducible sin claves, `.env`, RPC o
herramienta de envío. Probar bytecode real: rechazo de otras redes/operador cero, autorización,
duplicados/receptores, metadata, approvals/transferencias y lector/CLI existente por hash.

El laboratorio simula chain ID 80002 para ejecutar CHAINID; **sigue siendo una EVM local con
bloques sintéticos**, nunca una prueba de Amoy real. Mantener fixture W02g por defecto en 31337.
El artefacto compilado es preparatorio; no desplegar los contratos auxiliares de receptores.
Transacciones/recibos públicos, hardfork real, costes, finalidad y lector NFT público requieren W02j.

## Reutilización y límites

[Inventario Unreal/FAB](../research/unreal-assets/SUMMARY.md) y candidatos concretos revisados:
StoragePart_03, RepairBench, SmallWoodeHut y BuildHammer aportan props/referencia visual, sin
lógica ERC-721 o compilación portable. No se necesita arte para esta metadata de prueba.
Reutilizar OpenZeppelin, compilador y ejecutor EVM del paquete privado; fuentes Unreal intactas.

Principal conserva contrato/arquitectura/artefacto/docs y aceptación; Luna revisa y escribe pruebas
delimitadas. No nuevas dependencias, SQL (incluida 013), configuración real, arranque/host, UI,
perfiles/simulación/protocolo, indexer, token/activo, permisos, proveedor permanente, pagos,
deploy público o commit/push. Preservar trabajo concurrente. Antes de W02j falta una dirección
pública del operador y un flujo de firma testnet controlado por su wallet, sin claves en chat.
