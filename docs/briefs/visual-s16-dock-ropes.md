# S16 — cuerdas del muelle

Continuación visual autorizada del pueblo y puerto, 2026-10-08. Añadir vueltas de cuerda
a los ocho postes existentes y dos rollos junto a los bordes de cubierta. Cuerda ocre pintada,
volumen sencillo y buena lectura desde la cámara del juego; conservar el paso central.

## Recursos y decisión

Se cruzaron los catálogos de los tres proyectos Unreal con cuerda, cornamusa, amarre, bolardo y
ancla; no apareció un candidato naval con esos nombres. La única coincidencia «coil» era eléctrica:
`C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\NiagaraExamples\Blueprints\BP_TeslaCoil.uasset`,
205.709 B, verificada de nuevo y descartada por no representar una cuerda. Búsqueda acotada por
nombres/catálogos, no conclusión sobre cada malla sin nombre descriptivo. Las fuentes quedan intactas.
`materials/references` tampoco contiene una referencia de cuerda identificada por nombre.

La balsa ya usa tubos de cuerda y el atlas ilustrado `tex:raft-comic-v1`. Se reutiliza su sector
inferior izquierdo, con margen de 0,012: UV U/V 0,012–0,488. Misma textura sRGB seleccionada por
el registro: PC 1024² / 308.536 B, táctil 512² / 82.878 B. Sin nueva imagen, normal ni manifiesto.
Una leve reducción de saturación en shader mantiene la cuerda gastada junto a la madera S13.

## Alcance y aceptación

- Una malla opaca fusionada: dos vueltas helicoidales y extremo corto por poste, dos espirales
  planas con extremos junto al borde. Máximo 16 postes compatibles; el mapa actual tiene ocho.
- Proyectar los postes reales a los ejes locales del muelle; respetar posición, altura y escala.
  Rollos en franjas laterales, dejando al menos 1,4 u centrales libres en la cubierta actual.
- Decoración local, sin unir barcos a los postes ni modificar colisiones, amarres funcionales o RNG.
  Tinte procedural si falla la textura; sin animación, nuevo contorno ni casters de sombra.
- CPU: geometría/UV finitos, determinismo, colocación, presupuesto, atlas compartido y regresión.
- GPU serial: comparar PC/móvil/Low con la fuente S15 exacta; noche, noassets, 404 del atlas y vertical
  rotado. Cámaras y props anteriores iguales; URLs/dimensiones reales, GL y cambios de calidad.
- Ficha «Cuerdas del muelle» con capturas y archivos; fuentes inmutables y enlaces HTTP por hash.

Es acabado cosmético inicial. Nudos complejos, cuerda física/animada, conexión visual a barcos,
cornamusas funcionales, arte fino, FPS de dispositivos físicos y publicación quedan pendientes.
