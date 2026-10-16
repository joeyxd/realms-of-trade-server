# Administración local de memoria L04b

## Autoridad y archivos

`createMemoryAdministration({ directory, scope, now })` fija un directorio absoluto y el scope exacto `ownerId/characterId/worldId` durante toda la instancia. El proceso local lee `personality.md`, `objectives.json` y `memory.jsonl` para revisar los tres hashes antes de confirmar cambios; solo reescribe `memory.jsonl`. El writer usa archivos temporales y `.memory.lock` dentro de ese directorio. La autoridad equivale al acceso local del dueño a esos archivos: no es autenticación para otros usuarios ni una API remota.

La administración es una API separada de `AgentMind`; ninguna respuesta del modelo ni herramienta de gameplay puede elegir o confirmar un borrado. El CLI no hace llamadas a proveedores. La exportación contiene exactamente los tres archivos reales en Base64, sus tamaños y SHA-256, sin rutas. Conserva BOM y finales de línea. Quien guarde una exportación conserva una copia fuera del alcance de un borrado posterior.

```js
import { createMemoryAdministration } from './memory-admin.mjs';

const owner = createMemoryAdministration({
  directory: 'C:/datos/brisa',
  scope: { ownerId: 'owner-lab', characterId: 'brisa-lab', worldId: 'world-lab' },
});
const page = await owner.inspect({ query: 'muelle', limit: 50, offset: 0 });
const bundle = await owner.exportFiles();
const preview = await owner.previewRemoval({ ids: ['episode:...'] });
const result = await owner.commitRemoval({ previewId: preview.preview.id });
```

`inspect` pagina los registros del dueño con texto, etiquetas, procedencia, fuentes y vigencia `current`, `expired` o `future`; incluye las operaciones pendientes interpretadas por el parser. Su filtro normaliza Unicode y busca texto o etiquetas. Es una vista del archivo, separada de la selección de recuerdos que alimenta una acción.

## Vista previa, borrado y retención

`previewRemoval({ ids })` acepta de 1 a 4096 IDs únicos ya presentes. Un ID elimina todas sus revisiones legacy y filas duplicadas para que una revisión vieja no reaparezca. La vista previa expone `requestedIds`, `removeIds`, `derivedIds`, conteos, revisión anterior/siguiente, scope, tiempo y política de compatibilidad. También expande el borrado a resúmenes v2 y afirmaciones legacy cuyas fuentes se refieran a un registro eliminado por ID o por `id@revision`; repite el cierre para retirar cadenas legacy derivadas.

Antes de aceptar una propuesta, el planner valida de nuevo el journal completo y compara la lista canónica completa de operaciones pendientes antes y después. Si cambia cualquier campo de esa evidencia, el borrado falla con `memory_pending_evidence`. Esto impide que quitar una resolución terminal vuelva a abrir una acción incierta. Los pendientes no se reconcilian automáticamente ni se descartan como parte de un borrado.

La retención nunca corre por calendario. `previewRemoval({ retention: { expired, beforeMs } })` es una operación manual: `expired: true` selecciona registros con `validUntilMs <= nowMs` al crear la vista previa; `beforeMs` selecciona `createdAtMs < beforeMs`. Si ambas condiciones están presentes se usa su unión, y cualquier revisión del mismo ID entra en la misma familia. `beforeMs` debe ser `null` o un entero seguro que no supere el `nowMs` de la vista previa. Puede aprobarse una selección vacía, que es un no-op explícito.

El commit consume una sola vista previa en memoria y requiere su `previewId`. Store y administración vuelven a verificar la revisión, el plan derivado, las operaciones pendientes y los hashes de los tres archivos inmediatamente antes del rename. Los hashes detectan cambios del dueño entre vista previa y commit; la revisión del journal es el conteo de filas y puede disminuir después de borrar. Por eso el commit también coteja el SHA-256 final y los IDs/conteos del recibo. Un conflicto exige crear otra vista previa.

## Migración y límites de borrado

`previewMigration()`/`commitMigration({ previewId })` ofrecen una migración explícita de representación. Serializa las entradas aceptadas con `JSON.stringify` y una línea LF final; quita BOM, espacios de línea y finales CRLF sin cambiar las entradas del journal, sus pendientes ni la proyección legacy `uncertain`. No convierte afirmaciones v1 en evidencia autenticada ni eleva su certeza. La revisión, definida por cantidad de filas, permanece igual durante esta migración; los hashes detectan la conversión de bytes.

`memory.jsonl` tiene un límite de 1 MiB. Las escrituras que superen el límite se rechazan; no activan retención ni borrado silencioso. La limpieza local no puede retirar copias exportadas previamente, texto ya enviado fuera del proceso ni respuestas de proveedor guardadas en otros sitios. El CLI no importa ni reproduce esos datos. Una captura futura solo puede guardarse mediante una acción explícita de memoria del dueño; no hay replay automático.

La mente comprueba los hashes de archivos antes de guardar una respuesta de modelo, así que una respuesta basada en un snapshot anterior no puede volver a escribir memoria tras un cambio de archivo. Además, la selección de memoria conserva su vigencia y `AgentMind` rechaza con `memory_expired` una decisión que llegue después de que el recuerdo seleccionado venza. Esos fences protegen una escritura posterior; no borran copias externas.

El lock `.memory.lock` coordina escritores que respetan el mismo archivo. No ofrece CAS del sistema operativo frente a editores externos, escritura multi-host ni durabilidad completa ante una caída física. Si el resultado de un rename no puede determinarse, la instancia bloquea nuevos commits de memoria en vez de repetir una escritura incierta.

## CLI

Desde la raíz del repo, ejecuta `node tools/agent/manage-memory.mjs --files C:/datos/brisa --owner owner-lab --character brisa-lab --world world-lab`. Es un proceso local de administración, independiente de `tools/agent/run.mjs` y del estado de la mente.

Envía una solicitud JSON por línea y recibe una línea `memory_admin` por solicitud:

```json
{"type":"files"}
{"type":"inspect","query":"muelle","limit":50,"offset":0}
{"type":"export"}
{"type":"preview_delete","ids":["episode:..."]}
{"type":"commit_delete","previewId":"<id-devuelto-por-la-vista-previa>"}
{"type":"preview_retention","retention":{"expired":true,"beforeMs":null}}
{"type":"preview_migrate"}
{"type":"commit_migrate","previewId":"<id-devuelto-por-la-vista-previa>"}
{"type":"exit"}
```

No compartas el `previewId` entre procesos: el estado de confirmación vive en la instancia que produjo la vista previa. La CLI limita cada línea de entrada a 65.536 bytes y rechaza campos no reconocidos.

## Reutilización y continuidad

Revisé el inventario read-only existente de Unreal en [MyProject/FINDINGS](../research/unreal-assets/myproject/FINDINGS.md). No identificó un componente portable que aporte la administración local de archivos JSONL del dueño; los grafos internos y su exportabilidad siguen sin verificar. Este corte permanece en JavaScript y Node, sin abrir ni modificar los proyectos Unreal.

L04b no añade UI, protocolo, proveedor, tokenizer ni decisión D-A3. El siguiente trabajo de continuidad del presupuesto durable es L05a. La implementación y sus límites se describen junto con la memoria base en [memory-runner](memory-runner.md).
