# GM04b — plantillas privadas de decoración

Fecha: 2026-10-10, hora de México. Continúa [GM04a](gm04a-multiselection.md).
Este contrato se escribe antes del código; la aceptación se registra en la entrega.

Seleccionar de 1 a 120 decoraciones visibles, dar nombre y guardar una plantilla. La pestaña
Plantillas permite buscar, renombrar, eliminar, exportar e importar la biblioteca y colocar una
copia con fantasma completo. El clic añade todas sus piezas como instancias ordinarias con IDs
nuevos y un único deshacer/rehacer. Editar o borrar una plantilla no modifica copias ya colocadas.

El origen de la plantilla usa el centro XZ de sus piezas y la menor Y de sus orígenes. Al colocar,
ese origen se apoya en el terreno y conserva offsets, inclinaciones, escalas y círculos compatibles.
No proyectar cada pieza por separado ni deformar el conjunto. Después de colocar se puede usar la
multiedición existente para girar/escalar/apoyar. El fantasma inválido muestra el motivo y no permite
un commit parcial. Escape, cambiar de modelo, caminar o cerrar cancelan la colocación y las cargas tardías.

El fantasma comprueba límites de transformación y capacidad del documento. La preparación de
publicación conserva la validación de rutas, recursos y zonas protegidas; GM04b no anticipa todos
esos rechazos ni dibuja las huellas de todos los colliders del conjunto.

Biblioteca local privada por el mismo scope servidor–cuenta–mundo que el borrador actual. IndexedDB
separado, CAS por revisión, máximo 32 plantillas, 120 piezas por plantilla y exportación de 2 MiB.
Conflicto/cuota/fallo conserva el intento en memoria para exportar o reintentar; recargar la biblioteca
requiere descartar explícitamente el intento. No sobrescribir cambios de otra pestaña. Un fallo de
biblioteca no impide abrir o seguir editando el borrador. Importación aditiva validada y atómica,
con IDs de plantilla nuevos; nunca reemplaza silenciosamente la biblioteca.

Formato estricto separado del documento de mapa. Las plantillas guardan base seed/revision y
transformaciones relativas; son reutilizables en esa misma base. Esto conserva exactamente la
apariencia de copias `base:*` de rocas/flores/guijarros: siguen siendo referencias a la base compatible,
no modelos portables entre semillas. Rechazar una biblioteca de otra base sin tocar la actual.
Validar disponibilidad de todos los assets antes de mostrar/colocar; una pieza ausente bloquea el
conjunto y ofrece reintentar, sin perder el registro guardado. Los IDs base y colliders originales
permanecen intactos. Documento v2, guardado remoto, preparación/hash/activación/rollback y autoridad
M5 no cambian. La exportación de mapa contiene únicamente las instancias expandidas.

Reutilización revisada: [Unreal/FAB](../research/unreal-assets/PORTABILITY.md), roca costera S02
[integrada](../delivery/coast-rocks-v1.md) (64 triángulos, 7.964 B), modelos de
[playa S04](../delivery/beach-details-v1.md) y [caja](../delivery/a02-crate.md) ya optimizada.
No hace falta arte nuevo: usar caja/restos de playa y decoración base para la evidencia. Ninguna
descarga/textura 2K/4K nueva; originales Unreal intactos. Sin nuevos colliders compuestos,
superficies transitables, recursos funcionales, materiales, dispersión ni edición de terreno.

Aceptación: inmutabilidad, transformaciones relativas YXZ/alturas/círculos, IDs independientes,
límites globales y rechazo atómico; validación/importación acotada, CAS concurrente, base/scope,
fallos de storage y recuperación del intento. Navegador ES/EN: crear, buscar, renombrar, colocar
fantasma mixto, cancelar/carga tardía, dos copias independientes, undo/redo, caminar, reapertura,
export/import, asset ausente, lote inválido y conflicto de biblioteca. Inspeccionar capturas de
escritorio y viewport estrecho. Publicación requiere imagen/revisión/salud y entrada pública real,
incluida sesión GM sin mutar el mapa compartido. No acredita FPS en teléfono físico.
