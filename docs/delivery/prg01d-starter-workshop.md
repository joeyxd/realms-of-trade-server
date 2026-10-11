# PRG01d — taller personal, bodega inicial y capacidad

**Estado: alpha.37/protocolo 46 recuperada; fix alpha.38 publicado en Git y despliegue normal en curso.** La recuperación exacta de `8ce31ce442e8e6bffd430b80690f8441f44314fd` quedó aceptada: hashes completos de perfil y mundo idénticos, cero operaciones pendientes, errores o datos sin guardar, y readiness SQL024/026/027 en versión 1 ([evidencia](prg01d-starter-workshop/activation/timing-recovery.ndjson)). Hay dos incidentes distintos: el canario anterior de alpha.36 rechazó el ID de balsa con `:` y SQL026 lo corrigió; el canario posterior de Tala en alpha.37 cercó M5 por drift entre el baseline económico y el mundo vivo. El fix de este segundo caso es alpha.38 `d962`, publicado pero aún no desplegado. Los canarios públicos completos siguen pendientes. Ver el [checkpoint de activación y recuperación](prg01d-starter-workshop/activation/README.md).

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

La publicación histórica de alpha.35/protocolo 44 está en [deployment.json](prg01d-starter-workshop/deployment.json) y [public-smoke.json](prg01d-starter-workshop/public-smoke.json). Esa salud anterior no describe el estado actual.

Tras confirmar SQL023/024, se activó el taller en la única autoridad `f939152e24b51774faab3239a902c6cc76e01d3f`, imagen `marea-negra:alpha-f939152e24b5`, alpha.36/protocolo 45. La [activación](prg01d-starter-workshop/activation/deployment.json) confirma las opciones económicas/recursos/Tala/artesano/taller. La [transición v2→v3](prg01d-starter-workshop/activation/transition.json) conservó 206 nodos, 96 palmeras, ledger, cooldowns, comunidad y semilla; añadió calidad inicial cero. La comprobación inicial de hashes requirió canonizar el orden de claves JSONB y después pasó sin repetir la mutación. No se adoptó ni activó el mundo común de suelo/perlas/muerte.

La [entrada pública](prg01d-starter-workshop/activation/public-entry.json) pasó **14/14** antes del fallo. El [navegador autenticado](prg01d-starter-workshop/activation/browser/browser-1d99d56f-c32c-4ba3-887c-b7cecf42a86d.json) pasó **8/8**: login normal, WASD al banco, entrega UI de tres tablas, recibo SQL y progreso restaurado al recargar. Las capturas desktop ES y portrait EN están inspeccionadas; móvil emulado. Esa cuenta/perfil se eliminó y su recibo se conservó.

El [canario de construcción anterior](prg01d-starter-workshop/activation/public-c59f3d35-41eb-4532-945e-f58e436b2b66.json), en alpha.36, confirmó diez tablas en lotes 3+2+3+2, reintentos históricos sin doble cobro, crédito único y kit por dos tablas. Falló al colocar la primera bodega porque el ID real de la balsa contiene `:`. SQL026 corrigió ese caso; la recuperación de la misma imagen alpha.36 se aceptó y después se limpió el perfil/Auth QA, conservando seis recibos económicos y confirmando ausente el recibo fallido ([recuperación](l03d-companion-control/prerequisite-recovery.ndjson), [limpieza retenida](l03d-companion-control/retained-qa-cleanup.json)). El [diagnóstico de solo lectura](prg01d-starter-workshop/activation/storage-diagnostic.json) y el [estado bloqueado](prg01d-starter-workshop/activation/failure-status.json) describen ese incidente histórico, no el estado actual.

El segundo incidente fue el [canario de Tala de alpha.37](prg01d-starter-workshop/activation/timing-recovery.ndjson): SQL024 comparó el mundo económico avanzado del host con el snapshot guardado antes del ACK `timing`; el drift del baseline rechazó el checkpoint y cercó M5. La recuperación exacta de alpha.37 conservó hashes de perfil y mundo y terminó con cero pendientes, errores y datos sin guardar, con readiness SQL024/026/027 en 1. El diagnóstico y la regresión están en el [baseline de Tala](prg01d-timing-baseline.md). El fix alpha.38 `d962` ya está publicado en Git; su despliegue y los canarios públicos siguen pendientes.

[SQL026](../../server/migrations/026_workshop_raft_identifiers.sql) corrigió el alfabeto de IDs del incidente de bodega; también permite el `record` acotado de una denegación y admite rechazos cuyo perfil permanece exactamente igual. Conserva los controles de éxito, recibos históricos y cerco de mundo. La [regresión SQL024/026](prg01d-starter-workshop/activation/sql026.tap) pasa **10/10**, incluidos ID generado por el host y condición persistida real, primera bodega, segunda pagada, kit, denegaciones ocupado/revisión antigua y reaplicación. Su readiness Supabase quedó confirmada junto con SQL024 y SQL027 en la recuperación alpha.37; SQL026 no corrige el incidente de drift de Tala.

Siguiente paso: completar el despliegue normal de alpha.38 `d962` y, una vez aceptada su salud, repetir `tools/qa-workshop-public.mjs` y `tools/qa-workshop-logging.mjs` para verificar construcción, capacidad, desguace y palmera→tabla con desafíos reales. La restauración exacta de alpha.37 ya está aceptada; no es aceptación de los canarios ni del nuevo runtime. El [procedimiento](prg01d-starter-workshop/live-acceptance.md) y el [checkpoint detallado](prg01d-starter-workshop/activation/README.md) conservan límites y evidencia. No apagar el taller tras adoptar recursos v3 ni volver a ejecutar SQL021/024 para corregirlo.

La ampliación INV01–03 de huecos/pilas, Carga con puntos y sobrepeso es posterior: este corte aporta el contrato inicial de volumen/masa, sin implementar esa interfaz ni cerrar su tuning.
