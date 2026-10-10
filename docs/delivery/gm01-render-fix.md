# GM01 — corrección del gizmo en calidad alta

Estado: **corrección publicada y verificada en producción dentro de alpha.23**. El hotfix `e78c2c3`, validado localmente como alpha.21, está incluido sin cambios de GM/render en la release `4c6743b87b71ba765e316cd1652d1e4f23991501`, imagen `marea-negra:alpha-4c6743b87b71`, sana y activa desde 2026-10-10T18:43:12Z. [Evidencia de despliegue](gm01-render-fix/deployment-evidence.json).

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
- El actualizador pasó **107/107** pruebas en la imagen candidata antes de sustituir la única autoridad, con cero jugadores/conexiones y sin escrituras pendientes.
- El navegador público final pasó **7/7** comprobaciones con Supabase real en alpha.23: invitado sin permiso, entrada normal al juego, sesión GM real, render en calidad alta con contornos, colocación/guardado local y cierre por logout. Se verificó que el contador de errores del loop estaba vacío tras los primeros frames y tras colocar el modelo. Las tres capturas públicas fueron inspeccionadas. [Evidencia pública](gm01-render-fix/public-evidence.json). La primera tentativa falló en la comprobación de entrada de invitado antes de consumir el token; la repetición completa pasó sin cambios del runtime ni eliminar aserciones. [Historial](gm01-render-fix/validation-history.json).

## Alcance y límites

La corrección conserva los límites de GM01: los documentos se guardan localmente en IndexedDB, no hay edición del mapa base o del terreno, escritura remota ni publicación de mapas. La restauración ante excepciones también protege los materiales del render normal del juego. La prueba pública no cambió la contraseña del dueño ni activó funcionalidades opcionales de recursos M5.
