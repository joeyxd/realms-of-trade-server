# AREA15 — commit conjunto de gameplay, mundo y reloj

2026-10-10. Implementación local sobre `cafff18` (alpha.26/protocolo 38), sin cambio de protocolo ni
de comportamiento público. [Contrato](../briefs/m5-ground-transactions.md).

SQL018 y `GroundTransactionSession` permiten confirmar una familia M5, mundo y reloj juntos,
recuperar el resultado exacto si se pierde la respuesta y aplicar únicamente mediante drain síncrono.
SQL017 queda reservado al presupuesto de agentes ya publicado por AREA17. Los guards actuales del
host se conservan; este corte no monta perlas/muerte/botín en la economía activa.

## Validación

**239/239 casos en 30 archivos**, cero fallos u omisiones, con los 30 casos del corte incluidos.
La evidencia y comandos se registran en [acceptance.json](m5-ground-transactions/acceptance.json) y
[salida TAP](m5-ground-transactions/acceptance.tap). Los hashes comprueban que las fuentes no cambiaron
durante la ejecución integrada. La base probada incluye AREA17/SQL017, Tala/SQL016, GM02 y refugio naval.
Las pruebas SQL usan las migraciones reales y el adaptador Supabase contra PGlite. Cubren CAS,
rollback posterior al efecto, permisos, namespaces, replay, muerte y recogida de botín, conservación
de recursos/comunidad y reaplicación. Las pruebas de sesión cubren pausa lógica, DTO capturado,
respuestas perdidas, reconciliación, cancelación y aplicación una sola vez.
La revisión independiente encontró la omisión de comunidad en candidatos económicos ajenos a aportes;
el guard SQL018 y su prueba bloquean tanto borrado como modificación. También se prueba que un UUID
de checkpoint impida crear un recibo de comercio de agentes SQL017.

Dos pruebas terminan con SIGKILL un proceso que usa PGlite en disco, antes y después del commit.
Otro proceso abre la misma base sin reaplicar migraciones: antes del commit recupera todo el estado
anterior; después recupera perfil, perla/ubicación, mundo, reloj y recibos juntos. Reintentar confirma
una sola vez o reproduce el recibo, conservando 590 ticks pendientes de reaparición.

Son pruebas locales de proceso y almacenamiento. No prueban pérdida eléctrica/disco, concurrencia
entre backends PostgreSQL reales ni caída del GameHost/VPS con esta composición.

## Publicación y siguiente cierre

Código aceptado `5bcf866`, publicado con la integración `dfbf9e7`. El 2026-10-10 a las 20:12 UTC se
verificó activa su descendiente **`e648d1be69d9320d88ac1e980ae4d699a4675b79`**, alpha.27/protocolo 39,
que también incorpora el farol AREA07. Los cinco archivos M5 del corte son idénticos al publicado.
Imagen `sha256:d6d66c961e4dc60895bac5aa14a0df820334501206a72d57c4e82f77d228f1a2`, una autoridad sana,
timer activo, cero errores y **107/107 comprobaciones offline** en esa misma imagen. Los módulos nuevos
importan correctamente en Node 22. [Revisión/imagen/API](m5-ground-transactions/deployment.json) y
[validación de imagen](m5-ground-transactions/vps-validation.json).

El [smoke público](m5-ground-transactions/public-smoke.json) pasó **6/6**: health, M5 de economía/recursos,
protocolo publicado y entrada normal WSS con snapshot/perfil. [Sonda reproducible](m5-ground-transactions/public-smoke.mjs).
Es entrada de invitado sin acciones económicas; no acredita gameplay durable nuevo. La observación
registró Tala habilitada por el otro frente; este corte no cambió sus flags ni aplicó su SQL.

Este corte no aplica ni activa SQL018 en Supabase. Publicar sus APIs dormidas no activa
la feature. Los coordinadores de perlas/muerte/botín siguen `null` en el status del runtime aceptado.
Perlas/muerte/botín permanecen pendientes de composición en el host: un dueño de tick, diario del sobre,
adopción explícita legacy y aceptación en servidor real. Inventario/supervivencia conserva su plan propio.
