# Preparación de muestras AW01

Las muestras AW01 se exportaron desde un proyecto de preparación aislado con UE 5.8 y provienen de los assets fuente. El proyecto Unreal original y las entradas de Fab Vault se conservaron en solo lectura. La etapa aislada copió la caché de descubrimiento del Asset Registry y el cierre de dependencias `/Game`; no abrió ni modificó el proyecto original.

`assets/workshop/prepared.json` es el contrato compacto `marea.asset-prepared.v1`. Cada fila se vincula con su ficha de catálogo mediante `catalogSourceRevision` y `sourcePaths`; `sourceRevision` es un SHA-256 del paquete candidato y su cierre de paquetes resueltos. Los GLB son autónomos e incluyen sus imágenes. Las texturas de escritorio se hornean a 1024 px y las móviles a 512 px. Los derivados PNG móviles no superan 512 px por lado; un PNG de origen que ya cabe en ese límite se copia sin recodificar.

La evidencia completa de hashes SHA-256 antes/después, rutas privadas de preparación, inventario de dependencias y recibo del commandlet está en `preparation-receipt.json`. El finalizador falla si una fuente o una copia de dependencia difiere de su hash original. También vuelve a comprobar los hashes de las fuentes después de exportar.

## Estado de las muestras

Hay previews verificados para el caldero anterior, la palmera Kobo, la puerta y el bote griegos, la textura de cuero de Fab, la malla de balcón de Fab y el icono de cuero. El manifiesto compacto contiene el tamaño y SHA-256 de cada archivo de escritorio y móvil.

El caldero nuevo y las variantes de algodón intacto y cosechado tienen geometría GLB autónoma derivada de sus fuentes. El resultado de materiales está incompleto: el caldero nuevo no incluye imágenes y el horneado del algodón contiene imágenes de marcador de 1×1. El plátano también contiene solo imágenes de marcador de 1×1. Sus limitaciones permiten revisar geometría y retexturizado, pero no aprobar la apariencia del material.

Los materiales de madera del bazar, metal del bazar y vidrio de agricultura siguen pendientes porque las gráficas de materiales originales no produjeron muestras verificables en el exportador UE aislado. No se sustituyeron con muestras procedurales. Las fichas permanecen en el manifiesto con sus hashes de cierre de fuentes y el motivo pendiente.

El FBX de balcón de Fab importa seis ranuras de material sin imágenes de textura. La malla sirve para revisar geometría; la apariencia de sus materiales no está validada por separado. No se realizó una auditoría externa de licencias.

## Reproducción

Desde la raíz del repositorio, ejecuta `powershell -NoProfile -ExecutionPolicy Bypass -File tools/asset-workshop/prepare-aw01.ps1 -Export`. El wrapper solo prepara dentro de `C:\DEV\real of trade\asset-workshop-preparation`, comprueba la ruta, descubre dependencias antes de exportar y verifica los hashes de las salidas. Después escribe el manifiesto compacto y el recibo privado. Las ejecuciones posteriores reutilizan las salidas solo si coinciden los hashes de receta, cierre de fuentes, archivos preparados y las copias de la etapa aislada.
