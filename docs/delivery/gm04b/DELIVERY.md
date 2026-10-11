# GM04b ? plantillas privadas de decoraci?n

Fecha: 2026-10-10, hora de M?xico. **Implementado y aceptado localmente en alpha.41/protocolo 47; publicaci?n pendiente de verificar.** Contin?a [GM04a](../gm04a/DELIVERY.md) y el [contrato previo a c?digo](../../briefs/gm04b-templates.md).

En **Plantillas**, guarda de 1 a 120 decoraciones visibles con un nombre. La biblioteca permite buscar, renombrar, eliminar con confirmaci?n y exportar/importar un archivo. Elegir una plantilla carga todos sus modelos y muestra el fantasma completo; cada clic a?ade una copia con IDs independientes y un ?nico deshacer/rehacer. Escape termina la colocaci?n continua. Renombrar o borrar la plantilla conserva las copias colocadas. Despu?s puedes girarlas/escalarlas con la multiedici?n existente.

El origen usa el centro XZ y la menor altura de las piezas; conserva offsets, giros YXZ, escalas y c?rculos. No adapta cada pieza por separado a una pendiente. El lote se rechaza completo si excede l?mites/capacidad o falta un modelo. La preparaci?n Online conserva las comprobaciones de zonas protegidas, recursos y rutas; el fantasma no anticipa todos esos rechazos ni muestra todas las huellas de colisi?n.

La biblioteca es privada de este navegador, cuenta, servidor y mundo; IndexedDB separado con CAS. Admite 32 plantillas y archivos de 2 MiB. Importar a?ade plantillas con IDs nuevos. Son compatibles con la misma semilla/revisi?n base: las referencias base:* conservan su aspecto exacto y no son portables entre semillas. Una biblioteca incompatible queda solo para exportar/reintentar. Un error no bloquea el borrador del mapa. Un fallo/conflicto de guardado conserva el intento en memoria para exportar o reintentar; recargar exige descartarlo expl?citamente. Esa copia pendiente no sobrevive al cierre del navegador. Los fallos transitorios de apertura permiten reintentar y las conexiones tard?as bloqueadas se cierran.

Documento de mapa v2 y protocolo 47 conservados. Las copias se expanden como instancias ordinarias; biblioteca privada y publicaci?n del mapa son operaciones distintas. Guardado remoto, preparaci?n/hash, activaci?n/rollback y autoridad M5 conservan sus contratos. No hay SQL ni cambios de perfil.

Se reutilizan caja/restos de playa optimizados y decoraci?n base. La roca S02 tiene 64 tri?ngulos y ocupa 7.964 B; la caja tiene 204 tri?ngulos y ocupa 51.684 B. Sin arte/texturas nuevas ni cambios en originales Unreal. Fuentes y decisi?n de reutilizaci?n en el brief.

La regresi?n final pas? **199/199 en 35 archivos**, sin solapamiento entre 197 pruebas GM y 2 del checker separado. Incluye selecci?n real del editor hacia captura mixta, transformaciones/alturas/c?rculos, importaci?n acotada, l?mites, CAS, cuota/datos corruptos y recuperaci?n de apertura. Hashes estables antes/despu?s. [Resumen](integration-final.json) ? [GM](integration.json) ? [checker](checker.json). El primer intento amplio, incompleto y con fuentes cambiando, se conserva como no aceptado.

El navegador local pas? **17/17** con autenticaci?n simulada: modelos reales, plantilla mixta de seis piezas, b?squeda/renombrado, dos colocaciones con puntero, IDs/offsets y undo/redo, borrado confirmado, l?mites, asset ausente, caminar/Escape/carga tard?a, descarga/upload, reapertura y conflicto CAS con exportaci?n/descarte expl?cito. No escribe endpoints remotos. [Evidencia](local-browser-evidence.json) ? [intentos y correcciones](LOCAL-ATTEMPTS.md). La recuperaci?n de apertura IndexedDB se endureci? despu?s de este recorrido y pas? la regresi?n final; se verificar? la fuente final en navegador p?blico.

Capturas inspeccionadas: [ES](local-templates-es-closeup-desktop.png), [EN](local-templates-en-closeup-desktop.png), [844?390](local-templates-en-closeup-844x390.png) y [copias colocadas](local-templates-es-two-copies-overview.png). El viewport estrecho verifica lectura y scroll; no acredita editor t?ctil completo ni FPS en tel?fono f?sico.

Sigue la verificaci?n de imagen/revisi?n/salud y entrada p?blica con sesi?n GM real, conservando el mapa publicado. Materiales/dispersi?n y terreno GM05 siguen para otros cortes.
