# D09f-2b.39 — recogida, retorno y startup mixto en GameHost

Fecha: 2026-10-09. Base `4cd3e56`. [Contrato](../briefs/m5-pearl-lifecycle-host.md).

Las perlas proyectadas ya pueden circular con sus coordinadores persistentes dentro de un GameHost
montado explícitamente. El host mantiene el mundo y su publicación retenidos mientras storage confirma
recogida o retorno, aplica en el límite síncrono y restaura perlas/botín ordinario juntos antes de admitir.
`npm start` conserva su configuración previa; el montaje no está activado por defecto.

## Cambios

PearlLifecycle deriva selección/plazos de fuente y reloj, usa PearlPickupStaging/PearlReturnStaging y
retiene una operación a la vez. Bolsa llena se notifica sin alterar source; el siguiente receptor elegible
puede recoger. Los dos stagers exponen assertWaiting para detectar deriva mientras la respuesta espera.
La identidad privada del contexto evita que borrar el mapa diagnóstico autorice avance.

GameHost comparte deadlineClock entre los coordinadores existentes, añade mountPearlGround/status y
extiende startup con deathDrops bajo la misma barrera. Sus rutas de tick, comandos, admisión, publicación,
guardado, detach y close reconocen ese dueño. Una perla pendiente se drena exclusivamente antes de otros
applies; preserva la captura global de RNG/allocator/orden/eventos de retorno.

DeathDropLifecycle deja las perlas proyectadas a ese dueño y sigue rechazando identidades incompatibles.
LocalServer conserva el callback de cierre admitido a través del tick: retirarlo o reemplazarlo durante
stepWorld falla antes de publicar. El callback original recibe el fallo y el host permanece cercado.

## Evidencia local

La batería final pasó **512/512 pruebas en 34 archivos**, con 204 entradas estables durante la ejecución.
Sus resultados y huella están registrados en
[evidencia estructurada](d09f-pearl-lifecycle-host-evidence.json). Nuevos casos: 17 de host,
16 de límites adversariales y 2 con SDK/SQL001–013. No sumar ejecuciones focales repetidas a ese total.
La aceptación final usa un árbol Git aislado del índice; node_modules se comparte y sus bytes no se fijan.
Las huellas de las entradas se comparan también con el índice y el commit de entrega.

Los ensayos SQL ejecutan migraciones existentes contra PGlite mediante el SDK Supabase:

- Muerte completa con pérdida de XP, perlas y botín; checkpoint explícito del reloj, cierre y reconstrucción
  en otro GameHost al tick local cero; hidratación paginada de ambas familias sin eventos históricos.
  Recogida persistente de perla y objeto ordinario, luego otro GameHost omite fuentes terminales y devuelve
  una sola perla en la cuenta; deaths/PK se conservan.
- Retorno confirmado en storage con respuesta retenida; cerrar antes de aplicar conserva el source/RNG
  local y reporta flush. Otro GameHost restaura exclusivamente el destino del recibo con plazo proyectado;
  replay no aumenta generación ni reelige playa.

Son nuevos GameHosts dentro del mismo proceso Node y de la misma instancia PGlite. No se cerró/reabrió
la base, ni se mató el proceso, ni se verificó Supabase/PostgREST o servidor público. El checkpoint lo
aporta explícitamente el fixture; no acredita política de reloj offline ni atomicidad reloj/gameplay.

Incidencias preparatorias: una limpieza de test consultaba active() después de liberar una reserva;
se corrigió el fixture. Las dos pruebas que sustituyen afterTick reprodujeron el bypass antes del fix y
pasaron después. Esas ejecuciones fallidas no son la aceptación final. La revisión independiente Luna
detectó el bypass; el principal lo reprodujo, corrigió e integró.

## Reutilización y alcance restante

BP_LootBox (53.960 B) y SM_StoragePart_03 (24.248 B) comprobados en sus rutas exactas en el brief:
referencias de interacción/visual, sin lógica portable para este contrato. Fuentes intactas; cero assets,
UI o texturas nuevas. La comprobación visual no aplica a este cambio de servidor.

Sin migración, modificación de .env, cambio de perfil/protocolo, push o despliegue. Trabajo concurrente
ajeno conservado. No es persistencia permanente completa: faltan creación durable desde loot/cofres,
dominio/backfill legacy, autoridad/arranque y política de reloj/crash, leases/finalizador, afinidad y
aceptación del servidor real. Sigue composición de la autoridad de reloj/arranque antes de activar el
flujo durable completo; P4/P6 continúan parciales.
