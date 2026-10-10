# PRG01d — taller personal, bodega inicial y capacidad

**Estado: implementación local; publicación y activación SQL en vivo pendientes.** El corte implementa la entrega personal de diez tablas, el crédito único de primera bodega, kits de caja y mochila con límites separados de volumen y masa. El host controla las operaciones. No se ha confirmado despliegue, activación en una base viva ni aceptación con una sesión autenticada.

## Comportamiento entregado

- El host habilita las operaciones del taller con `workshopOperations`. En perfiles nuevos, esa opción activa el estado de taller y la mochila básica de 18 uV. Con la opción apagada, los perfiles nuevos mantienen el contrato legado de 10 de capacidad y omiten `carry`/`workshop`; los perfiles existentes se conservan al abrir sesión.
- `profile.workshop` es opcional; cuando existe su forma exacta es `{v:1,boards:0..10,storageCredit:boolean,crateKits:0..99}`. El lector valida JSON con descriptores seguros, rechaza campos desconocidos/versiones futuras y trata ausencia como estado vacío. Cada operación personal aceptada aumenta `tradeRev` una vez.
- Contribuir entrega de 1 a 10 tablas que ya estén en la mochila, sin exceder el saldo restante hacia diez. La recepción final enseña `raft_storage` y crea un crédito único de primera bodega. Si esa lección ya se conocía por progreso previo, se marca la misión como completada sin conceder otro crédito. El recibo de la primera contribución exitosa también permite a un perfil legado sin metadatos adoptar mochila básica de 18 uV, únicamente si la carga restante tras el pago cabe en volumen y masa.
- La primera bodega colocada consume el crédito; otras bodegas cuestan diez tablas. Crear un kit de caja cuesta dos tablas y aumenta `crateKits`; colocar una caja consume un kit. Ambos flujos son personales y no requieren Tala ni completar una misión comunitaria. El desguace conserva el salvamento proporcional a la condición: una bodega devuelve hasta tres tablas y una caja hasta una tabla al estar a vida completa. Las piezas dañadas devuelven menos; no se restaura la vida de la balsa.
- La mochila tiene niveles de volumen 18/30/42 uV. Fuerza es `10 + (nivel - 1)` y masa máxima `18 + 2 × (Fuerza - 10)` uM. Subir del nivel inicial cuesta 2 tablas y 3 lona; subir al último nivel cuesta 4 tablas y 5 lona. El servidor cobra primero en una copia y comprueba después que los bienes restantes caben en la capacidad nueva; un rechazo no muta el perfil.
- La receta de tabla básica consume dos troncos y produce una tabla. Tala usa objetivo +45 ticks, fin +90, inicio mínimo +6 y ventanas 5/8/11 ticks para práctica 0/60/180. Los tres golpes entregan 3–6 troncos según aciertos y diez puntos de práctica por ciclo. Son valores iniciales de tuning, todavía pendientes de playtest.
- SQL024 es aditiva y se aplica después de SQL001–SQL023; conserva las barreras de adopción de mundo de SQL023. SQL021 y sus recibos anteriores no se reinterpretan ni se vuelven a ejecutar. La bandera de taller controla también la ruta del desafío de Tala; las operaciones de taller/recursos se mantienen bajo autoridad del host.

## Verificación local registrada

La [batería runtime integrada](prg01d-starter-workshop/runtime.tap) terminó con 188/188 aprobadas. La ejecución actual de las pruebas SQL (nueve pruebas en curso) y las baterías finales de QA de internacionalización y release siguen pendientes de resultado; sus conteos finales se añadirán después de concluir. El [QA visual local](prg01d-starter-workshop/ui/evidence.json) conserva 39 comprobaciones locales y 36 capturas para desktop, landscape y portrait, en español e inglés y con estados parciales/listos. Son fixtures locales: no demuestran aprobación del host autenticado, durabilidad de una base viva ni funcionamiento en un teléfono físico.

## Evidencia visual

El [índice de evidencia visual](prg01d-starter-workshop/ui/README.md) explica el alcance y enlaza el inventario completo. El [JSON de resultados](prg01d-starter-workshop/ui/evidence.json) recoge texto visible, ajuste al viewport y archivo de cada captura.

- [Panel de taller, entrega parcial, escritorio ES](prg01d-starter-workshop/ui/desktop-es-partial.png)
- [Crédito de primera bodega, escritorio EN](prg01d-starter-workshop/ui/desktop-en-ready.png)
- [Taller en viewport móvil, portrait ES](prg01d-starter-workshop/ui/portrait-es-partial.png)
- [Editor de balsa y bodega, landscape EN](prg01d-starter-workshop/ui/landscape-en-storage.png)
- [Banco de trabajo, escritorio EN](prg01d-starter-workshop/ui/desktop-en-workbench.png)
- [Panel de Tala, portrait EN](prg01d-starter-workshop/ui/portrait-en-timing.png)

## Pendiente para publicación

Completar las ejecuciones SQL, QA de internacionalización y release y registrar sus resultados. Después, mantener la función apagada hasta que SQL024 y su readiness estén verificados en el entorno destino; publicar el mismo corte y hacer un canario autenticado que confirme recibos durables, reintentos idempotentes, carga y colocación/desguace. Hasta completar esos pasos, esta entrega describe implementación y pruebas locales, no disponibilidad en vivo.
