# S15 — paja y toldo del pueblo

Continuación autorizada del corte S14, 2026-10-07: completar el acabado de las cubiertas
existentes que acompañan la madera ilustrada. Aplicación cosmética a seis casas y un puesto
del mercado. Mantener tinta, planos amplios y lectura desde la cámara del juego.

## Recursos y decisión

`materials/references` tiene los nueve pares de madera ya aplicados, sin mapas nuevos de paja/tela.
Se verificó de nuevo `SM_SmallWoodeHut.uasset`, 70.989 B, en
`C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes`:
cabaña completa con techo y rampa, sin GLB portable comprobado para estas superficies. Se mantienen
las fuentes Unreal intactas. No requiere otra exportación ni auditoría de licencias.

La paja se pinta en shader sobre las cinco franjas existentes, incluidos sus rebordes. El toldo
reutiliza el sector crema de `tex:raft-comic-v1`, UV U 0.53–0.72 / V 0.035–0.465, evitando la
costura central gigante del atlas. Franjas rojo apagado/crema, dobladillo y pliegues pintados.
Atlas existente 1024² en PC / 512² táctil; ninguna imagen, normal ni entrada de manifiesto nueva.
Relieve/normal geométrica y sombras existentes; el detalle es pintura, sin desplazamiento o viento.

## Alcance y aceptación

- Una máscara/coordenada local `aTownCover` vec3; cero en piezas ajenas. Ocho chunks existentes.
- Preservar posiciones, normales, colores, UV de madera, índices, matrices y sombras; el mapa/RNG no cambia.
- Compartir el atlas de balsa ya cargado. Tela procedural si falla o se deshabilitan assets; paja siempre nativa.
- CPU: pruebas de bake, máscara, material, propiedad de texturas y mapa/RNG; regresión de familias visuales.
- GPU: comparar PC/móvil/low con fuentes anteriores exactas; noche, noassets, 404 de tela y vertical rotado.
  Cámaras iguales, shaders/GL, URLs/resoluciones reales y cambios high→low→medium→high sin recrear recursos.
- Dos fichas nuevas con imágenes de gameplay y archivos, sin cerrar las filas del kit modular/vela/bandera.
  Congelar fuentes, registrar hashes del atlas reutilizado y verificar los enlaces servidos.

El corte no acredita un kit de techos construibles, nuevos huecos ni interiores. Arte fino, silueta de
paja irregular, telas animadas, FPS físicos y publicación conservan sus pruebas pendientes.
