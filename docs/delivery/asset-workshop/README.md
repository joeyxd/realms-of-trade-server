# AW01 — Taller de assets

La pantalla inicial incorpora **Taller de assets**. En línea usa la comprobación GM existente; en modo solo permite revisión local. Abre una escena privada, sin entrar a una partida ni modificar el mundo. El corte es alpha.88 y mantiene el protocolo 63.

Buscar y combinar categoría/pack/decisión conserva una misma ficha. Las vistas Biblioteca, Nuevos, Listos para probar, Mi colección y Pendientes incluyen miniaturas del render real, paginación y carga por selección. El visor permite PBR, toon, A/B, diagnóstico neutro, wireframe, giro/cámara/luz y perfil escritorio/móvil. Las notas y decisiones se guardan por cuenta/servidor/fuente/variante y pueden exportarse/importarse.

## Cobertura comprobada

| Medida | Resultado |
|---|---:|
| Fichas de la sesión piloto | 28 |
| Unidades del inventario | 20 |
| Controles integrados anteriores | 8 |
| Fichas con prueba navegable | 18 |
| Muestras recién preparadas | 10, con dos estados de algodón |
| Archivos nuevos escritorio/móvil verificados | 22 |
| Miniaturas de derivados renderizados | 18 |
| Fuentes/copias comprobadas por hash | 92 |

El censo de investigación congelado contiene 53.947 archivos físicos y 48 packs UE; esos números no significan que todo esté convertido o revisado. AW01 prepara una muestra y deja el resto para el índice y los lotes posteriores.

Materiales del bazar y vidrio permanecen pendientes. El caldero nuevo, algodón, banana y balcón permiten diagnóstico geométrico con límites de apariencia visibles. El caldero anterior, palmera, puerta, bote, cuero e icono ofrecen derivados con sus texturas. No se presenta ninguna de estas pruebas como equivalencia final con Unreal ni como aceptación creativa.

## Verificación

[Preparación y hashes](PREPARATION.md), [recibo de fuentes/copias](preparation-receipt.json) y [aceptación de navegador local](local/evidence.json). Chrome real ejecutó 14 comprobaciones con identidad GM simulada, render WebGL, filtros, persistencia, import/export, cancelación, estado pendiente, control de permiso y móvil emulado. Cero errores de shader/página, comandos de gameplay o escrituras remotas GM. Las capturas escritorio/móvil se inspeccionaron visualmente.

Regresión focal: 50 pruebas de catálogo, revisiones, liberación/render, permisos GM y compatibilidad con assets/Taller de habilidades. El preparador reutilizó salidas en una segunda ejecución tras cotejar receta, cierre fuente y hashes. Las fuentes originales permanecen intactas; Unreal se ejecutó únicamente sobre la copia aislada.

## Ejecutar y ampliar

`node tools/asset-workshop/local.mjs` sirve una revisión local en `http://127.0.0.1:5301/?solo`. Pulsa **Taller de assets** en la pantalla inicial. En el juego en línea la cuenta debe tener el permiso GM vigente.

`node tools/qa-asset-workshop.mjs` reproduce la aceptación local. Añadir `--prepare-thumbnails` genera imágenes desde el mismo visor y las empaqueta como WebP de 160 px, fijadas a la revisión fuente. Los PNG intermedios quedan en `.scratch`. La preparación UE y la validación de sus derivados están descritas en [PREPARATION.md](PREPARATION.md).

**Usar**, **Adaptar**, **Reservar**, **Descartar para este uso** y **Necesita inspección** son decisiones de investigación. Las tareas incluyen retexturizar, optimizar, preparar rig, ajustar pivote, revisar materiales/dependencias y versión móvil. Exportar un lote produce una solicitud declarativa para preparar localmente; aún no hay worker remoto automático. La revisión compartida y la integración jugable tienen entregas posteriores propias.

[Contrato del corte](../../briefs/AW01-asset-workshop.md). La publicación se comprueba por revisión activa, archivos y entrada de navegador; las pruebas locales por sí solas no acreditan el despliegue.

Publicación al editor GM (alpha.88): [PUBLICACION.md](PUBLICACION.md) describe `published.json` y la herramienta que vuelca las fichas «Usar» en el catálogo del editor.
