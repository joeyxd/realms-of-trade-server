# Taller público autenticado — alpha.40

[Resultado 8/8](browser-ff2a73aa-4da3-47d6-8e29-1e40c283625b.json),
2026-10-11 02:47:21–02:48:04 UTC, protocolo 47. Ejecutado con
`tools/qa-workshop-browser.mjs`, sin modificar el runtime ni aplicar SQL.

Los [registros de autoridad](authority.ndjson) fijan revisión
`88f61ea5d417d92843990bfe10e29e3eab5e3e01` e imagen
`sha256:80dd527da27b8b2b0c507442fb547009cf15edd3b9dc0db905949f96ae49da32`
antes y después del recorrido. Se mantuvieron los locks existentes del actualizador y contenido;
no hubo reinicio ni cambio de mapa. Al terminar: cero jugadores/conexiones, errores, operaciones
pendientes y datos sin guardar; mundo/taller/recursos/artesano ready.

La cuenta aleatoria desechable entró con login normal y WSS público, caminó al banco usando WASD,
abrió el taller y entregó tres tablas desde la UI. Supabase confirmó perfil y recibo. Después de
recargar y entrar desde la UI, conservó el progreso 3/10 y cero tablas en mochila. Se eliminaron
perfil/Auth QA después del drenaje y se conservó un recibo económico. Sólo se sembraron esas tres
tablas en el perfil de prueba desconectado; no se obtuvieron jugando.

Capturas inspeccionadas por el agente principal:

- [Escritorio ES, 1280×720](01-workshop-desktop-es.png): panel completo, progreso, materiales,
  peso/volumen y acciones legibles.
- [Portrait EN, 390×844](02-workshop-portrait-en.png): panel dentro del viewport, sin recorte,
  progreso 3/10, carga y acciones visibles. **El HUD de fondo se superpone en la parte superior**;
  queda pendiente una corrección del HUD móvil. Este pase no acepta toda la interfaz móvil.

No hubo errores de página/consola ni peticiones inesperadas fallidas. El informe separa cinco
403 esperados de permisos GM y dos cancelaciones del chequeo GM durante transiciones de sesión.
Las credenciales y los identificadores privados de la cuenta no aparecen en la evidencia.

Este recorrido acepta login, entrega parcial por UI, cambio de idioma desde ajustes y reconexión.
El ciclo completo de caja/bodega/mochila/Tala se acepta por el canario WSS alpha.39 36/36, no por
estas dos capturas. No acredita SIGKILL, nueva medición offline, cooperación, aciertos perfectos,
balance ni rendimiento de un teléfono físico.
