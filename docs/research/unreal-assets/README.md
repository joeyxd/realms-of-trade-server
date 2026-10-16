# Exploración Unreal/FAB para MAREA NEGRA

Autorizada por el autor el 2026-10-04 en paralelo a la discusión naval.

## Estado

- Ruta de origen confirmada por el autor: `C:\Unreal`.
- Inventario de contenido fuente terminado: un agente GPT-6 Luna por proyecto, con revisión e integración del principal.
- **Leer primero [SUMMARY.md](SUMMARY.md)**: dictamen, prioridades, pruebas propuestas y huecos de contenido.
- Para ejecutar estas pruebas junto a los milestones y agentes, seguir [PLAN-DELIVERY.md](../../../PLAN-DELIVERY.md).
  El inventario está terminado; exportación, importación y aceptación se registran por candidato y entrega.
- 7.406 archivos inventariados / 6.934.252.744 bytes (6,458 GiB), contando repeticiones entre proyectos;
  7.113 registros de Content y 293 del plugin/editor de MyProject. El suplemento de contexto no es parte de esa suma.
  Reconciliación de los tres CSV/JSON y 18 muestras SHA-256 documentadas en [DUPLICATES.md](DUPLICATES.md).
- Proyectos: `ActionRPGMultiplayerStart`, `MyProject`, `survival project\SimpleMultiplayerSurvival`.
  `ActionRPGMultiplayerStart` y `SimpleMultiplayerSurvival` declaran asociación Unreal `5.8`;
  `MyProject` declara un GUID de instalación, versión aún no resuelta.
- Localización acotada: `C:\Users\xxajx\Documents\Unreal Projects` no existe;
  `C:\Users\xxajx\OneDrive\Documents\Unreal Projects\multi survival project` está vacío. No se identificó
  ningún `.uproject` en esas ubicaciones; no se realizó búsqueda general por discos/carpetas ajenas.
- Solo lectura sobre proyectos fuente. No importar, exportar, instalar dependencias ni modificar proyectos en
  esta fase. Informes y catálogos se guardan en esta carpeta del repo.

## Objetivo y límites

Encontrar contenido adicional adquirido: modelos, kits modulares, materiales/texturas, animaciones, VFX,
audio, arte, scripts y sistemas reutilizables. Excluir módulos base de Unreal, caches, compilados y archivos
temporales. No hacer auditoría de licencias; el autor se encarga de esa parte.

Priorizar mejoras para vivienda terrestre, barcos modulares habitables, puertos/comercio, mundo/isla,
personajes y combate. Naves aéreas son una categoría de interés futuro, no una tarea de implementación actual.
Conservar la distinción entre asset presente, tipo confirmado, apariencia revisada y exportación probada.

## Entregables

1. Proyectos y packs: ruta relativa, versión de Unreal, plugins propios/adicionales y dependencias relevantes.
2. Inventario estructurado: categoría, pack/proyecto, archivo/ruta, cantidad/tamaño y evidencia del tipo.
3. Candidatos prioritarios: mejora concreta, milestone, destino/ganchos actuales, trabajo de conversión,
   dependencias, límites de rendimiento y confianza de la evaluación.
4. Separación clara: reutilización directa, exportación/conversión, recreación de lógica/efecto e inspiración.
5. Duplicados entre proyectos identificados por evidencia; hashes selectivos si hacen falta, sin borrar nada.
6. Lista corta de pruebas de exportación para la fase siguiente; ninguna exportación se da por hecha.

Informes por proyecto: [ActionRPG](actionrpg/FINDINGS.md), [MyProject](myproject/FINDINGS.md),
[Supervivencia](survival/FINDINGS.md). Datos conjuntos: [packs](PACKS.csv), [candidatos](CANDIDATES.csv),
[cruce de copias](DUPLICATES.md) y [validación](validation.json). Las miniaturas de inspección están enlazadas
desde los informes; las imágenes de los packs fuente permanecen en `C:\Unreal`.

## Campos del catálogo

`project`, `pack`, `relative_path`, `category`, `confirmed_asset_type`, `evidence`, `file_count`, `bytes`,
`dependencies`, `game_use`, `milestone`, `integration_hook`, `portability`, `conversion_work`, `priority`,
`confidence`, `preview_reviewed`, `export_verified`, `notes`.

Los nombres de carpetas/archivos no prueban por sí solos clase, calidad, polígonos, compatibilidad de rig o
resultado visual. Marcar inferencias y propiedades pendientes de inspección/exportación.
