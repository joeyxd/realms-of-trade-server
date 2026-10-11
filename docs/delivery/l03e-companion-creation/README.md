# L03e — creación durable de compañeros

**Implementada y aceptada en producción.** La revisión `96af1aa` (`96af1aa1cd54cd529803166614fe2b7903f07085`), `alpha.56`, protocolo 56, pasó la aceptación pública funcional. La captura de deployment confirma imagen con los diez hashes esperados, flag habilitado y host sano. El runtime actual ya está en `alpha.57` y sano. La migración SQL034 se aplicó a Supabase mediante la UI autenticada; `mn_companion_creation_ready` respondió `{"version":1}` el 2026-10-11 a las 17:23:14 UTC.

La aceptación final está registrada en [public-final/acceptance.json](public-final/acceptance.json): 11/11 comprobaciones, `pass:true`, incluido login real, creación desde la UI, coincidencia con el registro SQL034/configuración/control detenido y recarga/reentrada con la misma identidad y documentos. La fixture temporal se limpió después de verificar que el registro ya no existía; se borraron el perfil y la cuenta exactos, con cero escrituras pendientes. La primera corrida pública completó su limpieza, pero quedó marcada fallida por un timeout de Playwright al hacer clic en PLAY mientras el botón animaba; se corrigió usando Enter y se repitió el flujo completo.

## Comportamiento

Cada cuenta puede preparar un compañero por mundo. El wizard permite editar nombre, uno de cinco roles, una de cinco personalidades, hasta tres rasgos y uno de cinco aspectos; ofrece aleatorización, revisión explícita de los documentos y confirmación. La creación durable liga identidad, mundo y dueño, guarda la configuración inicial SQL025 y el control SQL027 detenido en la transacción SQL034. La reentrada recupera exactamente esa identidad y esos documentos.

El compañero queda detenido y preparado para el siguiente paso de emparejamiento mediante un adaptador local revocable. La creación no llama a un modelo, no activa inferencia, no hace spawn y no concede permisos ni grants. Tampoco cambia el perfil o inventario del jugador.

## Verificación

- [tests.json](tests.json): 57/57 pruebas focales en 9 archivos sobre la integración base.
- [integration-tests.json](integration-tests.json): 21/21 comprobaciones posteriores a la integración `alpha.57` y perlas; los conteos se solapan con los focales.
- 176/176 comprobaciones del actualizador.
- [browser.json](browser.json): 12/12 recorridos locales ES/EN, escritorio, retrato y paisaje; SQL001/025/027/034 real en PGlite persistido en disco, autenticación simulada y gameplay en memoria.
- [public-final](public-final/): aceptación en el host público `alpha.56`, revisión `96af1aa`, con autenticación y host reales. Incluye retrato ES/EN, revisión, guardado y reentrada. La fixture canaria y su perfil/cuenta están eliminados tras comprobar ausencia del registro y drenaje de escrituras.
- [deployment.json](deployment.json): identidad de imagen/revisión, diez módulos de imagen y seis servidos iguales a Git, y estado del host durante la aceptación.
- [final-health.json](final-health.json): revisión activa `66fcf82`, `alpha.57`, una autoridad sana, diez módulos de imagen y seis públicos iguales a Git; creación habilitada y lista, sin errores ni operaciones pendientes.
- [Brief de implementación](../../briefs/l03e-companion-creation.md) y [QA local](../../../tools/qa-companion-creation.mjs).

La prueba pública valida la revisión concreta `96af1aa` en `alpha.56`. La salud del runtime `alpha.57` es evidencia posterior de operación; no cambia la versión de la captura de aceptación.

**Siguiente paso:** desarrollar el adaptador local revocable para emparejar el compañero con el juego, manteniendo el estado detenido hasta una activación explícita y autorizada.
