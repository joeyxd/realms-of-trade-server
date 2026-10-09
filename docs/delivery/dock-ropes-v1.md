# S16 — cuerdas ilustradas del muelle

Entrega local del 2026-10-08: vueltas de cuerda sobre **ocho postes** y **dos rollos** junto a los
bordes de cubierta. Reutiliza el atlas de la balsa y deja despejado el paso central.
[Alcance y decisión de recursos](../briefs/visual-s16-dock-ropes.md).

## Aplicación y coste

`dockRopes.js` genera tubos de cinco caras, fusionados en una malla opaca. Proyecta los postes
existentes al espacio local del muelle y conserva su escala. Cada poste tiene dos vueltas y un
extremo corto; cada rollo es una espiral plana con extremo. Son adornos: no representan el estado
de un barco amarrado ni afectan navegación, colisiones, perfiles o RNG.

| Medida en el mapa actual | Antes → después |
|---|---|
| Mallas de props con assets | 27 → 28 |
| Triángulos de props con assets | 42.034 → 46.194 |
| Decoración añadida | 1 malla, 1 material, 4.160 triángulos |
| Atributos / índices nuevos | 83.712 / 24.960 B; total 108.672 B, aprox. 106 KiB |
| Nuevas imágenes / descargas | 0 / 0 |

Una llamada de color adicional cuando la malla está visible. Se excluye del contorno/pase normal
y no proyecta sombra; recibe las sombras existentes. El presupuesto es fijo y los cambios de calidad
reutilizan los mismos objetos. No hay simulación física ni actualización por frame de estas cuerdas.
El caso noassets usa además las cajas procedurales previas: sus props completos suman 27 mallas y
47.502 triángulos; esta diferencia pertenece al fallback existente, no a más cuerda.

El material comparte el objeto `tex:raft-comic-v1` con muelle, toldo y balsa. Sector de cuerda
U/V 0,012–0,488, sin normal adicional. PC 1024² / 308.536 B; táctil 512² / 82.878 B, sRGB.
Una solicitud por contexto; fallar ese atlas también activa el fallback previo del muelle/toldo.
Estas cifras describen recursos y estructura, no FPS físicos.

## Evidencia local

**118/118 pruebas pertinentes** pasan: cinco nuevas de cuerda, cubiertas/madera/muelle/balsa,
assets/catálogo y regresión visual de terreno, arena, palmas, arbustos, pasto, restos, algas, rocas y agua.
Verifican posiciones, escala/ejes, UV, presupuesto, atlas compartido sin disponerlo, paso central,
límite de postes y conservación de entradas del mapa sin leer RNG.

[Recibo de navegador/GPU](../art/dock-ropes/runtime-evidence-v1.json): tres comparaciones anteriores
PC/móvil/Low y siete contextos finales PC/móvil/Low/noche/noassets/404-cuerda/vertical rotado.
Tres vistas por caso, **30 capturas**, y **28 cambios de calidad finales** high→low→medium→high.
Shaders enlazados, GL=0 y cero errores JS/de juego; solo 404 esperados de atlas y favicon.
Atlas/material/geometría reutilizados al cambiar calidad; URL y resolución reales comprobadas.

En las tres comparaciones, las mallas anteriores conservan atributos, índices, matrices, shaders y
sombras; solo se excluyen atributos/matriz de las banderas animadas. La única malla añadida es
`dockRopes`; deck y chunks S13–S15 siguen idénticos. Cámaras iguales. Los 1.259 props autoritativos
conservan 220.024 B y SHA-256 `cbfcf7c7c00dcacd2bf241805951524f1cf7cc97c8debc42fce46198ee84674c`.

Capturas inspeccionadas: [rollo PC](../art/dock-ropes/desktop-coil-after-v1.png),
[poste PC](../art/dock-ropes/desktop-wrap-after-v1.png), [general PC](../art/dock-ropes/desktop-overview-after-v1.png),
[rollo móvil](../art/dock-ropes/mobile-coil-after-v1.png), [Low](../art/dock-ropes/low-wrap-after-v1.png),
[noche](../art/dock-ropes/night-coil-after-v1.png), [sin assets](../art/dock-ropes/disabled-wrap-after-v1.png),
[404 del atlas](../art/dock-ropes/missing-rope-coil-after-v1.png) y
[vertical rotado](../art/dock-ropes/portrait-overview-after-v1.png). Las vistas cercanas ocultan HUD;
la general conserva avisos de misión y NPCs del fixture de teletransporte. No son cambios de S16.

## Fuentes y catálogo

[Recibo de fuentes](../art/source/dock-ropes-v1/source-snapshot.json): una copia anterior exacta de
`props.js` y siete finales de runtime, prueba, QA y herramientas; atlas PC/móvil reutilizados por hash.
El verificador comprueba los archivos servidos y la ficha activa del catálogo, preservando las filas previas.
La ficha incluye imágenes reales del mapa, atlas existentes y código congelado descargable.

Catálogo revisión **29**, **102 filas / 47 aplicadas**; las 101 filas anteriores se conservan completas.
**44 enlaces registrados** se sirven con SHA-256 exacto. La [ficha revisada](../art/dock-ropes/catalog-ropes-v1.png)
abre 32 imágenes y 77 enlaces, sin imágenes fallidas ni errores JS. Registro idempotente y comprobación
histórica pasan; las siete fuentes finales vivas coinciden con el recibo congelado.

No se ha publicado. Nudos complejos, cuerda animada/física, conexión visual a barcos y cornamusas,
aceptación artística fina y FPS físicos están pendientes. Siguiente pieza visual sugerida:
**barriles y cajas del puerto** con el acabado de madera y hierro existente.
