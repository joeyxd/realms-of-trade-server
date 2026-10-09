# L04b — administración local del archivo del dueño

## Propósito

Dar al dueño una forma explícita de consultar, exportar, borrar, aplicar retención manual y migrar la representación de la memoria local de su personaje. El archivo L04a conserva su historial hasta que una persona con acceso local a los archivos inicia y confirma un cambio. El modelo y `AgentMind` no reciben autoridad de borrado.

## Decisiones de diseño

- Fijar en `createMemoryAdministration` un directorio absoluto y el scope de dueño/personaje/mundo. La herramienta local lee y coteja `personality.md`, `objectives.json` y `memory.jsonl`; solamente publica reemplazos de `memory.jsonl`.
- Presentar los tres archivos en una exportación versionada, exacta y sin rutas, codificados en Base64 con tamaño y SHA-256. El límite es el proceso local y sus permisos del sistema de archivos, no una sesión autenticada de servidor.
- Exigir vista previa y `previewId` de un solo uso para confirmar borrado o migración. Los cambios entre vista previa y commit a cualquiera de los tres archivos provocan conflicto. La revisión del journal es su número de filas y puede disminuir al borrar; la comparación de hashes complementa ese conteo.
- Seleccionar borrado por IDs existentes o por un selector de retención manual, nunca ambos a la vez. Un ID borra todas sus filas legacy/revisiones duplicadas. Los resúmenes v2 y afirmaciones legacy derivadas se retiran recursivamente cuando las fuentes coinciden por ID o por `id@revision`.
- Comparar toda la evidencia de operaciones pendientes en su forma canónica antes y después del borrado. Rechazar cualquier operación que la altere, incluida la eliminación de feedback terminal que causaría que una acción apareciera otra vez como pendiente.
- No ejecutar caducidad automática. `expired: true` selecciona `validUntilMs <= nowMs` de la vista previa; `beforeMs` selecciona `createdAtMs < beforeMs`. Se usa la unión de criterios; se rechaza una fecha límite futura. Un criterio manual sin coincidencias produce una propuesta vacía sin modificar el journal.
- Mantener el límite de memoria en 1 MiB y rechazar escrituras mayores sin limpieza implícita.
- Permitir una migración opt-in de bytes a JSONL canónico (`JSON.stringify` por registro y LF final). Quita BOM y whitespace de representación, pero mantiene entradas, incertidumbre v1 y pendientes. No semantiza ni autentica las afirmaciones legacy.
- Usar lock cooperativo, archivos temporales únicos, validación, hashes y rename para proteger la escritura local. No prometer CAS del sistema operativo contra editores externos, coordinación multi-host ni durabilidad integral ante caída física.
- Tratar exportaciones ya guardadas y texto previo enviado a proveedores como copias fuera del ámbito del borrado. No hay reimportación ni replay automático. Una captura explícita futura sí puede crear registros nuevos.

## Interfaces

La lógica pura vive en [`memory-management.mjs`](../../tools/agent/memory-management.mjs): `proposeMemoryRemoval` valida el journal, arma el cierre de dependencias y conserva evidencia pendiente; `inspectMemoryArchive` entrega texto y metadatos paginados con frescura y procedencia.

La capa de dueño vive en [`memory-admin.mjs`](../../tools/agent/memory-admin.mjs). `createMemoryAdministration({ directory, scope, now })` expone `files()`, `inspect()`, `exportFiles()`, `previewRemoval()`, `commitRemoval()`, `previewMigration()` y `commitMigration()`. No depende de `AgentMind` ni conecta proveedores.

El proceso `tools/agent/manage-memory.mjs` acepta JSONL por stdin con `files`, `inspect`, `export`, `preview_delete`, `preview_retention`, `commit_delete`, `preview_migrate`, `commit_migrate` y `exit`. Cada commit consume el `previewId` producido por la misma instancia CLI.

## Cercas de concurrencia de la mente

Las cercas existentes de hashes de respuesta evitan que un resultado del modelo basado en un snapshot anterior vuelva a guardar memoria luego de una modificación de archivos. La mente también fija la vigencia de los recuerdos seleccionados y rechaza una decisión tardía con `memory_expired` antes de actuar. Estas reglas protegen el flujo futuro, pero no retiran una exportación ni una copia externa ya creada.

## Alcance excluido y continuidad

Este corte no crea UI ni endpoint de protocolo, no cambia proveedor/tokenizer, no selecciona D-A3 y no introduce política de gasto. La revisión de [MyProject/FINDINGS](../research/unreal-assets/myproject/FINDINGS.md) es read-only; no identificó un componente de Unreal portable que resuelva el acceso a los archivos JSONL de Node. Los proyectos fuente permanecen intactos.

L05a conserva como siguiente trabajo el presupuesto durable. El [contrato operativo de memoria](../agents/memory-admin.md) explica el uso, autoridad, retención, migración y límites locales.
