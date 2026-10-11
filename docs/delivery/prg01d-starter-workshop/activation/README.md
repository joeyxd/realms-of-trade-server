# PRG01d — taller y Tala públicos; incidentes recuperados

SQL023/024/026 están confirmados. Alpha.38/protocolo 46 quedó activa en la revisión
`d9620558a93f6a6ed88614857b03d7d9822a4b1b`, imagen
`sha256:f937c420dbe5555048f10c3087e9a5d237e80389c3aa880b6a54b3841cf6bc8c`.
La [verificación independiente](timing-deployment-independent.json) confirma hashes del runtime
contra Git, salud pública 200, Auth habilitado, una autoridad y temporizador activo. M5 tenía
cero errores, operaciones pendientes y datos sin guardar, con taller/recursos/artesano ready.
Es una captura fechada; se debe consultar salud antes de operar nuevamente.

Los dos incidentes están recuperados. SQL026 corrigió los IDs reales de balsa con `:`.
Alpha.38 alinea el baseline económico antes de una palmera v3 mediante el escritor existente;
no necesita otra migración. La [recuperación de Tala](timing-recovery.ndjson) conservó los hashes
completos de perfil/mundo, versiones y tick. El [QA retenido](timing-retained-qa-cleanup.json)
quedó eliminado después del drenaje. No repetir los scripts históricos de recuperación ni apagar
`MN_STARTER_WORKSHOP` después de adoptar recursos v3. El mundo común suelo/perlas/muerte sigue
sin adoptar ni activar; instalar SQL023 no lo adopta.

## Evidencia pública y de imagen

- [Construcción alpha.37](public-c542b02f-1315-439b-9020-f0a69aacb5a9.json): 33 comprobaciones pasaron
  para entregas parciales, crédito único, primera bodega gratis, segunda por diez tablas, kit/caja,
  denegaciones ocupado/revisión antigua, desguace, mochila, tabla 2:1 y reconexión. El recorrido
  completo falló después al navegar a la palmera. Perfil/Auth QA eliminados; quince recibos conservados.
  Los materiales se sembraron sólo en su perfil desechable desconectado.
- [Tala alpha.38](public-d783c754-992a-4304-9e2a-25d3f4df4d9d.json): **6/6**, WSS público autenticado.
  Calidad/desafío inventados rechazados sin mutar perfil/palmera; tres golpes reales entregaron tres
  troncos y diez de práctica; replay histórico exacto y banco normal convirtió dos troncos en una
  tabla. Se sembró sólo un hacha, sin carga. Perfil/Auth eliminados y cuatro recibos conservados.
  No valida el extremo de seis troncos ni cooperación entre jugadores.
- [Regresión en la imagen activa](timing-image-tests.json): **28/28**, hashes Git coincidentes,
  runner sin red y una sola autoridad antes/después. Fixtures de taller, timing, recursos, fuego
  y compañeros; no SQL/PGlite ni navegación pública.
- [Regresión local final independiente](timing-final.tap): **20/20**, taller, SQL y baseline.
  El [diagnóstico de lectura en Supabase](logging-baseline-diagnostic.json) confirmó el predicado
  del fence. [Informe de causa y reproducción](../../prg01d-timing-baseline.md).
  Los conteos se solapan y no se suman.

La aceptación está dividida entre construcción alpha.37 y Tala alpha.38. Falta el canario combinado,
navegador autenticado actualizado, SIGKILL propio, nueva medición offline, balance y teléfono físico.
La [repetición combinada alpha.38](public-156e1731-9f05-4452-b1ff-3250670c2b87.json) pasó quince
comprobaciones hasta fabricar el kit, pero agotó sus replanteos al caminar a la pasarela de la balsa.
No es un pase completo. Perfil/Auth eliminados y seis recibos conservados; no registró otro fence.
La selección amplia pasó 68/69: el caso legacy de storage en `ground-host-authority-sql` falla también
en la revisión anterior sin este arreglo. [Captura anterior a la recuperación](logging-recovery-checkpoint.json);
ese montaje común permanece desactivado.

## Historia conservada

- [Despliegue alpha.36](deployment.json): 109/109 del actualizador, una autoridad y timer activo.
- [Transición v2→v3](transition.json): 206 nodos, 96 palmeras, ledger, cooldowns, comunidad y semilla
  conservados; calidad inicial cero y tick continuado. No es una nueva medición offline.
- [Entrada invitada](public-entry.json): 14/14 antes del primer fallo.
- [Navegador autenticado ES/EN](browser/browser-1d99d56f-c32c-4ba3-887c-b7cecf42a86d.json): 8/8,
  login, WASD al banco, entrega UI, recibo SQL y recarga; móvil emulado y capturas inspeccionadas.
- [Primer canario de IDs](public-c59f3d35-41eb-4532-945e-f58e436b2b66.json): parcial; falló la primera
  bodega. [Diagnóstico](storage-diagnostic.json), [bloqueo](failure-status.json),
  [SQL026 10/10](sql026.tap), [recuperación](../../l03d-companion-control/prerequisite-recovery.ndjson)
  y [limpieza con seis recibos conservados](../../l03d-companion-control/retained-qa-cleanup.json).
- [Primer canario de Tala](public-7a949137-a098-4b6d-887d-a8600c11b303.json): parcial; sin ACK al
  guardar la denegación de un token inventado. Es el incidente recuperado por alpha.38.

Los registros de recuperación, limpieza, pruebas en imagen y canarios públicos nuevos proceden del
operador único AREA17; este frente los copió sin modificar su fuente y revisó su alcance. La
verificación VPS independiente, el diagnóstico SQL de lectura y `timing-final.tap` son de este frente.
[verify-timing-deployment.py](verify-timing-deployment.py) consulta el VPS sin mutarlo.
[diagnose-logging-baseline.mjs](diagnose-logging-baseline.mjs) no escribe en Supabase, pero guarda
un resultado local. Es histórico y falla si no existe el QA exacto; busca sólo la primera página
Auth y comprueba ausencia de su recibo de control, no todos los recibos de una cuenta.

El [procedimiento de aceptación](../live-acceptance.md) conserva los recorridos restantes.
INV01–03 (huecos/pilas, Carga con puntos y sobrepeso) continúa como corte posterior separado.
