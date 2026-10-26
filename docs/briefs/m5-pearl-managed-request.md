# D09f-2b.18 — solicitud de perlas con versión consultada por el servidor

Continúa [el arranque del host](m5-pearl-host-startup.md). API interna de PearlStaging;
no conecta comandos públicos ni activa circulación parcial.

`request({action,uid,source,target?,replaceUid?})` admite give, swallow y replace. Solo recibe
selectores de sesión/entidad y UID; rechaza generaciones, holder, kind, scope, UUID, perfiles y
campos inesperados. El reemplazo exige confirmación del UID tragado actual. Las tres entradas
trusted anteriores que reciben expectedVersion conservan su contrato.

La elegibilidad usa los helpers existentes sobre copias y la captura ECS se hace antes de IO.
La solicitud reserva sincrónicamente todas las cuentas y UIDs afectados, luego consulta loadUnique
del store de esas mismas sesiones. Solo acepta registros gestionados, canónicos, del tipo y dueño
del plan, con una generación incrementable. No adopta UIDs ausentes ni fabrica generaciones.

Tras asentar todas las lecturas, vuelve a comprobar lifecycle, perfil de perlas y ledger local antes
de cualquier save/diario/commit. Refresca la captura validada del progreso antes del save de baseline,
incluyendo progreso ECS ganado durante esa lectura. La misma reserva continúa hasta apply o fence; no se libera para
reabrir staging entre la lectura y el commit. La cola vuelve a leer ledger/ubicación y SQL verifica CAS.
Un cambio externo no provoca un segundo plan, UUID o reintento con una generación más reciente.

La respuesta síncrona identifica una solicitud pendiente; no confirma propiedad ni publica éxito.
IO fallido, registro incompatible o lifecycle invalidado conserva la reserva y llega al drain como
fallo cercado, igual que staging existente. Settle espera todas las lecturas iniciadas incluso cuando
una falla. Apply/ECS/drop/eventos permanecen exclusivamente en drain síncrono de la frontera de tick.

Unreal/FAB: BP_JigServerSave (580.554 B) y BP_InventoryComponent (24.878.603 B) comprobados en
ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/InventorySystem. Referencia Blueprint,
sin lógica Node/CAS portable; reutilizar store, gate, helpers, cola, diario y efectos existentes.
Fuentes intactas y sin assets nuevos. [Portabilidad](../research/unreal-assets/PORTABILITY.md).

Aceptación: memory y SDK/SQL001–008 local, generaciones no iniciales, ambos UIDs de reemplazo,
lecturas lentas y reserva continua, denegación sin IO, respuesta malformed/ausente/tipo/dueño/límite,
mutación o detach durante lectura, CAS externo entre ambas lecturas, respuesta de commit perdida,
y apply real del host con adapters propios. Regresión aislada sobre Git fijo, sin cambios de chat/arte.

Faltan dispatch público y todas las rutas autónomas, políticas definitivas de scope/adopción/reloj,
finalizador durable, epoch de inputs, muerte completa y afinidad permanente por personaje/tipo.
Un host por scope hasta leases. Sin nueva SQL, env, protocolo o activación del entrypoint.
