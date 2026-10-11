# PRG01d — activación y bloqueo encontrado en el canario

## Estado actual

La mecánica se activó en la única autoridad VPS `f939152e24b51774faab3239a902c6cc76e01d3f`, alpha.36/protocolo 45. **La aceptación completa sigue pendiente: M5 quedó bloqueado al rechazar SQL024 la primera bodega de la cuenta QA.** El contenedor pasa a unhealthy y la entrada pública devuelve 503. No reiniciar para presentar el servicio como aceptado antes de corregir y verificar la base.

El siguiente paso requiere aplicar [SQL026](../../../../server/migrations/026_workshop_raft_identifiers.sql) en Supabase, sin repetir SQL021 ni reescribir SQL024. El autor recibió la petición; aplicación todavía sin verificar. Después se debe ejecutar la recuperación guardada y repetir la aceptación completa, incluida Tala. El mundo común de suelo/perlas/muerte sigue sin adoptar ni activar; instalar SQL023 no lo adopta.

La [última comprobación](pending-sql026.json), a las 00:53–00:55 UTC del 2026-10-11, conserva readiness SQL026 ausente (`PGRST202`) y público 503, sin jugadores/conexiones. La recuperación todavía no se ejecutó.

## Evidencia comprobada

- [Despliegue anterior al canario](deployment.json): imagen `marea-negra:alpha-f939152e24b5`, una autoridad y temporizador activo, 109/109 comprobaciones de imagen.
- [Transición de recursos](transition.json): v2→v3 conservó los 206 nodos, 96 palmeras, ledger v2, cooldowns, comunidad y semilla; agregó calidad inicial cero. El tick continuó desde el estado guardado. No es una nueva medición de pausa offline.
- [Entrada invitada pública](public-entry.json): 14/14, con taller habilitado y ready antes del fallo.
- [Navegador autenticado](browser/browser-1d99d56f-c32c-4ba3-887c-b7cecf42a86d.json): 8/8. Login normal, movimiento WASD al banco, entrega de tres tablas desde UI, recibo SQL y progreso restaurado al recargar. Panel ES 1280×720 y EN 390×844 inspeccionados; móvil emulado. Cuenta/perfil QA eliminados y recibo conservado.
- [Canario de construcción incompleto](public-c59f3d35-41eb-4532-945e-f58e436b2b66.json): entregas 3+2+3+2, crédito único, kit de dos tablas y reintentos históricos aprobados antes de fallar la primera colocación. **No es un pase completo.** Su cuenta QA permanece identificada para recuperación; no borrarla mientras siga pendiente la autoridad.
- [Diagnóstico de solo lectura](storage-diagnostic.json): ID real con dos puntos; candidato rechazado, control idéntico cambiando únicamente la sintaxis del ID aceptado. Recibo fallido ausente, crédito intacto y un kit intacto.
- [Estado bloqueado](failure-status.json): cero jugadores/conexiones, una operación económica pendiente y cerco de guardado. No confirma pérdida de bienes ni construcción aplicada.
- [Regresión SQL024/026](sql026.tap): 10/10. Reproduce el rechazo con un ID generado por `prepareRaftProfile`, usa condición real persistida, aplica/reaplica SQL026 y comprueba primera bodega, segunda pagada, kit, rechazo ocupado/revisión antigua sin mutación, recibos históricos y cerco del mundo adoptado.

## Corrección y reanudación

SQL026 conserva el validador exacto de SQL024 y añade `:` al alfabeto de identidad que ya usa el host. Mantiene la tolerancia histórica de ID vacío y no cambia IDs existentes. También admite el `record` acotado de una respuesta de revisión antigua solo cuando `ok=false`, y permite recibos de rechazo cuya proyección de perfil permanece exactamente igual, después de verificar la preservación del mundo. Los éxitos conservan todas sus comprobaciones de costes, crédito, piezas y condición.

La recuperación debe comprobar readiness de SQL026, candidato válido, recibo fallido ausente y perfil QA confirmado; tomar exclusión del actualizador/contenido y exigir cero jugadores/conexiones. Detener y arrancar la misma única imagen validada recupera desde filas confirmadas; después verificar salud, capacidades ready, perfil/crédito y hashes del mundo antes de limpiar la cuenta QA. No apagar `MN_STARTER_WORKSHOP` tras adoptar recursos v3.

`recover.py` fija revisión, contenedor e imagen y se ejecuta por SSH stdin bajo los locks existentes; aún no ejecutado. `cleanup-retained.mjs` requiere `MN_QA_ALLOW_CLEANUP=1`, SQL026 ready, mundo correcto sano/vacío y marcador/email/sentinel exactos antes de eliminar sólo perfil/Auth QA. Conserva y vuelve a consultar todos sus recibos económicos. Si el marcador Auth ya no existe, sale sin mutar y no afirma que un perfil huérfano esté ausente. Esta limpieza también sigue pendiente.

Después, `tools/qa-workshop-public.mjs` recorre por WSS público caja, bodega gratuita/pagada, denegaciones normales, desguace, mochila y receta 2:1. `tools/qa-workshop-logging.mjs` prepara el recorrido palmera→tabla con desafíos reales del host. Esos recorridos completos aún no pasaron en vivo. Los materiales de construcción de la QA se siembran exclusivamente en su perfil desechable desconectado, con CAS y doble límite de carga; no representan materiales ganados jugando.

No están aceptados aún SIGKILL de SQL024/026, nueva medición offline, balance/sensaciones ni rendimiento de teléfono físico. INV01–03 continúa como corte posterior separado.
