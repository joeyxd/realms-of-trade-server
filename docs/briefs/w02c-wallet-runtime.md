# W02c — montaje opcional de wallet al arrancar

Fecha: 2026-10-08. Desarrollo local autorizado; [aceptación local](../delivery/w02c-wallet-runtime.md).
[Plan Web3](../../PLAN-WEB3.md), [W02b](../delivery/w02b-wallet-browser.md).

## Resultado

`npm start` puede montar el vínculo W02a/W02b mediante configuración explícita del operador.
Por defecto queda apagado. El montaje exige cuentas Supabase habilitadas, store durable,
origen canónico y chain ID explícitos; nunca sustituye Supabase por memoria.
No selecciona red/proveedor, consulta blockchain, acuña activos ni activa compras.

## Contrato operativo

- `MN_WEB3_WALLET_ENABLED`: ausente o `0` desactiva; únicamente `1` activa. Otro valor falla.
- `MN_WEB3_WALLET_ORIGIN`: origen exacto de la página, HTTPS salvo HTTP loopback.
- `MN_WEB3_WALLET_CHAIN_ID`: decimal canónico de 1 a 2147483647, sin red por defecto.
- `MN_WEB3_WALLET_TTL_MS`: opcional, decimal canónico 30000–600000; por defecto 300000.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_PUBLIC_KEY`: proyecto común de cuentas/storage.
  Cliente service-role stateless separado del cliente Auth y de los bearer de jugadores.

Variables de wallet adicionales con la opción apagada se ignoran; no habilitan nada por accidente.
La opción activa con configuración incompleta falla con diagnóstico fijo, sin imprimir valores.
No inferir origen desde Host, proxy, ORIGINS o la URL de Supabase.

Antes de escuchar HTTP/WS, una consulta read-only verifica el contrato/ACLs de wallet instalado.
Migraciones opcionales Web3 `002_wallet_link.sql` y `003_wallet_readiness.sql`, en ese orden;
W01 no es dependencia. El chequeo no crea retos, vínculos, usuarios o perfiles y no aplica SQL.
Un fallo/timeout impide escuchar; sin fallback ni reintento automático. Cada RPC conserva su límite.
La comprobación de arranque no certifica disponibilidad futura, concurrencia Postgres real o una red.
La consulta revisa permisos efectivos de tabla y de columna: un permiso de columna puede existir
sin permiso sobre toda la tabla. [Funciones de privilegios PostgreSQL](https://www.postgresql.org/docs/18/functions-info.html).
La función usa privilegios del invocador y search_path vacío;
[contrato de funciones PostgreSQL](https://www.postgresql.org/docs/current/sql-createfunction.html).

## Reutilización y aceptación

Reutilizar servicio, adaptador SQL, resolver y panel existentes. Inventario Unreal/FAB revisado:
modelos, iconos y Blueprints no aportan montaje server-only; cero arte nuevo o fuentes modificadas.
No cambiar simulación, perfiles, protocolo, versión, launchers de amigos o configuración live.

Probar apagado sin clientes/peticiones; configuración inválida sin filtraciones; cuenta/resolver
requeridos; cliente service-only y ACLs SQL; readiness sin escrituras y bloqueo de listener;
servicio/HTTP real contra SDK + SQL local, firma y vínculo conservado tras reabrir almacenamiento.
Revisar evidence y regresión pertinente. El SQL local/proveedor simulado no equivale a Supabase live,
extensión real, testnet o publicación. La UI ya existente mantiene la aceptación histórica W02b.
