# W02j-a — preparación offline del despliegue experimental

Fecha: 2026-10-08. [Plan](../../PLAN-WEB3.md), [contrato W02i](w02i-amoy-erc721-pilot.md).
Subcorte de W02j: preparar datos revisables antes de solicitar firma. La wallet/dirección pública
del autor siguen sin suministrarse; eso impide el envío público, no este trabajo local.

## Resultado y autoridad

Preparador independiente del arranque del juego, con red Amoy y direcciones públicas de deployer
y operador explícitas. Recompilar el contrato W02i con el toolchain fijado y exigir igualdad exacta
del artefacto entregado; no aceptar un archivo alterado como base de la transacción.
Codificar bytecode/constructor, conservar valor cero y preparar el runtime esperado rellenando
las referencias inmutables con el operador. Deployer y operador pueden ser distintos.

Informe de revisión con identidad de build/artefacto, hashes y datos de creación sin firma.
No incluir `to` (creación), nonce, gas o fees inventados, dirección futura de contrato ni recibos.
Dejar red no verificada, simulación/estimación/firma/envío/despliegue pendientes.
No generar claves ni seleccionar RPC, cuentas o presupuesto por defecto.

## Aceptación local

- Validación de registro exacto y direcciones no cero; rechazo de red incorrecta, extras, Proxy,
  accessors y checksum mixto incorrecto antes de compilar. Canonicalización EIP-55 sin EIP-1191.
- Constructor codificado corresponde al operador explícito, independiente del deployer; bytecode
  de creación + argumentos exactos, SHA-256 del artefacto UTF-8 y keccak256 del código binario.
- Runtime esperado coincide con bytecode ejecutado por EthereumJS con 80002 **simulado**.
- CLI exacta `--prepare`/`--help`, entorno mínimo y errores acotados; RPC/claves dummy ignorados,
  archivo `.env` dummy aislado no cargado, fuentes/artefacto reales sin mutación.
- Artefacto alterado/ausente en copia aislada rechazado sin revelar rutas/mensajes; limpieza de
  directorios temporales verifica contención antes de borrado recursivo.

Esto no prueba simulación RPC, fondos, gas, firma, hardfork público, despliegue, finalización ni
NFT en Amoy. Mantener W02j-b/c pendientes y aceptación Supabase/wallet/juego aparte.

## Reutilización y siguiente paso

Reusar viem, artefacto/toolchain W02i y ejecutor local W02g; sin dependencias nuevas ni tocar sus
fixtures abiertos. [Inventario Unreal/FAB](../research/unreal-assets/SUMMARY.md):
`SM_RepairBench`/`SM_StoragePart_03` son props candidatos; no tienen lógica de preparación ABI,
wallet o contratos portable. Sin arte, importación o cambios de fuentes Unreal.

W02j-b: con direcciones/wallet y endpoint explícitos, preparar la revisión del autor, simular
creación y estimar gas en Amoy con presupuesto de POL de prueba antes del envío.
W02j-c: firma/envío controlados, recuperar por hash ante incertidumbre; verificar recibo, contrato
y runtime/inmutables, mint/transfer y dueños históricos en bloques públicos. Sin reenvío ciego.
