# L04b — administración local de memoria

El dueño puede consultar el archivo completo, exportar los bytes reales de personalidad, objetivos y memoria, y borrar recuerdos con las interpretaciones que los referencian. El borrado requiere una vista previa concreta y su ID; el commit vuelve a validar revisión, scope y hashes de los tres archivos. Se implementa sobre archivos locales del dueño, fuera de la simulación y sin llamadas a proveedores.

El nuevo [CLI de administración](../../tools/agent/manage-memory.mjs) funciona sin conectarse al juego. [Contrato y ejemplos](../agents/memory-admin.md), [brief](../briefs/l04b-agent-memory-admin.md) y [manifiesto de verificación](l04b-agent-memory-admin-verification.json).

## Resultado y límites

- Consulta paginada y búsqueda textual sobre todo el journal validado; muestra fuente, certeza, fechas, revisión y pendientes. «current» significa elegible por fecha, siempre como evidencia histórica que debe revalidarse.
- Exportación versionada de los tres archivos completos en base64, con nombres fijos, tamaño y SHA-256. Conserva BOM y finales de línea y excluye rutas absolutas; no exporta la proyección recortada del prompt.
- Borrado físico del JSONL mediante temporal y rename: elimina todas las revisiones del ID legacy, los resúmenes y las afirmaciones legacy derivadas con referencias reconocibles, incluyendo cadenas. Conserva los bytes de las líneas que permanecen; el archivo vacío tiene cero bytes.
- Selección y retención se rechazan cuando alteran la evidencia pendiente. También se rechaza borrar una resolución si eso resucitaría una acción pendiente. El bloque pendiente completo debe ser idéntico antes y después.
- Retención explícita por caducidad o fecha de creación elegida por el dueño; no hay TTL nuevo, limpieza automática ni expulsión al llegar a capacidad. El límite de 1 MiB rechaza escrituras adicionales.
- Migración explícita de representación a JSONL UTF-8/LF: conserva los campos y referencias aceptados, incluidas las filas v1 y su proyección incierta. No convierte afirmaciones del dueño en recibos del servidor.
- Una respuesta del modelo en vuelo se rechaza si cambiaron los archivos. También se comprueba otra vez la fecha de vencimiento de la memoria seleccionada antes de actuar o publicar una interpretación; una respuesta caducada devuelve `memory_expired`, conservando el uso de inferencia ya consumido.

La revisión del journal es su cantidad de registros y puede disminuir al borrar; el hash completo es parte obligatoria de la identidad de cada vista previa. Cada intento nuevo sustituye la vista previa anterior y un commit conocido la consume. Un resultado de publicación incierto bloquea nuevas mutaciones en ese proceso; nunca se repite automáticamente.

El lock coordina únicamente escritores cooperativos locales. No se promete CAS del sistema operativo, escritura entre hosts, recuperación automática de locks ni durabilidad ante fallo físico. Los hashes locales no son firmas del servidor. Acceder al directorio es la autorización local; este CLI no autentica usuarios remotos ni verifica el vínculo de una cuenta online. Panel del dueño y presupuesto durable corresponden a L05.

No existe un índice persistido adicional: cada contexto nuevo deriva sus candidatos del archivo vigente. El borrado no puede retirar exportaciones previas, mensajes recientes del juego, contextos ya enviados a un proveedor ni todas las copias de diagnóstico en RAM. Esas copias no se reutilizan para recuperar la memoria borrada. Una captura nueva y explícita puede registrar otra vez una observación vigente; no hay tombstones ni captura automática.

## Verificación local

Resultados y comandos reproducibles en los [agentes](l04b-agent-memory-admin/agents-tests.json) y la [regresión](l04b-agent-memory-admin/regression-tests.json), con TAP completo y huellas de sus dependencias. La aceptación incluye archivos temporales reales, exportación byte exacta, cascada, retención, conflictos, guardas finales, competencia con append, migración, reinicio de la API, procesos CLI hijos y respuestas simuladas retenidas durante un borrado o vencimiento. No es una prueba de calidad con modelo real.

Resultado final: **604 pruebas pasadas, cero fallos y tres omisiones**. Agentes: 401 casos, 398 pasados y tres pruebas previas de symlinks omitidas porque Windows negó su creación (`EPERM`). Regresión: 206 casos pasados. Los tres archivos nuevos aportan 26 casos, todos pasados. Ninguna dependencia utilizada cambió durante su ejecución ni entre la prueba y el cierre del manifiesto.

El checkout compartido es `claude/loving-lovelace-ptbif7`, con protocolo de trabajo 32. La base se capturó en `dc29882e501581719f8cb05e92eb7d709b25cb0a`; integraciones paralelas avanzaron HEAD primero a `1a3ef18d4da16331088ff16802f3f4ace9f5df91` y luego a `be1634f5b499d570a46629043d860fd280e50b38`. Los reportes conservan los HEAD de cada ejecución y los hashes de las dependencias probadas; la aceptación coteja esos hashes con el checkout final. Un commit ajeno no sustituye esa comprobación. El corte no cambia simulación ni protocolo; las modificaciones ajenas permanecen intactas. Las 22 líneas de dirección/demostración y D-A3 se comparan contra la [base](l04b-agent-memory-admin/baseline.json). No se sobrescribe la evidencia histórica de L04a.

La primera suite de agentes detectó una carrera en un fixture anterior de conversación: la llegada del eco propio de una respuesta válida cambiaba el contador durante un turno inválido. Se corrigió la prueba para esperar ese eco y comprobar además que no aparece otro request de salida; el runtime de chat no cambió. Los [agentes del primer intento](l04b-agent-memory-admin/attempt1-agents-tests.json) y su [regresión](l04b-agent-memory-admin/attempt1-regression-tests.json) permanecen disponibles.

Las dos suites completas pasaron en el segundo intento. La [segunda ejecución de agentes](l04b-agent-memory-admin/attempt2-agents-tests.json) detectó además cambios en una vista naval ajena que sus pruebas no importan. El control final conserva los módulos de juego, servidor y agentes, y el grafo de dependencias de cada suite, incluidos assets con URL estática. Excluye vistas de renderizado y módulos comunitarios aislados que ninguna prueba usa. Las diferencias se registran por archivo y hash en el manifiesto; un archivo importado nunca se excluye.

La [tercera ejecución](l04b-agent-memory-admin/attempt3-agents-tests.json) encontró una carrera de reloj en el nuevo fixture de compaction retenida: su observación dejó de ser vigente antes de comprobar el borrado. Se inyectó un reloj fijo en ese escenario y se repitió la suite completa; los controles de vigencia del runtime permanecen intactos. La ejecución final pasó todos los casos ejecutables. El registro amplio detectó cambios paralelos en `server/community/supabaseContributionStore.mjs` y `server/migrations/community/001_contributions.sql`; ninguno pertenece a las dependencias de estas suites. Su exclusión se comprobó en el grafo y quedó registrada, sin editar el resultado original.

No hay UI nueva, migración SQL externa, proveedor conectado ni cobro real. Este proceso no realizó commit, publicación ni despliegue. El inventario Unreal/FAB revisado no identificó un componente portable para esta administración textual; se conserva como referencia de solo lectura en el brief.

Siguiente corte: **L05a**, operación de límites de inferencia fijados por el dueño, reservas y reconciliación durable. Proveedor, tokenizer, facturación reales y experiencia humana mantienen su aceptación propia.
