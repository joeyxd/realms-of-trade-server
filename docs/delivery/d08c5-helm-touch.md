# D08c.5 — palanca, vela y controles móviles

Aceptado en ambos ensayos locales, 2026-10-07. Base aislada `9bf5826`; el avance paralelo M5 `c72a78f` no modifica rutas del piloto naval ni monta PearlStaging en el harness. [Contrato y cruce FAB](../briefs/d08c5-helm-touch.md).

El piloto agarra una palanca articulada con ambas manos. El poste, cojinete, eje y pala usan las superficies de madera/hierro existentes; la pala alcanza el agua. Los brazos se resuelven sobre el rig web después de la animación habitual, sin estirarlos. En el puente la palanca permanece en el anclaje del timón al caminar y las manos recuperan su animación normal.

La vela gira suavemente alrededor del mástil según el viento relativo. Vergas, cabos y ojales acompañan la lona; el mástil y sus tirantes permanecen fijos. En la bahía, capturar la ráfaga aumenta la curvatura de la lona y conserva el splash/audio/boost existentes. La cámara sigue siendo independiente del rumbo del barco.

En móvil, el stick izquierdo permite avanzar/frenar/girar (o caminar sobre cubierta) y el derecho gira/eleva la cámara. Los controles son circulares, translúcidos, con iconos vectoriales y área táctil de al menos 44 px. Soltar, cancelar, ocultar la pestaña o salir neutraliza el contacto. «Centrar» devuelve la vista de persecución. La bahía ofrece Ráfaga/Lastre; el puente ofrece Cubierta/Timón. No se añaden habilidades ficticias al servidor.

## Recursos y alcance

Cero texturas/modelos descargables nuevos. Cuatro mallas articuladas por vela y tres para el timón; geometría/materiales cacheados y liberados con la capa. Los tres candidatos `.uasset` comprobados están enumerados en el brief, sin importación/exportación ni modificaciones de Unreal. La capa normal del juego conserva su render; la articulación entra mediante `sailingRig: true` en ambos ensayos.

El puesto es una representación visual del anclaje provisional D08c, todavía no un bloque económico colocable. No cambia perfil, protocolo, simulación naval, pérdidas durables ni publicación. Rendimiento, audio/controles físicos y sensaciones quedan para dispositivos reales y el playtest conjunto del autor.

## Verificación

Regresión focal aislada: **78/78**, 12 archivos, concurrencia 1. Incluye agarrar con el CharacterView real, atlas por superficie, pala sumergida, fallback/disposal, doble contacto independiente, cancelación, órbita sin editar el estado naval y contratos existentes de autoridad/ACK/cubierta/ráfaga. [Salida completa](d08c5-helm-touch/regression.txt) y [aceptación con hashes de 15 fuentes y 14 capturas](d08c5-helm-touch-acceptance.json).

Los cuatro recorridos de Chrome/SwiftShader pasaron: escritorio 1280×800, móvil emulado 390×844 y 844×390 en el puente, más bahía 844×390. Cero errores de página/consola/peticiones y WebGL; los tres casos del puente conservan el perfil inicial. Acciones mediante teclado o contactos CDP reales; no se inyecta un boost. La prueba espera los ticks de la ventana de ráfaga y compara manos con los puntos de agarre solicitados: error menor de 8 cm, sin clamp. La última ejecución capturó una ráfaga normal mientras otro contacto seguía moviendo la balsa. [Evidencia detallada](d08c5-helm-touch/evidence.json).

Revisión visual: siete composiciones, guardadas en 14 PNGs de página/canvas. [Timón en escritorio](d08c5-helm-touch/pilot-desktop-1280x800-full.png), [móvil vertical](d08c5-helm-touch/pilot-mobile-390x844-helm-full.png), [móvil horizontal](d08c5-helm-touch/pilot-mobile-844x390-helm-full.png), [manos libres al caminar](d08c5-helm-touch/pilot-mobile-844x390-walking-full.png) y [vela durante la ráfaga](d08c5-helm-touch/lab-mobile-844x390-capture-full.png). El velocímetro horizontal queda arriba para despejar la balsa y el piloto.

Los primeros recorridos corrigieron iconos SVG mal construidos, capas táctiles que quedaban fuera de la bahía, UVs/cabos/ojales, semántica de liberación CDP, nombre del modo `walking` y esperas basadas en frames. Favicon local explícito evita peticiones 404. No se usan capturas para acreditar FPS.

## Abrir

`PROBAR-PILOTAJE.cmd` abre el puente; «Ensayo de choque» prepara el pilotaje. `PROBAR-NAVEGACION.cmd` abre la bahía con ráfagas/corrientes/lastre. La selección móvil se detecta por pointer coarse o `?mobile=1`.

Siguiente entrega mecánica: delimitar D10, primera travesía/encuentro NPC y dos rutas. M5/D09 conserva la puerta de bienes/persistencia; este corte de presentación no la sustituye.
