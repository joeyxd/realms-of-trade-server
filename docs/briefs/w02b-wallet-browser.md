# W02b — vincular wallet desde el navegador

Fecha: 2026-10-07. Desarrollo local autorizado como continuación de W02a.

## Alcance

Flujo opcional dentro del panel Cuenta: sesión Supabase → consultar vínculo → conectar wallet
inyectada → revisar dirección/red/mensaje → firmar explícitamente → confirmar por HTTP.
Recargar o consultar recupera un vínculo confirmado cuando se perdió la respuesta.
El juego ordinario sigue disponible sin wallet. No cambia perfiles, snapshots, simulación ni activos W01.

`npm start` conserva Web3 desactivado. El operador debe montar el servicio W02a con origen y chainId
explícitos; los IDs de red de fixtures no son una selección de testnet. No se añade proveedor RPC,
WalletConnect, firma de contratos ERC-1271, acuñación, transacción, precio o custodia.

## Contrato y autoridad

- GET `/web3/wallet/config` público y sin credenciales: `{enabled:false}` cuando no está montado;
  montado: `{enabled:true,origin,chainId,proof:'eoa'}`. Sin claves, vínculos o datos de cuenta.
- Las rutas W02a de consulta/reto/verificación conservan Bearer y resolución Supabase del servidor.
  POST exige Origin exacto. El navegador solo permite un backend con el mismo origen que la página.
- `AccountAuth.sessionIdentity()` devuelve el par UUID/token de la sesión actual; no publica el
  bearer en estado. Cambio de usuario, incluso con el mismo correo, invalida el intento de wallet.
- `WalletLink` valida la estructura exacta del reto y el mensaje completo: origen/URI, cuenta,
  dirección, red, nonce, request ID y tiempos. Preserva los bytes del mensaje firmado.
- Adaptador EIP-1193: únicamente `eth_requestAccounts`, `eth_accounts`, `eth_chainId`, `personal_sign`.
  Conexión y firma requieren acciones distintas del usuario. Sin cambio automático de red o fallback.
- Releer dirección/red antes y después de pedir el reto y de firmar. Eventos de cambio/desconexión,
  cierre, logout o zarpe invalidan respuestas tardías; no se envían firmas tardías a verificación.
  `accountsChanged` durante la autorización inicial se resuelve releyendo la dirección antes de mostrar revisión.
- Timeout de HTTP 15 s; espera de wallet 120 s. Un timeout no cancela un prompt de la wallet:
  conservar su exclusión hasta que la promesa del proveedor termine, evitando otro prompt simultáneo.
  La simulación no espera estos procesos.

## Cierre, pendientes y recuperación

`Cerrar intento` elimina la revisión local, sin borrar un reto durable ni cancelar una ventana de la
wallet. W02a mantiene un pendiente por cuenta: la misma dirección puede retomarlo; otra debe esperar
su vencimiento (30 s–10 min según la configuración, 5 min por defecto). La interfaz distingue este
pendiente del proveedor y explica la retención. Un cambio durante el POST puede dejar el reto anterior
guardado; siempre se vuelve a comprobar identidad antes de firmar y la reserva vence.
Si una verificación ya fue enviada, cerrar no revierte un vínculo que el servidor haya confirmado;
`Consultar vínculo`/recarga recupera el resultado sin repetir firma ni intentar sobrescribirlo.

## Reutilización de arte y aceptación

Se cruzó [el inventario Unreal/FAB](../research/unreal-assets/SUMMARY.md). Esta parte necesita formularios
y estados, sin modelos, texturas o VFX: se reutiliza el dossier de cuenta y su paleta. Fuentes intactas.

Aceptación: firma EOA local real, DTO alterados, red/origen incorrectos, respuesta perdida, cambio
de cuenta/dirección/red, caducidad, cierre, timeout, exclusión de prompts y limpieza de listeners.
Revisar capturas del componente real en escritorio/móvil vertical/horizontal, teclado y desbordamiento.
Proveedor de wallet y Auth son fixtures: esos recorridos no prueban una extensión real, móvil físico,
Supabase live, RPC/testnet, contratos, dinero ni publicación.

Referencias primarias verificadas: [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193),
[ERC-4361](https://eips.ethereum.org/EIPS/eip-4361). El generador SIWE instalado de viem 2.57.3
se contrastó con la comparación completa del mensaje en el cliente.
