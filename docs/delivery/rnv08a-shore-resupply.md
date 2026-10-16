# RNV08a — reabastecer la mochila durante una parada en costa

**Publicado y desplegado: alpha.50 / protocolo 55.** [Contrato del corte](../briefs/RNV08a-shore-resupply.md).

Una parada seca normal permite comprar/vender en los mercados físicos existentes, fabricar recipientes,
recoger agua del manantial, rellenar desde cubeta/provisiones y comer/beber. El servidor verifica la parada,
vida, suelo seco, propiedad y continuidad de la balsa; cada servicio conserva sus reglas de alcance,
precio, espacio, canal y revisión. Una recuperación tras reconectar, una salida al agua o una cubierta
no conceden este permiso. La bodega, los barriles y la construcción permanecen bloqueados durante el viaje.

Las operaciones reutilizan M5 y SQL030/032; no se agrega SQL ni otro guardado. El commit confirmado conserva
las identidades de la balsa y de su bodega cuando no cambian; los rechazos también conservan una mochila
sin cambios. La autoridad local aplica la misma protección. Al reembarcar se recalcula la masa de la mochila,
incluidos recipientes y agua, conservando pose, casco, condición y el mismo viaje. Los recipientes de la
bodega también cuentan en la masa inicial y en la comprobación de carga congelada.

La UI ES/EN muestra por qué la bodega y los barriles están bloqueados y permite los servicios personales
solo con el estado autoritativo de parada. El corte se identifica como **alpha.50 / protocolo 55**.

## Validación

[Compatibilidad de agua/cantimplora SQL](rnv08a-shore-resupply/sql-compatibility.json): **22/22**, sin fallos
ni saltos. La [selección completa del actualizador](rnv08a-shore-resupply/updater-selection.json) pasó **176/176**
en 25 archivos, sin fallos ni saltos; incluye costa, UI, integración naval y reembarque.
La [integración con inventario, editor y compañeros](rnv08a-shore-resupply/merged-integration.json) pasó **63/63**.
La [integración de autoridad de suelo/muerte y costa](rnv08a-shore-resupply/ground-integration/integration.json)
pasó **36/36**; el montaje de esa autoridad sigue desactivado en el VPS. Los conteos se solapan.
La [aceptación local de navegador](rnv08a-shore-resupply/release-accepted/evidence-2026-10-11T06-37-32-456Z.json)
pasó en escritorio ES 1280×720 y móvil EN 390×844 (juego rotado a horizontal), con seis capturas revisadas y
cero errores de runtime, consola, solicitudes o HTTP, y sin solicitudes externas. Se comprobó compra y venta
con precio, cubeta/manantial, cantimplora, comida, bloqueos y continuidad durante más de 130 ticks después
de reembarcar. La fixture coloca la balsa en una costa real y al jugador en mercado/manantial; no prueba conducción.

La revisión de navegador reprodujo la pérdida del asiento en el primer tick al reembarcar mirando en otra
dirección. La transición ahora aplica también la orientación del timón; la regresión primero falló y luego
pasó, sin relajar la guarda de posición/asiento. El árbol integrado conserva pintura GM y kit/sobrepeso INV02d.
El proyecto sirve módulos estáticos sin script npm de build; se revisó sintaxis del entrypoint. El actualizador
construyó y probó la imagen Docker antes del cambio: **176/176**, sin fallos ni saltos.

La revisión independiente detectó y se corrigió la sustitución innecesaria de la bodega en el camino local.
La aceptación visual usa cuentas y mundos en memoria; toda colocación controlada se declara en la evidencia.
No prueba navegación WAN, rendimiento en teléfono físico ni adquisición de provisiones frente a enemigos.

## Publicación y VPS

[Despliegue](rnv08a-shore-resupply/deployment.json) comprobado el 2026-10-11 a las 06:49Z:
revisión `cd2a97b0f08e37b17620feef3fa9efcb3baf0594`, imagen
`sha256:46aea25c1066b6cdf7caaeeef9c40dbdee4519037f10d9c7255ac2cedc5b3ae4`;
una instancia sana, health/página públicos 200 y Supabase durable. Los
[21 hashes públicos](rnv08a-shore-resupply/public-readonly.json) coinciden con Git.
Agua/cantimplora, recursos/tala, fuego, artesano y atributos siguen enabled/ready; las autoridades
opt-in de muerte y suelo permanecen desactivadas. Cero errores, pendientes económicos o escrituras de perfil
al cerrar; mundo base en generación 8, sin revisión GM activa.

La [aceptación WSS pública autenticada](rnv08a-shore-resupply/public/acceptance.json) pasó cinco controles:
entrada, denegación anónima, estado privado, fabricación pagada de cantimplora, relleno desde provisiones,
bebida/comida, replay sin doble gasto, colisión y reconexión durable. La cuenta y perfil temporales se retiraron;
cinco recibos se conservan como evidencia. Este canario no navega ni fuerza una parada costera pública:
esa secuencia se acepta en el GameHost local con navegador y fixture declarada arriba.

El [actualizador instalado](rnv08a-shore-resupply/updater-install.json) ahora incluye las cuatro suites de
costa/UI/reembarque en su selección de 25 archivos. El timer continúa activo y sigue la misma rama autoritativa;
espera a que el mundo esté vacío y sin escrituras pendientes antes de cambiar la imagen. No se añadió SQL,
otro escritor ni cambios de configuración de gameplay.

## Dependencia siguiente

Puerto Sol está definido como mercado económico, pero aún no tiene destino físico generado. Este corte
habilita las paradas sobre la geografía existente. La ruta Salty Shore–Puerto Sol completa requiere
coordenadas/anclas transitables acordadas con AREA01, servicio de llegada y descarga de bodega con AREA08,
retorno y aceptación duradera. Después sigue el purificador avanzado con componente de Bahía Ceniza.
