# AREA15: perlas nuevas de élites y cofres

Continúa [muerte y botín](m5-ground-death-lifecycle.md). El montaje explícito
`mountGroundPearls(); mountGroundDeaths(); mountGroundPearlMints();` añade únicamente
las perlas públicas recién sorteadas por `lootOnKill` y `openChest`. No activa el VPS,
no cambia reglas de probabilidad ni protocolo y no necesita migración: SQL004/018/019
ya admiten `ground`, `from=null`, `to=null`, `expectedVersion=0`, `profiles=[]`.

Un helper específico `dropRolledPearl` clasifica estas dos procedencias antes de
insertar suelo, ledger o evento. Sin montaje conserva el helper inmediato actual.
El servidor asigna UUID de operación y UID `mint:<UUID>` una sola vez al capturar;
no confía en el contador local de `makePearl` para identidad durable. No intercepta
devoluciones, derrames de muerte, regalos ni liberaciones de perlas existentes.

La captura síncrona ocurre dentro del tick real y retiene su publicación. La única
frontera `afterTick` completa muerte y mint; el único `beforeTick` común termina
primero las muertes, después serializa todos los mints y finalmente circulación.
Cada mint reserva su UID antes del diario/IO y conserva geometría/deadlines calculados
desde el tick de origen. Mientras espera no hay siguiente tick, comandos, guardados
de perfil, admisión ni publicación del tick retenido. No se libera la publicación
hasta terminar todas las operaciones del tick.

Tras recibo confirmado, un adaptador síncrono y reversible instala suelo, ledger,
índice de filas actuales y evento juntos. Revalida tick, identidad/contenedores,
allocator, perfiles, eventos y terreno; rechaza replay inesperado y deriva. Cierre
o fallo cercan la autoridad y no aplican efectos tardíos. Recuperar SQL019 precede
a hidratar filas actuales, sin publicar eventos históricos ni repetir tiradas.
Los plazos siguen el epoch común y la pausa offline acordada.

Límite deliberado: el sorteo/RNG y el origen enemigo/cofre aún no forman un sobre
durable completo. Antes de preparar intención, una caída puede perder esa perla;
después de preparar intención debe recuperarse exactamente una. No se acepta aquí
persistencia de oro/equipo/quests/cofres, XP/misiones del kill, cursor RNG entre
procesos, comandos give/swallow/leave, adopción ni canario público.

Pruebas: rutas reales elite/cofre y default, cero/sucesivos mints, composición con
muerte en el mismo tick, SQL preparado sin efecto, rollback/fallo/cierre, filas
actuales y pickup/return después de reabrir; SIGKILL local tras preparar diario y
tras commit antes de aplicar. Regresión de muerte/suelo, Carga/supervivencia,
recursos/taller, agua/costa y GM033. Evidencia local separada de despliegue apagado.

Reutilización: inspección física de `BP_AILootSpawner` (221298 B) y
`BP_JigServerSave` (580554 B) de ActionRPG; inventario
[Unreal](../research/unreal-assets/README.md). Son paquetes Blueprint, no contratos
Node/Postgres portables. Se reutilizan los helpers y recibos JS existentes; fuentes
Unreal intactas, sin nuevos assets ni cambios visuales.
