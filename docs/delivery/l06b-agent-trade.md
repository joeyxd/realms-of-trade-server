# Entrega L06b-2b — comercio explícito de agentes

Fecha de corte: 2026-10-10. AREA17 L06b-2b implementado en **0.6.0-alpha.26, protocolo 38**, integrado con Tala, refugio naval y GM02. El código conserva comercio de agentes apagado por defecto. La publicación y su evidencia se registran abajo; **SQL017 live y el canario económico autenticado permanecen pendientes**.

## Resultado implementado localmente

- El runner autenticado puede pedir compras o ventas M5 explícitas por `agent_trade`; la cuenta y ciudad se resuelven en el servidor. Capacidades `trade_buy` y `trade_sell` son parte del binding confiable. El dueño no las añade ni modifica mediante la API de mandato.
- El dueño autenticado puede crear, leer y revocar el presupuesto de un personaje ya configurado. El servidor toma al dueño de la sesión. El presupuesto es único por mundo/personaje y usa `budgetId` UUID canónico.
- Mandato único por personaje/mundo, con límites acumulados durante toda su vida, sin refill ni reemplazo: gasto de compras y límite por compra; unidades vendidas por bien y límite por venta. El perfil, oro y bienes pertenecen al personaje agente; no hay transferencia del patrimonio del dueño.
- SQL017 almacena política, consumo y asociación inmutable al recibo M5. `mn_commit_agent_trade` comprueba los cambios reales de oro y bienes y delega el commit de juego a SQL014/015 en la misma transacción. La asociación no constituye una segunda autoridad de gameplay.
- Replay exacto devuelve el recibo sin duplicar consumo, incluso después de revocar el mandato; operación alterada o recibo humano preexistente se rechaza. El mandato revocado impide operaciones nuevas. Un stop antes del dispatch cancela; tras el dispatch se reconcilia cualquier respuesta incierta.
- `agentTrade` conserva default apagado. El host opt-in valida readiness de SQL017 antes de abrir el mundo. No se activa al publicar el código ni instala migraciones. No se añade proveedor ni compra automática desde la mente simulada.
- La reentrada conserva las identidades de operaciones inciertas. El proyector ignora un DESPAWN numérico de la vida anterior si el cuerpo actual sigue vivo; destruir el cuerpo actual sí retira la sesión. La prueba de red fuerza el mensaje tardío después de WELCOME y recupera el recibo sin un segundo débito.

Contrato/CLI bilingüe: [docs/agents/trade.md](../agents/trade.md). El brief de referencia es [L06b agent trade](../briefs/l06b-agent-trade.md).

## Verificación local

- Regresión integrada: **922 casos, 917 aprobados, cero fallos y cinco omisiones de symlinks Windows, en 125 archivos**, terminada a las 19:50:23 UTC. [Manifiesto y hashes](l06b-agent-trade/integrated-tests.json), [salida TAP](l06b-agent-trade/integrated.tap). Abarca agentes, economía humana, SQL014–017, recursos, Tala, refugio naval y editor GM; 1107 archivos fuente estables durante la ejecución.
- Revisión enfocada final: 15/15 pruebas de percepción, CLI, cliente y runner; incluye reentrada con DESPAWN tardío, recibo perdido y presupuesto revocado cuya proyección caducó.
- Presupuesto/SQL017/host adicional: **20/20**, incluida venta SQL, límite acumulado de unidades, ingresos que no reponen autorización de compra, rechazo de delta falsificado sin escritura y replay después de revocar. [Manifiesto](l06b-agent-trade/supplemental-tests.json), [salida](l06b-agent-trade/supplemental.tap). Después de la suite amplia solo se añadió ese caso SQL y se retiró una línea vacía al final del test del host; ambos archivos se repitieron. El manifiesto comprueba que runtime y demás fuentes conservan los mismos hashes. Los otros diecinueve casos ya estaban incluidos; no se suman como cobertura independiente.
- Regresión económica/recursos previa: 25/25, incluida en la ejecución integrada.
- Host: ocho casos de dueño autenticado y límites, gates/default-off, readiness, reinicio, identidad de presupuesto, denegaciones sin gasto, carga/stock y revocación antes/después de dispatch; incluidos en la suite integrada.
- [Historial de validación](l06b-agent-trade/validation-history.json) conserva el fallo inicial de CLI y las correcciones posteriores. La pasada anterior de 878 casos precede a GM02 y a la corrección de reentrada; no sustituye la regresión final.

Estas pruebas usan memoria y PGlite local. La reapertura comprueba persistencia local del archivo PGlite; no demuestra funcionamiento de SQL live, permisos del proyecto Supabase configurado ni estado de producción.

## Publicación

Pendiente tras la regresión final: envío de este corte aislado a la rama de continuidad y relevo mediante el actualizador existente cuando el mundo esté vacío. Se verifican revisión/imagen activa, salud M5/recursos, entrada WSS real y rechazo de los canales nuevos para invitados. El protocolo 38 requiere recargar clientes anteriores.

El montaje conserva los flags vigentes de recursos/Tala y no cambia SQL, secretos ni configuración. `npm start` mantiene piloto, comercio y proveedor de agentes apagados. El smoke público es de invitado: no acredita una compra/venta autenticada ni permisos SQL017 en el proyecto Supabase real.

## Siguiente corte y límites

SQL017 requiere aplicación y verificación live de readiness/ACL/RLS, compra/venta autenticadas, revocación y recuperación de recibos antes de activar esta opción. Su publicación inerte no satisface esa aceptación. No hay renovación del mandato ni traslado de oro/bienes del dueño al agente.

La siguiente entrega de AREA17 es L03d: proveedor real y canario social/PvE acotado, con memoria, consumo y feedback comprobables. La activación económica tiene su propia puerta; construcción, carga, equipamiento y aportes de agentes continúan fuera de este corte.

## Reutilización de assets

No requiere assets nuevos. Se reutilizan identidad, control, comercio, perfil y autoridad económica M5 existentes. El inventario de Unreal/FAB del brief previo no mostró una pieza que sustituya la validación server-side o el commit durable.
