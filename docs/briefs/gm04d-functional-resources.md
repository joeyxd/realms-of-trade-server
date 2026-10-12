# GM04d — palmeras talables y piedras recogibles

Contrato previo a código, 2026-10-11. Continúa GM04c con recursos del juego real.

## Experiencia y alcance

Biblioteca → Recursos ofrece una palmera talable y una piedra recogible, diferenciadas de
las decoraciones. Se colocan, seleccionan, mueven, duplican y eliminan en el borrador con
undo/redo y guardado existente. El inspector explica su función. La publicación sigue
siendo explícita y requiere mundo vacío. El borrador nunca entrega objetos ni progreso.
Los pinceles decorativos y plantillas decorativas no convierten modelos arbitrarios en recursos.

Reutilizamos la palmera alta optimizada y la piedra costera ya integradas: el inventario
Unreal/FAB de GM04c no aporta un candidato que mejore este adaptador sin exportar y aceptar
otro asset. No se modifica C:\Unreal ni se añaden descargas, arte, texturas o dependencias.
La representación jugable conserva materiales, instancias y caída/tocón del renderer actual.

## Documento y autoridad

Los recursos usan objetos normales del documento v2–v4, con dos referencias funcionales
reservadas: `prop:gm-resource-palm-v1` y `prop:gm-resource-stone-v1`. Su significado es
explícito; una referencia `model:palm-*` sigue siendo decoración. El ID de objeto debe ser
`gm-<UUID>` y su ID de recurso es `gm_` seguido de los 32 dígitos hexadecimales del UUID.
Mover conserva ID; duplicar crea otro. No se permite cambiar el tipo de un ID ya admitido.

Hasta 128 recursos activos añadidos por revisión; la generación base y su RNG no cambian.
Se proyecta Y al suelo y se exige tierra seca, pendiente moderada, distancia entre recursos,
pasos y servicios protegidos. Palmera: giro Y y escala 0,75–1,25; sin inclinación, collider
manual ni colisión nueva. Piedra: escala 1, giro 0. El radio normal de interacción permanece.
La validación compartida se ejecuta al editar/preparar y en el servidor, no solo en UI.
Se registra/verifica el hash de la distribución compilada, aparte del hash de la base.

## Persistencia y fallos

M5 conserva la única autoridad de inventario, ciclos, golpes, cooldowns y práctica. Las
palmeras usan el hacha y el ledger cooperativo actual; las piedras se recogen con el comando
normal. No se crean perfiles, recompensas nuevas ni otra autoridad de guardado.

Antes de cambiar el puntero de contenido, bajo la exclusión del mundo vacío, un RPC CAS
admite únicamente IDs GM nuevos con estado inicial. Mantiene sin cambios todos los nodos,
ledgers, deadlines, cooldowns, relojes y campos ajenos. El estado durable conserva también
IDs retirados (máximo 1024 filas, incluida la base) para que rollback/republicación no reinicien
el agotamiento. El límite vitalicio es visible como rechazo, nunca una poda automática.
Un fallo tras admisión y antes del puntero deja filas inactivas inocuas; el reintento conserva
su estado. ACK SQL ambiguo cerca de una mutación bloquea la autoridad hasta reinicio.
Un fallo después del puntero se reconcilia con el registro existente o bloquea admisión.

Al arrancar, se instala la distribución activa antes de restaurar recursos. La restauración
exige todos los nodos activos y todas las identidades base; solo tolera filas GM inactivas
válidas. El reloj de respawn sigue detenido offline. Al cambiar revisión se reconstruyen
las posiciones por ID y se restaura el estado confirmado, sin `rev=1` sobre nodos existentes.
El piloto alternativo de suelo solo puede activar revisiones con recursos si su autoridad
soporta esta admisión; de lo contrario se rechaza explícitamente, sin escrituras parciales.

SQL036 amplía exclusivamente el validador de filas y añade admisión/readiness de recursos GM.
El guardado ordinario sigue impidiendo editar listas/ledgers. Los documentos y recibos SQL033
no cambian. No se publica una distribución de prueba sobre el mundo del autor sin su acción.

## Aceptación

- Colocar ambos tipos, mover/duplicar/eliminar, undo/redo, exportar y reabrir borrador.
- El cliente, compilador y servidor producen los mismos IDs, posiciones y hash.
- Hacha/rango/revisión, tres golpes y botín/práctica normales; piedra recogible una sola vez.
- Agotamiento y ledger sobreviven mover, retirar, rollback, reintento y reinicio.
- SQL CAS, permisos, límite, tipo inmutable, append-only y guardado ordinario conservados.
- Recuperación en los dos límites SQL/puntero y bloqueo seguro ante ACK incierto.
- Capturas ES/EN escritorio/móvil revisadas; presupuesto de instancias/texturas comunicado.
- Integración y despliegue se documentan separados; migración/readiness comprobados antes
  de aceptar activación durable. No se confunde prueba local con estado publicado.
