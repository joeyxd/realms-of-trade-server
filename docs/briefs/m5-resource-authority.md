# AREA15 — recolección y fabricación en la autoridad M5

2026-10-10, hora de México. Release alpha.22 preparada, activación pendiente.

## Resultado y frontera

Con `resourceOperations: true` (CLI: `MN_RESOURCE_OPERATIONS=1`), `GameHost` conduce todos los
comandos `resource` por `EconomicAuthority`. Reutiliza la sesión autenticada, el bloqueo de mundo,
las versiones CAS y el recibo económico existente. Requiere `economicOperations: true` y SQL015;
no crea una segunda mochila, base de datos ni escritor de perfiles.

`gather` conserva la selección de nodo/revisión del cliente; `craft` conserva receta, revisión de
mochila y cantidad, normalizando cantidad omitida a uno. La identidad se deriva de cuenta + mundo +
`opId`. El servidor ejecuta `resourceCmd` sobre una copia: mantiene distancia, tierra, combate,
capacidad, herramienta, cooldown, recetas y costes actuales. La transacción confirma perfil completo,
mundo completo y recibo juntos. La publicación del perfil, ACK y golpe ocurre después del commit y
de la aplicación síncrona; repetir un recibo histórico no aplica datos ni eventos antiguos.

El progreso de palmera/roca/veta también se confirma en golpes sin material. Fabricar herramienta
confirma cinturón y consumo de ingredientes juntos. Cada ACK durable se refiere a esa operación;
otras acciones de perfil que siguen con autosave conservan sus propios límites.

## Estado, reinicio y compatibilidad

`mn_worlds.economy.resources` contiene `v:1`, `tick`, nodos `{id,kind,rev,hits,readyAt}` y cooldowns por UUID
de cuenta. No contiene coordenadas ni configuración de contenido enviada por el jugador. Se valida
todo el catálogo contra el mundo generado antes de restaurar; corrupción, IDs faltantes o cambio
de tipo bloquean el arranque en lugar de regenerar silenciosamente los recursos.

Decisión del autor, 2026-10-10: **la reaparición de recursos se pausa durante el apagado**. `tick`,
`readyAt` y cooldowns usan ticks lógicos del mismo mundo. Al reabrir se proyecta `readyAt - tick`
sobre el tick local, sin sumar tiempo offline. Cambiar la hora del sistema no adelanta la reaparición.
Un nodo cuyo plazo ya terminó en juego conserva su revisión; los golpes parciales permanecen.
Se conserva la pausa offline aprobada separadamente para perlas/botín; este corte no monta ese reloj.

La operación guarda perfil, nodo, reloj y recibo en la misma transacción. Autosave y cierre también
checkpointan el reloj, permitiendo solo avance monotónico sin cambiar nodos/cooldowns. Ante una caída,
el tiempo de simulación posterior al último checkpoint puede retroceder (cadencia de mundo: 60 s por
defecto; no es un SLA de tiempo real), pero la operación confirmada no se separa de su reloj/nodo/perfil.
Una respuesta incierta bloquea el mundo. La simulación y la restauración no consultan `Date.now()`.

Un mundo legacy sin `resources` adopta una vez el catálogo inicial antes de admitir jugadores,
preservando perfiles, economía y comunidad. No reconstruye golpes anteriores que nunca se guardaron.
Una vez adoptado, `mn_save_world` no puede borrar ni reescribir nodos/cooldowns ni atrasar su reloj;
tampoco un comercio/aporte antiguo puede omitirlos. Un host con esta versión y la opción deshabilitada rechaza ese mundo.
El rollback requiere una versión que entienda este contrato; no volver al runtime anterior sobre
el mundo adoptado. Copias de seguridad y ensayo de restauración de la base siguen siendo otra entrega.

La primera adopción de un mundo que nunca guardó recursos inicia sus nodos disponibles, como el
arranque anterior: no hay un estado histórico de agotamiento que importar. Conserva los perfiles
existentes. Desde esa adopción, golpes y agotamiento sí se restauran. Un formato `resources` presente
pero incompatible falla antes de admitir; no se reemplaza por nodos nuevos.

Los invitados no pueden mutar recursos compartidos en este modo: reciben `account_required`, con
mensajes ES/EN. Modo solo y servidores sin el nuevo flag conservan su recorrido anterior. Protocolo
sin cambio: comandos y snapshots públicos conservan su forma; recibos añaden los campos opcionales
`durable`, `replay` e `historical` ya usados por la economía.

## Activación concreta

1. Revisar/aplicar [SQL015](../../server/migrations/015_resource_operations.sql) después de 001–014;
   comprobar `mn_resource_operations_ready()` como servicio y denegación a roles públicos.
2. Preparar una release desde archivos revisados, sin incorporar el árbol compartido entero. Mantener
   una única autoridad y las mismas cuentas, `WORLD_ID` y secretos.
3. Con cero jugadores y sin operaciones pendientes, activar `MN_RESOURCE_OPERATIONS=1` junto con
   `MN_ECONOMIC_OPERATIONS=1` y arrancar la release compatible. El preflight comprueba SQL antes de
   crear/restaurar el mundo. Verificar revisión/imagen reales, salud y `storage.resources`.
4. Cuenta real: recoger, fabricar y trabajar un nodo; comparar recibos/perfil/mundo, reconectar y
   repetir UUIDs. Reinicio ordenado y corte abrupto controlado requieren evidencia propia en el VPS.

SQL015 se ensaya localmente y tiene un canario remoto separado; ver el estado de activación en la entrega.
La autoridad conserva la pausa global durante la transacción de la primera alfa económica. Esto
no acredita capacidad MMO ni elimina la latencia de almacenamiento.

## Contrato para cada feature nueva

Antes de aceptar progreso permanente, registrar en [continuidad](../CONTINUITY-STATUS.md):

- Dueño y scope de cada dato: perfil, mundo, objeto o dato temporal; defaults/migración y saneado.
- Qué acción constituye confirmación durable, qué filas cambia y dónde se publica el resultado.
- Identificador estable de operación, recibo, replay histórico y resultado ante respuesta perdida.
- Recuperación antes de admitir al jugador; pruebas antes/después del commit, reconexión y cierre.
- Cobertura local, SQL real y activación pública por separado. No anunciar permanencia por un autosave.

Cualquier feature con materiales, XP de oficio, receta aprendida o recompensa acoplada debe incluirlos
en la misma propuesta/commit; no concederlos después del ACK en un guardado paralelo.

## Reutilización

Se reutilizan `resourceCmd`, `EconomicAuthority`, `WorldState`, `ProfileSessions` y SQL014. El inventario
Unreal identifica `ActionRPGStarterSystem/InventorySystem/Components/BP_InventoryComponent.uasset`;
se comprobó su existencia (24.878.603 bytes) en la fuente intacta. Es una referencia de flujo, no un
adaptador JS/Postgres. No hace falta arte nuevo ni importar Blueprint para este cambio de continuidad.
