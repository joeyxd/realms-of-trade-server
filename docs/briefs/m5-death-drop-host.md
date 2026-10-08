# D09f-2b.29 — montaje opcional del botín ordinario

Base: 4a23e6f81a163c44be0d7143fc7143e68d540b18. Fuentes fijas y aceptación antes de integrar hunks propios en el checkout compartido.

El host autenticado sin bots monta PearlStaging, DeathStaging, CombatDeath y después mountDeathDrops,
antes de preparar/admitir. Un único dueño de beforeTick aplica recibos de muerte, perlas y botín;
solo inicia recogidas cuando termina la cola de muertes y las otras reservas permiten el mundo.
El montaje no cambia CLI, entorno, entrada por defecto, esquema o protocolo.

Para fuentes ordinarias gestionadas, la selección ocurre en el tick completo actual **antes del
siguiente paso** y cada tercer tick lógico. Es un cambio explícito respecto a la selección local dentro
de stepDrops: movimiento completado en el tick anterior decide distancia; no se avanza tiempo mientras
espera storage. Pickup incluye availableAt/expiresAt, expiry exige at > expiresAt. Orden de inserción
de suelo y perfiles, primera cuenta viva cercana con capacidad. Cada recibo se aplica antes de capturar
el siguiente inventario; una respuesta ambigua conserva su petición original.

Native stepDrops omite cualquier fuente marcada con operationId u ordinal, incluso metadatos
malformados. El dueño valida/fencea; jamás cae al consumo local. Las perlas, oro, quest/chest y fuentes
sin identidad durable mantienen sus rutas. Los avisos full se recuerdan en el coordinador, sin añadir
Set al JSON del drop. El callback actual de LocalServer solo acredita quest, excluida de este flujo;
los objetos y pociones no agregan crédito ni callbacks externos al aplicar.

Retener snapshots/eventos/saves/comandos/admisión desde selección hasta fin del lote; input/ping puede
seguir entrando. Close/disconnect invalida antes de actor mutation; cierre espera IO pero no aplica ni
publica. Fallo de storage, propietario de hook distinto, tick/perfil/ECS/source cambiado: cierre sticky,
recibo SQL conservado. No restaura suelo automáticamente ni reabre botín consumido.

## Unreal/FAB comprobado

Solo lectura: BP_InventoryComponent.uasset (24.878.603 bytes) y SM_Potion.uasset (117.402 bytes) en
C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem. Blueprint no portable al CAS JS;
poción solo candidata visual, no resuelve autoridad/IO. Se reutilizan gate/queue/journal/staging/apply
SQL011/012 y lifecycle del host; fuentes Unreal intactas, sin export ni arte nuevo.

## Aceptación

Pruebas de flujo real memoria y SDK/SQL012: muerte produce botín, pickup/expiry por beforeTick,
respuesta retrasada/perdida, múltiples fuentes/receptor, capacity/fallback, legacy, cierre/fence y
ownership. Regresión de copia fija; integración selectiva y comprobación de drift compartido.
SQL010 confirmada por el autor. SQL011/012 aplicación real sin confirmación/canario en este corte.
Sigue hidratación actual con reloj estable, piloto restart/reconexión/WAN y luego afinidad permanente.
