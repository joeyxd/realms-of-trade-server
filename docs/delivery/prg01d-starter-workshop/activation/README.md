# PRG01d — activación, recuperación y canarios pendientes

## Estado actual

La mecánica se activó primero en alpha.36 y la recuperación histórica de la imagen exacta alpha.37 (`8ce31ce442e8e6bffd430b80690f8441f44314fd`, protocolo 46) ya fue aceptada. Los hashes completos de perfil y mundo quedaron idénticos, con cero operaciones pendientes, errores o datos sin guardar; los readiness SQL024/026/027 devolvieron versión 1 ([evidencia](timing-recovery.ndjson)). **La aceptación de alpha.38 y los canarios públicos todavía están pendientes.** El fix alpha.38 `d962` está publicado en Git y su despliegue normal sigue en progreso.

Hay dos incidentes separados. En alpha.36, el canario de construcción falló porque SQL024 rechazó el `:` del ID de balsa; SQL026 corrigió ese caso y la imagen se recuperó. Más tarde, en alpha.37, el canario de Tala provocó el fence de M5 por drift entre el baseline económico y el mundo avanzado del host. La recuperación exacta alpha.37 está aceptada; el arreglo es el checkpoint previo a la operación en alpha.38, no una nueva migración SQL. El mundo común de suelo/perlas/muerte sigue sin adoptar ni activar; instalar SQL023 no lo adopta.

El [baseline de Tala](../../prg01d-timing-baseline.md) documenta causa, regresión y límites. El [registro de recuperación](timing-recovery.ndjson) confirma la imagen exacta alpha.37, conservación de perfil/mundo y readiness. No repetir SQL021/024 ni volver a aplicar SQL026 para resolver el drift de Tala.

## Evidencia comprobada

- [Despliegue anterior al canario de bodega](deployment.json): imagen `marea-negra:alpha-f939152e24b5`, una autoridad y temporizador activo, 109/109 comprobaciones de imagen. Es evidencia histórica de alpha.36.
- [Transición de recursos](transition.json): v2→v3 conservó los 206 nodos, 96 palmeras, ledger v2, cooldowns, comunidad y semilla; agregó calidad inicial cero. El tick continuó desde el estado guardado. No es una nueva medición de pausa offline.
- [Entrada invitada pública](public-entry.json): 14/14, con taller habilitado y ready antes del fallo.
- [Navegador autenticado](browser/browser-1d99d56f-c32c-4ba3-887c-b7cecf42a86d.json): 8/8. Login normal, movimiento WASD al banco, entrega de tres tablas desde UI, recibo SQL y progreso restaurado al recargar. Panel ES 1280×720 y EN 390×844 inspeccionados; móvil emulado. Cuenta/perfil QA eliminados y recibo conservado.
- [Canario de construcción incompleto](public-c59f3d35-41eb-4532-945e-f58e436b2b66.json): entregas 3+2+3+2, crédito único, kit de dos tablas y reintentos históricos aprobados antes de fallar la primera colocación. **No es un pase completo.** Su recuperación y limpieza QA quedaron registradas aparte; el perfil/Auth se eliminaron y se conservaron seis recibos económicos ([recuperación alpha.36](../../l03d-companion-control/prerequisite-recovery.ndjson), [limpieza](../../l03d-companion-control/retained-qa-cleanup.json)).
- [Diagnóstico de solo lectura](storage-diagnostic.json): el ID real con dos puntos fue el síntoma reproducido del incidente de bodega; SQL026 corrigió ese alfabeto. El recibo fallido estaba ausente, con crédito y kit intactos.
- [Estado bloqueado](failure-status.json): captura histórica de alpha.36 con cero jugadores/conexiones, una operación económica pendiente y cerco de guardado. No es el estado actual ni confirma pérdida de bienes o construcción aplicada.
- [Regresión SQL024/026](sql026.tap): 10/10. Reproduce el rechazo con un ID generado por `prepareRaftProfile`, usa condición real persistida, aplica/reaplica SQL026 y comprueba primera bodega, segunda pagada, kit, rechazo ocupado/revisión antigua sin mutación, recibos históricos y cerco del mundo adoptado.

## Corrección y reanudación

SQL026 conserva el validador exacto de SQL024 y añade `:` al alfabeto de identidad que ya usa el host. Mantiene la tolerancia histórica de ID vacío y no cambia IDs existentes. También admite el `record` acotado de una respuesta de revisión antigua solo cuando `ok=false`, y permite recibos de rechazo cuya proyección de perfil permanece exactamente igual, después de verificar la preservación del mundo. Los éxitos conservan todas sus comprobaciones de costes, crédito, piezas y condición. Esta es la corrección del incidente de bodega alpha.36; no corrige el drift de Tala alpha.37.

La recuperación exacta de alpha.37 ya se aceptó bajo los locks del actualizador/contenido y con cero jugadores/conexiones. [El registro](timing-recovery.ndjson) confirma mundo versión 1936 y perfil versión 3 sin cambios de hash, resource v3 y tick conservado, readiness de SQL024/026/027 en 1, y cero errores, pendientes o datos sin guardar. El QA del incidente anterior de bodega se limpió con seguridad conservando seis receipts; véase la [evidencia de cleanup](../../l03d-companion-control/retained-qa-cleanup.json). Esto restaura disponibilidad de alpha.37; no equivale a validar alpha.38 ni a pasar los canarios de Tala. No apagar `MN_STARTER_WORKSHOP` tras adoptar recursos v3.

El fix de checkpoint está publicado en Git como alpha.38 `d962`; el updater normal está desplegándolo. Aún no declarar ese runtime activo ni dar por aceptado el flujo público: después del despliegue y sus checks de salud se repetirán los canarios completos. La evidencia de recuperación no autoriza repetir el canario contra alpha.37.

Después, `tools/qa-workshop-public.mjs` recorre por WSS público caja, bodega gratuita/pagada, denegaciones normales, desguace, mochila y receta 2:1. `tools/qa-workshop-logging.mjs` prepara el recorrido palmera→tabla con desafíos reales del host. Esos recorridos completos aún no pasaron en vivo. Los materiales de construcción de la QA se siembran exclusivamente en su perfil desechable desconectado, con CAS y doble límite de carga; no representan materiales ganados jugando.

No están aceptados aún SIGKILL de SQL024/026, nueva medición offline, balance/sensaciones ni rendimiento de teléfono físico. INV01–03 continúa como corte posterior separado.
