# Huellas al caminar sobre arena

Solicitud del autor: sustituir las huellas estáticas por pisadas que aparezcan al caminar.
Implementado en el juego local: cada apoyo de la animación deja una marca de planta/talón,
alternando izquierda/derecha y orientada al movimiento. Se aplica también a los humanoides
remotos que el cliente esté viendo. El sonido y polvo existentes mantienen su callback.

La duración inicial es de 18 segundos en arena seca y baja progresivamente hasta 5 segundos
en la húmeda; la opacidad disminuye antes de desaparecer. La pausa congela su tiempo.
No se producen al estar quieto, morir, saltar, hacer dash, vadear, ni sobre cubiertas, caminos,
roca, lava o pendientes fuertes. Las correcciones grandes de posición no dibujan un recorrido.

Las marcas son decals cosméticos que siguen la altura del terreno. No deforman la malla,
ni cambian colisiones, snapshots, protocolo o partidas guardadas. Cada cliente observa las
pisadas durante su sesión; no recupera rastros de antes de entrar ni obtiene un historial
compartido para rastreo de gameplay. La espuma de las olas no las borra físicamente todavía:
su menor duración cerca del agua es el comportamiento implementado.

El camino pintado del PNG de huellas queda conservado como referencia y variante de revisión,
desactivado por defecto mediante `mnSandStaticFootprints=0`. Las marcas nuevas usan una
máscara de suela procedural con borde pintado, sin recortar cuadrados de arena del PNG.

## Presupuesto y reutilización

Una sola malla/material y una llamada adicional de dibujo cuando existen huellas. Hasta 256
marcas en escritorio, 128 con puntero táctil y 96 en calidad baja; se reutiliza el mismo pool.
Ocho triángulos por marca, vértices ajustados al suelo. Cada pisada actualiza solamente sus
rangos de posición y vida en GPU (216 bytes); no crea geometrías ni texturas nuevas.
El shader no emite luz y respeta la profundidad para ocultar marcas detrás de objetos.

Revisión previa de fuentes Unreal intactas: se verificaron en disco los paquetes
`NiagaraExamples/FX_Footstep/Materials/M_Footprint_Decal.uasset` (21.111 B) y
`Textures/T_Footprint_Mask.uasset` (38.283 B), `T_Footprint_Mask2.uasset` (23.802 B),
`T_Footprint_Normals.uasset` (270.455 B), en `C:/Unreal/survival project/SimpleMultiplayerSurvival/Content/`.
Inventario: [Supervivencia](../research/unreal-assets/survival/files.csv), filas 457 y 463–465.
No hay preview extraído ni dependencias de esas máscaras validadas para navegador. Se reutilizan
el apoyo de pie del rig actual y la profundidad/iluminación de los decals; Niagara no se importa.

## Verificación local

- Caminata real mediante WASD: nueve marcas alternadas en escritorio y diez en móvil emulado.
- Capturas inspeccionadas: [PC con huellas](../art/sand/footprints-desktop-live-v1.png),
  [PC al desaparecer](../art/sand/footprints-desktop-faded-v1.png),
  [móvil con huellas](../art/sand/footprints-mobile-live-v1.png) y
  [móvil al desaparecer](../art/sand/footprints-mobile-faded-v1.png).
- Para comparar la misma escena se congeló la simulación y se avanzó el reloj visual de huellas
  19 segundos. El contador bajó a cero y la malla dejó de dibujarse. Comparación directa del
  framebuffer: 6.500 píxeles cambiados al ocultar las nueve marcas, 129 frente a 128 llamadas.
- PC 1280×720/high; móvil 844×390/medium, puntero coarse, límite 128 y arena realmente cargada
  de 512 px. Registro del juego vacío y sin error WebGL. No constituye una medición de FPS físico.
- `node --test tests/footprints.test.mjs tests/sand-terrain.test.mjs tests/assets.test.mjs tests/raft-materials.test.mjs tests/art-catalog.test.mjs`: **35/35**.
  Los diez checks de huellas/arena se repitieron al ajustar el límite móvil; la carga por rangos
  se revisó en la implementación de Three 0.160 y se comprobó en el navegador.

Probar con `PROBAR-ARENAS.cmd` o [juego local](http://127.0.0.1:5192/?solo&debug&q=high&tod=day).
Recargar y pulsar JUGAR. Duración, ancho y largo están en `FOOTPRINT_TUNING` de
`src/render/vfx/footprints.js`. Tamaño/intensidad quedan para la revisión artística del autor.
La fila `huellas-arena` del catálogo incluye esta entrega y capturas. Publicación pendiente.
