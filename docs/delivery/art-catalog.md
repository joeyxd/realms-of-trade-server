# Catálogo de arte — materiales y objetos por filas

Fecha: 2026-10-06. Entrega local del catálogo; entorno/puerto y nuevos recursos todavía por producir.
Dirección del autor: ilustrado moderno, lectura tipo sprite y carácter cercano a Borderlands.

## Resultado

`CATALOGO-DE-ARTE.cmd` abre el servicio local en 5190. `tools/art-catalog/index.html` presenta 72 filas
en nueve categorías, con búsqueda/filtros, prioridades, variantes, imágenes existentes, archivos y estado.
Cada ficha permite subir referencias/mapas/modelos/fuentes, editar notas, exportar la ficha de integración
y registrar una captura/informe al aplicar. El catálogo completo se exporta a JSON.

Las entregas se guardan en `docs/art/catalog-files/<id>/`, con versión única, y la lista en
`tools/art-catalog/catalog.json`. Una revisión global evita sobrescribir cambios de otra ventana.
Archivos preparados exige archivos presentes; aplicado exige evidencia registrada. Marcar el estado es
seguimiento: la integración real del material/mesh/shader se realiza en su consumidor y se revisa aparte.

El catálogo inicial identifica seis elementos ya usados, con alcance limitado a la base existente:
regiones de madera/lona/hierro/cuerda del atlas de balsa, crate Dreamrise y balsa actual. Arena y palmas
tienen referencias recibidas en chat; sus originales no están disponibles como archivos locales todavía.
Las otras filas conservan imágenes/archivos pendientes en lugar de fabricar previews o declarar assets listos.

## Verificación

- **7/7** pruebas pertinentes: contratos de catálogo, persistencia, CAS concurrente, uploads por rol,
  bytes exactos, validación de nombres/rutas/extensiones, estados/evidencia y acceso local a archivos.
- JSON inicial con 72 filas/9 categorías y todos sus paths revisados. **14** enlaces HTTP únicos
  coinciden por bytes/SHA-256 con sus originales; el catálogo real conserva revisión 1.
- Navegador: vista de escritorio 1440 × 1000 y móvil emulado 390 × 844 inspeccionadas. Sin desbordamiento
  horizontal; seis previews aplicados cargados. Búsqueda/categorías/estado y apertura de ficha comprobadas.
- Notas guardadas y archivo WebP subido/mostrado mediante UI en **fixture temporal**, sin contaminar
  filas o archivos del catálogo real. No se cambió el runtime ni el manifiesto del juego.
- Evidencia: [JSON](art-catalog-evidence.json),
  `shots/review/art-catalog/{desktop,mobile}.png` (capturas locales ignoradas por Git).

La revisión automática denegó una segunda navegación/recarga con
`MCP tool call requires approval, but approval policy is never`. No se eludió: las pruebas de interacción
y móvil continuaron en la vista ya abierta. Las capturas preceden ajustes menores del contador de
referencias, nombre visible de uploads/favicon y bloqueo de «preparado» sin archivos; esos cambios se
revisaron por código y pruebas pertinentes, sin una recarga final aceptada. El único error de consola
de la primera carga fue el favicon 404, corregido con favicon vacío inline.

## Siguiente

Incorporar originales de las láminas de arena/palmera por fila, preparar recursos reales y seguir la
integración visual incremental en [PLAN-VISUAL-PORT](../../PLAN-VISUAL-PORT.md). Las fuentes Unreal
siguen intactas; revisar candidatos concretos antes de generar cada familia. V00/V01 del entorno conservan
sus gates; esta aceptación pertenece a la herramienta de catálogo, no a nuevos materiales ni FPS del juego.
