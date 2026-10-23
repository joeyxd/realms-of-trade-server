# AW01 — primera sesión del Taller de assets

El autor aprobó el Taller de assets el 14 de octubre de 2026. Este corte convierte el plan en una herramienta GM dentro del juego: encontrar una pieza por categoría o pack, verla, comparar su material, dejar una decisión y conservar la sesión. La ampliación de la biblioteca se hará por tandas; AW01 no necesita convertir todo el Vault.

## Alcance de esta entrega

28 fichas: las 20 unidades de revisión propuestas en el inventario y ocho controles ya integrados. Dieciocho fichas tienen derivados navegables; algodón contiene dos estados. Se reutilizan assets concretos de los packs adquiridos, la entrada GM existente y el renderizador del juego. No se creó arte sustituto para completar paquetes que fallaron.

El visor admite GLB autónomos e imágenes. Ofrece PBR exportado, material toon, comparación A/B, diagnóstico neutro y wireframe, dos perfiles de textura, cámara/luz y giro. Geometrías con materiales incompletos se identifican antes de revisar; una captura Unreal pendiente nunca se presenta como referencia disponible.

Cada ficha/versión/variante conserva decisión, destino, tareas, colección, notas y revisiones. El guardado es local por cuenta y servidor; conflictos o errores de almacenamiento conservan los cambios abiertos y permiten exportarlos. Importar no sobrescribe revisiones diferentes. Un lote exportado solicita preparación mediante IDs y versiones; no ejecuta comandos del PC desde el navegador.

## Límites y siguiente corte

Los materiales de madera, metal y vidrio de la muestra requieren resolver sus gráficas. Caldero nuevo, algodón, banana y balcón tienen limitaciones de apariencia; sirve su geometría para diagnóstico. Rigs, clips, audio y efectos conservan fichas pendientes; continúan en AW03/AW04. La cola automática y el índice de objetos de toda la biblioteca corresponden a AW02. Las revisiones compartidas entre dispositivos corresponden a AW05.

El visor adapta materiales para comparar; no reproduce todos los pases de render, colisiones o reglas del mundo. Las métricas de memoria son estimaciones RGBA, y las pruebas móviles son emuladas. El guardado de revisiones no publica assets, coloca objetos ni acepta materiales automáticamente.

[Entrega, reproducción y evidencia](../delivery/asset-workshop/README.md).
