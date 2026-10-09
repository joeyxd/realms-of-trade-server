# W02b — vínculo de wallet desde Cuenta

Fecha: 2026-10-07. **Implementado y verificado localmente; montaje opcional.**
[Contrato](../briefs/w02b-wallet-browser.md), [plan](../../PLAN-WEB3.md).

El panel Cuenta permite consultar el vínculo, conectar una wallet inyectada, revisar el mensaje,
firmar explícitamente y recuperar la confirmación. Usa la sesión Supabase existente. La validación
del mensaje completo y los controles de cambios de cuenta/dirección/red evitan enviar firmas tardías.
La firma solo vincula una dirección; no concede activos, derechos jugables o autorización de gasto.

## Cambios

- `src/client/walletProvider.js`: adaptador EIP-1193 con métodos acotados, errores públicos fijos y
  exclusión de prompts incluso si vence el timeout antes de resolverse la solicitud del proveedor.
- `src/client/walletLink.js`: flujo independiente de gameplay, respuesta estricta, revisión SIWE,
  comprobaciones de identidad en cada espera, consulta y recuperación sin firma automática.
- `AccountAuth.sessionIdentity()` devuelve UUID/token de una misma sesión actual. El estado solo
  publica el UUID; no el bearer. Logout/cambio de cuenta borra la lectura de vínculo anterior.
- `WalletPanel`, CSS y montaje en Cuenta/main. Los controles conservan el foco al cambiar de estado;
  el mensaje puede recorrerse con teclado. Cerrar Cuenta o zarpar descarta el intento local.
- GET público `/web3/wallet/config`: solo origen/red/tipo de prueba cuando está habilitado; de otro
  modo `{enabled:false}`. Las rutas privadas conservan resolución Supabase, Bearer y Origin exacto.

W02a mantiene un reto pendiente por cuenta. **Cerrar intento no lo cancela en el servidor ni cierra
una ventana de la wallet:** puede retomarse con la misma dirección; otra espera al vencimiento.
La interfaz explica esto y distingue el mensaje pendiente de un prompt del proveedor. Los tests
cubren el cambio durante un POST ya enviado y la reanudación antes/después de la caducidad.
Si el servidor ya confirmó un vínculo, cerrar o perder la respuesta no lo revierte: se consulta.

## Evidencia local

| Pase | Resultado |
|---|---|
| Adaptador/navegador/configuración, tres archivos nuevos de tests | **19/19** |
| W02a + registro W01 + contenido/equipo + cuentas/Auth, doce suites seleccionadas | **90/90** |
| Chrome desechable, componentes reales en escritorio 1280×900 y móvil emulado 390×844 / 844×390 | **3/3** |

**109 tests**, cero fallos/omitidos/cancelados/todo. Node v24.14.0 y viem 2.57.3.
Comandos y hashes en [evidencia](w02b-wallet-browser-evidence.json).

`tools/qa-wallet-link.mjs` monta AccountAuth/AccountPanel/WalletLink/WalletPanel reales en un fixture
de componentes servido en el origen local del juego. Usa SDK Supabase contra Auth local simulado y
firmas EOA reales de claves públicas de prueba contra el servicio W02a en memoria. No hay partida
conectada ni mundo renderizado en ese fixture. Playwright está instalado fuera del repositorio;
el contexto desechable recibe permiso de loopback para acceder al Auth local.

Se comprobaron login, red incorrecta sin reto/firma, conectar sin firmar, rechazo de firma, confirmación,
consulta/reabrir/recarga sin otra firma, Escape/foco y ausencia de desbordamiento horizontal.
Los botones son alcanzables mediante scroll y miden al menos 44 px de alto. Escritorio pierde
deliberadamente la respuesta **después** del commit y recupera por GET; solo tres verificaciones
para tres vínculos. Cero errores JavaScript; el fallo de red inducido es parte de ese caso.

Se inspeccionaron las seis capturas finales de revisión y vínculo:
[escritorio](w02b-wallet-browser/desktop-review.png),
[escritorio vinculado](w02b-wallet-browser/desktop-linked.png),
[vertical](w02b-wallet-browser/mobile-portrait-review.png),
[vertical vinculado](w02b-wallet-browser/mobile-portrait-linked.png),
[horizontal](w02b-wallet-browser/mobile-landscape-review.png),
[horizontal vinculado](w02b-wallet-browser/mobile-landscape-linked.png).
[Resultados medidos](w02b-wallet-browser/results.json).

La evidencia W02a anterior conserva su snapshot histórico. W02b amplía únicamente su frontera HTTP
con configuración pública y el montaje desactivado por defecto; no modifica SQL Web3, la prueba
criptográfica del servicio ni el registro W01. Los archivos compartidos conservan trabajo concurrente.

## Montaje y límites

`createGameServer({walletLink,resolvePlayer,publicAuth})` habilita el backend; Cuenta descubre la opción
desde el mismo origen. `npm start` conserva la opción desactivada. Para persistir vínculos el montaje
debe usar `createSupabaseWalletStore` con la migración opcional Web3 002 aplicada. La memoria solo
sirve para pruebas/desarrollo y pierde vínculos al reiniciar. No se aplicó SQL ni se cambió configuración live.

W02 sigue parcial: falta seleccionar/verificar testnet/RPC, extensión real, wallets de contrato,
Supabase real y dispositivos físicos. El flujo exige wallet inyectada; navegador móvil normal sin
proveedor muestra una explicación y permite seguir jugando. No añade WalletConnect o revinculación.
Tokenización, pagos, custodia, equipo jugable y parcelas transferibles mantienen sus propios cortes.
Sin despliegue, commit o push en esta entrega.
