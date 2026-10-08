# D09f-2b.29 — montaje opcional de recogida y expiración

GameHost puede montar el botín ordinario durable: detiene el tick al elegir una recogida o expiración y solo cambia suelo, inventario y eventos después del recibo confirmado. [Contrato](../briefs/m5-death-drop-host.md). [Evidencia fija](d09f-death-drop-host-evidence.json).

## Comportamiento

mountDeathDrops se instala explícitamente después de PearlStaging, DeathStaging y CombatDeath, antes de prepare/admisión. Requiere mundo vacío, sin bots y hook sin dueño anterior. Comparte beforeTick y reservas existentes; espera la cola de muerte y aplica cada recibo antes de capturar el siguiente receptor. El servidor por defecto continúa sin este montaje.

La selección usa el tick lógico completo actual, antes del siguiente paso y cada tercer tick. La posición del movimiento ya completado decide distancia; se conserva el orden de inserción de fuentes y perfiles, con la primera cuenta viva cercana que tenga capacidad. Es un cambio explícito respecto a la selección nativa dentro de stepDrops. Recogida incluye ambos límites de tiempo y expiry exige tick mayor al vencimiento. La espera de almacenamiento no avanza reloj ni simulación.

Cuando está montado, stepDrops omite cualquier fuente que tenga operationId u ordinal, incluso metadata inválida: el dueño valida y cerca la autoridad, sin consumirla por una ruta legacy. Las fuentes ordinarias válidas son item/potion públicas. Las perlas, oro, quest/chest y objetos sin identidad durable conservan sus rutas actuales.

La barrera retiene snapshots, eventos, perfiles, saves, comandos, upgrade y admisión hasta terminar el lote. Input/ping mantienen su transporte. Los avisos de bolsa/pociones llenas se recuerdan por cuenta y referencia de fuente, sin agregar campos al JSON; un jugador lleno no bloquea al siguiente elegible. Objetos y pociones no ejecutan callbacks de quest ni conceden recompensa adicional. Las capacidades usan el catálogo compartido y deben evolucionar junto al contrato SQL011.

Cerrar o desconectar durante una operación invalida antes de mutar el actor. Shutdown espera IO y jamás aplica desde la continuación asíncrona. Un hook reemplazado, fuente/perfil/ECS/tick cambiado o fallo de storage mantiene fence; SQL confirmado permanece disponible para recuperación explícita. Este corte no restaura suelo ni reabre botín consumido.

## Verificación

**2026/2026**, **167 archivos**, **20 checks nuevos**, en Git archive fijo de base 4a23e6f más fuentes propias. Red: 2/2, concurrencia1, 6524.147 ms; core: 2024/2024, concurrencia2, 268682.5389 ms; total 275206.6859 ms. Fail/cancelled/skipped/todo cero. Node v24.14.0.

El runner comprobó 383 fuentes por SHA256 normalizado antes/después de cada cohorte. Otras 80 fuentes base se comprobaron iguales al archive durante la ejecución y se revalidaron al terminar: 462 fuentes del repo y un módulo privado de Three, con distinto momento de verificación registrado. El alcance amplía el conjunto anterior de 120 a los 167 archivos de pruebas presentes en la copia; no acepta features paralelos del checkout dirty. Three0.160.0 físico privado, sus 954 archivos binarios verificados antes/después; SDK2.117.2 y PGlite0.5.8 por junction, no completamente hasheados. Sin .env en la copia.

Fixtures producen botín mediante muerte real del host, conectan cuentas por HELLO y usan journal/startup reales en memoria y SDK/Supabase contra PostgreSQL local PGlite SQL001–012. Los tres endpoints adicionales del transporte de pruebas ejecutan las funciones SQL de mundo y suelo; no simulan el arranque. Se prueban respuesta retrasada/perdida, request/UUID exactos, varias fuentes al mismo receptor en un tick retenido con versiones/UIDs frescos, EXP Float64 y progreso conservados, bolsas llenas/fallback, avisos por cuenta, vencimiento serial, legacy, cierre, invitados rechazados, drift y propiedad de hooks.

Comprobaciones independientes cubren marcadores parciales, kind alterado, source privado, proxies/accesores sin ejecutarlos, reserva externa y cambio de hook dentro del paso. Los dos fallos iniciales del fixture multiobjeto fueron distancia de dispersión de una semilla no apta; semilla determinista corregida y 9/9 de frontera, luego la regresión completa, pasaron sin cambiar runtime para ese fallo. Revisión Luna acotada y pruebas asignadas; el principal revisó fuentes, evidencia y aceptación.

Logs: shots/review/m5-drop-host-network-accepted.log y shots/review/m5-drop-host-core-accepted.log. Integración compartida: **20/20** checks nuevos en tres archivos, concurrencia1, **8998.0093 ms**. Se vigilaron **541 fuentes** inmediatamente antes/después de ese proceso, sin drift; los cambios ajenos preexistentes en host, LocalServer e inventario se conservaron. Es una comprobación enfocada de esa composición, no la aceptación completa del checkout compartido ni del proveedor real. Log: shots/review/m5-drop-host-shared-focused.log.

## Unreal/FAB y siguiente

BP_InventoryComponent.uasset (24.878.603 bytes) y SM_Potion.uasset (117.402 bytes) comprobados por stat en ActionRPGMultiplayerStart. Blueprint no portable a CAS JS; poción es candidata visual, sin beneficio para autoridad/IO. Reutilizamos gate, journal, staging y SQL011/012; fuentes Unreal intactas, sin exportación ni arte nuevo.

Sin migración, perfil, protocolo o entorno nuevos. SQL010 confirmada por el autor; SQL011/012 continúan sin confirmación/canario Supabase real adicional. No activa CLI, publica, hace push/deploy ni reinicia el servidor. Sigue hidratación de botín actual con reloj estable, piloto restart/reconexión/WAN y afinidad permanente por personaje/tipo. P4/P6, epoch/offline, políticas, leases y finalizador permanecen abiertos.
