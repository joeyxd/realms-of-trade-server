# RNV08a — reabastecer la mochila durante una parada en costa

**Implementación local; revisión y publicación en curso.** [Contrato del corte](../briefs/RNV08a-shore-resupply.md).

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
La [integraci?n con inventario, editor y compa?eros](rnv08a-shore-resupply/merged-integration.json) pas? **63/63**.
La [aceptaci?n local de navegador](rnv08a-shore-resupply/release-accepted/evidence-2026-10-11T06-37-32-456Z.json)
pas? en escritorio ES 1280?720 y m?vil EN 390?844 (juego rotado a horizontal), con seis capturas revisadas y
cero errores de runtime, consola, solicitudes o HTTP, y sin solicitudes externas. Se comprob? compra y venta
con precio, cubeta/manantial, cantimplora, comida, bloqueos y continuidad durante m?s de 130 ticks despu?s
de reembarcar. La fixture coloca la balsa en una costa real y al jugador en mercado/manantial; no prueba conducci?n.

La revisi?n de navegador reprodujo la p?rdida del asiento en el primer tick al reembarcar mirando en otra
direcci?n. La transici?n ahora aplica tambi?n la orientaci?n del tim?n; la regresi?n primero fall? y luego
pas?, sin relajar la guarda de posici?n/asiento. El ?rbol integrado conserva pintura GM y kit/sobrepeso INV02d.
El proyecto sirve m?dulos est?ticos sin script npm de build; se revis? sintaxis del entrypoint y se probar?
la imagen Docker en el actualizador. La evidencia del despliegue se registra al cerrar el corte.

La revisión independiente detectó y se corrigió la sustitución innecesaria de la bodega en el camino local.
La aceptación visual usa cuentas y mundos en memoria; toda colocación controlada se declara en la evidencia.
No prueba navegación WAN, rendimiento en teléfono físico ni adquisición de provisiones frente a enemigos.

## Dependencia siguiente

Puerto Sol está definido como mercado económico, pero aún no tiene destino físico generado. Este corte
habilita las paradas sobre la geografía existente. La ruta Salty Shore–Puerto Sol completa requiere
coordenadas/anclas transitables acordadas con AREA01, servicio de llegada y descarga de bodega con AREA08,
retorno y aceptación duradera. Después sigue el purificador avanzado con componente de Bahía Ceniza.
