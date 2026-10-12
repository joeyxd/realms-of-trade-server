# SRV02 — comidas especiales

Implementado originalmente para alpha.58 / protocolo 57 y publicado en alpha.59 / protocolo 58 con los cortes concurrentes. SQL035 está instalado y el flag está activo. El grog pasó el canario público autenticado; la aceptación de navegador se registra por separado abajo. [Contrato](../../briefs/srv02-special-meals.md).

## Comportamiento

| Comida | Ingredientes provisionales | Efecto durante 15 minutos conectados |
| --- | --- | --- |
| Pescado asado | 1 pescado; fogata o parrilla propia encendida y cercana | +10 % vida máxima |
| Grog | 1 ron + 1 agua de provisiones | +25 % recuperación de aguante de combate |
| Galleta reforzada | 1 galleta + 1 harina; mismo requisito de fuego | +10 unidades de carga cómoda |

Solo hay un efecto activo; la siguiente comida lo reemplaza. Pausa offline, muerto y durante un commit retenido; desaparece al reaparecer. Cocinar consume y come al momento, incluso con necesidades llenas. No agrega mercancías. Mantiene la curación normal de comida una sola vez, las penalizaciones de hambre/sed, los límites de volumen/masa y los modelos de natación/navegación.

Perfil opcional exacto `meal:{v:1,kind,ticks}` (1–54000). Timers predichos en el snapshot, sincronizados con el perfil y el guardado M5 existente. `freshwater/meal` conserva los ocho campos y el recibo económico común. Replay no vuelve a gastar, curar ni renovar. Crear comidas está detrás de `MN_SPECIAL_MEAL_OPERATIONS`, default 0; exige cantimplora/agua y readiness SQL035. Deshabilitar nueva preparación conserva los efectos ya guardados si supervivencia permanece habilitada.

Panel ES/EN: tres recetas, coste, duración, aviso de reemplazo y motivo de bloqueo visible también en touch. Usa arte/UI/fuego existentes; no importa assets nuevos. La fogata/parrilla permanece en la balsa en este corte, sin introducir cocina de casas/tierra.

## Verificación

- [Regresión de simulación/host/UI](runtime-tests.log): 152/152; la prueba adicional de comercio MemoryStore con buff pasó dentro del grupo del actualizador.
- [Grupo del actualizador](updater-tests.log): 194/194, incluidos los nuevos casos de comidas; conteo solapado con la regresión.
- [SQL](sql-tests.log): 33/33 en cadena 001–035 PGlite, bajo rol `service_role`, validación estricta, recetas, ingredientes/necesidades/recipientes forjados, denegación sin cambio, replay y colisión, compatibilidad SQL030/032, migración repetida y recibo previo intacto. Incluye Tala cooperativa con comida en actor/colaborador y rechazo de editar el efecto del colaborador; el CHECK queda vinculado al validador nuevo.
- [Navegador local](local/evidence-2026-10-11T20-25-37-952Z.json): 6/6 ES/EN desktop, móvil y móvil rotado con `stage.js` real; DOM/estilos reales, cliente simulado. Scroll, requisitos visibles, temporizador, reintento idéntico y ausencia de mutación optimista. Sin errores JS/consola ni solicitudes externas. Capturas inspeccionadas por el integrador. No acredita una partida pública ni teléfono físico.

## Aceptación pública del 2026-10-11

[Activación](public/20261012T021031Z-activation/activation.ndjson) bajo bloqueos de actualización/contenido, sin jugadores, conservando la imagen y el resto del entorno. El [canario WSS](public/20261012T045934Z-wss/acceptance.json) pasó **11/11** sobre `e625a5c`, alpha.59/protocolo 58: rechazo anónimo, login normal con cuenta temporal marcada, coste exacto del grog, efecto/temporizador, replay, colisión de ID, pausa offline, reentrada y avance conectado. Una receta caliente sin cocina propia produjo un recibo durable de denegación sin cambios. Se conservaron dos recibos; se eliminaron la cuenta y el perfil temporales.

La [autoridad antes/después](public/20261012T045934Z-wss/authority.ndjson) comprueba 20 hashes de imagen y 13 fuentes públicas contra Git, una autoridad, cero jugadores/sockets/errores/pendientes al terminar y actualizador activo. La [regresión tras integrar M5](integration-m5.json) pasó 33/33; el conteo se solapa con las pruebas anteriores.

La [integración posterior de recursos GM y emparejamiento](integration-gm-companion.json), alpha.61/protocolo 59, repitió 33/33 sobre `8121e4b`. El [recheck con reacción y retroceso del Bucanero](integration-alpha62.json), alpha.62/protocolo 59, también pasó 33/33 sobre `9adde68`. El código de comidas no cambió. Esas regresiones locales se distinguen de los canarios públicos ligados a sus revisiones anteriores.

El [navegador público](public/20261012T050919Z-browser/acceptance.json) pasó **9/9** en `9ea14a0`, alpha.59/protocolo 58: login normal, botón real de grog, coste/efecto/temporizador en recibo y perfil, recarga/reentrada y panel ES/EN en escritorio 1280×720 y móvil touch emulado 390×844. Dos envíos idénticos del panel correspondieron a un solo comando y un recibo. Diez capturas, sin errores JS; las siete respuestas HTTP403 fueron exclusivamente `/api/gm/session`, el rechazo esperado para una cuenta autenticada fuera del allowlist GM, conservado en el JSON. La vista vertical usa la rotación horizontal de `stage.js`, como el juego. La [comprobación de autoridad](public/20261012T050919Z-browser/authority.ndjson) terminó sin jugadores, errores ni pendientes; cuenta/perfil eliminados y recibo conservado.

El [primer intento de navegador](public/20261012T050711Z-browser/acceptance.json) exigía incorrectamente un único envío y expiró ante el reintento normal del panel. La [conciliación de solo lectura](public/20261012T050711Z-browser/receipt-reconciliation.json) demuestra que el grog se confirmó una sola vez y que cuenta/perfil ya no existen. Su recibo permanece: el cero registrado originalmente por la limpieza era un error del contador, que solo anotaba el ID después de superar la espera. El harness ahora admite reintentos idénticos, registra intentos antes de esperar y enumera los recibos de esa cuenta al limpiar. Esto es distinto del rechazo SQL inicial descrito abajo.

El [primer intento](public/20261012T021502Z-wss/acceptance.json) falló sin ACK y el host cerró con `world failed: operation`. La lectura posterior encontró la autoridad sana, mismo código/imagen y arranque a las 02:23:30Z; no establece quién inició ese arranque ni atribuye una causa al rechazo. La [comprobación posterior](public/20261012T045843Z-diagnosis.json) confirmó perfil de QA v3 intacto, ingredientes conservados, efecto ausente y cero recibos. Los validadores y la transición aceptaron una petición reconstruida; ocho llamadas al commit con versiones CAS imposibles devolvieron conflicto sin modificar el perfil. La hipótesis de funciones antiguas enlazadas en caché tampoco se reprodujo localmente. No se presenta como una reparación SQL demostrada. La [limpieza exacta del huérfano](public/20261012T045929Z-orphan-cleanup.json) verificó marcador, email, propiedad, versión y ausencia de recibos antes de eliminar solo esa cuenta/perfil.

El canario exitoso acredita el flujo actual de grog y la denegación caliente. Pescado asado y galleta reforzada conservan pruebas locales de fuego propio real; su consumo público con fogata/parrilla encendida queda pendiente. Balance, sensación y rendimiento en teléfono físico siguen requiriendo playtest.

## Historial de publicación y siguiente paso

Al publicar el código de SRV02, INV02d ya estaba implementado y su corrección legacy estaba en el VPS `cd5df25`, alpha.57. Había un jugador/un socket, sin errores o pendientes; se respetó su sesión.

[Lectura histórica a las 20:35Z](deployment.json): imagen activa `sha256:ea028cc249a3a6ee773479d1d7c314e04781ffeef779624e8b6ebce8f46b45cd`, alpha.57/cd5df25; salud pública 200. El actualizador difirió el relevo por ese jugador. SQL035 devolvía `PGRST202` y el flag permaneció apagado. El grupo operativo quedó sincronizado con 194 pruebas y copia previa conservada. Aquella lectura no acreditaba SRV02 desplegado; la evidencia actual está en la sección anterior.

1. Completar el consumo público de platos calientes mediante una cocina propia encendida y cercana, sin fabricar pruebas de calor. Conservar el incidente inicial y capturar la fase/código si vuelve a ocurrir.
2. [INV03](../../briefs/inv03-existing-backpacks.md): completar aceptación de las mejoras de mochila que ya existen, especialmente 30→42, replay/reentrada y Carga conservada. No rehacer el sobrepeso ni introducir bolsas equipables sin resolver su relación con las mejoras pagadas.
3. Playtest de duración/recetas y sensación de carga.
