# VPS: disponibilidad y publicación continua

El autor pidió que los cortes terminados lleguen al mismo servidor de amigos. La URL continúa siendo
<https://marea.62.171.136.148.sslip.io>; se conserva el mundo `marea-negra`, el archivo privado y las cuentas.

## Incidencia y recuperación

El contenedor de la primera release estaba vivo pero `unhealthy`. El proxy devolvía HTTP 503,
`no available server`. El estado interno confirmó cero jugadores, cero perfiles pendientes, un fallo
de almacenamiento y el mundo bloqueado en generación 466. Una lectura directa de Supabase ya respondía
y devolvía esa misma generación/semilla; no se borraron datos ni se fabricó un mundo nuevo.

Se reinició únicamente el contenedor del juego con 90 segundos de gracia. La página y `/health` volvieron
a HTTP 200, el mundo quedó preparado y el siguiente autosave avanzó a generación 467 sin errores.
Chrome comprobó entrada online, minimapa y panel M sin errores de página ni requests fallidos.
La primera sonda de navegador agotó su espera al consultar el diálogo de invitado demasiado pronto;
la segunda esperó al diálogo y completó el flujo. Esta comprobación no vuelve a acreditar todas las
mecánicas ni recuperación tras una caída abrupta.

## Cambio operativo

- `deploy/runtime.mjs` supervisa al único proceso del juego. Cuatro comprobaciones consecutivas del
  fallo de mundo durable, sin jugadores/perfiles pendientes y sin coordinadores opcionales activos,
  solicitan cierre ordenado. Docker aplica su política de reinicio y vuelve a cargar la base de datos.
  El guard no modifica el mundo ni reintenta un guardado ambiguo.
- `deploy/vps-update.py` sigue la rama de continuidad, archiva el SHA remoto, construye la imagen y
  ejecuta regresiones en un contenedor aislado sin claves. Espera si hay jugadores o recursos insuficientes.
  Detiene la release anterior antes de arrancar la nueva y comprueba salud/revisión/almacenamiento.
  Si falla, detiene la candidata antes de recuperar la imagen anterior. No hay rollback de datos.
- Un timer cada dos minutos consulta cambios; `/opt/marea-negra/current` apunta a la release aceptada.
  El actualizador instalado es explícito y no se sustituye a sí mismo desde Git.
- `AGENTS.md` registra la petición del autor: completar/revisar/pushear cada corte y verificar la
  publicación. Los cambios sin commit de otros agentes quedan fuera del paquete.

El guard tiene once pruebas, incluida una que observa el drain de un proceso hijo real antes de salir.
Las pruebas del actualizador verifican rechazos, espera por jugadores, rollback sin solapamiento,
comprobación de imagen y permisos. La aceptación Linux y las revisiones activas se registran en los
logs privados del servicio y en su marcador de validación por SHA/imagen.

## Límites

La publicación espera una partida vacía y tiene una interrupción breve. SQL, secretos y activaciones
opcionales de M5/Web3 no se aplican automáticamente; siguen su integración específica. La persistencia
de agotamiento de recursos, operaciones críticas y coordinadores opcionales conserva las limitaciones
de la [primera entrega](vps-alpha.md). El supervisor no reinicia por estados desconocidos ni por perfiles
pendientes. No es una aceptación de capacidad para miles de jugadores.

[Operación y comprobación de releases](../DEPLOY-VPS.md).
