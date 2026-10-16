# W02c — activación opcional del vínculo de wallet

Fecha: 2026-10-08. **Implementado y verificado localmente; apagado por defecto.**
[Contrato](../briefs/w02c-wallet-runtime.md), [plan](../../PLAN-WEB3.md).

El arranque ordinario puede montar el flujo de wallet de Cuenta mediante configuración explícita.
La opción queda apagada por defecto. Activarla exige cuentas y almacenamiento Supabase, origen
exacto y chain ID del operador. No hay selección automática de red o sustitución por memoria.

## Cambios y comprobación de arranque

- `server/web3/walletRuntime.mjs` valida la configuración y crea un cliente service-role separado,
  sin sesión persistida/refresh ni bearer de jugador. HTTPS salvo loopback, sin redirecciones y con
  límite de 10 s que conserva el AbortSignal del SDK.
- El adaptador durable incorpora `checkReady()`: exige el DTO exacto `{version:1}` de la consulta.
- `server/migrations/web3/003_wallet_readiness.sql` agrega únicamente una función read-only,
  service-only, que comprueba tablas/RLS, columnas accesibles y permisos efectivos de tabla/columna,
  RPCs/helpers y sus ACLs. No inserta retos ni vínculos, no altera permisos de W01 ni aplica SQL.
- `server/index.mjs` monta la opción desde env y espera la consulta antes de preparar el mundo o
  escuchar HTTP/WS. Fallo, timeout o configuración incompleta detienen el arranque con texto fijo.
  Invocaciones simultáneas de `listen()` comparten una sola preparación.
- Plantilla del operador ampliada en `deploy/marea-negra.env.example`; sin tocar `.env` real.

La consulta acredita los prerrequisitos revisados en ese instante: no compara hashes del cuerpo SQL,
no prueba mutadores/concurrencia real y no garantiza disponibilidad futura. `/health` sigue indicando
salud del juego/mundo; una caída posterior de wallet se comunica por sus respuestas HTTP fijas.
La API embebida `createGameServer` conserva servicios de fixture sin `prepare`; el arranque normal
usa exclusivamente el montaje durable validado. No se activa staging durable de gameplay.

## Configuración revisable

Mantener las cuentas y migraciones del juego verificadas conforme a M5. Para añadir este montaje,
aplicar por decisión operativa las migraciones **opcionales Web3** `002_wallet_link.sql` y luego
`003_wallet_readiness.sql`. No confundirlas con SQL002/003 del juego; Web3 001 es independiente.
El servidor solo comprueba lo instalado, nunca ejecuta migraciones.

En la configuración privada del operador:

```dotenv
MN_WEB3_WALLET_ENABLED=1
MN_WEB3_WALLET_ORIGIN=https://game.example
MN_WEB3_WALLET_CHAIN_ID=<chain-id-del-piloto-elegido>
MN_WEB3_WALLET_TTL_MS=300000
```

Sustituir origen y chain ID por los valores explícitos del piloto. Arrancar con `npm start`;
la consulta `/web3/wallet/config` debe devolver la política pública esperada y Cuenta muestra
el panel. `MN_WEB3_WALLET_ENABLED=0` desactiva el montaje al arrancar. Desactivarlo no elimina
vínculos o retos almacenados; un reto pendiente conserva las reglas de caducidad W02a/W02b.
No inferir el origen desde cabeceras/proxy ni copiar el service key a configuración pública.

## Evidencia y alcance

Resultados y comandos en [evidencia](w02c-wallet-runtime-evidence.json).
**15/15 nuevas + 130/130 de regresión seleccionada: 145/145**, sin fallos, omitidas, canceladas o todo.
Node v24.14.0, viem 2.57.3. Las regresiones incluyen W02a/b, W01, contenido de equipo, cuentas,
servidor HTTP/WS, storage y mundo. No es una ejecución completa del repositorio.
Pruebas específicas de configuración/arranque, límites y separación de clientes; SDK Supabase
contra PGlite local, firma EOA real de clave pública de fixture, HTTP y vínculo conservado tras
cerrar/reabrir el almacenamiento. Pruebas SQL con registros pendientes y completados verifican
ausencia de escrituras, coexistencia W01 y rechazo independiente de ACLs/RLS/RPCs alterados.
El entrypoint de `npm start` se prueba en copias temporales sin `.env`: apagado por defecto/flag 0,
configuración inválida y respuesta de readiness incompatible que evita cualquier RPC de mundo.
El cierre por señal en Windows usa un harness que importa el mismo entrypoint con su condición de
arranque real y emite SIGTERM; no se reinicia el proceso original. El fixture HTTP de vínculo usa
mundo en memoria y wallet SQL local; no demuestra integración del mundo durable con Supabase live.

La revisión Unreal/FAB reutiliza la lógica propia: los modelos/iconos/Blueprints del inventario no
resuelven montaje server-only. Cero arte nuevo, UI nueva, imports o cambios a fuentes Unreal.
La aceptación visual W02b es histórica; este corte verifica backend/arranque y no hace otra pasada
de navegador. Sus fuentes de UI se contrastan con la evidencia anterior.
W01 (10 fuentes) y W00-equipo (7) conservan todos sus hashes. W02b conserva 15/20 fuentes;
cambian `server/index.mjs` y sus cuatro documentos de continuidad por este montaje. Las fuentes
de UI permanecen exactas; los manifiestos históricos no se reescriben.

No se aplicó SQL live ni se arrancó/reinició el host del autor. Sin Supabase live, extensión real,
RPC/testnet, contratos, tokens, compras o publicación. W02 sigue parcial; reglas de pérdida,
custodia, licencias/economía y escritura siguen pendientes antes del piloto jugable W03/W04.
Sin cambios de simulación, perfil, protocolo o versión; trabajo concurrente conservado.
