# AREA15 — adopción atómica y cerco persistente del mundo

2026-10-10. Base final integrada `9266c40`, alpha.34/protocolo 43. Conserva RNV04, I18N04b, L03d y GM03b2;
la regresión de servidor se ejecutó primero en `c9d3bbf`, alpha.31/protocolo 42. SQL022 corresponde
al combustible; esta entrega añade SQL023. [Contrato](../briefs/m5-ground-world-adoption.md).

## Implementado y probado

Una llamada service-only comprueba el mundo/version/snapshot exactos, crea el reloj inicial en
el tick actual de recursos y persiste un recibo inmutable. No reescribe el mundo ni su versión.
Los nodos, cooldowns, ledger, economía y comunidad quedan iguales. El replay histórico conserva
el recibo original sin instalar un snapshot antiguo ni avanzar tiempo offline.

La adopción v1 exige ausencia de reloj/intenciones comunes previas y cero filas de perlas,
death drops y estados de botín del mundo; rechaza incluso ubicaciones held y drops terminales.
No retima suelo legacy. Los recibos económicos legacy se conservan. Barreras de tabla cercan
los writers previos antes de comprobar la foto. Lock timeout/deadlock revierte el intento entero.

Después de adoptar, triggers rechazan writes legacy de mundo/reloj/suelo/diario antiguo. Sólo
el sobre SQL018/019 autoriza esas mutaciones en una capacidad privada por transacción, borrada
antes de retornar. No se puede falsificar con un GUC ni invocar la función base desde service_role.
Toda escritura en las tablas protegidas exige READ COMMITTED, incluso en mundos legacy: evita
que un snapshot anterior a la adopción omita el marcador. El runtime usa ese aislamiento por
defecto. Mundos sin marcador conservan su ruta. SQL023 instalada no adopta ni activa nada por sí sola.

El adaptador Supabase aislado valida la petición/recibo exactos y sólo concilia fallos de
transporte: consulta el recibo, reintenta como máximo una vez el mismo candidato y conserva
resultado desconocido como error. Payloads malformados, proxies/getters y más de 2 MiB se rechazan.

**213/213 pruebas en 31 archivos**, sin fallos/omisiones y con fuentes congeladas durante
la suite. [Manifest/hashes](m5-ground-world-adoption/acceptance.json),
[TAP](m5-ground-world-adoption/acceptance.tap). Incluye **22 casos nuevos**: once de contrato/
transporte, ocho SQL001–023/SDK, un GameHost real con recolección y reinicio, y dos SIGKILL nuevos.
SQL022/023 se reaplican en los fixtures; el reopen de la base omite todas las migraciones.

Tras integrar la traducción/cliente/icono de `fe50ab1`, **22/22 casos focales en cuatro archivos**
volvieron a pasar con fuentes congeladas: [manifest](m5-ground-world-adoption/final-integration.json),
[TAP](m5-ground-world-adoption/final-integration.tap). Son los mismos 22 casos de la suite anterior,
no pruebas adicionales únicas. `server/`, `src/sim/`, `src/net/`, `deploy/`, las dependencias y los
31 archivos de regresión no cambiaron entre las dos bases. La aceptación visual de I18N pertenece
a su entrega; estas pruebas no la sustituyen.

La rama incorporó después los controles de compañeros L03d (`6861636`). Se revisaron los
añadidos a `host`, `agentControl` y los mensajes opcionales de protocolo: no alteran el dueño de
tick, el orden económico `beforeTick` ni el cierre. Se repitió la regresión completa anterior más
los tres archivos de compañeros: **235/235 en 34 archivos**, sin fallos/omisiones y con fuentes
congeladas. [Manifest](m5-ground-world-adoption/integrated-server.json),
[TAP](m5-ground-world-adoption/integrated-server.tap),
[comprobación de fuentes](m5-ground-world-adoption/integrated-source-check.json).
Los resultados anteriores 213/213 y 22/22 se solapan con esta última suite; no se suman.
La detención de compañeros sigue en memoria según su propia entrega; no se vuelve permanente
por este corte ni se activa su integración con el montaje común.

La integración posterior GM03b2 (`9266c40`, alpha.34/protocolo 43) conserva el contrato de
adopción. Se revisaron admisión/cierre, store y updater; la prueba de entrada consulta ahora la
identidad publicada de `/api/world/content` y la envía en HELLO. **74/74 en doce archivos** tras
esa integración, con fuentes congeladas: adopción completa (22), GroundHostAuthority, store,
mundo/economía, contenido GM y compatibilidad de release. [Manifest](m5-ground-world-adoption/gm-integration.json),
[TAP](m5-ground-world-adoption/gm-integration.tap), [fuentes](m5-ground-world-adoption/gm-source-check.json).
Esta suite final y la regresión anterior 235/235 se solapan; no se suman. La API runtime SQL023
permanece idéntica al corte publicado; [normalización de evidencia](m5-ground-world-adoption/published-source-check.json)
registra únicamente finales de línea y una línea vacía final de un test, sin cambios de assertions.

- Conflictos de snapshot/versión/reloj, suelo previo, intenciones pendientes, colisión UUID,
  permisos y rechazo legacy sin mutación; error inyectado después de crear el reloj revierte todo.
- GameHost autenticado con catálogo completo y Tala v2; ACK sólo después del drain común,
  un recibo/intent económico y checkpoint de cierre. Reentrada conserva nodo/temporizador y reloj.
- SIGKILL con clock/marker/receipt provisionales y tras commit antes de respuesta: el proceso nuevo
  reabre el archivo, encuentra cero o una adopción, reintenta exactamente y conserva el cerco.

La regresión incluye las fronteras SQL018/019, economía/recursos/Tala/artesano, perfiles/mundo,
supervisor y combustible RNV04. Son pruebas locales PGlite/SDK/proceso, no prueba de corte eléctrico,
disco perdido, concurrencia de múltiples backends PostgreSQL ni lease entre hosts comunes.

## Dominio real y publicación

La [lectura real](m5-ground-world-adoption/legacy-domain.json) del 2026-10-10 a las 22:32:01 UTC
encontró mundo v1625, recursos v2/tick 792982, sin reloj común y cero filas de ubicaciones/perlas,
death drops/estados e intenciones pendientes legacy/comunes. SQL023 aún ausente (`PGRST202`).
Es una lectura informativa, no un candidato de adopción: la transición debe volver a obtener y
comprobar el snapshot exacto después de detener al writer anterior.

Código propio publicado `5c35d70`, normalización `c21f946`; integrado y verificado en la release
`9266c40f367dfa1a8aa1e786b57a23fcb8e4898c`. A las 2026-10-10T22:56:46.559283+00:00 el contenedor `71634cb5c0b0` y
la imagen `sha256:14ae83fab1550f1f9a327866f2e2ef206ccf59876ef9d8ed72e6e1ea9d178a79` estaban sanos. [Estado](m5-ground-world-adoption/live-status.json).
El updater confirmó **107/107** offline antes de sustituir la autoridad; el adaptador pasó **11/11**
en la misma imagen Node 22.23.3, sin red ni credenciales/SQL reales. [Gate de imagen](m5-ground-world-adoption/updater-validation.json),
[focal de imagen](m5-ground-world-adoption/image-tests.json). Se verificaron **6/6** lecturas/entrada
WSS pública con identidad de contenido actual, WELCOME/SNAPSHOT/PROFILE y cierre del socket.
[Entrada pública](m5-ground-world-adoption/public-smoke.json). No es canario autenticado de durabilidad
ni aceptación visual/activación de GM03b2, que conserva su propia entrega.

La [lectura final](m5-ground-world-adoption/final-legacy-domain.json) a las 2026-10-10T22:57:14.461344+00:00
mantiene cero filas de suelo/perlas/botín, sin reloj común, mundo v1676/recursos tick 882753 y SQL023
ausente (`PGRST202`). Economía, recursos/Tala y combustible existentes siguen activos; montaje
común y artesano apagados. No se ejecutó adopción ni se cambiaron flags de gameplay por este corte.

No hay credencial SQL de administración ni navegador conectado en esta sesión; SQL023 queda lista
para aplicar después de 001–022. Instalarla es independiente de adoptar/activar el mundo. El editor
SQL no está accesible desde esta sesión; por eso esa aplicación sigue pendiente del autor.

## Continuación

Aplicar SQL023 es instalar la capacidad; activar el dominio requiere un corte posterior detenido.
Componer perlas/muerte/botín bajo el mismo dueño, resolver las rutas de perfiles/editor/agentes
pendientes y preparar la exclusión del updater/writer anterior antes de un canario autenticado
real. El montaje común actual sigue accounts-only/cero bots y no es un lease entre procesos.
El cerco de mundo/suelo no cubre escritores de perfil sin mundo ni convierte en durable todo el juego.

Reutilización y descarte Unreal se documentan en el contrato. Sin arte/UI/protocolo nuevos por
esta entrega. El checkout compartido conserva su trabajo paralelo; sólo se sincronizan los
documentos propios y la nueva migración, sin reemplazar sus fuentes de runtime.
