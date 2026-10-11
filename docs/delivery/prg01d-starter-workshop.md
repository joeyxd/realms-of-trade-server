# PRG01d — taller personal, bodega inicial y capacidad

Integración posterior alpha.39/protocolo 47: las 30 regresiones locales de taller, baseline SQL,
Tala, recursos, fuego y control pasan. La navegación pública al muelle, pasarela y cubierta propia
pasó [3/3](prg01d-starter-workshop/activation/public-ebc96836-ae35-4eca-8b19-a6ccee6aa76e.json).
El [canario combinado](prg01d-starter-workshop/activation/public-4e926d4b-bc17-4c9b-b2a1-7924dac83d94.json)
pasó **36/36 comprobaciones** por WSS autenticado: proyecto parcial, crédito único, bodega inicial,
caja/kit, segunda bodega pagada, desguace, mochila, receta, reconexión, replay y Tala. Perfil/Auth
QA retirados; veinte recibos económicos conservados. Los materiales de construcción se sembraron
solo en ese perfil desconectado; los troncos de Tala se obtuvieron jugando. No acredita navegador,
balance, aciertos perfectos ni cooperación entre jugadores.

**Estado: SQL026 aplicado; taller y Tala verificados en público.** Construcción, capacidad y reconexión pasaron 33 comprobaciones en alpha.37 antes de fallar la navegación a la palmera. Alpha.38 `d962055` corrigió el baseline económico de Tala y pasó su canario exclusivo 6/6: rechazo sin mutación, tres golpes con desafíos reales, recompensa durable, replay y fabricación de una tabla. La recuperación conservó los hashes completos de perfil/mundo; los QA retenidos y nuevos quedaron eliminados, con recibos conservados. La verificación independiente confirmó revisión/imagen, salud pública 200 y una autoridad sin pendientes ni errores. El canario combinado posterior alpha.39 ya consta arriba; balance sigue pendiente. Ver el [checkpoint](prg01d-starter-workshop/activation/README.md).

## Comportamiento entregado

- El host habilita las operaciones del taller con `workshopOperations`. En perfiles nuevos, esa opción activa el estado de taller y la mochila básica de 18 uV. Con la opción apagada, los perfiles nuevos mantienen el contrato legado de 10 de capacidad y omiten `carry`/`workshop`; los perfiles existentes se conservan al abrir sesión.
- `profile.workshop` es opcional; cuando existe su forma exacta es `{v:1,boards:0..10,storageCredit:boolean,crateKits:0..99}`. El lector valida JSON con descriptores seguros, rechaza campos desconocidos/versiones futuras y trata ausencia como estado vacío. Cada operación personal aceptada aumenta `tradeRev` una vez.
- Contribuir entrega de 1 a 10 tablas que ya estén en la mochila, sin exceder el saldo restante hacia diez. La recepción final enseña `raft_storage` y crea un crédito único de primera bodega. Si esa lección ya se conocía por progreso previo, se marca la misión como completada sin conceder otro crédito. El recibo de la primera contribución exitosa también permite a un perfil legado sin metadatos adoptar mochila básica de 18 uV, únicamente si la carga restante tras el pago cabe en volumen y masa.
- La primera bodega colocada consume el crédito; otras bodegas cuestan diez tablas. Crear un kit de caja cuesta dos tablas y aumenta `crateKits`; colocar una caja consume un kit. Ambos flujos son personales y no requieren Tala ni completar una misión comunitaria. El desguace conserva el salvamento proporcional a la condición: una bodega devuelve hasta tres tablas y una caja hasta una tabla al estar a vida completa. Las piezas dañadas devuelven menos; no se restaura la vida de la balsa.
- La mochila tiene niveles de volumen 18/30/42 uV. Fuerza es `10 + (nivel - 1)` y masa máxima `18 + 2 × (Fuerza - 10)` uM. Subir del nivel inicial cuesta 2 tablas y 3 lona; subir al último nivel cuesta 4 tablas y 5 lona. El servidor cobra primero en una copia y comprueba después que los bienes restantes caben en la capacidad nueva; un rechazo no muta el perfil.
- La receta de tabla básica consume dos troncos y produce una tabla. Tala usa objetivo +45 ticks, fin +90, inicio mínimo +6 y ventanas 5/8/11 ticks para práctica 0/60/180. Los tres golpes entregan 3–6 troncos según aciertos y diez puntos de práctica por ciclo. Son valores iniciales de tuning, todavía pendientes de playtest.
- SQL024 es aditiva y se aplica después de SQL001–SQL023; conserva las barreras de adopción de mundo de SQL023. SQL021 y sus recibos anteriores no se reinterpretan ni se vuelven a ejecutar. La bandera de taller controla también la ruta del desafío de Tala; las operaciones de taller/recursos se mantienen bajo autoridad del host.

## Verificación local registrada

Las ejecuciones se solapan y no se suman:

- [Runtime integrado](prg01d-starter-workshop/runtime.tap): **188/188**.
- [SQL001–024](prg01d-starter-workshop/sql.tap): **9/9**, con reaplicación de SQL024, recibos históricos, rechazo de datos falsificados y cerco/adopción común.
- [Selección de release más autoridad del taller](prg01d-starter-workshop/release.tap): **117/117**; incluye el nuevo rechazo de modificaciones de capacidad fuera del taller.
- [Integración final de idiomas, admisión GM y compañeros](prg01d-starter-workshop/post-merge.tap): **71/71**.
- [QA visual local](prg01d-starter-workshop/ui/evidence.json): **39/39 comprobaciones y 36 capturas**, escritorio/portrait/landscape, ES/EN, estados parcial/listo, reintento y rechazo.

Son fixtures locales PGlite/host/navegador: no demuestran durabilidad en una base viva ni funcionamiento en un teléfono físico. Las pruebas de recuperación por proceso del flujo SQL021 conservan su alcance histórico; este corte no afirma una aceptación SIGKILL propia de SQL024.

## Evidencia visual

El [índice de evidencia visual](prg01d-starter-workshop/ui/README.md) explica el alcance y enlaza el inventario completo. El [JSON de resultados](prg01d-starter-workshop/ui/evidence.json) recoge texto visible, ajuste al viewport y archivo de cada captura.

- [Panel de taller, entrega parcial, escritorio ES](prg01d-starter-workshop/ui/desktop-es-partial.png)
- [Crédito de primera bodega, escritorio EN](prg01d-starter-workshop/ui/desktop-en-ready.png)
- [Taller en viewport móvil, portrait ES](prg01d-starter-workshop/ui/portrait-es-partial.png)
- [Editor de balsa y bodega, landscape EN](prg01d-starter-workshop/ui/landscape-en-storage.png)
- [Banco de trabajo, escritorio EN](prg01d-starter-workshop/ui/desktop-en-workbench.png)
- [Panel de Tala, portrait EN](prg01d-starter-workshop/ui/portrait-en-timing.png)

## Publicación y activación

La activación original `f939152`, alpha.36/protocolo 45, confirmó SQL023/024 y convirtió recursos v2→v3 conservando 206 nodos, 96 palmeras, ledger, cooldowns, comunidad y semilla. [Despliegue histórico](prg01d-starter-workshop/activation/deployment.json) y [transición](prg01d-starter-workshop/activation/transition.json). El mundo común suelo/perlas/muerte sigue sin adoptar ni activar.

La [entrada pública](prg01d-starter-workshop/activation/public-entry.json) pasó 14/14 y el [navegador autenticado ES/EN](prg01d-starter-workshop/activation/browser/browser-1d99d56f-c32c-4ba3-887c-b7cecf42a86d.json) 8/8: login, WASD al banco, entrega por UI, recibo SQL y progreso al recargar. Capturas inspeccionadas y móvil emulado; son evidencia anterior a alpha.38. La cuenta UI se eliminó y su recibo se conservó.

El primer canario encontró el ID real de balsa con `:` rechazado por SQL024. SQL026 está aplicado y confirmado; la [recuperación guardada](l03d-companion-control/prerequisite-recovery.ndjson) conservó crédito/kit y hashes del mundo, y la [limpieza](l03d-companion-control/retained-qa-cleanup.json) mantuvo seis recibos. No repetir las migraciones previas.

El [canario de construcción](prg01d-starter-workshop/activation/public-c542b02f-1315-439b-9020-f0a69aacb5a9.json), alpha.37/protocolo 46, pasó 33 comprobaciones: crédito único, bodega gratuita y otra por diez tablas, kit/caja, denegaciones ocupado/revisión antigua sin mutar, desguace, mejora de mochila, tabla 2:1 y reconexión. Falló después al caminar hasta una palmera; su perfil/Auth se eliminaron y quince recibos se conservaron. Sus materiales de construcción se sembraron sólo en el perfil QA desechable desconectado; no se ganaron jugando.

El [primer canario exclusivo de Tala](prg01d-starter-workshop/activation/public-7a949137-a098-4b6d-887d-a8600c11b303.json) encontró un segundo bloqueo al rechazar un token inventado. El [control SQL de solo lectura](prg01d-starter-workshop/activation/logging-baseline-diagnostic.json) confirmó el drift económico; [alpha.38](prg01d-timing-baseline.md) guarda ese baseline con el escritor existente. No requiere otro SQL ni cambia recompensas, timing o política offline. La [recuperación exacta](prg01d-starter-workshop/activation/timing-recovery.ndjson) conservó perfil/mundo y tick, y la [limpieza posterior](prg01d-starter-workshop/activation/timing-retained-qa-cleanup.json) eliminó el fixture sin recibos económicos.

El [canario de Tala alpha.38](prg01d-starter-workshop/activation/public-d783c754-992a-4304-9e2a-25d3f4df4d9d.json) pasó **6/6** por WSS público. Rechazó calidad y desafío inventados sin cambios de perfil/palmera; tres golpes reales dieron tres troncos y diez de práctica, con replay histórico. En el banco normal convirtió dos troncos en una tabla. Sembró únicamente un hacha en el perfil desechable, sin carga; esos troncos sí se obtuvieron del recorrido real. Perfil/Auth eliminados y cuatro recibos conservados. El canario mínimo no valida en vivo el extremo de seis troncos por aciertos perfectos ni cooperación entre varios jugadores.

La [verificación independiente del VPS](prg01d-starter-workshop/activation/timing-deployment-independent.json), posterior al canario, confirma `d9620558a93f6a6ed88614857b03d7d9822a4b1b`, alpha.38/protocolo 46, imagen `sha256:f937c420dbe5555048f10c3087e9a5d237e80389c3aa880b6a54b3841cf6bc8c`, hashes de runtime coincidentes con Git, salud pública 200, Auth habilitado, una autoridad y timer activo. M5 tenía cero errores, pendientes y datos sin guardar, con taller/recursos/artesano ready. [Pruebas en esa imagen](prg01d-starter-workshop/activation/timing-image-tests.json): 28/28 con red aislada; no son pruebas SQL ni una segunda autoridad.

La [selección local final independiente](prg01d-starter-workshop/activation/timing-final.tap) pasó 20/20. Una selección más amplia pasó 68/69; el caso legacy de colocar storage en `ground-host-authority-sql` también falla en `8ce31ce` sin este arreglo. No se declara resuelto ni se activa ese montaje común. Los conteos se solapan y no se suman.

La repetición combinada ya pasó en alpha.39, según el informe enlazado arriba. La [repetición alpha.38](prg01d-starter-workshop/activation/public-156e1731-9f05-4452-b1ff-3250670c2b87.json) conserva su resultado fallido: quince comprobaciones antes del atasco en la pasarela, perfil/Auth retirados y seis recibos conservados. Sigue pendiente el navegador autenticado actualizado; tampoco se afirma SIGKILL propio, nueva medición offline, balance ni rendimiento físico móvil. [Procedimiento](prg01d-starter-workshop/live-acceptance.md) y [checkpoint](prg01d-starter-workshop/activation/README.md). Los dos incidentes históricos están recuperados: no repetir sus scripts ni apagar el taller con recursos v3.

La ampliación INV01–03 de huecos/pilas, Carga con puntos y sobrepeso es posterior: este corte aporta el contrato inicial de volumen/masa, sin implementar esa interfaz ni cerrar su tuning.
