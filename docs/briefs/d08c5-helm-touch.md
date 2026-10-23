# D08c.5 — timón articulado, vela y doble stick

Solicitud del autor, 2026-10-07: palanca de timón en las manos del piloto, vela que responda al viento y controles móviles modernos/translúcidos. Base `9bf5826`; ensayos locales D08/D08c, sin activar navegación pública.

- Principal: integración en `tools/naval-lab/main.js`, `tools/naval-pilot/main.js`, cámara compartida, HTML/CSS de los harness, QA y entrega.
- Luna renderer: `src/render/rafts.js`, nuevo `src/render/navalHelmPose.js` y pruebas focales. Opt-in de articulación; juego normal conserva batching. Materiales ya cargados; sin mapas nuevos. Huesos actuales, sin editar `characters.js` ajeno.
- Luna touch: nuevos `tools/naval-lab/touch-helm.js`, `touch-helm.css`, prueba de ownership/cancelación simultánea. Stick izquierdo navega; derecho gira cámara; acciones existentes separadas.
- Luna revisión: cruce FAB acotado, candidatos exactos y joints del personaje; solo lectura en Unreal.

La cámara nunca altera rumbo/velocidad. Las acciones de ráfaga y lastre pertenecen a la bahía D08: no se presentan como habilidades autoritativas nuevas del puente D08c. Allí los botones permiten caminar/tomar timón y centrar cámara. Sin snapshots, protocolo, perfil, economía o cambios de simulación.

Aceptación: controles independientes y analógicos, multi touch con neutral al cancelar/ocultar/salir, manos cerca de mango, vela/palanca articuladas y reset al caminar; capturas desktop/portrait/landscape inspeccionadas, sin desbordamiento. Cero texturas nuevas; pruebas pertinentes, sin afirmar FPS ni sensaciones de teléfono físico.

Cruce FAB puntual, fuentes intactas: `C:\Unreal\MyProject\Content\NiagaraExamples\Gallery\Inputs\Touch\UI_Thumbstick.uasset` (223.053 B), `C:\Unreal\MyProject\Content\Dreamrise_SMSK\Demo\UE5_Manny\Rigs\Poses\Manny\Manny_upperarm_l_anim.uasset` (220.516 B), `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Input\Actions\IA_Move.uasset` (1.590 B). Paquetes UE sin exportación ni movimiento naval verificado; ninguno ofrece timón o animación web lista. Reutilizar materiales y rig web presentes ahorra dependencias; segundo stick en adaptador de harness sin modificar `src/ui/touch.js` del juego público.
