# GM03a — borrador remoto privado

Fecha: 2026-10-10. Corte autorizado por el autor al continuar GM02. Este brief fija el alcance antes de implementar. GM03 se divide en **a: continuidad remota** y **b: publicación/activación/rollback**; completar a no declara b implementado.

El resultado jugable es construir desde el editor existente, guardar online y continuar desde otro navegador con la misma cuenta GM. Habrá un borrador remoto por cuenta y mundo. El autoguardado local, recuperación, exportación, selección y prueba caminando siguen disponibles. El guardado online será explícito, con confirmación del servidor; abrir el editor nunca reemplaza silenciosamente un diseño local.

## Contrato y experiencia

- `GET /api/gm/draft` consulta el borrador de la identidad autenticada. `PUT` recibe únicamente `operationId`, `expectedRevision` y documento v2. La cuenta, mundo, semilla y generador se resuelven en el servidor. Cada petición verifica de nuevo el bearer y la lista GM.
- Una revisión remota monotónica aplica CAS. Dos navegadores no pueden sobrescribirse silenciosamente. Guardar muestra la revisión destino y la sustitución del diseño remoto; cargar muestra la sustitución del diseño local y conserva deshacer. Un conflicto conserva el documento local, exige revisar/cargar la nueva versión y permite exportar.
- Un UUID identifica cada guardado. Documento, revisión y recibo se confirman en una sola transacción. Un reintento de la misma operación devuelve el recibo original; otro contenido con el mismo UUID se rechaza. Si se pierde la respuesta, conservar el intento exacto localmente antes del envío y reconciliarlo antes de permitir otro guardado.
- Estados ES/EN: local, consultando, disponible, guardando, confirmado en servidor, cambios locales posteriores, conflicto y respuesta pendiente. La UI no llama durable a almacenamiento en memoria ni a una escritura sin ACK.
- Desconexión, cierre o revocación no deben aplicar respuestas a otra sesión/cuenta. Una petición ya enviada puede haber sido confirmada: la identidad original y su recibo permanecen ligados al intento.

## Persistencia y validación

SQL020 añade solo tablas/RPC de contenido GM, separadas de perfiles, recursos, recibos económicos y `mn_worlds`. Head mutable por cuenta/mundo y recibos inmutables conservan snapshots recuperables. RLS y privilegios solo de servicio; ningún acceso directo de `anon`/`authenticated`. El proveedor Memory se usa únicamente en pruebas y se identifica como no durable.

El backend comparte el validador puro de documentos, acota bytes/cantidad, exige la base actual y comprueba IDs de decoración y catálogo disponible. IDs de base conservan la huella GM02 sin modificar RNG ni índices heredados. Fuentes/paths/URLs arbitrarias no se aceptan. La readiness de SQL se comprueba separadamente; una migración ausente deja el editor local operativo y no rompe el juego.

El alcance no modifica el mapa activo, simulación, admisión de personajes, protocolo ni flags de economía/Tala. GM03b deberá definir el único puntero de contenido bajo M5, validar posiciones/posesiones persistentes y compartir la exclusión del actualizador antes de ofrecer activación.

## Reutilización

Se reutilizan editor GM02, catálogo/derivados GM00 y export JSON; no se añade arte. El candidato Unreal/FAB `SM_StoragePart_03` ya está integrado como `prop:storage-crate` (204 triángulos; [reutilización](../research/unreal-assets/D06-REUSE.md), [entrega](../delivery/a02-crate.md)). No aporta autoridad de contenedor y no requiere reexportación. No se modifican originales ni texturas 2K/4K.

## Aceptación

1. Memory y SQL real embebido: creación, CAS concurrente, replay exacto, UUID reutilizado, rechazo de base/assets, permisos y recibos inmutables; caída/respuesta perdida antes/después de commit y reapertura de DB.
2. HTTP: GM permitido, invitado/otra cuenta denegados, dueño derivado, cuerpo/método/bytes/rate acotados, provider errors saneados, SQL ausente deja juego sano.
3. Navegador: subir diseño local, abrir/cargar en contexto independiente, transformar y guardar, conflicto entre contextos sin pérdida, desconexión/reintento exacto, undo al cargar, ES/EN y logout durante petición. Retener aceptación GM02.
4. Aplicar SQL020 revisado mediante el mecanismo autenticado existente; verificar ACL/readiness y canario aislado. Publicar código por rama existente y comprobar imagen/revisión/salud/entrada real y guardado remoto real. Si el acceso SQL requiere intervención externa, registrar exactamente lo pendiente, sin afirmar almacenamiento live.

La continuidad se documenta con dueño cuenta GM, scope cuenta/mundo, confirmación SQL, adopción explícita desde IndexedDB y recuperación local/recibo remoto/export. No se migra ni borra el borrador local del autor durante QA.
