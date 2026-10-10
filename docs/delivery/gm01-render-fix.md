# GM01 — corrección del gizmo en calidad alta

Estado: **corrección local verificada en alpha.21; despliegue pendiente**. Este informe documenta un hotfix de render del editor GM01. La verificación del host se registra por separado tras activar la revisión.

## Causa

En calidad media, alta y ultra, la pasada de normales/profundidad del pipeline sustituía temporalmente el material de las mallas del gizmo por un material de normales. `TransformControlsGizmo.updateMatrixWorld` de Three.js necesita clonar el color de sus materiales al actualizar los controles; como el material temporal no tiene `color`, la llamada `color.clone()` fallaba con `color` indefinido (línea 1444 de la versión cargada). La revisión inicial de GM01 se había hecho en calidad baja, por lo que no ejercitó esa combinación de render.

## Corrección

`src/editor/transformControls.js` crea los controles del editor en la capa `NO_OUTLINE` de forma recursiva y habilita esa misma capa en el raycaster de los controles. Así el gizmo queda fuera de la pasada de normales que cambia materiales, sigue visible en la pasada de color del mundo y conserva la selección de ejes y el arrastre con el puntero.

Además, `src/render/pipeline.js` restaura los materiales temporales con `try/finally`. Si falla el render de la pasada, la escena no queda con los materiales de normales asignados.

## Validación

- La reproducción original en calidad alta incrementó el contador de errores de GM (`gmEditor: 6`); la calidad baja no la reproducía.
- Pasaron dos pruebas enfocadas con Three.js real y el pipeline: aislamiento del gizmo de la pasada de contorno y raycast en `NO_OUTLINE`, y restauración de materiales tras una excepción en la pasada de normales.
- La suite seleccionada pasó **102/102** pruebas, incluidas 32 GM. [Recibo](gm01-render-fix/test-evidence.json).
- El navegador pasó **16/16** comprobaciones con autenticación simulada, iniciando en calidad alta y ejercitando 12 combinaciones (baja/media/alta/ultra × mover/girar/escalar), arrastre real del eje X con puntero y undo, además del ciclo completo de borrador, recuperación, conflicto y juego normal. Se verificó el contador de errores capturados por el loop, además de las excepciones de página. [Evidencia](gm01-render-fix/browser-evidence.json). Las cuatro capturas de calidad fueron inspeccionadas; los ejes permanecen visibles y el mundo conserva sus contornos.

## Alcance y límites

La corrección conserva los límites de GM01: los documentos se guardan localmente en IndexedDB, no hay edición del mapa base o del terreno, escritura remota ni publicación de mapas. La restauración ante excepciones también protege los materiales del render normal del juego. La entrada real de producción con calidad alta se verifica después del despliegue.
